// Vercel serverless function — private trip photos in Vercel Blob.
// Photos live in a PRIVATE Blob store, so they're only ever served back through
// this function (never a public URL). Access is gated by the same password cookie
// as the rest of the site (defence-in-depth on top of the edge middleware).
//
// If no Blob store is connected to the project, every Blob call throws and we
// return 503 → the client falls back to on-device IndexedDB storage, so photos
// keep working with no backend and nothing is lost.
//
// Auth on Vercel is automatic (OIDC) once the private store is connected to this
// project — no token to set. See docs/vercel-blob/private-storage.
import { put, get, list, del } from "@vercel/blob";
import { Readable } from "node:stream";

const PASSWORD = process.env.SITE_PASSWORD || "wanderlust";
// Same token derivation as middleware.js, so a valid site session authorises here.
const TOKEN = "tmv1-" + PASSWORD.length + "-" + [...PASSWORD].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
function authed(req) {
  return (req.headers.cookie || "").split(";").some((p) => p.trim() === `tm_auth=${TOKEN}`);
}
const safe = (s) => String(s || "").replace(/[^a-z0-9_-]/gi, "_");

export default async function handler(req, res) {
  if (!authed(req)) { res.status(401).json({ error: "auth" }); return; }
  const q = new URL(req.url, "http://x").searchParams;
  try {
    // --- image proxy: stream a private blob's bytes back to the browser ---
    if (req.method === "GET" && q.get("pathname")) {
      const r = await get(q.get("pathname"), { access: "private" });
      if (!r || r.statusCode !== 200) { res.status(404).send("Not found"); return; }
      res.setHeader("Content-Type", r.blob?.contentType || "image/jpeg");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=86400");
      Readable.fromWeb(r.stream).pipe(res);
      return;
    }
    // --- probe: is a Blob store connected? ---
    if (req.method === "GET" && q.get("probe")) {
      await list({ prefix: "photos/", limit: 1 });
      res.status(200).json({ ok: true }); return;
    }
    // --- counts per trip (for the collapsed-card indicator) ---
    if (req.method === "GET" && q.get("counts")) {
      const counts = {}; let cursor;
      do {
        const r = await list({ prefix: "photos/", cursor, limit: 1000 });
        for (const b of r.blobs) { const t = b.pathname.split("/")[1]; if (t) counts[t] = (counts[t] || 0) + 1; }
        cursor = r.cursor;
      } while (cursor);
      res.status(200).json({ counts }); return;
    }
    // --- list one trip's photos ---
    if (req.method === "GET") {
      const trip = safe(q.get("trip"));
      const r = await list({ prefix: `photos/${trip}/`, limit: 1000 });
      const photos = r.blobs
        .map((b) => ({ pathname: b.pathname, id: b.pathname.split("/").pop().replace(/\.jpg$/, ""), at: b.uploadedAt || "" }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      res.status(200).json({ photos }); return;
    }
    // --- upload a (downscaled) photo, sent as a data URL ---
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const trip = safe(body.trip), id = safe(body.id);
      if (!trip || !id || !body.dataUrl) { res.status(400).json({ error: "bad" }); return; }
      const buf = Buffer.from(String(body.dataUrl).replace(/^data:[^,]*,/, ""), "base64");
      const r = await put(`photos/${trip}/${id}.jpg`, buf, { access: "private", contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: true });
      res.status(200).json({ ok: true, pathname: r.pathname, id }); return;
    }
    // --- delete a photo by its pathname ---
    if (req.method === "DELETE") {
      const p = q.get("pathname");
      if (p) await del(p);
      res.status(200).json({ ok: true }); return;
    }
    res.status(405).json({ error: "method" });
  } catch (e) {
    // Most likely no Blob store connected → tell the client to use local storage.
    res.status(503).json({ error: "no_store", message: String((e && e.message) || e).slice(0, 200) });
  }
}
