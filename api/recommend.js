// Vercel serverless function: AI travel recommendations.
// Calls the Claude API with a server-side key (set ANTHROPIC_API_KEY in Vercel
// env vars). No SDK — plain fetch on the Node runtime. Same-origin, so no CORS.
const MODEL = "claude-haiku-4-5-20251001";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method", message: "POST only" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: "no_key", message: "ANTHROPIC_API_KEY is not set on the server." }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const visited = (body.visited || []).slice(0, 120);
    const wishlist = (body.wishlist || []).slice(0, 60);
    const preferences = (body.preferences || "").slice(0, 500);

    const system =
      "You are a discerning travel recommender. Suggest fresh destinations the traveller has NOT already visited, " +
      "matched to the taste implied by their history and stated preferences. Be specific — a city or region, not just a country. " +
      "Avoid anywhere already in their visited list or wishlist. Respond with ONLY a JSON object, no prose.";
    const prompt =
      `Already visited: ${visited.join(", ") || "(unknown)"}.\n` +
      `Current wishlist: ${wishlist.join(", ") || "(empty)"}.\n` +
      `Preferences: ${preferences || "(none stated)"}.\n\n` +
      `Suggest 6 destinations they'd likely love but haven't been. For each give: name (city/region), country, ` +
      `lat and lon (decimal degrees, approximate), and reason (one sentence tying to their history/taste). ` +
      `Respond as JSON exactly: {"suggestions":[{"name":"","country":"","lat":0,"lon":0,"reason":""}]}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) { const t = await r.text(); res.status(502).json({ error: "upstream", message: t.slice(0, 300) }); return; }

    const data = await r.json();
    const text = (data.content || []).map((b) => b.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { suggestions: [] };
    const suggestions = (parsed.suggestions || []).filter((s) => s && s.name).slice(0, 8);
    res.status(200).json({ suggestions });
  } catch (e) {
    res.status(500).json({ error: "server", message: String(e && e.message || e).slice(0, 200) });
  }
}
