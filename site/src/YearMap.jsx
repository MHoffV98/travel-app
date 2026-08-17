// YearMap.jsx — a small SVG map of one year's flights (routes + airports),
// auto-fitted to where you went that year. Used inside the Year in Review.
import { useEffect, useMemo, useState } from "react";
import { data, cleanGeo, themeAccents } from "./data.js";

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

export default function YearMap({ year }) {
  const geo = useGeo();
  const Y = String(year);
  const flights = useMemo(
    () => data.flights.filter((f) => f.status === "flown" && f.date.startsWith(Y) && Number.isFinite(f.from?.lat) && Number.isFinite(f.to?.lat)),
    [Y]
  );

  const { paths, legs, pts, vb } = useMemo(() => {
    if (!geo || !flights.length) return { paths: [], legs: [], pts: [], vb: null };
    const lons = [], lats = [];
    flights.forEach((f) => { lons.push(f.from.lon, f.to.lon); lats.push(f.from.lat, f.to.lat); });
    let minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const padX = (maxLon - minLon) * 0.12 + 4, padY = (maxLat - minLat) * 0.12 + 4;
    minLon -= padX; maxLon += padX; minLat -= padY; maxLat += padY;
    const midLat = (minLat + maxLat) / 2, kx = Math.cos((midLat * Math.PI) / 180);
    const lonSpan = (maxLon - minLon) * kx, latSpan = maxLat - minLat;
    const scale = Math.min(380 / lonSpan, 210 / latSpan);
    const W = lonSpan * scale, H = latSpan * scale;
    const proj = (lo, la) => [(lo - minLon) * kx * scale, (maxLat - la) * scale];
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
    // routes (skip Pacific antimeridian crossers — they'd draw the wrong way)
    const legs = flights.filter((f) => Math.abs(f.from.lon - f.to.lon) < 170).map((f) => ({ a: proj(f.from.lon, f.from.lat), b: proj(f.to.lon, f.to.lat) }));
    const apm = new Map();
    flights.forEach((f) => { for (const p of [f.from, f.to]) if (!apm.has(p.iata)) apm.set(p.iata, proj(p.lon, p.lat)); });
    return { paths, legs, pts: [...apm.values()], vb: `0 0 ${W.toFixed(0)} ${H.toFixed(0)}` };
  }, [geo, flights]);

  if (!geo) return <div className="yr-map loading">…</div>;
  if (!flights.length) return null;
  const acc = `rgb(${themeAccents().a1.join(",")})`;
  return (
    <svg className="yr-map" viewBox={vb} preserveAspectRatio="xMidYMid meet">
      {paths.map((d, i) => <path key={i} d={d} className="ym-land" />)}
      {legs.map((l, i) => <line key={i} x1={l.a[0]} y1={l.a[1]} x2={l.b[0]} y2={l.b[1]} stroke={acc} strokeWidth="0.7" strokeOpacity="0.5" />)}
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.2" fill={acc} />)}
    </svg>
  );
}
