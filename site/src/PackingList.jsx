// PackingList.jsx — a trip's packing list, generated once and then kept forever.
//
// The same list serves both legs of the trip. `packed` is what went out; on the
// way home the "Coming home" tab writes a separate `returned` field, seeded from
// what was packed. Two fields, one items array — so repacking never overwrites
// the record of what was actually taken.
import { useEffect, useMemo, useState } from "react";
import { CLIMATES, TRIP_TYPES, BAGS, generatePackingList, customItem, byCategory, bagTotals, guessClimate, tripLat, tripDays } from "./packing.js";
import { getPackingList, savePackingList, getEssentials } from "./packingStore.js";

const BAG_LABEL = { personal: "Personal", cabin: "Cabin", hold: "Hold" };
const kg = (n) => `${(Math.round(n * 10) / 10).toFixed(1)}kg`;
const DAY = 86400000;

export default function PackingList({ trip, onHasList }) {
  const [list, setList] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState("outbound");
  const [unlocked, setUnlocked] = useState(false);
  const [essentials, setEssentials] = useState([]);
  const [climate, setClimate] = useState("mild");
  const [tripType, setTripType] = useState("leisure");
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  const days = tripDays(trip);
  // Repacking only matters while you're away or just back; older trips open on
  // the outbound record, which is what they're kept for.
  const ended = Date.parse(trip.end || trip.start);
  const started = Date.parse(trip.start);
  const now = Date.now();
  const repackWindow = now >= started && now <= ended + 14 * DAY;
  const archived = now > ended + 30 * DAY;
  const editable = !archived || unlocked;

  useEffect(() => {
    let live = true;
    (async () => {
      const [l, e] = await Promise.all([getPackingList(trip), getEssentials()]);
      if (!live) return;
      setList(l);
      setEssentials(e);
      setLoaded(true);
      if (l) { setClimate(l.climate); setTripType(l.tripType); onHasList?.(trip.id, true); }
      else setClimate(guessClimate(tripLat(trip), started ? new Date(started).getMonth() : NaN));
      // Only open on the return leg once there's actually an outbound pack to
      // come home with — a list generated mid-trip should still start outbound.
      if (repackWindow && l && l.items.some((i) => i.packed)) setMode("return");
    })();
    return () => { live = false; };
  }, [trip.id]);

  const persist = async (next) => {
    setList(next);
    setBusy(true);
    try { await savePackingList(trip, next); } finally { setBusy(false); }
  };

  const generate = async () => {
    if (list && !confirm("Regenerate this list? Everything you've ticked off, and anything you added yourself, will be lost.")) return;
    const next = generatePackingList(trip, { climate, tripType, essentials, baggageLimits: list?.baggageLimits });
    await persist(next);
    onHasList?.(trip.id, true);
  };

  const patchItem = (id, p) => persist({ ...list, items: list.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  const removeItem = (id) => persist({ ...list, items: list.items.filter((i) => i.id !== id) });
  const addItem = () => {
    const label = adding.trim();
    if (!label) return;
    setAdding("");
    // Something added on the return leg is by definition coming home with you.
    persist({ ...list, items: [...list.items, { ...customItem(label), [field]: true }] });
  };
  const setLimit = (bag, v) => persist({ ...list, baggageLimits: { ...list.baggageLimits, [bag]: v === "" ? null : Number(v) } });

  // Starting the return leg: everything that went out is presumed still with you.
  const seedReturn = () => persist({ ...list, items: list.items.map((i) => ({ ...i, returned: i.packed })) });

  const field = mode === "return" ? "returned" : "packed";
  const groups = useMemo(() => (list ? byCategory(list.items) : []), [list]);
  const totals = useMemo(() => (list ? bagTotals(list.items, mode) : null), [list, mode]);
  const done = list ? list.items.filter((i) => i[field]).length : 0;
  const returnUntouched = list && mode === "return" && list.items.every((i) => !i.returned) && list.items.some((i) => i.packed);

  if (!loaded) return <div className="pk-wrap"><div className="pk-loading">Loading packing list…</div></div>;

  // ---- generator (no list yet) --------------------------------------------
  if (!list) {
    return (
      <div className="pk-wrap">
        <div className="pk-head"><h4>Packing list</h4></div>
        <p className="pk-intro">
          {days} day{days > 1 ? "s" : ""} · {trip.countries.map((c) => c.name || c).join(", ") || "no countries"} — confirm the two things the trip record can't tell us, and it'll build a list that stays attached to this trip.
        </p>
        <div className="pk-gen">
          <label><span>Climate</span>
            <select value={climate} onChange={(e) => setClimate(e.target.value)}>
              {CLIMATES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label><span>Trip type</span>
            <select value={tripType} onChange={(e) => setTripType(e.target.value)}>
              {TRIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <button className="pk-generate" onClick={generate} disabled={busy}>Generate packing list</button>
        </div>
        <div className="pk-hint">Climate is a guess from the destination's latitude and the time of year — change it if it's wrong.</div>
      </div>
    );
  }

  // ---- the list ------------------------------------------------------------
  return (
    <div className="pk-wrap">
      <div className="pk-head">
        <h4>Packing list</h4>
        <div className="pk-modes">
          <button className={mode === "outbound" ? "on" : ""} onClick={() => setMode("outbound")}>Going out</button>
          <button className={mode === "return" ? "on" : ""} onClick={() => setMode("return")}>Coming home</button>
        </div>
      </div>

      <div className="pk-status">
        <b>{done}</b> / {list.items.length} {mode === "return" ? "packed to come home" : "packed"}
        <span className="pk-gen-at"> · list made {new Date(list.generatedAt).toLocaleDateString()} · {list.climate} · {list.tripType}</span>
      </div>

      {archived && !unlocked && (
        <div className="pk-archived">
          This trip is over — showing what you took, read-only.
          <button onClick={() => setUnlocked(true)}>Edit anyway</button>
        </div>
      )}

      {returnUntouched && editable && (
        <div className="pk-seed">
          Coming home? Start from everything you packed, then untick whatever you're leaving behind.
          <button onClick={seedReturn} disabled={busy}>Tick everything I took</button>
        </div>
      )}

      {totals && (
        <div className="pk-bags">
          {BAGS.map((b) => {
            const limit = list.baggageLimits?.[`${b}Kg`];
            const over = Number.isFinite(limit) && totals[b] > limit;
            return (
              <div key={b} className={"pk-bag" + (over ? " over" : "")}>
                <span className="pk-bag-name">{BAG_LABEL[b]}</span>
                <b>{kg(totals[b])}</b>
                <input type="number" min="0" step="0.5" placeholder="limit" disabled={!editable}
                  value={limit ?? ""} onChange={(e) => setLimit(`${b}Kg`, e.target.value)} />
                {over && <span className="pk-over">over by {kg(totals[b] - limit)}</span>}
              </div>
            );
          })}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.category} className="pk-group">
          <div className="pk-cat">{g.category}</div>
          {g.items.map((it) => (
            <div key={it.id} className={"pk-item" + (it[field] ? " done" : "")}>
              <label className="pk-check">
                <input type="checkbox" checked={!!it[field]} disabled={!editable}
                  onChange={(e) => patchItem(it.id, { [field]: e.target.checked })} />
                <span>{it.label}</span>
              </label>
              {it.source === "essentials" && <span className="pk-tag" title="From your always-forget list">always</span>}
              {it.source === "custom" && <span className="pk-tag custom" title="Added by you">added</span>}
              <select className="pk-bagsel" value={it.bag || ""} disabled={!editable}
                onChange={(e) => patchItem(it.id, { bag: e.target.value || null })}>
                <option value="">—</option>
                {BAGS.map((b) => <option key={b} value={b}>{BAG_LABEL[b]}</option>)}
              </select>
              <input className="pk-wt" type="number" min="0" step="0.05" placeholder="kg" disabled={!editable}
                value={it.weightKg ?? ""} onChange={(e) => patchItem(it.id, { weightKg: e.target.value === "" ? null : Number(e.target.value) })} />
              {editable && <button className="pk-del" title="Remove" onClick={() => removeItem(it.id)}>×</button>}
            </div>
          ))}
        </div>
      ))}

      {editable && (
        <div className="pk-add">
          <input value={adding} placeholder={mode === "return" ? "Picked up on the trip (souvenir, laundry…)" : "Add an item"}
            onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} />
          <button onClick={addItem} disabled={!adding.trim()}>Add</button>
        </div>
      )}

      {editable && (
        <div className="pk-foot">
          <button className="pk-regen" onClick={generate} disabled={busy}>Regenerate from scratch</button>
          <span className="pk-saved">{busy ? "Saving…" : "Saved"}</span>
        </div>
      )}
    </div>
  );
}
