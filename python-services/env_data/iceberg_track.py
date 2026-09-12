"""CAPABILITY 2 — Iceberg TRACKING (object records → temporal association → tracks).

Associator: greedy gated nearest-neighbour in drift space.
  · gate: max plausible drift speed (km/day) × time gap, + base allowance
  · handles missing observations (coasting up to MAX_GAP_DAYS)
  · handles duplicate detections (second detection in gate → flagged)
  · new track spawned for unassociated detections

INDEPENDENT VALIDATION on REAL data:
  Take the real BYU per-berg tracks, pool all (date, lat, lon) observations,
  STRIP identity, re-associate from scratch, then score how well the
  reconstructed tracks match the true identities (purity / fragmentation).
"""

from __future__ import annotations

import json
import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .config import META_DIR, NORM_DIR

TRACKER_NAME = "greedy-gated-nn"
TRACKER_VERSION = "0.1.0"
MAX_SPEED_KM_D = 40.0     # generous upper bound for large-berg drift
BASE_GATE_KM = 15.0       # allowance for sensor position noise
MAX_GAP_DAYS = 21         # coast a track through gaps up to 3 weeks


def _dist_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


@dataclass
class Track:
    track_id: str
    obs: list[dict] = field(default_factory=list)   # {t, lat, lon, src, trueId?}
    duplicates: int = 0

    @property
    def last(self) -> dict:
        return self.obs[-1]


def associate(observations: list[dict]) -> list[Track]:
    """observations: [{t: ISO, lat, lon, src, trueId?}] — any order."""
    by_day: dict[str, list[dict]] = {}
    for o in observations:
        by_day.setdefault(o["t"], []).append(o)

    tracks: list[Track] = []
    next_id = 0
    for day in sorted(by_day.keys()):
        day_dt = datetime.strptime(day, "%Y-%m-%d")
        candidates = [t for t in tracks
                      if (day_dt - datetime.strptime(t.last["t"], "%Y-%m-%d")).days
                      <= MAX_GAP_DAYS]
        assigned: set[int] = set()
        for o in sorted(by_day[day], key=lambda x: (x["lat"], x["lon"])):
            best, best_d = None, float("inf")
            for ti, t in enumerate(candidates):
                gap_d = max(1, (day_dt - datetime.strptime(t.last["t"], "%Y-%m-%d")).days)
                gate = BASE_GATE_KM + MAX_SPEED_KM_D * gap_d
                d = _dist_km(o["lat"], o["lon"], t.last["lat"], t.last["lon"])
                if d < gate and d < best_d:
                    best, best_d = ti, d
            if best is not None:
                if best in assigned:
                    candidates[best].duplicates += 1   # duplicate in gate
                    continue
                candidates[best].obs.append(o)
                assigned.add(best)
            else:
                nt = Track(track_id=f"TRK-{next_id:03d}", obs=[o])
                next_id += 1
                tracks.append(nt)
                candidates.append(nt)
                assigned.add(len(candidates) - 1)
    return tracks


# ── independent validation on real BYU data ────────────────────────────

def validate_tracker(sample_days: int = 365) -> dict:
    """Strip identities from real observations, re-associate, score."""
    doc = json.loads((NORM_DIR / "iceberg_tracks.json").read_text())
    pool: list[dict] = []
    latest = max(t[-1]["t"] for t in doc["tracks"].values())
    cutoff = (datetime.strptime(latest, "%Y-%m-%d")
              .replace(tzinfo=timezone.utc))
    cutoff_iso = (cutoff.timestamp() - sample_days * 86400)
    for berg_id, obs in doc["tracks"].items():
        for o in obs:
            if datetime.strptime(o["t"], "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() >= cutoff_iso:
                pool.append({**o, "trueId": berg_id})

    rebuilt = associate(pool)
    rebuilt = [t for t in rebuilt if len(t.obs) >= 5]

    # purity: fraction of each rebuilt track belonging to its majority true berg
    purities, coverage = [], Counter()
    for t in rebuilt:
        ids = Counter(o["trueId"] for o in t.obs)
        top_id, top_n = ids.most_common(1)[0]
        purities.append(top_n / len(t.obs))
        coverage[top_id] += 1
    frag = {k: v for k, v in coverage.items() if v > 1}
    true_ids = {o["trueId"] for o in pool}

    return {
        "windowDays": sample_days,
        "observations": len(pool),
        "trueBergs": len(true_ids),
        "rebuiltTracks": len(rebuilt),
        "meanPurity": round(sum(purities) / max(1, len(purities)), 3),
        "minPurity": round(min(purities), 3) if purities else None,
        "fragmentedBergs": len(frag),
        "note": "Identities stripped from REAL BYU observations and "
                "re-associated from scratch; purity = fraction of each rebuilt "
                "track belonging to one true berg.",
    }


# ── production tracks for the API (real BYU data + kinematics) ────────

def build_tracks() -> dict:
    doc = json.loads((NORM_DIR / "iceberg_tracks.json").read_text())
    meta = json.loads((META_DIR / "iceberg_tracks.json").read_text())
    out = []
    for berg_id, obs in sorted(doc["tracks"].items()):
        if len(obs) < 2:
            continue
        # recent kinematics from last ≤30 days of observations
        recent = obs[-30:]
        d_km = 0.0
        for a, b in zip(recent, recent[1:]):
            d_km += _dist_km(a["lat"], a["lon"], b["lat"], b["lon"])
        days = max(1, (datetime.strptime(recent[-1]["t"], "%Y-%m-%d")
                       - datetime.strptime(recent[0]["t"], "%Y-%m-%d")).days)
        speed = d_km / days
        # bearing from first→last of recent window
        la1, lo1 = math.radians(recent[0]["lat"]), math.radians(recent[0]["lon"])
        la2, lo2 = math.radians(recent[-1]["lat"]), math.radians(recent[-1]["lon"])
        y = math.sin(lo2 - lo1) * math.cos(la2)
        x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
        bearing = (math.degrees(math.atan2(y, x)) + 360) % 360
        gaps = [
            (datetime.strptime(b["t"], "%Y-%m-%d") - datetime.strptime(a["t"], "%Y-%m-%d")).days
            for a, b in zip(obs, obs[1:])
        ]
        out.append({
            "id": berg_id,
            "nObs": len(obs),
            "first": obs[0]["t"], "last": obs[-1]["t"],
            "lastLat": obs[-1]["lat"], "lastLon": obs[-1]["lon"],
            "meanSpeedKmD": round(speed, 2),
            "bearingDeg": round(bearing, 0),
            "maxGapDays": max(gaps) if gaps else 0,
            "sensors": sorted({o["src"] for o in obs}),
            "recentPath": [{"t": o["t"], "lat": o["lat"], "lon": o["lon"]} for o in obs[-120:]],
        })
    return {
        "tracks": out,
        "provenance": "REAL_OBSERVATION",
        "source": doc["source"],
        "tracker": {"name": TRACKER_NAME, "version": TRACKER_VERSION,
                    "note": "identity from BYU database; associator validated "
                            "independently by identity-stripping test"},
        "ingestedAt": meta["ingestedAt"],
    }


if __name__ == "__main__":
    v = validate_tracker()
    print("tracker validation:", json.dumps(v, indent=2))
    t = build_tracks()
    print(f"\ntracks: {len(t['tracks'])}")
    for tr in t["tracks"][:6]:
        print(f"  {tr['id']:6s} {tr['nObs']:5d} obs  {tr['first']}→{tr['last']}  "
              f"{tr['meanSpeedKmD']:5.1f} km/d  maxGap {tr['maxGapDays']}d")
