// packing.js — packing-list generation. Pure logic, no storage and no React.
//
// A list is generated once per trip and then belongs to that trip forever: it's
// the record of what was actually taken, and it's re-used on the way home. So
// generation is deliberately a one-shot that the UI guards behind a confirm —
// regenerating throws away packed state.

export const CLIMATES = ["hot", "mild", "cold", "rainy", "snow", "mixed"];
export const TRIP_TYPES = ["leisure", "business", "beach", "hiking", "formal"];
export const BAGS = ["personal", "cabin", "hold"];

// Rough per-item weights (kg) so the bag totals mean something without the user
// weighing anything. Estimates, and every one is editable.
const W = {
  tshirt: 0.15, shirt: 0.2, trousers: 0.5, shorts: 0.25,
  underwear: 0.05, socks: 0.05, jumper: 0.4, fleece: 0.45, coat: 1.2, rainjacket: 0.4,
  shoes: 0.9, boots: 1.4, sandals: 0.35, swim: 0.15, pyjamas: 0.3, hat: 0.1,
  toiletries: 0.15, laptop: 1.4, charger: 0.15, adapter: 0.1, powerbank: 0.25,
  headphones: 0.25, book: 0.35, small: 0.05,
};

// ---------------------------------------------------------------------------
// Climate guess — latitude + month, no weather API (that's an explicit non-goal).
// Just a sensible default the user confirms or overrides.
export function guessClimate(lat, monthIndex) {
  if (!Number.isFinite(lat) || !Number.isFinite(monthIndex)) return "mild";
  const abs = Math.abs(lat);
  // Northern-hemisphere "summer-ness" of the month, mirrored below the equator.
  const m = lat >= 0 ? monthIndex : (monthIndex + 6) % 12;
  const summer = m >= 4 && m <= 8;      // May–Sep
  const winter = m <= 1 || m === 11;    // Dec–Feb
  if (abs < 23.5) return "hot";                                              // tropics
  if (abs < 45) return summer ? "hot" : (winter ? (abs < 35 ? "mild" : "cold") : "mild");
  if (abs < 55) return summer ? "mild" : (winter ? "cold" : "mixed");
  if (abs < 65) return summer ? "mild" : (winter ? "snow" : "cold");
  return winter ? "snow" : "cold";                                           // arctic
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Best-guess latitude for where the trip is actually spent.
//
// Not the average of every point on the map: a London→Naples return puts two
// UK airports and two Italian ones in that list, and the mean (or median) of
// those lands near Geneva. So keep only places in the countries the trip counts
// as visited — which drops the home-airport ends of the flights.
export function tripLat(trip) {
  const iso = new Set((trip.countries || []).map((c) => c.iso3 || c).filter(Boolean));
  const lats = [];
  for (const e of trip.events || []) {
    if (e.kind === "visit" && Number.isFinite(e.lat)) lats.push(e.lat);
    for (const ep of [e.from, e.to]) {
      if (ep && Number.isFinite(ep.lat) && (!iso.size || iso.has(ep.country))) lats.push(ep.lat);
    }
  }
  if (lats.length) return median(lats);
  const pts = (trip.mapFocus && trip.mapFocus.length ? trip.mapFocus : trip.mapPoints) || [];
  return median(pts.map((p) => p.lat).filter(Number.isFinite));
}

export function tripDays(trip) {
  if (Number.isFinite(trip.nights) && trip.nights > 0) return trip.nights + 1;
  if (Number.isFinite(trip.spanDays) && trip.spanDays > 0) return trip.spanDays;
  return 1;
}

// ---------------------------------------------------------------------------
// Templates
const DOCUMENTS = (opts) => [
  ["Passport", "personal", W.small],
  ["Boarding passes / tickets", "personal", W.small],
  ["Travel insurance details", "personal", W.small],
  ["Bank / credit cards", "personal", W.small],
  ["Local cash", "personal", W.small],
  ...(opts.abroad ? [["Visa / entry permit (if needed)", "personal", W.small]] : []),
  ...(opts.driving ? [["Driving licence", "personal", W.small]] : []),
  ["Phone with offline maps + tickets saved", "personal", 0.2],
];

const CLIMATE_ITEMS = {
  hot: [["Sunglasses", "personal", W.small], ["Sun hat", "cabin", W.hat], ["Sunscreen", "hold", W.toiletries], ["Light long sleeves (sun / mosquitoes)", "hold", W.shirt], ["Insect repellent", "hold", W.toiletries], ["Reusable water bottle", "cabin", 0.2]],
  mild: [["Light jumper", "cabin", W.jumper], ["Packable rain jacket", "cabin", W.rainjacket], ["Umbrella", "cabin", 0.3]],
  cold: [["Warm coat", "cabin", W.coat], ["Hat, gloves and scarf", "cabin", 0.3], ["Thermal base layer", "hold", 0.25], ["Fleece / thick jumper", "hold", W.fleece], ["Warm socks", "hold", 0.1]],
  rainy: [["Waterproof jacket", "cabin", W.rainjacket], ["Umbrella", "cabin", 0.3], ["Waterproof shoes", "hold", W.boots], ["Dry bag for electronics", "cabin", 0.1], ["Spare socks", "hold", W.socks]],
  snow: [["Insulated coat", "cabin", 1.5], ["Waterproof gloves", "cabin", 0.2], ["Thermal base layers", "hold", 0.5], ["Snow boots", "hold", W.boots], ["Lip balm and moisturiser", "personal", W.small], ["Sunglasses / goggles (snow glare)", "personal", 0.15]],
  mixed: [["Layers (t-shirt + jumper + shell)", "hold", 0.8], ["Packable rain jacket", "cabin", W.rainjacket], ["Both warm and cool footwear", "hold", W.shoes]],
};

const TYPE_ITEMS = {
  leisure: [["Book / e-reader", "personal", W.book], ["Day bag", "cabin", 0.3], ["Comfortable walking shoes", "hold", W.shoes]],
  business: [["Laptop and charger", "personal", W.laptop], ["Suit / smart outfit", "hold", 1.0], ["Smart shoes", "hold", W.shoes], ["Business cards", "personal", W.small], ["Notebook and pen", "personal", 0.2], ["Lanyard / office pass", "personal", W.small]],
  beach: [["Swimwear", "hold", W.swim], ["Beach towel", "hold", 0.4], ["Flip flops / sandals", "hold", W.sandals], ["Aftersun", "hold", W.toiletries], ["Dry bag", "cabin", 0.1]],
  hiking: [["Hiking boots", "hold", W.boots], ["Daypack", "cabin", 0.6], ["Water bottle / bladder", "cabin", 0.3], ["Blister plasters", "personal", W.small], ["Head torch", "cabin", 0.15], ["Offline maps downloaded", "personal", 0], ["Snacks", "cabin", 0.3]],
  formal: [["Formal outfit", "hold", 1.2], ["Dress shoes", "hold", W.shoes], ["Accessories / jewellery", "personal", 0.1], ["Garment bag", "hold", 0.3], ["Shoe polish / lint roller", "hold", 0.1]],
};

const TOILETRIES = [
  ["Toothbrush and toothpaste", "hold", W.toiletries],
  ["Deodorant", "hold", W.toiletries],
  ["Shampoo and shower gel", "hold", 0.3],
  ["Razor / shaving kit", "hold", 0.15],
  ["Hairbrush", "hold", 0.1],
  ["Any prescription medication", "personal", 0.1],
  ["Painkillers and plasters", "personal", 0.1],
  ["Hand sanitiser", "personal", W.small],
];

const TECH = [
  ["Phone charger", "personal", W.charger],
  ["Travel plug adapter", "personal", W.adapter],
  ["Power bank", "personal", W.powerbank],
  ["Headphones", "personal", W.headphones],
];

// Clothing scales with trip length but caps out — past a week you do laundry.
function clothing(days, climate) {
  const n = Math.min(days, 7);
  const warm = climate === "cold" || climate === "snow";
  const hot = climate === "hot";
  const tops = Math.max(2, Math.min(days, 6));
  const bottoms = days <= 3 ? 1 : 2;
  const out = [
    [`Underwear ×${n}`, "hold", +(W.underwear * n).toFixed(2)],
    [`Socks ×${n}`, "hold", +(W.socks * n).toFixed(2)],
    [`T-shirts / tops ×${tops}`, "hold", +(W.tshirt * tops).toFixed(2)],
    [`Trousers / bottoms ×${bottoms}`, "hold", +(W.trousers * bottoms).toFixed(2)],
    ["Pyjamas / sleepwear", "hold", W.pyjamas],
  ];
  if (hot) out.push([`Shorts ×${bottoms}`, "hold", +(W.shorts * bottoms).toFixed(2)]);
  if (warm) out.push([`Warm jumpers ×${days <= 4 ? 1 : 2}`, "hold", +(W.jumper * (days <= 4 ? 1 : 2)).toFixed(2)]);
  if (days > 7) out.push(["Laundry bag / travel detergent", "hold", 0.1]);
  return out;
}

// ---------------------------------------------------------------------------
let seq = 0;
const mkId = () => `pk-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;

function item(category, [label, bag, weightKg], source = "template") {
  return { id: mkId(), category, label, packed: false, returned: false, bag: bag || null, weightKg: weightKg ?? null, source };
}

/**
 * Build a fresh packing list for a trip.
 * `essentials` is the user-level "things I always forget" list — one item each,
 * tagged source:'essentials' so they're visible per-trip but managed globally.
 */
export function generatePackingList(trip, { climate = "mild", tripType = "leisure", essentials = [], baggageLimits = null } = {}) {
  const days = tripDays(trip);
  const abroad = !(trip.countries || []).every((c) => c === "United Kingdom");
  const driving = (trip.transports || []).some((t) => t === "car" || t === "road");
  const items = [];
  const push = (cat, list, source) => list.forEach((row) => items.push(item(cat, row, source)));

  push("Documents and money", DOCUMENTS({ abroad, driving }));
  push("Clothing", clothing(days, climate));
  push("Weather essentials", CLIMATE_ITEMS[climate] || CLIMATE_ITEMS.mild);
  push(`${tripType[0].toUpperCase()}${tripType.slice(1)} essentials`, TYPE_ITEMS[tripType] || TYPE_ITEMS.leisure);
  push("Toiletries and health", TOILETRIES);
  push("Tech", TECH);
  // The global "always forget" list, seeded per trip.
  push("Always forget", essentials.filter((e) => String(e).trim()).map((e) => [String(e).trim(), "personal", null]), "essentials");

  return {
    generatedAt: new Date().toISOString(),
    climate,
    tripType,
    baggageLimits: baggageLimits || { personalKg: null, cabinKg: null, holdKg: null },
    items,
  };
}

export function customItem(label, bag = null) {
  return { id: mkId(), category: "Added on the trip", label, packed: false, returned: false, bag, weightKg: null, source: "custom" };
}

// Ordered category groups, preserving the order items were generated in.
export function byCategory(items) {
  const out = [];
  for (const it of items) {
    let g = out.find((x) => x.category === it.category);
    if (!g) out.push((g = { category: it.category, items: [] }));
    g.items.push(it);
  }
  return out;
}

// Weight carried per bag, counting only what's ticked in the given mode.
export function bagTotals(items, mode) {
  const field = mode === "return" ? "returned" : "packed";
  const t = { personal: 0, cabin: 0, hold: 0 };
  for (const it of items) {
    if (!it[field] || !it.bag || !Number.isFinite(it.weightKg)) continue;
    t[it.bag] += it.weightKg;
  }
  return t;
}
