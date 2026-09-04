// packing.js — packing-list generation and bag allocation. Pure logic, no
// storage and no React.
//
// A list is generated once per trip and then belongs to that trip forever: it's
// the record of what was actually taken, and it's re-used on the way home.
//
// You don't tell the app what things weigh or which bag they go in. Every item
// carries an estimated weight and packed volume, you say which bags the airline
// is letting you take, and allocate() works out what actually fits — because on
// a no-hold, no-cabin fare that's the real problem to solve.

export const CLIMATES = ["hot", "mild", "cold", "rainy", "snow", "mixed"];
export const TRIP_TYPES = ["leisure", "business", "beach", "hiking", "formal"];

// Bag types, with *usable* capacity — not the gross box volume, since nothing
// packs to 100%. Sizes follow the common European carrier allowances.
export const BAG_TYPES = {
  personal: { label: "Underseat", note: "40×30×20cm", volumeL: 20, maxKg: 7 },
  cabin: { label: "Cabin", note: "55×40×23cm", volumeL: 40, maxKg: 10 },
  hold: { label: "Hold", note: "checked", volumeL: 90, maxKg: 23 },
};
export const BAG_ORDER = ["personal", "cabin", "hold"];
export const WORN = "worn";   // carried on your body — costs no bag space

// [weightKg, volumeL] per item, packed. Estimates; the point is a realistic
// total, not precision.
const M = {
  tshirt: [0.15, 1.0], shirt: [0.2, 1.2], trousers: [0.5, 2.5], shorts: [0.25, 1.2],
  underwear: [0.05, 0.3], socks: [0.05, 0.25], jumper: [0.4, 3.0], fleece: [0.45, 3.0],
  coat: [1.2, 8.0], rainjacket: [0.4, 2.5], shoes: [0.9, 5.0], boots: [1.4, 7.0],
  sandals: [0.35, 2.0], swim: [0.15, 0.5], pyjamas: [0.3, 1.5], hat: [0.1, 1.0],
  toiletries: [0.15, 0.5], laptop: [1.4, 3.0], charger: [0.15, 0.3], adapter: [0.1, 0.2],
  powerbank: [0.25, 0.5], headphones: [0.25, 1.0], book: [0.35, 1.0],
  small: [0.05, 0.1], tiny: [0.02, 0.05],
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
// Templates. Each row: [label, measure, flags?]
//   measure — a key into M, or an explicit [kg, litres]
//   flags   — "reach" must stay within reach (passport, meds, phone)
//             "wearable" can be worn through the airport to free up bag space
const DOCUMENTS = (opts) => [
  ["Passport", "small", "reach"],
  ["Boarding passes / tickets", "tiny", "reach"],
  ["Travel insurance details", "tiny", "reach"],
  ["Bank / credit cards", "tiny", "reach"],
  ["Local cash", "tiny", "reach"],
  ...(opts.abroad ? [["Visa / entry permit (if needed)", "tiny", "reach"]] : []),
  ...(opts.driving ? [["Driving licence", "tiny", "reach"]] : []),
  ["Phone with offline maps + tickets saved", [0.2, 0.2], "reach"],
];

const CLIMATE_ITEMS = {
  hot: [["Sunglasses", "small"], ["Sun hat", "hat", "wearable"], ["Sunscreen", "toiletries"], ["Light long sleeves (sun / mosquitoes)", "shirt", "wearable"], ["Insect repellent", "toiletries"], ["Reusable water bottle", [0.2, 1.0]]],
  mild: [["Light jumper", "jumper", "wearable"], ["Packable rain jacket", "rainjacket", "wearable"], ["Umbrella", [0.3, 1.0]]],
  cold: [["Warm coat", "coat", "wearable"], ["Hat, gloves and scarf", [0.3, 2.0], "wearable"], ["Thermal base layer", [0.25, 1.0], "wearable"], ["Fleece / thick jumper", "fleece", "wearable"], ["Warm socks", [0.1, 0.5]]],
  rainy: [["Waterproof jacket", "rainjacket", "wearable"], ["Umbrella", [0.3, 1.0]], ["Waterproof shoes", "boots", "wearable"], ["Dry bag for electronics", [0.1, 0.5]], ["Spare socks", "socks"]],
  snow: [["Insulated coat", [1.5, 10.0], "wearable"], ["Waterproof gloves", [0.2, 1.0], "wearable"], ["Thermal base layers", [0.5, 2.0], "wearable"], ["Snow boots", "boots", "wearable"], ["Lip balm and moisturiser", "small"], ["Sunglasses / goggles (snow glare)", [0.15, 1.0]]],
  mixed: [["Layers (t-shirt + jumper + shell)", [0.8, 5.0], "wearable"], ["Packable rain jacket", "rainjacket", "wearable"], ["Both warm and cool footwear", "shoes", "wearable"]],
};

const TYPE_ITEMS = {
  leisure: [["Book / e-reader", "book"], ["Day bag", [0.3, 2.0]], ["Comfortable walking shoes", "shoes", "wearable"]],
  business: [["Laptop and charger", "laptop", "reach"], ["Suit / smart outfit", [1.0, 6.0]], ["Smart shoes", "shoes", "wearable"], ["Business cards", "tiny"], ["Notebook and pen", [0.2, 0.6]], ["Lanyard / office pass", "tiny", "reach"]],
  beach: [["Swimwear", "swim"], ["Beach towel", [0.4, 3.0]], ["Flip flops / sandals", "sandals", "wearable"], ["Aftersun", "toiletries"], ["Dry bag", [0.1, 0.5]]],
  hiking: [["Hiking boots", "boots", "wearable"], ["Daypack", [0.6, 3.0]], ["Water bottle / bladder", [0.3, 1.5]], ["Blister plasters", "tiny", "reach"], ["Head torch", [0.15, 0.4]], ["Offline maps downloaded", [0, 0]], ["Snacks", [0.3, 1.5], "reach"]],
  formal: [["Formal outfit", [1.2, 7.0]], ["Dress shoes", "shoes", "wearable"], ["Accessories / jewellery", [0.1, 0.3]], ["Garment bag", [0.3, 1.5]], ["Shoe polish / lint roller", [0.1, 0.4]]],
};

const TOILETRIES = [
  ["Toothbrush and toothpaste", "toiletries"],
  ["Deodorant", "toiletries"],
  ["Shampoo and shower gel", [0.3, 1.0]],
  ["Razor / shaving kit", [0.15, 0.5]],
  ["Hairbrush", [0.1, 0.4]],
  ["Any prescription medication", [0.1, 0.4], "reach"],
  ["Painkillers and plasters", [0.1, 0.3], "reach"],
  ["Hand sanitiser", "small", "reach"],
];

const TECH = [
  ["Phone charger", "charger", "reach"],
  ["Travel plug adapter", "adapter"],
  ["Power bank", "powerbank", "reach"],   // must be in the cabin by law anyway
  ["Headphones", "headphones", "reach"],
];

// Clothing scales with trip length but caps out — past a week you do laundry.
function clothing(days, climate) {
  const n = Math.min(days, 7);
  const warm = climate === "cold" || climate === "snow";
  const hot = climate === "hot";
  const tops = Math.max(2, Math.min(days, 6));
  const bottoms = days <= 3 ? 1 : 2;
  const mul = (key, k) => [+(M[key][0] * k).toFixed(2), +(M[key][1] * k).toFixed(2)];
  const out = [
    [`Underwear ×${n}`, mul("underwear", n)],
    [`Socks ×${n}`, mul("socks", n)],
    [`T-shirts / tops ×${tops}`, mul("tshirt", tops)],
    [`Trousers / bottoms ×${bottoms}`, mul("trousers", bottoms), "wearable"],
    ["Pyjamas / sleepwear", "pyjamas"],
  ];
  if (hot) out.push([`Shorts ×${bottoms}`, mul("shorts", bottoms)]);
  if (warm) out.push([`Warm jumpers ×${days <= 4 ? 1 : 2}`, mul("jumper", days <= 4 ? 1 : 2), "wearable"]);
  if (days > 7) out.push(["Laundry bag / travel detergent", [0.1, 0.5]]);
  return out;
}

// ---------------------------------------------------------------------------
let seq = 0;
const mkId = () => `pk-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;

function item(category, [label, measure, flags], source = "template") {
  const [weightKg, volumeL] = Array.isArray(measure) ? measure : M[measure] || M.small;
  return {
    id: mkId(), category, label, packed: false, returned: false, source,
    weightKg, volumeL,
    reach: flags === "reach" || undefined,          // needs to stay accessible
    wearable: flags === "wearable" || undefined,    // can be worn to save space
    bag: null,                                      // filled in by allocate()
    pinned: false,                                  // true once you move it by hand
  };
}

/**
 * Build a fresh packing list for a trip.
 * `essentials` is the user-level "things I always forget" list — one item each,
 * tagged source:'essentials' so they're visible per-trip but managed globally.
 */
export function generatePackingList(trip, { climate = "mild", tripType = "leisure", essentials = [], bags = null } = {}) {
  const days = tripDays(trip);
  const abroad = !(trip.countries || []).every((c) => (c.name || c) === "United Kingdom");
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
  push("Always forget", essentials.filter((e) => String(e).trim()).map((e) => [String(e).trim(), "small"]), "essentials");

  const list = {
    generatedAt: new Date().toISOString(),
    climate,
    tripType,
    bags: bags || { personal: 1, cabin: 1, hold: 0 },
    items,
  };
  return { ...list, items: allocate(list).items };
}

export function customItem(label) {
  return { id: mkId(), category: "Added on the trip", label, packed: false, returned: false, source: "custom", weightKg: 0.3, volumeL: 1.0, bag: null, pinned: false };
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

// ---------------------------------------------------------------------------
// Allocation
//
// Which bags you're allowed is the input; what fits is the output. Greedy
// first-fit-decreasing, which is within a few percent of optimal for this size
// of problem and — more usefully — produces an allocation a human can predict:
//
//   1. Anything you've pinned by hand stays where you put it.
//   2. Anything marked worn is on your body and costs no bag space.
//   3. "Reach" items (passport, meds, phone, power bank) go in the smallest bag
//      you have, so they're accessible — and a power bank can't fly in the hold.
//   4. Everything else, biggest first, into cabin then hold then underseat. Big
//      items placed first is what stops a coat being stranded by a pile of
//      socks; cabin before hold means the hold bag only takes the overflow, so
//      you can see when you didn't need to check anything at all.
//
// Anything that won't fit comes back in `overflow` rather than being silently
// dropped, because "this doesn't fit" is the answer you actually need.

// Expand the bag counts into individual bins, smallest first.
export function bagBins(bags) {
  const bins = [];
  for (const type of BAG_ORDER) {
    const n = Math.max(0, Math.min(9, Math.floor(Number(bags?.[type]) || 0)));
    for (let i = 1; i <= n; i++) {
      const spec = BAG_TYPES[type];
      bins.push({ id: `${type}-${i}`, type, index: i, label: n > 1 ? `${spec.label} ${i}` : spec.label,
        note: spec.note, volumeL: spec.volumeL, maxKg: spec.maxKg, usedL: 0, usedKg: 0, items: [] });
    }
  }
  return bins;
}

const fits = (bin, it) => bin.usedL + it.volumeL <= bin.volumeL + 1e-9 && bin.usedKg + it.weightKg <= bin.maxKg + 1e-9;
const place = (bin, it) => { bin.usedL += it.volumeL; bin.usedKg += it.weightKg; bin.items.push(it.id); };

/**
 * Assign every item to one of the available bags.
 * Returns { items (with .bag set), bins, overflow, worn }.
 */
export function allocate(list) {
  const bins = bagBins(list.bags);
  const byId = new Map(bins.map((b) => [b.id, b]));
  const items = list.items.map((i) => ({ ...i }));
  const overflow = [];
  const worn = [];

  const loose = [];
  for (const it of items) {
    if (it.bag === WORN) { worn.push(it); continue; }                  // on your body
    if (it.pinned && byId.has(it.bag)) { place(byId.get(it.bag), it); continue; }
    it.bag = null;
    loose.push(it);
  }

  // Reach items into the smallest bag that will take them; then everything else
  // biggest-first into cabin, then hold, then whatever's left underseat.
  const of = (...types) => bins.filter((b) => types.includes(b.type));
  const accessibleFirst = [...bins];                                  // personal → cabin → hold
  const carryFirst = [...of("cabin"), ...of("hold"), ...of("personal")];
  const reach = loose.filter((i) => i.reach).sort((a, b) => b.volumeL - a.volumeL);
  const rest = loose.filter((i) => !i.reach).sort((a, b) => b.volumeL - a.volumeL || b.weightKg - a.weightKg);

  for (const [group, order] of [[reach, accessibleFirst], [rest, carryFirst]]) {
    for (const it of group) {
      const bin = order.find((b) => fits(b, it));
      if (bin) { place(bin, it); it.bag = bin.id; }
      else overflow.push(it);
    }
  }

  return { items, bins, overflow, worn };
}

/**
 * The oldest trick for beating a baggage allowance: wear the bulky things.
 *
 * Greedily marks the biggest unworn wearable as worn until everything fits.
 * Note the overflow itself is often small stuff — the coat got packed first and
 * pushed the socks out — so this deliberately looks at every wearable item, not
 * just the ones that failed to fit.
 *
 * Returns { wear: [items to wear], list: the resulting list, clears: bool }.
 */
export function wearToFit(list, max = 6) {
  const wear = [];
  let cur = list;
  for (let i = 0; i <= max; i++) {
    if (!allocate(cur).overflow.length) return { wear, list: cur, clears: true };
    const cand = cur.items
      .filter((it) => it.wearable && it.bag !== WORN)
      .sort((a, b) => b.volumeL - a.volumeL)[0];
    if (!cand) break;
    wear.push(cand);
    cur = { ...cur, items: cur.items.map((it) => (it.id === cand.id ? { ...it, bag: WORN, pinned: true } : it)) };
  }
  return { wear, list: cur, clears: false };
}

// Older lists (and hand-added items) predate the weight/volume estimates.
export function ensureMeasures(list) {
  if (!list) return list;
  const items = list.items.map((i) => ({
    ...i,
    weightKg: Number.isFinite(i.weightKg) ? i.weightKg : 0.3,
    volumeL: Number.isFinite(i.volumeL) ? i.volumeL : 1.0,
    bag: i.bag === WORN || /^(personal|cabin|hold)-\d+$/.test(i.bag || "") ? i.bag : null,
    pinned: !!i.pinned,
  }));
  const bags = list.bags && BAG_ORDER.some((t) => list.bags[t] != null)
    ? list.bags
    // Pre-allocation lists stored baggageLimits instead; assume the usual pair.
    : { personal: 1, cabin: 1, hold: list.baggageLimits?.holdKg ? 1 : 0 };
  return { ...list, bags, items };
}
