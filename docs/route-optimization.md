# Route Optimization Methodology

Status: **IMPLEMENTED** · engine `severity-ceiling-astar` v0.1.0
(`python-services/env_data/route_optimizer.py`)

Decision support only. The optimizer proposes and explains alternatives; the
operator decides. It never controls the vessel.

## Design rule — no invented numbers

Most route optimizers blend distance and risk into one cost function
(`cost = distance + λ·risk`). That λ is an arbitrary tuning constant with no
physical or published basis, so we do not use one. Instead:

**Each profile is a pure shortest path, subject to a severity ceiling** — the
maximum risk-engine severity the profile is willing to transit. Profiles
differ only by *which cells they refuse to enter*, a categorical decision
anchored in IMO guidance, not a numeric weight.

| Profile | Ceiling | Refuses | Anchor |
|---|---|---|---|
| DIRECT | HIGH | CRITICAL cells only | POLARIS "special consideration" operation; berg core zones |
| BALANCED | MEDIUM | + HIGH cells | MSC.1/Circ.1519 §1.4.5: voyage planning should avoid elevated-risk areas; berg P50 zones |
| CONSERVATIVE | LOW | + MEDIUM cells | zero elevated hazard of any kind; adds berg P90 zones, light icing |

The severity surface is exactly the one produced by the navigation risk
engine (`docs/risk-methodology.md`) — POLARIS RIO, Overland icing, empirical
berg hazard zones, worst-of combination. The optimizer adds no new hazard
judgement of its own.

## Algorithm

- A\* over the 8-connected risk grid (0.5°×0.25° cells, ~14×28 km), edge
  weight = great-circle distance between cell centres, admissible
  great-circle heuristic → provably shortest path within the ceiling.
- Origin/destination are snapped to the nearest transitable cell. If the
  approach legs to the true endpoints cross cells above the ceiling, the
  route carries an explicit note quantifying that exposure — it is never
  hidden.
- If no continuous corridor exists at a ceiling, the profile is returned as
  `INFEASIBLE` with the reason. It is **not** silently relaxed. (E.g. for a
  PC7 vessel in September pack ice, BALANCED and CONSERVATIVE are honestly
  infeasible; only DIRECT — mostly at HIGH severity — exists.)
- Geometry is simplified with Douglas–Peucker (8 km tolerance) for display;
  distance/time are computed on the raw cell path before simplification.

## Metrics — what is and is not reported

| Metric | Basis |
|---|---|
| Distance | Haversine sum along the cell path |
| Estimated time | Cruise speed (operator input) in normal-operation cells; **POLARIS Table 1.2 recommended speed limits** in elevated-risk (HIGH) cells: PC1 11 kn, PC2 8 kn, PC3–PC5 5 kn, below PC5 3 kn. CRITICAL cells are never transited. |
| Risk / hazard exposure | Full `route_risk()` assessment of the generated geometry — same engine, same numbers as everywhere else |
| **Fuel** | **NOT COMPUTED.** No validated fuel-consumption model for this vessel exists in the system. Reporting a number would require inventing a burn rate, which violates the data-honesty rule. The response says this explicitly (`fuelEstimate: null` + `fuelNote`). The DEMO scenario's fuel figures are labelled SAMPLE DATA and are never mixed with this engine's output. |

## Recommendation rule (documented, deterministic)

1. Among feasible routes with **zero HIGH/CRITICAL exposure**, recommend the
   shortest-time one (MSC.1/Circ.1519 §1.4.5).
2. If none qualifies, recommend the route minimising HIGH+CRITICAL exposure
   and state that operator judgement is required.
3. If nothing is feasible at any ceiling, say so.

The reason string always quantifies the trade-off versus alternatives
(added nm / h vs. eliminated elevated-severity exposure).

## API

- `POST /ml/routes/optimize` (Python :8100) — body
  `{origin:{lat,lon}, destination:{lat,lon}, iceClass?, cruiseSpeedKn?, horizonH?}`,
  horizons 0/24/48/72 h (forecast surfaces use the backtested sea-ice model).
- `GET /ml/routes/profiles` — profile catalog.
- `POST /api/routes/optimize`, `GET /api/routes/profiles` (Node :8200) —
  application pass-through used by the frontend.

Errors: `BAD_ENDPOINT`, `UNKNOWN_ICE_CLASS`, `UNSUPPORTED_HORIZON`,
`BAD_SPEED` (422, `{detail:{code,message}}`).

## Known limitations (declared)

- Grid resolution ~14×28 km: routes are corridor-level guidance, not a
  nautical chart product; final track selection is the navigator's.
- The time model applies POLARIS speed limits per cell severity; it does not
  model weather routing, currents, or ice drift during transit.
- Berg hazard zones assume the ≥10 nm USNIC catalog; smaller bergs and
  growlers are not charted (inherited from the risk engine).
- Endpoints inside excluded cells produce approach-leg exposure above the
  profile ceiling; this is quantified in `notes`, never hidden.

## References

- IMO MSC.1/Circ.1519 — POLARIS: RIO methodology; Table 1.2 recommended
  speed limits; §1.4.5 voyage-planning guidance.
- Hart, Nilsson & Raphael (1968) — A* optimality with admissible heuristics.
- Douglas & Peucker (1973) — line simplification.
- Risk surface: see `docs/risk-methodology.md` and its references
  (POLARIS, Overland 1990, BYU/NIC databases).
