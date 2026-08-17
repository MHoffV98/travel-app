// GlobeView.jsx — a 3D globe (globe.gl/Three.js) with flight arcs wrapping the
// planet, visited countries lit, draggable + auto-rotating.
import { useEffect, useRef, useState } from "react";
import Globe from "globe.gl";
import { data, byIso, countryForFeature, cleanGeo, themeAccents } from "../data.js";

const hasGeo = (f) => Number.isFinite(f.from?.lat) && Number.isFinite(f.to?.lat);
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export default function GlobeView({ onSelect, theme }) {
  const ref = useRef(null);
  const globeRef = useRef(null);
  const [spin, setSpin] = useState(true);

  useEffect(() => {
    const el = ref.current;
    const world = Globe()(el)
      .backgroundColor("rgba(0,0,0,0)")
      .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-dark.jpg")
      .showAtmosphere(true)
      .atmosphereColor(rgba(themeAccents().a1, 1))
      .atmosphereAltitude(0.16)
      .width(el.clientWidth)
      .height(el.clientHeight);
    globeRef.current = world;

    // flight arcs
    const arcs = data.flights.filter((f) => f.status === "flown" && hasGeo(f)).map((f) => ({
      sLat: f.from.lat, sLng: f.from.lon, eLat: f.to.lat, eLng: f.to.lon,
    }));
    world
      .arcsData(arcs)
      .arcStartLat((d) => d.sLat).arcStartLng((d) => d.sLng)
      .arcEndLat((d) => d.eLat).arcEndLng((d) => d.eLng)
      .arcColor(() => [rgba(themeAccents().a1, 0.55), rgba(themeAccents().a2, 0.85)])
      .arcStroke(0.35).arcAltitudeAutoScale(0.4)
      .arcDashLength(0.5).arcDashGap(0.25).arcDashAnimateTime(2200);

    // airport points
    const ap = {};
    for (const f of arcs) { ap[`${f.sLat},${f.sLng}`] = [f.sLng, f.sLat]; ap[`${f.eLat},${f.eLng}`] = [f.eLng, f.eLat]; }
    world
      .pointsData(Object.values(ap))
      .pointLat((d) => d[1]).pointLng((d) => d[0])
      .pointColor(() => rgba(themeAccents().a1, 0.92)).pointAltitude(0.005).pointRadius(0.18);

    // countries lit on the sphere
    fetch(`${import.meta.env.BASE_URL}countries.geojson`).then((r) => r.json()).then((g) => {
      const feats = cleanGeo(g).features;
      world
        .polygonsData(feats)
        .polygonCapColor((f) => {
          const c = countryForFeature(f.properties);
          if (c?.status === "visited") return rgba(themeAccents().a1, 0.55);
          if (c?.status === "transit") return "rgba(120,100,170,0.4)";
          return "rgba(40,42,60,0.25)";
        })
        .polygonSideColor(() => "rgba(255,160,70,0.08)")
        .polygonStrokeColor(() => "rgba(255,255,255,0.12)")
        .polygonAltitude((f) => (countryForFeature(f.properties)?.status === "visited" ? 0.012 : 0.006))
        .polygonLabel((f) => { const c = countryForFeature(f.properties); return c ? `<b>${c.name}</b>` : ""; })
        .onPolygonClick((f) => { const c = countryForFeature(f.properties); if (c) onSelect?.(c.iso3); });
    });

    const controls = world.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;
    controls.enableZoom = true;
    world.pointOfView({ lat: 25, lng: 5, altitude: 2.2 });

    const onResize = () => world.width(el.clientWidth).height(el.clientHeight);
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => { ro.disconnect(); world._destructor?.(); el.innerHTML = ""; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-tint arcs / countries / atmosphere when the theme changes
  useEffect(() => {
    const w = globeRef.current;
    if (!w) return;
    w.atmosphereColor(rgba(themeAccents().a1, 1))
      .arcColor(() => [rgba(themeAccents().a1, 0.55), rgba(themeAccents().a2, 0.85)])
      .pointColor(() => rgba(themeAccents().a1, 0.92))
      .polygonCapColor((f) => {
        const c = countryForFeature(f.properties);
        if (c?.status === "visited") return rgba(themeAccents().a1, 0.55);
        if (c?.status === "transit") return "rgba(120,100,170,0.4)";
        return "rgba(40,42,60,0.25)";
      });
  }, [theme]);

  const toggleSpin = () => {
    const c = globeRef.current?.controls();
    if (c) { c.autoRotate = !c.autoRotate; setSpin(c.autoRotate); }
  };

  return (
    <div className="view globe-view">
      <div ref={ref} className="globe-canvas" />
      <div className="panel top-left">
        <div className="muted small">{data.stats.countries_sovereign} countries · {data.stats.flights_flown} flights</div>
        <button className="globe-btn" onClick={toggleSpin}>{spin ? "❚❚ pause" : "▶ spin"}</button>
        <div className="muted small" style={{ marginTop: 6 }}>drag to rotate · scroll to zoom · tap a country</div>
      </div>
    </div>
  );
}
