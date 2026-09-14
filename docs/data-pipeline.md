# Dakshin Marg — Environmental Data Pipeline

**Status: IMPLEMENTED (first iteration) · Last updated 2026-09-02**

```
DATA SOURCE → INGESTION → VALIDATION → NORMALIZATION → API → MAP
```

Code: `python-services/env_data/` (config, ingest, validation, api) →
`frontend/src/api/envClient.ts` → `frontend/src/state/envStore.tsx` → map layers.

---

## 1. Real data sources (verified reachable & ingested)

| Layer | Product | Provider | Provenance | Cadence | Native CRS |
|-------|---------|----------|------------|---------|-----------|
| Sea ice | Sea Ice Index v4 (G02135) daily concentration GeoTIFF, southern hemisphere | NSIDC / NOAA | `REAL_OBSERVATION` | daily (~1 day latency) | EPSG:3031, 25 km |
| Icebergs | Antarctic iceberg positions CSV (named bergs ≥ 10 nm) | U.S. National Ice Center | `REAL_OBSERVATION` | weekly analyst analysis | EPSG:4326 |
| Weather | 10 m wind + 2 m temperature, hourly; `past_days` archive + 3-day forecast | Open-Meteo | `REAL_HISTORICAL` (hours before ingest) / `REAL_FORECAST` (after) | hourly | EPSG:4326 |

**Known product limitations (documented, shown in UI):**
- NSIDC concentration is passive-microwave at 25 km — coastal/mixed pixels are
  masked; it is an *observation*, not a forecast.
- USNIC tracks only large named icebergs. Smaller bergs/growlers are absent —
  this is precisely why the (planned) SAR detection service matters.
- Open-Meteo global model is not a polar-optimized model; treated as indicative.

## 2. Pipeline stages

### INGESTION (`env_data/ingest.py`)
- Sea ice: downloads last ~8 daily GeoTIFFs (raw files kept in `data/real/`).
- Icebergs: downloads current USNIC CSV (raw kept).
- Weather: one gridded multi-point request over the AOI (84 cells, 5°×2.5°),
  264 hourly steps (8 past days + 3 forecast days). Raw JSON kept.
- Re-run anytime: `cd python-services && python -m env_data.ingest`

### VALIDATION (`env_data/validation.py`)
- Sea ice: grid-size check, concentration range 0–100 %, no-data fraction.
- Icebergs: coordinate presence/range (drops bad rows, keeps report), size sanity.
- Weather: hour-count consistency, wind range sanity (>130 kn flagged).
- Outcomes: `ok` / `degraded` (served with warnings) / `rejected` (never served).

### NORMALIZATION
- Sea ice: EPSG:3031 raster sampled onto a regular lon/lat grid over the AOI
  (0.5° × 0.25°, ~5.9 k cells), units percent, no-data −1. Nearest-cell sampling
  — adequate at display scale; bilinear upgrade noted as future work.
- Icebergs: typed records (id, lon/lat, length/width nm, area km², analysis date).
- Weather: km/h→kn conversion done by provider request; per-cell hourly series.
- Everything stored as JSON in `data/normalized/`, metadata in `data/metadata/`.

### API (`env_data/api.py`, FastAPI, port 8100, proxied at `/env`)
| Endpoint | Function |
|----------|----------|
| `GET /env/health` | dataset freshness summary |
| `GET /env/sources` | catalog: provider, provenance, license, ingestion metadata |
| `GET /env/sea-ice?time=&bbox=` | one observation day, geographically cropped |
| `GET /env/sea-ice/times` | available observation days |
| `GET /env/icebergs?bbox=&min_length_nm=` | filtered berg positions |
| `GET /env/weather?time=&bbox=` | one hour of wind/temp, snapped to nearest available |
| `GET /env/weather/times` | available hours + archive/forecast split |

Every response envelope carries `meta`: provenance, temporal validity, source
attribution, quality status, warnings, servedAt. Errors are operator-meaningful
(`SEA_ICE_DATE_MISSING`, `BBOX_OUTSIDE_COVERAGE`, …).

### MAP
- **LIVE mode** switch in the top bar (DEMO ⇄ LIVE).
- Sea-ice concentration canvas layer + observation-day slider (8 real days).
- USNIC bergs drawn as green **square-diamond glyphs** — deliberately distinct
  from the amber/white triangles used for simulated bergs.
- Wind vectors with hour slider spanning archive → forecast; the provenance
  badge flips REAL·HISTORICAL ⇄ REAL·FORECAST live with the slider.
- Geographic filtering: all requests carry the AOI bbox; API crops server-side.

## 3. Real vs simulated — separation guarantees

1. Separate stores (`envStore` vs demo `store`) — no shared objects.
2. Separate glyphs and colors on the map.
3. Provenance badge component (`ProvBadge`) rendered on every live panel;
   `SIMULATED` badges throughout demo mode.
4. LIVE mode hides demo routes/trajectories/risk/timeline entirely rather than
   overlaying them on real data (until real-data-driven engines exist).
5. The Python service cannot emit `SIMULATED` provenance at all.

## 4. Current limitations / next steps

- Ingestion is manual/on-demand; a scheduler (cron) is future work.
- Sea-ice nearest-cell sampling → bilinear; NIC berg *history* (BYU/NIC archive)
  would enable real trajectory fitting — planned for the tracking phase.
- Node.js application API will front these services for missions/routes; the
  browser currently talks to the env API directly via dev-server proxy (documented).
- LIVE mode is an environmental *watch* view — routing/risk against real data
  arrives with the risk-engine phase.
