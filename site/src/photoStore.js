// photoStore.js — trip photos.
// Uses a PRIVATE Vercel Blob store when one is connected (synced across all your
// devices, gated by the site password). Falls back to on-device IndexedDB when
// there's no store / offline, so photos always work with no backend. On first load
// with a store present, photos already on this device are migrated up to the cloud.
//
// Public API returns records shaped { id, url, pathname?, revoke? } — `url` is
// ready for an <img>, `pathname` marks a cloud photo (delete target), and `revoke`
// marks a local blob: URL that should be URL.revokeObjectURL'd when replaced.

// A filesystem-safe, stable key for a trip id (ids can contain '#').
export const photoTripKey = (id) => String(id).replace(/[^a-z0-9_-]/gi, "_");

// ---------- downscale + re-encode to JPEG ----------
export async function fileToBlob(file, maxDim = 1600, quality = 0.82) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { bmp = await createImageBitmap(file); }
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", quality));
}
const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

// ---------- local: IndexedDB (fallback + migration source) ----------
const DB = "travel-photos", STORE = "photos", VER = 1;
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) { const os = db.createObjectStore(STORE, { keyPath: "id" }); os.createIndex("trip", "trip"); } };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function os(mode) { const db = await open(); return db.transaction(STORE, mode).objectStore(STORE); }
async function localAdd(trip, blob, stamp) {
  const id = `${trip}-${stamp}-${Math.round(Math.random() * 1e6)}`;
  const s = await os("readwrite");
  return new Promise((res, rej) => { const r = s.add({ id, trip, blob, added: stamp }); r.onsuccess = () => res(id); r.onerror = () => rej(r.error); });
}
async function localGet(trip) {
  const s = await os("readonly"); const idx = s.index("trip");
  return new Promise((res, rej) => { const out = []; const r = idx.openCursor(IDBKeyRange.only(trip)); r.onsuccess = () => { const c = r.result; if (c) { out.push(c.value); c.continue(); } else res(out.sort((a, b) => a.added - b.added)); }; r.onerror = () => rej(r.error); });
}
async function localAll() {
  const s = await os("readonly");
  return new Promise((res, rej) => { const out = []; const r = s.openCursor(); r.onsuccess = () => { const c = r.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; r.onerror = () => rej(r.error); });
}
async function localDelete(id) { const s = await os("readwrite"); return new Promise((res, rej) => { const r = s.delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }

// ---------- backend resolution (cloud vs local), probed once ----------
let backendP;
function backend() {
  if (!backendP) backendP = (async () => {
    try {
      const r = await fetch("/api/photos?probe=1", { headers: { accept: "application/json" } });
      if (r.ok && (await r.json().catch(() => ({}))).ok) { await migrate(); return "cloud"; }
    } catch { /* offline or no function → local */ }
    return "local";
  })();
  return backendP;
}

// ---------- one-time migration: push on-device photos up to the cloud ----------
const MIGRATED = "travelmap.photos.migrated.v1";
async function migrate() {
  if (localStorage.getItem(MIGRATED)) return;
  try {
    const all = await localAll();
    for (const rec of all) {
      const dataUrl = await toDataUrl(rec.blob);
      await fetch("/api/photos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip: photoTripKey(rec.trip), id: photoTripKey(rec.id), dataUrl }) });
    }
    localStorage.setItem(MIGRATED, "1"); // local copies are kept as a backup
  } catch { /* leave for next load */ }
}

// ---------- public API ----------
export async function getPhotos(trip) {
  if ((await backend()) === "cloud") {
    try {
      const r = await fetch(`/api/photos?trip=${encodeURIComponent(photoTripKey(trip))}`);
      const j = await r.json();
      return (j.photos || []).map((p) => ({ id: p.id, pathname: p.pathname, url: `/api/photos?pathname=${encodeURIComponent(p.pathname)}` }));
    } catch { /* fall through to local */ }
  }
  const recs = await localGet(trip);
  return recs.map((rec) => ({ id: rec.id, url: URL.createObjectURL(rec.blob), revoke: true }));
}

export async function addPhotos(trip, files, stampStart = Date.now()) {
  const cloud = (await backend()) === "cloud";
  let stamp = stampStart, n = 0;
  for (const f of files) {
    if (!f.type?.startsWith("image/")) continue;
    const blob = await fileToBlob(f);
    if (cloud) {
      const dataUrl = await toDataUrl(blob);
      const r = await fetch("/api/photos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip: photoTripKey(trip), id: `${stamp}-${Math.round(Math.random() * 1e6)}`, dataUrl }) });
      if (!r.ok) throw new Error("upload failed");
    } else {
      await localAdd(trip, blob, stamp);
    }
    stamp++; n++;
  }
  return n;
}

export async function deletePhoto(trip, rec) {
  if (rec.pathname) { await fetch(`/api/photos?pathname=${encodeURIComponent(rec.pathname)}`, { method: "DELETE" }); return; }
  await localDelete(rec.id);
}

// trip key -> photo count, for the collapsed-card indicator. Keys are photoTripKey(id).
export async function photoCounts() {
  if ((await backend()) === "cloud") {
    try { return (await (await fetch("/api/photos?counts=1")).json()).counts || {}; } catch { /* fall through */ }
  }
  const all = await localAll(); const m = {};
  for (const r of all) { const k = photoTripKey(r.trip); m[k] = (m[k] || 0) + 1; }
  return m;
}
