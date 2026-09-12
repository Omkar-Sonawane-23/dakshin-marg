# Navigation Risk Methodology

Status: **IMPLEMENTED** (engine `polaris-overland-risk v0.1.0`,
`python-services/env_data/risk_engine.py`).

## 0. Design rule — no invented numbers

Every threshold in the engine traces to one of three origins:

1. **Published, citable standards** — IMO POLARIS and the NOAA/Overland
   icing predictor (§2, §3).
2. **Quantities measured by our own validated backtests** — iceberg
   drift-error quantiles and sea-ice forecast σ (§4, §6).
3. **Declared conventions** — where a mapping or assumption is unavoidable it
   is stated in the response `assumptions` list and in §5/§7 here, with its
   rationale. A convention is not a tuned parameter: nothing in this engine
   was adjusted to make outputs "look right".

There are **no weighted sums** of hazard scores anywhere. Weights would be
arbitrary; instead severity combines as **worst-of (max)** across
contributors — the defensible choice for safety-of-navigation, because a
route that is fine on ice but crosses an iceberg hazard zone is not "half
risky", it is iceberg-risky.

## 1. Inputs

| Input | Source | Provenance |
|---|---|---|
| Sea-ice concentration | NSIDC Sea Ice Index v4 (latest day), or our backtest-validated damped-trend forecast for +24/48/72 h | REAL_OBSERVATION / MODEL_FORECAST |
| Forecast uncertainty σ | per-cell σ grid from the sea-ice forecast pipeline (empirical; floored by backtest MAE) | derived |
| Iceberg positions | USNIC current product (named bergs ≥ 10 nm) | REAL_OBSERVATION |
| Iceberg drift behaviour | BYU/NIC v8 real tracks → moving/grounded regime + backtested drift-error quantiles | REAL_OBSERVATION + backtest |
| Weather | Open-Meteo 10 m wind + 2 m temperature at the evaluation hour | REAL_HISTORICAL / REAL_FORECAST |
| Vessel constraints | ice class (POLARIS RIV row: PC1–PC7, IA Super–IC, NONE) | operator input |

Not available (declared, §7): stage-of-development ice charts, SST, wave
height, bergs < 10 nm.

## 2. Sea-ice contributor — IMO POLARIS (MSC.1/Circ.1519)

POLARIS is the Polar Code's own methodology for exactly this question:
*is this ice regime safe for this ice class?*

- RIO = Σ Cᵢ·RIVᵢ, concentrations in tenths; RIV table taken verbatim from
  MSC.1/Circ.1519 for all 12 ice classes × 12 WMO ice types.
- Categories (published): RIO ≥ 0 normal operation; −10 ≤ RIO < 0 elevated
  operational risk (PC classes; below-PC7 classes go directly to special
  consideration); RIO < −10 operation subject to special consideration.

**Ice-type assumption (declared).** NSIDC provides total concentration, not
stage of development. The engine evaluates a two-component regime — C tenths
of an assumed ice type + (10−C) tenths ice-free — with the type defaulting to
**medium first-year ice** (East Antarctic pack in late winter is predominantly
FY ice of 70–120 cm). Because this is an assumption, every response reports
the worst-cell RIO under the one-step-thinner and one-step-thicker types as a
sensitivity band, and the assumption is listed in `assumptions`.

**Uncertainty propagation.** At forecast horizons the engine re-evaluates each
cell at concentration +1σ. Cells whose POLARIS category flips are flagged
(bit 8 in the flags grid) and counted — the UI can show where the ice-risk
boundary is soft.

## 3. Weather contributor — NOAA/Overland (1990) vessel icing

Sea-spray icing is the dominant weather hazard for polar vessels and has a
published operational predictor (Overland, *Wea. Forecasting* 5:62–77, used
operationally by NOAA):

```
PPR = Va·(Tf − Ta) / (1 + 0.3·(Tw − Tf))      Tf = −1.8 °C (saltwater)
```

Classes at published thresholds: < 22.4 none · 22.4–53.3 light ·
53.3–83.0 moderate · > 83.0 heavy/extreme (m·°C/s).

- **3.1 SST gap (declared):** no SST feed → Tw = Tf, which sets the
  denominator to 1 and *maximises* PPR. Conservative by construction.
- **3.2 Wind chill, visibility etc.** are not separately scored — no published
  vessel-risk scale for them was adopted yet; adding one later is additive.
- **3.3 Spray suppression (declared convention):** the predictor presumes the
  vessel takes spray, which requires waves. Wave growth is damped inside
  consolidated pack. Icing is therefore evaluated only where ice
  concentration < 70 % — the WMO nomenclature boundary between *open pack*
  (4–6/10) and *close pack* (7–10/10). Anchored to WMO terms, not tuned.

## 4. Iceberg contributor — empirical hazard zones

Each USNIC berg defines three nested zones; **all radii are measured, not
chosen**:

