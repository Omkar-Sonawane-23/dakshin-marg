"""CAPABILITY 1 — Iceberg DETECTION (imagery → object records).

Two detector inputs are supported:

A. REAL analyst detections — the current USNIC CSV (ingested by
   `ingest.py`) is treated as authoritative analyst-derived object records
   (provenance REAL_OBSERVATION). No algorithm needed; they ARE detections.

B. SAR-scene detector — a real detection algorithm (adaptive-threshold CFAR
   + connected components + geometric filtering) exercised on a SYNTHETIC
   SAR-like backscatter scene, because real Sentinel-1 access requires
   authenticated APIs unavailable in this environment. The scene is
   deterministic, clearly labelled SIMULATED, and contains injected ground
   truth so the algorithm is INDEPENDENTLY VALIDATED (precision/recall/
   position error). The identical code path would run on a real calibrated
   backscatter GeoTIFF.

Detection is deliberately separate from tracking and trajectory prediction.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from .config import NORM_DIR

DETECTOR_NAME = "sar-cfar-cc"
DETECTOR_VERSION = "0.1.0"
SCENE_SEED = 20260902
SCENE_SIZE = 512                      # pixels
SCENE_PIX_M = 200.0                   # metres per pixel → ~102 km scene
SCENE_ORIGIN = {"lon": 74.0, "lat": -66.2}   # Prydz Bay approach (display georef)
K_SIGMA = 4.0                         # threshold: local mean + K·sigma
MIN_AREA_PX = 4                       # ≥4 px ≈ 0.16 km² minimum target


# ── synthetic scene with ground truth (SIMULATED, deterministic) ───────

def build_scene(seed: int = SCENE_SEED) -> tuple[np.ndarray, list[dict]]:
    """Rayleigh-speckled ocean background + bright elliptical targets."""
    rng = np.random.default_rng(seed)
    img = rng.rayleigh(scale=1.0, size=(SCENE_SIZE, SCENE_SIZE))
    # low-frequency wind-roughness gradient
    yy, xx = np.mgrid[0:SCENE_SIZE, 0:SCENE_SIZE]
    img *= 1.0 + 0.25 * np.sin(xx / 90.0) * np.cos(yy / 130.0)

    truth = []
    n_targets = 18
    for i in range(n_targets):
        cx, cy = rng.uniform(30, SCENE_SIZE - 30, 2)
        a = rng.uniform(1.2, 14.0)               # semi-axes in px (some sub-resolution)
        b = a * rng.uniform(0.5, 1.0)
        ang = rng.uniform(0, np.pi)
        # amplitude spectrum includes marginal targets near the noise floor
        amp = rng.uniform(1.5, 12.0)
        ca, sa = np.cos(ang), np.sin(ang)
        u = (xx - cx) * ca + (yy - cy) * sa
        v = -(xx - cx) * sa + (yy - cy) * ca
        mask = (u / a) ** 2 + (v / b) ** 2 <= 1.0
        img[mask] += amp * rng.uniform(0.8, 1.2)
        truth.append({"x": float(cx), "y": float(cy),
                      "area_px": float(np.pi * a * b), "amp": float(amp),
                      "id": f"GT-{i:02d}"})
    return img, truth


# ── detector (real algorithm) ──────────────────────────────────────────

def detect(img: np.ndarray, k_sigma: float = K_SIGMA,
           min_area: int = MIN_AREA_PX) -> list[dict]:
    """Adaptive threshold (global robust stats) + 4-connected components."""
    med = float(np.median(img))
    mad = float(np.median(np.abs(img - med))) * 1.4826  # robust sigma
    thresh = med + k_sigma * mad
    binary = img > thresh

    # connected components via iterative flood fill (no scipy dependency)
    labels = np.zeros(img.shape, dtype=np.int32)
    current = 0
    detections = []
    h, w = img.shape
    for sy in range(h):
        for sx in range(w):
            if binary[sy, sx] and labels[sy, sx] == 0:
                current += 1
                stack = [(sy, sx)]
                labels[sy, sx] = current
                px = []
                while stack:
                    y, x = stack.pop()
                    px.append((y, x))
                    for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
                        if 0 <= ny < h and 0 <= nx < w and binary[ny, nx] and labels[ny, nx] == 0:
                            labels[ny, nx] = current
                            stack.append((ny, nx))
                if len(px) >= min_area:
                    ys = np.array([p[0] for p in px], dtype=float)
                    xs = np.array([p[1] for p in px], dtype=float)
                    peak = float(img[[p[0] for p in px], [p[1] for p in px]].max())
                    # confidence: contrast above threshold, saturating
                    conf = min(0.99, 0.5 + 0.5 * (peak - thresh) / (thresh * 2))
                    detections.append({
                        "x": float(xs.mean()), "y": float(ys.mean()),
                        "area_px": float(len(px)),
                        "area_km2": round(len(px) * (SCENE_PIX_M / 1000.0) ** 2, 3),
                        "peak_over_thresh": round(peak / thresh, 2),
                        "confidence": round(conf, 2),
                    })
    return detections


# ── independent validation vs injected ground truth ───────────────────

def validate_detector(match_radius_px: float = 6.0) -> dict:
    img, truth = build_scene()
    dets = detect(img)
    matched_t, matched_d, pos_errs = set(), set(), []
    for ti, t in enumerate(truth):
        best, best_d = None, match_radius_px
        for di, d in enumerate(dets):
            if di in matched_d:
                continue
            dist = ((d["x"] - t["x"]) ** 2 + (d["y"] - t["y"]) ** 2) ** 0.5
            if dist < best_d:
                best, best_d = di, dist
        if best is not None:
            matched_t.add(ti)
            matched_d.add(best)
            pos_errs.append(best_d)
    tp = len(matched_t)
    fp = len(dets) - len(matched_d)
    fn = len(truth) - tp
    return {
        "sceneSeed": SCENE_SEED,
        "targetsInjected": len(truth),
        "detections": len(dets),
        "truePositives": tp,
        "falsePositives": fp,
        "falseNegatives": fn,
        "precision": round(tp / max(1, tp + fp), 3),
        "recall": round(tp / max(1, tp + fn), 3),
        "meanPositionErrorPx": round(float(np.mean(pos_errs)), 2) if pos_errs else None,
        "meanPositionErrorM": round(float(np.mean(pos_errs)) * SCENE_PIX_M, 0) if pos_errs else None,
        "note": "Validation on deterministic SIMULATED SAR-like scene with "
                "injected ground truth. Real-SAR performance will differ; "
                "algorithm path is identical for calibrated backscatter input.",
    }


# ── object records for the API/map ─────────────────────────────────────

def _px_to_lonlat(x: float, y: float) -> tuple[float, float]:
    """Georeference the demo scene near Prydz Bay (display purposes)."""
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = m_per_deg_lat * np.cos(np.radians(SCENE_ORIGIN["lat"]))
    lon = SCENE_ORIGIN["lon"] + (x - SCENE_SIZE / 2) * SCENE_PIX_M / m_per_deg_lon
    lat = SCENE_ORIGIN["lat"] - (y - SCENE_SIZE / 2) * SCENE_PIX_M / m_per_deg_lat
    return round(float(lon), 4), round(float(lat), 4)


def run_detection() -> dict:
    """Full detection product: SAR-scene detections + validation report."""
    img, _truth = build_scene()
    dets = detect(img)
    records = []
    for i, d in enumerate(sorted(dets, key=lambda r: -r["area_px"])):
        lon, lat = _px_to_lonlat(d["x"], d["y"])
        records.append({
            "id": f"SAR-{i:03d}",
            "lon": lon, "lat": lat,
            "areaKm2": d["area_km2"],
            "confidence": d["confidence"],
            "peakContrast": d["peak_over_thresh"],
            "source": "synthetic SAR-like scene (SIMULATED)",
        })
    result = {
        "detections": records,
        "validation": validate_detector(),
        "scene": {
            "provenance": "SIMULATED",
            "sizePx": SCENE_SIZE,
            "pixelM": SCENE_PIX_M,
            "georef": "display-only, centred near Prydz Bay approach",
            "seed": SCENE_SEED,
        },
        "model": {"name": DETECTOR_NAME, "version": DETECTOR_VERSION,
                  "params": {"kSigma": K_SIGMA, "minAreaPx": MIN_AREA_PX}},
        "executedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (NORM_DIR / "iceberg_detections.json").write_text(json.dumps(result))
    return result


if __name__ == "__main__":
    r = run_detection()
    v = r["validation"]
    print(f"detections: {len(r['detections'])}")
    print(f"validation: P={v['precision']} R={v['recall']} "
          f"posErr={v['meanPositionErrorM']} m "
          f"(TP {v['truePositives']} FP {v['falsePositives']} FN {v['falseNegatives']})")
