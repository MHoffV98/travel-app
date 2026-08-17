// MiniMap.jsx — a small SVG map of one country with the towns/airports visited
// plotted. Uses the same Natural Earth polygons; no extra map engine.
import { useEffect, useMemo, useState } from "react";
import { data, cleanGeo, transportCat, CAT } from "./data.js";

let GEO = null;
const subscribers = [];

function useGeo() {
  const [, force] = useState(0);
  useEffect(() => {
    if (GEO) return;
    const cb = () => force((n) => n + 1);
    subscribers.push(cb);
    if (subscribers.length === 1) {
      fetch(`${import.meta.env.BASE_URL}countries-50m.geojson`)
        .then((r) => r.json())
        .then((g) => { GEO = cleanGeo(g); subscribers.forEach((f) => f()); })
        .catch(() => { GEO = { features: [] }; subscribers.forEach((f) => f()); });
    }
    return () => { const i = subscribers.indexOf(cb); if (i >= 0) subscribers.splice(i, 1); };
  }, []);
  return GEO;
}

export default function MiniMap({ iso, highlight }) {
  const geo = useGeo();

  const places = useMemo(() => {
    const m = new Map();
    const add = (lat, lon, name, cat) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      if (!m.has(k)) m.set(k, { lat, lon, name, cat });
    };
    for (const f of data.flights) {
      if (f.status === "cancelled") continue;
      if (f.from?.country === iso) add(f.from.lat, f.from.lon, f.from.city || f.from.iata, "air");
      if (f.to?.country === iso) add(f.to.lat, f.to.lon, f.to.city || f.to.iata, "air");
    }
    for (const v of data.visits) if (v.country === iso && v.lat != null) add(v.lat, v.lon, v.place || v.country_name, transportCat((v.transport || "").split(/[+/]/)[0]));
    return [...m.values()];
  }, [iso]);

  const feature = useMemo(() => (geo?.features || []).find((f) => f.properties.ADM0_A3 === iso), [geo, iso]);

  const { paths, pts, vb } = useMemo(() => {
    if (!geo || !places.length) return { paths: [], pts: [], vb: null };
    // focus on where you went: only keep country rings near the visited places
    // (so far-flung overseas territories — Réunion, Guadeloupe — don't blow up the frame)
    const reach = 14;
    const nlo0 = Math.min(...places.map((p) => p.lon)) - reach, nlo1 = Math.max(...places.map((p) => p.lon)) + reach;
    const nla0 = Math.min(...places.map((p) => p.lat)) - reach, nla1 = Math.max(...places.map((p) => p.lat)) + reach;
    const near = (lo, la) => lo >= nlo0 && lo <= nlo1 && la >= nla0 && la <= nla1;
    // gather coords for bbox
    const lons = [], lats = [];
    const rings = [];
    if (feature) {
      const polys = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const poly of polys) {
        if (!poly[0].some(([lo, la]) => near(lo, la))) continue;
        rings.push(poly[0]);
        for (const [lo, la] of poly[0]) { lons.push(lo); lats.push(la); }
      }
    }
    for (const p of places) { lons.push(p.lon); lats.push(p.lat); }
    if (!lons.length) return { paths: [], pts: [], vb: null };
    let minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
    // pad
    const padX = (maxLon - minLon) * 0.08 + 0.3, padY = (maxLat - minLat) * 0.08 + 0.3;
    minLon -= padX; maxLon += padX; minLat -= padY; maxLat += padY;
    const midLat = (minLat + maxLat) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const lonSpan = (maxLon - minLon) * kx, latSpan = maxLat - minLat;
    const scale = Math.min(300 / lonSpan, 220 / latSpan);
    const W = lonSpan * scale, H = latSpan * scale;
    const proj = (lo, la) => [((lo - minLon) * kx) * scale, (maxLat - la) * scale];
    const paths = rings.map((ring) => "M" + ring.map(([lo, la]) => proj(lo, la).map((n) => n.toFixed(1)).join(",")).join("L") + "Z");
    const pts = places.map((p) => ({ ...p, xy: proj(p.lon, p.lat) }));
    return { paths, pts, vb: `0 0 ${W.toFixed(0)} ${H.toFixed(0)}` };
  }, [geo, feature, places]);

  if (!geo) return <div className="minimap loading">…</div>;
  if (!pts.length) return null;

  return (
    <svg className="minimap" viewBox={vb} preserveAspectRatio="xMidYMid meet">
      {paths.map((d, i) => <path key={i} d={d} className="mm-land" />)}
      {pts.map((p, i) => {
        const on = !highlight || highlight.has(p.name);
        const color = CAT[p.cat]?.hex || "#f59e0b";
        return (
          <g key={i} className="mm-pt" style={{ opacity: on ? 1 : 0.25 }}>
            <circle cx={p.xy[0]} cy={p.xy[1]} r={on && highlight ? 4.6 : 3.2}
              style={{ fill: color, stroke: on && highlight ? "#fff" : "rgba(255,255,255,0.7)", strokeWidth: on && highlight ? 1.2 : 0.6 }} />
            <text x={p.xy[0] + 5} y={p.xy[1] + 3}>{p.name}</text>
          </g>
        );
      })}
    </svg>
  );
}
