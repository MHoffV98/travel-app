// StatsView.jsx — the numbers dashboard.
import { useMemo, useState } from "react";
import { data, byIso, SHARE_MODE, fmt, CAT, transportCats, countryFlagUrl, homeOn, TRIPS } from "../data.js";
import YearReview from "../YearReview.jsx";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Cabin enum → human label (the raw values come straight from the flight export).
const CABIN_LABEL = { ECONOMY: "Economy", PREMIUM_ECONOMY: "Premium Economy", BUSINESS: "Business", FIRST: "First" };

// Countries first visited per year, and the running cumulative total.
function countryYears() {
  const firstByYear = {};
  for (const c of data.countries) {
    if (c.status !== "visited" || !c.first_visit) continue;
    (firstByYear[+c.first_visit.slice(0, 4)] ||= []).push(c);
  }
  const yrs = Object.keys(firstByYear).map(Number);
  const minY = Math.min(...yrs), maxY = +data.meta.built.slice(0, 4);

  // every visited country present in each year — driven by qualifying visit years
  // (real stays, not airport layovers) plus the home base for each year.
  const sets = {};
  const add = (y, iso) => { const c = byIso[iso]; if (c && c.status === "visited") (sets[y] ||= new Set()).add(iso); };
  for (const c of data.countries) {
    if (c.status !== "visited") continue;
    for (const y of (c.visit_years || [])) add(+y, c.iso3);
  }
  const homeIso = { "United Kingdom": "GBR", Australia: "AUS" };
  for (let y = minY; y <= maxY; y++) { const h = homeIso[homeOn(`${y}-07-01`).country]; if (h) add(y, h); }
  const allByYear = {};
  for (const [y, set] of Object.entries(sets)) allByYear[y] = [...set].map((i) => byIso[i]).sort((a, b) => a.name.localeCompare(b.name));

  const cumulative = [];
  let total = 0;
  for (let y = minY; y <= maxY; y++) { total += (firstByYear[y] || []).length; cumulative.push({ y, total }); }
  return { firstByYear, allByYear, cumulative, minY, maxY };
}

function TopList({ rows, unit, onPick }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="toplist">
      {rows.map(([k, n]) => {
        const inner = (
          <>
            <span className="tl-k">{k}</span>
            <span className="tl-bar"><i style={{ width: `${(n / max) * 100}%` }} /></span>
            <span className="tl-n">{fmt(n)}{unit ? ` ${unit}` : ""}</span>
          </>
        );
        return onPick
          ? <button className="tl-row tl-click" key={k} onClick={() => onPick(k)}>{inner}</button>
          : <div className="tl-row" key={k}>{inner}</div>;
      })}
    </div>
  );
}

function PunctualityList({ rows }) {
  if (!rows.length) return <p className="muted small">Not enough timed flights.</p>;
  return (
    <div className="records">
      {rows.map((r) => (
        <div className="rec-row" key={r.k}>
          <span className="rec-k">{r.k}</span>
          <span className="rec-v">{r.avg > 0 ? `+${r.avg}` : r.avg} min · {r.onTime}% on time</span>
        </div>
      ))}
    </div>
  );
}

