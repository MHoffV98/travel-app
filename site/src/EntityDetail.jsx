// EntityDetail.jsx — drill-down modal for a single stat entity (airline,
// airport, aircraft type or route). Opened from the top-lists in StatsView.
// All breakdowns are aggregated client-side from data.flights, filtered to the
// clicked entity. Rows are themselves clickable, so you can pivot from an
// airline → a route it flies → the aircraft used on it, with a back stack.
import { useState } from "react";
import { data, fmt } from "./data.js";
import RouteMap from "./RouteMap.jsx";

const DASH = "–"; // en-dash, matches how stats.top_routes keys are built
const routeKey = (f) => [f.from?.iata, f.to?.iata].filter(Boolean).sort().join(DASH);
const flown = data.flights.filter((f) => f.status === "flown");

const KIND_LABEL = { airline: "Airline", airport: "Airport", aircraft: "Aircraft", route: "Route" };

// Flights matching a given entity.
function flightsFor({ kind, value }) {
  switch (kind) {
    case "airline":  return flown.filter((f) => f.airline === value);
    case "aircraft": return flown.filter((f) => f.aircraft === value);
    case "airport":  return flown.filter((f) => f.from?.iata === value || f.to?.iata === value);
    case "route":    return flown.filter((f) => routeKey(f) === value);
    default:         return [];
  }
}

