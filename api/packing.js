// Vercel serverless function — trip packing lists in Vercel Blob.
//
// A packing list is the record of what was actually taken on a trip, kept for
// good, so it needs to outlive any one device: phone storage gets evicted, and
// these lists are also read on the way home. They live as small JSON documents
// in the same PRIVATE Blob store as the photos:
//
//   packing/<tripKey>.json   one trip's list
//   packing/_essentials.json the user-level "things I always forget" list
//
// Gated by the same password cookie as the rest of the site. If no Blob store is
// connected every call throws → 503, and the client falls back to localStorage.
import { put, get, list, del } from "@vercel/blob";

const PASSWORD = process.env.SITE_PASSWORD || "wanderlust";
// Same token derivation as middleware.js, so a valid site session authorises here.
const TOKEN = "tmv1-" + PASSWORD.length + "-" + [...PASSWORD].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
const authed = (req) => (req.headers.cookie || "").split(";").some((p) => p.trim() === `tm_auth=${TOKEN}`);
const safe = (s) => String(s || "").replace(/[^a-z0-9_-]/gi, "_");

async function readJson(pathname) {
  const r = await get(pathname, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  try { return JSON.parse(await new Response(r.stream).text()); } catch { return null; }
}
const writeJson = (pathname, value) =>
  put(pathname, JSON.stringify(value), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });

const HISTORY_KEEP = 10;

// Park a copy of a list that's about to be replaced, and prune the oldest.
async function snapshot(trip, doc) {
  if (!doc) return;
  await writeJson(`packing/history/${trip}/${Date.now()}.json`, doc);
  try {
    const { blobs } = await list({ prefix: `packing/history/${trip}/`, limit: 1000 });
    const extra = blobs.map((b) => b.pathname).sort().slice(0, -HISTORY_KEEP);
    for (const p of extra) await del(p);
  } catch { /* pruning is best-effort; never fail a save over it */ }
}

export default async function handler(req, res) {
  if (!authed(req)) { res.status(401).json({ error: "auth" }); return; }
  const q = new URL(req.url, "http://x").searchParams;
  try {
    if (req.method === "GET") {
      // --- probe: is a Blob store connected? ---
      if (q.get("probe")) { await list({ prefix: "packing/", limit: 1 }); res.status(200).json({ ok: true }); return; }
      // --- the global essentials list ---
      if (q.get("essentials")) {
        res.status(200).json({ essentials: (await readJson("packing/_essentials.json"))?.essentials || [] });
        return;
      }
      // --- which trips have a list (for the collapsed-card indicator) ---
      if (q.get("keys")) {
        const keys = []; let cursor;
        do {
          const r = await list({ prefix: "packing/", cursor, limit: 1000 });
          for (const b of r.blobs) {
            // packing/history/<trip>/<ts>.json lives under the same prefix — those
            // are superseded versions, not trips that have a list.
            if (b.pathname.startsWith("packing/history/")) continue;
            const n = b.pathname.split("/").pop();
            if (n && n !== "_essentials.json") keys.push(n.replace(/\.json$/, ""));
          }
          cursor = r.cursor;
        } while (cursor);
        res.status(200).json({ keys });
        return;
      }
      // --- superseded versions of one trip's list ---
      if (q.get("history")) {
        const t = safe(q.get("history"));
        const { blobs } = await list({ prefix: `packing/history/${t}/`, limit: 1000 });
        const versions = [];
        for (const b of blobs.sort((x, y) => (x.pathname < y.pathname ? 1 : -1)).slice(0, 10)) {
          const id = b.pathname.split("/").pop().replace(/\.json$/, "");
          const doc = await readJson(b.pathname);
          if (doc) versions.push({ id, savedAt: Number(id) || null, generatedAt: doc.generatedAt || null, items: (doc.items || []).length, packed: (doc.items || []).filter((i) => i.packed).length });
        }
        res.status(200).json({ versions });
        return;
      }
      // --- one trip's list ---
      const trip = safe(q.get("trip"));
      if (!trip) { res.status(400).json({ error: "bad" }); return; }
      res.status(200).json({ list: await readJson(`packing/${trip}.json`) });
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (Array.isArray(body.essentials)) {
        await writeJson("packing/_essentials.json", { essentials: body.essentials.map(String) });
        res.status(200).json({ ok: true });
        return;
      }
      // Restore a superseded version back over the live one.
      if (body.restore) {
        const t = safe(body.restore.trip), v = safe(body.restore.id);
        const old = await readJson(`packing/history/${t}/${v}.json`);
        if (!old) { res.status(404).json({ error: "no_version" }); return; }
        await snapshot(t, await readJson(`packing/${t}.json`));
        await writeJson(`packing/${t}.json`, old);
        res.status(200).json({ ok: true, list: old });
        return;
      }
      const trip = safe(body.trip);
      if (!trip || !body.list) { res.status(400).json({ error: "bad" }); return; }
      // A packing list is permanent trip history, and a regenerate replaces the
      // whole thing. Keep the outgoing copy whenever the incoming list is a
      // *different generation* — that's the destructive case. Ordinary edits
      // (ticking an item) share generatedAt and skip this, so the common write
      // stays a single request.
      const prev = await readJson(`packing/${trip}.json`);
      if (prev && prev.generatedAt !== body.list.generatedAt) await snapshot(trip, prev);
      await writeJson(`packing/${trip}.json`, body.list);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "method" });
  } catch (e) {
    // Most likely no Blob store connected → tell the client to use local storage.
    res.status(503).json({ error: "no_store", message: String((e && e.message) || e).slice(0, 200) });
  }
}
