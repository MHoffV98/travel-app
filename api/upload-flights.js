// Vercel serverless function — receive a Flighty / FR24 export from the app and
// store it in the private Blob store at inputs/<kind>.csv. The build pipeline
// picks it up on the next publish (rebuild), so you can update flights from your
// phone without touching the code machine.
//
// Gated by the site password cookie (same as the rest of the app). Returns 503 if
// no Blob store is connected.
import { put } from "@vercel/blob";

const PASSWORD = process.env.SITE_PASSWORD || "wanderlust";
const TOKEN = "tmv1-" + PASSWORD.length + "-" + [...PASSWORD].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
const authed = (req) => (req.headers.cookie || "").split(";").some((p) => p.trim() === `tm_auth=${TOKEN}`);

export default async function handler(req, res) {
  if (!authed(req)) { res.status(401).json({ error: "auth" }); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const kind = body.kind === "fr24" ? "fr24" : "flighty";
    const csv = String(body.csv || "");
    if (csv.length < 20 || !/[\n,]/.test(csv)) { res.status(400).json({ error: "bad_csv" }); return; }
    const r = await put(`inputs/${kind}.csv`, csv, { access: "private", contentType: "text/csv", addRandomSuffix: false, allowOverwrite: true });
    res.status(200).json({ ok: true, kind, pathname: r.pathname, bytes: csv.length });
  } catch (e) {
    res.status(503).json({ error: "no_store", message: String((e && e.message) || e).slice(0, 200) });
  }
}
