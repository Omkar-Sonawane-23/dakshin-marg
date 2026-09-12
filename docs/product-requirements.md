# POLARIS-X — Product Requirements

**Status:** Phase 0 baseline · Last updated 2026-09-02

---

## 1. Product Objective

An AI-powered Antarctic environmental-intelligence and navigation
decision-support platform for research vessels, that:

1. Presents current Antarctic environmental conditions (OBSERVE)
2. Forecasts sea-ice conditions (PREDICT)
3. Detects & tracks icebergs where data permits (OBSERVE/PREDICT)
4. Predicts probable iceberg trajectories with uncertainty (PREDICT)
5. Converts environmental state into explainable navigation risk (ASSESS)
6. Generates safer, fuel-aware route alternatives (OPTIMIZE)
7. Dynamically re-plans routes when conditions change (OPTIMIZE)
8. Presents explainable recommendations to a human operator (DECIDE)
9. Delivers all of it through a polished polar mission command-center UI

**Non-goal:** autonomous navigation. The human operator always decides.

---

## 2. Primary Users

| User | Need |
|------|------|
| Ship navigator / master | Route recommendations, hazards, alerts, "why" |
| Voyage planner (shore)  | Mission setup, scenario comparison, replay |
| Polar scientist         | Sea-ice/iceberg intelligence, forecast confidence |
| SIH evaluator           | 3–5 min deterministic demo proving the full loop |

---

## 3. Main Screens (constitution §7)

| # | Screen | Purpose | Status |
|---|--------|---------|--------|
| 1 | Mission Command Center | Whole mission picture in seconds; map-dominant | PLANNED |
| 2 | Sea-Ice Intelligence   | Concentration now/history/forecast + time slider | PLANNED |
| 3 | Iceberg Intelligence   | Detections, tracks, predicted trajectories + uncertainty corridors | PLANNED |
| 4 | Navigation Risk        | Spatial risk map + explainable factor breakdown | PLANNED |
| 5 | Route Optimizer        | Origin/destination/vessel/constraints → compared alternatives | PLANNED |

Supporting: mission/vessel management, alert center, simulation controls,
mission replay timeline, settings.

---

## 4. Functional Requirements (summary)

- **FR-1 Mission management** — create/select missions; vessel, origin, destination, departure. PLANNED
- **FR-2 Vessel management** — vessel profiles incl. ice-class constraints used by risk/fuel models. PLANNED
- **FR-3 Sea-ice layer** — concentration visualization, NOW + only genuinely supported forecast horizons. PLANNED
- **FR-4 Iceberg intelligence** — detections (labelled demo data where synthetic), tracks, trajectory + uncertainty corridor. PLANNED
- **FR-5 Risk engine** — documented, configurable formula; spatial surface + per-route risk + factor breakdown. PLANNED
- **FR-6 Route optimizer** — ≥3 alternatives (shortest / balanced-recommended / conservative) with distance, ETA, fuel estimate (labelled), risk score, hazards, recommendation reason. PLANNED
- **FR-7 Dynamic re-planning** — environmental change → affected-area detection → risk recompute → alert → recalculated route → before/after comparison + explanation. PLANNED
- **FR-8 Alerts** — severity, timestamp, location, reason, affected component, recommended action; no spam. PLANNED
- **FR-9 Simulation** — deterministic, seeded; START/PAUSE/+6h/+12h/+24h/RESET. PLANNED
- **FR-10 Mission replay** — timeline T+0…T+N showing vessel/ice/risk/route/alert evolution. PLANNED
- **FR-11 Demo mode** — one-click 3–5 min deterministic scripted scenario (constitution §32–33). PLANNED

---

## 5. UI Quality Bar (constitution §6, §27–30)

- Polar aesthetic: deep navy/near-black, ice-white surfaces, restrained cyan
  accents, scientific-professional tone. NOT a generic SaaS/admin/crypto dashboard.
- Map is the visual centerpiece; impressive within 5 seconds.
- Every screen: loading / empty / error / success / hover-focus states.
- Accessibility: keyboard nav, contrast, risk levels communicated by
  text+icon+shape, never color alone.
- Responsive: desktop-first, tablet secondary, simplified mobile mission view.
- Animations only when they communicate (vessel movement, route transitions,
  trajectories, alerts, timeline).

---

## 6. Honesty & Labelling Requirements (constitution §36)

- Simulated/demo data always labelled `SIMULATION / DEMO DATA / SAMPLE DATA`.
- Fuel figures always labelled as model estimates, never validated measurements.
- No fabricated accuracy, datasets, partnerships, or operational validation.
- Feature status vocabulary: `IMPLEMENTED` / `IN PROGRESS` / `PLANNED` only.

---

## 7. Acceptance Criteria for the Final Demo

1. One-click START DEMO loads an Antarctic mission deterministically.
2. Conditions, vessel, and generated routes are visible with recommendation + reasons.
3. Advancing time introduces a simulated iceberg trajectory change (labelled SIMULATED).
4. Route risk alert fires with reason; route is recalculated.
5. Before/after route comparison shown; operator approval step represented.
6. Total runtime ≈ 3–5 minutes; fully reproducible run-to-run.
