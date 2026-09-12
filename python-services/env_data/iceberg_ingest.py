"""Ingest BYU/NIC consolidated iceberg track database (real observations).

Source: BYU SCP consolidated_database_v8.0 — daily positions per named berg,
multiple sensors (NIC analyst positions + ASCAT/OSCAT/QSCAT scatterometer).
Provenance: REAL_OBSERVATION.

Output: data/normalized/iceberg_tracks.json
  one record per berg: [{t: ISO date, lat, lon, src}] chronological,
  deduplicated (sensor priority: nic > ascat > oscat > qscat > sass),
  restricted to AOI-relevant bergs with recent activity.

Run: python -m env_data.iceberg_ingest
"""

from __future__ import annotations

import csv
import io
import json
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import AOI, META_DIR, NORM_DIR, RAW_DIR

BYU_URL = "https://www.scp.byu.edu/data/iceberg/consolidated_database_v8.0.zip"
SENSOR_PRIORITY = ["nic", "ascat", "oscat", "qscat", "sass"]
MIN_OBS = 30            # ignore bergs with fewer usable observations
RECENT_YEARS = 3        # keep track history from the last N years
AOI_MARGIN = 8.0        # degrees lon/lat margin when selecting bergs


def _yyyyddd_to_iso(v: str) -> str | None:
    try:
        v = str(int(float(v)))
        year, doy = int(v[:4]), int(v[4:])
        return (datetime(year, 1, 1) + timedelta(days=doy - 1)).strftime("%Y-%m-%d")
    except (ValueError, IndexError):
        return None


def ingest_tracks() -> dict:
    raw_path = RAW_DIR / "byu_iceberg_db_v8.zip"
    if not raw_path.exists():
        print("downloading BYU consolidated database (~4 MB)…")
        req = urllib.request.Request(BYU_URL, headers={"User-Agent": "POLARIS-X-prototype/0.1"})
        raw_path.write_bytes(urllib.request.urlopen(req, timeout=120).read())

    cutoff = (datetime.now(timezone.utc) - timedelta(days=365 * RECENT_YEARS)).strftime("%Y-%m-%d")
    tracks: dict[str, list[dict]] = {}
    skipped_short, skipped_area = 0, 0

    with zipfile.ZipFile(raw_path) as zf:
        names = [n for n in zf.namelist()
                 if n.endswith(".csv") and "/" in n and not Path(n).name.startswith("#")]
        for name in names:
            berg_id = Path(name).stem.upper()
            try:
                text = zf.read(name).decode("utf-8", errors="replace")
                reader = csv.DictReader(io.StringIO(text))
                rows = list(reader)
            except Exception:
                continue
            obs = []
            for r in rows:
                iso = _yyyyddd_to_iso(r.get("date", ""))
                if not iso or iso < cutoff:
                    continue
                # choose best sensor with valid flag
                for s in SENSOR_PRIORITY:
                    la, lo, ok = r.get(f"{s}_1"), r.get(f"{s}_2"), r.get(f"{s}_3")
                    try:
                        la, lo, ok = float(la), float(lo), int(float(ok))
                    except (TypeError, ValueError):
                        continue
                    if ok == 1 and la != 0 and -90 < la < -40 and -180 <= lo <= 360:
                        if lo > 180:
                            lo -= 360
                        obs.append({"t": iso, "lat": round(la, 4), "lon": round(lo, 4), "src": s})
                        break
            if len(obs) < MIN_OBS:
                skipped_short += 1
                continue
            # dedupe by date (keep first = highest priority), sort
            seen: dict[str, dict] = {}
            for o in obs:
                seen.setdefault(o["t"], o)
            obs = sorted(seen.values(), key=lambda o: o["t"])
            # AOI relevance: any observation inside the (expanded) mission AOI
            in_aoi = any(
                AOI["lon_min"] - AOI_MARGIN <= o["lon"] <= AOI["lon_max"] + AOI_MARGIN
                and AOI["lat_min"] - AOI_MARGIN <= o["lat"] <= AOI["lat_max"] + AOI_MARGIN
                for o in obs
            )
            if not in_aoi:
                skipped_area += 1
                continue
            tracks[berg_id] = obs

    doc = {
        "datasetId": "iceberg_tracks_byu_v8",
        "provenance": "REAL_OBSERVATION",
        "source": {
            "id": "icebergs_byu",
            "name": "BYU/NIC consolidated Antarctic iceberg tracking database v8.0",
            "provider": "BYU SCP / USNIC",
            "url": BYU_URL,
        },
        "windowStart": cutoff,
        "tracks": tracks,
    }
    (NORM_DIR / "iceberg_tracks.json").write_text(json.dumps(doc))
    meta = {
        "sourceId": "icebergs_byu",
        "provenance": "REAL_OBSERVATION",
        "ingestedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bergs": len(tracks),
        "totalObs": sum(len(v) for v in tracks.values()),
        "skipped": {"tooShort": skipped_short, "outsideAOI": skipped_area},
        "windowStart": cutoff,
        "processingStatus": "normalized",
    }
    (META_DIR / "iceberg_tracks.json").write_text(json.dumps(meta, indent=2))
    print(f"tracks: {len(tracks)} bergs, {meta['totalObs']} observations "
          f"(≥{cutoff}); skipped short={skipped_short}, outside AOI={skipped_area}")
    latest = max((t[-1]["t"] for t in tracks.values()), default="—")
    print("latest observation:", latest)
    return meta


if __name__ == "__main__":
    ingest_tracks()
