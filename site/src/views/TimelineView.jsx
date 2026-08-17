// TimelineView.jsx — interactive 1998→2026 journey. Opens on "born in England",
// draws flights (air) + manual trips (cruise/train/road) chronologically, with a
// scrubber, play button, home-base era bands, and travel-style filters.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArcLayer, ScatterplotLayer, LineLayer, TextLayer, GeoJsonLayer } from "@deck.gl/layers";
import MapBase from "../MapBase.jsx";
import { data, byIso, COUNTRY_POINTS, CAT, transportCats, homeOn, SHARE_MODE, countryForFeature, cleanGeo, themeAccents, TRIPS } from "../data.js";

const START = Date.parse(data.config.birth?.date || "1998-07-20"); // born — nothing before this
const _b = data.meta.built.split("-").map(Number);
const END = new Date(_b[0], _b[1], 0).getTime(); // last day of the current (build) month
const SPAN = END - START;
const DAY = 86400000;
const fracToDate = (f) => new Date(START + f * SPAN);
const iso = (d) => d.toISOString().slice(0, 10);

// flown flight dates (sorted) — used to avoid drawing a surface "leg" across a
// stretch where flights actually happened.
const FLOWN_DATES = data.flights.filter((f) => f.status !== "booked" && f.status !== "cancelled").map((f) => f.date).sort();
const flightBetween = (d1, d2) => FLOWN_DATES.some((d) => d > d1 && d < d2);

const ERA_COLOR = { "United Kingdom": "#6366f1", Australia: "#ef4444", Travelling: "#3a3a4a" };

// A country counts as "reached" from its first visit — or, for a home base, from
// the start of that residence, so a place you LIVED lights up during that era and
// not only when you later returned as a visitor (e.g. Australia 2022–2024).
const NAME_TO_ISO = {};
for (const c of data.countries) NAME_TO_ISO[c.name] = c.iso3;
const HOME_START_BY_ISO = (() => {
  const m = {};
  for (const e of data.config.home_bases || []) {
    const i = NAME_TO_ISO[e.country];
    if (i && (!m[i] || e.start < m[i])) m[i] = e.start;
  }
  return m;
})();
const reachedDate = (c) => {
  if (!c || c.status !== "visited") return null;
  const hs = HOME_START_BY_ISO[c.iso3], fv = c.first_visit;
  return hs && (!fv || hs < fv) ? hs : (fv || null);
};

