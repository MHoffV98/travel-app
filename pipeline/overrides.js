// overrides.js — user-confirmed configuration for the travel-map pipeline.
// Everything here is hand-maintained "ground truth" that can't be derived from
// the raw flight/manual data. Keep it readable; the build script imports it whole.

// ---------------------------------------------------------------------------
// Airport overrides: IATA -> { country, lat, lon, city }
// Used to (a) override OpenFlights' country assignment, and (b) supply
// coordinates for airports missing from airports.dat (closed airports, etc.).
// Only the fields you want to override need to be present.
// ---------------------------------------------------------------------------
export const AIRPORT_OVERRIDES = {
  // Longyearbyen: OpenFlights files it under Norway; the owner counts Svalbard
  // separately (matching the Been app).
  LYR: { country: "Svalbard", lat: 78.246, lon: 15.4656, city: "Longyearbyen" },
  // Berlin Tegel — closed Nov 2020, may be absent from current airports.dat.
  TXL: { country: "Germany", lat: 52.5597, lon: 13.2877, city: "Berlin" },
  // Berlin Brandenburg — opened 2020; ensure country + coords are present.
  BER: { country: "Germany", lat: 52.3667, lon: 13.5033, city: "Berlin" },
  // Berlin Schönefeld — folded into BER operationally but still its own IATA.
  SXF: { country: "Germany", lat: 52.38, lon: 13.5225, city: "Berlin" },
};

// Source-data corrections applied right after parsing. Idempotent: if a future
// export already has the fix, the match simply isn't found and it's a no-op
// (logged in the discrepancy report). Cleaner than hand-editing the raw CSV,
// which the next export would overwrite.
export const FLIGHT_CORRECTIONS = [
  { source: "flighty", match: { date: "2019-11-19", dep: "MAN", arr: "AMS" }, setDate: "2019-11-18",
    note: "KL1070 overnight — corrected to 18 Nov 2019" },
  { source: "flighty", match: { date: "2017-08-01", dep: "SPU", arr: "MAN" }, setDate: "2017-07-31",
    note: "LS916 — corrected to 31 Jul 2017" },
  { source: "flighty", match: { date: "2025-05-31", dep: "STN", arr: "TLS" }, delete: true,
    note: "phantom FR281 removed — real outbound was BA376 LHR→TLS 20 May 2025" },
];

// Airport-equivalence pairs for the fuzzy flight matcher: codes that refer to
// the same place across the two apps (one app logged TXL, the other BER, etc.).
// Listed as unordered pairs; the matcher treats them as interchangeable.
export const EQUIVALENT_AIRPORTS = [
  ["TXL", "BER"],
  ["SXF", "BER"],
  ["TXL", "SXF"],
];

// ---------------------------------------------------------------------------
// Visit-inference hard overrides (section 3.3 of the brief).
// ---------------------------------------------------------------------------

// Transit-only, never actually visited. These countries are reached only as
// airside connections; they must NOT count toward "countries visited".
export const TRANSIT_ONLY = new Set([
  "Panama",
  "Malaysia",
  "India",
  "Uganda",
  "Ireland",
  "Canada",
]);

// Non-sovereign territories / dependencies (counted separately from the
// sovereign-country total — same treatment for all of them, incl. New Caledonia).
export const TERRITORIES = new Set([
  "SJM", // Svalbard (Norway)
  "HKG", // Hong Kong (China)
  "NCL", // New Caledonia (France)
  "XNC", // Northern Cyprus (disputed)
  "XAD", // Akrotiri & Dhekelia (UK Sovereign Base Areas)
]);

// Sovereign parent of each territory — visiting the territory credits the parent
// toward the sovereign-country COUNT (e.g. Hong Kong → China), even though the
// territory keeps its own flag/identity and the parent isn't shown on the map.
export const TERRITORY_PARENT = {
  HKG: "CHN", // Hong Kong → China
  SJM: "NOR", // Svalbard → Norway
  NCL: "FRA", // New Caledonia → France
  XAD: "GBR", // Akrotiri & Dhekelia → UK
  // XNC (Northern Cyprus) intentionally has no parent credit.
};

