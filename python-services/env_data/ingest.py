"""Ingestion + normalization for the three real sources.

Pipeline per dataset:   SOURCE → INGEST (raw file kept) → VALIDATE →
NORMALIZE (common lon/lat grids, SI-ish units) → STORE (JSON + metadata)

Run directly:  python -m env_data.ingest
"""

from __future__ import annotations

import csv
import io
import json
import math
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

from .config import (
    AOI, META_DIR, NORM_DIR, RAW_DIR, SEAICE_DAYS_BACK, SEAICE_DLAT,
    SEAICE_DLON, SOURCES, WEATHER_FORECAST_DAYS, WEATHER_PAST_DAYS,
    WX_DLAT, WX_DLON,
)
from .validation import validate_icebergs, validate_seaice_grid, validate_weather

UA = {"User-Agent": "DakshinMarg-prototype/0.1 (SIH research demo)"}


def _get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _write_meta(dataset_id: str, meta: dict) -> None:
    (META_DIR / f"{dataset_id}.json").write_text(json.dumps(meta, indent=2))


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ══════════════════════════════════════════════════════════════════════
# 1. SEA ICE — NSIDC Sea Ice Index v4 daily concentration GeoTIFF
# ══════════════════════════════════════════════════════════════════════

def ingest_seaice() -> list[dict]:
    """Download recent daily rasters, normalize each to a lon/lat grid over AOI."""
    import numpy as np
    import rasterio
    from pyproj import Transformer

    src = SOURCES["seaice_nsidc"]
    results = []
    today = datetime.now(timezone.utc).date()
    tried = 0
    day = today
    while len(results) < SEAICE_DAYS_BACK and tried < SEAICE_DAYS_BACK + 6:
        tried += 1
        day = day - timedelta(days=1)
        ymd = day.strftime("%Y%m%d")
        month_dir = day.strftime("%m_%b")
        url = f"{src['url']}{day.year}/{month_dir}/S_{ymd}_concentration_v4.0.tif"
        raw_path = RAW_DIR / f"seaice_S_{ymd}_concentration_v4.0.tif"
        try:
            if not raw_path.exists():
                raw_path.write_bytes(_get(url))
        except Exception as e:  # missing day (latency) — skip
            print(f"  seaice {ymd}: unavailable ({e})", file=sys.stderr)
            continue

        # normalize: sample EPSG:3031 raster onto regular lon/lat grid
        n_lon = int((AOI["lon_max"] - AOI["lon_min"]) / SEAICE_DLON)
        n_lat = int((AOI["lat_max"] - AOI["lat_min"]) / SEAICE_DLAT)
        lons = [AOI["lon_min"] + (i + 0.5) * SEAICE_DLON for i in range(n_lon)]
        lats = [AOI["lat_min"] + (j + 0.5) * SEAICE_DLAT for j in range(n_lat)]

        with rasterio.open(raw_path) as ds:
            tr = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)
            band = ds.read(1)
            values: list[float] = []
            for lat in lats:
                for lon in lons:
                    x, y = tr.transform(lon, lat)
                    try:
                        r, c = ds.index(x, y)
                    except Exception:
                        values.append(-1.0)
                        continue
                    if 0 <= r < band.shape[0] and 0 <= c < band.shape[1]:
                        v = float(band[r, c])
                        # v4 GeoTIFF: 0–1000 = conc*10; >1000 = mask (land etc.)
                        values.append(round(v / 10.0, 1) if 0 <= v <= 1000 else -1.0)
                    else:
                        values.append(-1.0)

        report = validate_seaice_grid(values, n_lon * n_lat)
        if not report.ok:
            print(f"  seaice {ymd}: REJECTED {report.errors}", file=sys.stderr)
            continue

        grid_doc = {
            "datasetId": f"seaice_{ymd}",
            "provenance": src["provenance"],
            "temporal": {"kind": "OBSERVATION", "validTime": f"{day}T12:00:00Z"},
            "source": {k: src[k] for k in ("id", "name", "provider", "url")},
            "grid": {
                "lon0": AOI["lon_min"] + SEAICE_DLON / 2,
                "lat0": AOI["lat_min"] + SEAICE_DLAT / 2,
                "dLon": SEAICE_DLON, "dLat": SEAICE_DLAT,
                "nLon": n_lon, "nLat": n_lat,
                "values": [values[j * n_lon:(j + 1) * n_lon] for j in range(n_lat)],
                "noData": -1.0,
                "units": "percent_concentration",
            },
        }
        (NORM_DIR / f"seaice_{ymd}.json").write_text(json.dumps(grid_doc))
        valid = [v for v in values if v >= 0]
        results.append({
            "datasetId": f"seaice_{ymd}",
            "validTime": f"{day}T12:00:00Z",
            "quality": report.quality_status,
            "warnings": report.warnings,
            "stats": {
                "validCells": len(valid),
                "meanConcPct": round(sum(valid) / len(valid), 1) if valid else None,
                "maxConcPct": max(valid) if valid else None,
            },
        })
        print(f"  seaice {ymd}: ok ({len(valid)} cells, mean "
              f"{results[-1]['stats']['meanConcPct']}%)")

    meta = {
        "sourceId": src["id"], "provenance": src["provenance"],
        "ingestedAt": _now(), "crsNormalized": "EPSG:4326",
        "spatialCoverage": AOI, "days": results,
        "processingStatus": "normalized" if results else "failed",
    }
    _write_meta("seaice", meta)
    return results


# ══════════════════════════════════════════════════════════════════════
# 2. ICEBERGS — USNIC Antarctic iceberg positions CSV
# ══════════════════════════════════════════════════════════════════════

