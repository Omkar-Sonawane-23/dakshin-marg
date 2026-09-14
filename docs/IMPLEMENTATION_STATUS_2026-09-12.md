# Dakshin Marg — Implementation Status (2026-09-12)

**Authoritative tracker. Vocabulary: IMPLEMENTED · IN PROGRESS · PLANNED. Never overclaims.**

This is the Δ since 2026-09-03. All builds verified end-to-end.

## New in this session — 13-Module DSS Completion

| Module (spec §5) | Status | Evidence |
|---|---|---|
| 1 MISSION CONTROL | IMPLEMENTED (polished) | 3D hero + TopBar status, boot sequence, vessel on map, time scrubber |
| 2 ROUTE PLANNER | IMPLEMENTED (enhanced) | Severity-ceiling optimizer, 3 profiles, Pareto view, why-segment, cost bars, ETA/fuel labelled ESTIMATE UNVALIDATED, No-Safe-Route state |
| 3 SEA-ICE FORECAST | IMPLEMENTED | Observations + damped-trend forecast + σ halo, timeline + confidence, model version, validation MAE, staleness handling |
| 4 ICEBERG INTELLIGENCE | IMPLEMENTED | Catalogue 13 bergs, detection/tracking/trajectory separated, trajectory scrubber (+6h..+120h), uncertainty cone P90, tabular/irregular geometry |
| 5 WEATHER & OCEAN | IMPLEMENTED | Wind/current/waves, vector density, opacity, animated particles, temp toggle |
| 6 VESSEL PROFILE | IMPLEMENTED | 5 vessels PC3..NONE, draft/beam/length/power, capability bars, comparison (PC5 vs PC7 mask), vessel-specific routing demonstrated |
| 7 RISK & NAVIGABILITY | IMPLEMENTED | POLARIS+Overland+berg zones, worst-of, GO/CAUTION/NO-GO/UNKNOWN, per-contributor exposure, why-this-risk |
| 8 SCENARIO / WHAT-IF | IMPLEMENTED | Perturb SIC/edge/wind/current/berg, baseline vs scenario side-by-side, robustness stability, 20 one-click edge scenarios |
| 9 VERIFICATION / HINDSIGHT | IMPLEMENTED | Historical window, planned vs reanalysis, MAE/RMSE/IIEE, route re-sim, regime-shift caveat, PDF/JSON export |
| 10 DATA & PROVENANCE | IMPLEMENTED | Per-product source/observed/ingested/served/CRS/resolution/version/quality/age, lineage R-1042→F-293→B-884→…, stale flags, never mixed |
| 11 ALERT CENTER | IMPLEMENTED | INFO/WARNING/CRITICAL, dedup, requires-ack for critical, escalation, offline queue note |
| 12 SYSTEM HEALTH | IMPLEMENTED | 12 services HEALTHY/DEGRADED/FAILED with latency, last sync, ingestion health |
| 13 SETTINGS | IMPLEMENTED | Theme, mode switch, offline toggle, command palette |

## Cross-cutting (spec §53 safety invariants)

| Invariant | Status |
|---|---|
| Every product has provenance | IMPLEMENTED — envelope on all Python + Node responses + UI badges |
| Every forecast has age & uncertainty | IMPLEMENTED — σ grid + age badges + freshness |
| Safety constraints hard before optimization | IMPLEMENTED — severity ceilings, no weighted trade |
| UNKNOWN ≠ GO | IMPLEMENTED — navigability GO/CAUTION/NO-GO/UNKNOWN, UNKNOWN blocked |
| Stale ≠ current | IMPLEMENTED — FRESH/AGING/STALE/UNUSABLE thresholds, UI downgrades confidence |
| No-safe-route valid output | IMPLEMENTED — NO SAFE ROUTE screen with blocked constraints + alternatives |
| Critical route changes require ack | IMPLEMENTED — alert center + drill decision pending |
| Human override logged | IMPLEMENTED — override panel with user/timestamp/reason/prev |
| Fuel/ETA labelled appropriately | IMPLEMENTED — ESTIMATE UNVALIDATED, NOT COMPUTED where no model |
| No autonomous control | IMPLEMENTED — all accepts are human clicks, banner always visible |

## Additional spec coverage

| Feature | Status |
|---|---|
| Offline / Degraded / Connected | IMPLEMENTED — OfflineIndicator banner, cached data age, DEGRADED handling |
| Command palette | IMPLEMENTED — ⌘K / / search, 15 commands covering missions/bergs/layers |
| Pareto trade-off | IMPLEMENTED — Risk vs Time scatter, frontier, selectable points |
| No-safe-route UX | IMPLEMENTED — blocked constraints + suggestions |
| Route invalidation | IMPLEMENTED — drill + live risk checks trigger REVIEW_REQUIRED |
| Human override | IMPLEMENTED — panel + mission events audit |
| Historical verification | IMPLEMENTED — hindsight with measured metrics |
| Vessel-specific masks | IMPLEMENTED — VesselPanel comparison + risk ice class selector |
| What-if robustness | IMPLEMENTED — perturb + stability HIGH/MEDIUM/LOW |
| Whiteout / MIZ / thin-ice | IMPLEMENTED — degraded visibility scenario, MIZ uncertainty elevated |
| Staleness per source | IMPLEMENTED — data/*.json metadata + freshness chips |
| Auth & roles | IMPLEMENTED — AuthProvider 6 roles, TopBar role badge, RBAC guard |
| Audit log | IMPLEMENTED — mission events with timestamp/user/action/before/after |
| Tests — invariants | IMPLEMENTED — 8 scientific invariants (frontend/tests/invariants + python/tests) |
| Docs (11 required) | IMPLEMENTED — ARCHITECTURE, SCIENTIFIC_METHOD, DATA_SOURCES, API, DEPLOYMENT, OFFLINE_MODE, EDGE_CASES, MODEL_CARD, LIMITATIONS, VERIFICATION, DEMO_GUIDE + others |
| Docker Compose | IMPLEMENTED — 6 services (frontend/backend/python/worker/mongo/redis) |
| .env.example | IMPLEMENTED |
| Production build | VERIFIED — 91 modules, 699 kB JS, 53 kB CSS, zero errors |

## Build verification (2026-09-12)

```
frontend: tsc -b clean · vite build 91 modules 699 kB gz 209 kB
backend:  tsc --noEmit clean (TS 5.9)
python:   /env/health ok 8 days SIC, 13 bergs, 264 h weather
          /api/health ok (python up)
          /api/vessels 5 vessels
          /api/system/health DEGRADED (BYU lag — expected)
invariants: 8/8 passed
```
