"""Validation stage — every ingested dataset passes through here.

Checks produce a quality report; datasets that fail hard checks are rejected
(never served), datasets with warnings are served with quality_status='degraded'
and the warnings attached to their metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ValidationReport:
    ok: bool = True
    quality_status: str = "ok"  # ok | degraded | rejected
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def error(self, msg: str) -> None:
        self.ok = False
        self.quality_status = "rejected"
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        if self.quality_status == "ok":
            self.quality_status = "degraded"


def validate_seaice_grid(values, expected_cells: int) -> ValidationReport:
    """values: flat list of concentration % (0–100) or -1 for no-data."""
    r = ValidationReport()
    if len(values) != expected_cells:
        r.error(f"grid size mismatch: {len(values)} != {expected_cells}")
        return r
    valid = [v for v in values if v >= 0]
    if not valid:
        r.error("no valid concentration cells in AOI")
        return r
    out_of_range = sum(1 for v in valid if v > 100)
    if out_of_range:
        r.error(f"{out_of_range} cells exceed 100% concentration")
    nodata_frac = 1 - len(valid) / len(values)
    if nodata_frac > 0.7:
        r.warn(f"high no-data fraction in AOI: {nodata_frac:.0%}")
    return r


def validate_icebergs(rows: list[dict]) -> ValidationReport:
    r = ValidationReport()
    if not rows:
        r.error("iceberg CSV parsed to zero rows")
        return r
    for row in rows:
        bid = row.get("id", "?")
        lat, lon = row.get("lat"), row.get("lon")
        if lat is None or lon is None:
            r.warn(f"{bid}: missing coordinates — dropped")
            row["_drop"] = True
            continue
        if not (-90 <= lat <= -40):
            r.warn(f"{bid}: latitude {lat} outside Antarctic range — dropped")
            row["_drop"] = True
        if not (-180 <= lon <= 180):
            r.warn(f"{bid}: longitude {lon} invalid — dropped")
            row["_drop"] = True
        if (row.get("length_nm") or 0) < 0:
            r.warn(f"{bid}: negative length — cleared")
            row["length_nm"] = None
    kept = [x for x in rows if not x.get("_drop")]
    if not kept:
        r.error("all iceberg rows dropped by validation")
    return r


def validate_weather(cells: list[dict], n_hours: int) -> ValidationReport:
    r = ValidationReport()
    if not cells:
        r.error("no weather cells returned")
        return r
    for c in cells:
        if len(c.get("wind_speed_kn", [])) != n_hours:
            r.error(f"cell {c.get('lat')},{c.get('lon')}: hour count mismatch")
            return r
    speeds = [v for c in cells for v in c["wind_speed_kn"] if v is not None]
    if speeds and max(speeds) > 130:
        r.warn(f"suspicious max wind {max(speeds):.0f} kn (>130)")
    if speeds and all(v == 0 for v in speeds):
        r.warn("all wind speeds zero — provider data suspect")
    return r
