import { useState, lazy, Suspense, Component } from "react";

// A view's code is loaded on demand. If that chunk fails to load — almost always
// a stale cached index.html pointing at an old build after a redeploy — reload
// once to fetch the fresh build (the network-first service worker then serves a
// correct index). A second failure shows a manual reload rather than looping.
class ViewBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) {
    const loadErr = /dynamically imported module|module script failed|Load failed|ChunkLoadError|Failed to fetch/i.test((err && err.message) || "");
    if (loadErr && !sessionStorage.getItem("vreload")) { sessionStorage.setItem("vreload", "1"); location.reload(); }
  }
  componentDidUpdate(prev) { if (prev.viewKey !== this.props.viewKey && this.state.failed) this.setState({ failed: false }); }
  render() {
    if (this.state.failed) return (
      <div className="view-loading">Couldn’t load this view.&nbsp;
        <button className="reload-btn" onClick={() => { sessionStorage.removeItem("vreload"); location.reload(); }}>Reload</button>
      </div>
    );
    return this.props.children;
  }
}
// Every view is code-split so the initial download is just the app shell — the
// map engine (deck.gl) and the globe (three.js) load on demand.
const MapView = lazy(() => import("./views/MapView.jsx"));
const TripsView = lazy(() => import("./views/TripsView.jsx"));
const WishlistView = lazy(() => import("./views/WishlistView.jsx"));
const StatsView = lazy(() => import("./views/StatsView.jsx"));
const AddView = lazy(() => import("./views/AddView.jsx"));
import CountryPanel from "./CountryPanel.jsx";
import OnThisDay from "./OnThisDay.jsx";
import EntityDetail from "./EntityDetail.jsx";
import { data, SHARE_MODE } from "./data.js";

const VIEWS = [
  { key: "map", label: "Map", icon: "🗺", C: MapView },
  { key: "trips", label: "Trips", icon: "🧳", C: TripsView },
  { key: "wishlist", label: "Wishlist", icon: "★", C: WishlistView },
  { key: "stats", label: "Stats", icon: "📊", C: StatsView },
  // capture/export tool — owner-only, hidden from shared/public view
  ...(SHARE_MODE ? [] : [{ key: "add", label: "Add", icon: "＋", C: AddView }]),
];

export default function App() {
  const [view, setView] = useState("map");
  const [selectedIso, setSelectedIso] = useState(null);
  const [focusTrip, setFocusTrip] = useState(null);
  const [entity, setEntity] = useState(null);
  const Active = VIEWS.find((v) => v.key === view).C;

  // Cross-navigation: jump to a trip from anywhere (country panel, on-this-day…).
  // Wrapped in an object so re-opening the same trip id still triggers the effect.
  const openTrip = (id) => { setSelectedIso(null); setFocusTrip({ id }); setView("trips"); };
  // Open an airport/airline/route/aircraft drill-down from anywhere.
  const openEntity = (kind, value) => setEntity({ kind, value });

  return (
    <div className="app">
      <header>
        <div className="title">
          <strong>Travel Map</strong>
          <span className="muted small">
            Born in England, 1998 · {data.stats.countries_sovereign} countries ({data.stats.countries_total} with territories) · {data.stats.flights_flown} flights{SHARE_MODE ? " · shared" : ""}
          </span>
        </div>
        <nav>
          {VIEWS.map((v) => (
            <button key={v.key} className={view === v.key ? "on" : ""} onClick={() => setView(v.key)} aria-label={v.label} title={v.label}>
              <span className="nav-ico">{v.icon}</span><span className="nav-label">{v.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <main>
        <ViewBoundary viewKey={view}>
          <Suspense fallback={<div className="view-loading">Loading…</div>}>
            <Active onSelect={setSelectedIso} onOpenTrip={openTrip} onOpenEntity={openEntity} focusTrip={view === "trips" ? focusTrip : null} theme="one" />
          </Suspense>
        </ViewBoundary>
      </main>
      {selectedIso && <CountryPanel iso={selectedIso} onClose={() => setSelectedIso(null)} onOpenTrip={openTrip} onOpenEntity={openEntity} />}
      <OnThisDay onOpenTrip={openTrip} />
      {entity && <EntityDetail key={entity.kind + entity.value} entity={entity} onClose={() => setEntity(null)} />}
    </div>
  );
}