// Tally flights by a key function, returning [key, count] pairs sorted by count.
function tally(flights, keyFn) {
  const m = {};
  for (const f of flights) {
    const k = keyFn(f);
    if (k == null || k === "") continue;
    m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

// City label for an airport iata (from the first flight that touches it).
function cityFor(iata) {
  for (const f of flown) {
    if (f.from?.iata === iata && f.from.city) return f.from.city;
    if (f.to?.iata === iata && f.to.city) return f.to.city;
  }
  return null;
}

function titleFor({ kind, value }) {
  if (kind === "airport") { const c = cityFor(value); return { title: value, sub: c }; }
  if (kind === "route") {
    const [a, b] = value.split(DASH);
    const ca = cityFor(a), cb = cityFor(b);
    return { title: value, sub: ca && cb ? `${ca} ${DASH} ${cb}` : null };
  }
  return { title: value, sub: null };
}

// A clickable (or static) bar list, styled like StatsView's TopList.
function Bars({ rows, unit, onPick }) {
  if (!rows.length) return <p className="muted small">–</p>;
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="toplist">
      {rows.map(([k, n]) => {
        const inner = (
          <>
            <span className="tl-k">{k}</span>
            <span className="tl-bar"><i style={{ width: `${(n / max) * 100}%` }} /></span>
            <span className="tl-n">{n}{unit ? ` ${unit}` : ""}</span>
          </>
        );
        return onPick
          ? <button className="tl-row tl-click" key={k} onClick={() => onPick(k)}>{inner}</button>
          : <div className="tl-row" key={k}>{inner}</div>;
      })}
    </div>
  );
}

// The breakdown sections shown for a given entity. Each entry: heading + rows +
// optional drill kind (so rows pivot to another entity).
function sectionsFor(entity, flights, push) {
  const years = tally(flights, (f) => f.date.slice(0, 4)).sort((a, b) => a[0].localeCompare(b[0]));
  const yearSection = { head: "Flights per year", rows: years };
  const airlines = () => ({ head: "Airlines", rows: tally(flights, (f) => f.airline), pick: (v) => push({ kind: "airline", value: v }) });
  const aircraft = () => ({ head: "Aircraft", rows: tally(flights, (f) => f.aircraft), pick: (v) => push({ kind: "aircraft", value: v }) });
  const routes = () => ({ head: "Routes", rows: tally(flights, routeKey), pick: (v) => push({ kind: "route", value: v }) });

  switch (entity.kind) {
    case "airline":
      return [routes(), aircraft(), yearSection];
    case "aircraft":
      return [airlines(), routes(), yearSection];
    case "route":
      return [airlines(), aircraft(), yearSection];
    case "airport": {
      // destinations and routes are the same data for a single airport — keep
      // the cleaner "destinations" list only.
      const other = (f) => (f.from?.iata === entity.value ? f.to?.iata : f.from?.iata);
      return [
        airlines(),
        { head: "Destinations", rows: tally(flights, other), pick: (v) => push({ kind: "airport", value: v }) },
        yearSection,
      ];
    }
    default:
      return [yearSection];
  }
}

export default function EntityDetail({ entity, onClose }) {
  const [stack, setStack] = useState([entity]);
  const cur = stack[stack.length - 1];
  const push = (e) => setStack((s) => [...s, e]);
  const back = () => setStack((s) => s.slice(0, -1));

  const flights = flightsFor(cur);
  const { title, sub } = titleFor(cur);
  const distance = flights.reduce((s, f) => s + (f.distance_km || 0), 0);
  const mins = flights.reduce((s, f) => s + (f.duration_min || 0), 0);
  const sorted = [...flights].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const timed = flights.filter((f) => Number.isFinite(f.arr_delay_min));
  const avgDelay = timed.length ? Math.round(timed.reduce((s, f) => s + f.arr_delay_min, 0) / timed.length) : null;
  const onTime = timed.length ? Math.round((timed.filter((f) => f.arr_delay_min <= 15).length / timed.length) * 100) : null;
  const leg = (f) => f && `${f.from?.iata}→${f.to?.iata}`;
  const sections = sectionsFor(cur, flights, push);

  // Flight map: every route flown for this entity (arcs + airport dots).
  const mapLegs = flights
    .filter((f) => Number.isFinite(f.from?.lat) && Number.isFinite(f.to?.lat))
    .map((f) => ({ from: { lat: f.from.lat, lon: f.from.lon }, to: { lat: f.to.lat, lon: f.to.lon } }));
  const mapPoints = (() => {
    const seen = new Set(), out = [];
    for (const f of flights) for (const ep of [f.from, f.to]) {
      if (Number.isFinite(ep?.lat) && !seen.has(ep.iata)) { seen.add(ep.iata); out.push({ lat: ep.lat, lon: ep.lon }); }
    }
    return out;
  })();

  return (
    <div className="yr-backdrop" onClick={onClose}>
      <div className="yr-card" onClick={(e) => e.stopPropagation()}>
        <button className="cp-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="ed-head">
          {stack.length > 1 && <button className="ed-back" onClick={back} aria-label="Back">‹</button>}
          <div>
            <div className="ed-kind">{KIND_LABEL[cur.kind]}</div>
            <h2 className="ed-title">{title}</h2>
            {sub && <p className="ed-sub">{sub}</p>}
          </div>
        </div>

        <div className="yr-hero ed-hero">
          <div><b>{flights.length}</b><span>flights</span></div>
          <div><b>{fmt(distance)}</b><span>km flown</span></div>
          <div><b>{Math.round(mins / 60)}</b><span>hours airborne</span></div>
        </div>

        {mapLegs.length > 0 && <div className="ed-map"><RouteMap legs={mapLegs} points={mapPoints} fit={mapPoints} /></div>}

        {first && (
          <div className="yr-rows ed-firstlast">
            <div><span>First flight</span><b>{leg(first)} · {first.date}</b></div>
            {last && last !== first && <div><span>Last flight</span><b>{leg(last)} · {last.date}</b></div>}
            {timed.length >= 1 && <div><span>Punctuality</span><b>{onTime}% on time · {avgDelay > 0 ? `+${avgDelay}` : avgDelay} min avg{timed.length < flights.length ? ` (${timed.length})` : ""}</b></div>}
          </div>
        )}

        {sections.map((sec) => (
          <div key={sec.head}>
            <h4>{sec.head}</h4>
            <Bars rows={sec.rows} onPick={sec.pick} />
          </div>
        ))}
      </div>
    </div>
  );
}
