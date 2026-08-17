// data.js — loads the pipeline output and derives lookups / color scales used
// across the views.
import raw from "./travel_data.json";

export const data = raw;
// Runtime flight-status flip: a booked flight whose date has now passed is really
// flown, even if the site hasn't been rebuilt since. Keeps the map arcs, journey
// and trip cards honest between deploys. (Aggregate stats in `data.stats` are baked
// at build time and only true up on the next `npm run deploy`.)
{
  const today = new Date().toISOString().slice(0, 10);
  for (const f of raw.flights) if (f.status === "booked" && f.date && f.date <= today) f.status = "flown";
}

// ---- in-app stop edits (structural trip edits made in the UI) ----------------
// Stored per-device in localStorage and applied over the built visits at load, so
// edits show on save (a reload) without a redeploy. Mirror them into
// data/manual_trips.csv + `npm run deploy` to make them permanent everywhere.
export const STOP_EDITS_KEY = "travelmap.stopedits.v1";
export function loadStopEdits() {
  try { const o = JSON.parse(localStorage.getItem(STOP_EDITS_KEY)); return { edited: {}, deleted: [], ...(o && typeof o === "object" ? o : {}) }; }
  catch { return { edited: {}, deleted: [] }; }
}
export function saveStopEdits(o) { try { localStorage.setItem(STOP_EDITS_KEY, JSON.stringify(o)); } catch { /* ignore */ } }
export const stopKey = (v) => `${v.place || v.country_name || "?"}|${v.start || ""}`;
{
  const ov = loadStopEdits();
  const del = new Set(ov.deleted || []);
  if (del.size) raw.visits = raw.visits.filter((v) => !(v.kind === "visit" && del.has(stopKey(v))));
  const edits = ov.edited || {};
  if (Object.keys(edits).length) for (const v of raw.visits) {
    if (v.kind !== "visit") continue;
    const p = edits[stopKey(v)];
    if (!p) continue;
    if (p.place != null) v.place = p.place;
    if (p.start != null) v.start = p.start;
    if (p.end != null) v.end = p.end;
    if (p.nights != null) v.nights = p.nights;
    if (p.notes != null) v.notes = p.notes;
  }
}
export const SHARE_MODE = import.meta.env.VITE_SHARE_MODE === "true" || raw.meta.share_mode === true;

export const byIso = Object.fromEntries(raw.countries.map((c) => [c.iso3, c]));
// Natural Earth uses a few codes that differ from our ISO3 keys.
const FEATURE_CODE = { PSX: "PSE", CYN: "XNC" }; // Palestine, Northern Cyprus
// Resolve a country record for a polygon feature by its ISO3 (with NE-code
// fixups + an ISO_A3 fallback). Overseas dependencies are NOT coloured as their
// parent — but ones that are their own visited entry (New Caledonia) resolve.
export function countryForFeature(props) {
  const code = FEATURE_CODE[props.ADM0_A3] || props.ADM0_A3;
  return byIso[code] || (props.ISO_A3 && props.ISO_A3 !== "-99" ? byIso[props.ISO_A3] : null) || null;
}

// Natural Earth folds French Guiana into France's polygon. The owner wants it
// left uncoloured, so drop France sub-polygons that sit in the Americas.
export function cleanGeo(geo) {
  for (const f of geo.features || []) {
    if (f.properties.ADM0_A3 === "FRA" && f.geometry?.type === "MultiPolygon") {
      f.geometry.coordinates = f.geometry.coordinates.filter(
        (poly) => !poly[0].some(([lon]) => lon < -20)
      );
    }
  }
  return geo;
}

// Representative points for visited countries that have no 110m polygon
// (small islands / city-states / territories). Used for marker dots.
export const COUNTRY_POINTS = {
  SGP: [103.99, 1.36], HKG: [113.91, 22.31], MLT: [14.48, 35.86], MDV: [73.53, 4.19],
  SJM: [15.47, 78.25], BRB: [-59.54, 13.19], KNA: [-62.72, 17.3], MUS: [57.55, -20.28],
  MCO: [7.42, 43.74], VAT: [12.45, 41.9],
  XAD: [32.99, 34.59],
};