| Zone | Radius | Severity |
|---|---|---|
| Core | berg semi-length (USNIC dimensions) | CRITICAL |
| P50 | core + median drift-prediction error at the berg's position age (+ horizon) | HIGH |
| P90 | core + 90th-percentile error, same basis | MEDIUM |

The P50/P90 quantiles come from the walk-forward backtest of the trajectory
module on real BYU tracks (docs/iceberg-pipeline.md §3), using the berg's
regime (MOVING vs grounded) as measured from its real track. So "P90 zone"
means literally: *given how well drift prediction actually performed on real
Antarctic bergs, 90 % of position errors at this lead time were smaller than
this radius.* Position age matters: a berg charted 6 days ago gets the 7-day
quantile, not the 1-day one. Positions older than the longest validated
horizon (7 d) are floored there and flagged in `warnings`.

Charted bergs only (≥ 10 nm). Growlers/bergy bits are in **no** input dataset;
this stated coverage gap appears in `assumptions` on every response.

## 5. Severity scale — documented display convention

The shared scale is LOW / MEDIUM / HIGH / CRITICAL. Each contributor arrives
on its own published/empirical scale; the ordinal mapping is a convention
(the only "free" choice in the engine — it maps categories, it does not
create numbers):

| Severity | POLARIS | Icing (Overland) | Iceberg zone |
|---|---|---|---|
| LOW | normal operation | none | outside all zones |
| MEDIUM | — | light | inside P90 |
| HIGH | elevated operational risk | moderate | inside P50 |
| CRITICAL | special consideration | heavy/extreme | inside core |

POLARIS has three categories, so MEDIUM is never ice-driven; that row is left
empty rather than inventing an intermediate RIO threshold.

**Combination:** cell severity = max(contributors). Cell flags record *which*
contributors are non-LOW (bitmask: 1 ice, 2 berg, 4 icing, 8 σ-sensitive), so
attribution survives the max.

## 6. Route risk

Waypoints are densified to ≤ 15 km steps; each sample is scored exactly like
a grid cell. Outputs:

- **overall** = worst sample severity, with the location, distance-along-route
  and the driver(s) of the worst point;
- **exposure** = % of route length at each severity, per contributor and
  combined (LOW 92.5 % / CRITICAL 7.5 % says more than one number);
- **bergEncounters** = every hazard zone crossed: berg id, worst zone level,
  closest approach, at-route-km, position age;
- **explanations** = plain-language statements, each grounded in the numbers
  above;
- σ-flip count where the POLARIS category is uncertainty-sensitive.

Route geometry is caller input. Assessing it against real data does not make
the geometry real — responses carry `DERIVED_FROM_OBSERVATION` (h = 0) or
`MODEL_FORECAST` (h > 0) provenance.

## 7. Declared assumptions & gaps (returned on every response)

1. Ice type assumed medium first-year (sensitivity band reported).
2. Tw = Tf in the icing predictor (conservative; no SST feed).
3. Icing suppressed in close pack ≥ 70 % (WMO open/close-pack boundary).
4. Berg zone radii validated to 7 days; older positions floored + warned.
5. Only charted bergs ≥ 10 nm; smaller ice absent from all inputs.
6. No wave, current, or visibility contributors yet (no adopted published
   scale) — PLANNED, additive.

## 8. API

| Endpoint | Notes |
|---|---|
| `GET /ml/risk/spatial?ice_class&horizon_h` | severity grid + flags grid + contributors + explanations + assumptions; horizons 0/24/48/72 only |
| `POST /ml/risk/route` `{waypoints, iceClass, horizonH}` | route assessment as in §6 |
| `GET /ml/risk/catalog` | valid ice classes, horizons, methodology summary |
| Node mirrors | `GET /api/risk/spatial`, `POST /api/risk/route`, `GET /api/risk/catalog` |

Errors: `UNKNOWN_ICE_CLASS`, `UNSUPPORTED_HORIZON`, `BAD_WAYPOINTS` (422).

## 9. What the operator sees

The frontend can display, for any cell or route: **overall severity**, **why**
(explanations), **which hazard** (per-contributor severity + flags), and
**what area** (severity grid / zone geometry / worst cells). Everything is
decision support; nothing is autonomous control.

## References

- IMO MSC.1/Circ.1519 — *Guidance on methodologies for assessing operational
  capabilities and limitations in ice* (POLARIS), 2016.
- Overland, J.E., 1990: *Prediction of Vessel Icing for Near-Freezing Sea
  Temperatures.* Weather & Forecasting 5, 62–77.
- WMO No. 259 — *Sea-Ice Nomenclature* (open/close pack definitions).
- POLARIS-X iceberg drift backtest: docs/iceberg-pipeline.md §3.
- POLARIS-X sea-ice forecast σ: docs/ml-pipeline.md.
