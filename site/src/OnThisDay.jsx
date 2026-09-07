// OnThisDay.jsx — an inline "what were you doing on today's date" block. It lives
// at the top of the Trips list (not as a floating overlay) because every entry
// links to a trip, so it belongs in the list it refers to. Renders nothing when
// today's calendar date has no history.
import { useMemo, useState } from "react";
import { data, TRIPS } from "./data.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
// precision-aware bounds: "2017-06" → covers all of June; "2017" → all year
const lo = (s) => { const [y, m, d] = s.split("-"); return `${y}-${m || "01"}-${d || "01"}`; };
const hi = (s) => { const [y, m, d] = s.split("-"); const mm = m || "12"; const dd = d || pad(new Date(+y, +mm, 0).getDate()); return `${y}-${mm}-${dd}`; };

const SHOWN = 3; // rows before the "show all" toggle

export default function OnThisDay({ onOpenTrip }) {
  const [all, setAll] = useState(false);

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

  if (!entries.length) return null;
  const rows = all ? entries : entries.slice(0, SHOWN);
  const more = entries.length - rows.length;
  return (
    <div className="otd">
      <div className="otd-head">On this day · {label}</div>
      <ul className="otd-list">
        {rows.map((e) => (
          <li key={e.year}>
            <b>{e.year}</b><span className="otd-ago">{e.ago}y ago</span>
            {e.tripId && onOpenTrip
              ? <button className="otd-text otd-link" onClick={() => onOpenTrip(e.tripId)}>{e.text}</button>
              : <span className="otd-text">{e.text}</span>}
          </li>
        ))}
      </ul>
      {(more > 0 || all) && (
        <button className="otd-more" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show ${more} more`}
        </button>
      )}
    </div>
  );
}
