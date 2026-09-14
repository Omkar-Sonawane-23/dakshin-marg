# Dakshin Marg — System Architecture (as built)

**Project:** AI-Enabled Antarctic Sea-Ice, Iceberg Trajectory & Navigation Decision Support System
**Org:** Ministry of Earth Sciences (MoES) / NCPOR — Smart India Hackathon prototype
**Last updated:** 2026-09-03 (product-quality pass)

---

## 1. Guiding Principle

This is a **DECISION SUPPORT SYSTEM**, not autonomous ship control. The final
navigation decision always remains with a qualified human operator. Every
"accept route" action in the product is an explicit human click; nothing is
ever auto-accepted.

```
OBSERVE → PREDICT → ASSESS → OPTIMIZE → DECIDE
```

| Stage | As-built implementation |
|---|---|
| OBSERVE | NSIDC sea-ice rasters, USNIC iceberg positions, Open-Meteo wind/temp, BYU/NIC historical tracks — ingested, validated, normalized by the Python service |
| PREDICT | Damped-trend sea-ice forecast (backtest-validated vs persistence); berg-damped-drift trajectory model (backtest-validated vs stationary baseline) |
| ASSESS | POLARIS (IMO MSC.1/Circ.1519) RIO × vessel ice class + Overland (1990) icing predictor + empirical berg hazard zones; worst-of combination — no invented weights |
| OPTIMIZE | A* shortest paths under categorical severity ceilings (3 profiles) — no weighted cost blending |
| DECIDE | Explainable recommendation (documented IMO-anchored rule) + re-planning drill with generated "why changed" trail; operator decides |

## 2. High-Level Architecture (as built)

```
REAL DATA SOURCES                     ┌── NSIDC Sea Ice Index v4 (GeoTIFF, daily)
      │                               ├── USNIC current icebergs (CSV, weekly)
      ▼                               ├── Open-Meteo wind/temp (JSON, hourly)
INGEST → VALIDATE → NORMALIZE         └── BYU/NIC consolidated berg DB v8 (tracks)
      │        (python-services/env_data/ingest.py, validation.py)
      ▼
data/normalized/*.json  (versioned snapshots, provenance-tagged)
      │
      ▼
PYTHON SCIENTIFIC SERVICE  · FastAPI :8100
  /env/*          observations (sea-ice, bergs, weather) + provenance envelope
  /ml/sea-ice/*   damped-trend forecast + empirical σ grids
  /ml/icebergs/*  detection / tracking / trajectory (separately validated)
  /ml/risk/*      POLARIS+icing+berg-zone spatial & route risk
  /ml/routes/*    severity-ceiling A* optimizer + deterministic re-plan drill
      │
      ▼
NODE APPLICATION API  · Express + TS :8200
  /api/icebergs/* /api/risk/* /api/routes/*   validated pass-throughs w/ caching
  /api/health
      │
      ▼
REACT WEB APP  · Vite + TS + Tailwind  (dev :5173 · production preview :4173)
  custom polar-stereographic SVG/canvas map (no map-library dependency)
  DEMO mode: deterministic seeded scenario (all data labelled SIMULATED)
  LIVE mode: real datasets + derived layers (provenance badges throughout)
      │
      ▼
HUMAN OPERATOR — final decision authority
```

### Responsibility split (hard rule, maintained)

- **Python** owns all scientific/data work: raster processing, forecasting,
  detection/tracking/trajectory, risk math, route search. Stateless;
  every response carries a provenance envelope.
- **Node** is the application layer: request validation, response caching,
  timeouts, error normalization. No science in Node.
- **Frontend** never computes science; it renders what the APIs return,
  including their explanations, assumptions, and warnings.

### Deviations from the original plan (documented, deliberate)

| Planned | As built | Why |
|---|---|---|
| MapLibre GL | Custom polar-stereographic SVG/canvas map | Polar projection + full control over risk/route/drill layers; zero external tile/key dependency; smaller bundle |
| MongoDB persistence | Not yet wired; domain state lives in the deterministic scenario + normalized JSON snapshots | No domain writes exist yet (missions/audit are PLANNED); adding a DB before there is data to persist violates the no-premature-infrastructure rule |
| SSE/WebSocket push | Not yet needed | All current flows are request/response; the drill timeline is precomputed |

## 3. Repository Layout

```
dakshin-marg/
├── frontend/           React + TS + Vite + Tailwind (custom map in src/components/map/)
├── backend/            Node + Express + TS application API
├── python-services/    FastAPI env_data package (ingest, models, risk, optimizer, drill)
├── data/               real/ (cached source data) · normalized/ (validated snapshots) · metadata/
├── docs/               this documentation set
└── shared/             (reserved for shared schemas)
```

## 4. Service Contract

Every Python response uses the envelope:

```json
{
  "data":  { },
  "meta": {
    "provenance": "OBSERVED | HISTORICAL | FORECAST | MODEL_FORECAST | DERIVED_FROM_OBSERVATION | SIMULATED",
    "temporal":   { },
    "source":     { "dataset/model name, version, methodology doc" },
    "quality":    { },
    "warnings":   [ ],
    "servedAt":   "ISO-8601"
  }
}
```

Errors: `{"detail": {"code": "MACHINE_CODE", "message": "human text"}}` with
proper HTTP status. Endpoint-by-endpoint contracts: `api-contracts.md`.

## 5. Cross-Cutting Concerns (enforced, not aspirational)

- **Data honesty:** real vs simulated never mixed silently. The re-planning
  drill injects exactly one simulated fact and labels it in the payload, the
  envelope, the panel, and on the map. Fuel is *not estimated* by the route
  optimizer because no validated consumption model exists — the API says so.
  When the live feed is down, badges switch to "LIVE FEED UNAVAILABLE" rather
  than continuing to claim real data.
- **Explainability:** risk and route responses carry generated `explanations`
  and declared `assumptions` derived from actual computed values.
- **Determinism:** DEMO scenario is seeded; the re-plan drill output is
  byte-identical across processes (verified by cmp).
- **Accessibility:** severity always text+icon+shape (● ◆ ▲ ■), never color
  alone; all interactive elements carry accessible names (verified 0
  unlabeled); tab/switch/tablist roles used throughout.
- **Failure behavior:** every live card has loading / error / empty states;
  API-down shows explicit degraded status + retry, and JS never crashes
  (verified with the Python service killed).

## 6. Ports & Processes

| Service | Port | Command |
|---|---|---|
| Python env/ML API | 8100 | `python3 -m uvicorn env_data.api:app --host 0.0.0.0 --port 8100` (in `python-services/`) |
| Node application API | 8200 | `npm run start` (in `backend/`) |
| Frontend dev | 5173 | `npm run dev` (in `frontend/`) |
| Frontend production build | 4173 | `npm run build && npm run preview` (in `frontend/`) |

Setup and demo instructions: `docs/setup-and-demo.md`.
Feature status: `docs/implementation-status.md`.
