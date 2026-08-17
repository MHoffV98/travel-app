# Personal Travel Map — Project Brief

A handover brief for building an interactive travel-history site from reconciled flight and trip data. The data analysis and reconciliation work is **already done** — this document describes the inputs, the pipeline to build, the data model, and the site features.

---

## 1. Project overview

Build a single-page, static web app that visualises ~27 years of personal travel: an animated flight map, a choropleth of countries visited, a timelapse from 1999 to today, and a stats dashboard. Private for now, but it must be trivially hostable later (GitHub Pages / Vercel) — so **no backend, no database**: a Python pipeline produces one `travel_data.json` that the site consumes.

The owner's travel history in one line: born in England in 1998, regular France summers from 2002, a 2010 Mediterranean cruise, a 2016 interrail trip that coincides with the start of flight records, a big 2019 round-the-world stretch, lived in Australia 2022–24, now back in London. 66 countries visited, ~300 flights, 6 transit-only countries, 3 "layover visit" countries. First country (Mauritius, 1999) visited at age 1 — a good dashboard stat.

## 2. Input files

| File | Role |
|---|---|
| `FlightyExport-*.csv` | Flight log A. Richest per-flight data: scheduled **and actual** gate/takeoff/landing times (~194 of 301 flights have actuals → delay stats), cancellations, diversions, terminals/gates, aircraft type, tail number, seat. IATA codes in `From`/`To`. |
| `flightdiary_*.csv` (FlightRadar24) | Flight log B. Airport strings like `Melbourne / Tullamarine (MEL/YMML)` — extract IATA with regex `\((\w{3})/`. Has dep/arr times, duration, airline, aircraft, registration. |
| `manual_trips.csv` | **Authoritative** record of pre-2016 trips, overland crossings, the 2010 cruise itinerary, and the 2016 interrail legs. 30 entries with a `date_precision` field (`day`, `day_approx`, `month`, `month_approx`, `approx_year`, `recurring`). |
| `country_reconciliation.csv` | Per-country status reference produced during reconciliation: `confirmed_flight_visit`, `pre2016_trip`, `overland_crossing`, `transit_only_confirmed`, plus layover-visit annotations. Use it to validate pipeline output. |

The user has corrected both flight apps following a dedupe audit and will supply **fresh exports** — the pipeline must be a re-runnable script, not a one-off notebook.

### Corrections already applied in the apps (assert these against the new exports)

- FR24 Italy/Faro flights moved from Aug → **Sep 2018** (NAP→MXP, MXP→MAN on 22 Sep; MAN→FAO on 24 Sep)
- Flighty MAN→AMS corrected to **18 Nov 2019**; Flighty SPU→MAN corrected to **31 Jul 2017**
- FR24: SIN→MEL is **QF38, 25 Nov 2025 00:05** (QF36 deleted); LGW→BGO is **DY1319, 3 Oct 2024 21:00** (DY1315 deleted); 18 Jul 2025 is **LCY→LIN** (STN→GOA deleted); **EZE→SCL 27 Jan 2024 deleted** (not a real flight)
- Flighty: phantom **STN→TLS 31 May 2025 19:10 deleted** (the real outbound, BA376 LHR→TLS 20 May 2025, exists in both sources)
- Flights added to FR24: QF475 SYD→MEL 27 Mar 2023, DL2265 BOS→LGA 16 Feb 2024, BA302 LHR→CDG 8 Nov 2025, VY6948 ORY→LGW 9 Nov 2025
- Minor flight-number discrepancies on four flights (LIM→MDE, MDE→CTG Oct 2019; DAD→SGN Dec 2019; VCE→STN Apr 2025) were **deliberately left unfixed** — when sources disagree on flight number but agree on date+route, keep one record and don't treat as two flights

## 3. Pipeline spec (`pipeline/build_data.py`)

Python script. Inputs: the four files above + OpenFlights `airports.dat`. Output: `site/src/travel_data.json` + a human-readable `discrepancy_report.md`.

### 3.1 Flight merge

