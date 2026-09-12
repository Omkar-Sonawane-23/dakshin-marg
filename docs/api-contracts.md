# POLARIS-X — API Contracts

**Status:** Phase 0 draft — contracts defined ahead of implementation.
Every endpoint below is **PLANNED** until marked otherwise in
`implementation-status.md`. Contracts may be refined during implementation;
changes are recorded here.

---

## 1. Conventions

- Node application API base: `/api/v1`
- Python scientific API base: `/ml` (internal — called only by Node)
- All timestamps UTC ISO-8601. All coordinates WGS84 lon/lat (GeoJSON order).
- Validation: zod (Node), pydantic (Python). Invalid input → 400 with field errors.

### Standard envelope (Node)
```json
{ "data": {}, "meta": { "requestId": "...", "timestamp": "..." } }
```
Errors:
```json
{ "error": { "code": "SEA_ICE_FORECAST_UNAVAILABLE",
             "message": "Sea-ice forecast unavailable for this region. Last valid forecast: 14:00 UTC.",
             "details": {} } }
```
Error messages must be operator-meaningful, never "Something went wrong."

### Mandatory scientific-result metadata (Python responses)
```json
{
  "model": { "name": "...", "version": "..." },
  "executedAt": "...",
  "status": "ok | degraded | failed",
  "warnings": [],
  "confidence": 0.0,
  "isSimulated": true,
  "geoRef": { "crs": "EPSG:4326", "bbox": [] }
}
```

---

## 2. Node Application API (frontend ↔ Node)

### Missions
| Method | Path | Purpose |
|--------|------|---------|
| GET    | /api/v1/missions | list missions |
| POST   | /api/v1/missions | create mission (vessel, origin, destination, departure, risk preference) |
| GET    | /api/v1/missions/:id | mission detail incl. active route, risk, alerts |
| POST   | /api/v1/missions/:id/decision | record operator approve/override (DECIDE stage) |

### Vessels
| GET  | /api/v1/vessels | list vessel profiles |
| POST | /api/v1/vessels | create vessel (name, class, ice class, speed, draft, fuel model params) |

### Environment
| GET | /api/v1/environment/sea-ice?time=&bbox=&horizon= | sea-ice layer (tiles/simplified grid) + metadata |
| GET | /api/v1/environment/icebergs?bbox=&time= | iceberg detections/tracks in view |
| GET | /api/v1/environment/weather?bbox=&time= | weather/wind summary layer |

### Icebergs
| GET | /api/v1/icebergs/:id | detail: attributes, observation history, confidence |
| GET | /api/v1/icebergs/:id/trajectory?horizon= | predicted positions + uncertainty corridor (GeoJSON) |

### Risk
| POST | /api/v1/risk/analyze | body: missionId or route geometry → overall level + factor breakdown + spatial refs |

### Routes
| POST | /api/v1/routes/generate | body: origin, destination, vesselId, departure, constraints, riskPreference → route alternatives with distance/time/fuel(labelled)/risk/hazards/reasons |
| POST | /api/v1/routes/recalculate | body: missionId, trigger → new alternatives + before/after diff + explanation |
| GET  | /api/v1/routes/:id | stored route detail |

### Alerts
| GET  | /api/v1/alerts?missionId=&since= | alerts (severity, ts, location, reason, affected component, recommended action) |
| POST | /api/v1/alerts/:id/ack | operator acknowledgement |

### Simulation / Demo
| POST | /api/v1/simulation/start | seeded scenario id → deterministic run |
| POST | /api/v1/simulation/advance | body: { hours: 6|12|24 } |
| POST | /api/v1/simulation/reset | |
| GET  | /api/v1/simulation/state | current sim clock + snapshot refs |
| GET  | /api/v1/simulation/timeline?runId= | replay frames T+0…T+N |

### Realtime
| GET | /api/v1/stream (SSE) | events: alert.created, route.updated, simulation.tick, environment.updated |

---

## 3. Python Scientific API (Node ↔ Python, internal)

| Method | Path | Purpose |
|--------|------|---------|
| POST | /ml/sea-ice/forecast | history refs + horizon → forecast grid ref + uncertainty + metadata |
| POST | /ml/icebergs/detect | imagery ref → detections (id, geometry, ts, source, confidence, size-if-available, model version) |
| POST | /ml/icebergs/track | detections over time → associated tracks (handles gaps, duplicates, uncertain matches) |
| POST | /ml/icebergs/trajectory | track + currents + wind → predicted positions, corridor polygon, confidence |
| POST | /ml/risk/analyze | env refs + vessel constraints → risk surface ref + factor attribution |
| POST | /ml/routes/optimize | cost-surface ref + endpoints + objectives → N routes with per-route metrics |
| GET  | /ml/health | service + model registry status |

All `/ml` responses include the mandatory metadata block (§1). Large grids are
returned as file references + summary stats, not inline megabyte payloads.

### Implemented iceberg endpoints (v0.1 — GET, dataset-driven)

The design table above describes the POST/reference-passing target contract.
The current implementation ships GET endpoints because inputs are the
normalized datasets on disk, not request payloads:

| Layer | Method | Path | Notes |
|-------|--------|------|-------|
| Python | GET | /ml/icebergs/detections | detector output + independent validation block |
| Python | GET | /ml/icebergs/tracks (+ /validation) | per-berg tracks + identity-stripping validation |
| Python | GET | /ml/icebergs/trajectories | predictions + empirical P50/P90 corridor + backtest metrics |
| Node | GET | /api/health | app API + Python dependency status |
| Node | GET | /api/icebergs/{detections,tracks,tracks/validation,trajectories} | cached pass-throughs (60 s TTL) |
| Node | GET | /api/icebergs/situation | join: track + prediction + USNIC current position per berg |
| Python | GET | /ml/risk/spatial?ice_class&horizon_h | severity+flags grids, contributors, explanations, assumptions (h ∈ 0/24/48/72) |
| Python | POST | /ml/risk/route | {waypoints, iceClass, horizonH} → route severity, exposure %, berg encounters, worst point |
| Python | GET | /ml/risk/catalog | valid ice classes/horizons/severity scale + methodology refs |
| Node | GET/POST | /api/risk/{catalog,spatial,route} | pass-throughs (spatial/catalog cached) |
| Python | POST | /ml/routes/optimize | {origin, destination, iceClass?, cruiseSpeedKn?, horizonH?} → 3 profile routes (geometry, nm, est h, risk exposure, berg encounters, notes), recommendation + reason, assumptions; fuelEstimate always null (declared) |
| Python | GET | /ml/routes/profiles | profile catalog (severity ceilings + exclusions) |
| Node | GET/POST | /api/routes/{profiles,optimize} | pass-throughs (optimize validated then forwarded, 60 s timeout) |
| Python | GET | /ml/routes/replan-drill | deterministic 7-stage re-planning drill timeline (provenance SIMULATED; one labelled simulated fact, real engines) |
| Node | GET | /api/routes/replan-drill | cached pass-through (5 min) |

Node errors use the same `{ detail: { code, message } }` envelope; unknown
`/api` routes return JSON 404 (`NOT_FOUND`).

---

## 4. Contract Governance

- Shared request/response types live in `shared/` (TS types + JSON schemas)
  and are the single source of truth for both Node and frontend.
- Breaking changes require a version bump note in this file.
