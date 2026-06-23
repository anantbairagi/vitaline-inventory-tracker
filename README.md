# Vitaline Order Dashboard — Developer Handoff

Hi Anant — this is the Vitaline purchasing dashboard. It visualizes per-office
reorder needs from a PAR (par/inventory) workbook: order $ by office, status
tiers, an item-level drill-down, search, and vendor filters. This README gives
you two ways to ship it and two ways to keep its data fresh. Pick whichever fits
your stack — nothing here locks you in.

---

## TL;DR

- The dashboard is plain HTML/CSS/vanilla JS. No framework, no build step.
- It renders from a single JSON file (`dashboard-data.json`) whose shape is
  formally documented in `dashboard-data.schema.json`.
- That JSON is produced from the Excel workbook by `export_dashboard_data.py`.
- A working sample (`dashboard-data.json`) is included so you can run it now.

```
open standalone/vitaline-order-dashboard.html      # works immediately, no server
# or serve the split/ folder and open index.html   # needs http://, see below
```

---

## What's in this package

```
handoff/
├── README.md                      ← you are here
├── dashboard-data.schema.json     ← the data contract (JSON Schema draft-07)
├── export_dashboard_data.py       ← workbook (.xlsx) -> dashboard-data.json
├── Vitaline_Live_PAR_Workbook_v17.xlsx   ← the source workbook
│
├── standalone/
│   └── vitaline-order-dashboard.html    ← data baked in; double-click to run
│
└── split/
    ├── index.html                 ← markup; loads dashboard.js + fetches JSON
    ├── dashboard.js               ← all app logic
    └── dashboard-data.json        ← sample data (current snapshot)
```

### Two packaging options — pick one

**A. `standalone/` — one file, data embedded.**
Simplest possible hosting: it's a single `.html` with the data inlined, so it
runs by double-clicking or from any static host with zero configuration. To
refresh, you regenerate the file (the export script can emit it; see below).
Best if you want dead-simple and don't mind regenerating one file per refresh.

**B. `split/` — app and data separated.**
`index.html` + `dashboard.js` are static and never change; only
`dashboard-data.json` changes on refresh. This is the cleaner long-term shape —
you can redeploy data without touching the app, point the fetch at an API, add
caching headers, etc. Requires serving over `http(s)://` (see the note on
`file://` below). Best if you're hosting properly and want a clean refresh loop.

Both render identically. The split version additionally shows a "Data refreshed"
timestamp from the JSON's `generated` field.

> **`file://` note for the split version:** browsers block `fetch()` of a local
> file when the page itself is opened via `file://`. So double-clicking
> `split/index.html` shows an error. Serve it over HTTP instead — even
> `python -m http.server` in the `split/` folder works for a local check. The
> standalone version has no such constraint.

---

## The data contract

The dashboard reads one JSON object. Full spec in `dashboard-data.schema.json`;
here's the shape:

```jsonc
{
  "generated": "2026-06-17T15:53:34",        // ISO timestamp (optional)
  "controls": {                               // header context, all display-ready strings
    "booking_start": "5/2/26",
    "booking_end":   "5/29/26",
    "snapshot":      "6/12/26",
    "demand_basis":  "Formulary Primary"
  },
  "activation": {                             // per-office on/off; missing = active
    "Atlanta": "Y", "Cleveland": "N", "Dayton": "N", ...
  },
  "rows": [                                   // one per PAR line item (Include = Y only)
    // fixed-order array — see indices below
    ["Atlanta","Medline","ROLLS - Item # DYKS1486","Box/Case",50,145,9,0.32,0.21,0,0,0,"OK"],
    ...
  ]
}
```

Each `rows` entry is a **fixed-order array** (compact, not an object). Index map
(also in `dashboard.js` as `COLS`, and in the schema):