// ---- color helpers ---------------------------------------------------------
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp = (a, b, t) => a + (b - a) * t;
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const seg = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)].map(Math.round);
}
// warm gradient: deep ember -> orange -> gold -> near-white
export const WARM = ["#3a0d0d", "#7a1f12", "#d24a1a", "#f59e0b", "#ffd86b", "#fff4d6"];

// Read the active theme's accent colours as RGB arrays (for deck.gl layers).
export function themeAccents() {
  const cs = getComputedStyle(document.documentElement);
  const parse = (v, fb) => { const h = (v || "").trim().replace("#", ""); return h.length >= 6 ? [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) : fb; };
  return {
    a1: parse(cs.getPropertyValue("--accent"), [245, 158, 11]),
    a2: parse(cs.getPropertyValue("--accent2"), [255, 92, 64]),
  };
}

export const COLORS = {
  notVisited: [38, 40, 54],
  transit: [86, 74, 120], // muted purple for transit-only
  outline: [12, 12, 20],
  layoverRing: [120, 220, 255],
  home: [86, 196, 174], // teal — "home base", so it never reads as unvisited
};

export const METRICS = [
  { key: "visits", label: "Visits" },
  { key: "nights", label: "Nights" },
  { key: "first", label: "First year" },
  { key: "recency", label: "Recency" },
];

function metricValue(c, metric) {
  if (!c) return null;
  switch (metric) {
    case "visits": return c.visit_count ?? 0;
    case "nights": return c.nights ?? 0;
    case "first": return c.first_visit ? +c.first_visit.slice(0, 4) : null;
    case "recency": return c.last_visit ? +c.last_visit.slice(0, 4) : null;
    default: return 0;
  }
}

// Build a normalizer per metric across visited countries.
export function makeScale(metric) {
  const vals = data.countries
    .filter((c) => c.status === "visited")
    .map((c) => metricValue(c, metric))
    .filter((v) => v != null && !Number.isNaN(v));
  let min = Math.min(...vals), max = Math.max(...vals);
  if (metric === "visits" || metric === "nights") min = 0; // anchor at zero
  const span = max - min || 1;
  // log-ish compression for the long-tailed count metrics
  const compress = metric === "visits" || metric === "nights";
  return (c) => {
    const v = metricValue(c, metric);
    if (v == null || Number.isNaN(v)) return null;
    let t = (v - min) / span;
    if (compress) t = Math.sqrt(t);
    return ramp(WARM, t);
  };
}

export function fmt(n) {
  return n == null ? "–" : n.toLocaleString();
}

// Flag image (flagcdn). size ∈ {20,40,80,160}. Returns null if no ISO2.
export const flagUrl = (iso2, size = 40) =>
  iso2 ? `https://flagcdn.com/w${size}/${iso2.toLowerCase()}.png` : null;

// Custom flags for places flagcdn lacks (no ISO code).
const CUSTOM_FLAGS = { XNC: "flags/xnc.svg" };
export function countryFlagUrl(c, size = 40) {
  if (c?.iso3 && CUSTOM_FLAGS[c.iso3]) return import.meta.env.BASE_URL + CUSTOM_FLAGS[c.iso3];
  return flagUrl(c?.iso2, size);
}

// ---- travel styles (transport categories) ---------------------------------
export const CAT = {
  air:  { label: "Plane",  color: [255, 140, 66],  hex: "#ff8c42" },
  rail: { label: "Train",  color: [74, 222, 128],  hex: "#4ade80" },
  sea:  { label: "Cruise", color: [56, 189, 248],  hex: "#38bdf8" },
  road: { label: "Road",   color: [244, 114, 182], hex: "#f472b6" },
  foot: { label: "Walk",   color: [251, 191, 36],  hex: "#fbbf24" },
};
export function transportCat(t) {
  t = (t || "").toLowerCase();
  if (/flight|air|plane/.test(t)) return "air";
  if (/train|rail|interrail/.test(t)) return "rail";
  if (/cruise|ship|ferry|boat|sea/.test(t)) return "sea";
  if (/walk|foot/.test(t)) return "foot";
  if (/car|overland|bus|drive|road|train|coach/.test(t)) return "road";
  return "road";
}
// split a manual transport string ("flight+cruise", "car/ferry") into categories
export function transportCats(s) {
  return [...new Set((s || "").split(/[+/]/).map((x) => transportCat(x.trim())))];
}

