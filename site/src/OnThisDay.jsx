// OnThisDay.jsx — a small dismissible greeting card: what you were doing on
// today's calendar date in past years. Shows nothing if there's no match.
import { useMemo, useState } from "react";
import { data, TRIPS } from "./data.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
// precision-aware bounds: "2017-06" → covers all of June; "2017" → all year
const lo = (s) => { const [y, m, d] = s.split("-"); return `${y}-${m || "01"}-${d || "01"}`; };
const hi = (s) => { const [y, m, d] = s.split("-"); const mm = m || "12"; const dd = d || pad(new Date(+y, +mm, 0).getDate()); return `${y}-${mm}-${dd}`; };

export default function OnThisDay({ onOpenTrip }) {
  const [closed, setClosed] = useState(() => sessionStorage.getItem("otd-closed") === "1");
  // Collapsed to a single line by default on small screens so it doesn't cover
  // the map/content; tap the header to expand. Open by default on desktop.
  const [open, setOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth > 560 : true));

  const { entries, label } = useMemo(() => {
    const now = new Date();
    const md = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const thisYear = now.getFullYear();
    const byYear = new Map();
    for (const t of TRIPS) {
      if (t.year >= thisYear) continue;
      const key = `${t.year}-${md}`;
      if (key >= lo(t.start) && key <= hi(t.end)) {
        if (!byYear.has(t.year)) byYear.set(t.year, { trip: t.defaultName, tripId: t.id });
      }
    }
    for (const f of data.flights) {
      if (f.status !== "flown" || f.date.slice(5, 10) !== md) continue;
      const y = +f.date.slice(0, 4);
      if (y >= thisYear) continue;
      const e = byYear.get(y) || {};
      e.flight = `${f.from.iata}→${f.to.iata}`;
      byYear.set(y, e);
    }
    const entries = [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, v]) => ({
        year, ago: thisYear - year, tripId: v.tripId,
        text: v.trip ? (v.flight ? `${v.trip} · flew ${v.flight}` : v.trip) : `flew ${v.flight}`,
      }));
    return { entries, label: `${now.getDate()} ${MONTHS[now.getMonth()]}` };
  }, []);

  if (closed || !entries.length) return null;
  return (
    <div className={`otd ${open ? "" : "otd-collapsed"}`}>
      <button className="otd-x" onClick={() => { sessionStorage.setItem("otd-closed", "1"); setClosed(true); }} aria-label="Dismiss">✕</button>
      <button className="otd-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>On this day · {label}</span>
        <span className="otd-toggle">{open ? "▾" : `${entries.length} ▸`}</span>
      </button>
      {open && (
      <ul className="otd-list">
        {entries.slice(0, 6).map((e) => (
          <li key={e.year}>
            <b>{e.year}</b><span className="otd-ago">{e.ago}y ago</span>
            {e.tripId && onOpenTrip
              ? <button className="otd-text otd-link" onClick={() => onOpenTrip(e.tripId)}>{e.text}</button>
              : <span className="otd-text">{e.text}</span>}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
