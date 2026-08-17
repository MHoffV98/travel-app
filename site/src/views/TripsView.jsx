// TripsView.jsx — a browsable index of journeys, newest first, grouped by year.
// Trips are derived in data.js (home-aware clustering of flights + visits). Tap a
// card to expand its route map, itinerary, and an editor for name / memories /
// recommendations (saved to localStorage, no backend).
import { useState, useEffect, useRef } from "react";
import { TRIPS, CAT, countryFlagUrl, fmt, transportCat, loadTripMeta, saveTripMeta, SHARE_MODE, loadStopEdits, saveStopEdits, stopKey } from "../data.js";
import RouteMap from "../RouteMap.jsx";
import { downloadTripCard } from "../tripCard.js";
import { getPhotos, addPhotos, deletePhoto, photoCounts, photoTripKey } from "../photoStore.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function evDate(d) {
  const [y, m, day] = d.split("-");
  if (day) return `${+day} ${MONTHS[+m - 1]}`;
  if (m) return MONTHS[+m - 1];
  return y;
}

function Modes({ cats }) {
  return (
    <div className="trip-modes">
      {cats.map((c) => <span key={c} title={CAT[c]?.label} style={{ background: CAT[c]?.hex }} />)}
    </div>
  );
}

// A flight endpoint that opens the airport drill-down (falls back to plain text).
function ApLink({ ep, onOpenEntity }) {
  const label = ep?.city || ep?.iata;
  if (!label) return "?";
  if (!ep?.iata || !onOpenEntity) return label;
  return <button className="leg-ap" title={`${ep.iata} · flights`} onClick={() => onOpenEntity("airport", ep.iata)}>{label}</button>;
}

function Itinerary({ trip, onOpenEntity }) {
  // Collapse consecutive same-place visits into one row (e.g. three separate
  // "Bendigo" stays during a long trip) with a date range + ×count, so a repeat
  // base doesn't read as duplicated lines.
  const rows = [];
  for (const e of trip.events) {
    const text = e.kind === "flight"
      ? `${e.from?.city || e.from?.iata} → ${e.to?.city || e.to?.iata}`
      : (e.place || e.country_name);
    const last = rows[rows.length - 1];
    if (last && e.kind === "visit" && last.e.kind === "visit" && last.text === text) {
      last.count++; last.lastDate = e.date;
    } else {
      rows.push({ e, text, count: 1, lastDate: e.date });
    }
  }
  return (
    <ol className="trip-legs">
      {rows.map(({ e, text, count, lastDate }, i) => {
        const cat = transportCat(e.transport);
        const date = count > 1 ? `${evDate(e.date)}–${evDate(lastDate)}` : evDate(e.date);
        return (
          <li key={i}>
            <span className="trip-leg-date">{date}</span>
            <span className="trip-leg-dot" style={{ background: CAT[cat]?.hex }} />
            <span className="trip-leg-text">
              {e.kind === "flight"
                ? <><ApLink ep={e.from} onOpenEntity={onOpenEntity} /> → <ApLink ep={e.to} onOpenEntity={onOpenEntity} />{e.airline ? <em> · {e.airline}</em> : null}</>
                : <>{text}{count > 1 ? <em> ·&nbsp;×{count}</em> : null}{e.notes ? <em> · {e.notes}</em> : null}</>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TripEditor({ trip, meta, onChange }) {
  return (
    <div className="trip-editor">
      <label>
        <span>Trip name</span>
        <input
          type="text" placeholder={trip.defaultName} value={meta.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <label>
        <span>Memories</span>
        <textarea
          rows={3} placeholder="Notes, moments, who you went with…" value={meta.memories ?? ""}
          onChange={(e) => onChange({ memories: e.target.value })}
        />
      </label>
      <label>
        <span>Recommendations</span>
        <textarea
          rows={3} placeholder="Places to eat, stay, things to do…" value={meta.recommendations ?? ""}
          onChange={(e) => onChange({ recommendations: e.target.value })}
        />
      </label>
    </div>
  );
}

function Lightbox({ photos, index, onClose, onIndex }) {
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onIndex((index + 1) % photos.length);
      else if (e.key === "ArrowLeft") onIndex((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, photos.length]);
  const p = photos[index];
  if (!p) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lb-close" onClick={onClose} aria-label="Close">✕</button>
      {photos.length > 1 && <button className="lb-nav lb-prev" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + photos.length) % photos.length); }} aria-label="Previous">‹</button>}
      <img src={p.url} alt="" onClick={(e) => e.stopPropagation()} />
      {photos.length > 1 && <button className="lb-nav lb-next" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % photos.length); }} aria-label="Next">›</button>}
      {photos.length > 1 && <div className="lb-count">{index + 1} / {photos.length}</div>}
    </div>
  );
}

