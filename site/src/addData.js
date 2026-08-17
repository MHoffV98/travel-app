// addData.js — capture manual trip/stay rows in the browser for later export
// into data/manual_trips.csv. No backend: rows live in localStorage until you
// export them and run `npm run deploy`. Columns match the pipeline's CSV exactly.
const KEY = "travelmap_pending_rows";
export const COLUMNS = ["country", "start_date", "end_date", "date_precision", "transport", "type", "notes", "place", "lat", "lon", "nights", "trip"];

export function loadPending() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function savePending(rows) {
  try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { /* ignore quota */ }
}

// Sniff a pasted/loaded flight export and summarise it, so flights can be
// previewed before being dropped into data/ (the pipeline ingests the whole file).
export function detectFlightCsv(text) {
  const lines = (text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { source: null, count: 0 };
  const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  let source = null;
  if (header.includes("flight class") || header.includes("dep time")) source = "fr24";
  else if (header.some((h) => h.includes("dep scheduled")) || header.includes("canceled") || header.includes("flight")) source = "flighty";
  const dateIdx = Math.max(0, header.findIndex((h) => h === "date"));
  const dates = [];
  for (let i = 1; i < lines.length; i++) {
    const d = (lines[i].split(",")[dateIdx] || "").trim().replace(/^"|"$/g, "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) dates.push(d);
  }
  dates.sort();
  return { source, count: lines.length - 1, first: dates[0] || null, last: dates.at(-1) || null };
}

function esc(v) {
  const s = v == null ? "" : String(v).trim();
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function rowToCsv(r) { return COLUMNS.map((c) => esc(r[c])).join(","); }
export function toCsv(rows, withHeader) {
  const body = rows.map(rowToCsv).join("\n");
  return withHeader ? COLUMNS.join(",") + "\n" + body : body;
}