function CumulativeChart({ cy }) {
  const { cumulative, firstByYear, allByYear } = cy;
  const [hover, setHover] = useState(null);
  const W = 620, H = 170, P = 28;
  const max = cumulative.at(-1).total;
  const x = (i) => P + (i / (cumulative.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const pts = cumulative.map((d, i) => `${x(i)},${y(d.total)}`).join(" ");
  const area = `${P},${H - P} ${pts} ${W - P},${H - P}`;
  const ticks = cumulative.filter((d) => d.y % 4 === 0 || d.y === cumulative.at(-1).y);
  return (
   <div className="chart-wrap">
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id="ig" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ff5c40" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#ig)" />
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
      {cumulative.map((d, i) => (
        <circle key={d.y} cx={x(i)} cy={y(d.total)} r="10" fill="transparent" style={{ cursor: "pointer" }}
          onMouseEnter={() => setHover(i)} />
      ))}
      {hover != null && <circle cx={x(hover)} cy={y(cumulative[hover].total)} r="4.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.5" />}
      {ticks.map((d) => <text key={d.y} x={x(cumulative.indexOf(d))} y={H - 8} fill="var(--muted)" fontSize="11" textAnchor="middle">{d.y}</text>)}
      <text x={P} y={y(max) - 6} fill="var(--text)" fontSize="12">{max}</text>
    </svg>
    {hover != null && (() => {
      const d = cumulative[hover];
      const nu = (firstByYear[d.y] || []).length, vis = (allByYear[d.y] || []).length;
      return (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(d.total) / H) * 100}%` }}>
          <b>{d.y}</b>
          <span>{d.total} countries total</span>
          <span>+{nu} new · {vis} visited that year</span>
        </div>
      );
    })()}
   </div>
  );
}

function Flag({ c, onSelect }) {
  const click = () => onSelect?.(c.iso3);
  const url = countryFlagUrl(c, 40);
  if (!url) return <span className="flag-fallback" title={c.name} onClick={click}>{c.iso3}</span>;
  return <img className="flag" src={url} alt={c.name} title={`${c.name} · first ${c.first_visit}`} onClick={click} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
}

function FirstVisitFlags({ byYear, minY, maxY, onSelect }) {
  const years = [];
  for (let y = minY; y <= maxY; y++) years.push(y);
  return (
    <div className="flagyears">
      {years.map((y) => {
        const cs = byYear[y] || [];
        return (
          <div className={`flagcol ${cs.length ? "" : "empty"}`} key={y}>
            <div className="flagstack">{cs.map((c) => <Flag key={c.iso3} c={c} onSelect={onSelect} />)}</div>
            <div className="flagcount">{cs.length || ""}</div>
            <div className="flagyear">'{String(y).slice(2)}</div>
          </div>
        );
      })}
    </div>
  );
}

// Travel-style mix: flights = air; manual trips counted by transport category.
function travelStyles() {
  const counts = { air: data.stats.flights_flown, rail: 0, sea: 0, road: 0, foot: 0 };
  for (const v of data.visits) {
    if (v.kind !== "visit") continue;
    for (const c of transportCats(v.transport)) if (c !== "air" && counts[c] != null) counts[c] += 1;
  }
  return counts;
}

function Stat({ big, label, sub }) {
  return (
    <div className="stat">
      <div className="big">{big}</div>
      <div className="label">{label}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function haversine(a, b) { const R = 6371, r = (x) => (x * Math.PI) / 180; const s = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
function fmtDur(days) { if (days >= 365) { const y = days / 365; return `${y.toFixed(y < 10 ? 1 : 0)} yrs`; } if (days >= 55) return `${Math.round(days / 30)} months`; return `${Math.round(days)} days`; }

// "biggest / furthest / longest" headline stats, computed from points + trips.
function buildSuperlatives() {
  const home = data.config.home_bases.find((e) => e.end == null) || data.config.home_bases.at(-1);
  const homeLL = home && Number.isFinite(home.lat) ? [home.lat, home.lon] : [51.5074, -0.1278];
  const pts = [];
  for (const f of data.flights) { if (f.status !== "flown") continue; for (const ep of [f.from, f.to]) if (Number.isFinite(ep?.lat)) pts.push({ ll: [ep.lat, ep.lon], label: ep.city || ep.iata }); }
  for (const v of data.visits) if (Number.isFinite(v.lat)) pts.push({ ll: [v.lat, v.lon], label: v.place || v.country_name });
  let furthest = null, maxD = 0, north = null, south = null;
  for (const p of pts) {
    const d = haversine(homeLL, p.ll); if (d > maxD) { maxD = d; furthest = p; }
    if (!north || p.ll[0] > north.ll[0]) north = p;
    if (!south || p.ll[0] < south.ll[0]) south = p;
  }
  // exclude the recurring "2002–2016 summers" catch-all (its 14-yr span skews everything)
  const real = TRIPS.filter((t) => !t.upcoming && !t.events.some((e) => e.precision === "recurring"));
  const abroad = real.filter((t) => t.countries.some((c) => !c.is_home));
  const dur = (t) => (t ? t.spanDays || 0 : 0);
  const longest = abroad.reduce((a, b) => (dur(b) > dur(a) ? b : a), null);
  const mostC = abroad.reduce((a, b) => (b.countries.length > ((a && a.countries.length) || 0) ? b : a), null);
  // longest spell with no travel: interval-merge so overlapping trips don't hide the gap
  const sorted = [...real].sort((a, b) => a.startDay - b.startDay);
  let gapDays = 0, gap = null, maxEnd = sorted.length ? sorted[0].endDay : 0, maxEndDate = sorted.length ? sorted[0].end : null;
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].startDay - maxEnd;
    if (g > gapDays) { gapDays = g; gap = { from: maxEndDate, to: sorted[i].start, days: g }; }
    if (sorted[i].endDay > maxEnd) { maxEnd = sorted[i].endDay; maxEndDate = sorted[i].end; }
  }
  const mv = data.countries.filter((c) => c.status === "visited" && !c.is_home).reduce((a, b) => ((b.visit_count || 0) > ((a && a.visit_count) || 0) ? b : a), null);
  return {
    homeCity: home?.city || "home",
    furthest: furthest && { km: Math.round(maxD), label: furthest.label },
    north, south,
    longest: longest && { name: longest.defaultName, days: dur(longest) },
    mostC: mostC && { name: mostC.defaultName, n: mostC.countries.length },
    gap: gap && { ...gap, days: gapDays },
    mv,
    moonX: data.stats.distance_km / 384400,
  };
}

function lat2(p, neg, pos) { const v = p.ll[0]; return `${Math.abs(v).toFixed(1)}°${v < 0 ? neg : pos}`; }

// Sortable ranking of every visited country. Tap a header to sort, tap a row to
// open that country.
const RANK_COLS = [
  ["name", "Country", false],
  ["visit_count", "Trips", true],
  ["nights", "Nights", true],
  ["cities", "Cities", true],
  ["first_visit", "First", false],
  ["last_visit", "Latest", false],
];
// Nights spent in a country: for a home base that's the years LIVED there
// (home_nights), otherwise the travelled nights. (The raw `nights` is a
// flight-gap estimate that's meaningless for a home base.)
const nightsOf = (c) => (c.is_home && c.home_nights ? c.home_nights : (c.nights || 0));
function CountryTable({ onSelect }) {
  const [key, setKey] = useState("visit_count");
  const [dir, setDir] = useState("desc");
  const rows = useMemo(() => {
    const list = data.countries.filter((c) => c.status === "visited");
    return [...list].sort((a, b) => {
      let r;
      if (key === "name") r = a.name.localeCompare(b.name);
      else if (key === "first_visit" || key === "last_visit") r = String(a[key] || "").localeCompare(String(b[key] || ""));
      else if (key === "nights") r = nightsOf(a) - nightsOf(b);
      else r = (a[key] ?? -1) - (b[key] ?? -1);
      if (r === 0) r = a.name.localeCompare(b.name);
      return dir === "asc" ? r : -r;
    });
  }, [key, dir]);
  const sortBy = (k) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setKey(k); setDir(k === "name" ? "asc" : "desc"); }
  };
  return (
    <div className="ctable-wrap">
      <table className="ctable">
        <thead>
          <tr>
            <th className="ct-rk" />
            {RANK_COLS.map(([k, label, num]) => (
              <th key={k} className={`${num ? "ct-num" : "ct-name"} ${key === k ? "on" : ""} ${k === "cities" || k === "last_visit" ? "ct-opt" : ""}`} onClick={() => sortBy(k)}>
                {label}{key === k ? (dir === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.iso3} onClick={() => onSelect?.(c.iso3)}>
              <td className="ct-rk">{i + 1}</td>
              <td className="ct-name"><Flag c={c} onSelect={onSelect} /><span className="ct-cn">{c.name}{c.is_current_home ? " 🏠" : ""}</span></td>
              <td className="ct-num">{c.visit_count || "–"}</td>
              <td className="ct-num" title={c.is_home && c.home_nights ? "nights lived here" : undefined}>{nightsOf(c) ? fmt(nightsOf(c)) : "–"}</td>
              <td className="ct-num ct-opt">{c.cities || "–"}</td>
              <td className="ct-num">{(c.first_visit || "").slice(0, 7) || "–"}</td>
              <td className="ct-num ct-opt">{(c.last_visit || "").slice(0, 7) || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Rough flight-carbon estimate. Intensity (kg CO2 per passenger-km) drops with
// haul length; a cabin multiplier reflects seat footprint; a 1.7× uplift accounts
// for high-altitude (non-CO2) radiative forcing → "CO2e". Deliberately simple.
function carbonStats() {
  const CABIN = { ECONOMY: 1, PREMIUM_ECONOMY: 1.5, BUSINESS: 2.9, FIRST: 4 };
  let kg = 0;
  for (const f of data.flights) {
    if (f.status !== "flown" || !f.distance_km) continue;
    const base = f.distance_km < 1500 ? 0.155 : f.distance_km < 5000 ? 0.12 : 0.11;
    kg += f.distance_km * base * (CABIN[f.cabin] || 1) * 1.7;
  }
  const tonnes = kg / 1000;
  const yrs = Object.keys(data.stats.flights_by_year).length || 1;
  return { tonnes, perYear: tonnes / yrs, trees: Math.round((tonnes * 1000) / 21), lonNyc: tonnes / 0.99 };
}

// Auto-derived milestones / achievements from the totals we already compute.
function milestones() {
  const s = data.stats;
  const nC = s.countries_sovereign ?? data.countries.filter((c) => c.status === "visited" && !c.is_territory).length;
  const nF = s.flights_flown;
  const lats = [];
  for (const f of data.flights) { if (f.from?.lat != null) lats.push(f.from.lat); if (f.to?.lat != null) lats.push(f.to.lat); }
  const bothHemis = lats.some((l) => l > 0.5) && lats.some((l) => l < -0.5);
  let equator = 0;
  for (const f of data.flights) {
    if (f.status !== "flown" || f.from?.lat == null || f.to?.lat == null) continue;
    if (Math.sign(f.from.lat) !== Math.sign(f.to.lat)) equator++;
  }
  const tier = (n, arr) => { let earned = 0, next = null; for (const t of arr) { if (n >= t) earned = t; else { next = t; break; } } return { earned, next }; };
  const cT = tier(nC, [10, 25, 50, 75, 100]), fT = tier(nF, [50, 100, 250, 500, 1000]);
  const out = [];
  out.push({ icon: "🌍", big: cT.earned + "+", label: "countries", sub: cT.next ? `${cT.next - nC} to ${cT.next}` : "" });
  out.push({ icon: "✈️", big: fT.earned + "+", label: "flights", sub: fT.next ? `${fT.next - nF} to ${fT.next}` : "" });
  out.push({ icon: "🌗", big: (s.distance_km / 384400).toFixed(1) + "×", label: "to the Moon" });
  out.push({ icon: "🔄", big: Math.round(s.times_around_earth) + "×", label: "around the Earth" });
  if (bothHemis) out.push({ icon: "🧭", big: "N + S", label: "both hemispheres" });
  if (equator) out.push({ icon: "⚖️", big: equator + "×", label: "equator crossings" });
  if (s.nights_travel) out.push({ icon: "🛏️", big: fmt(s.nights_travel), label: "nights abroad" });
  if (s.first_country?.date) out.push({ icon: "🥇", big: "’" + s.first_country.date.slice(2, 4), label: "first trip abroad" });
  return out;
}

function Stamps({ onSelect }) {
  const list = data.countries
    .filter((c) => c.status === "visited" && c.first_visit)
    .sort((a, b) => a.first_visit.localeCompare(b.first_visit));
  return (
    <div className="stamps">
      {list.map((c, i) => {
        const url = countryFlagUrl(c, 40);
        return (
          <button className="stamp" key={c.iso3} onClick={() => onSelect?.(c.iso3)} title={`${c.name} · first ${c.first_visit}`} style={{ "--rot": `${((i * 37) % 7) - 3}deg` }}>
            {url ? <img src={url} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} /> : <span className="stamp-iso">{c.iso3}</span>}
            <span className="stamp-name">{c.name}</span>
            <span className="stamp-year">’{c.first_visit.slice(2, 4)}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function StatsView({ onSelect, onOpenEntity }) {
  const s = data.stats;
  const years = Object.entries(s.flights_by_year);
  const maxY = Math.max(...years.map(([, n]) => n));
  const cy = countryYears();
  const [reviewYear, setReviewYear] = useState(null);
  const [flagMode, setFlagMode] = useState("new");
  const pick = (kind) => (value) => onOpenEntity?.(kind, value);

  // flight breakdowns toggle between number of legs (default) and km flown
  const [fm, setFm] = useState("legs");
  const flightTops = useMemo(() => {
    const flown = data.flights.filter((f) => f.status === "flown");
    const w = fm === "km" ? (f) => f.distance_km || 0 : () => 1;
    const top = (keyFn) => {
      const m = {};
      for (const f of flown) for (const k of [].concat(keyFn(f))) { if (k == null || k === "") continue; m[k] = (m[k] || 0) + w(f); }
      return Object.entries(m).map(([k, v]) => [k, Math.round(v)]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    };
    const routeKey = (f) => [f.from?.iata, f.to?.iata].filter(Boolean).sort().join("–");
    return {
      airports: top((f) => [f.from?.iata, f.to?.iata]),
      routes: top(routeKey),
      airlines: top((f) => f.airline),
      aircraft: top((f) => f.aircraft),
      cabin: top((f) => f.cabin),
    };
  }, [fm]);
  const unit = fm === "km" ? "km" : undefined;

  // punctuality broken down by airline / route / airport (≥3 timed flights each)
  const punctuality = useMemo(() => {
    const timed = data.flights.filter((f) => f.status === "flown" && Number.isFinite(f.arr_delay_min));
    const agg = (keyFn) => {
      const m = {};
      for (const f of timed) for (const k of [].concat(keyFn(f))) { if (!k) continue; (m[k] ||= []).push(f.arr_delay_min); }
      return Object.entries(m).filter(([, a]) => a.length >= 3).map(([k, a]) => ({
        k, n: a.length,
        avg: Math.round(a.reduce((s, d) => s + d, 0) / a.length),
        onTime: Math.round((a.filter((d) => d <= 15).length / a.length) * 100),
      })).sort((x, y) => y.avg - x.avg).slice(0, 6);
    };
    const routeKey = (f) => [f.from?.iata, f.to?.iata].filter(Boolean).sort().join("–");
    return { airlines: agg((f) => f.airline), routes: agg(routeKey), airports: agg((f) => [f.from?.iata, f.to?.iata]) };
  }, []);
  const MetricToggle = () => (
    <span className="seg flag-seg">
      <button className={fm === "legs" ? "on" : ""} onClick={() => setFm("legs")}>Legs</button>
      <button className={fm === "km" ? "on" : ""} onClick={() => setFm("km")}>Distance</button>
    </span>
  );

  const superlatives = useMemo(() => buildSuperlatives(), []);
  const carbon = useMemo(carbonStats, []);
  const mstones = useMemo(milestones, []);

  const jump = (id) => {
    if (id === "top") document.querySelector(".stats-view")?.scrollTo({ top: 0, behavior: "smooth" });
    else document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="view stats-view">
      <div className="stat-jump">
        {[["Top", "top"], ["Superlatives", "sec-superlatives"], ["Milestones", "sec-milestones"], ["Countries", "sec-countries"], ["Ranking", "sec-ranking"], ["Stamps", "sec-stamps"], ["Records", "sec-records"], ["Flights", "sec-flights"], ["Footprint", "sec-carbon"], ["Punctuality", "sec-punctuality"], ["Patterns", "sec-patterns"]].map(([label, id]) => (
          <button key={id} onClick={() => jump(id)}>{label}</button>
        ))}
      </div>
      <div className="stats-grid">
        <Stat big={fmt(s.distance_km) + " km"} label="distance flown" sub={`${s.times_around_earth}× around the Earth`} />
        <Stat big={fmt(s.hours_airborne) + " h"} label="airborne" sub={`${(s.hours_airborne / 24).toFixed(0)} days in the air`} />
        <Stat big={fmt(s.flights_flown)} label="flights" sub={`${s.flights_booked} booked · ${s.flights_cancelled} cancelled`} />
        <Stat big={fmt(s.countries_sovereign)} label="sovereign countries" sub={`${fmt(s.countries_total)} with territories · ${s.countries_transit_only} transit · ${s.layover_visits} layover`} />
        <Stat big={fmt(s.airports)} label="airports" />
        <Stat big={fmt(s.airlines)} label="airlines" />
        <Stat big={fmt(s.aircraft_types)} label="aircraft types" />
        {!SHARE_MODE && <Stat big={fmt(s.nights_travel)} label="travel nights" sub={`${fmt(s.nights_home)} at home`} />}
      </div>

      <h3 id="sec-superlatives">Superlatives <span className="muted small">the biggest, furthest &amp; longest</span></h3>
      <div className="stats-grid">
        {superlatives.furthest && <Stat big={fmt(superlatives.furthest.km) + " km"} label={`furthest from ${superlatives.homeCity}`} sub={superlatives.furthest.label} />}
        {superlatives.north && <Stat big={lat2(superlatives.north, "S", "N")} label="northernmost" sub={superlatives.north.label} />}
        {superlatives.south && <Stat big={lat2(superlatives.south, "S", "N")} label="southernmost" sub={superlatives.south.label} />}
        {superlatives.longest && <Stat big={superlatives.longest.days} label="longest trip (days)" sub={superlatives.longest.name} />}
        {superlatives.mostC && <Stat big={superlatives.mostC.n} label="countries in one trip" sub={superlatives.mostC.name} />}
        {superlatives.gap && <Stat big={fmtDur(superlatives.gap.days)} label="longest spell home" sub={`${(superlatives.gap.from || "").slice(0, 7)} → ${(superlatives.gap.to || "").slice(0, 7)}`} />}
        {superlatives.mv && <Stat big={superlatives.mv.visit_count + "×"} label="most-visited country" sub={superlatives.mv.name} />}
        <Stat big={superlatives.moonX.toFixed(1) + "×"} label="the distance to the Moon" sub="total flown vs 384,400 km" />
      </div>

      <h3 id="sec-milestones">Milestones <span className="muted small">badges earned along the way</span></h3>
      <div className="badges">
        {mstones.map((m, i) => (
          <div className="badge2" key={i}>
            <span className="badge2-ico">{m.icon}</span>
            <b>{m.big}</b>
            <span className="badge2-l">{m.label}</span>
            {m.sub && <span className="badge2-sub">{m.sub}</span>}
          </div>
        ))}
      </div>

      <h3>Travel styles</h3>
      <div className="styles">
        {Object.entries(travelStyles()).map(([k, n]) => (
          <div className="style" key={k}>
            <span className="dot" style={{ background: CAT[k].hex }} />
            <span className="style-n">{fmt(n)}</span>
            <span className="style-l">{CAT[k].label}{k === "air" ? " legs" : ""}</span>
          </div>
        ))}
      </div>

      <h3 id="sec-countries">Countries over time <span className="muted small">cumulative · {cy.cumulative.at(-1).total} total</span></h3>
      <CumulativeChart cy={cy} />

      <h3>{flagMode === "new" ? "New countries each year" : "All countries each year"}
        <span className="seg flag-seg">
          <button className={flagMode === "new" ? "on" : ""} onClick={() => setFlagMode("new")}>New</button>
          <button className={flagMode === "all" ? "on" : ""} onClick={() => setFlagMode("all")}>All</button>
        </span>
      </h3>
      <FirstVisitFlags byYear={flagMode === "new" ? cy.firstByYear : cy.allByYear} minY={cy.minY} maxY={cy.maxY} onSelect={onSelect} />

      <h3 id="sec-ranking">Country ranking <span className="muted small">tap a column to sort · tap a row to open</span></h3>
      <CountryTable onSelect={onSelect} />

      <h3 id="sec-stamps">Passport <span className="muted small">every country, in the order you first set foot</span></h3>
      <Stamps onSelect={onSelect} />

      <h3 id="sec-records">Records</h3>
      <div className="records">
        <Row k="Busiest year" v={`${s.busiest_year?.[0]} · ${s.busiest_year?.[1]} flights`} />
        <Row k="Longest flight" v={s.longest_flight ? `${s.longest_flight.route} · ${fmt(s.longest_flight.km)} km` : "–"} />
        <Row k="Shortest flight" v={s.shortest_flight ? `${s.shortest_flight.route} · ${fmt(s.shortest_flight.km)} km` : "–"} />
        <Row k="Most-flown route" v={s.most_flown_route ? `${s.most_flown_route[0]} · ${s.most_flown_route[1]}×` : "–"} onClick={s.most_flown_route ? () => onOpenEntity?.("route", s.most_flown_route[0]) : undefined} />
        <Row k="Most-visited airport" v={s.most_visited_airport ? `${s.most_visited_airport[0]} · ${s.most_visited_airport[1]}×` : "–"} onClick={s.most_visited_airport ? () => onOpenEntity?.("airport", s.most_visited_airport[0]) : undefined} />
        <Row k="Most-flown aircraft" v={s.most_flown_registration ? `${s.most_flown_registration[0]} · ${s.most_flown_registration[1]}×` : "–"} />
        <Row k="First country abroad" v={`${s.first_country.name} (${s.first_country.date}) · ${s.first_country.note}`} />
      </div>

      <h3 id="sec-carbon">Carbon footprint <span className="muted small">rough estimate</span></h3>
      <div className="stats-grid">
        <Stat big={carbon.tonnes.toFixed(1) + " t"} label="flight CO₂e (est.)" sub={`≈ ${carbon.perYear.toFixed(1)} t / year`} />
        <Stat big={fmt(carbon.trees)} label="tree-years to offset" sub="at ~21 kg CO₂ per tree/yr" />
        <Stat big={Math.round(carbon.lonNyc) + "×"} label="London–New York returns" sub="economy equivalent" />
      </div>
      <p className="muted small foot-note">Ballpark only: intensity by haul length × cabin, with a 1.7× uplift for high-altitude effects. Real figures vary with load factor and routing.</p>

      <h3 id="sec-punctuality">Punctuality <span className="muted small">(from {fmt(s.delays.records_with_actuals)} flights with actual times)</span></h3>
      <div className="records">
        <Row k="On time (≤15 min)" v={s.delays.on_time_pct != null ? s.delays.on_time_pct + "%" : "–"} />
        <Row k="Average delay" v={s.delays.avg_delay_min != null ? s.delays.avg_delay_min + " min" : "–"} />
        <Row k="Worst delay" v={s.delays.worst_delay_min != null ? s.delays.worst_delay_min + " min" : "–"} />
      </div>
      <div className="twocol">
        <div><h5>By airline</h5><PunctualityList rows={punctuality.airlines} /></div>
        <div><h5>By route</h5><PunctualityList rows={punctuality.routes} /></div>
      </div>
      <div className="twocol">
        <div><h5>By airport</h5><PunctualityList rows={punctuality.airports} /></div>
        <div />
      </div>

      <h3 id="sec-flights">Top airports &amp; routes <span className="muted small">tap to drill in</span><MetricToggle /></h3>
      <div className="twocol">
        <div><h5>Airports</h5><TopList rows={flightTops.airports} unit={unit} onPick={pick("airport")} /></div>
        <div><h5>Routes</h5><TopList rows={flightTops.routes} unit={unit} onPick={pick("route")} /></div>
      </div>

      <h3>Airlines &amp; aircraft <span className="muted small">tap to drill in</span><MetricToggle /></h3>
      <div className="twocol">
        <div><h5>Airlines</h5><TopList rows={flightTops.airlines} unit={unit} onPick={pick("airline")} /></div>
        <div><h5>Aircraft</h5><TopList rows={flightTops.aircraft} unit={unit} onPick={pick("aircraft")} /></div>
      </div>

      <h3 id="sec-patterns">When I fly</h3>
      <div className="twocol">
        <div>
          <h5>Day of week</h5>
          <div className="bars dow">
            {[1, 2, 3, 4, 5, 6, 0].map((i) => {
              const n = s.day_of_week[i], dmax = Math.max(...s.day_of_week);
              return (
                <div className="barcol-static" key={i} title={`${DOW[i]}: ${n}`}>
                  <div className="barfill" style={{ height: `${(n / dmax) * 100}%` }} />
                  <div className="barnum">{n}</div>
                  <div className="barlabel">{DOW[i][0]}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <h5>Cabin class <span className="muted small">(where logged)</span></h5>
          {flightTops.cabin.length
            ? <TopList rows={flightTops.cabin.map(([k, n]) => [CABIN_LABEL[k] || k, n])} unit={unit} />
            : <p className="muted small">No cabin data.</p>}
        </div>
      </div>

      <h3>Flights per year <span className="muted small">tap a bar for that year's review</span></h3>
      <div className="bars">
        {years.map(([y, n]) => (
          <button className="barcol" key={y} title={`${y}: ${n} · open review`} onClick={() => setReviewYear(+y)}>
            <div className="barfill" style={{ height: `${(n / maxY) * 100}%` }} />
            <div className="barnum">{n}</div>
            <div className="barlabel">{y.slice(2)}</div>
          </button>
        ))}
      </div>

      {reviewYear && <YearReview year={reviewYear} onClose={() => setReviewYear(null)} onYear={setReviewYear} />}
    </div>
  );
}

function Row({ k, v, onClick }) {
  return (
    <div className="rec-row">
      <span className="rec-k">{k}</span>
      {onClick ? <button className="rec-v rec-link" onClick={onClick}>{v}</button> : <span className="rec-v">{v}</span>}
    </div>
  );
}
