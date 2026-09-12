# Iceberg Pipeline — Detection · Tracking · Trajectory Prediction

Status: **IMPLEMENTED** (v0.1) — three **separate** capabilities, each validated
independently, chained per the required pipeline:

```
imagery/data ─▶ DETECTION ─▶ object records ─▶ TEMPORAL ASSOCIATION ─▶ tracks
                                                        │
                                                        ▼
                map ◀─ uncertainty corridor ◀─ TRAJECTORY PREDICTION
```

They are deliberately **not** one model: detection answers "is there a berg in
this data?", tracking answers "which detections are the *same* berg over
time?", prediction answers "where will this berg be tomorrow?". Each has its
own module, its own output artifact, its own validation, and its own API
endpoint, so any stage can be upgraded (e.g. real SAR input, a Kalman tracker,
a current-forced drift model) without touching the others.

---

## Capability 1 — Detection (`env_data/iceberg_detect.py`)

**Detector** `sar-cfar-cc v0.1.0` — CFAR-style adaptive thresholding
(median + 4·1.4826·MAD, robust to the target pixels themselves) followed by
4-connected component extraction, minimum blob 4 px (0.16 km² at 200 m/px).
Confidence from peak contrast above threshold.

**Input honesty.** Free, scriptable SAR imagery is not available
(Copernicus/Sentinel-1 requires authenticated API access), so the detector
runs on:

- a **SIMULATED** SAR-like scene (512×512, 200 m/px, gamma-distributed
  speckle, deterministic seed 20260902) with injected elliptical targets —
  labelled `SIMULATED` end to end; and
- the **REAL** USNIC current-iceberg CSV, whose entries are analyst detections
  from satellite imagery — labelled `REAL_OBSERVATION`.

The two are never mixed silently; every record carries its provenance.

**Independent validation** (against injected ground truth, which includes
sub-resolution and near-noise-floor targets so the score is not saturated):

| Metric | Value |
|---|---|
| Targets injected | 18 (semi-axes 1.2–14 px, amplitude 1.5–12 vs noise μ≈1.25) |
| Precision | 0.944 (1 FP) |
| Recall | 0.944 (1 FN — a near-noise-floor target) |
| Mean position error | 0.34 px ≈ 68 m |

Output: `data/normalized/iceberg_detections.json` → served at
`GET /ml/icebergs/detections`.

## Capability 2 — Tracking / temporal association (`env_data/iceberg_track.py`)

**Associator** `greedy-gated-nn v0.1.0` — day-by-day greedy nearest-neighbour
association with a physical gate (15 km base + 40 km/day × time gap), coasting
through observation gaps up to 21 days, duplicate-in-gate flagging, and new
track spawning for unassociated records.

**Track data (REAL).** BYU/NIC Antarctic iceberg tracking database v8.0
(daily positions, 649 bergs, 1978→2026-04-30; DOI 10.1109/JSTARS.2017.2784186).
Ingested via `iceberg_ingest.py`: 17 AOI bergs, 7 738 daily observations since
2023-09-03, sensor priority nic > ascat > oscat > qscat > sass.

**Independent validation — identity-stripping test on REAL data.** All
(date, lat, lon) observations from the last 365 days are pooled, their berg
identities removed, and the associator rebuilds tracks from scratch. Score =
how well rebuilt tracks match true identities:

| Metric | Value |
|---|---|
| Observations re-associated | 3 315 (17 true bergs) |
| Rebuilt tracks (≥5 obs) | 18 |
| Mean track purity | 0.923 |
| Min track purity | 0.605 (two bergs drifting through the same corridor) |
| Fragmented bergs | 4 |

Served at `GET /ml/icebergs/tracks` (+ `/tracks/validation`).

## Capability 3 — Trajectory prediction (`env_data/iceberg_trajectory.py`)

**Model** `berg-damped-drift v0.1.0` — robust (median) daily velocity over the
trailing 10 observations, extrapolated with per-day damping φ=0.9.
**Baseline** `berg-stationary` — genuinely competitive because several AOI
bergs are grounded (C24, C30, C21B ≈ 0 km/d).

**Independent validation — walk-forward backtest on REAL tracks.** For every
berg and a cut every 7 days: fit on data before the cut, predict +1/+3/+7 d,
compare with the real subsequent positions. Results are stratified because the
"all" stratum is dominated by grounded bergs where both models trivially score 0:

| Stratum MOVING | +1 d | +3 d | +7 d |
|---|---|---|---|
| damped-drift mean error (km) | **5.02** | **7.24** | **12.34** |
| stationary mean error (km) | 5.17 | 8.22 | 14.30 |
| damped-drift P90 (km) | **10.36** | **21.95** | **41.92** |
| stationary P90 (km) | 12.87 | 25.61 | 51.76 |
| n | 333 | 322 | 349 |

Model selection is re-run on every pipeline execution (criterion: mean error
on the moving stratum at all horizons — the median is distorted by repeated
identical positions in the source data).

**Uncertainty corridor = empirical, not assumed.** The corridor radius at
horizon *h* is the **P90 prediction error at h from the backtest** for the
berg's stratum — so "90 % corridor" means exactly that on historical data.
P50 is also served.

Served at `GET /ml/icebergs/trajectories`.

**Known limitations (shown in UI warnings):** kinematic extrapolation only, no
ocean-current/wind forcing yet; the BYU database lags real time (`staleDays`
per berg), while USNIC current positions (2026-08-27) are shown at the markers
— the discrepancy is displayed, never hidden.

---

## Node application API (`backend/`, Express/TS, :8200) — NEW

First real Node backend component (previously PLANNED). Role per architecture:
**orchestration only** — it joins, caches (60 s TTL) and shapes responses; it
never computes science and never alters provenance labels.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | service + Python-dependency health |
| `GET /api/icebergs/detections` | pass-through, capability 1 |
| `GET /api/icebergs/tracks` (+`/validation`) | pass-through, capability 2 |
| `GET /api/icebergs/trajectories` | pass-through, capability 3 |
| `GET /api/icebergs/situation` | **join**: track + prediction + USNIC current position per berg |

Errors use the same `{ detail: { code, message } }` envelope as the Python
service. The Vite dev server proxies `/api` → :8200 (browser code uses
relative URLs only).

## Map & UI

- **Green solid** polyline = observed track (REAL · OBSERVED, BYU/NIC).
- **Violet dashed** polyline + dashed rings = predicted trajectory with P90
  corridor (MODEL · FORECAST) — distinct colour, shape *and* label, never
  colour alone.
- Clicking a USNIC marker (or a berg in the "Berg Tracking & Drift" card)
  focuses that berg and flies the map to it; forecasts are drawn only for
  bergs classified MOVING.
- The panel shows tracked/moving counts, per-berg drift speed and corridor,
  a staleness warning when the track database lags >14 d, and a provenance
  note naming both sources and the validation method.
- Failure of the Node API degrades only this layer (inline error card);
  sea-ice/weather layers are unaffected.

## Roadmap (honest)

- PLANNED: current/wind-forced drift model (needs ocean reanalysis feed).
- PLANNED: real SAR ingestion once authenticated Copernicus access exists.
- PLANNED: Kalman/JPDA tracker upgrade if multiple bergs share a corridor.
