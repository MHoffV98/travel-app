# Updating the travel map

Everything is built from the CSVs in **`data/`** and published as a static site.
There is no database — a publish re-reads the files, rebuilds, and deploys.

## Add new flights (Flighty / FR24)

Both apps export your **entire** history each time, so you just drop in the latest export:

1. **Flighty** → Settings → Export → CSV. Save the file into `data/`
   (any name starting with `FlightyExport` works, or overwrite `data/flighty.csv`).
2. **FR24** (optional second source) → export CSV into `data/`
   (name starting with `flightdiary`, or overwrite `data/fr24.csv`).

The pipeline automatically picks the **newest** matching file, so you don't have to
delete the old one.

## Add overland / cruise / pre-2016 trips (things flights don't capture)

Edit **`data/manual_trips.csv`**. Columns:

```
country,start_date,end_date,date_precision,transport,type,notes,place,lat,lon,nights,trip
```

- `date_precision`: `day`, `day_approx`, `month`, `month_approx` (use the coarsest that's honest).
- `type`: `visit` (counts) or `transit` (airport only, doesn't count).
- `nights`: fill it in — a blank on the **last** leg of a single-country trip is auto-topped-up
  to the full arrival→departure span, but for multi-country overland trips each leg needs its own count.
- `trip`: an optional shared id to group legs into one trip card (e.g. `centam-2022`).

## Publish

Two ways, both on the machine that has this repo:

- **Double-click `Deploy.bat`** (Windows) — no terminal needed. It runs the publish
  and shows the result in a window. (You can right-click → *Send to → Desktop* to make
  a desktop shortcut / "button".)
- Or, from the repo root: `npm run deploy`

Both regenerate `site/src/travel_data.json`, build, and deploy to production.
Check `discrepancy_report.md` after a build if a country count looks off — it lists
anything the pipeline couldn't reconcile.

### Can I deploy from my phone / a button in the web app?

Not directly. The published site is static with no backend, so a browser can't run a
build or the Vercel CLI. Publishing always happens on the machine with the code (via
`Deploy.bat` or `npm run deploy`). Deploying from anywhere would need the data committed
to Git plus a Vercel deploy hook and the pipeline moved into Vercel's build step — a
larger change. For now: capture trips on any device (the **Add** screen exports the
rows), then publish from the code machine.
