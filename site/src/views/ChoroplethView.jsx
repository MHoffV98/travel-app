// ChoroplethView.jsx — world map shaded by a toggleable metric.
import { useEffect, useMemo, useState } from "react";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import MapBase from "../MapBase.jsx";
import { byIso, makeScale, COLORS, COUNTRY_POINTS, METRICS, SHARE_MODE, fmt, countryForFeature, cleanGeo } from "../data.js";

export default function ChoroplethView({ onSelect }) {
  const [geo, setGeo] = useState(null);
  const [metric, setMetric] = useState("visits");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}countries.geojson`)
      .then((r) => r.json())
      .then((g) => setGeo(cleanGeo(g)))
      .catch(() => setGeo({ type: "FeatureCollection", features: [] }));
  }, []);

  const scale = useMemo(() => makeScale(metric), [metric]);

  const layers = useMemo(() => {
    if (!geo) return [];
    const fillFor = (f) => {
      const c = countryForFeature(f.properties);
      if (!c) return COLORS.notVisited;
      if (c.is_home) return COLORS.home; // home base — distinct, never "unvisited"
      if (c.status === "transit") return COLORS.transit;
      return scale(c) || COLORS.notVisited;
    };
    const polygons = new GeoJsonLayer({
      id: "countries",
      data: geo,
      pickable: true,
      stroked: true,
      filled: true,
      getFillColor: (f) => fillFor(f),
      getLineColor: COLORS.outline,
      getLineWidth: 1,
      lineWidthUnits: "pixels",
      onClick: (info) => { const c = countryForFeature(info.object.properties); if (c) onSelect(c.iso3); },
      updateTriggers: { getFillColor: [metric] },
    });

    // marker dots for visited countries with no polygon
    const markerData = Object.entries(COUNTRY_POINTS)
      .map(([iso, coord]) => ({ iso, coord, c: byIso[iso] }))
      .filter((d) => d.c && d.c.status === "visited");
    const markers = new ScatterplotLayer({
      id: "country-markers",
      data: markerData,
      pickable: true,
      getPosition: (d) => d.coord,
      getRadius: 7,
      radiusUnits: "pixels",
      radiusMinPixels: 6,
      getFillColor: (d) => scale(d.c) || [245, 158, 11],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 2,
      getLineColor: (d) => (d.c.layover_visit ? COLORS.layoverRing : [255, 255, 255]),
      onClick: (info) => info.object?.c && onSelect(info.object.c.iso3),
      updateTriggers: { getFillColor: [metric] },
    });

    // rings on layover countries that DO have polygons (none currently, but safe)
    return [polygons, markers];
  }, [geo, scale, metric]);

  const getTooltip = ({ object }) => {
    if (!object) return null;
    const c = object.properties ? countryForFeature(object.properties) : byIso[object.iso];
    if (!c || c.status === "transit") {
      if (c?.status === "transit") return { text: `${c.name} · transit only` };
      return null;
    }
    if (c.is_home) {
      return {
        html: `<b>${c.name}</b> · home base<br/>${c.home_nights ? fmt(c.home_nights) + " nights lived here" : "home"}`,
        style: { fontSize: "12px" },
      };
    }
    const first = SHARE_MODE ? (c.first_visit || "").slice(0, 7) : c.first_visit;
    const tag = c.layover_visit ? " (layover)" : c.been_only ? " (been)" : "";
    return {
      html: `<b>${c.name}${tag}</b><br/>${fmt(c.visit_count)} visit(s) · ${c.nights != null ? fmt(c.nights) + " nights" : "nights n/a"}<br/>first ${first || "–"}`,
      style: { fontSize: "12px" },
    };
  };

  return (
    <div className="view">
      <MapBase layers={layers} getTooltip={getTooltip} initialViewState={{ longitude: 10, latitude: 25, zoom: 1.4 }} />
      <div className="panel top-left">
        <div className="seg">
          {METRICS.map((m) => (
            <button key={m.key} className={metric === m.key ? "on" : ""} onClick={() => setMetric(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        <Legend metric={metric} />
      </div>
      <div className="panel bottom-hint small muted">Tap a country for details</div>
    </div>
  );
}

function Legend({ metric }) {
  const grad = "linear-gradient(90deg,#3a0d0d,#7a1f12,#d24a1a,#f59e0b,#ffd86b,#fff4d6)";
  const labels = { visits: "fewer → more", nights: "fewer → more", first: "earlier → recent", recency: "older → recent" };
  return (
    <div className="legend">
      <div className="bar" style={{ background: grad }} />
      <div className="legend-row"><span>{labels[metric]}</span></div>
      <div className="legend-keys">
        <span><i style={{ background: "rgb(86,196,174)" }} /> home base</span>
        <span><i style={{ background: "rgb(86,74,120)" }} /> transit only</span>
        <span><i style={{ background: "rgb(38,40,54)" }} /> not visited</span>
        <span><i className="ring" /> layover</span>
      </div>
    </div>
  );
}
