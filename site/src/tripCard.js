// tripCard.js — render a single trip (route map + stats + itinerary) to a PNG
// and share/download it. Reuses the canvas map + text helpers from yearCard.js.
// Pure canvas + same-origin geojson, so no taint (no external flag images drawn).
import { drawMap, wrapText, getGeo } from "./yearCard.js";
import { themeAccents } from "./data.js";

// p: { name, dateLabel, countriesText, legs, ground, inferred, points, fit,
//      stats: [[LABEL, value], …], lines: [string], filename }
export async function downloadTripCard(p) {
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
  x.fillText("✦ TRIP", 80, 116);

  // Title — shrink for long names, wrap to at most two lines.
  const titleSize = p.name.length > 30 ? 60 : p.name.length > 18 ? 76 : 92;
  x.fillStyle = "#fff"; x.font = `700 ${titleSize}px 'Space Grotesk', sans-serif`;
  let y = 130 + titleSize;
  y = wrapText(x, p.name, 80, y, W - 200, titleSize * 1.06);

  y += 14;
  x.fillStyle = "rgba(255,255,255,0.7)"; x.font = "400 34px Inter, sans-serif";
  x.fillText(p.dateLabel || "", 82, y); y += 46;
  if (p.countriesText) {
    x.fillStyle = "rgba(255,255,255,0.55)"; x.font = "400 27px Inter, sans-serif";
    y = wrapText(x, p.countriesText, 82, y, W - 200, 38);
  }

  // Route map — height shrinks a touch if the title took two lines.
  y += 26;
  const mapH = Math.min(380, Math.max(300, H - y - 720));
  drawMap(x, { x: 80, y, w: W - 160, h: mapH }, { legs: p.legs || [], ground: p.ground || [], inferred: p.inferred || [], points: p.points || [], fit: p.fit || [], geo, accent: A1 });
  y += mapH + 50;

  // Stats — two columns, as many rows as needed.
  const stats = (p.stats || []).slice(0, 4);
  const gap = 28, gw = (W - 160 - gap) / 2, gh = 150;
  stats.forEach((s, i) => {
    const bx = 80 + (i % 2) * (gw + gap), by = y + ((i / 2) | 0) * (gh + 24);
    x.beginPath(); x.roundRect(bx, by, gw, gh, 20); x.fillStyle = "rgba(255,255,255,0.05)"; x.fill();
    x.fillStyle = "#fff"; x.font = "700 70px 'Space Grotesk', sans-serif"; x.fillText(String(s[1]), bx + 30, by + 90);
    x.fillStyle = A1; x.font = "500 23px 'IBM Plex Mono', monospace"; x.fillText(s[0], bx + 32, by + 126);
  });
  y += Math.ceil(stats.length / 2) * (gh + 24) + 46;

  // Itinerary — as many leg lines as fit above the footer.
  const lines = p.lines || [];
  if (lines.length) {
    x.fillStyle = A1; x.font = "500 26px 'IBM Plex Mono', monospace"; x.fillText("ITINERARY", 80, y); y += 46;
    x.font = "400 30px Inter, sans-serif";
    const footerTop = H - 110;
    let shown = 0;
    for (const ln of lines) {
      if (y > footerTop - 44) break;
      x.fillStyle = "rgba(255,255,255,0.86)";
      y = wrapText(x, ln, 80, y, W - 160, 42) + 4; shown++;
    }
    if (shown < lines.length) {
      x.fillStyle = "rgba(255,255,255,0.5)"; x.font = "400 26px Inter, sans-serif";
      x.fillText(`+${lines.length - shown} more`, 80, y + 6);
    }
  }

  x.fillStyle = "rgba(255,255,255,0.5)"; x.font = "500 26px 'IBM Plex Mono', monospace";
  x.fillText("✈  my travel map", 80, H - 56);

  const fname = (p.filename || "trip") + ".png";
  await new Promise((resolve) => c.toBlob(async (blob) => {
    if (!blob) return resolve();
    const file = new File([blob], fname, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: p.name }); return resolve(); }
      catch (e) { if (e && e.name === "AbortError") return resolve(); }
    }
    const a = document.createElement("a"); const u = URL.createObjectURL(blob);
    a.href = u; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1000); resolve();
  }, "image/png"));
}