1. Parse both flight CSVs into a common record: `date, dep_iata, arr_iata, flight_number, airline, sched_dep, sched_arr, actual_times…, aircraft, registration, source`.
2. **Match pass 1 — exact**: same date + dep + arr.
3. **Match pass 2 — fuzzy**: same dep + arr within ±1 day (overnight-flight date conventions differ between apps), and airport-equivalence pairs (`TXL ≡ BER`).
4. **Merged record**: prefer Flighty for times/actuals/aircraft detail; FR24 fills gaps (registration, duration).
5. Unmatched records from either source survive as single-source flights — **do not drop**; list them in the discrepancy report for review.
6. Never dedupe on date + flight number alone: KL539 on 29 Aug 2019 is legitimately two legs (KGL→EBB→AMS) under one number. Route must be part of the key.
7. Flights with a date after the build date are `status: "booked"` not `"flown"` (e.g. BA2716 LGW→FNC 24 Jul 2026) and are excluded from stats but available to the UI as "next trip".

### 3.2 Geography

- Map IATA → country, lat/lon, city via OpenFlights `airports.dat` (`https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat`).
- **Overrides table** (required): `LYR → Svalbard` (OpenFlights files Longyearbyen under Norway; the user counts Svalbard separately, matching the Been app), `TXL → Germany` (closed airport, may be absent), `BER → Germany`. Keep Hong Kong and New Caledonia as distinct territories (OpenFlights already does).
- Country identity: use ISO 3166-1 alpha-3 plus a `territory` extension for Svalbard so the choropleth can shade it separately from Norway (Natural Earth geometry has Svalbard as part of Norway's geometry — use a marker/inset if polygon-level shading is impractical).

### 3.3 Visit inference

- Each flight arrival is a **visit candidate** for the arrival country.
- **Transit rule**: if the next departure is from the same airport within 24h and the country isn't otherwise confirmed, classify as `transit`.
- **Hard overrides** (user-confirmed, encode as config):
  - Transit-only, never visited: **Panama, Malaysia, India, Uganda, Ireland, Canada**
  - Layover visits (exited the airport on a layover — counts as visited, but tag `layover_visit: true` for a fun map category): **Singapore, Hong Kong, Qatar**
- Merge `manual_trips.csv` visits (cruise ports, overland crossings, pre-2016 trips, interrail legs). Manual entries with `type: transit` (e.g. Switzerland 2020 drive-through) join the transit layer.
- First-visit date per country = min across flight-inferred and manual visits. Several countries' first visits **predate the flight records**: USA 2007, Iceland 2009, Italy/Croatia/Greece/Egypt/Israel/Palestine 2010, Russia/Morocco/Algeria 2013, France 2002, Mauritius 1999.

### 3.4 Nights per country

- Between consecutive flights, attribute nights to the country of the preceding arrival.
- **Home-base eras** (user-confirmed): UK from birth (1998) → Jun 2022; **Australia Jun 2022 → 1 Jan 2024** (officially left New Year's Day 2024); **no fixed residence 1 Jan → late Feb 2024** — travelling (South America, then US), every night in this window is a travel night; **UK from late Feb 2024**. Australian flights in Nov 2025 / Jan 2026 are return visits, not residence. Nights at home are tracked but displayed separately from "travel nights".
- Manual trips with day precision contribute exact nights; month/year precision entries contribute a visit count but `nights: null` (don't fabricate).

### 3.5 Validation & reporting

- Assert every `visited` country in `country_reconciliation.csv` appears with the right status; assert the section-2 corrections took effect; assert flight count ≈ 300 ± a few.
- Emit `discrepancy_report.md`: single-source flights, fuzzy matches that needed ±1 day, any IATA codes that failed to map.

## 4. Output schema (`travel_data.json`)

```json
{
  "meta": { "built": "2026-06-12", "flight_count": 300, "share_mode": false },
  "flights": [{
    "id": "2016-07-24-BOD-BRU", "date": "2016-07-24",
    "from": {"iata": "BOD", "lat": 44.83, "lon": -0.71, "country": "FRA"},
    "to":   {"iata": "BRU", "lat": 50.90, "lon": 4.48,  "country": "BEL"},
    "airline": "Brussels Airlines", "flight_number": "SN3556",
    "distance_km": 824, "duration_min": 90,
    "sched_dep": "2016-07-24T14:40", "actual_dep": "2016-07-24T14:44",
    "delay_min": 4, "aircraft": "Airbus A319", "registration": null,
    "status": "flown", "sources": ["flighty", "fr24"]
  }],
  "visits": [{
    "country": "GRC", "start": "2010-10-25", "end": "2010-10-26",
    "precision": "day_approx", "transport": "cruise",
    "kind": "visit", "source": "manual", "notes": "Piraeus, 2 days"
  }],
  "countries": [{
    "iso3": "SGP", "name": "Singapore", "status": "visited",
    "layover_visit": true, "first_visit": "2023-07-08",
    "first_visit_precision": "day", "visit_count": 3,
    "nights": 4, "transports": ["flight"], "recommendations_key": "singapore"
  }],
  "stats": { "computed by pipeline: totals, records, per-year series, delay stats": "…" },
  "config": { "home_bases": [], "overrides": {} }
}
```

Recommendations live in a separate, hand-edited `recommendations.json` (`{ "singapore": ["…"] }`) so regenerating data never clobbers written content.

## 5. Site spec

**Stack**: Vite + React, MapLibre GL + deck.gl (`ArcLayer`, `GeoJsonLayer` choropleth). Optionally `globe.gl` for a 3D globe mode — impressive for the timelapse, but ship the 2D version first. Natural Earth 110m countries GeoJSON for polygons. All static; `npm run build` → deployable folder.

### Views (MVP order)

1. **Choropleth map** — countries shaded by a toggleable metric: visits / nights / first-visit year / last-visit recency. Transit-only countries get a distinct hatched/muted style; layover-visit countries (SIN, HKG, QAT) a third style. Hover tooltip with headline numbers.
2. **Flight map** — all ~300 great-circle arcs, weighted by frequency (LHR/STN↔MEL/SYD corridors and intra-Europe hops will dominate). Click an arc for flight details.
3. **Timelapse** — year scrubber **1998→2026** with play button, opening on a birth marker in England before Mauritius lights up in 1999. Flights draw chronologically as animated arcs; countries fill on first visit. Manual-trip visits appear as pulse markers (cruise ports pulse along the route in Oct 2010; interrail legs pulse across central Europe in summer 2016). Home-base relocations (UK→Australia 2022, back in 2024) make natural chapter markers. Entries with `month`/`approx_year` precision animate at month/mid-year granularity — never invent fake exact dates. The recurring France summers can pulse each July 2002–2015.
4. **Stats dashboard** — totals (distance + "× around the Earth", hours airborne, flights, airports, airlines, aircraft types); records (busiest year: 2023 with 82 flights; longest/shortest flight; most-flown route, airport, aircraft registration); delay stats from Flighty actuals (on-time %, worst delay, average); countries: 66 visited, 6 transit-only, continents, % of world.
5. **Country detail panel** — click a country: visit timeline, nights, transport modes, first/last visit, and recommendations from `recommendations.json`.
6. **Next trip** — booked flights rendered as a dashed arc with countdown.

### Share mode

A build flag (`VITE_SHARE_MODE`) that: rounds dates to month precision in the UI, hides home-base info and the next-trip view, and hides notes. Default off for personal use.

### Design notes

Dark basemap, warm arc gradient, generous numbers. Must work on mobile (the owner will show people on a phone). Read the frontend-design skill if building inside Claude's environment.

## 6. Repo layout

```
travel-map/
├── data/                  # raw exports (gitignored if repo ever goes public)
│   ├── flighty.csv  fr24.csv  manual_trips.csv  country_reconciliation.csv
├── pipeline/
│   ├── build_data.py  overrides.py  airports.dat
├── site/                  # Vite app, reads src/travel_data.json
├── recommendations.json
└── Makefile               # make data && make dev && make build
```

## 7. Open items (ask the user)

1. ~~Exact month of the 2024 return from Australia~~ **Resolved**: left Australia 1 Jan 2024; no fixed residence until late Feb 2024 (travelling); UK resident from late Feb 2024.
2. Exact Oct 2010 cruise dates if found (currently `day_approx`, anchored on 18 Oct embarkation).
3. France 2002–2015: one recurring entry now; individual years would enrich the early timelapse if the user can list them.
4. Firm up Barbados/St Kitts (currently Oct 2005, `month_approx`).
5. Whether to count the Cyprus buffer zone / Northern Cyprus distinctly (Been does; currently folded into Cyprus).
