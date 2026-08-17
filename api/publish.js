// Vercel serverless function — trigger a production rebuild from the app.
// POSTs to a Vercel Deploy Hook (stored in the DEPLOY_HOOK_URL env var). The
// rebuild re-runs the pipeline, which ingests any flight export uploaded via
// /api/upload-flights, so a new deploy goes live ~1 min later — all from the phone.
//
// Gated by the site password cookie. Returns 503 until the deploy hook is set up
// (needs the GitHub↔Vercel connection first).
const PASSWORD = process.env.SITE_PASSWORD || "wanderlust";
const TOKEN = "tmv1-" + PASSWORD.length + "-" + [...PASSWORD].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
const authed = (req) => (req.headers.cookie || "").split(";").some((p) => p.trim() === `tm_auth=${TOKEN}`);

export default async function handler(req, res) {
  if (!authed(req)) { res.status(401).json({ error: "auth" }); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  const hook = process.env.DEPLOY_HOOK_URL;
  if (!hook) { res.status(503).json({ error: "no_hook", message: "Publishing isn't wired up yet — needs the deploy hook (after the GitHub connection)." }); return; }
  try {
    const r = await fetch(hook, { method: "POST" });
    if (!r.ok) { res.status(502).json({ error: "trigger_failed", message: `Deploy hook returned ${r.status}` }); return; }
    const j = await r.json().catch(() => ({}));
    res.status(200).json({ ok: true, job: j.job || null });
  } catch (e) {
    res.status(502).json({ error: "trigger_failed", message: String((e && e.message) || e).slice(0, 200) });
  }
}
