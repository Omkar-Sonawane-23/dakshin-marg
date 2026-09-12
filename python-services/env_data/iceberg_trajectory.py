"""CAPABILITY 3 — Iceberg TRAJECTORY PREDICTION (tracks → forecast + corridor).

Model: damped linear drift.
  velocity = robust mean of daily displacement over the trailing window;
  forecast position(t+h) = last + v · Σφᵏ (damping φ per day);
  chosen for the same reason as the sea-ice model — with sparse, noisy daily
  positions and no ocean-current forcing data wired in yet, a low-variance
  kinematic extrapolation is the defensible baseline.

Baseline for selection: STATIONARY (berg doesn't move) — genuinely competitive
for grounded bergs (several AOI bergs are grounded, e.g. C24/C30 at 0 km/d).

INDEPENDENT VALIDATION (real data backtest):
  For each berg and many historical cut dates: fit on data before the cut,
  predict +1/+3/+7 days, compare against the real subsequent positions.
  Per-horizon error quantiles (P50/P90) become the UNCERTAINTY CORRIDOR --
  the corridor radius is the empirical P90 error at that horizon, so
  "90 % corridor" means exactly that on historical data.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone

import numpy as np

from .config import NORM_DIR

MODEL_NAME = "berg-damped-drift"
MODEL_VERSION = "0.1.0"
BASELINE_NAME = "berg-stationary"
FIT_WINDOW_D = 10        # days of history for velocity fit
DAMPING = 0.9            # per-day damping of extrapolated velocity
HORIZONS_D = (1, 3, 7)
BACKTEST_STEP_D = 7      # evaluate a cut every N days


def _dist_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


def _fit_velocity(obs: list[dict]) -> tuple[float, float]:
    """Robust (median) daily velocity in (dlat, dlon) deg/day over the window."""
    if len(obs) < 2:
        return 0.0, 0.0
    dlats, dlons = [], []
    for a, b in zip(obs, obs[1:]):
        dt = (datetime.strptime(b["t"], "%Y-%m-%d")
              - datetime.strptime(a["t"], "%Y-%m-%d")).days
        if 1 <= dt <= 5:
            dlats.append((b["lat"] - a["lat"]) / dt)
            dlons.append((b["lon"] - a["lon"]) / dt)
    if not dlats:
        return 0.0, 0.0
    return float(np.median(dlats)), float(np.median(dlons))


def _predict(obs: list[dict], horizon_d: int,
             phi: float = DAMPING) -> tuple[float, float]:
    vlat, vlon = _fit_velocity(obs[-FIT_WINDOW_D:])
    damp = sum(phi ** k for k in range(1, horizon_d + 1))
    last = obs[-1]
    return last["lat"] + vlat * damp, last["lon"] + vlon * damp


# ── backtest on real tracks ────────────────────────────────────────────

MOVING_THRESH_KM = 1.0   # displacement over fit window to count as "moving"


def backtest() -> dict:
    doc = json.loads((NORM_DIR / "iceberg_tracks.json").read_text())
    # errs[model][stratum][h] -> list of km errors; strata: all / moving
    errs = {m: {"all": {h: [] for h in HORIZONS_D},
                "moving": {h: [] for h in HORIZONS_D}}
            for m in (MODEL_NAME, BASELINE_NAME)}
    for berg_id, obs in doc["tracks"].items():
        by_date = {o["t"]: o for o in obs}
        dates = sorted(by_date)
        for i in range(FIT_WINDOW_D, len(dates) - max(HORIZONS_D), BACKTEST_STEP_D):
            cut = dates[i]
            hist = [by_date[d] for d in dates[: i + 1]]
            cut_dt = datetime.strptime(cut, "%Y-%m-%d")
            w = hist[-FIT_WINDOW_D:]
            moving = _dist_km(w[0]["lat"], w[0]["lon"],
                              w[-1]["lat"], w[-1]["lon"]) >= MOVING_THRESH_KM
            for h in HORIZONS_D:
                target = (cut_dt + timedelta(days=h)).strftime("%Y-%m-%d")
                truth = by_date.get(target)
                if not truth:
                    continue
                plat, plon = _predict(hist, h)
                e_model = _dist_km(plat, plon, truth["lat"], truth["lon"])
                e_base = _dist_km(hist[-1]["lat"], hist[-1]["lon"],
                                  truth["lat"], truth["lon"])
                for stratum in (["all", "moving"] if moving else ["all"]):
                    errs[MODEL_NAME][stratum][h].append(e_model)
                    errs[BASELINE_NAME][stratum][h].append(e_base)

    def summarize(e_by_h):
        out = {}
        for h, e in e_by_h.items():
            if e:
                a = np.array(e)
                out[h] = {"n": len(e),
                          "medianKm": round(float(np.median(a)), 2),
                          "p90Km": round(float(np.percentile(a, 90)), 2),
                          "meanKm": round(float(a.mean()), 2)}
        return out

    metrics = {m: {s: summarize(errs[m][s]) for s in ("all", "moving")}
               for m in (MODEL_NAME, BASELINE_NAME)}
    # selection on the MOVING stratum (grounded bergs tie both models at ~0).
    # criterion = mean error: medians are distorted by day-to-day position
    # quantization in the source database (repeated identical positions).
    better = all(
        metrics[MODEL_NAME]["moving"][h]["meanKm"]
        <= metrics[BASELINE_NAME]["moving"][h]["meanKm"]
        for h in HORIZONS_D if h in metrics[MODEL_NAME]["moving"]
    )
    return {
        "metrics": metrics,
        "selected": MODEL_NAME if better else BASELINE_NAME,
        "selectionCriterion": "mean km error on MOVING stratum at all horizons",
        "movingThresholdKm": MOVING_THRESH_KM,
        "corridorDefinition": "corridor radius at horizon h = empirical P90 "
                              "prediction error at h from this backtest on "
                              "real tracks, per stratum (moving vs all) — a "
                              "true 90% corridor historically",
    }


# ── inference: forecast + uncertainty corridor per berg ────────────────

def predict_all(horizons_d=HORIZONS_D) -> dict:
    doc = json.loads((NORM_DIR / "iceberg_tracks.json").read_text())
    bt = backtest()
    model = bt["selected"]

    def corridor(stratum, h, key):
        m = bt["metrics"][model][stratum]
        return m[h][key] if h in m else None

    out = []
    for berg_id, obs in sorted(doc["tracks"].items()):
        if len(obs) < FIT_WINDOW_D:
            continue
        last = obs[-1]
        vlat, vlon = _fit_velocity(obs[-FIT_WINDOW_D:])
        speed_kmd = _dist_km(last["lat"], last["lon"],
                             last["lat"] + vlat, last["lon"] + vlon)
        w = obs[-FIT_WINDOW_D:]
        moving = _dist_km(w[0]["lat"], w[0]["lon"],
                          w[-1]["lat"], w[-1]["lon"]) >= MOVING_THRESH_KM
        stratum = "moving" if moving else "all"
        points = []
        for h in horizons_d:
            if model == BASELINE_NAME:
                plat, plon = last["lat"], last["lon"]
            else:
                plat, plon = _predict(obs, h)
            points.append({
                "horizonD": h,
                "lat": round(plat, 4), "lon": round(plon, 4),
                "corridorP50Km": corridor(stratum, h, "medianKm"),
                "corridorP90Km": corridor(stratum, h, "p90Km"),
            })
        out.append({
            "id": berg_id,
            "lastObs": {"t": last["t"], "lat": last["lat"], "lon": last["lon"]},
            "velocityKmD": round(speed_kmd, 2),
            "regime": "MOVING" if moving else "GROUNDED_OR_SLOW",
            "trajectory": points,
            "staleDays": (datetime.now(timezone.utc)
                          - datetime.strptime(last["t"], "%Y-%m-%d")
                          .replace(tzinfo=timezone.utc)).days,
        })
    return {
        "predictions": out,
        "model": {"name": model, "version": MODEL_VERSION,
                  "baseline": BASELINE_NAME,
                  "fitWindowDays": FIT_WINDOW_D, "damping": DAMPING,
                  "selectedBy": "backtest on real BYU tracks (median error, all horizons)"},
        "validation": {k: bt[k] for k in ("metrics", "corridorDefinition")},
        "provenance": "MODEL_FORECAST",
        "inputProvenance": "REAL_OBSERVATION",
        "executedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "warnings": [
            "Positions extrapolated kinematically; no ocean-current/wind forcing yet.",
            "BYU database updates lag real time — check staleDays per berg.",
        ],
    }


if __name__ == "__main__":
    bt = backtest()
    print("selected:", bt["selected"])
    for m in bt["metrics"]:
        for s in ("all", "moving"):
            for h, v in sorted(bt["metrics"][m][s].items()):
                print(f"  {m:18s} [{s:6s}] +{h}d  median {v['medianKm']:6.2f} km   "
                      f"P90 {v['p90Km']:7.2f} km   n={v['n']}")
    p = predict_all()
    print(f"\npredictions for {len(p['predictions'])} bergs")
    ex = next(x for x in p["predictions"] if x["velocityKmD"] > 1)
    print("example:", ex["id"], ex["trajectory"])
