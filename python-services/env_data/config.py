"""Dakshin Marg environmental data layer — configuration & source registry.

Every dataset flowing through this package carries explicit provenance:
  REAL_OBSERVATION  – measured/analysed product from a real provider
  REAL_FORECAST     – numerical forecast from a real provider
  REAL_HISTORICAL   – archived model analysis from a real provider
  SIMULATED         – deterministic demo generator (never produced here;
                      the frontend demo adapter is the only simulated source)

Real and simulated data are NEVER mixed silently: provenance travels with
every API response down to the map badge.
"""

from __future__ import annotations

from pathlib import Path

# ── storage layout ─────────────────────────────────────────────────────
# data/real/…        raw downloads exactly as received
# data/normalized/…  normalized JSON grids/collections served by the API
# data/metadata/…    one metadata record per dataset version

DATA_ROOT = Path(__file__).resolve().parents[2] / "data"
RAW_DIR = DATA_ROOT / "real"
NORM_DIR = DATA_ROOT / "normalized"
META_DIR = DATA_ROOT / "metadata"

for _d in (RAW_DIR, NORM_DIR, META_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── area of interest (mission corridor, East Antarctica / Prydz Bay) ───
AOI = {
    "lon_min": 40.0,
    "lat_min": -72.0,
    "lon_max": 100.0,
    "lat_max": -55.0,
}

# Normalized sea-ice grid resolution (degrees)
SEAICE_DLON = 0.5
SEAICE_DLAT = 0.25

# Weather sampling grid resolution (degrees)
WX_DLON = 5.0
WX_DLAT = 2.5

# ── source registry ────────────────────────────────────────────────────

SOURCES = {
    "seaice_nsidc": {
        "id": "seaice_nsidc",
        "name": "NSIDC Sea Ice Index v4 (G02135), daily concentration, south",
        "provider": "NSIDC / NOAA",
        "url": "https://noaadata.apps.nsidc.org/NOAA/G02135/south/daily/geotiff/",
        "provenance": "REAL_OBSERVATION",
        "cadence": "daily",
        "crs": "EPSG:3031",
        "license": "NOAA open data",
        "notes": "Passive-microwave derived concentration, 25 km grid; "
                 "published with ~1 day latency.",
    },
    "icebergs_nic": {
        "id": "icebergs_nic",
        "name": "U.S. National Ice Center Antarctic Iceberg positions",
        "provider": "USNIC",
        "url": "https://usicecenter.gov/File/DownloadCurrent?pId=134",
        "provenance": "REAL_OBSERVATION",
        "cadence": "weekly",
        "crs": "EPSG:4326",
        "license": "US Government open data",
        "notes": "Named icebergs ≥10 nm; analyst-tracked from satellite imagery. "
                 "Smaller bergs are NOT in this product.",
    },
    "weather_openmeteo": {
        "id": "weather_openmeteo",
        "name": "Open-Meteo global model wind/temperature",
        "provider": "Open-Meteo",
        "url": "https://api.open-meteo.com/v1/forecast",
        "provenance": "REAL_FORECAST",  # past hours are REAL_HISTORICAL
        "cadence": "hourly",
        "crs": "EPSG:4326",
        "license": "CC-BY 4.0 / open API",
        "notes": "10 m wind + 2 m temperature; past_days served from model "
                 "archive (labelled REAL_HISTORICAL).",
    },
}

SEAICE_DAYS_BACK = 8      # try to ingest this many recent daily rasters
WEATHER_PAST_DAYS = 8     # archived hours to request
WEATHER_FORECAST_DAYS = 3 # forecast hours to request