function TripPhotos({ trip, onCount }) {
  const [photos, setPhotos] = useState([]); // {id, url, pathname?, revoke?}
  const [busy, setBusy] = useState(false);
  const [lb, setLb] = useState(-1);
  const inputRef = useRef(null);
  const revokable = useRef([]); // local blob: URLs to release

  const load = async () => {
    revokable.current.forEach((u) => URL.revokeObjectURL(u));
    const recs = await getPhotos(trip.id);
    revokable.current = recs.filter((r) => r.revoke).map((r) => r.url);
    setPhotos(recs);
    onCount?.(trip.id, recs.length);
  };
  useEffect(() => { load(); return () => revokable.current.forEach((u) => URL.revokeObjectURL(u)); }, [trip.id]);

  const onAdd = async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setBusy(true);
    try { await addPhotos(trip.id, files); }
    finally { await load(); setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  const remove = async (rec) => { await deletePhoto(trip.id, rec); await load(); };

  return (
    <div className="trip-photos">
      <div className="tp-head">
        <span>Photos <span className="muted small">on this device</span></span>
        <button className="tp-add" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "Adding…" : "＋ Add"}</button>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onAdd} />
      </div>
      {photos.length > 0 && (
        <div className="tp-grid">
          {photos.map((p, i) => (
            <div className="tp-thumb" key={p.id}>
              <img src={p.url} alt="" loading="lazy" onClick={() => setLb(i)} />
              <button className="tp-del" onClick={() => remove(p)} aria-label="Remove photo">✕</button>
            </div>
          ))}
        </div>
      )}
      {lb >= 0 && <Lightbox photos={photos} index={lb} onClose={() => setLb(-1)} onIndex={setLb} />}
    </div>
  );
}