// Home base in effect on a given ISO date (or "Travelling" in the gap).
export function homeOn(dateStr) {
  for (const e of data.config.home_bases) {
    if (dateStr >= e.start && (e.end == null || dateStr < e.end)) return { country: e.country, city: e.city || null };
  }
  return { country: "Travelling", city: null };
}

// ---- trips (derived journeys) ----------------------------------------------
// A "trip" = a period away from home. Clustering is HOME-AWARE: a trip ends when
// you fly back into your home country after being abroad (so two trips a few days
// apart don't merge just because you didn't sit still for 14 days). A 14-day gap
// is the fallback boundary (for overland legs / domestic trips with no flight
// home), and explicit `trip` tags force-group and keep distinct tags apart.
const TRIP_GAP_DAYS = 14;
// force a new trip on/after these dates even with no home return or gap
// (e.g. flying straight from a domestic NYE to another continent)
const TRIP_BOUNDARIES = ["2024-01-01", "2023-11-15"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Curated names for specific trips (keyed by trip id = explicit tag or start date).
// Users can override any of these via the in-app editor (localStorage).
const CURATED_TRIP_NAMES = {
  "2026-05-21": "Scottish Highlands",
  "2024-07-18": "Hungary Birthday & F1",
  "centam-2022": "Central America",
  "2024-12-17": "Bruges",
  "2025-07-18": "Nico’s Wedding",
  "2023-12-23": "Lord Howe Island & Sydney NYE",
};

const nameToIso = {};
for (const c of data.countries) nameToIso[c.name] = c.iso3;
function homeIsoOn(dateStr) {
  return nameToIso[homeOn(dateStr).country] || null;
}
// home base lat/lon in effect on a date (for anchoring domestic trip routes)
function homeLocOn(dateStr) {
  for (const e of data.config.home_bases) {
    if (dateStr >= e.start && (e.end == null || dateStr < e.end)) {
      return Number.isFinite(e.lat) ? { lat: e.lat, lon: e.lon } : null;
    }
  }
  return null;
}

function normDate(s) {
  const [y, m, d] = s.split("-");
  return `${y}-${m || "07"}-${d || "15"}`;
}
function dayNum(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = normDate(dateStr).split("-");
  return Date.UTC(+y, +m - 1, +d) / 86400000;
}

// Format a start..end pair compactly, respecting precision present in the strings.
export function tripDateRange(start, end) {
  const a = start.split("-"), b = (end || start).split("-");
  const mA = MONTHS_SHORT[(+a[1] || 7) - 1], mB = MONTHS_SHORT[(+b[1] || 7) - 1];
  const sameY = a[0] === b[0], sameM = sameY && a[1] === b[1];
  if (sameM) {
    if (a[2] && b[2] && a[2] !== b[2]) return `${+a[2]}–${+b[2]} ${mA} ${a[0]}`;
    return `${mA} ${a[0]}`;
  }
  if (sameY) return `${mA}–${mB} ${a[0]}`;
  return `${mA} ${a[0]} – ${mB} ${b[0]}`;
}

const TODAY_STR = new Date().toISOString().slice(0, 10);
function buildTrips() {
  const ev = [];
  for (const f of data.flights) {
    // include booked (future) flights too, so an upcoming trip's flights and its
    // manual stops cluster into one trip card; only cancelled flights are dropped.
    if (f.status === "cancelled") continue;
    ev.push({
      sk: f.sched_dep || normDate(f.date) + "T00:00", day: dayNum(f.date), date: f.date,
      kind: "flight", trip: null, from: f.from, to: f.to, transport: "flight", airline: f.airline,
      countries: [f.from?.country, f.to?.country].filter(Boolean), raw: f,
    });
  }
  for (const v of data.visits) {
    ev.push({
      sk: normDate(v.start) + "T23:59", day: dayNum(v.start), date: v.start, kind: "visit",
      trip: v.trip || null, place: v.place, lat: v.lat, lon: v.lon, transport: v.transport,
      precision: v.precision, notes: v.notes, country_name: v.country_name, countries: [v.country].filter(Boolean), raw: v,
    });
  }
  ev.sort((a, b) => {
    // same-day connecting flights: order so an arrival feeds the next departure,
    // even when the logged times are wrong (e.g. CUZ→LIM then LIM→MDE).
    if (a.kind === "flight" && b.kind === "flight" && a.date === b.date) {
      if (a.to?.iata && a.to.iata === b.from?.iata) return -1;
      if (b.to?.iata && b.to.iata === a.from?.iata) return 1;
    }
    return a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0;
  });

  const clusters = [];
  let cur = null;
  for (const e of ev) {
    if (e.day == null) continue;
    if (cur) {
      const last = cur.events[cur.events.length - 1];
      const gap = e.day - last.day;
      const same = e.trip && cur.trip && e.trip === cur.trip;
      const diff = e.trip && cur.trip && e.trip !== cur.trip;
      const boundary = TRIP_BOUNDARIES.some((b) => last.date < b && e.date >= b);
      // a long gap only ends a trip when you're NOT stranded abroad mid-trip — a
      // flight that left you in a foreign country still has a return flight to come,
      // so the quiet weeks in between are part of the same trip.
      const stranded = last.kind === "flight" && last.to?.country && last.to.country !== homeIsoOn(last.date);
      const splitGap = gap > TRIP_GAP_DAYS && !stranded;
      // a home-country "excursion" (an approximate-date day trip, untagged, no
      // flight) must not share a trip with international flights — keep them apart.
      const exc = (x) => x.kind === "visit" && !x.trip && /approx_year|month|recurring/.test(x.precision || "") && x.countries[0] === homeIsoOn(x.date);
      const excursionFlip = exc(e) !== exc(last);
      // a flight that starts after a flight-less overland segment (e.g. a Eurostar
      // day-trip) begins a new trip rather than extending the overland one.
      const flightAfterOverland = e.kind === "flight" && !cur.events.some((x) => x.kind === "flight") && cur.events.some((x) => x.kind === "visit");
      // a same-airport onward flight within a day is a connection (e.g. NOU→SYD→MEL),
      // so the home-country arrival at SYD shouldn't close the trip there.
      const connecting = e.kind === "flight" && last.kind === "flight" && e.from?.iata && e.from.iata === last.to?.iata && gap <= 1;
      const reallyClosed = cur.closed && !connecting;
      if (boundary || excursionFlip || (!same && (diff || reallyClosed || splitGap || flightAfterOverland))) { clusters.push(cur); cur = null; }
    }
    if (!cur) cur = { events: [], trip: e.trip || null, abroad: false, closed: false };
    cur.events.push(e);
    if (!cur.trip && e.trip) cur.trip = e.trip;
    const h = homeIsoOn(e.date);
    if (e.countries.some((c) => c !== h)) cur.abroad = true;
    if (e.kind === "flight" && h && e.to?.country === h && cur.abroad) cur.closed = true;
  }
  if (cur) clusters.push(cur);

  const usedIds = {};
  return clusters.map((cl) => {
    const evs = cl.events;
    const start = evs[0].date;
    let end = evs[evs.length - 1].date;
    for (const e of evs) if (e.raw?.end && e.raw.end > end) end = e.raw.end; // a visit's end date can extend the trip

    const startDay = evs[0].day, endDay = dayNum(end); // dayNum(end) honours a visit's extended end date
    const flights = evs.filter((e) => e.kind === "flight");
    // detect pure layover airports (arrive then depart the same airport <24h apart)
    const connIata = new Set();
    for (let i = 0; i < flights.length - 1; i++) {
      const a = flights[i], b = flights[i + 1];
      if (!a.to?.iata || a.to.iata !== b.from?.iata) continue;
      const arr = a.raw.sched_arr || a.raw.actual_arr, dep = b.raw.sched_dep || b.raw.actual_dep;
      const conn = arr && dep ? (new Date(dep) - new Date(arr)) < 24 * 3600 * 1000 : a.date === b.date;
      if (conn) connIata.add(a.to.iata);
    }
    // a country is a real stop if it was visited, or touched by a non-layover flight endpoint
    const realIso = new Set();
    evs.forEach((e) => { if (e.kind === "visit" && e.countries[0]) realIso.add(e.countries[0]); });
    flights.forEach((e) => {
      for (const ep of [e.from, e.to]) if (ep?.country && !connIata.has(ep.iata)) realIso.add(ep.country);
    });
    const isoSet = new Set();
    evs.forEach((e) => e.countries.forEach((c) => isoSet.add(c)));
    const allCountries = [...isoSet].map((c) => byIso[c]).filter(Boolean);
    const homeIso = homeIsoOn(start);
    // drop home (unless domestic) and drop layover-only countries from flags/name
    let countries = allCountries.filter((c) => realIso.has(c.iso3) && c.iso3 !== homeIso);
    if (!countries.length) countries = allCountries.filter((c) => c.iso3 !== homeIso);
    if (!countries.length) countries = allCountries;
    const transports = new Set();
    evs.forEach((e) => transportCats(e.transport).forEach((t) => transports.add(t)));
    const distance = flights.reduce((s, e) => s + (e.raw.distance_km || 0), 0);
    const nights = evs.filter((e) => e.kind === "visit").reduce((s, e) => s + (e.raw.nights || 0), 0);
    const places = [...new Set(evs.map((e) => e.place).filter(Boolean))];
    const spanDays = Math.max(1, Math.round(endDay - startDay) + 1);

    // stable id: explicit tag, else start date (+ counter on the rare collision)
    let id = cl.trip || start;
    if (usedIds[id]) { const n = ++usedIds[id]; id = `${id}#${n}`; } else usedIds[id] = 1;

    // auto name from (non-home) countries
    const names = countries.map((c) => c.name);
    let auto;
    if (!names.length) auto = "Trip";
    else if (names.length <= 3) auto = names.join(", ");
    else auto = `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
    // birthday: a trip spanning 20 July (same calendar year)
    const y = start.slice(0, 4);
    const birthday = y === end.slice(0, 4) && start <= `${y}-07-20` && end >= `${y}-07-20`;
    const defaultName = CURATED_TRIP_NAMES[id] || (birthday ? `${auto} · Birthday` : auto);

    const mapLegs = flights
      .filter((e) => Number.isFinite(e.from?.lat) && Number.isFinite(e.to?.lat))
      .map((e) => ({ from: { lat: e.from.lat, lon: e.from.lon }, to: { lat: e.to.lat, lon: e.to.lon } }));
    const mapPoints = [];
    evs.forEach((e) => {
      if (e.kind === "flight") {
        if (Number.isFinite(e.from?.lat)) mapPoints.push({ lat: e.from.lat, lon: e.from.lon });
        if (Number.isFinite(e.to?.lat)) mapPoints.push({ lat: e.to.lat, lon: e.to.lon });
      } else if (Number.isFinite(e.lat)) mapPoints.push({ lat: e.lat, lon: e.lon });
    });
    // Overland legs. International / tagged trips CHAIN: airport → place → place →
    // … → departure airport (incl. the drive back to catch the flight). Pure
    // domestic day-trips RADIATE from the home base of the time (separate spokes).
    const hIso = homeIsoOn(start);
    const homeLoc = homeLocOn(start);
    // domestic = no flights and every stop is in the home country → render as
    // spokes radiating from home (separate day-trips). Anything abroad chains.
    const domestic = flights.length === 0 && evs.every((e) => e.kind === "flight" || e.countries[0] === hIso);
    const mapGround = [];
    const mapInferred = []; // unlogged-but-inferred flights (drawn faint + dotted)
    let prevPt = null, prevKind = null, hadAir = false, lastPt = null;
    const moved = (a, b) => a.lat !== b.lat || a.lon !== b.lon;
    const haversine = (a, b) => { const R = 6371, r = (x) => (x * Math.PI) / 180; const s = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
    const groundOK = (a, b, cat) => cat === "sea" || haversine(a, b) <= 1500; // a >1500km "drive" is a sort artifact (e.g. a day-trip mid-connection); skip the line
    evs.forEach((e) => {
      if (e.kind === "flight") {
        const fromPt = Number.isFinite(e.from?.lat) ? { lat: e.from.lat, lon: e.from.lon } : null;
        if (prevKind === "visit" && prevPt && fromPt && moved(prevPt, fromPt) && groundOK(prevPt, fromPt, "road")) {
          mapGround.push({ from: prevPt, to: fromPt, cat: "road", date: e.date }); // drove to the departure airport
        }
        if (Number.isFinite(e.to?.lat)) { prevPt = { lat: e.to.lat, lon: e.to.lon }; prevKind = "flight"; lastPt = prevPt; }
        return;
      }
      if (!Number.isFinite(e.lat)) return;
      const pt = { lat: e.lat, lon: e.lon }, cat = transportCat(e.transport);
      if (cat === "air") {
        const a = prevPt || homeLoc;                 // an unlogged flight — infer it
        if (a && moved(a, pt)) mapInferred.push({ from: a, to: pt, date: e.date });
        hadAir = true;
      } else {
        const chain = e.trip || !domestic;           // tagged route or abroad → chain
        let anchor;
        if (!chain) anchor = homeLoc;                // domestic day-trip → spoke from home
        else if (prevPt) anchor = prevPt;            // chain from the previous logged point
        else anchor = (cat === "rail" || e.countries[0] === hIso) ? homeLoc : null; // Eurostar from home, or a home-country departure point (e.g. drove to the ferry); fly-in trips don't fake a line
        if (anchor && moved(anchor, pt) && groundOK(anchor, pt, cat)) mapGround.push({ from: anchor, to: pt, cat, date: e.date });
      }
      prevPt = pt; prevKind = "visit"; lastPt = pt;
    });
    // infer the flight home for a trip that flew out but logged no flights
    if (flights.length === 0 && hadAir && homeLoc && lastPt && moved(lastPt, homeLoc)) {
      mapInferred.push({ from: lastPt, to: homeLoc, date: end });
    }
    // show the home hub for domestic spoke trips
    if (domestic && homeLoc && mapGround.length) mapPoints.push({ lat: homeLoc.lat, lon: homeLoc.lon });
    // the map frames on where you actually went (the ground stops), so the home
    // base / long-haul airports fall off the edge with their legs running off-screen.
    // Pure flight trips (no ground stops) fall back to all points.
    const visitPts = evs.filter((e) => e.kind === "visit" && Number.isFinite(e.lat)).map((e) => ({ lat: e.lat, lon: e.lon }));
    const mapFocus = visitPts.length ? visitPts.slice() : mapPoints.slice();
    if (domestic && homeLoc) mapFocus.push({ lat: homeLoc.lat, lon: homeLoc.lon });

    return {
      id, explicit: cl.trip, defaultName, birthday, start, end, startDay,
      year: +start.slice(0, 4), endDay, countries, transports: [...transports], flights, events: evs,
      distance, nights, places, spanDays, mapLegs, mapPoints, mapGround, mapInferred, mapFocus,
      dateLabel: tripDateRange(start, end),
      upcoming: start > TODAY_STR || undefined, // trip hasn't started yet → shown as upcoming, excluded from counts
    };
  }).sort((a, b) => b.startDay - a.startDay);
}

export const TRIPS = buildTrips();

// ---- per-trip user metadata (name overrides, memories, recommendations) -----
// Stored client-side so the owner can edit without a backend. Keyed by trip id.
const TRIP_META_KEY = "travelmap.tripmeta.v1";
export function loadTripMeta() {
  try { return JSON.parse(localStorage.getItem(TRIP_META_KEY)) || {}; } catch { return {}; }
}
export function saveTripMeta(meta) {
  try { localStorage.setItem(TRIP_META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
}

// ---- wishlist (want-to-go places) ------------------------------------------
const WISHLIST_KEY = "travelmap.wishlist.v1";
export function loadWishlist() {
  try { return JSON.parse(localStorage.getItem(WISHLIST_KEY)) || []; } catch { return []; }
}
export function saveWishlist(list) {
  try { localStorage.setItem(WISHLIST_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
export const newId = () => (globalThis.crypto?.randomUUID?.() || `w-${Date.now()}-${Math.round(Math.random() * 1e6)}`);

// Ask the serverless function for AI destination suggestions.
export async function fetchSuggestions({ visited, wishlist, preferences }) {
  const r = await fetch("/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ visited, wishlist, preferences }),
  });
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    try { msg = (await r.json()).message || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await r.json()).suggestions || [];
}
