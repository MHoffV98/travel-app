// YearReview.jsx — a "Wrapped"-style recap for a single year. Opened from the
// flights-per-year chart; arrows step between years that have flights.
import { data, byIso, fmt, countryFlagUrl, homeOn, TRIPS } from "./data.js";
import RouteMap from "./RouteMap.jsx";
import { downloadYearCard } from "./yearCard.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const flightYears = Object.keys(data.stats.flights_by_year).map(Number).sort();

function Flag({ c }) {
  const url = countryFlagUrl(c, 40);
  return url
    ? <img className="yr-flag" src={url} alt={c.name} title={c.name} loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
    : <span className="flag-fallback" title={c.name}>{c.iso3}</span>;
}

export default function YearReview({ year, onClose, onYear }) {
  const Y = String(year);
  const flights = data.flights.filter((f) => f.status === "flown" && f.date.startsWith(Y));
  const distance = flights.reduce((s, f) => s + (f.distance_km || 0), 0);
  const mins = flights.reduce((s, f) => s + (f.duration_min || 0), 0);

  const iso = new Set();
  for (const f of flights) { if (f.from?.country) iso.add(f.from.country); if (f.to?.country) iso.add(f.to.country); }
  for (const v of data.visits) if (v.country && (v.start || "").startsWith(Y)) iso.add(v.country);
  const countries = [...iso].map((i) => byIso[i]).filter((c) => c && c.status !== "transit");
  const fresh = data.countries.filter((c) => c.status === "visited" && c.first_visit?.startsWith(Y)).sort((a, b) => a.first_visit < b.first_visit ? -1 : 1);

  const routeCount = {};
  for (const f of flights) { const k = [f.from.iata, f.to.iata].sort().join("–"); routeCount[k] = (routeCount[k] || 0) + 1; }
  const topRoute = Object.entries(routeCount).sort((a, b) => b[1] - a[1])[0];
  const longest = flights.filter((f) => f.distance_km).sort((a, b) => b.distance_km - a.distance_km)[0];
  const byMonth = {};
  for (const f of flights) byMonth[+f.date.slice(5, 7) - 1] = (byMonth[+f.date.slice(5, 7) - 1] || 0) + 1;
  const busiest = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
  const airlines = new Set(flights.map((f) => f.airline).filter(Boolean));
  const aircraft = new Set(flights.map((f) => f.aircraft).filter(Boolean));
  const based = homeOn(`${Y}-07-01`);

  const idx = flightYears.indexOf(+year);
  const prev = flightYears[idx - 1], next = flightYears[idx + 1];

  const shareCard = () => downloadYearCard({
    year: Y,
    based: based.city || based.country,
    flights: flights.length,
    distance: fmt(Math.round(distance)),
    hours: Math.round(mins / 60),
    countries: countries.length,
    legs: ymLegs, ground: ymGround, points: ymPoints, inferred: ymInferred, fit: ymFocus,
    highlights: [
      busiest && `Busiest month: ${MONTHS[busiest[0]]} · ${busiest[1]} flights`,
      topRoute && `Most-flown route: ${topRoute[0]} (${topRoute[1]}×)`,
      longest && `Longest flight: ${longest.from.iata}→${longest.to.iata}, ${fmt(longest.distance_km)} km`,
    ].filter(Boolean),
  });

  const yTrips = TRIPS.filter((t) => t.year === +Y);
  const ymLegs = yTrips.flatMap((t) => t.mapLegs);
  const ymGround = yTrips.flatMap((t) => t.mapGround);
  const ymPoints = yTrips.flatMap((t) => t.mapPoints);
  const ymInferred = yTrips.flatMap((t) => t.mapInferred);
  const ymFocus = yTrips.flatMap((t) => t.mapFocus);

  return (
    <div className="yr-backdrop" onClick={onClose}>
      <div className="yr-card" onClick={(e) => e.stopPropagation()}>
        <button className="cp-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="yr-nav">
          <button disabled={!prev} onClick={() => onYear(prev)}>‹</button>
          <h2>{Y}</h2>
          <button disabled={!next} onClick={() => onYear(next)}>›</button>
        </div>
        <p className="yr-sub">Based in <b>{based.city || based.country}</b></p>

        <div className="yr-hero">
          <div><b>{flights.length}</b><span>flights</span></div>
          <div><b>{fmt(distance)}</b><span>km · {(distance / 40075).toFixed(1)}× Earth</span></div>
          <div><b>{Math.round(mins / 60)}</b><span>hours airborne</span></div>
          <div><b>{countries.length}</b><span>countries</span></div>
        </div>

        {(ymLegs.length > 0 || ymGround.length > 0 || ymPoints.length > 0) && (
          <>
            <h4>Where you went</h4>
            <RouteMap legs={ymLegs} points={ymPoints} ground={ymGround} inferred={ymInferred} fit={ymFocus} />
          </>
        )}

        {fresh.length > 0 && (
          <>
            <h4>New countries ({fresh.length})</h4>
            <div className="yr-flags">{fresh.map((c) => <Flag key={c.iso3} c={c} />)}</div>
          </>
        )}

        <h4>Highlights</h4>
        <div className="yr-rows">
          {busiest && <div><span>Busiest month</span><b>{MONTHS[busiest[0]]} · {busiest[1]} flights</b></div>}
          {topRoute && <div><span>Most-flown route</span><b>{topRoute[0]} · {topRoute[1]}×</b></div>}
          {longest && <div><span>Longest flight</span><b>{longest.from.iata}→{longest.to.iata} · {fmt(longest.distance_km)} km</b></div>}
          <div><span>Airlines · aircraft</span><b>{airlines.size} · {aircraft.size}</b></div>
        </div>

        <button className="yr-share" onClick={shareCard}>Share / save image</button>
      </div>
    </div>
  );
}
