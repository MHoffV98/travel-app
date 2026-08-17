// build_data.js — re-runnable pipeline that turns the raw flight/manual data
// into site/src/travel_data.json + a human-readable discrepancy_report.md.
//
//   node pipeline/build_data.js
//
// Inputs (in data/, newest matching file wins):
//   - FlightyExport-*.csv / flighty.csv      (flight log A: rich actuals)
//   - flightdiary_*.csv    / fr24.csv        (flight log B: FR24)
//   - manual_trips.csv                       (authoritative pre-2016 / overland / cruise)
//   - country_reconciliation.csv             (validation reference)
//   - airports.dat                           (downloaded + cached on first run)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AIRPORT_OVERRIDES, EQUIVALENT_AIRPORTS, TRANSIT_ONLY, LAYOVER_VISIT,
  BEEN_ONLY, HOME_BASE_ERAS, BIRTH, ISO3, NAME_BY_ISO3, recommendationsKey,
  FLIGHT_CORRECTIONS, ISO2, TERRITORIES, TERRITORY_PARENT,
} from "./overrides.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const OUT_JSON = path.join(ROOT, "site", "src", "travel_data.json");
const OUT_REPORT = path.join(ROOT, "discrepancy_report.md");
const AIRPORTS_CACHE = path.join(__dirname, "airports.dat");
const AIRPORTS_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat";

const TODAY = new Date();
const BUILD_DATE = TODAY.toISOString().slice(0, 10);

const report = []; // discrepancy report lines
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------
// CSV parsing (RFC-4180-ish: quoted fields, embedded commas/quotes/newlines)
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim().length));
}

function readCsvObjects(file) {
  const rows = parseCSV(fs.readFileSync(file, "utf8"));
  // Some exports have a leading blank line before the header.
  let headerIdx = 0;
  while (headerIdx < rows.length && rows[headerIdx].every(c => !c.trim())) headerIdx++;
  const header = rows[headerIdx].map(h => h.trim());
  return rows.slice(headerIdx + 1).map(r => {
    const o = {};
    header.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    return o;
  });
}

