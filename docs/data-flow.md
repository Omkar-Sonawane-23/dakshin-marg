# Dakshin Marg — Data Flow

**Status:** Phase 0 baseline · Last updated 2026-09-02

---

## 1. Canonical Pipeline

```
SOURCE → INGEST → VALIDATE → NORMALIZE → STORE → PROCESS → MODEL → PUBLISH
```

Every dataset entering the system carries metadata:

| Field             | Notes |
|-------------------|-------|
| source            | provider or `DEMO-SIMULATED` |
| timestamp         | observation/valid time (UTC) |
| spatial_coverage  | CRS + bbox/geometry |
| data_type         | sea_ice_concentration · iceberg_obs · weather · ocean · vessel_state |
| version           | dataset/product version |
| processing_status | raw · validated · normalized · processed |
| quality_status    | ok · degraded · suspect |
| is_simulated      | boolean — NEVER silently mixed with real data |

---

## 2. Candidate Data Sources (to be finalized when the data phase begins)

| Domain | Real-data candidates (public) | Demo fallback |
|--------|-------------------------------|---------------|
| Sea-ice concentration | NSIDC passive microwave products; OSI SAF; NOAA/NIC charts | Seeded synthetic concentration fields, labelled SIMULATED |
| Icebergs | BYU/NIC Antarctic iceberg database (large bergs); Sentinel-1 SAR scenes for detection demo | Seeded synthetic berg population, labelled SIMULATED |
| Weather / wind | ERA5 reanalysis subsets; open forecast APIs | Seeded synthetic wind fields |
| Ocean currents | OSCAR / CMEMS subsets | Seeded synthetic current field |
| Vessel | Operator-entered vessel profile | Sample research-vessel profile |

**Rule:** each source above is only marked "used" in docs once actually wired
in. Until then the system runs on clearly-labelled deterministic demo datasets.

---

## 3. Flow per Intelligence Stage

### OBSERVE
```
raster/vector source → Python ingestion → validation (bounds, ranges, CRS)
→ normalization to common grid/CRS → file store (GeoTIFF/NetCDF/Zarr)
→ metadata record in MongoDB (environment_snapshots)
→ tiled/simplified representation → Node API → map layers
```

### PREDICT
```
normalized history → sea-ice forecast model → forecast grids + uncertainty
iceberg tracks + currents + wind → trajectory model → predicted positions + corridor
→ model_runs metadata (model, version, timestamp, confidence) → Node → UI
```

### ASSESS
```
forecasts + detections + weather + vessel constraints
→ risk engine (documented weighted formula, Python)
→ spatial risk surface + per-cell factor attribution
→ route risk scoring → Node (risk_assessments) → UI risk map + breakdown
```

### OPTIMIZE
```
risk/cost surface + vessel profile + operator preferences
→ graph search (A*/Dijkstra on weighted grid) → N route alternatives
→ per-route: distance, time, fuel estimate (labelled), risk, hazards, rationale
→ Node (routes) → UI comparison
```

### DECIDE
```
recommendation + reasons → operator reviews → approve/override
→ decision recorded (mission_events, audit_logs)
```

### Dynamic re-planning loop
```
new/changed environmental input (real or simulation tick)
→ affected-area detection (spatial intersection with active route corridor)
→ risk recompute for affected missions
→ threshold breached? → alert (reason + recommended action)
→ optional recalculation → before/after comparison → operator decision
```

---

## 4. Antarctic Map Display Strategy

Web-mercator distorts Antarctica badly. Strategy (to validate in Phase 2):

- Preferred: **Antarctic Polar Stereographic (EPSG:3031)** rendering — either
  MapLibre with pre-projected tiles/GeoJSON, or custom projection rendering.
- Fallback: mercator base capped at high southern latitudes with
  polar-stereographic inset, only if 3031 proves impractical in time.
- All stored geometry remains WGS84 (EPSG:4326); projection is a display concern.
- Decision will be recorded here once benchmarked.

---

## 5. Storage Rules

- MongoDB: domain objects + metadata + point/small-vector geospatial data
  (2dsphere indexes). Never large rasters.
- Filesystem/object store: rasters (GeoTIFF/NetCDF/Zarr), referenced by
  metadata documents.
- Large layers reach the browser as tiles or simplified/decimated
  vectors — never raw multi-MB rasters.
