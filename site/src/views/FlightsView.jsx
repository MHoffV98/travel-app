// FlightsView.jsx — great-circle arcs for every flown flight (+ booked next trip).
import { useEffect, useMemo, useState } from "react";
import { ArcLayer, ScatterplotLayer, GeoJsonLayer } from "@deck.gl/layers";
import MapBase from "../MapBase.jsx";
import { data, SHARE_MODE, fmt, themeAccents, cleanGeo } from "../data.js";

const hasGeo = (f) => Number.isFinite(f.from?.lat) && Number.isFinite(f.to?.lat);

export default function FlightsView({ theme }) {
  const [showBooked, setShowBooked] = useState(true);
  const [geo, setGeo] = useState(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}countries.geojson`).then((r) => r.json()).then((g) => setGeo(cleanGeo(g))).catch(() => setGeo({ type: "FeatureCollection", features: [] }));
  }, []);

  const { arcs, booked, airports, routeMax } = useMemo(() => {
    const flown = data.flights.filter((f) => f.status === "flown" && hasGeo(f));
    const booked = data.flights.filter((f) => f.status === "booked" && hasGeo(f));
    const routeCount = {};
    for (const f of flown) {
      const k = [f.from.iata, f.to.iata].sort().join("-");
      routeCount[k] = (routeCount[k] || 0) + 1;
    }
    const routeMax = Math.max(1, ...Object.values(routeCount));
    const arcs = flown.map((f) => ({ ...f, freq: routeCount[[f.from.iata, f.to.iata].sort().join("-")] }));
    // airport dots sized by traffic
    const apCount = {};
    for (const f of flown) { apCount[f.from.iata] = (apCount[f.from.iata] || { n: 0 }); apCount[f.from.iata].n++; apCount[f.from.iata].p = [f.from.lon, f.from.lat]; apCount[f.from.iata].iata = f.from.iata; apCount[f.from.iata].city = f.from.city; apCount[f.to.iata] = (apCount[f.to.iata] || { n: 0 }); apCount[f.to.iata].n++; apCount[f.to.iata].p = [f.to.lon, f.to.lat]; apCount[f.to.iata].iata = f.to.iata; apCount[f.to.iata].city = f.to.city; }
    return { arcs, booked, airports: Object.values(apCount), routeMax };
  }, []);

  const layers = useMemo(() => {
    const { a1, a2 } = themeAccents();
    const base = geo && new GeoJsonLayer({
      id: "world", data: geo, stroked: true, filled: true, pickable: false,
      getFillColor: [28, 30, 42, 170], getLineColor: [80, 84, 110, 110], getLineWidth: 1, lineWidthUnits: "pixels",
    });
    const arcLayer = new ArcLayer({
      id: "flights",
      data: arcs,
      pickable: true,
      greatCircle: true,
      getSourcePosition: (f) => [f.from.lon, f.from.lat],
      getTargetPosition: (f) => [f.to.lon, f.to.lat],
      getSourceColor: [...a1, 150],
      getTargetColor: [...a2, 210],
      getWidth: (f) => 0.6 + 2.6 * Math.sqrt(f.freq / routeMax),
      widthUnits: "pixels",
    });
    const airportLayer = new ScatterplotLayer({
      id: "airports",
      data: airports,
      pickable: true,
      getPosition: (d) => d.p,
      getRadius: (d) => 1 + Math.sqrt(d.n),
      radiusUnits: "pixels",
      radiusMinPixels: 1.5,
      getFillColor: [255, 220, 150, 180],
    });
    const out = [base, airportLayer, arcLayer].filter(Boolean);
    if (showBooked && booked.length) {
      out.push(new ArcLayer({
        id: "booked",
        data: booked,
        pickable: true,
        greatCircle: true,
        getSourcePosition: (f) => [f.from.lon, f.from.lat],
        getTargetPosition: (f) => [f.to.lon, f.to.lat],
        getSourceColor: [120, 220, 255, 180],
        getTargetColor: [120, 220, 255, 220],
        getWidth: 2,
        getHeight: 1.4,
      }));
    }
    return out;
  }, [arcs, airports, booked, routeMax, showBooked, theme, geo]);

  const getTooltip = ({ object }) => {
    if (!object) return null;
    if (object.iata && object.p) return { text: `${object.iata}${object.city ? " · " + object.city : ""} · ${object.n} flights` };
    const f = object;
    if (!f.from) return null;
    const date = SHARE_MODE ? (f.date || "").slice(0, 7) : f.date;
    const dur = f.duration_min ? `${Math.floor(f.duration_min / 60)}h${String(f.duration_min % 60).padStart(2, "0")}` : "";
    const freqLine = f.freq > 1 ? `<br/><b>${f.from.iata}–${f.to.iata} flown ${f.freq}×</b> <span style="opacity:.6">(most recent shown)</span>` : "";
    return {
      html: `<b>${f.from.iata} → ${f.to.iata}</b> ${f.status === "booked" ? "· booked" : ""}${freqLine}<br/>${date} · ${f.airline || ""} ${f.flight_number || ""}<br/>${fmt(f.distance_km)} km ${dur ? "· " + dur : ""}${f.aircraft ? "<br/>" + f.aircraft : ""}`,
      style: { fontSize: "12px" },
    };
  };

  return (
    <div className="view">
      <MapBase layers={layers} getTooltip={getTooltip} initialViewState={{ longitude: 30, latitude: 20, zoom: 1.3 }} />
      <div className="panel top-left">
        <div className="muted small">{arcs.length} flights · {airports.length} airports</div>
        {booked.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={showBooked} onChange={(e) => setShowBooked(e.target.checked)} />
            show next trip
          </label>
        )}
      </div>
    </div>
  );
}
