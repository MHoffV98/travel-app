// yearCard.js — render a "Year in Review" recap (now with the route map) to a
// PNG and share/download it. Pure canvas + same-origin geojson, so no taint.
import { themeAccents, cleanGeo, CAT } from "./data.js";

let GEO = null;
export async function getGeo() {
  if (GEO) return GEO;
  try {
    const g = await fetch(`${import.meta.env.BASE_URL}countries-50m.geojson`).then((r) => r.json());
    GEO = cleanGeo(g);
  } catch { GEO = { features: [] }; }
  return GEO;
}

export function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(" ");
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; }
    else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lh; }
  return y;
}

// Draw the year's routes + overland legs + points into rect R.
export function drawMap(ctx, R, { legs, ground, inferred, points, fit, geo, accent }) {
  const fin = (c) => Number.isFinite(c[0]) && Number.isFinite(c[1]);
  const fitC = (fit && fit.length ? fit : points).map((p) => [p.lon, p.lat]).filter(fin);

  ctx.save();
  ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, 24); ctx.clip(); // also clips off-screen legs
  ctx.fillStyle = "rgba(255,255,255,0.035)"; ctx.fillRect(R.x, R.y, R.w, R.h);
  if (!fitC.length || !geo.features.length) { ctx.restore(); return; }

  let minLon = Math.min(...fitC.map((c) => c[0])), maxLon = Math.max(...fitC.map((c) => c[0]));
  let minLat = Math.min(...fitC.map((c) => c[1])), maxLat = Math.max(...fitC.map((c) => c[1]));
  const padX = (maxLon - minLon) * 0.18 + 5, padY = (maxLat - minLat) * 0.18 + 5;
  minLon -= padX; maxLon += padX; minLat -= padY; maxLat += padY;
  const midLat = (minLat + maxLat) / 2, kx = Math.cos((midLat * Math.PI) / 180);
  const gw = (maxLon - minLon) * kx, gh = maxLat - minLat;
  const sc = Math.min(R.w / gw, R.h / gh);
  const ox = R.x + (R.w - gw * sc) / 2, oy = R.y + (R.h - gh * sc) / 2;
  const proj = (lo, la) => [ox + (lo - minLon) * kx * sc, oy + (maxLat - la) * sc];
  const inView = (lo, la) => lo >= minLon && lo <= maxLon && la >= minLat && la <= maxLat;

  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.lineWidth = 0.6;
  for (const fe of geo.features) {
    const polys = fe.geometry.type === "Polygon" ? [fe.geometry.coordinates] : fe.geometry.coordinates;
    for (const poly of polys) {
      const ring = poly[0];
      if (!ring.some(([lo, la]) => inView(lo, la))) continue;
      ctx.beginPath();
      ring.forEach(([lo, la], i) => { const [x, y] = proj(lo, la); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  const okLeg = (l) => Number.isFinite(l.from.lon) && Number.isFinite(l.to.lon) && Math.abs(l.from.lon - l.to.lon) < 170;
  // inferred (unlogged) flights — faint dotted, behind everything
  ctx.setLineDash([1.5, 6]); ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = accent; ctx.globalAlpha = 0.4;
  for (const l of inferred.filter(okLeg)) {
    const a = proj(l.from.lon, l.from.lat), b = proj(l.to.lon, l.to.lat);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([7, 5]); ctx.lineWidth = 3; ctx.lineCap = "round";
  for (const l of ground.filter(okLeg)) {
    ctx.strokeStyle = CAT[l.cat]?.hex || "#9aa";
    const a = proj(l.from.lon, l.from.lat), b = proj(l.to.lon, l.to.lat);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.setLineDash([]); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
  for (const l of legs.filter(okLeg)) {
    const a = proj(l.from.lon, l.from.lat), b = proj(l.to.lon, l.to.lat);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.fillStyle = accent;
  const seen = new Set();
  for (const c of points.map((p) => [p.lon, p.lat]).filter(fin)) {
    const k = c[0].toFixed(1) + "," + c[1].toFixed(1); if (seen.has(k)) continue; seen.add(k);
    const [x, y] = proj(c[0], c[1]); ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, 24); ctx.stroke();
}

export async function downloadYearCard(p) {
  try { await document.fonts.ready; } catch { /* ignore */ }
  const geo = await getGeo();
  const W = 1080, H = 1500;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  const { a1, a2 } = themeAccents();
  const A1 = `rgb(${a1.join(",")})`;

  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#12121c"); bg.addColorStop(1, "#08080f");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const rg = x.createRadialGradient(W * 0.82, -120, 60, W * 0.82, -120, 1000);
  rg.addColorStop(0, `rgba(${a2.join(",")},0.28)`); rg.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = rg; x.fillRect(0, 0, W, H);

  x.textBaseline = "alphabetic";
  x.fillStyle = A1; x.font = "600 30px 'IBM Plex Mono', monospace";
  x.fillText("✦ YEAR IN REVIEW", 80, 120);
  x.fillStyle = "#fff"; x.font = "700 210px 'Space Grotesk', sans-serif";
  x.fillText(String(p.year), 72, 330);
  x.fillStyle = "rgba(255,255,255,0.7)"; x.font = "400 36px Inter, sans-serif";
  x.fillText(`Based in ${p.based}`, 84, 388);

  drawMap(x, { x: 80, y: 420, w: W - 160, h: 360 }, { legs: p.legs || [], ground: p.ground || [], inferred: p.inferred || [], points: p.points || [], fit: p.fit || [], geo, accent: A1 });

  const stats = [["FLIGHTS", p.flights], ["KM FLOWN", p.distance], ["HOURS AIRBORNE", p.hours], ["COUNTRIES", p.countries]];
  const gx = 80, gy = 820, gap = 28, gw = (W - 160 - gap) / 2, gh = 168;
  stats.forEach((s, i) => {
    const bx = gx + (i % 2) * (gw + gap), by = gy + ((i / 2) | 0) * (gh + 24);
    x.beginPath(); x.roundRect(bx, by, gw, gh, 20); x.fillStyle = "rgba(255,255,255,0.05)"; x.fill();
    x.fillStyle = "#fff"; x.font = "700 76px 'Space Grotesk', sans-serif"; x.fillText(String(s[1]), bx + 30, by + 96);
    x.fillStyle = A1; x.font = "500 24px 'IBM Plex Mono', monospace"; x.fillText(s[0], bx + 32, by + 134);
  });
  let y = gy + 2 * gh + 24 + 70;

  if (p.highlights.length) {
    x.fillStyle = A1; x.font = "500 26px 'IBM Plex Mono', monospace"; x.fillText("HIGHLIGHTS", 80, y); y += 48;
    x.fillStyle = "rgba(255,255,255,0.86)"; x.font = "400 31px Inter, sans-serif";
    for (const h of p.highlights) { y = wrapText(x, "· " + h, 80, y, W - 160, 44) + 6; }
  }

  x.fillStyle = "rgba(255,255,255,0.5)"; x.font = "500 26px 'IBM Plex Mono', monospace";
  x.fillText("✈  my travel map", 80, H - 60);

  await new Promise((resolve) => c.toBlob(async (blob) => {
    if (!blob) return resolve();
    const file = new File([blob], `travel-${p.year}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `My ${p.year} in travel` }); return resolve(); }
      catch (e) { if (e && e.name === "AbortError") return resolve(); }
    }
    const a = document.createElement("a"); const u = URL.createObjectURL(blob);
    a.href = u; a.download = `travel-${p.year}.png`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1000); resolve();
  }, "image/png"));
}