// In-app structural editor for a trip's manual stops (dates / nights / place /
// remove). Saves a per-device overlay (localStorage) applied on reload — no
// redeploy needed. Reordering is done by editing dates (nights auto-set the end).
function StopEditor({ trip }) {
  const [open, setOpen] = useState(false);
  const stops = trip.events.filter((e) => e.kind === "visit" && e.raw);
  const [rows, setRows] = useState(() => stops.map((e) => ({
    key: stopKey({ place: e.place, country_name: e.country_name, start: e.date }),
    place: e.place || "", start: e.date || "", nights: e.raw.nights ?? "", notes: e.raw.notes || "", removed: false,
  })));
  const [dirty, setDirty] = useState(false);
  const upd = (i, f, v) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [f]: v } : r))); setDirty(true); };
  const endFrom = (start, nights) => {
    const n = Number(nights);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !n) return start;
    const d = new Date(start + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); // noon UTC avoids DST/timezone day-shift
    return d.toISOString().slice(0, 10);
  };
  const save = () => {
    const ov = loadStopEdits();
    for (const r of rows) {
      if (r.removed) { if (!ov.deleted.includes(r.key)) ov.deleted.push(r.key); delete ov.edited[r.key]; }
      else ov.edited[r.key] = { place: r.place, start: r.start, end: endFrom(r.start, r.nights), nights: r.nights === "" ? null : Number(r.nights), notes: r.notes };
    }
    saveStopEdits(ov);
    location.reload();
  };
  const resetAll = () => { saveStopEdits({ edited: {}, deleted: [] }); location.reload(); };
  if (!stops.length) return null;
  return (
    <div className="stop-editor">
      <button className="se-toggle" onClick={() => setOpen((o) => !o)}>✎ Edit stops {open ? "▾" : "▸"}</button>
      {open && (
        <div className="se-body">
          {rows.map((r, i) => (
            <div className={`se-row ${r.removed ? "removed" : ""}`} key={i}>
              <input className="se-place" value={r.place} onChange={(e) => upd(i, "place", e.target.value)} placeholder="Place" />
              <input className="se-date" type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(r.start) ? r.start : ""} onChange={(e) => upd(i, "start", e.target.value)} />
              <input className="se-nights" type="number" min="0" value={r.nights} onChange={(e) => upd(i, "nights", e.target.value)} title="nights" />
              <button className="se-del" onClick={() => upd(i, "removed", !r.removed)} title={r.removed ? "Undo remove" : "Remove stop"}>{r.removed ? "↺" : "✕"}</button>
            </div>
          ))}
          <div className="se-actions">
            <button className="se-save" disabled={!dirty} onClick={save}>Save &amp; apply</button>
            <button className="se-reset" onClick={resetAll} title="Clear all your in-app stop edits">Reset</button>
          </div>
          <p className="muted small">Saves on this device instantly (page reloads). To add a brand-new stop use the <b>Add</b> tab. To make edits permanent everywhere &amp; in stats, mirror them in <code>data/manual_trips.csv</code> then <code>npm run deploy</code>.</p>
        </div>
      )}
    </div>
  );
}

function TripCard({ trip, meta, onMeta, onSelect, onOpenEntity, open, onToggle, photoCount, onCount }) {
  const name = (meta.name || "").trim() || trip.defaultName;
  const [sharing, setSharing] = useState(false);
  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const lines = trip.events.map((e) => {
        const t = e.kind === "flight"
          ? `${e.from?.city || e.from?.iata} → ${e.to?.city || e.to?.iata}`
          : (e.place || e.country_name);
        return `${evDate(e.date)} · ${t}`;
      });
      const stats = [["COUNTRIES", trip.countries.length]];
      if (trip.distance > 0) stats.push(["KM FLOWN", fmt(Math.round(trip.distance))]);
      if (trip.nights > 0) stats.push(["NIGHTS", trip.nights]);
      if (trip.flights.length) stats.push(["FLIGHTS", trip.flights.length]);
      else if (trip.places.length) stats.push(["PLACES", trip.places.length]);
      await downloadTripCard({
        name, dateLabel: trip.dateLabel,
        countriesText: trip.countries.map((c) => c.name).join("  ·  "),
        legs: trip.mapLegs, ground: trip.mapGround, inferred: trip.mapInferred,
        points: trip.mapPoints, fit: trip.mapFocus,
        stats, lines, filename: `trip-${trip.id}`,
      });
    } finally { setSharing(false); }
  };
  return (
    <div id={`trip-${trip.id}`} className={"trip-card" + (open ? " open" : "") + (trip.upcoming ? " upcoming" : "")}>
      <button className="trip-head" onClick={onToggle}>
        <div className="trip-flags">
          {trip.countries.slice(0, 6).map((c) => {
            const url = countryFlagUrl(c, 40);
            return (
              <span key={c.iso3} className="trip-flag" title={`${c.name} · open`} role="button" tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onSelect?.(c.iso3); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); onSelect?.(c.iso3); } }}>
                {url
                  ? <img src={url} alt={c.name} loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
                  : <span className="flag-fallback">{c.iso3}</span>}
              </span>
            );
          })}
          {trip.countries.length > 6 && <span className="trip-more">+{trip.countries.length - 6}</span>}
        </div>
        <div className="trip-main">
          <div className="trip-title">{trip.upcoming && <span className="trip-upcoming">UPCOMING</span>}{trip.birthday && <span className="trip-cake">🎂</span>}{name}{meta.memories ? <span className="trip-note" title="Has memories">✎</span> : null}{photoCount > 0 ? <span className="trip-note" title={`${photoCount} photo${photoCount > 1 ? "s" : ""}`}>📷</span> : null}</div>
          <div className="trip-sub">{trip.dateLabel}</div>
        </div>
        <div className="trip-meta">
          <Modes cats={trip.transports} />
          <span className="trip-stat">
            {trip.flights.length ? `${trip.flights.length} flight${trip.flights.length > 1 ? "s" : ""}` : `${trip.events.length} leg${trip.events.length > 1 ? "s" : ""}`}
          </span>
        </div>
      </button>
      {open && (
        <div className="trip-body">
          <RouteMap legs={trip.mapLegs} points={trip.mapPoints} ground={trip.mapGround} inferred={trip.mapInferred} fit={trip.mapFocus} />
          <div className="trip-bigstats">
            <div><b>{trip.countries.length}</b><span>countr{trip.countries.length === 1 ? "y" : "ies"}</span></div>
            {trip.distance > 0 && <div><b>{fmt(Math.round(trip.distance))}</b><span>km flown</span></div>}
            {trip.nights > 0 && <div><b>{trip.nights}</b><span>nights</span></div>}
            {trip.places.length > 0 && <div><b>{trip.places.length}</b><span>places</span></div>}
          </div>
          <TripPhotos trip={trip} onCount={onCount} />
          <Itinerary trip={trip} onOpenEntity={onOpenEntity} />
          <button className="trip-share" onClick={share} disabled={sharing}>
            {sharing ? "Building card…" : "📤 Share trip card"}
          </button>
          <TripEditor trip={trip} meta={meta} onChange={(patch) => onMeta(trip.id, patch)} />
          {!SHARE_MODE && <StopEditor trip={trip} />}
        </div>
      )}
    </div>
  );
}