export default function TimelineView({ theme }) {
  const [geo, setGeo] = useState(null);
  const [frac, setFrac] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cats, setCats] = useState({ air: true, rail: true, sea: true, road: true, foot: true });
  const raf = useRef();

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}countries.geojson`).then((r) => r.json()).then((g) => setGeo(cleanGeo(g))).catch(() => setGeo({ features: [] }));
  }, []);

  // play loop: full timeline in ~45s
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now;
      setFrac((f) => {
        const nf = f + (dt * speed) / 60; // ~60s at 1× (slower base); speed scales it
        if (nf >= 1) { setPlaying(false); return 1; }
        return nf;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed]);

  // centroids by ISO3 from Natural Earth label points (+ territory fallback)
  const pointFor = useMemo(() => {
    const m = { ...COUNTRY_POINTS };
    for (const f of geo?.features || []) {
      const p = f.properties;
      if (p.LABEL_X != null && p.LABEL_Y != null) m[p.ADM0_A3] ||= [p.LABEL_X, p.LABEL_Y];
    }
    return m;
  }, [geo]);

  // overland legs + inferred (unlogged) flights — taken straight from the derived
  // trips so the Journey matches the trip maps exactly (consistent everywhere).
  const { segments, inferredSegs } = useMemo(() => {
    const segs = [], inf = [];
    for (const t of TRIPS) {
      for (const g of t.mapGround) if (g.date) segs.push({ from: [g.from.lon, g.from.lat], to: [g.to.lon, g.to.lat], cat: g.cat, date: g.date });
      for (const g of t.mapInferred) if (g.date) inf.push({ from: [g.from.lon, g.from.lat], to: [g.to.lon, g.to.lat], date: g.date });
    }
    return { segments: segs, inferredSegs: inf };
  }, []);

  const cutoff = iso(fracToDate(frac));
  const cutoffMs = Date.parse(cutoff);
  const based = homeOn(cutoff);
  const flownSoFar = data.flights.filter((f) => f.status === "flown" && f.date <= cutoff && Number.isFinite(f.from?.lat) && Number.isFinite(f.to?.lat));
  const countriesSoFar = data.countries.filter((c) => { const rd = reachedDate(c); return rd && rd <= cutoff; }).length;
  const beforeFirst = frac < 0.001 || cutoff < "1999-08-01";

  const layers = useMemo(() => {
    const { a1, a2 } = themeAccents();
    const recency = (d) => Math.max(0, 1 - (cutoffMs - Date.parse(d)) / (180 * DAY)); // 0..1, fades over ~6mo
    const fresh = (d) => cutoffMs - Date.parse(d) < 60 * DAY; // just-reached "flash"
    const ls = [];

    // 1) countries fill in (translucent) the moment they're first reached
    if (geo) {
      const reached = (props) => {
        const rd = reachedDate(countryForFeature(props));
        return rd && rd <= cutoff ? rd : null;
      };
      ls.push(new GeoJsonLayer({
        id: "tl-fill", data: geo, stroked: true, filled: true, pickable: false,
        getFillColor: (f) => {
          const rd = reached(f.properties);
          if (!rd) return [0, 0, 0, 0];
          return [...a1, fresh(rd) ? 150 : 48];
        },
        getLineColor: (f) => {
          const rd = reached(f.properties);
          if (!rd) return [0, 0, 0, 0];
          return [...a1, fresh(rd) ? 235 : 95];
        },
        getLineWidth: 1, lineWidthUnits: "pixels",
        updateTriggers: { getFillColor: [cutoff], getLineColor: [cutoff] },
      }));
    }

    if (cats.air) {
      const arcs = flownSoFar;
      // soft glow underlay
      ls.push(new ArcLayer({
        id: "tl-arc-glow", data: arcs, greatCircle: true,
        getSourcePosition: (f) => [f.from.lon, f.from.lat],
        getTargetPosition: (f) => [f.to.lon, f.to.lat],
        getSourceColor: (f) => [...a1, 18 + 45 * recency(f.date)],
        getTargetColor: (f) => [...a2, 18 + 45 * recency(f.date)],
        getWidth: (f) => 2.5 + 6 * recency(f.date), widthUnits: "pixels",
        updateTriggers: { getSourceColor: [cutoff], getTargetColor: [cutoff], getWidth: [cutoff] },
      }));
      ls.push(new ArcLayer({
        id: "tl-arcs", data: arcs, pickable: true, greatCircle: true,
        getSourcePosition: (f) => [f.from.lon, f.from.lat],
        getTargetPosition: (f) => [f.to.lon, f.to.lat],
        getSourceColor: (f) => [...a1, 70 + 150 * recency(f.date)],
        getTargetColor: (f) => [...a2, 95 + 150 * recency(f.date)],
        getWidth: (f) => 0.8 + 1.8 * recency(f.date),
        widthUnits: "pixels",
        updateTriggers: { getSourceColor: [cutoff], getTargetColor: [cutoff], getWidth: [cutoff] },
      }));
    }

    // inferred (unlogged) flights — faint, behind the logged arcs
    if (cats.air) {
      const infShown = inferredSegs.filter((s) => s.date <= cutoff);
      ls.push(new ArcLayer({
        id: "tl-inferred", data: infShown, greatCircle: true,
        getSourcePosition: (s) => s.from, getTargetPosition: (s) => s.to,
        getSourceColor: [...a1, 38], getTargetColor: [...a1, 38], getWidth: 1, widthUnits: "pixels",
        updateTriggers: { data: [cutoff] },
      }));
    }

    // manual journey segments (cruise/train/road)
    const segShown = segments.filter((s) => s.date <= cutoff && cats[s.cat]);
    ls.push(new LineLayer({
      id: "tl-segs", data: segShown, pickable: false,
      getSourcePosition: (s) => s.from, getTargetPosition: (s) => s.to,
      getColor: (s) => [...CAT[s.cat].color, 200], getWidth: 2, widthUnits: "pixels",
      updateTriggers: { data: [cutoff, cats] },
    }));

    // (individual city/town dots intentionally omitted — cities live in the
    // country cards; the Journey shows country fills, arcs and journey routes.)

    // lit dots for reached countries that have no polygon (islands/territories)
    const terr = Object.entries(COUNTRY_POINTS)
      .map(([iso, pt]) => ({ iso, pt, c: byIso[iso] }))
      .filter((d) => d.c && d.c.status === "visited" && d.c.first_visit && d.c.first_visit <= cutoff);
    ls.push(new ScatterplotLayer({
      id: "tl-terr", data: terr,
      getPosition: (d) => d.pt,
      getRadius: (d) => (fresh(d.c.first_visit) ? 9 : 6), radiusUnits: "pixels", radiusMinPixels: 5,
      getFillColor: (d) => [...a1, fresh(d.c.first_visit) ? 230 : 160],
      stroked: true, getLineColor: [...a1, 220], lineWidthUnits: "pixels", getLineWidth: 1.4,
      updateTriggers: { getRadius: [cutoff], getFillColor: [cutoff], data: [cutoff] },
    }));

    // home-city markers — where the owner was based, current one larger + labelled
    const isCurrentHome = (e) => e.start <= cutoff && (e.end == null || cutoff < e.end);
    const homesShown = (data.config.home_bases || []).filter((e) => e.city && e.start <= cutoff);
    ls.push(new ScatterplotLayer({
      id: "tl-homes", data: homesShown, pickable: true,
      getPosition: (e) => [e.lon, e.lat],
      getRadius: (e) => (isCurrentHome(e) ? 6 : 3.5), radiusUnits: "pixels", radiusMinPixels: 3,
      getFillColor: (e) => (isCurrentHome(e) ? [150, 160, 255, 240] : [120, 130, 200, 110]),
      stroked: true, getLineColor: [255, 255, 255, 220], lineWidthUnits: "pixels", getLineWidth: 1.4,
      updateTriggers: { getRadius: [cutoff], getFillColor: [cutoff], data: [cutoff] },
    }));
    const curHome = homesShown.filter(isCurrentHome)[0];
    if (curHome && !beforeFirst) {
      ls.push(new TextLayer({
        id: "tl-homelabel", data: [curHome], getPosition: (e) => [e.lon, e.lat],
        getText: (e) => "⌂ " + e.city, getSize: 12, getColor: [190, 200, 255, 235],
        getPixelOffset: [0, -13], getTextAnchor: "middle", fontFamily: "-apple-system, Segoe UI, sans-serif",
      }));
    }

    // birth / home marker in England
    ls.push(new ScatterplotLayer({
      id: "tl-birth", data: [{ pt: [data.config.birth.lon, data.config.birth.lat] }],
      getPosition: (d) => d.pt, getRadius: beforeFirst ? 10 : 4, radiusUnits: "pixels",
      getFillColor: beforeFirst ? [255, 255, 255, 240] : [255, 255, 255, 120],
      stroked: true, getLineColor: [99, 102, 241, 255], getLineWidth: 2, lineWidthUnits: "pixels",
      updateTriggers: { getRadius: [beforeFirst], getFillColor: [beforeFirst] },
    }));
    if (beforeFirst) {
      ls.push(new TextLayer({
        id: "tl-birthtext", data: [{ pt: [data.config.birth.lon, data.config.birth.lat] }],
        getPosition: (d) => d.pt, getText: () => "Born in England, 1998",
        getSize: 15, getColor: [255, 255, 255, 240], getPixelOffset: [0, -18],
        fontFamily: "-apple-system, Segoe UI, sans-serif", getTextAnchor: "middle",
      }));
    }
    return ls;
  }, [geo, flownSoFar, segments, inferredSegs, cutoff, cutoffMs, cats, beforeFirst, theme]);

  const getTooltip = ({ object }) => {
    if (!object) return null;
    if (object.from && object.to && object.from.iata) {
      const f = object;
      return { html: `<b>${f.from.iata} → ${f.to.iata}</b><br/>${SHARE_MODE ? f.date.slice(0, 7) : f.date} · ${f.airline || ""} ${f.flight_number || ""}`, style: { fontSize: "12px" } };
    }
    if (object.city && object.start) return { text: `Home: ${object.city} (${object.start.slice(0, 4)}–${object.end ? object.end.slice(0, 4) : "now"})` };
    if (object.name) return { html: `<b>${object.name}</b><br/>${object.notes || ""}`, style: { fontSize: "12px" } };
    return null;
  };

  const eras = data.config.home_bases;

  return (
    <div className="view">
      <MapBase layers={layers} getTooltip={getTooltip} mapStyle="clean" initialViewState={{ longitude: 5, latitude: 35, zoom: 1.5 }} />

      {/* top-left status */}
      <div className="panel top-left">
        <div className="tl-date">{fracToDate(frac).toLocaleDateString(undefined, { year: "numeric", month: "short" })}</div>
        <div className="muted small">Based in <b style={{ color: ERA_COLOR[based.country] || "#fff" }}>{based.city || based.country}</b></div>
        <div className="muted small">{countriesSoFar} {countriesSoFar === 1 ? "country" : "countries"} · {flownSoFar.length} {flownSoFar.length === 1 ? "flight" : "flights"} so far</div>
      </div>

      {/* travel-style filters */}
      <div className="panel top-right">
        <div className="small muted" style={{ marginBottom: 6 }}>Travel style</div>
        <div className="cats">
          {Object.entries(CAT).map(([k, v]) => (
            <button key={k} className={`cat ${cats[k] ? "on" : ""}`} onClick={() => setCats((c) => ({ ...c, [k]: !c[k] }))}>
              <i style={{ background: v.hex }} /> {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* bottom timeline scrubber */}
      <div className="timeline">
        <button className="play" onClick={() => { if (frac >= 1) setFrac(0); setPlaying((p) => !p); }}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="tl-speed">
          {[0.5, 1, 2].map((s) => (
            <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
        <div className="track">
          <div className="bands">
            {eras.map((e, i) => {
              const s = Math.max(0, (Date.parse(e.start) - START) / SPAN);
              const en = ((e.end ? Date.parse(e.end) : END) - START) / SPAN;
              return <div key={i} className="band" title={e.country} style={{ left: `${s * 100}%`, width: `${(en - s) * 100}%`, background: ERA_COLOR[e.country] }} />;
            })}
          </div>
          <input className="scrub" type="range" min="0" max="1000" value={Math.round(frac * 1000)}
            onChange={(e) => { setPlaying(false); setFrac(+e.target.value / 1000); }} />
          <div className="ticks">
            {[1998, 2004, 2010, 2016, 2022, 2026].map((y) => (
              <span key={y} style={{ left: `${((Date.parse(y + "-01-01") - START) / SPAN) * 100}%` }}>{y}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