function newestFile(patterns) {
  const files = fs.readdirSync(DATA);
  for (const pat of patterns) {
    const re = new RegExp(pat);
    const hits = files.filter(f => re.test(f)).map(f => ({ f, m: fs.statSync(path.join(DATA, f)).mtimeMs }));
    if (hits.length) { hits.sort((a, b) => b.m - a.m); return path.join(DATA, hits[0].f); }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Airports
// ---------------------------------------------------------------------------
async function loadAirports() {
  if (!fs.existsSync(AIRPORTS_CACHE)) {
    log("Downloading OpenFlights airports.dat …");
    const res = await fetch(AIRPORTS_URL);
    if (!res.ok) throw new Error(`airports.dat download failed: ${res.status}`);
    fs.writeFileSync(AIRPORTS_CACHE, await res.text());
  }
  const rows = parseCSV(fs.readFileSync(AIRPORTS_CACHE, "utf8"));
  const byIata = {};
  for (const r of rows) {
    // 0 id,1 name,2 city,3 country,4 IATA,5 ICAO,6 lat,7 lon,...
    const iata = (r[4] || "").replace(/\\N/g, "").trim();
    if (!iata || iata === "" || iata.length !== 3) continue;
    byIata[iata] = {
      iata, name: r[1], city: r[2], country: r[3],
      lat: parseFloat(r[6]), lon: parseFloat(r[7]),
    };
  }
  // Apply overrides (country reassignment + missing/closed airports).
  for (const [iata, ov] of Object.entries(AIRPORT_OVERRIDES)) {
    byIata[iata] = { iata, name: byIata[iata]?.name || iata, city: byIata[iata]?.city || "",
      ...byIata[iata], ...ov };
  }
  return byIata;
}

// ---------------------------------------------------------------------------
// Parse the two flight logs into a common record shape
// ---------------------------------------------------------------------------
const iataFromFR24 = s => (s.match(/\((\w{3})\//) || [])[1] || null;
const nameBeforeParen = s => s.replace(/\s*\(.*$/, "").trim();
const durToMin = s => {
  const m = (s || "").match(/^(\d+):(\d+)(?::\d+)?$/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
};
function combineDateTime(date, hhmmss) {
  if (!date || !hhmmss) return null;
  return `${date}T${hhmmss.slice(0, 5)}`;
}

function parseFlighty(file) {
  return readCsvObjects(file).map(r => {
    const sched_dep = r["Gate Departure (Scheduled)"] || null;
    const actual_dep = r["Gate Departure (Actual)"] || null;
    const sched_arr = r["Gate Arrival (Scheduled)"] || null;
    const actual_arr = r["Gate Arrival (Actual)"] || null;
    return {
      source: "flighty",
      date: r.Date,
      dep: r.From, arr: r.To,
      flight_number: r.Airline && r.Flight ? `${r.Airline}${r.Flight}` : (r.Flight || null), // ICAO+num
      airline_code: r.Airline || null,
      airline_name: null,
      aircraft: r["Aircraft Type Name"] || null,
      registration: r["Tail Number"] || null,
      sched_dep, actual_dep, sched_arr, actual_arr,
      duration_min: null,
      seat: r.Seat || null,
      cabin: r["Cabin Class"] || null,
      notes: r.Notes || null,
      canceled: (r.Canceled || "").toLowerCase() === "true",
      diverted_to: r["Diverted To"] || null,
    };
  });
}

// FR24 "Flight class" codes (2=Business confirmed by a "first time in business"
// note; 4=Premium economy matches a known prem-econ flight).
const FR24_CABIN = { "1": "ECONOMY", "2": "BUSINESS", "3": "FIRST", "4": "PREMIUM_ECONOMY" };

function parseFR24(file) {
  return readCsvObjects(file).map(r => {
    const date = r.Date;
    const dep = iataFromFR24(r.From), arr = iataFromFR24(r.To);
    const depT = combineDateTime(date, r["Dep time"]);
    let arrT = combineDateTime(date, r["Arr time"]);
    // overnight: arrival clock earlier than departure -> next day
    if (depT && arrT && r["Arr time"] < r["Dep time"]) {
      const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + 1);
      arrT = combineDateTime(d.toISOString().slice(0, 10), r["Arr time"]);
    }
    return {
      source: "fr24",
      date, dep, arr,
      flight_number: r["Flight number"] || null, // IATA
      airline_code: null,
      airline_name: r.Airline ? nameBeforeParen(r.Airline) : null,
      aircraft: r.Aircraft ? nameBeforeParen(r.Aircraft) : null,
      registration: r.Registration || null,
      sched_dep: depT, actual_dep: null, sched_arr: arrT, actual_arr: null,
      duration_min: durToMin(r.Duration),
      seat: r["Seat number"] || null,
      cabin: FR24_CABIN[(r["Flight class"] || "").trim()] || null,
      notes: r.Note || null,
      canceled: false,
      diverted_to: null,
    };
  });
}

// Apply user-confirmed source corrections (idempotent). Mutates the arrays.
function shiftDays(ts, days) {
  if (!ts) return ts;
  const [d, t] = ts.split("T");
  const dt = new Date(d + "T00:00:00"); dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10) + (t ? "T" + t : "");
}
function applyCorrections(flighty, fr24) {
  const bySource = { flighty, fr24 };
  for (const corr of FLIGHT_CORRECTIONS) {
    const arr = bySource[corr.source];
    if (!arr) continue;
    let hit = false;
    for (let i = arr.length - 1; i >= 0; i--) {
      const r = arr[i];
      if (r.date === corr.match.date && r.dep === corr.match.dep && r.arr === corr.match.arr) {
        hit = true;
        if (corr.delete) {
          arr.splice(i, 1);
          report.push(`- Correction: removed ${corr.source} ${r.date} ${r.dep}→${r.arr} (${corr.note})`);
        } else if (corr.setDate) {
          const days = Math.round((new Date(corr.setDate) - new Date(r.date)) / 86400000);
          report.push(`- Correction: ${corr.source} ${r.dep}→${r.arr} ${r.date} → ${corr.setDate} (${corr.note})`);
          r.date = corr.setDate;
          for (const f of ["sched_dep", "actual_dep", "sched_arr", "actual_arr"]) r[f] = shiftDays(r[f], days);
        }
      }
    }
    if (!hit) report.push(`- Correction no-op (already applied in export?): ${corr.source} ${corr.match.dep}→${corr.match.arr} ${corr.match.date}`);
  }
}

// Collapse exact within-source duplicates (same date+dep+arr). Keeps the first,
// notes the rest. Legitimate multi-leg flights under one number survive because
// the key includes the route.
function dedupeWithin(recs, label) {
  const seen = new Map(); const out = [];
  for (const r of recs) {
    if (!r.dep || !r.arr || !r.date) { out.push(r); continue; }
    const k = `${r.date}|${r.dep}|${r.arr}`;
    if (seen.has(k)) { report.push(`- Duplicate within ${label} collapsed: ${r.date} ${r.dep}→${r.arr} ${r.flight_number || ""}`.trim()); continue; }
    seen.set(k, true); out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Merge the two logs
// ---------------------------------------------------------------------------
const canonAirport = (() => {
  const rep = {};
  for (const pair of EQUIVALENT_AIRPORTS) {
    const r = rep[pair[0]] || rep[pair[1]] || pair[1];
    rep[pair[0]] = r; rep[pair[1]] = r;
  }
  return iata => rep[iata] || iata;
})();
const dayDiff = (a, b) => Math.abs((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000);

function mergeFlights(flighty, fr24) {
  const merged = [];
  const usedFR = new Set();

  function mergeOne(f, x) {
    // f = flighty (preferred for times/actuals/aircraft/cabin/seat), x = fr24
    return {
      flighty: f, fr24: x,
      date: f?.date || x?.date,
      dep: f?.dep || x?.dep, arr: f?.arr || x?.arr,
      flight_number: x?.flight_number || f?.flight_number || null, // prefer FR24 IATA form
      airline_name: x?.airline_name || f?.airline_code || null,
      airline_code: f?.airline_code || null,
      aircraft: f?.aircraft || x?.aircraft || null,
      registration: f?.registration || x?.registration || null,
      sched_dep: f?.sched_dep || x?.sched_dep || null,
      actual_dep: f?.actual_dep || null,
      sched_arr: f?.sched_arr || x?.sched_arr || null,
      actual_arr: f?.actual_arr || null,
      duration_min: x?.duration_min ?? f?.duration_min ?? null,
      seat: f?.seat || x?.seat || null,
      cabin: f?.cabin || x?.cabin || null,
      notes: f?.notes || x?.notes || null,
      canceled: !!(f?.canceled || x?.canceled),
      diverted_to: f?.diverted_to || null,
      sources: [f && "flighty", x && "fr24"].filter(Boolean),
    };
  }

  // index fr24 by canonical key
  const fr24ByKey = new Map();
  fr24.forEach((x, i) => {
    if (!x.dep || !x.arr) return;
    const k = `${x.date}|${canonAirport(x.dep)}|${canonAirport(x.arr)}`;
    if (!fr24ByKey.has(k)) fr24ByKey.set(k, []);
    fr24ByKey.get(k).push(i);
  });

  // Pass 1: exact (same date + dep + arr, with equivalence)
  const fuzzyQueue = [];
  for (const f of flighty) {
    if (!f.dep || !f.arr) { merged.push(mergeOne(f, null)); continue; }
    const k = `${f.date}|${canonAirport(f.dep)}|${canonAirport(f.arr)}`;
    const cands = (fr24ByKey.get(k) || []).filter(i => !usedFR.has(i));
    if (cands.length) { usedFR.add(cands[0]); merged.push(mergeOne(f, fr24[cands[0]])); }
    else fuzzyQueue.push(f);
  }

  // Pass 2: fuzzy (same dep+arr w/ equivalence, ±1 day)
  for (const f of fuzzyQueue) {
    let best = -1;
    for (let i = 0; i < fr24.length; i++) {
      if (usedFR.has(i)) continue;
      const x = fr24[i];
      if (!x.dep || !x.arr) continue;
      if (canonAirport(f.dep) !== canonAirport(x.dep)) continue;
      if (canonAirport(f.arr) !== canonAirport(x.arr)) continue;
      if (dayDiff(f.date, x.date) <= 1) { best = i; break; }
    }
    if (best >= 0) {
      usedFR.add(best);
      report.push(`- Fuzzy ±1d match: ${f.dep}→${f.arr} flighty ${f.date} ↔ fr24 ${fr24[best].date} (${f.flight_number || fr24[best].flight_number})`);
      merged.push(mergeOne(f, fr24[best]));
    } else {
      merged.push(mergeOne(f, null)); // single-source flighty
    }
  }

  // Remaining unmatched FR24 = single-source fr24
  fr24.forEach((x, i) => { if (!usedFR.has(i)) merged.push(mergeOne(null, x)); });

  return merged;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
function haversineKm(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(Number.isFinite)) return null;
  const R = 6371, toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
const delayMin = (sched, actual) => (sched && actual) ? Math.round((new Date(actual) - new Date(sched)) / 60000) : null;

// ---------------------------------------------------------------------------
// In the Vercel build only: pull any flight export uploaded from the app (stored
// in the private Blob store at inputs/*.csv) into data/, so a publish/rebuild
// ingests it. Local runs (the code machine) use data/ as-is. Robust — any failure
// (no store connected, no token, network) falls back to whatever's in data/.
async function pullCloudInputs() {
  if (!process.env.VERCEL) return;
  let blob;
  try { blob = await import("@vercel/blob"); } catch { return; }
  try {
    const { blobs } = await blob.list({ prefix: "inputs/" });
    for (const b of blobs) {
      const name = b.pathname.split("/").pop();
      if (!/^(flighty|fr24)\.csv$/.test(name)) continue;
      const g = await blob.get(b.pathname, { access: "private" });
      if (g && g.statusCode === 200) {
        fs.writeFileSync(path.join(DATA, name), await new Response(g.stream).text());
        console.log(`[cloud] pulled ${name} from Blob (app upload)`);
      }
    }
  } catch (e) { console.log(`[cloud] inputs skipped: ${e.message}`); }
}

// Main
// ---------------------------------------------------------------------------
async function main() {
  await pullCloudInputs();
  const flightyFile = newestFile(["^FlightyExport.*\\.csv$", "^flighty\\.csv$"]);
  const fr24File = newestFile(["^flightdiary.*\\.csv$", "^fr24\\.csv$"]);
  const manualFile = path.join(DATA, "manual_trips.csv");
  const reconFile = path.join(DATA, "country_reconciliation.csv");
  if (!flightyFile || !fr24File) throw new Error("Missing flight exports in data/");
  log(`Flighty: ${path.basename(flightyFile)}`);
  log(`FR24:    ${path.basename(fr24File)}`);

  const airports = await loadAirports();
  const iso3of = name => ISO3[name] || null;

  let flighty = parseFlighty(flightyFile);
  let fr24 = parseFR24(fr24File);
  applyCorrections(flighty, fr24);
  flighty = dedupeWithin(flighty, "flighty");
  fr24 = dedupeWithin(fr24, "fr24");
  log(`Parsed: ${flighty.length} flighty, ${fr24.length} fr24`);

  const mergedRaw = mergeFlights(flighty, fr24);

  // Enrich + finalize flights
  const unmappedIata = new Set();
  const geoOf = iata => {
    const a = airports[iata];
    if (!a) { if (iata) unmappedIata.add(iata); return null; }
    return a;
  };

  const flights = mergedRaw.map(m => {
    const from = geoOf(m.dep), to = geoOf(m.arr);
    const fromCountry = from?.country ? iso3of(from.country) : null;
    const toCountry = to?.country ? iso3of(to.country) : null;
    if (from && !fromCountry) report.push(`- Country not mapped to ISO3: "${from.country}" (airport ${m.dep})`);
    if (to && !toCountry) report.push(`- Country not mapped to ISO3: "${to.country}" (airport ${m.arr})`);
    const dep_delay = delayMin(m.sched_dep, m.actual_dep);
    const arr_delay = delayMin(m.sched_arr, m.actual_arr);
    let status = "flown";
    if (m.canceled) status = "cancelled";
    else if (m.date > BUILD_DATE) status = "booked";
    return {
      id: `${m.date}-${m.dep}-${m.arr}`,
      date: m.date,
      from: from ? { iata: m.dep, lat: from.lat, lon: from.lon, city: from.city, country: fromCountry } : { iata: m.dep },
      to: to ? { iata: m.arr, lat: to.lat, lon: to.lon, city: to.city, country: toCountry } : { iata: m.arr },
      airline: m.airline_name,
      flight_number: m.flight_number,
      distance_km: haversineKm(from, to),
      duration_min: m.duration_min,
      sched_dep: m.sched_dep, actual_dep: m.actual_dep,
      sched_arr: m.sched_arr, actual_arr: m.actual_arr,
      dep_delay_min: dep_delay, arr_delay_min: arr_delay,
      delay_min: arr_delay ?? dep_delay,
      aircraft: m.aircraft, registration: m.registration,
      seat: m.seat, cabin: m.cabin,
      status, sources: m.sources,
      _toCountryName: to?.country || null,
      _depTime: m.sched_dep, _arrTime: m.sched_arr,
    };
  }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // -------------------------------------------------------------------------
  // Manual trips -> visits[]
  // -------------------------------------------------------------------------
  const manualRows = readCsvObjects(manualFile);
  const visits = manualRows.map(r => ({
    country: iso3of(r.country),
    country_name: r.country,
    start: r.start_date || null,
    end: r.end_date || null,
    precision: r.date_precision || null,
    transport: r.transport || null,
    kind: r.type || "visit", // visit | transit
    source: "manual",
    notes: r.notes || null,
    place: r.place || null,
    lat: r.lat ? parseFloat(r.lat) : null,
    lon: r.lon ? parseFloat(r.lon) : null,
    nights: r.nights ? parseInt(r.nights, 10) : null,
    trip: r.trip || null,
    // a manual trip dated after the build is "upcoming" — kept in the data so the
    // UI can show it, but excluded from all counts/nights/status (like a booked flight).
    upcoming: (r.start_date || "") > BUILD_DATE || undefined,
  }));
  for (const v of visits) if (!v.country) report.push(`- Manual trip country not mapped to ISO3: "${v.country_name}"`);

  // -------------------------------------------------------------------------
  // Transit inference for flights (same-airport re-departure < 24h)
  // -------------------------------------------------------------------------
  const flown = flights.filter(f => f.status === "flown");
  // Chronological order by date, then departure clock-time, so an arrival always
  // precedes its onward same-day connection. (Source files sometimes list a same-
  // day onward departure BEFORE its inbound leg, which broke layover pairing and
  // made a pure airport connection look like a real visit.)
  const depClock = (f) => (f._depTime && f._depTime.includes("T") ? f._depTime.split("T")[1] : "12:00");
  flown.sort((a, b) => (`${a.date}T${depClock(a)}` < `${b.date}T${depClock(b)}` ? -1 : 1));
  // Mark each flight arrival as transit if the next departure from that same
  // airport is within 24h, OR on the same calendar day (the same-day check also
  // covers inconsistent source times where the 24h math would mis-fire).
  for (let i = 0; i < flown.length; i++) {
    const f = flown[i];
    f._arrivalTransit = false;
    const arrIata = f.to.iata, arrT = f._arrTime;
    for (let j = i + 1; j < flown.length; j++) {
      const g = flown[j];
      if (g.from.iata !== arrIata) continue;
      let transit = false;
      if (arrT && g._depTime) {
        const h = (new Date(g._depTime) - new Date(arrT)) / 3600000;
        if (h >= 0 && h <= 24) transit = true;
      }
      if (!transit && f.date === g.date) transit = true;
      if (transit) { f._arrivalTransit = true; g._layoverDep = true; }
      break; // only the next departure from this airport matters
    }
  }

  // -------------------------------------------------------------------------
  // Nights per country (between consecutive flown flights -> preceding arrival)
  // -------------------------------------------------------------------------
  const nightsByIso = {};
  const homeNightsByIso = {};
  // per-stay night events: {date, nights}. Used to decide whether a clustered
  // "stay" actually involved an overnight (so 0-night layovers don't count as a
  // trip / visited-year). Mirrors exactly what gets added to nightsByIso.
  const nightEventsByIso = {};
  const pushNight = (iso, date, nights) => { if (iso && nights > 0) (nightEventsByIso[iso] ||= []).push({ date, nights }); };
  function inHomeEra(dateStr, iso) {
    for (const e of HOME_BASE_ERAS) {
      const after = dateStr >= e.start;
      const before = e.end == null || dateStr < e.end;
      if (after && before && ISO3[e.country] === iso) return true;
    }
    return false;
  }
  for (let i = 0; i < flown.length - 1; i++) {
    const a = flown[i], b = flown[i + 1];
    const iso = a.to.country;
    if (!iso) continue;
    if (a._arrivalTransit) continue; // don't attribute nights to a transit stop
    // Only credit the gap to this country if the NEXT flight also departs from it.
    // If you flew in but left by train/ferry (next departure is elsewhere), we
    // can't know how long you stayed — don't attribute the whole gap here.
    // (Fixed Amsterdam reading 122 nights from a fly-in / train-home gap.)
    if (b.from.country !== iso) continue;
    const t0 = a._arrTime ? new Date(a._arrTime) : new Date(a.date + "T12:00");
    const t1 = b._depTime ? new Date(b._depTime) : new Date(b.date + "T12:00");
    const nights = Math.max(0, Math.floor((t1 - t0) / 86400000));
    if (!nights) continue;
    // Hand-logged city stays in this window. If present they give the detail,
    // but they can under-sum the real span when some nights weren't pinned to a
    // named city (e.g. self-drive nights). So:
    //  · if ANOTHER country was logged (with nights) inside this window, it was
    //    an overland multi-country trip — trust the per-country manual sums.
    //  · otherwise the traveller was in THIS country the whole flight-bounded
    //    window, so top the total up to the full span (adds only the shortfall).
    const winVisits = visits.filter((v) => v.kind === "visit" && v.start >= a.date && v.start <= b.date);
    const manualSum = winVisits.filter((v) => v.country === iso && v.nights).reduce((s, v) => s + v.nights, 0);
    // Only an other-country stay strictly INSIDE the window signals an overland
    // multi-country trip. A visit on the boundary date (a.date / b.date) is just
    // the arrival day of the next leg (e.g. flew Lima→Medellín on the last day of
    // a Peru stay) and must not block this country's top-up.
    const otherCountry = winVisits.some((v) => v.country && v.country !== iso && v.nights && v.start > a.date && v.start < b.date);
    if (manualSum > 0 && otherCountry) continue; // overland multi-country — manual sums are authoritative
    // Top up a manually-logged single-country stay to the calendar-date span
    // (nights = nights slept = departure date − arrival date), which is what a
    // traveller counts; the time-based gap can read 1 short for a red-eye.
    const spanDays = Math.max(0, Math.round((new Date(b.date) - new Date(a.date)) / 86400000));
    const add = manualSum > 0 ? Math.max(0, spanDays - manualSum) : nights;
    if (!add) continue;
    nightsByIso[iso] = (nightsByIso[iso] || 0) + add;
    pushNight(iso, a.date, add);
    if (inHomeEra(a.date, iso)) homeNightsByIso[iso] = (homeNightsByIso[iso] || 0) + add;
  }
  // manual trips contribute nights: explicit `nights` if given, else derived
  // from a day-precision date range. These count as travel nights (not home).
  for (const v of visits) {
    if (v.kind !== "visit" || !v.country || v.upcoming) continue;
    let n = null;
    if (v.nights != null) n = v.nights;
    else if ((v.precision === "day" || v.precision === "day_approx") && v.start && v.end)
      n = Math.max(0, Math.floor((new Date(v.end) - new Date(v.start)) / 86400000));
    if (n) { nightsByIso[v.country] = (nightsByIso[v.country] || 0) + n; pushNight(v.country, v.start, n); }
  }

  // Residence nights: the years actually LIVED at each home base (e.g. ~18 years
  // in the UK before 2016). Tracked separately from travel nights so it doesn't
  // skew the choropleth scale, but surfaced as home_nights on the country.
  const residenceByIso = {};
  {
    const nowT = Date.now();
    for (const e of HOME_BASE_ERAS) {
      const iso = ISO3[e.country];
      if (!iso) continue;
      const t0 = new Date(e.start + "T12:00").getTime();
      const t1 = e.end ? new Date(e.end + "T12:00").getTime() : nowT;
      residenceByIso[iso] = (residenceByIso[iso] || 0) + Math.max(0, Math.floor((t1 - t0) / 86400000));
    }
  }

  // -------------------------------------------------------------------------
  // Countries aggregation
  // -------------------------------------------------------------------------
  const countryAgg = {}; // iso3 -> { ... }
  const ensure = iso => (countryAgg[iso] ||= {
    iso3: iso, name: NAME_BY_ISO3[iso] || iso,
    firstDates: [], realDates: [], visit_count: 0, transports: new Set(),
    hasFlightVisit: false, hasManual: false, transitOnly: false, layover: false,
  });

  // Flight touches. BOTH departure and arrival prove presence — some countries
  // (Cambodia/REP, Laos/LPQ, Uruguay/MVD) appear only as departures.
  // `real` = genuinely set foot in the country (not just an airside connection),
  // used to tell a real visit from a pure layover when counting trips.
  function touch(iso, name, date, real) {
    if (!iso) return null;
    const c = ensure(iso);
    c.transports.add("flight");
    c.firstDates.push(date);
    if (real) c.realDates.push(date);
    if (TRANSIT_ONLY.has(name)) c.transitOnly = true;
    else { c.hasFlightVisit = true; if (LAYOVER_VISIT.has(name)) c.layover = true; }
    return c;
  }
  let prevCountry = null;
  for (const f of flown) {
    const fromName = f.from.country ? NAME_BY_ISO3[f.from.country] : null;
    // a departure proves presence unless it's the onward leg of a layover
    touch(f.from.country, fromName, f.date, !f._layoverDep && !TRANSIT_ONLY.has(fromName));
    const iso = f.to.country, name = f._toCountryName;
    // an arrival proves presence unless you just connected straight onward
    const c = touch(iso, name, f.date, !f._arrivalTransit && !TRANSIT_ONLY.has(name));
    if (c && iso && !TRANSIT_ONLY.has(name)) {
      if (prevCountry !== iso) c.visit_count += 1; // new "leg" into a country
      if (!f._arrivalTransit) prevCountry = iso;
    }
  }

  // Manual visits — a logged place always proves a real (if brief) visit.
  for (const v of visits) {
    if (!v.country) continue;
    const c = ensure(v.country);
    if (v.transport) v.transport.split(/[+/]/).forEach(t => c.transports.add(t.trim()));
    // Future trips are recorded but don't count until they happen: the country is
    // flagged so it can still show on the upcoming trip (flag/name), but gets no
    // visit_count / nights / visited status.
    if (v.upcoming) { c.hasUpcoming = true; continue; }
    if (v.kind === "transit") { c.transitOnly = c.transitOnly || !c.hasFlightVisit; }
    else { c.hasManual = true; c.visit_count += 1; c.firstDates.push(v.start); c.realDates.push(v.start); }
  }

  // Birth country counts as visited from birth — so it's country #1 from 1998.
  const birthIso = iso3of(BIRTH.country);
  if (birthIso) { const c = ensure(birthIso); c.hasFlightVisit = true; c.firstDates.push(BIRTH.date); c.realDates.push(BIRTH.date); }

  // Been-only supplements (Monaco)
  for (const b of BEEN_ONLY) {
    const iso = iso3of(b.country); if (!iso) continue;
    const c = ensure(iso);
    c.hasManual = true; c.beenOnly = true;
    if (b.transport) c.transports.add(b.transport);
    report.push(`- Been-only country with no flight/manual data: ${b.country} (${b.notes})`);
  }

  // Finalize country list
  const minDate = arr => arr.filter(Boolean).sort()[0] || null;
  const maxDate = arr => arr.filter(Boolean).sort().at(-1) || null;

  // distinct cities visited per country (airports + manual places)
  const citiesByIso = {};
  const addCity = (iso, city) => { if (iso && city) (citiesByIso[iso] ||= new Set()).add(city); };
  for (const f of flown) { addCity(f.to.country, f.to.city); addCity(f.from.country, f.from.city); }
  for (const v of visits) if (v.kind === "visit" && v.country && v.place && !v.upcoming) addCity(v.country, v.place);

  // visit_count = distinct "stays": touches grouped, a new stay after a >14-day
  // gap. Touches while the country was the home base are excluded (so entry/exit
  // of home doesn't inflate the count — UK reads 0, i.e. "home").
  const isoHomeOn = (date) => {
    for (const e of HOME_BASE_ERAS) if (date >= e.start && (e.end == null || date < e.end)) return ISO3[e.country];
    return null;
  };
  // the current (ongoing) home — never counts as a "visit"
  const currentHomeIso = ISO3[(HOME_BASE_ERAS.find((e) => e.end == null) || {}).country];
  // every country that has ever been a home base (UK + Australia) — flagged so
  // the map can show them as "home" rather than looking unvisited
  const homeIsos = new Set(HOME_BASE_ERAS.map((e) => ISO3[e.country]).filter(Boolean));
  // 0-night layovers must NOT count as a trip or a visited-year. These specific
  // day-visits genuinely happened (exited the airport / crossed a border) despite
  // logging no overnight, so they're whitelisted as "iso|year".
  const COUNTED_DAY_VISITS = new Set([
    "HKG|2025", // Hong Kong day
    "SGP|2025", // Singapore day
    "XNC|2025", // Northern Cyprus day trip
    "TUR|2026", // Turkey day
  ]);
  // Cluster presence dates into "stays" (>14-day gap = new stay), then keep only
  // stays that were a genuine visit: an overnight, a real (non-transit) presence,
  // a logged place, or a whitelisted day-visit. Pure airport connections — where
  // every touch is an airside layover with no overnight — don't count as a trip.
  const computeStays = (dates, realDates, iso) => {
    const rel = dates.filter(Boolean).filter((d) => isoHomeOn(d) !== iso).sort();
    if (!rel.length) return { count: 0, years: [], first: null, last: null };
    const real = new Set(realDates.filter((d) => isoHomeOn(d) !== iso));
    const events = nightEventsByIso[iso] || [];
    const clusters = [];
    let cur = [rel[0]];
    for (let i = 1; i < rel.length; i++) {
      if (new Date(rel[i]) - new Date(rel[i - 1]) > 14 * 86400000) { clusters.push(cur); cur = [rel[i]]; }
      else cur.push(rel[i]);
    }
    clusters.push(cur);
    const qualifying = [];
    for (const cl of clusters) {
      const from = cl[0], to = cl[cl.length - 1];
      const nights = events.filter((e) => e.date >= from && e.date <= to).reduce((s, e) => s + e.nights, 0);
      const yrs = [...new Set(cl.map((d) => d.slice(0, 4)))];
      const whitelisted = yrs.some((y) => COUNTED_DAY_VISITS.has(`${iso}|${y}`));
      const hasReal = cl.some((d) => real.has(d));
      if (nights >= 1 || hasReal || whitelisted) qualifying.push({ from, to, yrs });
    }
    const years = [...new Set(qualifying.flatMap((q) => q.yrs))].sort();
    const ds = qualifying.flatMap((q) => [q.from, q.to]).sort();
    // start date of each qualifying stay — lets the country card show/number the
    // same trips as visit_count (excluding 0-night layover clusters).
    const starts = qualifying.map((q) => q.from);
    return { count: qualifying.length, years, first: ds[0] || null, last: ds.at(-1) || null, starts };
  };
  const precisionFor = (iso, date) => {
    // if the earliest date comes from a manual entry, use its precision
    const m = visits.filter(v => v.country === iso && v.start === date)[0];
    return m ? m.precision : "day";
  };
  const countries = Object.values(countryAgg).map(c => {
    const name = c.name;
    let status;
    if (TRANSIT_ONLY.has(name) || (c.transitOnly && !c.hasFlightVisit && !c.hasManual)) status = "transit";
    else if (c.hasFlightVisit || c.hasManual) status = "visited";
    else if (c.hasUpcoming) status = "upcoming"; // only reached by a future (not-yet-taken) trip
    else status = "transit";
    const isCurrentHome = c.iso3 === currentHomeIso;
    const stays = status === "visited" && !isCurrentHome ? computeStays(c.firstDates, c.realDates, c.iso3) : { count: 0, years: [], first: null, last: null };
    // first/last fall back to raw touch dates so a pure-layover visited country
    // (e.g. an airport-only stop) still has a date and stays on the map.
    const first_visit = status === "visited" ? (stays.first || minDate(c.firstDates)) : null;
    const last_visit = status === "visited" ? (stays.last || maxDate(c.firstDates)) : null;
    return {
      iso3: c.iso3, iso2: ISO2[c.iso3] || null, name,
      status,
      is_territory: TERRITORIES.has(c.iso3) || undefined,
      layover_visit: c.layover || LAYOVER_VISIT.has(name) || undefined,
      territory: c.iso3 === "SJM" ? "Svalbard" : undefined,
      been_only: c.beenOnly || undefined,
      first_visit,
      last_visit,
      first_visit_precision: first_visit ? precisionFor(c.iso3, first_visit) : undefined,
      visit_count: status === "visited" ? stays.count : 0,
      visit_years: stays.years.length ? stays.years : undefined,
      visit_starts: stays.starts && stays.starts.length ? stays.starts : undefined,
      is_home: homeIsos.has(c.iso3) || undefined,
      is_current_home: c.iso3 === currentHomeIso || undefined,
      cities: status === "visited" ? (citiesByIso[c.iso3]?.size || 0) : 0,
      nights: nightsByIso[c.iso3] ?? null,
      home_nights: (residenceByIso[c.iso3] || 0) || undefined,
      transports: [...c.transports].filter(Boolean),
      recommendations_key: recommendationsKey(c.iso3),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------
  const visited = countries.filter(c => c.status === "visited");
  const sovereignVisited = visited.filter(c => !TERRITORIES.has(c.iso3));
  const territoryVisited = visited.filter(c => TERRITORIES.has(c.iso3));
  const transitCountries = countries.filter(c => c.status === "transit");
  // sovereign states: directly-visited sovereigns + the sovereign parent credited
  // by any visited territory (e.g. Hong Kong credits China).
  const sovSet = new Set(sovereignVisited.map(c => c.iso3));
  for (const t of territoryVisited) { const p = TERRITORY_PARENT[t.iso3]; if (p) sovSet.add(p); }
  const dist = flown.reduce((s, f) => s + (f.distance_km || 0), 0);
  const airborneMin = flown.reduce((s, f) => s + (f.duration_min || 0), 0);
  const byYear = {};
  for (const f of flown) (byYear[f.date.slice(0, 4)] ||= 0, byYear[f.date.slice(0, 4)]++);
  const routeCount = {}, airportCount = {}, regCount = {}, airlineCount = {}, aircraftCount = {}, cabinCount = {};
  const dow = [0, 0, 0, 0, 0, 0, 0]; // Sun..Sat
  const CABIN = { ECONOMY: "Economy", PREMIUM_ECONOMY: "Premium", BUSINESS: "Business", FIRST: "First" };
  for (const f of flown) {
    const route = [f.from.iata, f.to.iata].sort().join("–");
    routeCount[route] = (routeCount[route] || 0) + 1;
    airportCount[f.from.iata] = (airportCount[f.from.iata] || 0) + 1;
    airportCount[f.to.iata] = (airportCount[f.to.iata] || 0) + 1;
    if (f.registration) regCount[f.registration] = (regCount[f.registration] || 0) + 1;
    if (f.airline) airlineCount[f.airline] = (airlineCount[f.airline] || 0) + 1;
    if (f.aircraft) aircraftCount[f.aircraft] = (aircraftCount[f.aircraft] || 0) + 1;
    dow[new Date(f.date + "T00:00").getDay()]++;
    const cab = CABIN[(f.cabin || "").toUpperCase()];
    if (cab) cabinCount[cab] = (cabinCount[cab] || 0) + 1;
  }
  const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])[0] || null;
  const topN = (obj, n = 8) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  const arrDelays = flown.map(f => f.arr_delay_min).filter(n => Number.isFinite(n));
  const onTime = arrDelays.filter(d => d <= 15).length;
  const distances = flown.filter(f => f.distance_km).sort((a, b) => a.distance_km - b.distance_km);
  const totalNights = Object.values(nightsByIso).reduce((a, b) => a + b, 0);
  const homeNights = Object.values(homeNightsByIso).reduce((a, b) => a + b, 0);
  const residenceTotal = Object.values(residenceByIso).reduce((a, b) => a + b, 0);

  const stats = {
    flights_flown: flown.length,
    flights_booked: flights.filter(f => f.status === "booked").length,
    flights_cancelled: flights.filter(f => f.status === "cancelled").length,
    distance_km: dist,
    times_around_earth: +(dist / 40075).toFixed(2),
    hours_airborne: Math.round(airborneMin / 60),
    airports: Object.keys(airportCount).length,
    airlines: Object.keys(airlineCount).length,
    aircraft_types: Object.keys(aircraftCount).length,
    top_routes: topN(routeCount),
    top_airports: topN(airportCount),
    top_airlines: topN(airlineCount),
    top_aircraft: topN(aircraftCount),
    day_of_week: dow,
    cabin_class: cabinCount,
    countries_visited: visited.length,
    countries_sovereign: sovSet.size,
    countries_territories: territoryVisited.length,
    countries_total: visited.length,
    countries_transit_only: transitCountries.length,
    layover_visits: visited.filter(c => c.layover_visit).length,
    nights_total: (totalNights - homeNights) + residenceTotal,
    nights_home: residenceTotal,
    nights_travel: totalNights - homeNights,
    busiest_year: top(byYear),
    flights_by_year: Object.fromEntries(Object.entries(byYear).sort()),
    longest_flight: distances.at(-1) ? { route: `${distances.at(-1).from.iata}→${distances.at(-1).to.iata}`, km: distances.at(-1).distance_km, date: distances.at(-1).date } : null,
    shortest_flight: distances[0] ? { route: `${distances[0].from.iata}→${distances[0].to.iata}`, km: distances[0].distance_km, date: distances[0].date } : null,
    most_flown_route: top(routeCount),
    most_visited_airport: top(airportCount),
    most_flown_registration: top(regCount),
    delays: {
      records_with_actuals: arrDelays.length,
      on_time_pct: arrDelays.length ? Math.round((onTime / arrDelays.length) * 100) : null,
      avg_delay_min: arrDelays.length ? Math.round(arrDelays.reduce((a, b) => a + b, 0) / arrDelays.length) : null,
      worst_delay_min: arrDelays.length ? Math.max(...arrDelays) : null,
    },
    first_country: (() => {
      // Earliest-visited country abroad (excludes home bases), computed from the
      // data so it stays correct as trips are added/re-dated.
      const norm = (d) => (d.length === 4 ? `${d}-01-01` : d.length === 7 ? `${d}-01` : d);
      const foreign = visited
        .filter(c => !c.is_home && c.first_visit)
        .sort((a, b) => (norm(a.first_visit) < norm(b.first_visit) ? -1 : 1))[0];
      if (!foreign) return null;
      const age = Math.floor((Date.parse(norm(foreign.first_visit)) - Date.parse(BIRTH.date)) / (365.25 * 86400000));
      return { name: foreign.name, date: foreign.first_visit, note: age <= 0 ? "visited as a baby" : `visited at age ${age}` };
    })(),
  };

  // -------------------------------------------------------------------------
  // Validation against country_reconciliation.csv
  // -------------------------------------------------------------------------
  const recon = readCsvObjects(reconFile);
  const VISITED_STATES = new Set(["confirmed_flight_visit", "pre2016_trip", "overland_crossing", "been_only_no_flight"]);
  const expectVisited = new Set(), expectTransit = new Set();
  for (const r of recon) {
    const iso = iso3of(r.country);
    if (!iso) { report.push(`- Reconciliation country not mapped to ISO3: "${r.country}"`); continue; }
    if (r.status === "transit_only_confirmed") expectTransit.add(iso);
    else if (VISITED_STATES.has(r.status)) expectVisited.add(iso);
  }
  const gotVisited = new Set(visited.map(c => c.iso3));
  const gotTransit = new Set(transitCountries.map(c => c.iso3));
  const assertions = [];
  for (const iso of expectVisited) if (!gotVisited.has(iso)) assertions.push(`MISSING visited country: ${NAME_BY_ISO3[iso] || iso}`);
  for (const iso of expectTransit) if (!gotTransit.has(iso)) assertions.push(`MISSING transit country: ${NAME_BY_ISO3[iso] || iso}`);
  for (const iso of gotVisited) if (expectTransit.has(iso)) assertions.push(`Country marked visited but reconciliation says transit-only: ${NAME_BY_ISO3[iso] || iso}`);

  // Section-2 correction checks
  const has = (src, date, dep, arr) => (src === "flighty" ? flighty : fr24).some(r => r.date === date && r.dep === dep && r.arr === arr);
  const corrChecks = [
    ["FR24 NAP→MXP is Sep 2018", has("fr24", "2018-09-22", "NAP", "MXP")],
    ["FR24 MXP→MAN is Sep 2018", has("fr24", "2018-09-22", "MXP", "MAN")],
    ["FR24 MAN→FAO is 24 Sep 2018", has("fr24", "2018-09-24", "MAN", "FAO")],
    ["Flighty MAN→AMS is 18 Nov 2019", has("flighty", "2019-11-18", "MAN", "AMS")],
    ["Flighty SPU→MAN is 31 Jul 2017", has("flighty", "2017-07-31", "SPU", "MAN")],
    ["FR24 SIN→MEL is QF38 25 Nov 2025", fr24.some(r => r.date === "2025-11-25" && r.dep === "SIN" && r.arr === "MEL")],
    ["FR24 LGW→BGO is 3 Oct 2024", has("fr24", "2024-10-03", "LGW", "BGO")],
    ["18 Jul 2025 is LCY→LIN (not STN→GOA)", has("fr24", "2025-07-18", "LCY", "LIN") && !has("fr24", "2025-07-18", "STN", "GOA")],
    ["EZE→SCL 27 Jan 2024 deleted", !has("fr24", "2024-01-27", "EZE", "SCL") && !has("flighty", "2024-01-27", "EZE", "SCL")],
    ["Phantom STN→TLS 31 May 2025 deleted from Flighty", !has("flighty", "2025-05-31", "STN", "TLS")],
    ["Added QF475 SYD→MEL 27 Mar 2023 present", has("fr24", "2023-03-27", "SYD", "MEL")],
    ["Added DL2265 BOS→LGA 16 Feb 2024 present", has("fr24", "2024-02-16", "BOS", "LGA")],
    ["Added BA302 LHR→CDG 8 Nov 2025 present", has("fr24", "2025-11-08", "LHR", "CDG")],
    ["Added VY6948 ORY→LGW 9 Nov 2025 present", has("fr24", "2025-11-09", "ORY", "LGW")],
  ];

  // Single-source flights
  const singleFlighty = flights.filter(f => f.sources.length === 1 && f.sources[0] === "flighty");
  const singleFr24 = flights.filter(f => f.sources.length === 1 && f.sources[0] === "fr24");

  // -------------------------------------------------------------------------
  // Output JSON
  // -------------------------------------------------------------------------
  const cleanFlights = flights.map(({ _toCountryName, _depTime, _arrTime, _arrivalTransit, ...f }) => f);
  const out = {
    meta: { built: BUILD_DATE, flight_count: flown.length, share_mode: false },
    flights: cleanFlights,
    visits,
    countries,
    stats,
    config: {
      home_bases: HOME_BASE_ERAS,
      birth: BIRTH,
      transit_only: [...TRANSIT_ONLY],
      layover_visit: [...LAYOVER_VISIT],
      overrides: AIRPORT_OVERRIDES,
    },
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  // No em dashes in the UI: em dashes only ever appear in free-text notes here
  // (never in codes/dates/coords), so normalise them to en dashes on output.
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2).replace(/—/g, "–"));

  // -------------------------------------------------------------------------
  // Discrepancy report
  // -------------------------------------------------------------------------
  const md = [];
  md.push(`# Discrepancy report`, ``, `Built ${BUILD_DATE}. Flighty ${flighty.length} · FR24 ${fr24.length} · merged ${flights.length} (${flown.length} flown, ${out.stats.flights_booked} booked, ${out.stats.flights_cancelled} cancelled).`, ``);
  md.push(`## Section-2 correction checks`, ``);
  for (const [label, ok] of corrChecks) md.push(`- ${ok ? "✅" : "❌"} ${label}`);
  md.push(``, `## Validation vs country_reconciliation.csv`, ``);
  md.push(`- Countries visited: **${visited.length}** (reconciliation expects ${expectVisited.size})`);
  md.push(`- Transit-only: **${transitCountries.length}** (expects ${expectTransit.size})`);
  if (assertions.length) { md.push(``, `### ⚠️ Assertion failures`, ``); assertions.forEach(a => md.push(`- ❌ ${a}`)); }
  else md.push(`- ✅ All reconciliation countries present with correct status`);
  md.push(``, `## Single-source flights (review — not dropped)`, ``);
  md.push(`### Flighty only (${singleFlighty.length})`, ``);
  singleFlighty.forEach(f => md.push(`- ${f.date} ${f.from.iata}→${f.to.iata} ${f.flight_number || ""}`.trim()));
  md.push(``, `### FR24 only (${singleFr24.length})`, ``);
  singleFr24.forEach(f => md.push(`- ${f.date} ${f.from.iata}→${f.to.iata} ${f.flight_number || ""}`.trim()));
  if (unmappedIata.size) { md.push(``, `## Unmapped IATA codes`, ``); [...unmappedIata].forEach(i => md.push(`- ${i}`)); }
  md.push(``, `## Notes & fuzzy matches`, ``);
  report.forEach(r => md.push(r));
  fs.writeFileSync(OUT_REPORT, md.join("\n"));

  // -------------------------------------------------------------------------
  // Console summary
  // -------------------------------------------------------------------------
  log(`\n=== SUMMARY ===`);
  log(`Merged flights: ${flights.length}  (flown ${flown.length}, booked ${out.stats.flights_booked}, cancelled ${out.stats.flights_cancelled})`);
  log(`Countries visited: ${visited.length}  transit-only: ${transitCountries.length}  layover: ${stats.layover_visits}`);
  log(`Distance: ${dist.toLocaleString()} km (${stats.times_around_earth}× Earth)  airborne: ${stats.hours_airborne}h`);
  log(`Single-source: ${singleFlighty.length} flighty, ${singleFr24.length} fr24`);
  const failed = corrChecks.filter(c => !c[1]);
  log(`Correction checks: ${corrChecks.length - failed.length}/${corrChecks.length} passed`);
  if (failed.length) failed.forEach(c => log(`  ❌ ${c[0]}`));
  if (assertions.length) { log(`Assertion failures:`); assertions.forEach(a => log(`  ❌ ${a}`)); }
  else log(`✅ Reconciliation: all countries present with correct status`);
  if (unmappedIata.size) log(`Unmapped IATA: ${[...unmappedIata].join(", ")}`);
  log(`\nWrote ${path.relative(ROOT, OUT_JSON)} and ${path.relative(ROOT, OUT_REPORT)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
