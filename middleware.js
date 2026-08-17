// Vercel Edge Middleware — cookie-based password gate. Runs server-side before
// any page/asset is served, so an unauthenticated visitor never receives the
// data. Unlike HTTP Basic Auth (which iOS PWAs forget on every relaunch/deploy),
// the login here is remembered for a year via a persistent cookie — sign in once.
//
// Password comes from the SITE_PASSWORD env var if set, else the constant below
// (this source runs on the edge and is NOT shipped to the browser).
export const config = { matcher: "/:path*" };

const PASSWORD = process.env.SITE_PASSWORD || "wanderlust";
const COOKIE = "tm_auth";
// Opaque session marker stored in the cookie once the password checks out.
// Tied to the password so changing the password invalidates old sessions.
const TOKEN = "tmv1-" + PASSWORD.length + "-" + [...PASSWORD].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function parseCookies(header) {
  const out = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function loginPage(message) {
  const note = message ? `<p class="err">${message}</p>` : "";
  return new Response(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a12"><title>Travel Map</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:24px;
    background: radial-gradient(1100px circle at 80% -10%, rgba(245,158,11,0.18), transparent 60%), linear-gradient(160deg,#12121c,#08080f);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif; color:#f4f4f6; }
  .card { width:min(360px,100%); background:rgba(20,20,30,0.6); border:1px solid rgba(255,255,255,0.08);
    border-radius:18px; padding:30px 26px; backdrop-filter:blur(10px); box-shadow:0 24px 60px rgba(0,0,0,0.5); }
  .mark { font-size:13px; letter-spacing:0.12em; text-transform:uppercase; color:#f5a90b; font-weight:600; }
  h1 { font-size:26px; margin:8px 0 4px; }
  p.sub { margin:0 0 22px; color:rgba(255,255,255,0.55); font-size:14px; }
  form { display:flex; flex-direction:column; gap:12px; }
  input { width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:11px;
    padding:13px 14px; color:#fff; font-size:16px; }
  input:focus { outline:none; border-color:#f5a90b; background:rgba(255,255,255,0.09); }
  button { background:linear-gradient(135deg,#f5a90b,#f97316); border:none; color:#1a1206; font-weight:700; font-size:15px;
    padding:13px; border-radius:11px; cursor:pointer; }
  .err { color:#fca5a5; font-size:13px; margin:0 0 8px; }
</style></head><body>
  <div class="card">
    <div class="mark">✦ Travel Map</div>
    <h1>Welcome back</h1>
    <p class="sub">Enter the password to view the map.</p>
    ${note}
    <form method="POST" action="/__login">
      <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
      <button type="submit">Enter</button>
    </form>
  </div>
</body></html>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get("cookie"));
  if (cookies[COOKIE] === TOKEN) return undefined; // already signed in → continue

  if (request.method === "POST" && url.pathname === "/__login") {
    let pass = "";
    try { pass = (await request.formData()).get("password") || ""; } catch { /* ignore */ }
    if (pass === PASSWORD) {
      return new Response(null, {
        status: 303,
        headers: {
          "Location": "/",
          "Set-Cookie": `${COOKIE}=${TOKEN}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return loginPage("That password didn’t match — try again.");
  }

  return loginPage();
}