def ingest_icebergs() -> dict:
    src = SOURCES["icebergs_nic"]
    raw = _get(src["url"], timeout=60)
    raw_path = RAW_DIR / "icebergs_nic_current.csv"
    raw_path.write_bytes(raw)

    rows: list[dict] = []
    last_update_max = None
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    for rec in reader:
        def num(key):
            try:
                return float(rec[key])
            except (KeyError, TypeError, ValueError):
                return None
        upd = (rec.get("Last Update") or "").strip()
        try:
            upd_iso = datetime.strptime(upd, "%m/%d/%Y").strftime("%Y-%m-%d")
        except ValueError:
            upd_iso = None
        if upd_iso and (last_update_max is None or upd_iso > last_update_max):
            last_update_max = upd_iso
        rows.append({
            "id": (rec.get("Iceberg") or "").strip(),
            "lat": num("Latitude"), "lon": num("Longitude"),
            "length_nm": num("Length (NM)"), "width_nm": num("Width (NM)"),
            "area_km2": num("Area (sqKM)"), "last_update": upd_iso,
        })

    report = validate_icebergs(rows)
    if not report.ok:
        raise RuntimeError(f"iceberg ingest rejected: {report.errors}")
    kept = [r for r in rows if not r.get("_drop")]

    in_aoi = [r for r in kept
              if AOI["lon_min"] <= r["lon"] <= AOI["lon_max"]
              and AOI["lat_min"] <= r["lat"] <= AOI["lat_max"]]

    doc = {
        "datasetId": "icebergs_nic_current",
        "provenance": src["provenance"],
        "temporal": {"kind": "OBSERVATION", "validTime": last_update_max},
        "source": {k: src[k] for k in ("id", "name", "provider", "url")},
        "notes": src["notes"],
        "icebergs": kept,
    }
    (NORM_DIR / "icebergs.json").write_text(json.dumps(doc))
    meta = {
        "sourceId": src["id"], "provenance": src["provenance"],
        "ingestedAt": _now(), "validTime": last_update_max,
        "quality": report.quality_status, "warnings": report.warnings,
        "counts": {"total": len(kept), "inAOI": len(in_aoi)},
        "processingStatus": "normalized",
    }
    _write_meta("icebergs", meta)
    print(f"  icebergs: {len(kept)} named bergs "
          f"({len(in_aoi)} in AOI), analysis date {last_update_max}")
    return meta


# ══════════════════════════════════════════════════════════════════════
# 3. WEATHER — Open-Meteo wind/temperature grid over AOI
# ══════════════════════════════════════════════════════════════════════

def ingest_weather() -> dict:
    src = SOURCES["weather_openmeteo"]
    lats, lons = [], []
    lat = AOI["lat_min"] + WX_DLAT / 2
    while lat < AOI["lat_max"]:
        lon = AOI["lon_min"] + WX_DLON / 2
        while lon < AOI["lon_max"]:
            lats.append(round(lat, 2)); lons.append(round(lon, 2))
            lon += WX_DLON
        lat += WX_DLAT

    url = (f"{src['url']}?latitude={','.join(map(str, lats))}"
           f"&longitude={','.join(map(str, lons))}"
           f"&hourly=wind_speed_10m,wind_direction_10m,temperature_2m"
           f"&past_days={WEATHER_PAST_DAYS}&forecast_days={WEATHER_FORECAST_DAYS}"
           f"&timezone=UTC&wind_speed_unit=kn")
    raw = _get(url, timeout=90)
    (RAW_DIR / "weather_openmeteo.json").write_bytes(raw)
    payload = json.loads(raw)
    if isinstance(payload, dict):
        payload = [payload]

    times = payload[0]["hourly"]["time"]
    cells = []
    for p in payload:
        h = p["hourly"]
        cells.append({
            "lat": p["latitude"], "lon": p["longitude"],
            "wind_speed_kn": h["wind_speed_10m"],
            "wind_dir_deg": h["wind_direction_10m"],
            "temp_c": h["temperature_2m"],
        })

    report = validate_weather(cells, len(times))
    if not report.ok:
        raise RuntimeError(f"weather ingest rejected: {report.errors}")

    # split-point between archive (REAL_HISTORICAL) and forecast (REAL_FORECAST)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00")
    doc = {
        "datasetId": "weather_openmeteo_current",
        "provenance": "MIXED_SEE_HOURS",  # per-hour kind resolved by API
        "temporal": {
            "kind": "TIMESERIES", "times": times, "nowHour": now_iso,
        },
        "source": {k: src[k] for k in ("id", "name", "provider", "url")},
        "cells": cells,
    }
    (NORM_DIR / "weather.json").write_text(json.dumps(doc))
    meta = {
        "sourceId": src["id"], "ingestedAt": _now(),
        "quality": report.quality_status, "warnings": report.warnings,
        "hours": len(times), "cells": len(cells), "nowHour": now_iso,
        "provenanceRule": "hour < nowHour → REAL_HISTORICAL else REAL_FORECAST",
        "processingStatus": "normalized",
    }
    _write_meta("weather", meta)
    print(f"  weather: {len(cells)} cells × {len(times)} h "
          f"(archive+forecast, split at {now_iso}Z)")
    return meta


if __name__ == "__main__":
    print("Dakshin Marg environmental ingestion")
    print("== sea ice (NSIDC) ==");   ingest_seaice()
    print("== icebergs (USNIC) =="); ingest_icebergs()
    print("== weather (Open-Meteo) =="); ingest_weather()
    print("done.")
