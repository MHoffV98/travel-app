// MapBase.jsx — a standalone deck.gl canvas. deck draws the country shapes and
// flight arcs directly (no MapLibre basemap), which avoids the MapLibre overlay
// sizing bug + the external basemap CDN dependency, and drops ~1.4MB of code.
import { useEffect, useRef } from "react";
import { Deck } from "@deck.gl/core";

export default function MapBase({ layers = [], getTooltip, initialViewState }) {
  const canvasRef = useRef(null);
  const deckRef = useRef(null);

  // create once
  useEffect(() => {
    const deck = new Deck({
      canvas: canvasRef.current,
      controller: { dragRotate: false },
      initialViewState: {
        longitude: initialViewState?.longitude ?? 10,
        latitude: initialViewState?.latitude ?? 25,
        zoom: initialViewState?.zoom ?? 1.4,
      },
      layers,
      getTooltip,
    });
    deckRef.current = deck;
    return () => deck.finalize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // update layers + tooltip
  useEffect(() => { deckRef.current?.setProps({ layers, getTooltip }); }, [layers, getTooltip]);

  return <canvas ref={canvasRef} className="map" />;
}
