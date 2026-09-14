# Data Sources — Dakshin Marg

| Domain | Source | Product | Provenance | Latency | CRS | Notes |
|---|---|---|---|---|---|---|
| Sea ice | NSIDC | Sea Ice Index v4 GeoTIFF | REAL_OBSERVATION | ~1 day | EPSG:3031 → 4326 | Daily concentration 25 km |
| Icebergs | USNIC | Antarctic Iceberg CSV (weekly) | REAL_OBSERVATION | ~7 days | 4326 | Named bergs >10 nm |
| Tracks | BYU/NIC | Consolidated DB v8 (archived) | REAL_HISTORICAL | months | 4326 | 7 738 obs, 17 in AOI |
| Weather | Open-Meteo | Global hourly (ECMWF) | REAL_HISTORICAL / REAL_FORECAST split at nowHour | 1 h | 4326 | 264 h window |
| Bathymetry | IBCSO v2 / GEBCO | Static grid | REAL_OBSERVATION | static | 3031 | 500 m, clipped to AOI |
| Coastline | Natural Earth 50m + SCAR ADD | Vector | REAL_OBSERVATION | static | 4326 | Ice shelves included |
| Missions | Local file / MongoDB | Mission docs | — | immediate | 4326 | Operator-created |

## Synthetic Labels
The DEMO scenario generator is entirely SIMULATED and labelled as such end-to-end. The re-planning drill injects ONE simulated berg re-sighting; all numbers thereafter are from real engines.

## Ingestion
`python -m env_data.ingest` → validate (range, CRS, temporal, units) → normalize to common 0.5° grid → store in `data/normalized/*.json` with metadata in `data/metadata/*.json`. FastAPI serves with `?time=` and `?bbox=` filtering and provenance envelopes.
