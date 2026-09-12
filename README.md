# POLARIS-X

**AI-Enabled Antarctic Sea-Ice, Iceberg Trajectory & Navigation Decision Support System**

Smart India Hackathon prototype · Ministry of Earth Sciences (MoES) · NCPOR
Theme: Transportation & Logistics · Category: Software

> POLARIS-X is a **decision-support system** — it transforms Antarctic
> observations into predictions, risk assessments, and route recommendations.
> It is **not** an autonomous ship-control system: the final navigation
> decision always remains with a qualified human operator.

```
OBSERVE → PREDICT → ASSESS → OPTIMIZE → DECIDE
```

## Quick Start

**Windows:** double-click **`START-POLARIS-X.bat`** — it installs
dependencies on first run, starts all three services, and opens the app at
http://localhost:4173. Only prerequisites: Python 3.11+ and Node.js 20+ on
PATH.

**Linux/macOS:** see [docs/setup-and-demo.md](docs/setup-and-demo.md)
(three commands, three terminals).

## Repository Layout

```
polaris-x/
├── START-POLARIS-X.bat   # Windows one-click launcher
├── frontend/             # React + TS + Vite + Tailwind · custom polar map
├── backend/              # Node.js + Express + TS application API (:8200)
├── python-services/      # FastAPI scientific/ML services (:8100)
├── data/                 # real/ cached sources · normalized/ validated snapshots
├── shared/               # reserved for shared schemas
└── docs/                 # architecture & engineering documentation
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/architecture.md](docs/architecture.md) | System architecture as built & tech decisions |
| [docs/setup-and-demo.md](docs/setup-and-demo.md) | **Setup, run commands, 8-min demo script, known limitations** |
| [docs/research-foundation.md](docs/research-foundation.md) | **Scientific decision record: datasets, methods, uncertainty, validation — with epistemic labels** |
| [docs/implementation-status.md](docs/implementation-status.md) | **Authoritative implemented-vs-planned tracker** |
| [docs/api-contracts.md](docs/api-contracts.md) | Node & Python API contracts |
| [docs/product-requirements.md](docs/product-requirements.md) | Product scope, screens, quality bar |
| [docs/data-flow.md](docs/data-flow.md) | Data pipeline, sources, storage rules |
| [docs/data-pipeline.md](docs/data-pipeline.md) | Environmental ingestion (NSIDC/USNIC/Open-Meteo) |
| [docs/ml-pipeline.md](docs/ml-pipeline.md) | Sea-ice forecasting model + backtest validation |
| [docs/iceberg-pipeline.md](docs/iceberg-pipeline.md) | Berg detection / tracking / trajectory (separately validated) |
| [docs/risk-methodology.md](docs/risk-methodology.md) | POLARIS + Overland icing + berg-zone risk engine |
| [docs/route-optimization.md](docs/route-optimization.md) | Severity-ceiling A* route optimizer |
| [docs/replanning-drill.md](docs/replanning-drill.md) | Deterministic dynamic re-planning demonstration |
| [docs/mission-simulation.md](docs/mission-simulation.md) | **Mission creation, voyage simulation, dynamic re-planning & layer control (deliverables A–G)** |

## Current Status

**Demo-ready** (2026-09-03): full OBSERVE→PREDICT→ASSESS→OPTIMIZE→DECIDE
pipeline implemented on real open datasets, with a deterministic DEMO scenario
and a deterministic LIVE-mode re-planning drill as the flagship demonstration.
Production build verified end-to-end with zero console errors. See
`docs/implementation-status.md` for the authoritative per-feature status and
`docs/setup-and-demo.md` for how to run it.

## Data Honesty

Simulated/demo data is always labelled `SIMULATED / DEMO DATA` end-to-end and
never silently mixed with real observations. Fuel figures are model estimates,
not validated measurements. See docs for every scientific assumption.