// Layover visits: exited the airport on a layover — counts as visited, but
// tagged for a fun map category.
export const LAYOVER_VISIT = new Set([
  "Singapore",
  "Hong Kong",
  "Qatar",
]);

// "Been" app countries with no flight and no manual-trip record. Pulled in so
// the visited-country total matches the reconciliation. Clearly flagged in the
// discrepancy report as needing a real manual_trips entry (approx date + mode).
export const BEEN_ONLY = [
  // (Monaco moved to manual_trips.csv — 2024 Monaco GP day trip from Nice.)
];

// ---------------------------------------------------------------------------
// Home-base eras (section 3.4). Half-open intervals [start, end).
// `end: null` means "ongoing". Nights attributed to the home country during an
// era are "home nights"; everything else is a "travel night". The gap between
// Australia and the UK (no fixed residence) is intentionally left uncovered, so
// every night there is a travel night.
// ---------------------------------------------------------------------------
export const HOME_BASE_ERAS = [
  { country: "United Kingdom", city: "Manchester", lat: 53.4808, lon: -2.2426, start: "1998-07-20", end: "2016-09-01" },
  { country: "United Kingdom", city: "Oxford",     lat: 51.7520, lon: -1.2577, start: "2016-09-01", end: "2019-07-01" },
  // 2019-07 .. 2020-01: UK-based (Manchester) between homes — flew home from MAN
  // between each round-the-world leg, so this lets those trips split correctly.
  { country: "United Kingdom", city: "Manchester", lat: 53.4808, lon: -2.2426, start: "2019-07-01", end: "2020-01-01" },
  { country: "United Kingdom", city: "London",     lat: 51.5074, lon: -0.1278, start: "2020-01-01", end: "2022-06-30" },
  { country: "Australia",      city: "Melbourne",  lat: -37.8136, lon: 144.9631, start: "2022-06-30", end: "2024-01-01" },
  // 2024-01-01 .. 2024-02-25: no fixed residence (travelling South America + US)
  { country: "United Kingdom", city: "London",     lat: 51.5074, lon: -0.1278, start: "2024-02-25", end: null },
];

// Birth marker for the timelapse opening (Manchester, England — 20 Jul 1998).
export const BIRTH = { date: "1998-07-20", country: "United Kingdom", city: "Manchester", lat: 53.4808, lon: -2.2426 };

// ---------------------------------------------------------------------------
// Country name -> ISO 3166-1 alpha-3. Covers every country that appears in the
// flight data (OpenFlights spellings), manual_trips, and the reconciliation.
// Svalbard uses SJM (Svalbard & Jan Mayen) plus a `territory` marker downstream.
// Alternate spellings map to the same code.
// ---------------------------------------------------------------------------
export const ISO3 = {
  "Albania": "ALB",
  "Algeria": "DZA",
  "Argentina": "ARG",
  "Australia": "AUS",
  "Austria": "AUT",
  "Barbados": "BRB",
  "Belgium": "BEL",
  "Belize": "BLZ",
  "Bulgaria": "BGR",
  "Cambodia": "KHM",
  "Canada": "CAN",
  "Chile": "CHL",
  "Colombia": "COL",
  "Croatia": "HRV",
  "Cuba": "CUB",
  "Cyprus": "CYP",
  "Czech Republic": "CZE",
  "Czechia": "CZE",
  "Denmark": "DNK",
  "Egypt": "EGY",
  "Estonia": "EST",
  "Fiji": "FJI",
  "France": "FRA",
  "Germany": "DEU",
  "Ghana": "GHA",
  "Greece": "GRC",
  "Guatemala": "GTM",
  "Hong Kong": "HKG",
  "Hungary": "HUN",
  "Iceland": "ISL",
  "India": "IND",
  "Indonesia": "IDN",
  "Ireland": "IRL",
  "Israel": "ISR",
  "Italy": "ITA",
  "Laos": "LAO",
  "Maldives": "MDV",
  "Malaysia": "MYS",
  "Malta": "MLT",
  "Mauritius": "MUS",
  "Mexico": "MEX",
  "Monaco": "MCO",
  "Morocco": "MAR",
  "Netherlands": "NLD",
  "New Caledonia": "NCL",
  "New Zealand": "NZL",
  "Norway": "NOR",
  "Oman": "OMN",
  "Palestine": "PSE",
  "Palestinian Territory": "PSE",
  "Panama": "PAN",
  "Peru": "PER",
  "Poland": "POL",
  "Portugal": "PRT",
  "Qatar": "QAT",
  "Romania": "ROU",
  "Russia": "RUS",
  "Russian Federation": "RUS",
  "Rwanda": "RWA",
  "Saint Kitts and Nevis": "KNA",
  "Singapore": "SGP",
  "Slovenia": "SVN",
  "Spain": "ESP",
  "Sri Lanka": "LKA",
  "Svalbard": "SJM",
  "Switzerland": "CHE",
  "Thailand": "THA",
  "Turkey": "TUR",
  "Türkiye": "TUR",
  "Uganda": "UGA",
  "Northern Cyprus": "XNC",
  "Akrotiri and Dhekelia": "XAD",
  "United Arab Emirates": "ARE",
  "United Kingdom": "GBR",
  "United States": "USA",
  "Uruguay": "URY",
  "Uzbekistan": "UZB",
  "Vanuatu": "VUT",
  "Vatican City": "VAT",
  "Holy See (Vatican City State)": "VAT",
  "Vietnam": "VNM",
  "Viet Nam": "VNM",
};