| idx | field         | notes |
|-----|---------------|-------|
| 0   | office        | must match an `activation` key |
| 1   | vendor        | Infusive / Medline / TwinMed |
| 2   | item          | display name |
| 3   | unitBasis     | Vial / Box/Case / Each … (display only) |
| 4   | unitsPerPack  | number |
| 5   | pricePerPack  | USD |
| 6   | onHand        | latest in-stock qty |
| 7   | parTarget     | PAR target qty |
| 8   | rop           | reorder point qty |
| 9   | orderPacks    | suggested packs (0 unless ordering) |
| 10  | orderUnits    | suggested usable units |
| 11  | orderCost     | USD; drives the office's order $ total |
| 12  | status        | see below |

**Status values and meaning:**
- `ORDER`, `Below Target` → the two "needs ordering" states. They contribute to
  an office's order $ and item count.
- `OK` → on track (counts toward the office's tracked total; no order).
- `No Demand`, `Excluded` → tracked but not actionable.
- `Stock View` → display-only row (e.g. the Biotin 30 mL secondary line); never
  ordered.
- `Inactive` → emitted when an office is toggled off.

**Tiering (computed in the dashboard, not in the data):** an active office is
**Critical** if >50% of its tracked items need ordering, **Watch** if 25–50%,
**Stable** if <25%. Tracked = `ORDER` + `Below Target` + `OK`. Inactive offices
are greyed and excluded from all network totals.

If you serve data from your own backend instead of the export script, just
conform to `dashboard-data.schema.json` and the dashboard won't know the
difference. You can validate with any JSON Schema validator, e.g.:

```bash
pip install check-jsonschema
check-jsonschema --schemafile dashboard-data.schema.json dashboard-data.json
```

---

## Refresh paths — pick one

The workbook is the source of truth. The dashboard's data is a snapshot of it.
"Refresh" = regenerate `dashboard-data.json` (split) or the standalone HTML.

### Path 1 — Re-export from the workbook (batch / scheduled)

Run the included script whenever the workbook changes:

```bash
pip install openpyxl
python export_dashboard_data.py Vitaline_Live_PAR_Workbook_v17.xlsx split/dashboard-data.json
```

That's the whole refresh for the split version. Wire it to whatever cadence you
like — cron, a CI job, a file-watch on the SharePoint/OneDrive sync folder, a
small webhook, etc.

> **Critical gotcha — recalculation.** `openpyxl` reads the values Excel *last
> saved* (cached results), not a live recalculation. So the workbook must be
> **saved in Excel after any data change** before exporting, or you'll export
> stale numbers. If you want a fully headless pipeline (no human opening Excel),
> add a recalc step first — e.g. round-trip through LibreOffice:
> ```bash
> soffice --headless --calc --convert-to xlsx --outdir /tmp recalc_me.xlsx
> python export_dashboard_data.py /tmp/recalc_me.xlsx split/dashboard-data.json
> ```
> LibreOffice recalculates on load, so the converted copy carries fresh values.
> (Validate against a known figure the first time — e.g. the network order $.)

To refresh the **standalone** file instead, generate the JSON then inline it:
the standalone HTML contains the data at the `const DATA = {...}` assignment near
the top of its `<script>`. Easiest is to template it: take `split/index.html`,
read `dashboard-data.json`, and replace the `fetch` boot with a literal
`DATA = <json>` — or just host the split version and skip standalone entirely.

### Path 2 — Serve data live from your backend (no re-export)

If you'd rather not run a batch step, stand up an endpoint that returns the same
JSON shape and point the dashboard at it. In `split/dashboard.js`, the loader is:

```js
async function boot(){
  const url = 'dashboard-data.json?v=' + Date.now();   // <-- change this
  const resp = await fetch(url, {cache:'no-store'});
  DATA = await resp.json();
  ...
}
```

Change `url` to your endpoint (e.g. `/api/dashboard-data`). As long as the
response matches `dashboard-data.schema.json`, everything works. Your backend can
read the workbook with openpyxl (mind the recalc note), or — better long term —
read from wherever the PAR engine's numbers live upstream of Excel. The
dashboard cache-busts each load, so a normal page refresh always pulls current
data; no hard-reload needed.

---

## How the UI works (for maintenance)

- **Network pulse** (header): one bar per active office, height ∝ order $, color
  by tier. Click a bar → scrolls to and opens that office.
- **Metric tiles:** total order $, line items needing order, count of active
  offices at Critical.
- **Office cards:** grouped Critical / Watch / Stable, plus a greyed Inactive
  section. Click a card → expands an item table (status, on hand, PAR target,
  order qty, est. cost).
- **Search:** matches item / vendor / office across everything (flat results).
- **Vendor chips:** All / Infusive / Medline / TwinMed; recompute every figure.
- **Needs order ↔ Full item list** toggle: controls whether the expanded table
  shows only orderable items or the complete list.

All state is in a single `state` object in `dashboard.js`; rendering flows
through `fullRender()`. Colors are CSS custom properties at the top of the
`<style>` block in `index.html` (teal brand: `--brand:#0F5F6D`). No external
fonts are required to function (Google Fonts is referenced with a system-font
fallback; if the CDN is blocked it still looks clean).

No localStorage / sessionStorage is used. No third-party JS at runtime. It will
run inside any static host, an iframe, or behind auth without modification.

---

## Quick start checklist

1. `open standalone/vitaline-order-dashboard.html` → confirm it renders.
2. `cd split && python -m http.server 8000` → open `http://localhost:8000` →
   confirm it renders and shows a "Data refreshed" stamp.
3. `python export_dashboard_data.py Vitaline_Live_PAR_Workbook_v17.xlsx split/dashboard-data.json`
   → reload → confirm numbers update.
4. Decide packaging (standalone vs split) and refresh path (re-export vs live
   endpoint), then deploy to your static host or app.

Questions on the data semantics or the PAR engine behind the numbers — Eliyahu
can fill in the domain side. The contract in `dashboard-data.schema.json` is the
authoritative spec for the app's input.

---

## Week-toggle (multi-week history) — NEW

The dashboard can switch between weeks. The header shows a **Viewing week**
dropdown; pick a past week and the whole dashboard time-travels to how it looked
then (full context — tiers, stock, orders — not just the order list). A badge
shows whether you're viewing the **Current week** or a **Past week**.

### How it works
- `export_dashboard_data.py` writes, each run:
  - `dashboard-data.json` — the current week (default load)
  - `snapshots/YYYY-MM-DD.json` — a dated copy of that week
  - `snapshots/manifest.json` — the list of weeks the dropdown shows
- The dropdown offers a **rolling 12 weeks** (newest first). Older dated files
  stay on disk but leave the dropdown; delete them anytime to reclaim space.
- If there's no `snapshots/` folder or manifest (e.g. the standalone single-file
  build), the dashboard simply hides the dropdown and shows the one dataset.

