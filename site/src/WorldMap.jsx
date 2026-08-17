// WorldMap.jsx — a flat equirectangular overview of the whole world: visited
// countries shaded, the rest faint, with wishlist pins on top. The planning canvas.
import { useEffect, useMemo, useState } from "react";
import { cleanGeo, countryForFeature, themeAccents } from "./data.js";

let GEO = null;
const subs = [];
function useGeo() {
  const [, force] = useState(0);
  useEffect(() => {
    if (GEO) return;
    const cb = () => force((n) => n + 1);
    subs.push(cb);
    if (subs.length === 1) {
      fetch(`${import.meta.env.BASE_URL}countries.geojson`).then((r) => r.json())
        .then((g) => { GEO = cleanGeo(g); subs.forEach((f) => f()); })
        .catch(() => { GEO = { features: [] }; subs.forEach((f) => f()); });
    }
    return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); };
  }, []);
  return GEO;
}

const W = 720, H = 360;
const proj = (lo, la) => [((lo + 180) / 360) * W, ((90 - la) / 180) * H];

export default function WorldMap({ pins = [] }) {
  const geo = useGeo();
  const paths = useMemo(() => {
    if (!geo) return [];
    const out = [];
    for (const fe of geo.features) {
      const rec = countryForFeature(fe.properties);
      const visited = rec && rec.status === "visited";
      const polys = fe.geometry.type === "Polygon" ? [fe.geometry.coordinates] : fe.geometry.coordinates;
      for (const poly of polys) {
        out.push({ d: "M" + poly[0].map(([lo, la]) => proj(lo, la).map((n) => n.toFixed(1)).join(",")).join("L") + "Z", visited });
      }
    }
    return out;
  }, [geo]);

  if (!geo) return <div className="world loading">…</div>;
  const acc = `rgb(${themeAccents().a1.join(",")})`;
  return (
    <svg className="world" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {paths.map((p, i) => <path key={i} d={p.d} className={p.visited ? "w-on" : "w-off"} />)}
      {pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p, i) => {
        const [x, y] = proj(p.lon, p.lat);
        return <circle key={i} cx={x} cy={y} r="3.4" fill={acc} stroke="#fff" strokeWidth="1"><title>{p.name}</title></circle>;
      })}
    </svg>
  );
}
