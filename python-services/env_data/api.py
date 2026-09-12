"""POLARIS-X environmental data API (FastAPI).

Serves the NORMALIZED datasets with:
  · provenance on every response (REAL_OBSERVATION / REAL_HISTORICAL /
    REAL_FORECAST — SIMULATED never originates here)
  · temporal selection (?time= ISO date/hour)
  · geographic filtering (?bbox=lonMin,latMin,lonMax,latMax)
  · dataset metadata endpoints

Run:  uvicorn env_data.api:app --host 0.0.0.0 --port 8100
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import META_DIR, NORM_DIR, SOURCES
from .seaice_forecast import HORIZONS_H, run_forecast
from .iceberg_track import build_tracks, validate_tracker
from .iceberg_trajectory import predict_all
from .replan_drill import run_drill
from .risk_engine import RIV_TABLE, route_risk, spatial_risk
from .route_optimizer import PROFILES, optimize
from .time_resolver import availability as env_availability, resolve as resolve_time

app = FastAPI(title="POLARIS-X Environmental Data API", version="0.6.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # prototype; tighten for deployment
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _load(name: str) -> dict:
    p = NORM_DIR / name
    if not p.exists():
        raise HTTPException(503, detail={
            "code": "DATASET_UNAVAILABLE",
            "message": f"Normalized dataset '{name}' not present. "
                       f"Run ingestion: python -m env_data.ingest",
        })
    return json.loads(p.read_text())


def _meta(name: str) -> dict:
    p = META_DIR / f"{name}.json"
    return json.loads(p.read_text()) if p.exists() else {}


def _parse_bbox(bbox: str | None):
    if not bbox:
        return None
    try:
        lon_min, lat_min, lon_max, lat_max = (float(x) for x in bbox.split(","))
        return lon_min, lat_min, lon_max, lat_max
    except ValueError:
        raise HTTPException(400, detail={
            "code": "BAD_BBOX",
            "message": "bbox must be lonMin,latMin,lonMax,latMax",
        })


def _envelope(data: dict, provenance: str, temporal: dict, source: dict,
              quality: str = "ok", warnings: list | None = None) -> dict:
    return {
        "data": data,
        "meta": {
            "provenance": provenance,
            "temporal": temporal,
            "source": source,
            "quality": quality,
            "warnings": warnings or [],
            "servedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    }


# ── health & catalog ───────────────────────────────────────────────────

@app.get("/env/health")
def health():
    days = _meta("seaice").get("days", [])
    return {
        "status": "ok",
        "datasets": {
            "seaice": {"days": len(days),
                        "latest": days[0]["validTime"] if days else None},
            "icebergs": _meta("icebergs").get("counts"),
            "weather": {"hours": _meta("weather").get("hours"),
                         "nowHour": _meta("weather").get("nowHour")},
        },
    }


@app.get("/env/sources")
def sources():
    """Dataset catalog: provider, provenance, license, ingestion metadata."""
    return {
        "sources": list(SOURCES.values()),
        "ingestion": {k: _meta(k) for k in ("seaice", "icebergs", "weather")},
    }


# ── sea ice ────────────────────────────────────────────────────────────

@app.get("/env/sea-ice/times")
def seaice_times():
    days = _meta("seaice").get("days", [])
    return {"times": [d["validTime"] for d in days],
            "provenance": "REAL_OBSERVATION"}


@app.get("/env/sea-ice")
def seaice(time: str | None = Query(None, description="ISO date, e.g. 2026-09-01"),
           bbox: str | None = Query(None)):
    days = _meta("seaice").get("days", [])
    if not days:
        raise HTTPException(503, detail={
            "code": "SEA_ICE_UNAVAILABLE",
            "message": "No validated sea-ice days ingested. Last ingest failed "
                       "or has not run.",
        })
    chosen = None
    if time:
        for d in days:
            if d["validTime"].startswith(time[:10]):
                chosen = d
                break
        if not chosen:
            raise HTTPException(404, detail={
                "code": "SEA_ICE_DATE_MISSING",
                "message": f"No sea-ice grid for {time[:10]}. "
                           f"Available: {days[-1]['validTime'][:10]} … "
                           f"{days[0]['validTime'][:10]}.",
            })
    else:
        chosen = days[0]  # latest

    ymd = chosen["datasetId"].split("_")[1]
    doc = _load(f"seaice_{ymd}.json")
    grid = doc["grid"]

    box = _parse_bbox(bbox)
    if box:
        lon_min, lat_min, lon_max, lat_max = box
        i0 = max(0, int((lon_min - grid["lon0"]) / grid["dLon"]))
        i1 = min(grid["nLon"], int((lon_max - grid["lon0"]) / grid["dLon"]) + 1)
        j0 = max(0, int((lat_min - grid["lat0"]) / grid["dLat"]))
        j1 = min(grid["nLat"], int((lat_max - grid["lat0"]) / grid["dLat"]) + 1)
        if i1 <= i0 or j1 <= j0:
            raise HTTPException(404, detail={
                "code": "BBOX_OUTSIDE_COVERAGE",
                "message": "Requested bbox does not intersect dataset coverage "
                           "(AOI 40–100°E, 72–55°S).",
            })
        grid = {
            **grid,
            "lon0": grid["lon0"] + i0 * grid["dLon"],
            "lat0": grid["lat0"] + j0 * grid["dLat"],
            "nLon": i1 - i0, "nLat": j1 - j0,
            "values": [row[i0:i1] for row in grid["values"][j0:j1]],
        }

    return _envelope(
        {"grid": grid, "stats": chosen["stats"]},
        provenance=doc["provenance"],
        temporal=doc["temporal"],
        source=doc["source"],
        quality=chosen["quality"],
        warnings=chosen["warnings"],
    )


# ── sea-ice forecast (ML pipeline) ─────────────────────────────────────

_forecast_cache: dict = {}


@app.get("/ml/sea-ice/forecast")
def seaice_forecast(horizon_h: int = Query(48, description="Forecast horizon: 24, 48 or 72"),
                    bbox: str | None = Query(None)):
    """Sea-ice concentration forecast from the damped-trend model.

    The model is re-selected against a persistence baseline by walk-forward
    backtest on every run; the losing model is never served. Uncertainty is
    empirical (backtest MAE + per-cell volatility)."""
    if horizon_h not in HORIZONS_H:
        raise HTTPException(422, detail={
            "code": "UNSUPPORTED_HORIZON",
            "message": f"Horizon {horizon_h} h is not supported. The "
                       f"{len(HORIZONS_H)} supported horizons are "
                       f"{sorted(HORIZONS_H)} — longer horizons are refused "
                       f"because the observation window is only ~8 days.",
        })

    cache_key = horizon_h
    latest = (_meta("seaice").get("days") or [{}])[0].get("validTime", "")
    cached = _forecast_cache.get(cache_key)
    if cached and cached["_base"] == latest:
        result = cached["_result"]
    else:
        try:
            result = run_forecast(horizon_h)
        except (RuntimeError, ValueError) as e:
            raise HTTPException(503, detail={
                "code": "FORECAST_UNAVAILABLE",
                "message": f"Sea-ice forecast could not be produced: {e}",
            })
        _forecast_cache[cache_key] = {"_base": latest, "_result": result}

    grid = result["grid"]
    sigma = result["uncertainty"]["sigmaGrid"]
    box = _parse_bbox(bbox)
    if box:
        lon_min, lat_min, lon_max, lat_max = box
        i0 = max(0, int((lon_min - grid["lon0"]) / grid["dLon"]))
        i1 = min(grid["nLon"], int((lon_max - grid["lon0"]) / grid["dLon"]) + 1)
        j0 = max(0, int((lat_min - grid["lat0"]) / grid["dLat"]))
        j1 = min(grid["nLat"], int((lat_max - grid["lat0"]) / grid["dLat"]) + 1)
        if i1 <= i0 or j1 <= j0:
            raise HTTPException(404, detail={
                "code": "BBOX_OUTSIDE_COVERAGE",
                "message": "Requested bbox does not intersect forecast coverage.",
            })
        grid = {**grid,
                "lon0": grid["lon0"] + i0 * grid["dLon"],
                "lat0": grid["lat0"] + j0 * grid["dLat"],
                "nLon": i1 - i0, "nLat": j1 - j0,
                "values": [row[i0:i1] for row in grid["values"][j0:j1]]}
        sigma = [row[i0:i1] for row in sigma[j0:j1]]

    return {
        "data": {
            "grid": grid,
            "sigmaGrid": sigma,
            "stats": result["stats"],
            "uncertainty": {k: v for k, v in result["uncertainty"].items()
                            if k != "sigmaGrid"},
            "validation": result["validation"],
            "inputDates": result["inputDates"],
        },
        "meta": {
            "provenance": "MODEL_FORECAST",
            "inputProvenance": result["inputProvenance"],
            "temporal": result["temporal"],
            "model": result["model"],
            "source": {
                "id": "seaice_forecast",
                "name": "POLARIS-X sea-ice damped-trend forecast",
                "provider": "POLARIS-X ML service",
                "url": "internal:/ml/sea-ice/forecast",
            },
            "quality": "ok",
            "warnings": result["validation"]["notes"],
            "servedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    }


@app.get("/ml/sea-ice/forecast/horizons")
def seaice_forecast_horizons():
    return {"horizons": sorted(HORIZONS_H),
            "note": "Only horizons supported by the implemented model are exposed."}


# ── icebergs ───────────────────────────────────────────────────────────

@app.get("/env/icebergs")
def icebergs(bbox: str | None = Query(None),
             min_length_nm: float = Query(0.0)):
    doc = _load("icebergs.json")
    bergs = doc["icebergs"]
    box = _parse_bbox(bbox)
    if box:
        lon_min, lat_min, lon_max, lat_max = box
        bergs = [b for b in bergs
                 if lon_min <= b["lon"] <= lon_max
                 and lat_min <= b["lat"] <= lat_max]
    if min_length_nm > 0:
        bergs = [b for b in bergs if (b.get("length_nm") or 0) >= min_length_nm]
    m = _meta("icebergs")
    return _envelope(
        {"icebergs": bergs, "count": len(bergs),
         "productNote": doc["notes"]},
        provenance=doc["provenance"],
        temporal=doc["temporal"],
        source=doc["source"],
        quality=m.get("quality", "ok"),
        warnings=m.get("warnings", []),
    )


# ── iceberg capabilities: detection / tracking / trajectory ───────────
# Three SEPARATE capabilities. Detection produces object records; tracking
# associates records over time into tracks; trajectory prediction extrapolates
# tracks with an uncertainty corridor. Each is validated independently.

@app.get("/ml/icebergs/detections")
def iceberg_detections():
    """CAPABILITY 1 — detection. Object records + detector validation."""
    doc = _load("iceberg_detections.json")
    return _envelope(
        doc,
        provenance="MIXED",   # per-item provenance inside; see notes
        temporal={"executedAt": doc.get("executedAt")},
        source={"detector": doc.get("model")},
        warnings=["Scene-based detections are SIMULATED (no free SAR feed); "
                  "USNIC records are REAL analyst detections. Provenance is "
                  "labelled per record — never mixed silently."],
    )


@app.get("/ml/icebergs/tracks")
def iceberg_tracks():
    """CAPABILITY 2 — tracking. Temporal association into per-berg tracks."""
    doc = build_tracks()
    return _envelope(
        {"tracks": doc["tracks"], "count": len(doc["tracks"]),
         "tracker": doc["tracker"]},
        provenance=doc["provenance"],
        temporal={"latestObs": max(t["last"] for t in doc["tracks"]),
                  "ingestedAt": doc["ingestedAt"]},
        source=doc["source"],
        warnings=["BYU/NIC database lags real time; latest observation may be "
                  "months old — see per-track 'last'."],
    )


@app.get("/ml/icebergs/tracks/validation")
def iceberg_tracks_validation():
    """Independent tracker validation: identity-stripped re-association."""
    return validate_tracker()


_traj_cache: dict = {}


def _trajectories_cached() -> dict:
    """predict_all() backtests on every call (~1 s); cache per input mtime."""
    key = (NORM_DIR / "iceberg_tracks.json").stat().st_mtime
    if _traj_cache.get("key") != key:
        _traj_cache["key"] = key
        _traj_cache["doc"] = predict_all()
    return _traj_cache["doc"]


@app.get("/ml/icebergs/trajectories")
def iceberg_trajectories():
    """CAPABILITY 3 — trajectory prediction with empirical uncertainty corridor."""
    doc = _trajectories_cached()
    return _envelope(
        {"predictions": doc["predictions"], "model": doc["model"],
         "validation": doc["validation"]},
        provenance=doc["provenance"],
        temporal={"executedAt": doc["executedAt"]},
        source={"input": "iceberg_tracks_byu_v8",
                "inputProvenance": doc["inputProvenance"]},
        warnings=doc["warnings"],
    )


# ── navigation risk engine ─────────────────────────────────────────────
# POLARIS (IMO MSC.1/Circ.1519) + Overland (1990) icing + empirical iceberg
# hazard zones. See docs/risk-methodology.md. No invented thresholds.

RISK_HORIZONS = (0, 24, 48, 72)
_risk_cache: dict = {}


def _validate_risk_params(ice_class: str, horizon_h: int):
    if ice_class not in RIV_TABLE:
        raise HTTPException(422, detail={
            "code": "UNKNOWN_ICE_CLASS",
            "message": f"ice_class must be one of {sorted(RIV_TABLE)}",
        })
    if horizon_h not in RISK_HORIZONS:
        raise HTTPException(422, detail={
            "code": "UNSUPPORTED_HORIZON",
            "message": f"horizon_h must be one of {RISK_HORIZONS} "
                       f"(0 = latest observation; others use the validated "
                       f"sea-ice forecast).",
        })


@app.get("/ml/risk/spatial")
def risk_spatial(ice_class: str = Query("PC5"),
                 horizon_h: int = Query(0)):
    _validate_risk_params(ice_class, horizon_h)
    key = (ice_class, horizon_h,
           max(p.stat().st_mtime for p in NORM_DIR.glob("*.json")))
    if _risk_cache.get("key") != key:
        _risk_cache["key"] = key
        _risk_cache["doc"] = spatial_risk(ice_class=ice_class,
                                          horizon_h=horizon_h)
    doc = _risk_cache["doc"]
    return _envelope(
        doc,
        provenance="MODEL_FORECAST" if horizon_h > 0 else "DERIVED_FROM_OBSERVATION",
        temporal={"horizonH": horizon_h, "seaIce": doc["inputs"]["seaIce"],
                  "weatherHour": doc["inputs"]["weather"]["validHour"]},
        source={"methodology": "docs/risk-methodology.md",
                "engine": doc["engine"]},
        warnings=doc["warnings"],
    )


@app.post("/ml/risk/route")
def risk_route(body: dict):
    wps = body.get("waypoints")
    if not isinstance(wps, list) or len(wps) < 2 or not all(
            isinstance(w, dict) and "lat" in w and "lon" in w for w in wps):
        raise HTTPException(422, detail={
            "code": "BAD_WAYPOINTS",
            "message": "body.waypoints must be [{lat, lon}, ...] with >= 2 points",
        })
    ice_class = body.get("iceClass", "PC5")
    horizon_h = int(body.get("horizonH", 0))
    _validate_risk_params(ice_class, horizon_h)
    seaice_day, weather_hour, resolution = None, None, None
    if body.get("missionTime"):
        resolution = resolve_time(str(body["missionTime"]))
        if resolution["status"] != "OK":
            raise HTTPException(422, detail={
                "code": "TIME_" + resolution["status"],
                "message": resolution.get("message", "unresolvable time"),
                "window": resolution.get("window"),
            })
        seaice_day = resolution["seaIceDay"]
        horizon_h = resolution["horizonH"]
        weather_hour = resolution["weatherHour"]
    overrides = body.get("bergOverrides") or None
    doc = route_risk(wps, ice_class=ice_class, horizon_h=horizon_h,
                     berg_overrides=overrides,
                     seaice_day=seaice_day, weather_hour=weather_hour)
    temporal = {"horizonH": horizon_h, "seaIce": doc["inputs"]["seaIce"],
                "weatherHour": doc["inputs"]["weather"]["validHour"]}
    if resolution:
        temporal["timeResolution"] = resolution
    return _envelope(
        doc,
        provenance="MODEL_FORECAST" if horizon_h > 0 else "DERIVED_FROM_OBSERVATION",
        temporal=temporal,
        source={"methodology": "docs/risk-methodology.md",
                "engine": doc["engine"]},
        warnings=doc["warnings"],
    )


@app.get("/ml/risk/catalog")
def risk_catalog():
    return {
        "iceClasses": sorted(RIV_TABLE),
        "horizons": list(RISK_HORIZONS),
        "severityScale": ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        "methodology": {
            "seaIce": "IMO POLARIS RIO (MSC.1/Circ.1519)",
            "icing": "Overland (1990) NOAA vessel-icing predictor",
            "icebergs": "empirical hazard zones from backtested drift-error quantiles",
            "combination": "worst-of (max) across contributors — no weighted sums",
            "doc": "docs/risk-methodology.md",
        },
    }


# ── route optimization ─────────────────────────────────────────────────
# Severity-ceiling shortest paths on the risk surface. Profiles are category
# exclusions (no weighted cost blending). See docs/route-optimization.md.

@app.post("/ml/routes/optimize")
def routes_optimize(body: dict):
    for key in ("origin", "destination"):
        p = body.get(key)
        if not (isinstance(p, dict) and "lat" in p and "lon" in p):
            raise HTTPException(422, detail={
                "code": "BAD_ENDPOINT",
                "message": f"body.{key} must be {{lat, lon}}",
            })
    ice_class = body.get("iceClass", "PC5")
    horizon_h = int(body.get("horizonH", 0))
    cruise = float(body.get("cruiseSpeedKn", 12.5))
    if ice_class not in RIV_TABLE:
        raise HTTPException(422, detail={
            "code": "UNKNOWN_ICE_CLASS",
            "message": f"iceClass must be one of {sorted(RIV_TABLE)}",
        })
    if horizon_h not in (0, 24, 48, 72):
        raise HTTPException(422, detail={
            "code": "UNSUPPORTED_HORIZON",
            "message": "horizonH must be 0, 24, 48 or 72",
        })
    if not (3.0 <= cruise <= 30.0):
        raise HTTPException(422, detail={
            "code": "BAD_SPEED",
            "message": "cruiseSpeedKn must be between 3 and 30",
        })

    # ── mission-time pinning (optional) ──
    # `missionTime` (ISO) resolves through the time resolver to concrete
    # dataset selections; refused outside the real availability window.
    seaice_day, weather_hour, resolution = None, None, None
    if body.get("missionTime"):
        resolution = resolve_time(str(body["missionTime"]))
        if resolution["status"] != "OK":
            raise HTTPException(422, detail={
                "code": "TIME_" + resolution["status"],
                "message": resolution.get("message", "unresolvable time"),
                "window": resolution.get("window"),
            })
        seaice_day = resolution["seaIceDay"]
        horizon_h = resolution["horizonH"]
        weather_hour = resolution["weatherHour"]

    # `bergOverrides` injects SIMULATED berg-state deviations (mission
    # replan what-ifs). The risk engine flags them and always emits a
    # warning — simulated state is never silent.
    overrides = body.get("bergOverrides") or None

    doc = optimize(body["origin"], body["destination"],
                   ice_class=ice_class, cruise_speed_kn=cruise,
                   horizon_h=horizon_h, berg_overrides=overrides,
                   seaice_day=seaice_day, weather_hour=weather_hour)
    temporal = {"horizonH": horizon_h,
                "seaIce": doc["riskSurface"]["seaIce"],
                "weatherHour": doc["riskSurface"]["weatherHour"]}
    if resolution:
        temporal["timeResolution"] = resolution
    return _envelope(
        doc,
        provenance="MODEL_FORECAST" if horizon_h > 0 else "DERIVED_FROM_OBSERVATION",
        temporal=temporal,
        source={"methodology": "docs/route-optimization.md",
                "optimizer": doc["optimizer"]},
        warnings=doc["warnings"],
    )


# ── environmental time resolution (mission planning) ───────────────────
# The availability window is computed from the normalized store — never a
# hardcoded range. Out-of-range requests are refused, not substituted.

@app.get("/env/availability")
def env_avail():
    return env_availability()


@app.get("/env/time/resolve")
def env_time_resolve(when: str = Query(...)):
    res = resolve_time(when)
    if res["status"] == "BAD_TIME":
        raise HTTPException(422, detail={
            "code": "BAD_TIME", "message": res["message"]})
    return res


@app.get("/ml/routes/profiles")
def routes_profiles():
    return {"profiles": PROFILES,
            "note": "Profiles are severity-ceiling exclusions on the risk "
                    "surface; there is no weighted cost function."}


# ── dynamic re-planning drill (deterministic simulation) ───────────────
# One SIMULATED fact (D23 re-sighting) injected into otherwise-real engines.
# The full timeline is precomputed and served whole; the frontend steps
# through it under operator control. See docs/replanning-drill.md.

@app.get("/ml/routes/replan-drill")
def routes_replan_drill():
    doc = run_drill()
    return _envelope(
        doc,
        provenance="SIMULATED",
        temporal={"simTimeline": [s["simTime"] for s in doc["stages"]]},
        source={"methodology": "docs/replanning-drill.md",
                "drill": doc["drill"]},
        warnings=doc["warnings"],
    )


# ── weather ────────────────────────────────────────────────────────────

@app.get("/env/weather/times")
def weather_times():
    doc = _load("weather.json")
    now_hour = doc["temporal"]["nowHour"]
    return {
        "times": doc["temporal"]["times"],
        "nowHour": now_hour,
        "provenanceRule": {"before": "REAL_HISTORICAL", "atOrAfter": "REAL_FORECAST"},
    }


@app.get("/env/weather")
def weather(time: str | None = Query(None, description="ISO hour, e.g. 2026-09-02T12:00"),
            bbox: str | None = Query(None)):
    doc = _load("weather.json")
    times = doc["temporal"]["times"]
    now_hour = doc["temporal"]["nowHour"]

    t = time or now_hour
    # snap to nearest available hour
    if t in times:
        idx = times.index(t)
    else:
        try:
            target = datetime.fromisoformat(t)
        except ValueError:
            raise HTTPException(400, detail={
                "code": "BAD_TIME", "message": f"Unparseable time '{time}'."})
        idx = min(range(len(times)),
                  key=lambda i: abs((datetime.fromisoformat(times[i]) - target)
                                    .total_seconds()))
    hour = times[idx]
    provenance = "REAL_HISTORICAL" if hour < now_hour else "REAL_FORECAST"

    cells = doc["cells"]
    box = _parse_bbox(bbox)
    if box:
        lon_min, lat_min, lon_max, lat_max = box
        cells = [c for c in cells
                 if lon_min <= c["lon"] <= lon_max
                 and lat_min <= c["lat"] <= lat_max]

    out_cells = []
    for c in cells:
        ws = c["wind_speed_kn"][idx]
        wd = c["wind_dir_deg"][idx]
        tc = c["temp_c"][idx]
        if ws is None:
            continue
        out_cells.append({"lat": c["lat"], "lon": c["lon"],
                          "windSpeedKn": ws, "windDirDeg": wd, "tempC": tc})

    speeds = [c["windSpeedKn"] for c in out_cells]
    m = _meta("weather")
    return _envelope(
        {
            "cells": out_cells,
            "summary": {
                "maxWindKn": max(speeds) if speeds else None,
                "meanWindKn": round(sum(speeds) / len(speeds), 1) if speeds else None,
                "minTempC": min(c["tempC"] for c in out_cells) if out_cells else None,
            },
            "hour": hour,
            "hourIndex": idx,
            "availableHours": len(times),
        },
        provenance=provenance,
        temporal={"kind": "HOUR", "validTime": hour + ":00Z", "nowHour": now_hour},
        source=doc["source"],
        quality=m.get("quality", "ok"),
        warnings=m.get("warnings", []),
    )
