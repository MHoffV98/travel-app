// packingStore.js — where a trip's packing list lives.
//
// Same shape as photoStore: a PRIVATE Vercel Blob store when one is connected
// (so a list built on the laptop is on your phone, and survives the phone
// clearing its storage), falling back to localStorage when there's no backend.
// Packing lists are permanent trip history, so nothing here ever deletes one.

import { TRIPS } from "./data.js";

// A filesystem-safe, stable key for a trip id (ids can contain '#').
export const packingKey = (id) => String(id).replace(/[^a-z0-9_-]/gi, "_");

const LOCAL_KEY = "travelmap.packing.v1";
const LOCAL_ESSENTIALS = "travelmap.packing.essentials.v1";

const localAll = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch { return {}; } };
const localWrite = (m) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(m)); } catch { /* quota */ } };

// ---------- backend resolution (cloud vs local), probed once ----------
// Three outcomes, and the difference matters:
//   "cloud"       synced store reachable
//   "local"       there is no backend at all (dev, or no Blob store connected)
//   "unreachable" there IS one, we just couldn't reach it right now — offline,
//                 signed out, or a cold start that timed out
async function probe() {
  try {
    const r = await fetch("/api/packing?probe=1", { headers: { accept: "application/json" } });
    if (r.ok && (await r.json().catch(() => ({}))).ok) return "cloud";
    if (r.status === 404) return "local";     // function isn't deployed — dev server
    return "unreachable";                     // 401 signed out, 503 hiccup, 5xx
  } catch { return "unreachable"; }           // offline / DNS / aborted
}

let backendP;
function backend() {
  // Only a settled answer is cached. A failed probe must never latch for the
  // rest of the session: one bad request on a phone used to leave every packing
  // list and photo looking permanently deleted.
  if (!backendP) backendP = (async () => {
    const b = await probe();
    if (b === "cloud") await migrate();
    if (b === "unreachable") backendP = null;   // so the next call tries again
    return b;
  })();
  return backendP;
}

