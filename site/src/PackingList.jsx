// PackingList.jsx — a trip's packing list, generated once and then kept forever.
//
// The same list serves both legs of the trip. `packed` is what went out; on the
// way home the "Coming home" tab writes a separate `returned` field, seeded from
// what was packed. Two fields, one items array — so repacking never overwrites
// the record of what was actually taken.
//
// You never type a weight or pick a bag: say which bags the airline allows and
// the allocation falls out of that, including what doesn't fit.
import { useEffect, useMemo, useState } from "react";
import {
  CLIMATES, TRIP_TYPES, BAG_TYPES, BAG_ORDER, WORN,
  generatePackingList, customItem, byCategory, allocate, ensureMeasures, wearToFit, withQty,
  guessClimate, tripLat, tripDays,
} from "./packing.js";
import { getPackingList, savePackingList, getEssentials, localCopy, getHistory, restoreVersion } from "./packingStore.js";

const kg = (n) => `${(Math.round(n * 10) / 10).toFixed(1)}kg`;
const litres = (n) => `${Math.round(n)}L`;
const listJoin = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
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
  const [offline, setOffline] = useState(false);
  const [recover, setRecover] = useState({ local: null, versions: [] });

  const days = tripDays(trip);
  // Repacking only matters while you're away or just back; older trips open on
  // the outbound record, which is what they're kept for.
  const ended = Date.parse(trip.end || trip.start);
  const started = Date.parse(trip.start);
  const now = Date.now();
  const repackWindow = now >= started && now <= ended + 14 * DAY;
  const archived = now > ended + 30 * DAY;
  const editable = !archived || unlocked;

  const load = async (isLive = () => true) => {
    const [got, e] = await Promise.all([getPackingList(trip), getEssentials()]);
    if (!isLive()) return;
    const ready = got.list ? ensureMeasures(got.list) : null;
    setOffline(got.offline);
    setList(ready);
    setEssentials(e);
    setLoaded(true);
    if (ready) { setClimate(ready.climate); setTripType(ready.tripType); onHasList?.(trip.id, true); }
    else setClimate(guessClimate(tripLat(trip), started ? new Date(started).getMonth() : NaN));

    // Always look for recoverable copies — the on-device one, and any version the
    // server kept when a list was replaced. Reads never touch the local copy, so
    // a device that curated a list still holds it even after something else
    // overwrote the server's. That difference is worth offering back.
    const localOne = localCopy(trip);
    const local = localOne && (!ready || localOne.generatedAt !== ready.generatedAt) ? localOne : null;
    const versions = await getHistory(trip);
    if (isLive()) setRecover({ local, versions });
    // Only open on the return leg once there's actually an outbound pack to
    // come home with — a list generated mid-trip should still start outbound.
    if (repackWindow && ready && ready.items.some((i) => i.packed)) setMode("return");
  };
  const reload = async () => { setBusy(true); try { await load(); } finally { setBusy(false); } };

  useEffect(() => {
    let live = true;
    load(() => live);
    return () => { live = false; };
  }, [trip.id]);

  const persist = async (next) => {
    setList(next);
    setBusy(true);
    try { await savePackingList(trip, next); } finally { setBusy(false); }
  };
  // Any change to the bags or the item set re-runs the allocation.
  const reallocate = (next) => persist({ ...next, items: allocate(next).items });

  const generate = async () => {
    // Generating replaces everything. Confirm whenever there's something to lose —
    // including when no list is on screen but one is recoverable, which is exactly
    // the case that destroyed a curated list before.
    const recoverable = recover.local || recover.versions.length;
    const warn = list
      ? "Regenerate this list? Everything you've ticked off, and anything you added yourself, will be lost."
      : recoverable
        ? "This trip already has a packing list saved. Generating a new one replaces it — restore the old one instead?\n\nOK to generate a fresh list anyway."
        : null;
    if (warn && !confirm(warn)) return;
    const next = generatePackingList(trip, { climate, tripType, essentials, bags: list?.bags });
    await persist(next);
    onHasList?.(trip.id, true);
  };

  const restoreLocal = async () => {
    setBusy(true);
    try {
      await savePackingList(trip, recover.local);
      setList(ensureMeasures(recover.local));
      setRecover((r) => ({ ...r, local: null }));   // it's the live list now
      onHasList?.(trip.id, true);
    } finally { setBusy(false); }
  };
  const restoreServer = async (id) => {
    setBusy(true);
    try {
      const l = await restoreVersion(trip, id);
      if (l) { setList(ensureMeasures(l)); setRecover({ local: null, versions: [] }); onHasList?.(trip.id, true); }
    } finally { setBusy(false); }
  };

  const patchItem = (id, p) => persist({ ...list, items: list.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  const removeItem = (id) => reallocate({ ...list, items: list.items.filter((i) => i.id !== id) });
  const setQty = (it, n) => reallocate({ ...list, items: list.items.map((i) => (i.id === it.id ? withQty(i, n) : i)) });
  const setBagCount = (type, n) => reallocate({ ...list, bags: { ...list.bags, [type]: Math.max(0, Math.min(9, n)) } });
  const toggleWorn = (it) => reallocate({
    ...list,
    items: list.items.map((i) => (i.id === it.id ? { ...i, bag: i.bag === WORN ? null : WORN, pinned: i.bag !== WORN } : i)),
  });
  const addItem = () => {
    const label = adding.trim();
    if (!label) return;
    setAdding("");
    // Something added on the return leg is by definition coming home with you.
    reallocate({ ...list, items: [...list.items, { ...customItem(label), [field]: true }] });
  };

  // Starting the return leg: everything that went out is presumed still with you.
  const seedReturn = () => persist({ ...list, items: list.items.map((i) => ({ ...i, returned: i.packed })) });

  const field = mode === "return" ? "returned" : "packed";
  const plan = useMemo(() => (list ? allocate(list) : null), [list]);
  const groups = useMemo(() => (list ? byCategory(list.items) : []), [list]);
  // Only worth computing when something actually failed to fit.
  const wearFix = useMemo(() => (plan && plan.overflow.length ? wearToFit(list) : null), [plan]);
  const bagLabel = useMemo(() => {
    const m = new Map(plan?.bins.map((b) => [b.id, b.label]) || []);
    m.set(WORN, "Worn");
    return m;
  }, [plan]);
  const noHold = !(Number(list?.bags?.hold) > 0);
  const done = list ? list.items.filter((i) => i[field]).length : 0;
  const returnUntouched = list && mode === "return" && list.items.every((i) => !i.returned) && list.items.some((i) => i.packed);

  if (!loaded) return <div className="pk-wrap"><div className="pk-loading">Loading packing list…</div></div>;

  // ---- couldn't reach the synced store: say so, never offer to regenerate ---
  // A null list here means "unknown", not "none". Showing the generator would
  // invite the user to rebuild a list that already exists on the server.
  if (offline && !list) {
    return (
      <div className="pk-wrap">
        <div className="pk-head"><h4>Packing list</h4></div>
        <div className="pk-unreachable">
          Couldn't reach your synced packing lists just now — this is a connection
          problem, not a lost list. Nothing has been deleted.
          <button onClick={reload} disabled={busy}>{busy ? "Trying…" : "Try again"}</button>
        </div>
      </div>
    );
  }
  // ---- generator (no list yet) --------------------------------------------
  // A list that already exists is offered back first. Silently showing only the
  // Generate button here is what let a curated list get replaced by a default one.
  const recovery = (recover.local || recover.versions.length) ? (
    <div className="pk-recover">
      <b>{list ? "A different copy of this list exists." : "This trip already had a packing list."}</b>
      <ul>
        {recover.local && (
          <li>
            Saved on this device — {recover.local.items.length} items,
            {" "}{recover.local.items.filter((i) => i.packed).length} packed
            <button onClick={restoreLocal} disabled={busy}>Restore</button>
          </li>
        )}
        {recover.versions.map((v) => (
          <li key={v.id}>
            Replaced {v.savedAt ? new Date(v.savedAt).toLocaleString() : "earlier"} — {v.items} items, {v.packed} packed
            <button onClick={() => restoreServer(v.id)} disabled={busy}>Restore</button>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  if (!list) {
    return (
      <div className="pk-wrap">
        <div className="pk-head"><h4>Packing list</h4></div>
        {recovery}
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

      {recovery}

      {offline && (
        <div className="pk-unreachable">
          Offline — showing the copy saved on this device. Changes sync when you're back.
          <button onClick={reload} disabled={busy}>{busy ? "Trying…" : "Retry"}</button>
        </div>
      )}
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

      {/* ---- what the airline lets you take ---- */}
      <div className="pk-allow">
        <div className="pk-allow-head">What you're allowed</div>
        <div className="pk-allow-row">
          {BAG_ORDER.map((type) => (
            <div key={type} className="pk-allow-bag">
              <button disabled={!editable} onClick={() => setBagCount(type, (list.bags[type] || 0) - 1)} aria-label={`One fewer ${BAG_TYPES[type].label}`}>−</button>
              <div className="pk-allow-n">
                <b>{list.bags[type] || 0}</b>
                <span>{BAG_TYPES[type].label}</span>
                <em>{BAG_TYPES[type].note}</em>
              </div>
              <button disabled={!editable} onClick={() => setBagCount(type, (list.bags[type] || 0) + 1)} aria-label={`One more ${BAG_TYPES[type].label}`}>+</button>
            </div>
          ))}
        </div>
      </div>

      {/* ---- how it packs ---- */}
      {plan.bins.length > 0 ? (
        <div className="pk-bins">
          {plan.bins.map((b) => {
            const pctV = Math.min(100, (b.usedL / b.volumeL) * 100);
            const pctW = Math.min(100, (b.usedKg / b.maxKg) * 100);
            const tight = pctV > 90 || pctW > 90;
            return (
              <div key={b.id} className={"pk-bin" + (tight ? " tight" : "")}>
                <div className="pk-bin-head"><b>{b.label}</b><span>{b.items.length} item{b.items.length === 1 ? "" : "s"}</span></div>
                <div className="pk-meter"><i style={{ width: `${pctV}%` }} /></div>
                <div className="pk-bin-nums">{litres(b.usedL)} / {litres(b.volumeL)} space · {kg(b.usedKg)} / {kg(b.maxKg)}</div>
                <div className="pk-meter thin"><i style={{ width: `${pctW}%` }} /></div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="pk-nobags">No bags selected — add at least one above to see what fits.</div>
      )}

      {noHold && plan.bins.length > 0 && (
        <div className="pk-liquids">
          No hold bag — liquids have to be 100ml or less in one clear resealable bag.
          Toiletries below are sized as travel bottles.
        </div>
      )}
      {plan.overflow.length > 0 && (
        <div className="pk-overflow">
          <b>{plan.overflow.length} item{plan.overflow.length === 1 ? " doesn't" : "s don't"} fit.</b>{" "}
          {wearFix?.clears ? (
            <>
              Wearing the {listJoin(wearFix.wear.map((i) => i.label.toLowerCase()))} through the airport
              {" "}frees {litres(wearFix.wear.reduce((n, i) => n + i.volumeL, 0))} and everything fits.
              {editable && (
                <button className="pk-wearfix" onClick={() => reallocate(wearFix.list)}>
                  Wear {wearFix.wear.length === 1 ? "it" : "them"}
                </button>
              )}
            </>
          ) : wearFix?.wear.length
            ? "Even wearing the bulky things through the airport wouldn't be enough — you need another bag, or fewer clothes."
            : "Leave something behind, or take a bigger bag."}
          <ul>
            {plan.overflow.map((i) => (
              <li key={i.id}>
                {i.label} <span className="pk-size">{litres(i.volumeL)} · {kg(i.weightKg)}</span>
                {i.wearable && editable && <button onClick={() => toggleWorn(i)}>Wear it</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.category} className="pk-group">
          <div className="pk-cat">{g.category}</div>
          {g.items.map((it) => {
            const where = bagLabel.get(it.bag);
            return (
              <div key={it.id} className={"pk-item" + (it[field] ? " done" : "") + (where ? "" : " unplaced")}>
                <label className="pk-check">
                  <input type="checkbox" checked={!!it[field]} disabled={!editable}
                    onChange={(e) => patchItem(it.id, { [field]: e.target.checked })} />
                  <span>{it.label}</span>
                </label>
                {it.qty != null && (
                  <span className="pk-qty">
                    <button disabled={!editable || it.qty <= 0} onClick={() => setQty(it, it.qty - 1)} aria-label={`One fewer ${it.label}`}>−</button>
                    <b>{it.qty}</b>
                    <button disabled={!editable} onClick={() => setQty(it, it.qty + 1)} aria-label={`One more ${it.label}`}>+</button>
                  </span>
                )}
                {it.source === "essentials" && <span className="pk-tag" title="From your always-forget list">always</span>}
                {it.source === "custom" && <span className="pk-tag custom" title="Added by you">added</span>}
                <span className={"pk-where" + (it.bag === WORN ? " worn" : "") + (where ? "" : " none")}
                  title={where ? `Allocated to ${where}` : "Doesn't fit in the bags you've got"}>
                  {where || "won't fit"}
                </span>
                {it.wearable && editable && (
                  <button className={"pk-wear" + (it.bag === WORN ? " on" : "")} onClick={() => toggleWorn(it)}
                    title={it.bag === WORN ? "Put it back in a bag" : "Wear it through the airport"}>👕</button>
                )}
                {editable && <button className="pk-del" title="Remove" onClick={() => removeItem(it.id)}>×</button>}
              </div>
            );
          })}
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
          {/* Climate or trip type wrong? Change them here and rebuild the list. */}
          <select value={climate} onChange={(e) => setClimate(e.target.value)} aria-label="Climate">
            {CLIMATES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={tripType} onChange={(e) => setTripType(e.target.value)} aria-label="Trip type">
            {TRIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="pk-regen" onClick={generate} disabled={busy}>Regenerate</button>
          <span className="pk-saved">{busy ? "Saving…" : "Saved"}</span>
        </div>
      )}
    </div>
  );
}
