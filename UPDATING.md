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
delete the old one. Precedence, highest first:

1. An export **uploaded from the app** (Add tab → ☁ Upload to cloud). It lands in the
   Blob store and is pulled into `data/flighty.csv` at build time, and it always wins.
2. Otherwise the newest `FlightyExport*.csv` in `data/`.
3. Otherwise `data/flighty.csv` as committed.

Because of rule 1, once you've uploaded from the phone the Blob copy stays the source
of truth for cloud builds. To go back to a file on the code machine, upload that file
from the app too (or clear `inputs/flighty.csv` from the Blob store).

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

### Publishing from your phone

This works now — the repo is on GitHub, Vercel runs the pipeline in the build, and the
Add tab can upload an export and trigger a rebuild.

1. Flighty → Export → CSV, then in the app: **Add** → *Choose CSV…* → **☁ Upload to cloud**.
2. **🚀 Publish**. Vercel rebuilds (~1 min), the pipeline pulls your upload from Blob.
3. Refresh the app and check the **Live data** line at the top of the Add tab — it shows
   the build time, flight count, latest flight date and which export it came from.
   If those numbers didn't move, the publish didn't take.

**If Publish returns an error about the deploy hook**, `DEPLOY_HOOK_URL` isn't set:
Vercel → Project → Settings → Git → Deploy Hooks → create one on `main`, copy the URL,
add it as an environment variable named `DEPLOY_HOOK_URL`, then redeploy once so the
function can see it.

**To debug a publish that appears to do nothing**, open the deployment's build log in
Vercel and look for the `[cloud]` lines — they say what was in the Blob store, what was
pulled, and which export the build actually used.

## Packing lists

Each trip can have a packing list, generated once and then attached to that trip
permanently — it's the record of what you actually took.

- **Make one:** Trips → open a trip → *Packing list*. Confirm the climate (guessed
  from the destination's latitude and the time of year) and the trip type, then
  Generate. Everything else — trip length, countries, whether you're driving — is
  already on the trip record.
- **Going out / Coming home:** the same list serves both legs. Ticking under
  *Going out* records what you packed; *Coming home* keeps a separate tick per
  item, seeded from what went out, so repacking never erases the outbound record.
  Add souvenirs and laundry on the return leg — they're tagged as added.
- **Bags and weight:** tag each item personal / cabin / hold and set a rough kg.
  Enter your airline's limits and each bag turns red when it's over.
- **Things I always forget:** Add tab → a single global list, seeded into every
  new packing list. Editing it never touches lists already attached to a trip.
- Lists sync through the same private Blob store as the photos, and fall back to
  on-device storage when there's no backend — so they work offline on the plane
  and sync up when you're back on wifi. Trips finished more than a month ago open
  read-only (with an *Edit anyway* button), and nothing ever deletes a list.
