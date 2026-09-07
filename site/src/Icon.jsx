// Icon.jsx — inline stroke icons in currentColor. These replace the system emoji
// that used to label the tabs: full-colour emoji (blue suitcase, multicolour bar
// chart) fought the dark amber palette and rendered differently per platform.
// 24×24 grid, 1.7 stroke, round caps — one visual family across the whole app.
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };

const PATHS = {
  // primary tabs
  map: (
    <>
      <path d="M9.1 4.3L3.5 6.5v13.2l5.6-2.2 5.8 2.2 5.6-2.2V4.3l-5.6 2.2-5.8-2.2z" {...P} />
      <path d="M9.1 4.3v13.2M14.9 6.5v13.2" {...P} />
    </>
  ),
  trips: (
    <>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2.4" {...P} />
      <path d="M8.75 7.5V5.6A1.6 1.6 0 0 1 10.35 4h3.3a1.6 1.6 0 0 1 1.6 1.6v1.9" {...P} />
      <path d="M8.6 11v5.5M15.4 11v5.5" {...P} />
    </>
  ),
  wishlist: <path d="M12 3.6l2.7 5.6 6.1.85-4.45 4.3 1.08 6.05L12 17.5l-5.43 2.9 1.08-6.05L3.2 10.05l6.1-.85L12 3.6z" {...P} />,
  stats: (
    <>
      <path d="M3.5 20.2h17" {...P} />
      <path d="M6.8 20V13M12 20V6.5M17.2 20v-4.6" {...P} />
    </>
  ),
  add: <path d="M12 5.2v13.6M5.2 12h13.6" {...P} />,
  // map modes
  journey: (
    <>
      <circle cx="12" cy="12" r="8.6" {...P} />
      <path d="M12 7.3V12l3.4 2.1" {...P} />
    </>
  ),
  countries: (
    <>
      <circle cx="12" cy="12" r="8.6" {...P} />
      <path d="M3.5 9.4h17M3.5 14.6h17" {...P} />
      <path d="M12 3.4c-2.5 2.3-3.8 5.4-3.8 8.6s1.3 6.3 3.8 8.6c2.5-2.3 3.8-5.4 3.8-8.6S14.5 5.7 12 3.4z" {...P} />
    </>
  ),
  flights: <path d="M12 2.6c.85 0 1.5 1.05 1.5 2.35v3.4l6.9 4.1v2.05l-6.9-2.1v3.9l2.6 1.9v1.7L12 18.7l-4.1 1.2v-1.7l2.6-1.9v-3.9l-6.9 2.1v-2.05l6.9-4.1v-3.4C10.5 3.65 11.15 2.6 12 2.6z" {...P} />,
  globe: (
    <>
      <circle cx="12" cy="12" r="6.6" {...P} />
      <ellipse cx="12" cy="12" rx="10.3" ry="4" transform="rotate(-24 12 12)" {...P} />
    </>
  ),
};

export default function Icon({ name, size = 22 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {d}
    </svg>
  );
}
