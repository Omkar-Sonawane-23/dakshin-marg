# Offline Mode — POLARIS-X

## Modes
- **CONNECTED** — all services reachable, latest products shown.
- **DEGRADED** — one or more feeds failed; cached products shown, provenance badges show cached age, warnings emitted, confidence reduced.
- **OFFLINE** — no network; pre-staged tiles/SIC/bergs/routes from `data/normalized/` and IndexedDB cache remain usable. Banner: “OFFLINE — Data as of <timestamp>”.

## What Is Cached
- Map vector (Antarctica coastline + shelves) — bundled in `frontend/src/assets/antarctica.json`
- SIC grids (8 days), berg CSV + tracks, weather hourly series (264 h), bathymetry static
- Mission docs and route plans (file + Mongo)
- Frontend shell and 3D assets (service-worker ready)

## Behavior When Stale
Thresholds configurable per source (default: FRESH <36 h, AGING <72 h, STALE <120 h, UNUSABLE beyond). Stale → visual state changes (amber/red badge), confidence downgraded, route confidence banner, warning alert. UNUSABLE → route recommendation disabled.

## Sync
On reconnect, `If-Modified-Since` revalidation; conflicts flagged (e.g., mission edits offline vs server). Deduplication by (id, validTime); out-of-order events ordered by ingestion timestamp.

## Demo
Scenario panel → “Go offline” toggle, or kill Python service: TopBar turns DEGRADED, provenance badges switch to “LIVE FEED UNAVAILABLE — NO DATA SHOWN”, DEMO mode continues unaffected.