export default function TripsView({ onSelect, onOpenEntity, focusTrip }) {
  const [openId, setOpenId] = useState(null);
  const [meta, setMeta] = useState(loadTripMeta);
  const [counts, setCounts] = useState({});

  useEffect(() => { photoCounts().then(setCounts).catch(() => {}); }, []);

  // Opened from elsewhere (a country panel, "on this day"…): expand + scroll to it.
  useEffect(() => {
    if (!focusTrip?.id) return;
    setOpenId(focusTrip.id);
    const t = setTimeout(() => document.getElementById(`trip-${focusTrip.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    return () => clearTimeout(t);
  }, [focusTrip]);
  const onCount = (id, n) => setCounts((c) => { const k = photoTripKey(id); return c[k] === n ? c : { ...c, [k]: n }; });

  const onMeta = (id, patch) => {
    setMeta((m) => {
      const next = { ...m, [id]: { ...m[id], ...patch } };
      saveTripMeta(next);
      return next;
    });
  };

  const groups = [];
  let last = null;
  for (const t of TRIPS) {
    if (t.year !== last) { groups.push({ year: t.year, trips: [] }); last = t.year; }
    groups[groups.length - 1].trips.push(t);
  }

  return (
    <div className="trips-view">
      <div className="trips-head">
        <h2>{TRIPS.filter((t) => !t.upcoming).length} trips{TRIPS.some((t) => t.upcoming) ? <span className="muted"> · {TRIPS.filter((t) => t.upcoming).length} upcoming</span> : null}</h2>
        <span className="muted small">Every journey, newest first · tap to open the route, itinerary &amp; add your own notes</span>
      </div>
      {groups.map((g) => (
        <section key={g.year} className="trips-year">
          <h3>{g.year}</h3>
          {g.trips.map((t) => (
            <TripCard
              key={t.id} trip={t} meta={meta[t.id] || {}} onMeta={onMeta} onSelect={onSelect} onOpenEntity={onOpenEntity}
              open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)}
              photoCount={counts[photoTripKey(t.id)] || 0} onCount={onCount}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
