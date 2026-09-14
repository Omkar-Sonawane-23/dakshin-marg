# Dakshin Marg — Setup & Demo Guide

## 0. Windows one-click start

Double-click **`START-DAKSHIN-MARG.bat`** in the repository root. It will:

1. verify Python 3.11+ and Node.js 20+ are installed (with clear guidance if not),
2. install Python/Node dependencies (first run only — later runs skip this),
3. build the production frontend (first run only),
4. open three service windows (Python API :8100, Node API :8200, web app :4173),
5. wait for health checks, pre-compute the re-planning drill so the demo is
   instant, and open **http://localhost:4173** in your browser.

To stop the system, close the three service windows. To force a fresh
rebuild, delete `frontend\dist` before launching.

> Prerequisites are the only manual step: install
> [Python](https://www.python.org/downloads/) (tick *"Add python.exe to
> PATH"*) and [Node.js LTS](https://nodejs.org/) once, then the launcher
> handles everything else.

## 1. Prerequisites (manual setup — Linux/macOS or Windows without the launcher)

- Python 3.11+ · Node.js 20+ · npm
- ~500 MB disk (cached datasets + node_modules)
- No API keys required. All data sources are open (NSIDC, USNIC, Open-Meteo, BYU).

## 2. Setup

```bash
# Python scientific service
pip install fastapi uvicorn numpy pillow rasterio

# Node application API
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

Normalized datasets ship in `data/normalized/` — the system runs fully
offline out of the box. To refresh from the live sources (optional):

```bash
cd python-services
python3 -m env_data.ingest            # NSIDC + USNIC + Open-Meteo
python3 -m env_data.iceberg_ingest    # BYU/NIC track database
```

## 3. Run (three terminals)

```bash
# 1 · Python env/ML API (:8100)
cd python-services
python3 -m uvicorn env_data.api:app --host 0.0.0.0 --port 8100

# 2 · Node application API (:8200)
cd backend && npm run start

# 3 · Frontend
cd frontend && npm run dev        # dev server        → http://localhost:5173
# — or the production build —
cd frontend && npm run build && npm run preview   # → http://localhost:4173
```

Health checks: `curl :8100/env/health` · `curl :8200/api/health`.

Optional warm-up (avoids a ~6 s pause at the drill's first click):

```bash
curl -s localhost:8200/api/routes/replan-drill > /dev/null
```

## 4. Demo Script (~8 minutes)

### Act 1 — DEMO mode: the deterministic mission scenario (~2 min)
1. App opens in **DEMO** mode (amber `SIMULATED ENVIRONMENT` badge — every
   demo object is labelled).
2. Press **PLAY** — the scenario clock rolls through a scripted 72 h mission.
3. Jump **+24H**: iceberg BRG-0042's trajectory shifts, risk rises, an alert
   fires with **REVIEW → recalculated route B-2**. This shows the intended
   product loop on fully-simulated data.

### Act 2 — LIVE mode: real datasets (~1.5 min)
4. Switch top-right toggle to **LIVE**. Everything now on screen is real:
   NSIDC sea-ice concentration, 13 named USNIC bergs, Open-Meteo wind.
   Point out the provenance badges (`REAL · OBSERVED`).
5. In *Sea Ice*, tap **+48H** — the backtest-validated damped-trend forecast
   (violet `MODEL · FORECAST` badge; note it beats persistence in the docs).
6. In *Berg Tracking*, toggle drift forecasts — real BYU tracks (green) with
   model predictions (violet dashed) and empirical P90 corridors.

### Act 3 — Navigation risk (~1.5 min)
7. Toggle **Show risk layer on map**. The POLARIS+icing+bergs surface paints
   the AOI; severity icons ● ◆ ▲ ■ (never color alone).
8. Flip ice class **PC5 → PC7 → NONE** — the surface visibly worsens: the
   vessel constraint genuinely drives the math (worst RIO +10.4 → −9.2 → −48.4).
9. Open **Why this risk?** — generated explanations + declared assumptions.

### Act 4 — Route optimization (~1 min)
10. *Route Planner* → **Calculate routes**. Three severity-ceiling profiles
    (no invented cost weights); recommendation with IMO-anchored reason;
    fuel honestly "NOT COMPUTED".

### Act 5 — THE MOMENT: dynamic re-planning drill (~2 min)
11. *Route Simulation* → **Run simulation**. Then step through:
    accept DIRECT → vessel underway (T+24h) → **SIMULATED D23 deviation**
    (labelled everywhere) → conflict **LOW → CRITICAL, closest approach
    2.5 km**, pulsing alert → re-plan → **old route red/struck vs new route
    animating in green** + 4-point "why changed" → **Accept new route
    (operator decision)** → `✓ ACTIVE ROUTE`.
12. Close: mention it is deterministic (byte-identical every run) and that
    only ONE fact was simulated — all numbers came from the real engines.

### Fallback behavior (if asked)
Kill the Python service mid-demo: the UI shows `DATA FEED · DEGRADED`,
"LIVE FEED UNAVAILABLE" on the map, an error card with RETRY — and DEMO mode
keeps working untouched.

## 5. Playwright verification scripts

`/tmp/full_demo.py` (complete run), `/tmp/audit1.py` (a11y/responsive),
`/tmp/audit2.py` (API-failure), `/tmp/verify_prod.py` (production build) —
all pass with zero console errors as of the quality pass.

## 6. Known Limitations (declared, also surfaced in-product)

1. **BYU/NIC track archive lags real time** (~134 d at last check). Track
   *positions* extrapolate from the archive; current USNIC fixes are shown at
   markers. The UI states this in the Berg Tracking card.
2. **Grid resolution 0.5°×0.25°** (~14×28 km): routes are corridor-level
   guidance, not a nautical chart product. Sub-cell hazards are caught by the
   dense route assessment and quantified in `notes`.
3. **No validated fuel model** → fuel intentionally not estimated in the
   optimizer. DEMO-mode fuel figures are labelled model estimates on sample
   vessel data.
4. **Ice type is an assumption** (declared): POLARIS RIO needs ice *type*;
   NSIDC provides concentration only. The engine declares its type assumption
   and reports a ±1-type sensitivity band.
5. **Icing water-temp approximation**: Overland PPR uses Tw = Tf where SST is
   unavailable (conservative; declared in assumptions).
6. **SAR detection validated on a labelled simulated scene** — real Sentinel-1
   access requires authentication. Detection precision/recall figures refer
   to that scene only and are labelled as such.
7. **Drill vessel advance** assumes constant cruise speed on the accepted
   line; no current/weather-routing drift.
8. **Single-operator prototype**: no auth/multi-user/persistence yet
   (see implementation-status.md for the PLANNED list).
9. **Open-Meteo wind** is a global model product, not Antarctic-specific
   reanalysis; labelled REAL · FORECAST/HISTORICAL accordingly.