// ---------- one-time migration: push on-device lists up to the cloud ----------
const MIGRATED = "travelmap.packing.migrated.v1";
async function migrate() {
  if (localStorage.getItem(MIGRATED)) return;
  try {
    for (const [key, list] of Object.entries(localAll())) {
      await fetch("/api/packing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip: key, list }) });
    }
    const ess = JSON.parse(localStorage.getItem(LOCAL_ESSENTIALS) || "[]");
    if (ess.length) await fetch("/api/packing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ essentials: ess }) });
    localStorage.setItem(MIGRATED, "1"); // local copies are kept as a backup
  } catch { /* leave for next load */ }
}

// ---------------------------------------------------------------------------
// Trip ids are the trip's start date (or an explicit tag), so a rebooked flight
// can shift the id and orphan a list. If there's no exact hit, accept a list
// saved against a near-identical trip: same countries, start within a week.
const DATEY = /^\d{4}-\d{2}-\d{2}$/;
function relinkKey(trip, keys) {
  const key = packingKey(trip.id);
  if (keys.includes(key)) return key;
  if (!DATEY.test(trip.start)) return null;
  const target = Date.parse(trip.start);
  const otherTripKeys = new Set(TRIPS.filter((t) => t.id !== trip.id).map((t) => packingKey(t.id)));
  const near = keys
    .filter((k) => DATEY.test(k) && !otherTripKeys.has(k))            // don't steal another trip's list
    .map((k) => ({ k, gap: Math.abs(Date.parse(k) - target) / 86400000 }))
    .filter((x) => x.gap <= 7)
    .sort((a, b) => a.gap - b.gap);
  return near.length ? near[0].k : null;
}

// ---------- public API ----------
const fromLocal = (trip) => {
  const all = localAll(), key = packingKey(trip.id);
  if (all[key]) return all[key];
  const hit = relinkKey(trip, Object.keys(all));
  return hit ? all[hit] : null;
};

/**
 * Returns { list, offline }.
 *
 * `offline: true` means the synced store exists but we couldn't read it, so a
 * null list means "don't know", NOT "no list". The caller must not offer to
 * generate a fresh one in that state — that's what made a momentary blip look
 * like the trip's packing list had been deleted.
 */
export async function getPackingList(trip) {
  const key = packingKey(trip.id);
  // Local edits that haven't reached the cloud are the newer truth — serving the
  // cloud's stale copy here would show old state and then overwrite the edits.
  if (pendingKeys().includes(key)) { flushPending(); return { list: localAll()[key] || null, offline: false }; }
  const b = await backend();
  if (b === "cloud") {
    try {
      const keys = (await (await fetch("/api/packing?keys=1")).json()).keys || [];
      const hit = relinkKey(trip, keys);
      if (!hit) return { list: null, offline: false };          // genuinely no list
      const j = await (await fetch(`/api/packing?trip=${encodeURIComponent(hit)}`)).json();
      return { list: j.list || null, offline: false };
    } catch {
      return { list: fromLocal(trip), offline: true };          // reachable, then wasn't
    }
  }
  if (b === "unreachable") return { list: fromLocal(trip), offline: true };
  return { list: fromLocal(trip), offline: false };
}

// Keys whose cloud write failed (packing happens on planes). Retried on the next
// save and on the next load, so an offline session syncs up once you're back.
const PENDING = "travelmap.packing.pending.v1";
const pendingKeys = () => { try { return JSON.parse(localStorage.getItem(PENDING)) || []; } catch { return []; } };
const setPending = (ks) => { try { localStorage.setItem(PENDING, JSON.stringify([...new Set(ks)])); } catch { /* quota */ } };

async function pushKey(key, list) {
  const r = await fetch("/api/packing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip: key, list }) });
  if (!r.ok) throw new Error("save failed");
}

export async function flushPending() {
  const keys = pendingKeys();
  if (!keys.length || (await backend()) !== "cloud") return;
  const all = localAll();
  const still = [];
  for (const k of keys) {
    if (!all[k]) continue;
    try { await pushKey(k, all[k]); } catch { still.push(k); }
  }
  setPending(still);
}

export async function savePackingList(trip, list) {
  const key = packingKey(trip.id);
  // Always keep a local copy — it's the offline read and the backstop.
  const all = localAll(); all[key] = list; localWrite(all);
  if ((await backend()) === "cloud") {
    try {
      await pushKey(key, list);
      setPending(pendingKeys().filter((k) => k !== key));
      flushPending();                                   // opportunistically drain the rest
      return "cloud";
    } catch {
      setPending([...pendingKeys(), key]);              // retry when we're back online
      return "local";
    }
  }
  return "local";
}

// Which trips have a list, for the collapsed-card indicator. Keys are packingKey(id).
export async function packingKeys() {
  flushPending();   // runs on the Trips tab mounting — the earliest natural retry
  if ((await backend()) === "cloud") {
    try { return new Set((await (await fetch("/api/packing?keys=1")).json()).keys || []); } catch { /* fall through */ }
  }
  return new Set(Object.keys(localAll()));
}

// ---------- the global "things I always forget" list ----------
export async function getEssentials() {
  if ((await backend()) === "cloud") {
    try { return (await (await fetch("/api/packing?essentials=1")).json()).essentials || []; } catch { /* fall through */ }
  }
  try { return JSON.parse(localStorage.getItem(LOCAL_ESSENTIALS)) || []; } catch { return []; }
}

export async function saveEssentials(essentials) {
  try { localStorage.setItem(LOCAL_ESSENTIALS, JSON.stringify(essentials)); } catch { /* quota */ }
  if ((await backend()) === "cloud") {
    try { await fetch("/api/packing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ essentials }) }); } catch { /* local copy stands */ }
  }
}
