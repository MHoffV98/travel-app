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
import { put, get, list } from "@vercel/blob";

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
            const n = b.pathname.split("/").pop();
            if (n && n !== "_essentials.json") keys.push(n.replace(/\.json$/, ""));
          }
          cursor = r.cursor;
        } while (cursor);
        res.status(200).json({ keys });
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
      const trip = safe(body.trip);
      if (!trip || !body.list) { res.status(400).json({ error: "bad" }); return; }
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
