// MapView.jsx — one "Map" tab with a mode switch over the four map visualisations
// (Journey / Countries / Flights / Globe). Each sub-view is code-split so the
// deck.gl / globe engines load only when their mode is opened.
import { lazy, Suspense, useState } from "react";

const TimelineView = lazy(() => import("./TimelineView.jsx"));
const ChoroplethView = lazy(() => import("./ChoroplethView.jsx"));
const FlightsView = lazy(() => import("./FlightsView.jsx"));
const GlobeView = lazy(() => import("./GlobeView.jsx"));

const MODES = [
  { key: "journey", label: "Journey", icon: "⏱", C: TimelineView },
  { key: "countries", label: "Countries", icon: "🗺", C: ChoroplethView },
  { key: "flights", label: "Flights", icon: "✈", C: FlightsView },
  { key: "globe", label: "Globe", icon: "🌐", C: GlobeView },
];

export default function MapView({ onSelect }) {
  const [mode, setMode] = useState("journey");
  const Active = MODES.find((m) => m.key === mode).C;
  return (
    <>
      <Suspense fallback={<div className="view-loading">Loading…</div>}>
        <Active onSelect={onSelect} theme="one" />
      </Suspense>
      <div className="map-modes">
        {MODES.map((m) => (
          <button key={m.key} className={mode === m.key ? "on" : ""} onClick={() => setMode(m.key)} title={m.label} aria-label={m.label}>
            <span className="nav-ico">{m.icon}</span><span className="nav-label">{m.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
