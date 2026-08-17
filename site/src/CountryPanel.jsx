// CountryPanel.jsx — country detail styled as a boarding pass (per DESIGN.md):
// huge IATA-style code, passport stamp, perforation, mono stat row, a city
// mini-map, a deduplicated trip log, and an editable recommendations list.
import { useEffect, useMemo, useState } from "react";
import { data, byIso, SHARE_MODE, transportCat, CAT, TRIPS } from "./data.js";
import MiniMap from "./MiniMap.jsx";

let recosCache = null;
const LS_KEY = "travelmap_recos";
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; } };
const saveLocal = (o) => { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { /* ignore */ } };
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
// The current/primary home (open-ended era) gets the full "home base" treatment;
// a FORMER home base (e.g. Australia 2022–2024) is shown as a normal visited
// country plus a "lived here" note, so its real trips aren't hidden.
const CURRENT_HOME_NAME = (data.config.home_bases.find((e) => e.end == null) || {}).country;

// "2022-06-30" -> "30 JUN 2022", "1999-08" -> "AUG 1999", "2006" -> "2006"
function fmtD(s) {
  if (!s) return "–";
  const p = s.split("-");
  if (SHARE_MODE && p.length === 3) return `${MON[+p[1] - 1]} ${p[0]}`;
  if (p.length === 3) return `${(+p[2])} ${MON[+p[1] - 1]} ${p[0]}`;
  if (p.length === 2) return `${MON[+p[1] - 1]} ${p[0]}`;
  return p[0];
}

// sequence number = order of first visit among visited countries
const SEQ = (() => {
  const m = {};
  data.countries.filter((c) => c.status === "visited" && c.first_visit)
    .sort((a, b) => (a.first_visit < b.first_visit ? -1 : 1)).forEach((c, i) => (m[c.iso3] = i + 1));
  return m;
})();

function Stamp({ code, year }) {
  const rot = ((code.charCodeAt(0) + code.charCodeAt(2)) % 9) - 4; // -4..4°, stable per country
  return (
    <svg className="bp-stamp" viewBox="0 0 120 120" style={{ transform: `rotate(${rot}deg)` }}>
      <circle cx="60" cy="60" r="54" className="bp-stamp-ring" />
      <circle cx="60" cy="60" r="46" className="bp-stamp-ring2" />
      <path id="arc" d="M22,60 A38,38 0 0 1 98,60" fill="none" />
      <text className="bp-stamp-name"><textPath href="#arc" startOffset="50%">VISITED</textPath></text>
      <text x="60" y="68" className="bp-stamp-code">{code}</text>
      <text x="60" y="88" className="bp-stamp-year">{year || ""}</text>
    </svg>
  );
}