### Weekly refresh (what builds the history)
Each week, after the workbook is updated and saved:
```bash
python export_dashboard_data.py Vitaline_Live_PAR_Workbook_v17.xlsx <dashboard_dir>
```
That one command refreshes the current week AND appends the dated snapshot to the
history the dropdown reads. No extra step.

### Hosting note
For the split version, keep `snapshots/` in the SAME folder as `index.html`.
The split/multi-week version must be served over http(s) (so it can fetch the
manifest and dated files). Opening `index.html` directly from disk won't load the
history — serve the folder instead. The standalone single-file build still works
by double-click but has no week-toggle (its data is embedded).

---

## Maintenance summary (keeping it healthy)

- **Workbook stays lean.** History is trimmed to the current month's snapshots
  plus one month-end snapshot per prior month; older raw snapshots live in
  `Vitaline_Snapshot_History.xlsx`. Helper formulas run to row 18,000 (current
  data ~14,200 + headroom). Re-extend formulas only if data approaches 18,000.
- **After each data drop**, glance at the **Live_Controls** tab's "Unmapped
  Supplies" counter. 0 = everything mapped. Above 0 = a new supply name appeared
  in the feed; add it to `Inventory_Item_Map` before trusting the numbers.
- **Keep workbook and dashboard in sync** by re-running the export whenever the
  workbook's numbers change.
- **Monthly archiving** (optional, keeps the workbook fast long-term): move the
  prior month's mid-month snapshots out to the history file, keeping just that
  month's end snapshot.
