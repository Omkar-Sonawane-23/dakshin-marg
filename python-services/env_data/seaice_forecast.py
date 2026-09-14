"""Dakshin Marg sea-ice intelligence pipeline.

DATA (inspected 2026-09-02 before model selection):
  · 8 daily NSIDC Sea Ice Index v4 observation days (2026-08-25 … 09-01)
  · normalized grid 120×68 (0.5°×0.25°) over AOI 40–100°E / 72–55°S
  · 5 853 valid cells, mask identical across days (land/coast = -1)
  · target: concentration %, 0–98, zero-inflated (46 % open water)
  · dynamics: median |Δ|/day 0.4 %, mean 2.5 % — slow edge advance

MODEL CHOICE (driven by the above):
  With n=8 samples/cell, only very-low-variance estimators are defensible.
  Implemented candidates:
    baseline  PERSISTENCE          f(h) = y[T]
    model     DAMPED LINEAR TREND  f(h) = y[T] + slope·h·φʰ  (per cell,
              OLS slope over the training window, damping φ=0.75,
              clipped to [0,100])
  The served model is selected by BACKTEST — if the trend model does not
  beat persistence on held-out days it is NOT used. Deep learning is
  deliberately rejected: 8 samples cannot train or validate it honestly.

UNCERTAINTY:
  Per-horizon expected error taken from backtest MAE on held-out days
  (empirical, not assumed), reported per forecast grid; per-cell sigma
  scales with each cell's own historical daily variability.

HORIZONS: +24 h / +48 h / +72 h only — longer is not supportable from
  an 8-day window and is refused by the API.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np

from .config import META_DIR, NORM_DIR

MODEL_NAME = "seaice-damped-trend"
MODEL_VERSION = "0.1.0"
BASELINE_NAME = "seaice-persistence"
DAMPING = 0.75          # φ — geometric damping of the fitted trend
TREND_WINDOW = 6        # days used for the OLS slope
MAX_HORIZON_H = 72
HORIZONS_H = (24, 48, 72)


# ── preprocessing ──────────────────────────────────────────────────────

@dataclass
class SeaIceStack:
    dates: list[str]              # ISO dates, oldest → newest
    grid_meta: dict               # lon0/lat0/dLon/dLat/nLon/nLat
    cube: np.ndarray              # (T, nLat, nLon) float, NaN = no-data
    mask: np.ndarray              # (nLat, nLon) bool, True = valid domain

    @property
    def latest_date(self) -> str:
        return self.dates[-1]


def load_stack() -> SeaIceStack:
    """Load all normalized observation days into a (T, y, x) cube."""
    metas = json.loads((META_DIR / "seaice.json").read_text())["days"]
    days = sorted(m["datasetId"].split("_")[1] for m in metas)
    if len(days) < 4:
        raise RuntimeError(
            f"Sea-ice history too short for forecasting: {len(days)} days "
            f"(minimum 4). Run ingestion first."
        )
    arrs, dates = [], []
    grid_meta: dict = {}
    for ymd in days:
        doc = json.loads((NORM_DIR / f"seaice_{ymd}.json").read_text())
        g = doc["grid"]
        grid_meta = {k: g[k] for k in ("lon0", "lat0", "dLon", "dLat", "nLon", "nLat")}
        a = np.array(g["values"], dtype=float)
        a[a < 0] = np.nan
        arrs.append(a)
        dates.append(doc["temporal"]["validTime"][:10])
    cube = np.stack(arrs)
    mask = ~np.isnan(cube).any(axis=0)
    # clip stray values into physical range
    cube = np.clip(cube, 0.0, 100.0)
    return SeaIceStack(dates=dates, grid_meta=grid_meta, cube=cube, mask=mask)


# ── models ─────────────────────────────────────────────────────────────

def predict_persistence(train: np.ndarray, horizon_d: int) -> np.ndarray:
    """Baseline: tomorrow looks like today."""
    return train[-1].copy()


def _cell_slopes(train: np.ndarray, window: int) -> np.ndarray:
    """OLS slope per cell over the trailing `window` days (vectorized)."""
    w = min(window, train.shape[0])
    y = train[-w:]                                   # (w, ny, nx)
    t = np.arange(w, dtype=float)
    t_mean = t.mean()
    with np.errstate(invalid="ignore"):
        y_mean = np.nanmean(y, axis=0)
        cov = np.nansum((t - t_mean)[:, None, None] * (y - y_mean), axis=0)
        var = ((t - t_mean) ** 2).sum()
        return np.nan_to_num(cov / var)              # % per day (0 on masked cells)


def predict_damped_trend(train: np.ndarray, horizon_d: int,
                         phi: float = DAMPING, window: int = TREND_WINDOW) -> np.ndarray:
    """f(T+h) = y[T] + slope · Σ_{k=1..h} φ^k   (damped extrapolation)."""
    slope = _cell_slopes(train, window)
    damp_sum = sum(phi ** k for k in range(1, horizon_d + 1))
    out = train[-1] + slope * damp_sum
    return np.clip(out, 0.0, 100.0)


MODELS = {
    BASELINE_NAME: predict_persistence,
    MODEL_NAME: predict_damped_trend,
}


# ── validation (backtest on held-out observation days) ────────────────

@dataclass
class BacktestResult:
    metrics: dict = field(default_factory=dict)   # model → horizon → {mae, rmse, n}
    selected_model: str = BASELINE_NAME
    notes: list[str] = field(default_factory=list)


def backtest(stack: SeaIceStack, min_train: int = 5) -> BacktestResult:
    """Walk-forward: train on days[:k], predict days[k:k+3], all valid k."""
    cube, mask = stack.cube, stack.mask
    T = cube.shape[0]
    acc: dict[str, dict[int, list[tuple[float, float, int]]]] = {
        m: {h: [] for h in (1, 2, 3)} for m in MODELS
    }
    for k in range(min_train, T):
        train = cube[:k]
        for h in (1, 2, 3):
            if k + h - 1 >= T:
                continue
            truth = cube[k + h - 1]
            for name, fn in MODELS.items():
                pred = fn(train, h)
                err = (pred - truth)[mask]
                acc[name][h].append(
                    (float(np.abs(err).mean()),
                     float(np.sqrt((err ** 2).mean())),
                     int(mask.sum()))
                )

    res = BacktestResult()
    for name in MODELS:
        res.metrics[name] = {}
        for h in (1, 2, 3):
            rows = acc[name][h]
            if rows:
                res.metrics[name][h * 24] = {
                    "maePct": round(float(np.mean([r[0] for r in rows])), 3),
                    "rmsePct": round(float(np.mean([r[1] for r in rows])), 3),
                    "folds": len(rows),
                    "cellsPerFold": rows[0][2],
                }

    # model selection: damped trend must beat persistence at h=24 AND overall
    def _score(m: str) -> float:
        return float(np.mean([v["maePct"] for v in res.metrics[m].values()]))

    trend_ok = (
        res.metrics[MODEL_NAME].get(24, {}).get("maePct", 9e9)
        <= res.metrics[BASELINE_NAME].get(24, {}).get("maePct", 9e9)
        and _score(MODEL_NAME) <= _score(BASELINE_NAME)
    )
    res.selected_model = MODEL_NAME if trend_ok else BASELINE_NAME
    res.notes.append(
        f"selected {res.selected_model} by walk-forward backtest "
        f"(mean MAE {_score(res.selected_model):.3f}% vs "
        f"{_score(MODEL_NAME if res.selected_model == BASELINE_NAME else BASELINE_NAME):.3f}%)"
    )
    if T < 10:
        res.notes.append(
            f"short history ({T} days): metrics are indicative, not a "
            f"climatological validation; horizons capped at {MAX_HORIZON_H} h"
        )
    return res


# ── inference ──────────────────────────────────────────────────────────

def _cell_sigma(stack: SeaIceStack, horizon_d: int,
                bt: BacktestResult, model: str) -> np.ndarray:
    """Per-cell 1σ: cell's own daily volatility scaled to horizon,
    floored by the backtest MAE for that horizon."""
    daily_sd = np.nanstd(np.diff(stack.cube, axis=0), axis=0)
    daily_sd = np.nan_to_num(daily_sd)
    floor = bt.metrics[model].get(horizon_d * 24, {}).get("maePct", 3.0)
    sig = np.sqrt(horizon_d) * daily_sd
    return np.maximum(sig, floor)


def run_forecast(horizon_h: int) -> dict:
    """Full pipeline: load → validate history → fit/select → predict → package."""
    if horizon_h not in HORIZONS_H:
        raise ValueError(
            f"horizon {horizon_h} h not supported; available: {list(HORIZONS_H)} "
            f"(limited by the {TREND_WINDOW + 2}-day observation window)"
        )
    stack = load_stack()
    bt = backtest(stack)
    model = bt.selected_model
    horizon_d = horizon_h // 24

    pred = MODELS[model](stack.cube, horizon_d)
    sigma = _cell_sigma(stack, horizon_d, bt, model)

    pred_out = np.where(stack.mask, np.round(pred, 1), -1.0)
    sig_out = np.where(stack.mask, np.round(sigma, 1), -1.0)

    base_date = datetime.strptime(stack.latest_date, "%Y-%m-%d").replace(
        tzinfo=timezone.utc, hour=12
    )
    valid_time = base_date + timedelta(hours=horizon_h)
    m = bt.metrics[model].get(horizon_h, {})

    return {
        "grid": {
            **stack.grid_meta,
            "values": pred_out.tolist(),
            "noData": -1.0,
            "units": "percent_concentration",
        },
        "uncertainty": {
            "sigmaGrid": sig_out.tolist(),
            "meanSigmaPct": round(float(sigma[stack.mask].mean()), 2),
            "backtestMaePct": m.get("maePct"),
            "backtestRmsePct": m.get("rmsePct"),
            "method": "per-cell daily volatility ×√h, floored by walk-forward "
                      "backtest MAE at this horizon",
        },
        "model": {
            "name": model,
            "version": MODEL_VERSION,
            "baseline": BASELINE_NAME,
            "selectedBy": "walk-forward backtest on held-out observation days",
            "trainWindowDays": len(stack.dates),
            "damping": DAMPING if model == MODEL_NAME else None,
        },
        "validation": {"metrics": bt.metrics, "notes": bt.notes},
        "temporal": {
            "kind": "MODEL_FORECAST",
            "baseTime": f"{stack.latest_date}T12:00:00Z",
            "validTime": valid_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "horizonH": horizon_h,
        },
        "provenance": "MODEL_FORECAST",
        "inputProvenance": "REAL_OBSERVATION",
        "inputDates": stack.dates,
        "stats": {
            "meanConcPct": round(float(pred[stack.mask].mean()), 1),
            "maxConcPct": round(float(pred[stack.mask].max()), 1),
            "validCells": int(stack.mask.sum()),
        },
        "executedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
