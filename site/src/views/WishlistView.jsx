// WishlistView.jsx — places you want to go. Manual add + edit (localStorage),
// a world coverage map, and AI suggestions via the /api/recommend function.
import { useEffect, useMemo, useState } from "react";
import { data, loadWishlist, saveWishlist, newId } from "../data.js";
import WorldMap from "../WorldMap.jsx";

const PRIORITIES = ["someday", "soon", "next"];
const WORLD_TOTAL = 195; // UN members + observers, rough denominator

export default function WishlistView() {
  const [list, setList] = useState(loadWishlist);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [prefs, setPrefs] = useState("");
  const [pool, setPool] = useState([]);
  const [sugs, setSugs] = useState([]);
  const [asked, setAsked] = useState(false);

  const visitedNames = useMemo(() => data.countries.filter((c) => c.status === "visited").map((c) => c.name), []);
  const visitedCount = visitedNames.length;

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}suggestions.json`)
      .then((r) => r.json())
      .then((d) => setPool(d.suggestions || []))
      .catch(() => setPool([]));
  }, []);

  const commit = (l) => { setList(l); saveWishlist(l); };
  const add = (item) => commit([{ id: newId(), priority: "someday", source: "manual", ...item }, ...list]);
  const remove = (id) => commit(list.filter((x) => x.id !== id));
  const patch = (id, p) => commit(list.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const addManual = () => {
    if (!name.trim()) return;
    add({ name: name.trim(), country: country.trim() });
    setName(""); setCountry("");
  };

  const inList = (s) => list.some((i) => i.name.toLowerCase() === (s.name || "").toLowerCase());

  const suggest = () => {
    setAsked(true);
    const words = prefs.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
    const fresh = pool.filter((s) => !inList(s));
    let picks = fresh;
    if (words.length) {
      const scored = fresh
        .map((s) => ({ s, n: words.filter((w) => (s.tags || []).some((t) => t.includes(w)) || (s.reason + s.name + s.country).toLowerCase().includes(w)).length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n);
      if (scored.length) picks = scored.map((x) => x.s);
    }
    setSugs(picks.slice(0, 6));
  };
  const addSuggestion = (s) => {
    add({ name: s.name, country: s.country, lat: s.lat, lon: s.lon, note: s.reason, source: "ai" });
    setSugs(sugs.filter((x) => x !== s));
  };

  return (
    <div className="wish-view">
      <div className="wish-head">
        <h2>Wishlist</h2>
        <span className="muted small">{visitedCount} countries visited · {WORLD_TOTAL - visitedCount} of {WORLD_TOTAL} still to go</span>
      </div>

      <WorldMap pins={list} />

      <div className="wish-add">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a place… (e.g. Kyoto)" onKeyDown={(e) => e.key === "Enter" && addManual()} />
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className="wish-country" onKeyDown={(e) => e.key === "Enter" && addManual()} />
        <button onClick={addManual}>Add</button>
      </div>

      {list.length === 0 && <p className="wish-empty">Nothing on the list yet. Add a place above, or ask for ideas below.</p>}

      <div className="wish-list">
        {list.map((it) => (
          <div key={it.id} className={"wish-card" + (it.source === "ai" ? " ai" : "")}>
            <div className="wish-main">
              <div className="wish-name">{it.name}{it.country ? <span className="wish-c">{it.country}</span> : null}{it.source === "ai" ? <span className="wish-ai">AI</span> : null}</div>
              {it.note && <div className="wish-note">{it.note}</div>}
            </div>
            <select value={it.priority} onChange={(e) => patch(it.id, { priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button className="wish-x" onClick={() => remove(it.id)} aria-label="Remove">✕</button>
          </div>
        ))}
      </div>

      <div className="wish-ai-panel">
        <h3>Ideas for where next</h3>
        <textarea rows={3} value={prefs} onChange={(e) => setPrefs(e.target.value)} placeholder="Optional: what are you in the mood for? (warm, islands, food, mountains…)" />
        <button className="wish-suggest" onClick={suggest}>✨ Suggest destinations</button>
        <p className="wish-credit">Hand-picked from your travel history. Want a fresh set? Just ask in a Claude session.</p>
        {asked && sugs.length === 0 && <p className="wish-err">Nothing left to suggest. You've added them all, or try a different mood.</p>}
        {sugs.length > 0 && (
          <div className="wish-sugs">
            {sugs.map((s, i) => (
              <div key={i} className="sug-card">
                <div className="wish-main">
                  <div className="wish-name">{s.name}{s.country ? <span className="wish-c">{s.country}</span> : null}</div>
                  {s.reason && <div className="wish-note">{s.reason}</div>}
                </div>
                <button className="sug-add" onClick={() => addSuggestion(s)} disabled={inList(s)}>{inList(s) ? "Added" : "+ Add"}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