// Display name per ISO3 (canonical, used in output). First spelling wins.
export const NAME_BY_ISO3 = (() => {
  const m = {};
  for (const [name, iso] of Object.entries(ISO3)) if (!m[iso]) m[iso] = name;
  // Prefer common display names where the first map entry isn't ideal:
  m.CZE = "Czech Republic";
  m.RUS = "Russia";
  m.PSE = "Palestine";
  m.VAT = "Vatican City";
  m.TUR = "Turkey";
  m.VNM = "Vietnam";
  m.XNC = "Northern Cyprus";
  m.XAD = "Akrotiri & Dhekelia";
  return m;
})();

// ISO3 -> ISO2 (for flag images via flagcdn). Covers every country we track.
export const ISO2 = {
  ALB: "AL", DZA: "DZ", ARG: "AR", AUS: "AU", AUT: "AT", BRB: "BB", BEL: "BE",
  BLZ: "BZ", BGR: "BG", KHM: "KH", CAN: "CA", CHL: "CL", COL: "CO", HRV: "HR",
  CUB: "CU", CYP: "CY", CZE: "CZ", EGY: "EG", EST: "EE", FJI: "FJ", FRA: "FR",
  DEU: "DE", GHA: "GH", GRC: "GR", GTM: "GT", HKG: "HK", HUN: "HU", ISL: "IS",
  IND: "IN", IDN: "ID", IRL: "IE", ISR: "IL", ITA: "IT", LAO: "LA", MDV: "MV",
  MYS: "MY", MLT: "MT", MUS: "MU", MEX: "MX", MCO: "MC", MAR: "MA", NLD: "NL",
  NCL: "NC", NZL: "NZ", NOR: "NO", OMN: "OM", PSE: "PS", PAN: "PA", PER: "PE",
  POL: "PL", PRT: "PT", QAT: "QA", ROU: "RO", RUS: "RU", RWA: "RW", KNA: "KN",
  SGP: "SG", SVN: "SI", ESP: "ES", LKA: "LK", SJM: "SJ", CHE: "CH", THA: "TH", TUR: "TR",
  UGA: "UG", ARE: "AE", GBR: "GB", USA: "US", URY: "UY", UZB: "UZ", VUT: "VU",
  VAT: "VA", VNM: "VN",
  XAD: "GB", // Akrotiri & Dhekelia — UK Sovereign Base Area, use the UK flag
};

// Recommendations key per ISO3 (slug) — matches keys in recommendations.json.
export function recommendationsKey(iso3) {
  return (NAME_BY_ISO3[iso3] || iso3).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
