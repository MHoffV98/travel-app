# Travel Map

Interactive map of ~27 years of personal travel — an animated journey timeline,
a country choropleth, a flight-arc map, and a stats dashboard. Built from
reconciled flight logs + manual trip records into one static site.

## Run it

You need [Node.js](https://nodejs.org) (v18+). From this `travel-map/` folder:

```bash
npm run setup     # one time: installs the site's dependencies
npm run dev       # rebuilds the data, then starts the site at http://localhost:5173
```

Open the URL it prints (usually <http://localhost:5173>). That's it.

### Other commands

| Command | What it does |
|---|---|
| `npm run data` | Rebuild `site/src/travel_data.json` + `discrepancy_report.md` from `data/` |
| `npm run dev` | Rebuild data **and** launch the live site (auto-reloads on edits) |
| `npm run build` | Rebuild data and produce a deployable static site in `site/dist/` |
| `npm run preview` | Serve the built `site/dist/` locally to check the production build |

### Updating with fresh exports

1. Drop new `FlightyExport-*.csv` and `flightdiary_*.csv` files into `data/`
   (newest of each is picked automatically — no need to delete the old ones).
2. `npm run data` (or `npm run dev`). The pipeline re-merges everything,
   re-applies the documented corrections, and re-validates against
   `country_reconciliation.csv`.

## Layout

```
travel-map/
  data/            raw exports + manual_trips.csv + country_reconciliation.csv
  pipeline/        build_data.js (merge/geo/stats) + overrides.js (config & corrections)
  site/            Vite + React + MapLibre/deck.gl app (reads src/travel_data.json)
  discrepancy_report.md   generated: single-source flights, fuzzy matches, checks
```

## Use it on your iPhone (PWA)

The site is a installable PWA. Two ways to get it on your phone:

**Quick (same Wi-Fi, no deploy):**
1. `npm run dev` — Vite prints a `Network:` URL like `http://192.168.x.x:5173`.
   (If it only shows `localhost`, run `npm --prefix site run dev -- --host`.)
2. On your iPhone (same Wi-Fi), open that URL in **Safari**. It'll work, but
   iOS only allows full "Add to Home Screen" / offline over **HTTPS** — so for
   the real installable app, deploy it (below).

**Proper (installable, offline, HTTPS):**
1. `npm run build` → produces `site/dist/`.
2. Deploy that folder to any static host over HTTPS — easiest is
   [Vercel](https://vercel.com) or [Netlify](https://netlify.com): drag the
   `site/dist` folder onto their dashboard, or connect the repo. (GitHub Pages
   works too.)
3. Open the deployed URL in **Safari** on your iPhone → **Share** → **Add to
   Home Screen**. It launches full-screen with the app icon, and the app shell
   + data are cached for offline (maps/flags still need a connection).

## Deploying (later)

`npm run build` produces `site/dist/` — a plain static folder. Drag it to
Netlify/Vercel, or push it to a `gh-pages` branch for GitHub Pages. No backend.

To share publicly with rounded dates and home/next-trip info hidden, build with
share mode on: `VITE_SHARE_MODE=true npm run build`.
