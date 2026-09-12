# POLARIS-X — Sea-Ice Intelligence Pipeline (ML)

**Status: IMPLEMENTED (first iteration) · Last updated 2026-09-02**
Code: `python-services/env_data/seaice_forecast.py` · API: `GET /ml/sea-ice/forecast`

```
RAW DATA → VALIDATION → PREPROCESSING → NORMALIZATION → MODEL
        → FORECAST → UNCERTAINTY/QUALITY METADATA → API OUTPUT → MAP
```

---

## 1. Data inspection (done BEFORE model selection)

| Property | Finding |
|---|---|
| Format | Normalized JSON grids (from real NSIDC GeoTIFFs, see data-pipeline.md) |
| Spatial resolution | 0.5°×0.25° display grid (~23×28 km at 65°S; native product 25 km) |
| Temporal resolution | Daily; **8 days available** (2026-08-25 … 09-01) |
| Missing values | 28.3 % of cells masked (land/coast); mask identical on all days; no intermittent gaps |
| Target variable | Sea-ice concentration % (0–98), zero-inflated: 46 % open water |
| Dynamics | Median \|Δ\|/day 0.4 %, mean 2.5 %, p95 10.8 % — slow edge advance, activity concentrated at the ice edge |
| Supportable horizon | ≤ 72 h (an 8-day window cannot justify more) |

## 2. Model choice — driven by the data

With **n = 8 samples per cell**, anything with more than ~1 parameter per cell
is unjustifiable. Deep learning was **explicitly rejected** (cannot train or
validate honestly on 8 samples).

| Model | Definition |
|---|---|
| `seaice-persistence` (baseline) | f(T+h) = y(T) |
| `seaice-damped-trend` v0.1.0 | f(T+h) = y(T) + slope·Σφᵏ, per-cell OLS slope over trailing 6 days, damping φ = 0.75, clipped to [0,100] |

**Selection is empirical, not assumed:** a walk-forward backtest runs on every
forecast; if the trend model does not beat persistence on held-out days, the
API serves persistence instead.

## 3. Validation (walk-forward backtest on real held-out days)

Train on days 1..k, predict k+1..k+3, for all valid k (results 2026-09-02):

| Model | +24 h MAE | +48 h MAE | +72 h MAE |
|---|---|---|---|
| persistence | 2.64 % | 4.24 % | 5.30 % |
| **damped-trend (selected)** | **2.54 %** | **4.04 %** | **4.72 %** |

Honest caveats (returned as `warnings` in every response):
- 8-day history → 3/2/1 folds per horizon: metrics are *indicative*, not a
  climatological validation.
- The passive-microwave product itself has coastal/thin-ice biases.

## 4. Uncertainty

Per-cell 1σ = √h × cell's own historical daily volatility, floored by the
backtest MAE at that horizon — fully empirical, no assumed distributions.
Served as a full `sigmaGrid` + summary stats; rendered as the violet
uncertainty layer on the map (visibly concentrated along the active ice edge).

## 5. API contract

`GET /ml/sea-ice/forecast?horizon_h={24|48|72}&bbox=…`
- Refuses unsupported horizons with `UNSUPPORTED_HORIZON` (422) and an
  explanation — per constitution §Screen-2 ("only expose horizons actually
  supported").
- Response: forecast grid + sigmaGrid + stats + full validation metrics +
  model metadata (name, version, baseline, selection method, damping,
  training window) + temporal block (baseTime/validTime/horizonH) +
  provenance `MODEL_FORECAST` with `inputProvenance: REAL_OBSERVATION`.
- Cached in-process per horizon; invalidated when a newer observation day is ingested.

## 6. Map integration

LIVE mode → Sea Ice card → `OBS | +24H | +48H | +72H` selector:
- Forecast renders with the same concentration ramp; badge switches to violet
  `MODEL · FORECAST · ICE +48H → 2026-09-03`.
- σ toggle swaps the layer to the uncertainty ramp
  (`FORECAST UNCERTAINTY σ` badge).
- Panel shows valid time, mean concentration, mean σ, backtest MAE + fold
  count, and the model-selection note.
- Selecting an observation day exits forecast view — observed and forecast
  ice are never shown simultaneously.

## 7. Roadmap

- Longer archives (NSIDC has decades) → seasonal/climatology features,
  advection from wind forcing, and eventually learned spatiotemporal models —
  each step gated by the same backtest-beats-baseline rule.
- Forecast fields feed the navigation risk engine (next phase).
