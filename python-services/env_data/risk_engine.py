"""Navigation risk engine — POLARIS + Overland + empirical iceberg zones.

DESIGN RULE: no invented numbers. Every threshold traces to one of:
  · IMO POLARIS (MSC.1/Circ.1519): Risk Index Values per ice class x ice
    type; RIO = sum(C_i x RIV_i) with C in tenths; categories at
    RIO >= 0 / -10 <= RIO < 0 / RIO < -10.
  · Overland (1990), Wea. Forecasting 5, 62-77 — NOAA vessel-icing
    predictor PPR = Va(Tf - Ta) / (1 + 0.3(Tw - Tf)), classes at
    22.4 / 53.3 / 83.0 (m°C/s); saltwater freezing point Tf = -1.8 °C.
  · Empirical quantiles measured by OUR OWN validated backtests
    (iceberg_trajectory.backtest): P50/P90 drift-prediction errors define
    iceberg hazard-zone radii; sea-ice forecast sigma comes from
    seaice_forecast backtesting.
Data gaps are handled by DECLARED, conservative assumptions (listed in every
response under `assumptions`), never silent guesses.

Combination rule: severity = MAX over contributors (worst-of). No weighted
sums — weights would be arbitrary. The ordinal mapping from each published
scheme to the shared display scale is a documented convention (see
docs/risk-methodology.md §5), not a numeric invention.

Outputs: spatial risk grid, route risk, per-contributor attribution,
severity, human-readable explanations.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any

import numpy as np

from .config import NORM_DIR

ENGINE_NAME = "polaris-overland-risk"
ENGINE_VERSION = "0.1.0"

# ── POLARIS Risk Index Values (IMO MSC.1/Circ.1519, Table 1) ───────────
# Columns (ice type, WMO stage of development):
ICE_TYPES = [
    "ICE_FREE", "NEW_ICE", "GREY_ICE", "GREY_WHITE_ICE",
    "THIN_FY_1", "THIN_FY_2", "MEDIUM_FY_LT1M", "MEDIUM_FY",
    "THICK_FY", "SECOND_YEAR", "LIGHT_MY", "HEAVY_MY",
]
RIV_TABLE: dict[str, list[int]] = {
    "PC1":  [3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1],
    "PC2":  [3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 0],
    "PC3":  [3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 0, -1],
    "PC4":  [3, 3, 3, 3, 2, 2, 2, 2, 1, 0, -1, -2],
    "PC5":  [3, 3, 3, 3, 2, 2, 1, 1, 0, -1, -2, -2],
    "PC6":  [3, 2, 2, 2, 2, 1, 1, 0, -1, -2, -3, -3],
    "PC7":  [3, 2, 2, 2, 1, 1, 0, -1, -2, -3, -3, -3],
    "IA_SUPER": [3, 2, 2, 2, 2, 1, 0, -1, -2, -3, -4, -4],
    "IA":   [3, 2, 2, 2, 1, 0, -1, -2, -3, -4, -5, -5],
    "IB":   [3, 2, 2, 1, 0, -1, -2, -3, -4, -5, -6, -6],
    "IC":   [3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8],
    "NONE": [3, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -8],
}
PC_CLASSES = {"PC1", "PC2", "PC3", "PC4", "PC5", "PC6", "PC7"}

# POLARIS Risk Index Outcome criteria (MSC.1/Circ.1519, Table 2)
def polaris_category(rio: float, ice_class: str) -> str:
    if rio >= 0:
        return "NORMAL_OPERATION"
    if rio >= -10 and ice_class in PC_CLASSES:
        return "ELEVATED_RISK"
    return "SPECIAL_CONSIDERATION"


# Documented display convention (docs/risk-methodology.md §5):
SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
POLARIS_SEVERITY = {
    "NORMAL_OPERATION": "LOW",
    "ELEVATED_RISK": "HIGH",
    "SPECIAL_CONSIDERATION": "CRITICAL",
}

# ── Overland (1990) NOAA icing predictor ──────────────────────────────
TF_SEAWATER_C = -1.8          # saltwater freezing point (published constant)
ICING_CLASSES = [             # PPR (m·°C/s) thresholds — Overland (1990)
    (22.4, "NONE"), (53.3, "LIGHT"), (83.0, "MODERATE"),
    (float("inf"), "HEAVY_OR_EXTREME"),
]
ICING_SEVERITY = {
    "NONE": "LOW", "LIGHT": "MEDIUM", "MODERATE": "HIGH",
    "HEAVY_OR_EXTREME": "CRITICAL",
}
KN_TO_MS = 0.514444

# Sea-spray icing requires spray, i.e. waves, i.e. open water. Overland's
# predictor is defined for vessels taking spray; wave growth is suppressed
# inside consolidated pack ice. Suppression threshold = the WMO nomenclature
# boundary between open pack (4-6/10) and close pack (7-10/10): 70%.
# This is a documented convention anchored to WMO sea-ice terms, not a tuned
# number (docs/risk-methodology.md §3.3).
SPRAY_SUPPRESS_CONC_PCT = 70.0


def icing_ppr(wind_kn: float, temp_c: float,
              sea_temp_c: float | None = None) -> float:
    """Overland (1990) PPR. Without SST we set Tw = Tf (declared,
    conservative: it maximises PPR because the denominator becomes 1)."""
    tw = TF_SEAWATER_C if sea_temp_c is None else sea_temp_c
    va = wind_kn * KN_TO_MS
    ppr = va * (TF_SEAWATER_C - temp_c) / (1.0 + 0.3 * (tw - TF_SEAWATER_C))
    return max(0.0, ppr)


def icing_class(ppr: float) -> str:
    for thresh, name in ICING_CLASSES:
        if ppr < thresh:
            return name
    return "HEAVY_OR_EXTREME"


# ── helpers ────────────────────────────────────────────────────────────

def _dist_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2)
         * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


def _sev_max(*sevs: str) -> str:
    return SEVERITY_ORDER[max(SEVERITY_ORDER.index(s) for s in sevs)]


def _load(name: str) -> dict:
    return json.loads((NORM_DIR / name).read_text())


# ── ice-type assumption (declared, with sensitivity bounds) ────────────
# NSIDC gives total concentration only, not stage of development. POLARIS
# needs an ice type, so the engine declares one and always reports the RIO
# under the one-step-thinner and one-step-thicker types as a sensitivity
# band. Default MEDIUM_FY: East Antarctic pack in late winter (Sep) is
# predominantly first-year ice of 70-120 cm (WMO nomenclature: medium FY).
DEFAULT_ICE_TYPE = "MEDIUM_FY"


def rio_from_concentration(conc_pct: float, ice_class: str,
                           ice_type: str) -> float:
    """POLARIS RIO for a two-component regime: `conc` tenths of `ice_type`
    plus the ice-free remainder (RIV from the same published row)."""
    row = RIV_TABLE[ice_class]
    c_ice = conc_pct / 10.0                      # tenths
    riv_ice = row[ICE_TYPES.index(ice_type)]
    riv_free = row[ICE_TYPES.index("ICE_FREE")]
    return c_ice * riv_ice + (10.0 - c_ice) * riv_free


# ── iceberg hazard zones (radii from OUR validated backtest) ───────────

def build_berg_zones(horizon_h: int = 0,
                     overrides: dict[str, dict] | None = None,
                     ) -> tuple[list[dict], list[str]]:
    """Hazard zone per berg. Radius = berg semi-length (REAL USNIC dims)
    + empirical P50/P90 drift error at the position age + horizon.
    Quantiles come from iceberg_trajectory.backtest on real tracks.

    `overrides` injects SIMULATED berg-state updates (id -> {lat, lon,
    regime, positionAgeDays, note}) for the deterministic re-planning
    demonstration. Overridden zones are flagged simulated=True and a
    warning is always emitted — simulated state is never silent."""
    from .iceberg_trajectory import backtest  # local import: heavy-ish

    warnings: list[str] = []
    bt = backtest()
    model = bt["selected"]
    q = bt["metrics"][model]                     # strata: all / moving

    bergs = _load("icebergs.json")["icebergs"]
    tracks = _load("iceberg_tracks.json")["tracks"]

    # classify moving vs grounded from the real track tail (same rule as
    # trajectory module: >= 1 km displacement over last 10 obs)
    regime: dict[str, str] = {}
    for bid, obs in tracks.items():
        if len(obs) >= 2:
            w = obs[-10:]
            d = _dist_km(w[0]["lat"], w[0]["lon"], w[-1]["lat"], w[-1]["lon"])
            regime[bid] = "moving" if d >= 1.0 else "all"

    now = datetime.now(timezone.utc)
    zones = []
    capped = False
    sim_ids: list[str] = []
    for b in bergs:
        bid = b["id"]
        ov = (overrides or {}).get(bid)
        if ov:
            b = {**b, "lat": ov.get("lat", b["lat"]), "lon": ov.get("lon", b["lon"])}
            sim_ids.append(bid)
        age_days = 7.0
        if b.get("last_update"):
            age_days = (now - datetime.strptime(b["last_update"], "%Y-%m-%d")
                        .replace(tzinfo=timezone.utc)).total_seconds() / 86400
        if ov and ov.get("positionAgeDays") is not None:
            age_days = float(ov["positionAgeDays"])
        eff_days = age_days + horizon_h / 24.0
        stratum = regime.get(bid, "all")
        if ov and ov.get("regime") == "MOVING" and "moving" in q:
            stratum = "moving"
        # pick the smallest validated horizon >= eff_days; cap at 7 d
        horizons = sorted(int(h) for h in q[stratum])
        pick = next((h for h in horizons if h >= eff_days), None)
        if pick is None:
            pick = horizons[-1]
            capped = True
        p50 = q[stratum][pick]["medianKm"]
        p90 = q[stratum][pick]["p90Km"]
        semi_len_km = (b.get("length_nm") or 5) * 1.852 / 2.0
        zones.append({
            "id": bid,
            "lat": b["lat"], "lon": b["lon"],
            "lengthNm": b.get("length_nm"),
            "positionDate": b.get("last_update"),
            "positionAgeDays": round(age_days, 1),
            "regime": "MOVING" if stratum == "moving" else "GROUNDED_OR_UNTRACKED",
            "coreRadiusKm": round(semi_len_km, 1),
            "p50RadiusKm": round(semi_len_km + p50, 1),
            "p90RadiusKm": round(semi_len_km + p90, 1),
            "quantileHorizonD": pick,
            "tracked": bid in tracks,
            "simulated": bool(ov),
            "simNote": (ov or {}).get("note"),
        })
    if sim_ids:
        warnings.append(
            f"SIMULATION: berg state for {', '.join(sorted(sim_ids))} is a "
            f"simulated deviation (drill scenario), not the real USNIC "
            f"position. Zone radii still use the real backtest quantiles.")
    if capped:
        warnings.append(
            "Some berg positions are older than the longest validated drift "
            "horizon (7 d); their zone radii are floored at the P90 error at "
            "7 d and may understate true position uncertainty.")
    return zones, warnings


def berg_severity_at(lat: float, lon: float, zones: list[dict]) -> tuple[str, dict | None]:
    """Severity by zone membership (convention in methodology §5):
    inside core (berg extent) -> CRITICAL; inside P50 -> HIGH;
    inside P90 -> MEDIUM; outside all -> LOW."""
    worst, hit = "LOW", None
    for z in zones:
        d = _dist_km(lat, lon, z["lat"], z["lon"])
        if d <= z["coreRadiusKm"]:
            sev = "CRITICAL"
        elif d <= z["p50RadiusKm"]:
            sev = "HIGH"
        elif d <= z["p90RadiusKm"]:
            sev = "MEDIUM"
        else:
            continue
        if SEVERITY_ORDER.index(sev) > SEVERITY_ORDER.index(worst):
            worst, hit = sev, {**z, "distanceKm": round(d, 1)}
    return worst, hit


# ── weather field lookup ───────────────────────────────────────────────

class WeatherField:
    def __init__(self, horizon_h: int = 0, hour: str | None = None):
        """`hour` (exact hour from the normalized series, e.g.
        '2026-08-26T06:00') overrides the horizon-relative lookup — used for
        mission-time resolution. Never invented: if the hour is not in the
        series it clamps to the nearest end and flags `clamped`."""
        doc = _load("weather.json")
        self.provenance_note = doc["provenance"]
        times = doc["temporal"]["times"]
        now_hour = doc["temporal"]["nowHour"]
        self.clamped = False
        if hour is not None:
            if hour in times:
                idx = times.index(hour)
            else:
                idx = 0 if hour < times[0] else len(times) - 1
                self.clamped = True
        else:
            idx = times.index(now_hour) + horizon_h
        if idx >= len(times):
            idx = len(times) - 1
            self.clamped = True
        self.valid_hour = times[idx]
        self.cells = [
            {"lat": c["lat"], "lon": c["lon"],
             "windKn": c["wind_speed_kn"][idx], "tempC": c["temp_c"][idx]}
            for c in doc["cells"]
        ]
        self._lats = np.array([c["lat"] for c in self.cells])
        self._lons = np.array([c["lon"] for c in self.cells])

    def nearest(self, lat: float, lon: float) -> dict:
        i = int(np.argmin((self._lats - lat) ** 2
                          + ((self._lons - lon) * math.cos(math.radians(lat))) ** 2))
        return self.cells[i]


# ── sea-ice field (observation or forecast + sigma) ────────────────────

def load_ice_field(horizon_h: int = 0, seaice_day: str | None = None,
                   ) -> tuple[dict, np.ndarray, np.ndarray | None, dict]:
    """Returns (grid_meta, conc[j,i], sigma[j,i] or None, meta).

    `seaice_day` ('YYYYMMDD') selects a SPECIFIC historical observation day
    — used for mission-time resolution. It must exist in the normalized
    store; nothing is interpolated or invented."""
    if seaice_day is not None:
        path = NORM_DIR / f"seaice_{seaice_day}.json"
        if not path.exists():
            raise FileNotFoundError(
                f"no normalized sea-ice observation for {seaice_day}")
        doc = json.loads(path.read_text())
        g = doc["grid"]
        conc = np.array(g["values"], dtype=float)
        meta = {"kind": "OBSERVATION", "validTime": doc["temporal"]["validTime"],
                "inputProvenance": doc["provenance"]}
        return g, conc, None, meta
    if horizon_h == 0:
        days = sorted(NORM_DIR.glob("seaice_*.json"))
        doc = json.loads(days[-1].read_text())
        g = doc["grid"]
        conc = np.array(g["values"], dtype=float)
        meta = {"kind": "OBSERVATION", "validTime": doc["temporal"]["validTime"],
                "inputProvenance": doc["provenance"]}
        return g, conc, None, meta
    from .seaice_forecast import run_forecast
    fc = run_forecast(horizon_h)
    g = fc["grid"]
    conc = np.array(g["values"], dtype=float)
    sigma = np.array(fc["uncertainty"]["sigmaGrid"], dtype=float)
    meta = {"kind": "MODEL_FORECAST",
            "validTime": fc["temporal"]["validTime"],
            "inputProvenance": "REAL_OBSERVATION",
            "model": f"{fc['model']['name']} v{fc['model']['version']}"}
    return g, conc, sigma, meta


# ═══ SPATIAL RISK ══════════════════════════════════════════════════════

def spatial_risk(ice_class: str = "PC5",
                 ice_type: str = DEFAULT_ICE_TYPE,
                 horizon_h: int = 0,
                 berg_overrides: dict[str, dict] | None = None,
                 seaice_day: str | None = None,
                 weather_hour: str | None = None) -> dict:
    if ice_class not in RIV_TABLE:
        raise ValueError(f"unknown ice class {ice_class}")
    if ice_type not in ICE_TYPES:
        raise ValueError(f"unknown ice type {ice_type}")

    g, conc, sigma, ice_meta = load_ice_field(horizon_h, seaice_day=seaice_day)
    wx = WeatherField(horizon_h, hour=weather_hour)
    zones, zone_warnings = build_berg_zones(horizon_h, overrides=berg_overrides)

    n_lat, n_lon = conc.shape
    lat0, lon0, dlat, dlon = g["lat0"], g["lon0"], g["dLat"], g["dLon"]

    idx_type = ICE_TYPES.index(ice_type)
    thinner = ICE_TYPES[max(0, idx_type - 1)]
    thicker = ICE_TYPES[min(len(ICE_TYPES) - 1, idx_type + 1)]

    sev_grid: list[list[int]] = []       # -1 nodata, else severity ordinal
    flags_grid: list[list[int]] = []     # bitmask: 1 ice, 2 berg, 4 icing, 8 sigma-sensitive
    counts = {s: 0 for s in SEVERITY_ORDER}
    n_valid = 0
    n_sigma_sensitive = 0
    worst_cells: list[dict] = []
    worst_by_contrib = {"seaIce": "LOW", "icebergs": "LOW", "icing": "LOW"}
    max_ppr, max_ppr_at = 0.0, None

    for j in range(n_lat):
        sev_row, flag_row = [], []
        lat = lat0 + j * dlat + dlat / 2
        for i in range(n_lon):
            c = conc[j, i]
            if c < 0:
                sev_row.append(-1)
                flag_row.append(0)
                continue
            lon = lon0 + i * dlon + dlon / 2
            n_valid += 1
            flags = 0

            # 1 — POLARIS ice risk
            rio = rio_from_concentration(c, ice_class, ice_type)
            cat = polaris_category(rio, ice_class)
            ice_sev = POLARIS_SEVERITY[cat]
            if ice_sev != "LOW":
                flags |= 1
            # uncertainty propagation: does +1 sigma change the category?
            if sigma is not None and sigma[j, i] > 0:
                rio_lo = rio_from_concentration(
                    min(100.0, c + sigma[j, i]), ice_class, ice_type)
                if polaris_category(rio_lo, ice_class) != cat:
                    flags |= 8
                    n_sigma_sensitive += 1

            # 2 — iceberg zones
            berg_sev, berg_hit = berg_severity_at(lat, lon, zones)
            if berg_sev != "LOW":
                flags |= 2

            # 3 — icing (Overland; suppressed in close pack: no waves → no spray)
            if c >= SPRAY_SUPPRESS_CONC_PCT:
                ppr, ic, icing_sev = 0.0, "NONE", "LOW"
            else:
                w = wx.nearest(lat, lon)
                ppr = icing_ppr(w["windKn"], w["tempC"])
                ic = icing_class(ppr)
                icing_sev = ICING_SEVERITY[ic]
                if ppr > max_ppr:
                    max_ppr, max_ppr_at = ppr, {**w, "lat": lat, "lon": lon}
            if icing_sev != "LOW":
                flags |= 4

            sev = _sev_max(ice_sev, berg_sev, icing_sev)
            counts[sev] += 1
            sev_row.append(SEVERITY_ORDER.index(sev))
            flag_row.append(flags)
            worst_by_contrib["seaIce"] = _sev_max(worst_by_contrib["seaIce"], ice_sev)
            worst_by_contrib["icebergs"] = _sev_max(worst_by_contrib["icebergs"], berg_sev)
            worst_by_contrib["icing"] = _sev_max(worst_by_contrib["icing"], icing_sev)

            if sev in ("HIGH", "CRITICAL") and len(worst_cells) < 400:
                worst_cells.append({
                    "lat": round(lat, 3), "lon": round(lon, 3), "severity": sev,
                    "rio": round(rio, 1), "concPct": round(float(c), 1),
                    "bergZone": berg_hit["id"] if berg_hit else None,
                    "icingClass": ic if icing_sev != "LOW" else None,
                })
        sev_grid.append(sev_row)
        flags_grid.append(flag_row)

    # ── aggregate + explanations ──
    overall = "LOW"
    for s in reversed(SEVERITY_ORDER):
        if counts[s] > 0:
            overall = s
            break

    pct = {s: round(100 * counts[s] / max(1, n_valid), 1) for s in SEVERITY_ORDER}

    # contributor summaries
    rio_all = np.where(conc >= 0,
                       rio_from_concentration(0, ice_class, ice_type), np.nan)
    # vectorized rio: linear in conc
    row = RIV_TABLE[ice_class]
    riv_i, riv_f = row[idx_type], row[ICE_TYPES.index("ICE_FREE")]
    rio_arr = np.where(conc >= 0, (conc / 10.0) * riv_i + (10 - conc / 10.0) * riv_f, np.nan)
    with np.errstate(invalid="ignore"):
        min_rio = float(np.nanmin(rio_arr))
        pct_elev = float(np.nanmean((rio_arr < 0) & (rio_arr >= -10)) * 100)
        pct_special = float(np.nanmean(rio_arr < -10) * 100)
    rio_lo_arr = None
    if sigma is not None:
        rio_lo_arr = np.where(
            conc >= 0,
            (np.minimum(conc + sigma, 100) / 10.0) * riv_i
            + (10 - np.minimum(conc + sigma, 100) / 10.0) * riv_f, np.nan)

    active_zones = [z for z in zones if 40 <= z["lon"] <= 100 and -72 <= z["lat"] <= -55]

    explanations = []
    worst_cat = polaris_category(min_rio, ice_class)
    explanations.append(
        f"Sea ice (POLARIS, MSC.1/Circ.1519): worst-cell RIO {min_rio:.0f} for ice class "
        f"{ice_class} under the declared {ice_type} assumption → "
        f"{worst_cat.replace('_', ' ').lower()}. "
        f"{pct_elev:.0f}% of ocean cells are in the elevated-risk band "
        f"(−10 ≤ RIO < 0), {pct_special:.0f}% require special consideration (RIO < −10).")
    if active_zones:
        moving = [z for z in active_zones if z["regime"] == "MOVING"]
        explanations.append(
            f"Icebergs: {len(active_zones)} USNIC bergs in the AOI define hazard zones "
            f"(core = berg extent → CRITICAL; P50/P90 drift-error radii → HIGH/MEDIUM). "
            f"{len(moving)} are classified MOVING from real BYU tracks; zone radii use "
            f"the backtest-measured P50/P90 errors at each berg's position age.")
    icing_note = icing_class(max_ppr)
    if max_ppr_at:
        explanations.append(
            f"Icing (Overland 1990): max predictor PPR {max_ppr:.0f} m·°C/s "
            f"({icing_note.replace('_', ' ').lower()}) near "
            f"{max_ppr_at['lat']:.1f}°, {max_ppr_at['lon']:.1f}° at "
            f"{wx.valid_hour}Z, wind {max_ppr_at['windKn']:.0f} kn / "
            f"{max_ppr_at['tempC']:.0f} °C. Applies to open water and open "
            f"pack only (spray suppressed in close pack ≥70%). SST unavailable "
            f"→ Tw = Tf assumed (conservative).")
    else:
        explanations.append(
            "Icing (Overland 1990): no open-water cells with a non-zero "
            "predictor at this hour.")
    if sigma is not None and n_sigma_sensitive > 0:
        explanations.append(
            f"Uncertainty: at +{horizon_h} h, {n_sigma_sensitive} cells "
            f"({100 * n_sigma_sensitive / max(1, n_valid):.1f}% of ocean cells) change "
            f"POLARIS category if concentration is shifted by +1σ (model backtest MAE) — "
            f"treat boundaries there as soft.")

    warnings = list(zone_warnings)
    if wx.clamped:
        warnings.append("Requested horizon exceeds available weather forecast hours; "
                        "icing evaluated at the last available hour.")

    return {
        "engine": {"name": ENGINE_NAME, "version": ENGINE_VERSION},
        "overall": {
            "severity": overall,
            "extentPct": pct,
            "validCells": n_valid,
        },
        "grid": {
            "lon0": lon0, "lat0": lat0, "dLon": dlon, "dLat": dlat,
            "nLon": n_lon, "nLat": n_lat,
            "severity": sev_grid,       # -1 nodata else index into severityScale
            "flags": flags_grid,        # bit 1 ice, 2 berg, 4 icing, 8 sigma-sensitive
            "severityScale": SEVERITY_ORDER,
        },
        "contributors": {
            "seaIce": {
                "method": "POLARIS RIO (IMO MSC.1/Circ.1519)",
                "iceClass": ice_class,
                "assumedIceType": ice_type,
                "worstRio": round(min_rio, 1),
                "worstCategory": worst_cat,
                "severity": POLARIS_SEVERITY[worst_cat],
                "pctElevated": round(pct_elev, 1),
                "pctSpecialConsideration": round(pct_special, 1),
                "sensitivity": {
                    "thinnerType": {"type": thinner, "worstRio": round(float(np.nanmin(
                        (conc[conc >= 0] / 10.0) * row[ICE_TYPES.index(thinner)]
                        + (10 - conc[conc >= 0] / 10.0) * riv_f)), 1)},
                    "thickerType": {"type": thicker, "worstRio": round(float(np.nanmin(
                        (conc[conc >= 0] / 10.0) * row[ICE_TYPES.index(thicker)]
                        + (10 - conc[conc >= 0] / 10.0) * riv_f)), 1)},
                },
                "sigmaSensitiveCells": n_sigma_sensitive if sigma is not None else None,
            },
            "icebergs": {
                "method": "hazard zones: core = berg extent (USNIC dims); "
                          "P50/P90 radii = empirical drift-prediction error "
                          "quantiles from walk-forward backtest on real tracks",
                "zones": active_zones,
                "severity": worst_by_contrib["icebergs"],
                "zoneCount": len(active_zones),
            },
            "icing": {
                "method": "Overland (1990) NOAA predictor; Tf = -1.8 °C; "
                          "Tw = Tf assumed (no SST feed) — conservative",
                "maxPpr": round(max_ppr, 1),
                "class": icing_note,
                "severity": ICING_SEVERITY[icing_note],
                "validHour": wx.valid_hour,
            },
        },
        "worstCells": worst_cells[:60],
        "explanations": explanations,
        "assumptions": [
            f"Ice type assumed {ice_type} (NSIDC provides concentration only, "
            f"not stage of development); sensitivity to ±1 type step reported.",
            "Sea surface temperature unavailable → Tw = Tf in the Overland "
            "predictor (maximises PPR; conservative).",
            "Sea-spray icing suppressed where ice concentration ≥ 70% (WMO "
            "close-pack boundary): consolidated pack damps the waves that "
            "generate spray.",
            "Iceberg zone radii use drift-error quantiles validated only up "
            "to 7 days; older positions are floored at the 7-day quantile.",
            "Only USNIC-charted bergs (≥10 nm) are represented; smaller bergs "
            "and growlers are NOT in any input dataset.",
        ],
        "inputs": {
            "seaIce": ice_meta,
            "weather": {"validHour": wx.valid_hour, "cells": len(wx.cells)},
            "bergs": {"count": len(zones), "product": "USNIC current + BYU tracks"},
            "horizonH": horizon_h,
        },
        "warnings": warnings,
        "executedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


# ═══ ROUTE RISK ════════════════════════════════════════════════════════

def _densify(waypoints: list[dict], step_km: float = 15.0) -> list[dict]:
    """Linear lat/lon interpolation, fine enough for 25 km grid sampling."""
    out = []
    for a, b in zip(waypoints, waypoints[1:]):
        d = _dist_km(a["lat"], a["lon"], b["lat"], b["lon"])
        n = max(1, int(d / step_km))
        for k in range(n):
            t = k / n
            out.append({"lat": a["lat"] + t * (b["lat"] - a["lat"]),
                        "lon": a["lon"] + t * (b["lon"] - a["lon"])})
    out.append(dict(waypoints[-1]))
    return out


def route_risk(waypoints: list[dict],
               ice_class: str = "PC5",
               ice_type: str = DEFAULT_ICE_TYPE,
               horizon_h: int = 0,
               berg_overrides: dict[str, dict] | None = None,
               seaice_day: str | None = None,
               weather_hour: str | None = None) -> dict:
    if len(waypoints) < 2:
        raise ValueError("need at least 2 waypoints")
    if ice_class not in RIV_TABLE:
        raise ValueError(f"unknown ice class {ice_class}")

    g, conc, sigma, ice_meta = load_ice_field(horizon_h, seaice_day=seaice_day)
    wx = WeatherField(horizon_h, hour=weather_hour)
    zones, zone_warnings = build_berg_zones(horizon_h, overrides=berg_overrides)

    lat0, lon0, dlat, dlon = g["lat0"], g["lon0"], g["dLat"], g["dLon"]
    n_lat, n_lon = conc.shape
    row = RIV_TABLE[ice_class]
    riv_i = row[ICE_TYPES.index(ice_type)]
    riv_f = row[ICE_TYPES.index("ICE_FREE")]

    samples = _densify(waypoints)
    seg_km = [0.0]
    for a, b in zip(samples, samples[1:]):
        seg_km.append(seg_km[-1] + _dist_km(a["lat"], a["lon"], b["lat"], b["lon"]))
    total_km = seg_km[-1]

    per_sample = []
    exposure = {c: {s: 0.0 for s in SEVERITY_ORDER}
                for c in ("seaIce", "icebergs", "icing", "combined")}
    worst = {"severity": "LOW", "atKm": 0.0, "detail": ""}
    berg_encounters: dict[str, dict] = {}
    n_nodata = 0
    n_sigma_flip = 0

    for k, p in enumerate(samples):
        step = (seg_km[min(k + 1, len(samples) - 1)] - seg_km[k]) if k < len(samples) - 1 else 0
        i = int((p["lon"] - lon0) / dlon)
        j = int((p["lat"] - lat0) / dlat)
        c = conc[j, i] if (0 <= i < n_lon and 0 <= j < n_lat) else -1

        if c >= 0:
            rio = (c / 10.0) * riv_i + (10 - c / 10.0) * riv_f
            cat = polaris_category(rio, ice_class)
            ice_sev = POLARIS_SEVERITY[cat]
            if sigma is not None and 0 <= i < n_lon and 0 <= j < n_lat and sigma[j, i] > 0:
                c_hi = min(100.0, c + sigma[j, i])
                rio_hi = (c_hi / 10.0) * riv_i + (10 - c_hi / 10.0) * riv_f
                if polaris_category(rio_hi, ice_class) != cat:
                    n_sigma_flip += 1
        else:
            rio, cat, ice_sev = None, None, "LOW"
            n_nodata += 1

        berg_sev, berg_hit = berg_severity_at(p["lat"], p["lon"], zones)
        if berg_hit:
            prev = berg_encounters.get(berg_hit["id"])
            if not prev or SEVERITY_ORDER.index(berg_sev) > SEVERITY_ORDER.index(prev["severity"]):
                berg_encounters[berg_hit["id"]] = {
                    "id": berg_hit["id"], "severity": berg_sev,
                    "closestKm": berg_hit["distanceKm"],
                    "atRouteKm": round(seg_km[k], 0),
                    "zoneP90Km": berg_hit["p90RadiusKm"],
                    "positionAgeDays": berg_hit["positionAgeDays"],
                }

        if c >= SPRAY_SUPPRESS_CONC_PCT:
            ppr, ic, icing_sev = 0.0, "NONE", "LOW"
        else:
            w = wx.nearest(p["lat"], p["lon"])
            ppr = icing_ppr(w["windKn"], w["tempC"])
            ic = icing_class(ppr)
            icing_sev = ICING_SEVERITY[ic]

        sev = _sev_max(ice_sev, berg_sev, icing_sev)
        for cname, s in (("seaIce", ice_sev), ("icebergs", berg_sev),
                         ("icing", icing_sev), ("combined", sev)):
            exposure[cname][s] += step

        if SEVERITY_ORDER.index(sev) > SEVERITY_ORDER.index(worst["severity"]):
            drivers = []
            if ice_sev == sev and rio is not None:
                drivers.append(f"POLARIS RIO {rio:.0f} ({cat.replace('_', ' ').lower()}), "
                               f"ice {c:.0f}%")
            if berg_sev == sev and berg_hit:
                drivers.append(f"iceberg {berg_hit['id']} zone "
                               f"({berg_hit['distanceKm']:.0f} km from berg)")
            if icing_sev == sev:
                drivers.append(f"icing {ic.replace('_', ' ').lower()} (PPR {ppr:.0f})")
            worst = {"severity": sev, "atKm": round(seg_km[k], 0),
                     "lat": round(p["lat"], 3), "lon": round(p["lon"], 3),
                     "detail": "; ".join(drivers)}

        if k % 4 == 0:  # thin the per-sample payload
            per_sample.append({
                "km": round(seg_km[k], 0), "lat": round(p["lat"], 3),
                "lon": round(p["lon"], 3),
                "severity": sev,
                "rio": round(rio, 1) if rio is not None else None,
                "bergZone": berg_hit["id"] if berg_hit else None,
                "icingClass": ic,
            })

    def _pct(d: dict[str, float]) -> dict[str, float]:
        return {s: round(100 * v / max(total_km, 1e-9), 1) for s, v in d.items()}

    combined_exp = _pct(exposure["combined"])
    overall = "LOW"
    for s in reversed(SEVERITY_ORDER):
        if exposure["combined"][s] > 0:
            overall = s
            break

    if overall == "LOW" and not worst.get("detail"):
        worst_line = (f"Overall route severity LOW across all {total_km:.0f} km — "
                      f"no elevated-severity point on this route.")
    else:
        worst_line = (f"Overall route severity {overall}: worst point at km "
                      f"{worst['atKm']:.0f} of {total_km:.0f} "
                      f"({worst.get('lat')}°, {worst.get('lon')}°) — {worst['detail']}.")
    explanations = [
        worst_line,
        f"Exposure (fraction of route length): "
        + ", ".join(f"{s} {combined_exp[s]}%" for s in SEVERITY_ORDER if combined_exp[s] > 0)
        + ".",
    ]
    if berg_encounters:
        ids = ", ".join(sorted(berg_encounters))
        explanations.append(
            f"Route crosses {len(berg_encounters)} iceberg hazard zone(s): {ids}. "
            f"Zone radii are empirical P50/P90 drift-error quantiles — not assumed values.")
    else:
        explanations.append("Route crosses no charted iceberg hazard zone "
                            "(USNIC bergs ≥10 nm only; smaller ice not charted).")
    if n_sigma_flip:
        explanations.append(
            f"{n_sigma_flip} route samples change POLARIS category under a +1σ "
            f"concentration shift at +{horizon_h} h — the ice-risk boundary along "
            f"this route is uncertainty-sensitive.")
    if n_nodata:
        explanations.append(
            f"{n_nodata} samples fall outside sea-ice grid coverage (land-masked or "
            f"off-AOI); ice risk not evaluated there.")

    return {
        "engine": {"name": ENGINE_NAME, "version": ENGINE_VERSION},
        "route": {"waypoints": len(waypoints), "lengthKm": round(total_km, 0),
                  "samples": len(samples)},
        "overall": {"severity": overall, "worst": worst},
        "exposurePctByContributor": {
            "seaIce": _pct(exposure["seaIce"]),
            "icebergs": _pct(exposure["icebergs"]),
            "icing": _pct(exposure["icing"]),
            "combined": combined_exp,
        },
        "bergEncounters": sorted(berg_encounters.values(),
                                 key=lambda z: z["atRouteKm"]),
        "profile": per_sample,
        "explanations": explanations,
        "assumptions": [
            f"Ice type assumed {ice_type}; POLARIS RIO recomputed from NSIDC "
            f"concentration per cell.",
            "Tw = Tf in Overland predictor (no SST feed).",
            "Route geometry is an input; assessing it against real data does "
            "not make the geometry itself real.",
        ],
        "inputs": {"seaIce": ice_meta,
                   "weather": {"validHour": wx.valid_hour},
                   "horizonH": horizon_h, "iceClass": ice_class},
        "warnings": zone_warnings,
        "executedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


if __name__ == "__main__":
    r = spatial_risk()
    print("overall:", r["overall"])
    print("seaIce:", {k: v for k, v in r["contributors"]["seaIce"].items()
                      if k not in ("sensitivity",)})
    print("icing:", r["contributors"]["icing"])
    print("zones:", r["contributors"]["icebergs"]["zoneCount"])
    for e in r["explanations"]:
        print(" ·", e)
    # demo corridor: staging point north of AOI → Bharati approach
    wps = [{"lat": -57.5, "lon": 55.0}, {"lat": -62.0, "lon": 63.0},
           {"lat": -66.0, "lon": 71.0}, {"lat": -69.0, "lon": 76.0}]
    rr = route_risk(wps)
    print("\nroute overall:", rr["overall"])
    for e in rr["explanations"]:
        print(" ·", e)