export default function CountryPanel({ iso, onClose, onOpenTrip, onOpenEntity }) {
  const c = byIso[iso];
  const isPrimaryHome = !!c && c.name === CURRENT_HOME_NAME;
  const [recos, setRecos] = useState(recosCache);
  const key = c?.recommendations_key;
  const [draft, setDraft] = useState("");
  const [list, setList] = useState([]);

  useEffect(() => {
    if (recosCache) return;
    fetch(`${import.meta.env.BASE_URL}recommendations.json`).then((r) => r.json())
      .then((j) => { recosCache = j; setRecos(j); }).catch(() => { recosCache = {}; setRecos({}); });
  }, []);
  useEffect(() => { const local = loadLocal(); setList(local[key] ?? recos?.[key] ?? []); }, [key, recos]);

  const persist = (next) => { setList(next); const local = loadLocal(); local[key] = next; saveLocal(local); };
  const addReco = () => { const t = draft.trim(); if (!t) return; persist([...list, t]); setDraft(""); };
  const removeReco = (i) => persist(list.filter((_, j) => j !== i));
  const copyJson = () => { const m = { ...(recos || {}), ...loadLocal() }; delete m._readme; navigator.clipboard?.writeText(JSON.stringify(m, null, 2)); };

  const [openTrip, setOpenTrip] = useState(null);

  // deduplicated trip log — touches grouped (>14-day gap = new trip), home
  // periods excluded. Each trip keeps its events (legs/towns + transport).
  const trips = useMemo(() => {
    if (!c || isPrimaryHome) return [];
    const evs = [];
    for (const f of data.flights) {
      if (f.status === "cancelled") continue;
      const into = f.to?.country === iso, out = f.from?.country === iso;
      if (!into && !out) continue;
      evs.push({ date: f.date, kind: "flight", label: `${f.from.iata}→${f.to.iata}`, fromIata: f.from?.iata, toIata: f.to?.iata, city: into ? f.to.city : f.from.city, cat: "air" });
    }
    for (const v of data.visits) if (v.country === iso && v.kind === "visit" && v.start)
      evs.push({ date: v.start, kind: "manual", label: v.place || v.country_name, city: v.place, cat: transportCat((v.transport || "").split(/[+/]/)[0]) });
    const isHome = (d) => data.config.home_bases.some((e) => e.country === c.name && d >= e.start && (e.end == null || d < e.end));
    const rel = evs.filter((e) => e.date && !isHome(e.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const groups = [];
    for (const e of rel) {
      const last = groups.at(-1);
      if (!last || new Date(e.date) - new Date(last.at(-1).date) > 14 * 86400000) groups.push([e]);
      else last.push(e);
    }
    // Keep only the qualifying stays (same set the top TRIPS count uses), so a
    // 0-night layover cluster doesn't appear as a numbered trip. If the pipeline
    // hasn't emitted starts (older data), fall back to showing all groups.
    const qualify = c.visit_starts ? new Set(c.visit_starts) : null;
    const kept = qualify ? groups.filter((g) => qualify.has(g[0].date)) : groups;
    return kept.map((g) => ({
      start: g[0].date, events: g, cities: [...new Set(g.map((e) => e.city).filter(Boolean))],
      // link to the full trip this stay belongs to (the trip whose span contains it)
      tripId: (TRIPS.find((t) => t.start <= g[0].date && g[0].date <= t.end) || {}).id,
    }));
  }, [iso, c]);

  // home-base history for the home country (makes clear it changed + wasn't continuous)
  const homeSegs = useMemo(() => {
    if (!isPrimaryHome) return [];
    const eras = [...data.config.home_bases].sort((a, b) => (a.start < b.start ? -1 : 1));
    const out = [];
    for (let i = 0; i < eras.length; i++) {
      const e = eras[i], prevEnd = eras[i - 1]?.end;
      if (prevEnd && prevEnd < e.start) out.push({ gap: true, start: prevEnd, end: e.start });
      out.push({ city: e.city, country: e.country, start: e.start, end: e.end, away: e.country !== c.name });
    }
    return out;
  }, [c]);

  if (!c) return null;
  const highlight = openTrip != null && trips[openTrip] ? new Set(trips[openTrip].cities) : null;
  const modes = [...new Set((c.transports || []).map(transportCat))].filter((m) => CAT[m]);
  const statusLabel = c.status === "transit" ? "TRANSIT" : c.status === "upcoming" ? "PLANNED" : c.layover_visit ? "LAYOVER" : "VISITED";
  const myEras = data.config.home_bases.filter((e) => e.country === c.name).sort((a, b) => (a.start < b.start ? -1 : 1));
  const wasHome = c.is_home && !isPrimaryHome;
  const sub = [
    isPrimaryHome ? "home base"
      : wasHome && myEras.length
        ? `home base · ${myEras[0].city} ’${myEras[0].start.slice(2, 4)}–${myEras.at(-1).end ? "’" + myEras.at(-1).end.slice(2, 4) : "now"}`
        : null,
    c.is_territory ? "territory" : null,
    c.layover_visit ? "layover" : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="boarding-pass">
      <button className="cp-close" onClick={onClose} aria-label="Close">✕</button>

      <div className="bp-strip" />
      <div className="bp-eyebrow">BOARDING PASS · <span className="bp-status">{statusLabel}</span><span className="bp-seq">SEQ #{String(SEQ[iso] || 0).padStart(3, "0")}</span></div>

      <div className="bp-head">
        <div className="bp-id">
          <div className="bp-code">{iso}</div>
          <div className="bp-name">{c.name}</div>
          {sub && <div className="bp-sub">{sub}</div>}
        </div>
        <Stamp code={iso} year={(c.first_visit || "").slice(0, 4)} />
      </div>

      <div className="bp-stats">
        <div><span className="bp-l">TRIPS</span><b>{isPrimaryHome ? "HOME" : c.visit_count}</b></div>
        <div><span className="bp-l">CITIES</span><b>{c.cities || "–"}</b></div>
        {!c.is_home && <div><span className="bp-l">NIGHTS</span><b>{c.nights ? c.nights.toLocaleString() : "–"}</b></div>}
        {c.is_home && c.home_nights
          ? <div><span className="bp-l">LIVED</span><b title={`${c.home_nights.toLocaleString()} nights`}>{Math.round(c.home_nights / 365)} yrs</b></div>
          : <div><span className="bp-l">FIRST</span><b>{fmtD(c.first_visit)}</b></div>}
        <div><span className="bp-l">{isPrimaryHome ? "SINCE" : "LATEST"}</span><b>{fmtD(isPrimaryHome ? c.first_visit : c.last_visit)}</b></div>
      </div>

      <div className="bp-perf"><span /><span /></div>

      <div className="bp-body">
        <div className="bp-col">
          <div className="bp-l">◉ CITIES VISITED</div>
          {c.status !== "transit" ? <MiniMap iso={iso} highlight={highlight} /> : <p className="muted small">Transit only.</p>}
          {modes.length > 0 && (
            <div className="bp-legend">
              {modes.map((m) => <span key={m}><i style={{ background: CAT[m].hex }} />{CAT[m].label}</span>)}
            </div>
          )}
        </div>
        <div className="bp-col">
          <div className="bp-l">▦ {isPrimaryHome ? "HOME BASE · CHANGED 3×" : wasHome ? "LIVED HERE · TRIPS" : "TRIP LOG"} <span className="muted">{!isPrimaryHome && trips.length ? "· tap to expand" : ""}</span></div>
          {isPrimaryHome ? (
            <div className="bp-homelog">
              {homeSegs.map((s, i) => s.gap ? (
                <div className="bp-home-seg gap" key={i}><span className="bp-tnum">~</span><span className="bp-tdate">travelling · {s.start.slice(0, 4)}–{s.end.slice(0, 4)}</span></div>
              ) : (
                <div className={`bp-home-seg ${s.away ? "away" : ""}`} key={i}>
                  <span className="bp-tnum">{s.away ? "✈" : "⌂"}</span>
                  <span className="bp-tdate">{s.city}{s.away ? ` · ${s.country}` : ""} · {s.start.slice(0, 4)}–{s.end ? s.end.slice(0, 4) : "now"}</span>
                  {s.away && <span className="bp-first">AWAY</span>}
                </div>
              ))}
            </div>
          ) : (
            <>
              {wasHome && myEras.map((e, i) => (
                <div className="bp-home-seg" key={`era-${i}`}>
                  <span className="bp-tnum">⌂</span>
                  <span className="bp-tdate">Lived in {e.city} · {e.start.slice(0, 4)}–{e.end ? e.end.slice(0, 4) : "now"}</span>
                  <span className="bp-first">LIVED</span>
                </div>
              ))}
              {trips.length ? (
              trips.map((t, i) => (
              <div key={i}>
                <button className={`bp-trip ${openTrip === i ? "open" : ""}`} onClick={() => setOpenTrip(openTrip === i ? null : i)}>
                  <span className="bp-tnum">{String(i + 1).padStart(2, "0")}</span>
                  <span className="bp-tdate">{fmtD(t.start)}</span>
                  {t.start === c.first_visit && <span className="bp-first">FIRST</span>}
                  <span className="bp-caret">{openTrip === i ? "▾" : "▸"}</span>
                </button>
                {openTrip === i && (
                  <div className="bp-trip-detail">
                    {t.events.map((e, j) => (
                      <div className="bp-leg" key={j}>
                        <i style={{ background: CAT[e.cat]?.hex || "#f59e0b" }} />
                        <span className="bp-leg-date">{fmtD(e.date)}</span>
                        <span className="bp-leg-label">
                          {e.kind === "flight" && e.fromIata && onOpenEntity
                            ? <><button className="leg-ap" onClick={() => onOpenEntity("airport", e.fromIata)}>{e.fromIata}</button>→<button className="leg-ap" onClick={() => onOpenEntity("airport", e.toIata)}>{e.toIata}</button></>
                            : e.label}
                        </span>
                      </div>
                    ))}
                    {t.tripId && onOpenTrip && (
                      <button className="bp-open-trip" onClick={() => onOpenTrip(t.tripId)}>View full trip →</button>
                    )}
                  </div>
                )}
              </div>
            ))
              ) : (!wasHome && <p className="muted small">–</p>)}
            </>
          )}
        </div>
      </div>

      <div className="bp-recos">
        <div className="bp-l">★ RECOMMENDATIONS</div>
        <ul className="cp-recos">
          {list.map((r, i) => <li key={i}>{r}<button className="reco-x" onClick={() => removeReco(i)} aria-label="Remove">×</button></li>)}
          {!list.length && <li className="muted small no-recos">No tips yet. Add one below.</li>}
        </ul>
        <div className="reco-add">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addReco()} placeholder={`A tip for ${c.name}…`} />
          <button onClick={addReco} aria-label="Add">＋</button>
        </div>
        <button className="reco-copy" onClick={copyJson}>Copy all as JSON →&nbsp;recommendations.json</button>
      </div>
    </div>
  );
}
