# Dynamic Route Re-Planning — Deterministic Drill

Status: **IMPLEMENTED** · `replan-drill` v0.1.0
(`python-services/env_data/replan_drill.py`)

The drill demonstrates the full OBSERVE → PREDICT → ASSESS → OPTIMIZE → DECIDE
loop reacting to a changed hazard: a route is planned, accepted, and underway;
an iceberg deviates onto the corridor; the system detects the conflict, raises
an alert, re-plans, explains, and waits for the operator's decision.

## Honesty model — what is real vs simulated

| | |
|---|---|
| **REAL** | sea-ice field (NSIDC), weather (Open-Meteo), all other berg positions (USNIC), POLARIS/Overland risk mathematics, backtest drift quantiles, the A* optimizer, and **every number on every route** |
| **SIMULATED** | exactly **one fact**: iceberg **D23** is "re-sighted" at −68.625°, 75.75° (~100 km north of its real charted position — the drill story is that it ungrounds and drifts into the corridor) and reclassified MOVING |

The simulated fact is injected via `build_berg_zones(overrides=…)`. Every
payload that touches it carries `simulated: true`, a `SIMULATION` warning, the
UI badge "D23 — SIMULATED", and the whole response envelope is provenance
`SIMULATED`. The overridden berg's hazard-zone radii still come from the real
backtest quantiles (2-day-old MOVING fix → P50/P90 from the walk-forward
backtest) — the simulation changes *where* the berg is, never *how* risk is
computed. With no overrides, engine output is byte-identical to before
(regression-checked against the reference risk surface).

## Determinism

No randomness anywhere. The document is **byte-identical across fresh
processes** (verified by serializing two runs from separate interpreters and
`cmp`-ing them, timestamps excluded). Judges can re-run the drill any number
of times and see the same numbers.

## The timeline (7 stages ↔ the 13-step scenario)

| Stage | simTime | What happens | Steps covered |
|---|---|---|---|
| MISSION_START | T+0h | real env state loaded; optimizer generates 3 alternatives; DIRECT recommended (all-LOW corridor) | 1–3 |
| ROUTE_ACCEPTED | T+0h | **operator** accepts DIRECT (869 nm, 69.5 h) | 4 |
| UNDERWAY | T+24h | vessel advanced 24 h at 12.5 kn (300 nm); position interpolated on the accepted geometry | 5 |
| BERG_DEVIATION | T+24h | the SIMULATED D23 re-sighting; hazard zone rebuilt with real quantiles | 6 |
| CONFLICT_DETECTED | T+24h | remaining leg re-assessed: **LOW → CRITICAL** (closest approach 2.5 km); alert raised | 7–9 |
| REPLAN | T+24h | fresh optimization **from the vessel's live position**: CONSERVATIVE now recommended (+12 nm / +1.0 h, removes all HIGH/CRITICAL exposure) | 10 |
| DECISION_PENDING | T+24h | old (red, struck) vs new (green, animated draw-in) side by side + 4-point "why changed" trail; **operator** accepts | 11–13 |

The frontend never auto-advances: the operator steps the timeline and makes
both accept decisions. Decision support only.

## Why-changed explanation (generated, not hard-coded)

The four-point trail is composed from engine outputs at runtime: initial
recommendation rationale → the simulated input (declared) → measured severity
jump with closest-approach distance → the re-optimization result under the
same documented rule (MSC.1/Circ.1519 §1.4.5), including what staying on the
old line would cost.

## API

- `GET /ml/routes/replan-drill` (Python :8100) — whole precomputed timeline,
  envelope provenance `SIMULATED`; cached in-process (deterministic, so safe).
- `GET /api/routes/replan-drill` (Node :8200) — cached pass-through (5 min).

## Map visualization

- Stage-driven layer replaces the ordinary planner layer while the drill runs.
- OLD route: cyan → flowing-dash "underway" → red dashed + `✕ OLD ROUTE` tag
  after the conflict → faded once superseded.
- NEW route: draws itself in (2.2 s stroke animation), `➜ NEW ROUTE` tag →
  `✓ ACTIVE ROUTE` with flowing dashes after operator acceptance.
- D23: grey ring at true charted position, dashed displacement arrow,
  hazard rings (real radii) at simulated position, pulsing ping,
  `D23 — SIMULATED` callout, `■ CONFLICT` marker with closest-approach.
- Top-strip badge `◈ RE-PLANNING DRILL · SIMULATION · T+…` whenever active.

## Limitations (declared)

- The vessel's 24 h advance assumes constant cruise speed on the accepted
  line; no ocean-current or weather-routing drift model is applied.
- The deviation is a scripted drill input, not a trajectory-model forecast;
  it exists to exercise the detection → alert → re-plan → decide loop.
- Continuous monitoring is represented as a stage transition; a production
  system would poll `route_risk` on a schedule (the engine call is the same).
