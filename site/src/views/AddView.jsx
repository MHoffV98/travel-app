// AddView.jsx — capture manual trips/stays on-device and export them as
// data/manual_trips.csv rows. For flights, just drop a Flighty export into data/
// and run `npm run deploy` (the pipeline ingests it automatically).
import { useMemo, useRef, useState } from "react";
import { data } from "../data.js";
import { loadPending, savePending, toCsv, detectFlightCsv } from "../addData.js";

const TRANSPORTS = ["flight", "train", "car", "road", "bus", "cruise", "ferry", "walk"];
const PRECISIONS = [["day", "exact day"], ["day_approx", "approx day"], ["month", "month"], ["month_approx", "approx month"]];
const BLANK = { country: "", place: "", start_date: "", end_date: "", nights: "", transport: "flight", type: "visit", date_precision: "day", lat: "", lon: "", notes: "", trip: "" };

export default function AddView() {
  const [rows, setRows] = useState(loadPending);
  const [f, setF] = useState(BLANK);
  const [copied, setCopied] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const countryNames = useMemo(() => [...new Set(data.countries.map((c) => c.name))].sort(), []);
  const valid = f.country.trim() && f.start_date.trim();

  // Flight-export import (Flighty / FR24): preview + download with the canonical
  // filename. Flights aren't appended row-by-row — the pipeline reads the whole
  // export, so the flow is: drop the file into data/ and publish.
  const [imp, setImp] = useState(null);
  const fileRef = useRef(null);
  const onImport = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    setImp({ ...detectFlightCsv(text), name: file.name, text });
    if (fileRef.current) fileRef.current.value = "";
  };
  const downloadFlights = () => {
    const nm = imp.source === "fr24" ? "fr24.csv" : "flighty.csv";
    const blob = new Blob([imp.text], { type: "text/csv" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = u; a.download = nm; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };

  const commit = (next) => { setRows(next); savePending(next); };
  const add = () => {
    if (!valid) return;
    commit([...rows, { ...f }]);
    setF((s) => ({ ...BLANK, transport: s.transport, type: s.type, date_precision: s.date_precision, trip: s.trip }));
  };
  const remove = (i) => commit(rows.filter((_, j) => j !== i));
  const clearAll = () => { if (confirm("Remove all pending rows?")) commit([]); };

  const csvRows = rows.length ? toCsv(rows, false) : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(csvRows); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* fall back to manual select */ }
  };
  const download = () => {
    const blob = new Blob([toCsv(rows, true) + "\n"], { type: "text/csv" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = u; a.download = "manual_trips_additions.csv"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };

  return (
    <div className="add-view">
      <div className="add-head">
        <h2>Add trips</h2>
        <p className="muted small">Log overland / cruise / day trips that flights don’t capture. They’re saved <b>on this device</b> until you export the rows into <code>data/manual_trips.csv</code> and run <code>npm run deploy</code>. <b>Flights:</b> just drop a fresh Flighty export into <code>data/</code> and publish, no need to enter them here.</p>
      </div>

      <div className="add-import">
        <div className="ai-head">
          <span><b>Flights</b>: import a Flighty or FR24 export</span>
          <button className="ai-pick" onClick={() => fileRef.current?.click()}>Choose CSV…</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImport} />
        </div>
        {imp && (
          <div className={`ai-preview ${imp.source ? "" : "bad"}`}>
            {imp.source ? (
              <>
                <div>Detected <b>{imp.source === "fr24" ? "FR24" : "Flighty"}</b> · {imp.count} flights{imp.first ? ` · ${imp.first} → ${imp.last}` : ""}</div>
                <div className="muted small">Save it as <code>{imp.source === "fr24" ? "fr24.csv" : "flighty.csv"}</code> into <code>data/</code>, then <code>npm run deploy</code>. Future-dated flights show as “booked” automatically.</div>
                <button className="ai-dl" onClick={downloadFlights}>Download as {imp.source === "fr24" ? "fr24.csv" : "flighty.csv"}</button>
              </>
            ) : <div>Couldn’t recognise <b>{imp.name}</b> as a Flighty or FR24 export.</div>}
          </div>
        )}
      </div>

      <h3 className="add-sub">Manual trip / stay</h3>
      <div className="add-form">
        <label className="af-wide"><span>Country *</span>
          <input list="af-countries" value={f.country} onChange={set("country")} placeholder="e.g. Portugal" />
          <datalist id="af-countries">{countryNames.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <label><span>Place / city</span><input value={f.place} onChange={set("place")} placeholder="e.g. Lisbon" /></label>
        <label><span>Start date *</span><input type="date" value={f.start_date} onChange={set("start_date")} /></label>
        <label><span>End date</span><input type="date" value={f.end_date} onChange={set("end_date")} /></label>
        <label><span>Nights</span><input type="number" min="0" value={f.nights} onChange={set("nights")} placeholder="e.g. 3" /></label>
        <label><span>Transport</span><select value={f.transport} onChange={set("transport")}>{TRANSPORTS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label><span>Type</span><select value={f.type} onChange={set("type")}><option value="visit">visit (counts)</option><option value="transit">transit (passing through)</option></select></label>
        <label><span>Date precision</span><select value={f.date_precision} onChange={set("date_precision")}>{PRECISIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label><span>Lat</span><input value={f.lat} onChange={set("lat")} placeholder="optional" inputMode="decimal" /></label>
        <label><span>Lon</span><input value={f.lon} onChange={set("lon")} placeholder="optional" inputMode="decimal" /></label>
        <label className="af-wide"><span>Notes</span><input value={f.notes} onChange={set("notes")} placeholder="e.g. road trip along the coast" /></label>
        <label><span>Trip id</span><input value={f.trip} onChange={set("trip")} placeholder="group legs, e.g. iberia-2025" /></label>
        <div className="af-actions">
          <span className="muted small">Tip: grab lat/lon from Google Maps (right-click → the coordinates copy to clipboard).</span>
          <button className="af-add" disabled={!valid} onClick={add}>＋ Add row</button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="add-pending">
          <div className="ap-head"><b>{rows.length} pending row{rows.length > 1 ? "s" : ""}</b><button className="ap-clear" onClick={clearAll}>Clear all</button></div>
          <ul className="ap-list">
            {rows.map((r, i) => (
              <li key={i}>
                <span className="ap-main">{r.country}{r.place ? ` · ${r.place}` : ""}</span>
                <span className="ap-sub">{r.start_date}{r.end_date ? `–${r.end_date}` : ""}{r.nights ? ` · ${r.nights}n` : ""} · {r.transport}{r.type === "transit" ? " · transit" : ""}</span>
                <button className="ap-del" onClick={() => remove(i)} aria-label="Remove">✕</button>
              </li>
            ))}
          </ul>
          <div className="ap-export">
            <div className="ap-l">EXPORT · append these lines to <code>data/manual_trips.csv</code>, then <code>npm run deploy</code></div>
            <textarea readOnly value={csvRows} onFocus={(e) => e.target.select()} rows={Math.min(8, rows.length + 1)} />
            <div className="ap-btns">
              <button onClick={copy}>{copied ? "Copied ✓" : "Copy rows"}</button>
              <button onClick={download}>Download .csv</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
