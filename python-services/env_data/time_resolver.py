"""Environmental time resolution — maps a requested mission datetime onto
the data that ACTUALLY exists in the normalized store.

HONESTY RULES (same as everywhere else in this package):
  · A mission datetime is never silently substituted. The resolver returns
    exactly which dataset valid-times were selected and how far they are
    from the request, and refuses (OUT_OF_RANGE) when the request falls
    outside the real availability window.
  · Sea ice resolves to the NEAREST available valid time among the daily
    observations (12:00 UTC) and the validated forecast horizons
    (+24/48/72 h from the latest observation). Nothing in between exists.
  · Weather resolves to the exact hour when available (hourly series).
  · Iceberg positions are a single-epoch product (current USNIC chart).
    For historical mission dates the resolver discloses that berg
    positions for that date are NOT available.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from .config import NORM_DIR

FORECAST_HORIZONS = (24, 48, 72)


def _parse_iso(s: str) -> datetime:
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def availability() -> dict:
    """The real availability window, computed from the normalized store."""
    day_files = sorted(NORM_DIR.glob("seaice_*.json"))
    if not day_files:
        raise FileNotFoundError("no normalized sea-ice observations")
    obs_days = [p.stem.split("_")[1] for p in day_files]           # YYYYMMDD
    obs_valid = [datetime.strptime(d, "%Y%m%d").replace(
        hour=12, tzinfo=timezone.utc) for d in obs_days]
    latest_obs = obs_valid[-1]

    wx = json.loads((NORM_DIR / "weather.json").read_text())
    wx_times: list[str] = wx["temporal"]["times"]                  # hourly
    now_hour: str = wx["temporal"]["nowHour"]
    wx_start, wx_end = _parse_iso(wx_times[0]), _parse_iso(wx_times[-1])

    fc_valid = [latest_obs + timedelta(hours=h) for h in FORECAST_HORIZONS]

    window_start = max(wx_start, obs_valid[0] - timedelta(hours=12))
    window_end = min(fc_valid[-1], wx_end)

    return {
        "window": {"start": _iso(window_start), "end": _iso(window_end)},
        "seaIce": {
            "observationDays": obs_days,
            "observationValidTimes": [_iso(t) for t in obs_valid],
            "latestObservation": _iso(latest_obs),
            "forecastHorizonsH": list(FORECAST_HORIZONS),
            "forecastValidTimes": [_iso(t) for t in fc_valid],
        },
        "weather": {
            "firstHour": wx_times[0],
            "lastHour": wx_times[-1],
            "nowHour": now_hour,
            "hourCount": len(wx_times),
        },
        "icebergs": {
            "note": "USNIC chart is a single-epoch product — berg positions "
                    "are only available for the current chart date; "
                    "historical mission dates reuse it with a disclosed "
                    "limitation warning.",
        },
        "note": "Window = intersection of real dataset coverage. Requests "
                "outside it are refused, never silently substituted.",
    }


def resolve(when_iso: str) -> dict:
    """Resolve a mission datetime to concrete dataset selections.

    Returns {"status": "OK", ...selection...} or
            {"status": "OUT_OF_RANGE", "message", "window"}.
    """
    av = availability()
    try:
        when = _parse_iso(when_iso)
    except ValueError:
        return {
            "status": "BAD_TIME",
            "message": f"'{when_iso}' is not a valid ISO-8601 datetime.",
            "window": av["window"],
        }
    ws = _parse_iso(av["window"]["start"])
    we = _parse_iso(av["window"]["end"])
    if not (ws <= when <= we):
        return {
            "status": "OUT_OF_RANGE",
            "requested": _iso(when),
            "window": av["window"],
            "message": (
                "Environmental data is unavailable for this date. "
                f"Available range: {av['window']['start']} to "
                f"{av['window']['end']} (UTC)."
            ),
        }

    notes: list[str] = []

    # ── weather: exact hour (floor), guaranteed inside range by window ──
    weather_hour = when.strftime("%Y-%m-%dT%H:00")
    wx_first, wx_last = av["weather"]["firstHour"], av["weather"]["lastHour"]
    if weather_hour < wx_first:
        weather_hour = wx_first
        notes.append(f"Weather clamped to first available hour {wx_first}Z.")
    if weather_hour > wx_last:
        weather_hour = wx_last
        notes.append(f"Weather clamped to last available hour {wx_last}Z.")
    weather_kind = ("FORECAST" if weather_hour > av["weather"]["nowHour"]
                    else "OBSERVED_ARCHIVE")

    # ── sea ice: nearest available valid time (obs days + forecast) ──
    candidates: list[tuple[datetime, str, str | int]] = []
    for d, t in zip(av["seaIce"]["observationDays"],
                    av["seaIce"]["observationValidTimes"]):
        candidates.append((_parse_iso(t), "OBSERVATION", d))
    for h, t in zip(av["seaIce"]["forecastHorizonsH"],
                    av["seaIce"]["forecastValidTimes"]):
        candidates.append((_parse_iso(t), "FORECAST", h))
    # nearest; ties prefer observation (listed first, stable min)
    best_t, best_kind, best_sel = min(
        candidates, key=lambda c: abs((c[0] - when).total_seconds()))
    delta_h = (when - best_t).total_seconds() / 3600.0

    sel: dict = {
        "status": "OK",
        "requested": _iso(when),
        "weatherHour": weather_hour,
        "weatherKind": weather_kind,
        "seaIceKind": best_kind,
        "seaIceValidTime": _iso(best_t),
        "seaIceDeltaH": round(delta_h, 1),
        "window": av["window"],
    }
    latest_obs = _parse_iso(av["seaIce"]["latestObservation"])
    if best_kind == "OBSERVATION":
        sel["seaIceDay"] = best_sel                     # YYYYMMDD
        sel["horizonH"] = 0
        notes.append(
            f"Sea ice resolved to the nearest available daily observation "
            f"({sel['seaIceValidTime']}, {abs(delta_h):.0f} h "
            f"{'before' if delta_h > 0 else 'after'} the requested time — "
            f"daily product, 12:00 UTC valid time).")
        if best_sel != av["seaIce"]["observationDays"][-1]:
            notes.append(
                "HISTORICAL mission time: iceberg hazard zones still use the "
                "current USNIC chart — berg positions for this date are not "
                "available (single-epoch product).")
    else:
        sel["seaIceDay"] = None
        sel["horizonH"] = int(best_sel)
        notes.append(
            f"Sea ice resolved to the validated +{best_sel} h forecast "
            f"(valid {sel['seaIceValidTime']}, "
            f"{abs(delta_h):.0f} h from the requested time). Forecasts exist "
            f"only at +24/48/72 h from the latest observation "
            f"({_iso(latest_obs)}).")

    sel["notes"] = notes
    return sel
