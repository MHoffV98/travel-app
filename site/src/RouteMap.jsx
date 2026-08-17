// RouteMap.jsx — a generic auto-fitted SVG map of a set of legs + points.
// Used by the Trips index (and reusable elsewhere). Pass stable arrays.
import { useEffect, useMemo, useState } from "react";
import { cleanGeo, themeAccents, CAT } from "./data.js";

let GEO = null;
const subs = [];
function useGeo() {
  const [, force] = useState(0);
  useEffect(() => {
    if (GEO) return;
    const cb = () => force((n) => n + 1);
    subs.push(cb);
    if (subs.length === 1) {
      fetch(`${import.meta.env.BASE_URL}countries-50m.geojson`).then((r) => r.json())
        .then((g) => { GEO = cleanGeo(g); subs.forEach((f) => f()); })
        .catch(() => { GEO = { features: [] }; subs.forEach((f) => f()); });
    }
    return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); };
  }, []);
  return GEO;
}

export default function RouteMap({ legs = [], points = [], ground = [], inferred = [], fit = [] }) {
  const geo = useGeo();
  const { paths, segs, glegs, ilegs, pts, vb } = useMemo(() => {
    const fin = (c) => Number.isFinite(c[0]) && Number.isFinite(c[1]);
    // frame the map on `fit` (the ground stops) so home / long-haul airports fall
    // off the edge — their legs still draw, running off-screen. Fall back to points.
    const fitC = (fit.length ? fit : points).map((p) => [p.lon, p.lat]).filter(fin);
    if (!geo || !fitC.length) return { paths: [], segs: [], glegs: [], ilegs: [], pts: [], vb: null };
    let minLon = Math.min(...fitC.map((c) => c[0])), maxLon = Math.max(...fitC.map((c) => c[0]));
    let minLat = Math.min(...fitC.map((c) => c[1])), maxLat = Math.max(...fitC.map((c) => c[1]));
    const padX = (maxLon - minLon) * 0.15 + 5, padY = (maxLat - minLat) * 0.15 + 5;
    minLon -= padX; maxLon += padX; minLat -= padY; maxLat += padY;
    const midLat = (minLat + maxLat) / 2, kx = Math.cos((midLat * Math.PI) / 180);
    const lonSpan = (maxLon - minLon) * kx, latSpan = maxLat - minLat;
    const scale = Math.min(380 / lonSpan, 210 / latSpan);
    const W = lonSpan * scale, H = latSpan * scale;
    const proj = (lo, la) => [(lo - minLon) * kx * scale, (maxLat - la) * scale];
    // Draw a ring only if at least one of its vertices is inside the view. This
    // avoids antimeridian-spanning countries (Russia, USA, Fiji) — whose bbox
    // wraps the whole globe — being drawn on every regional map.
    const inView = (lo, la) => lo >= minLon && lo <= maxLon && la >= minLat && la <= maxLat;
    const paths = [];
    for (const fe of geo.features) {
      const polys = fe.geometry.type === "Polygon" ? [fe.geometry.coordinates] : fe.geometry.coordinates;
      for (const poly of polys) {
        const ring = poly[0];
        if (!ring.some(([lo, la]) => inView(lo, la))) continue;
        paths.push("M" + ring.map(([lo, la]) => proj(lo, la).map((n) => n.toFixed(1)).join(",")).join("L") + "Z");
      }
    }
    const projLeg = (l) => ({ a: proj(l.from.lon, l.from.lat), b: proj(l.to.lon, l.to.lat) });
    const ok = (l) => Number.isFinite(l.from.lon) && Number.isFinite(l.to.lon) && Math.abs(l.from.lon - l.to.lon) < 170;
    const segs = legs.filter(ok).map(projLeg);
    const glegs = ground.filter(ok).map((l) => ({ ...projLeg(l), color: CAT[l.cat]?.hex || "#9aa" }));
    const ilegs = inferred.filter(ok).map(projLeg);
    const pm = new Map();
    points.map((p) => [p.lon, p.lat]).filter(fin).forEach((c) => { const k = c[0].toFixed(2) + "," + c[1].toFixed(2); if (!pm.has(k)) pm.set(k, proj(c[0], c[1])); });
    return { paths, segs, glegs, ilegs, pts: [...pm.values()], vb: `0 0 ${W.toFixed(0)} ${H.toFixed(0)}` };
  }, [geo, legs, points, ground, inferred, fit]);

  if (!geo) return <div className="yr-map loading">…</div>;
  if (!vb) return null;
  const acc = `rgb(${themeAccents().a1.join(",")})`;
  return (
    <svg className="yr-map" viewBox={vb} preserveAspectRatio="xMidYMid meet">
      {paths.map((d, i) => <path key={i} d={d} className="ym-land" />)}
      {ilegs.map((l, i) => <line key={"i" + i} x1={l.a[0]} y1={l.a[1]} x2={l.b[0]} y2={l.b[1]} stroke={acc} strokeWidth="0.6" strokeOpacity="0.4" strokeDasharray="0.8 3" strokeLinecap="round" />)}
      {glegs.map((l, i) => <line key={"g" + i} x1={l.a[0]} y1={l.a[1]} x2={l.b[0]} y2={l.b[1]} stroke={l.color} strokeWidth="1.5" strokeOpacity="0.95" strokeDasharray="3 2.2" strokeLinecap="round" />)}
      {segs.map((l, i) => <line key={i} x1={l.a[0]} y1={l.a[1]} x2={l.b[0]} y2={l.b[1]} stroke={acc} strokeWidth="0.8" strokeOpacity="0.6" />)}
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.4" fill={acc} />)}
    </svg>
  );
}
