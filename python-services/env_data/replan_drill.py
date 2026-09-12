"""Dynamic re-planning drill — a DETERMINISTIC demonstration scenario.

What is real and what is simulated (constitution rule: never mixed silently):

  REAL      sea-ice field, weather, all other berg positions, POLARIS/icing
            risk mathematics, backtest quantiles, A* optimizer, every number
            on every route.
  SIMULATED exactly ONE fact: iceberg D23 is "re-sighted" 40 km NW of its
            USNIC charted position, moving — a scripted deviation injected
            through build_berg_zones(overrides=...). Every payload touching
            it carries simulated=True and a SIMULATION warning.

There is no randomness anywhere: same inputs -> same document, byte-for-byte
except the executedAt timestamp. The document contains the whole timeline;
the frontend steps through it — the operator (a human) advances the stages
and makes the accept decisions. The system never auto-accepts a route.

Scenario beats (mirrors the SIH demonstration script):
  1  MISSION_START      initial conditions + initial route alternatives
  2  ROUTE_ACCEPTED     operator selects the recommended route
  3  UNDERWAY           +24 h at cruise speed along the accepted route
  4  BERG_DEVIATION     SIMULATED D23 re-sighting (the injected fact)
  5  CONFLICT_DETECTED  remaining leg re-assessed -> severity jumps; ALERT
  6  REPLAN             fresh optimization from the vessel's position
  7  DECISION_PENDING   old vs new side by side; operator must accept
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

from .risk_engine import build_berg_zones, route_risk
from .route_optimizer import optimize

DRILL_NAME = "replan-drill"
DRILL_VERSION = "0.1.0"

# ── the scripted scenario (all constants, no randomness) ───────────────

ORIGIN = {"lat": -57.5, "lon": 60.0}          # Southern Ocean staging point
DEST = {"lat": -69.35, "lon": 76.19}          # Bharati approach, Prydz Bay
ICE_CLASS = "PC5"
CRUISE_KN = 12.5
ADVANCE_H = 24

SIM_BERG_ID = "D23"
# Chosen to sit exactly on a risk-grid cell centre astride the T+0 corridor
# (~100 km N of the real charted position: the drill story is that D23
# ungrounds and drifts north into the shipping corridor).
SIM_BERG_POS = {"lat": -68.625, "lon": 75.75}
SIM_NOTE = ("SIMULATED re-sighting for the re-planning drill — NOT the real "
            "USNIC position. Drill story: D23 ungrounds and drifts ~100 km "
            "north into the corridor; reclassified MOVING.")

BERG_OVERRIDES = {
    SIM_BERG_ID: {
        "lat": SIM_BERG_POS["lat"], "lon": SIM_BERG_POS["lon"],
        "regime": "MOVING", "positionAgeDays": 2.0, "note": SIM_NOTE,
    }
}

_cache: dict | None = None


def _dist_km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2)
         * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def _position_along(waypoints: list[dict], target_km: float
                    ) -> tuple[dict, list[dict], float]:
    """Point at target_km along the polyline + remaining waypoints."""
    acc = 0.0
    for a, b in zip(waypoints, waypoints[1:]):
        seg = _dist_km(a["lat"], a["lon"], b["lat"], b["lon"])
        if acc + seg >= target_km and seg > 0:
            f = (target_km - acc) / seg
            pos = {"lat": round(a["lat"] + f * (b["lat"] - a["lat"]), 4),
                   "lon": round(a["lon"] + f * (b["lon"] - a["lon"]), 4)}
            idx = waypoints.index(b)
            return pos, [pos] + waypoints[idx:], target_km
        acc += seg
    return dict(waypoints[-1]), [dict(waypoints[-1])], acc


def _route_summary(r: dict) -> dict:
    return {
        "profile": r["profile"],
        "distanceNm": r["distanceNm"],
        "estTimeH": r["estTimeH"],
        "overallSeverity": r["risk"]["overallSeverity"],
        "exposurePct": r["risk"]["exposurePct"],
        "bergEncounters": [b["id"] for b in r["risk"]["bergEncounters"]],
    }


def run_drill() -> dict:
    global _cache
    if _cache is not None:
        return _cache

    # ── stage 1: initial plan on the REAL state ──
    plan0 = optimize(ORIGIN, DEST, ice_class=ICE_CLASS,
                     cruise_speed_kn=CRUISE_KN, horizon_h=0)
    rec0 = plan0["recommendation"]["profile"]
    accepted = next(r for r in plan0["routes"] if r["profile"] == rec0)

    # ── stage 3: vessel position after ADVANCE_H at cruise speed ──
    covered_km = CRUISE_KN * 1.852 * ADVANCE_H
    vessel_pos, remaining_wpts, covered_km = _position_along(
        accepted["waypoints"], covered_km)

    # simulated D23 hazard zone geometry (for map display)
    zones_after, _zw = build_berg_zones(0, overrides=BERG_OVERRIDES)
    sim_zone = next(z for z in zones_after if z["id"] == SIM_BERG_ID)

    # ── stage 5: remaining leg, before vs after the simulated deviation ──
    risk_before = route_risk(remaining_wpts, ice_class=ICE_CLASS, horizon_h=0)
    risk_after = route_risk(remaining_wpts, ice_class=ICE_CLASS, horizon_h=0,
                            berg_overrides=BERG_OVERRIDES)
    sev_b = risk_before["overall"]["severity"]
    sev_a = risk_after["overall"]["severity"]
    d23_after = next((b for b in risk_after["bergEncounters"]
                      if b["id"] == SIM_BERG_ID), None)

    # ── stage 6: re-optimize from the vessel's live position ──
    plan1 = optimize(vessel_pos, DEST, ice_class=ICE_CLASS,
                     cruise_speed_kn=CRUISE_KN, horizon_h=0,
                     berg_overrides=BERG_OVERRIDES)
    rec1 = plan1["recommendation"]["profile"]
    new_route = next((r for r in plan1["routes"] if r["profile"] == rec1), None)
    # what the OLD profile looks like under the new conditions (for the diff)
    old_profile_now = next((r for r in plan1["routes"]
                            if r["profile"] == rec0 and r["status"] == "OK"), None)

    hc = lambda r: (r["risk"]["exposurePct"]["HIGH"]                  # noqa: E731
                    + r["risk"]["exposurePct"]["CRITICAL"])

    why_changed = [
        f"At mission start, {rec0} was recommended: the whole corridor was LOW "
        f"severity and {rec0} was the shortest-time zero-exposure option.",
        f"SIMULATED input: {SIM_BERG_ID} re-sighted at "
        f"{SIM_BERG_POS['lat']}°, {SIM_BERG_POS['lon']}° (~100 km north of "
        f"charted — ungrounded, reclassified MOVING). Its hazard zone was "
        f"rebuilt with the real backtest quantiles for a 2-day-old MOVING fix.",
        f"The remaining leg of the accepted route now crosses that zone: "
        f"severity {sev_b} → {sev_a}"
        + (f", closest approach {d23_after['closestKm']} km at route-km "
           f"{d23_after['atRouteKm']}" if d23_after else "") + ".",
        f"Re-optimization from the vessel's position: {rec1} is now the "
        f"shortest-time route with zero HIGH/CRITICAL exposure "
        f"(rule: MSC.1/Circ.1519 §1.4.5). "
        + (f"Staying on the old {rec0} line would keep "
           f"{hc(old_profile_now):.1f}% of the remaining distance at "
           f"HIGH/CRITICAL severity." if old_profile_now and
           hc(old_profile_now) > 0 else
           f"The old {rec0} geometry is no longer the best zero-exposure "
           f"option under the updated hazard field."),
    ]

    comparison = {
        "oldRoute": {
            "acceptedAt": "T+0h",
            "profile": rec0,
            "remainingFrom": vessel_pos,
            "remainingWaypoints": remaining_wpts,
            "riskBeforeDeviation": {
                "overallSeverity": sev_b,
                "exposurePct": risk_before["exposurePctByContributor"]["combined"],
            },
            "riskAfterDeviation": {
                "overallSeverity": sev_a,
                "exposurePct": risk_after["exposurePctByContributor"]["combined"],
                "bergEncounters": risk_after["bergEncounters"],
            },
        },
        "newRoute": _route_summary(new_route) if new_route else None,
        "delta": {
            "distanceNm": (round(new_route["distanceNm"]
                                 - risk_before["route"]["lengthKm"] / 1.852, 0)
                           if new_route else None),
            "note": "delta = new route length minus remaining length of the "
                    "old route from the vessel's current position",
        },
    }

    alert = {
        "id": "ALERT-DRILL-001",
        "severity": sev_a,
        "kind": "ROUTE_RISK_INCREASE",
        "title": f"Route risk increased: {sev_b} → {sev_a}",
        "body": (f"Simulated berg deviation: {SIM_BERG_ID} re-sighted on the "
                 f"active corridor. Remaining leg now assessed at "
                 f"{sev_a} severity"
                 + (f" (closest approach {d23_after['closestKm']} km)"
                    if d23_after else "")
                 + ". Re-planning recommended."),
        "simTime": f"T+{ADVANCE_H}h",
        "requiresOperatorAction": True,
    }

    doc = {
        "drill": {
            "name": DRILL_NAME, "version": DRILL_VERSION,
            "simulated": True,
            "simulatedFacts": [
                f"{SIM_BERG_ID} position/regime override ({SIM_NOTE})"],
            "realFacts": "sea-ice field, weather, all other bergs, POLARIS/"
                         "icing math, backtest quantiles, optimizer output",
            "deterministic": True,
        },
        "scenario": {
            "origin": ORIGIN, "destination": DEST, "iceClass": ICE_CLASS,
            "cruiseSpeedKn": CRUISE_KN, "advanceHours": ADVANCE_H,
        },
        "stages": [
            {
                "id": "MISSION_START", "simTime": "T+0h",
                "title": "Mission start — initial conditions & routes",
                "narrative": (
                    "Environmental state loaded (NSIDC ice, Open-Meteo "
                    "wind, USNIC bergs). Optimizer generated "
                    f"{sum(1 for r in plan0['routes'] if r['status'] == 'OK')} "
                    f"feasible alternatives; {rec0} recommended: "
                    + plan0["recommendation"]["reason"]),
                "data": {"plan": plan0},
            },
            {
                "id": "ROUTE_ACCEPTED", "simTime": "T+0h",
                "title": f"Operator accepts {rec0}",
                "narrative": (
                    f"Operator accepts the recommended {rec0} route: "
                    f"{accepted['distanceNm']:.0f} nm, "
                    f"est {accepted['estTimeH']:.1f} h, all-LOW corridor. "
                    f"Vessel departs."),
                "data": {"acceptedProfile": rec0,
                         "acceptedRoute": _route_summary(accepted)},
            },
            {
                "id": "UNDERWAY", "simTime": f"T+{ADVANCE_H}h",
                "title": f"T+{ADVANCE_H}h — vessel underway",
                "narrative": (
                    f"{ADVANCE_H} h at {CRUISE_KN} kn: "
                    f"{covered_km / 1.852:.0f} nm covered. Vessel at "
                    f"{vessel_pos['lat']}°, {vessel_pos['lon']}°. Route risk "
                    f"is monitored continuously against the live hazard field."),
                "data": {"vesselPosition": vessel_pos,
                         "coveredNm": round(covered_km / 1.852, 0),
                         "remainingWaypoints": remaining_wpts},
            },
            {
                "id": "BERG_DEVIATION", "simTime": f"T+{ADVANCE_H}h",
                "title": f"SIMULATED: {SIM_BERG_ID} trajectory deviation",
                "narrative": (
                    f"Simulated input: {SIM_BERG_ID} re-sighted at "
                    f"{SIM_BERG_POS['lat']}°, {SIM_BERG_POS['lon']}°, "
                    f"~100 km north of its charted position — ungrounded, "
                    f"now moving, directly on the active corridor. Its hazard "
                    f"zone is rebuilt from the drift-error statistics."),
                "data": {
                    "bergId": SIM_BERG_ID,
                    "before": {"lat": -69.44, "lon": 74.71,
                               "regime": "GROUNDED_OR_UNTRACKED"},
                    "after": {**SIM_BERG_POS, "regime": "MOVING"},
                    "zone": sim_zone,
                    "simulated": True, "note": SIM_NOTE,
                },
            },
            {
                "id": "CONFLICT_DETECTED", "simTime": f"T+{ADVANCE_H}h",
                "title": f"Conflict detected — route risk {sev_b} → {sev_a}",
                "narrative": (
                    f"Remaining leg re-assessed against the updated hazard "
                    f"field: severity rose from {sev_b} to {sev_a}. "
                    f"Alert raised; operator action required."),
                "data": {"riskBefore": comparison["oldRoute"]["riskBeforeDeviation"],
                         "riskAfter": comparison["oldRoute"]["riskAfterDeviation"],
                         "alert": alert},
            },
            {
                "id": "REPLAN", "simTime": f"T+{ADVANCE_H}h",
                "title": f"Re-planning complete — {rec1} now recommended",
                "narrative": plan1["recommendation"]["reason"],
                "data": {"plan": plan1, "comparison": comparison,
                         "whyChanged": why_changed},
            },
            {
                "id": "DECISION_PENDING", "simTime": f"T+{ADVANCE_H}h",
                "title": "Operator decision — accept new route?",
                "narrative": (
                    "Current and proposed routes are shown side by side. "
                    "Accepting switches the active route and completes the "
                    "exercise. The decision remains with the operator."),
                "data": {"proposedProfile": rec1,
                         "requiresOperatorAction": True},
            },
        ],
        "warnings": sorted(set(plan1["warnings"])),
        "executedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    _cache = doc
    return doc


if __name__ == "__main__":
    d = run_drill()
    for s in d["stages"]:
        print(f"[{s['simTime']:>6s}] {s['id']:18s} {s['title']}")
    c = d["stages"][5]["data"]["comparison"]
    print("\nOLD remaining:", c["oldRoute"]["riskBeforeDeviation"]["overallSeverity"],
          "->", c["oldRoute"]["riskAfterDeviation"]["overallSeverity"])
    print("NEW:", c["newRoute"])
    print("\nWHY:")
    for w in d["stages"][5]["data"]["whyChanged"]:
        print(" ·", w)
