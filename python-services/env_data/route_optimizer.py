"""Route optimization engine — severity-constrained shortest paths.

DESIGN RULE (same as risk engine): no invented numbers.

  · There is NO weighted cost function ("distance + λ·risk" needs an
    arbitrary λ). Instead, each profile is a pure SHORTEST PATH subject to a
    SEVERITY CEILING — the maximum risk-engine severity it is willing to
    transit:

      DIRECT        ceiling HIGH     (refuses only CRITICAL: POLARIS
                                      'special consideration' + berg cores)
      BALANCED      ceiling MEDIUM   (additionally refuses HIGH: POLARIS
                                      'elevated risk' + berg P50 zones,
                                      per MSC.1/Circ.1519 §1.4.5 voyage
                                      planning should avoid elevated risk)
      CONSERVATIVE  ceiling LOW      (transits only cells with no elevated
                                      hazard at all)

    Ceilings are category exclusions on the published/empirical severity
    surface — no tuning knobs. If a ceiling makes the corridor infeasible,
    the profile is reported INFEASIBLE, not silently relaxed.

  · Speed model (published): cruise speed in cells at NORMAL operation;
    POLARIS Table 1.2 recommended limits in ELEVATED-risk cells
    (PC1 11 kn, PC2 8 kn, PC3-PC5 5 kn, below PC5 3 kn). CRITICAL cells are
    never transited.

  · Fuel: NOT computed. No validated fuel-consumption model for this vessel
    exists in the system; returning a number would violate the honesty rule.
    The response says so explicitly.

  · Recommendation rule (documented, anchored to IMO): recommend the
    shortest-time route with ZERO exposure to HIGH or CRITICAL severity
    (MSC.1/Circ.1519 §1.4.5: voyage planning should avoid areas of elevated
    risk). If no route achieves that, recommend the one with the least
    HIGH+CRITICAL exposure and say so.
"""

from __future__ import annotations

import heapq
import math
from datetime import datetime, timezone

from .risk_engine import (
    RIV_TABLE, SEVERITY_ORDER, route_risk, spatial_risk,
)

OPTIMIZER_NAME = "severity-ceiling-astar"
OPTIMIZER_VERSION = "0.1.0"

# POLARIS Table 1.2 — recommended speed limits, elevated-risk operation.
ELEVATED_SPEED_KN: dict[str, float] = {
    "PC1": 11.0, "PC2": 8.0, "PC3": 5.0, "PC4": 5.0, "PC5": 5.0,
}
BELOW_PC5_ELEVATED_KN = 3.0

PROFILES = [
    {"id": "DIRECT", "label": "Shortest feasible", "ceiling": "HIGH",
     "excludes": "CRITICAL cells only (POLARIS special consideration; berg core zones)"},
    {"id": "BALANCED", "label": "Risk-aware", "ceiling": "MEDIUM",
     "excludes": "CRITICAL + HIGH cells (POLARIS elevated risk; berg P50 zones; moderate icing)"},
    {"id": "CONSERVATIVE", "label": "Conservative", "ceiling": "LOW",
     "excludes": "everything above LOW (adds berg P90 zones; light icing)"},
]


def elevated_speed_kn(ice_class: str) -> float:
    return ELEVATED_SPEED_KN.get(ice_class, BELOW_PC5_ELEVATED_KN)


def _dist_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2)
         * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


# ── grid graph ─────────────────────────────────────────────────────────

class Grid:
    def __init__(self, risk_doc: dict):
        g = risk_doc["grid"]
        self.lon0, self.lat0 = g["lon0"], g["lat0"]
        self.dlon, self.dlat = g["dLon"], g["dLat"]
        self.n_lon, self.n_lat = g["nLon"], g["nLat"]
        self.sev = g["severity"]            # -1 nodata else ordinal

    def cell_of(self, lat: float, lon: float) -> tuple[int, int] | None:
        i = int((lon - self.lon0) / self.dlon)
        j = int((lat - self.lat0) / self.dlat)
        if 0 <= i < self.n_lon and 0 <= j < self.n_lat:
            return j, i
        return None

    def center(self, j: int, i: int) -> tuple[float, float]:
        return (self.lat0 + j * self.dlat + self.dlat / 2,
                self.lon0 + i * self.dlon + self.dlon / 2)

    def nearest_ok(self, lat: float, lon: float, max_sev: int) -> tuple[int, int] | None:
        """Snap to the nearest transitable cell (spiral search)."""
        c = self.cell_of(lat, lon)
        if c is None:
            return None
        j0, i0 = c
        best, best_d = None, float("inf")
        for dj in range(-8, 9):
            for di in range(-8, 9):
                j, i = j0 + dj, i0 + di
                if not (0 <= i < self.n_lon and 0 <= j < self.n_lat):
                    continue
                s = self.sev[j][i]
                if s < 0 or s > max_sev:
                    continue
                clat, clon = self.center(j, i)
                d = _dist_km(lat, lon, clat, clon)
                if d < best_d:
                    best, best_d = (j, i), d
        return best


def astar(grid: Grid, start: tuple[int, int], goal: tuple[int, int],
          max_sev: int) -> list[tuple[int, int]] | None:
    """Shortest great-circle path over 8-connected transitable cells."""
    glat, glon = grid.center(*goal)

    def h(j: int, i: int) -> float:
        clat, clon = grid.center(j, i)
        return _dist_km(clat, clon, glat, glon)

    open_q: list[tuple[float, float, tuple[int, int]]] = []
    heapq.heappush(open_q, (h(*start), 0.0, start))
    g_cost = {start: 0.0}
    came: dict[tuple[int, int], tuple[int, int]] = {}

    while open_q:
        _, g_here, node = heapq.heappop(open_q)
        if node == goal:
            path = [node]
            while node in came:
                node = came[node]
                path.append(node)
            return path[::-1]
        if g_here > g_cost.get(node, float("inf")):
            continue
        j, i = node
        lat1, lon1 = grid.center(j, i)
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                if dj == 0 and di == 0:
                    continue
                nj, ni = j + dj, i + di
                if not (0 <= ni < grid.n_lon and 0 <= nj < grid.n_lat):
                    continue
                s = grid.sev[nj][ni]
                if s < 0 or s > max_sev:
                    continue
                if dj != 0 and di != 0:
                    # no corner cutting: a diagonal move must not brush an
                    # excluded orthogonal neighbour
                    s1 = grid.sev[j][ni]
                    s2 = grid.sev[nj][i]
                    if s1 < 0 or s1 > max_sev or s2 < 0 or s2 > max_sev:
                        continue
                lat2, lon2 = grid.center(nj, ni)
                ng = g_here + _dist_km(lat1, lon1, lat2, lon2)
                if ng < g_cost.get((nj, ni), float("inf")):
                    g_cost[(nj, ni)] = ng
                    came[(nj, ni)] = node
                    heapq.heappush(open_q, (ng + h(nj, ni), ng, (nj, ni)))
    return None


def simplify(points: list[dict], tol_km: float = 8.0) -> list[dict]:
    """Douglas–Peucker on lat/lon points (approx planar at these scales)."""
    if len(points) < 3:
        return points

    def seg_dist(p, a, b) -> float:
        # cross-track approximation via projected planar coords
        kx = 111.32 * math.cos(math.radians((a["lat"] + b["lat"]) / 2))
        ax, ay = a["lon"] * kx, a["lat"] * 110.57
        bx, by = b["lon"] * kx, b["lat"] * 110.57
        px, py = p["lon"] * kx, p["lat"] * 110.57
        dx, dy = bx - ax, by - ay
        if dx == dy == 0:
            return math.hypot(px - ax, py - ay)
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    def dp(pts):
        if len(pts) < 3:
            return pts
        dmax, idx = 0.0, 0
        for k in range(1, len(pts) - 1):
            d = seg_dist(pts[k], pts[0], pts[-1])
            if d > dmax:
                dmax, idx = d, k
        if dmax > tol_km:
            left = dp(pts[: idx + 1])
            return left[:-1] + dp(pts[idx:])
        return [pts[0], pts[-1]]

    return dp(points)


# ── optimization ───────────────────────────────────────────────────────

def optimize(origin: dict, destination: dict,
             ice_class: str = "PC5",
             cruise_speed_kn: float = 12.5,
             horizon_h: int = 0,
             berg_overrides: dict[str, dict] | None = None,
             seaice_day: str | None = None,
             weather_hour: str | None = None) -> dict:
    """`seaice_day` / `weather_hour` pin the risk surface to a resolved
    mission time (see time_resolver) instead of the horizon-relative
    default. Data is only ever selected from the normalized store."""
    if ice_class not in RIV_TABLE:
        raise ValueError(f"unknown ice class {ice_class}")
    if not (3.0 <= cruise_speed_kn <= 30.0):
        raise ValueError("cruise_speed_kn out of plausible range (3-30)")

    risk = spatial_risk(ice_class=ice_class, horizon_h=horizon_h,
                        berg_overrides=berg_overrides,
                        seaice_day=seaice_day, weather_hour=weather_hour)
    grid = Grid(risk)
    elev_kn = elevated_speed_kn(ice_class)

    routes = []
    for prof in PROFILES:
        ceiling_idx = SEVERITY_ORDER.index(prof["ceiling"])
        start = grid.nearest_ok(origin["lat"], origin["lon"], ceiling_idx)
        goal = grid.nearest_ok(destination["lat"], destination["lon"], ceiling_idx)
        entry: dict = {
            "profile": prof["id"],
            "label": prof["label"],
            "severityCeiling": prof["ceiling"],
            "excludes": prof["excludes"],
        }
        if start is None or goal is None:
            entry.update({"status": "INFEASIBLE",
                          "reason": "origin or destination has no transitable "
                                    f"cell at ceiling {prof['ceiling']} nearby"})
            routes.append(entry)
            continue

        path = astar(grid, start, goal, ceiling_idx)
        if path is None:
            entry.update({"status": "INFEASIBLE",
                          "reason": f"no continuous corridor exists at severity "
                                    f"ceiling {prof['ceiling']} between the "
                                    f"snapped endpoints"})
            routes.append(entry)
            continue

        # geometry: true endpoints + cell centres, simplified for display
        cells = [{"lat": grid.center(j, i)[0], "lon": grid.center(j, i)[1],
                  "sev": grid.sev[j][i]} for j, i in path]
        raw_pts = ([{"lat": origin["lat"], "lon": origin["lon"]}]
                   + [{"lat": c["lat"], "lon": c["lon"]} for c in cells]
                   + [{"lat": destination["lat"], "lon": destination["lon"]}])
        waypoints = simplify(raw_pts)

        # distance + time from the actual cell path (per-cell POLARIS speeds)
        dist_km, time_h = 0.0, 0.0
        slow_km = 0.0
        prev = raw_pts[0]
        for k, c in enumerate(cells):
            d = _dist_km(prev["lat"], prev["lon"], c["lat"], c["lon"])
            sev = SEVERITY_ORDER[c["sev"]]
            speed = elev_kn if sev == "HIGH" else cruise_speed_kn
            if sev == "HIGH":
                slow_km += d
            dist_km += d
            time_h += d / (speed * 1.852)
            prev = c
        d_last = _dist_km(prev["lat"], prev["lon"],
                          destination["lat"], destination["lon"])
        dist_km += d_last
        time_h += d_last / (cruise_speed_kn * 1.852)

        # full risk assessment of the generated geometry — same engine that
        # scores everything else, so route metrics stay consistent
        rr = route_risk(waypoints, ice_class=ice_class, horizon_h=horizon_h,
                        berg_overrides=berg_overrides,
                        seaice_day=seaice_day, weather_hour=weather_hour)

        # endpoint honesty: if the requested endpoints had to be snapped, the
        # first/last legs may exceed the profile ceiling — say so explicitly.
        notes = []
        slat, slon = grid.center(*start)
        glat2, glon2 = grid.center(*goal)
        snap_o = _dist_km(origin["lat"], origin["lon"], slat, slon)
        snap_d = _dist_km(destination["lat"], destination["lon"], glat2, glon2)
        ceiling_pct = sum(
            rr["exposurePctByContributor"]["combined"].get(s, 0.0)
            for s in SEVERITY_ORDER[ceiling_idx + 1:])
        if ceiling_pct > 0:
            if snap_o > 1 or snap_d > 1:
                notes.append(
                    f"{ceiling_pct:.1f}% of route length exceeds the {prof['ceiling']} "
                    f"ceiling: the requested origin/destination lie inside or near "
                    f"excluded cells (snapped {snap_o:.0f} km / {snap_d:.0f} km), so "
                    f"the first/last approach legs cross them. The corridor between "
                    f"snapped points respects the ceiling.")
            else:
                notes.append(
                    f"{ceiling_pct:.1f}% of route length exceeds the {prof['ceiling']} "
                    f"ceiling: a hazard zone smaller than a grid cell (~14×28 km) "
                    f"crosses the route between cell centres. The dense route "
                    f"assessment detects it even though the planning grid cannot "
                    f"resolve it — exposure quantified, not hidden.")

        entry.update({
            "status": "OK",
            "waypoints": waypoints,
            "distanceNm": round(dist_km / 1.852, 0),
            "distanceKm": round(dist_km, 0),
            "estTimeH": round(time_h, 1),
            "timeModel": {
                "cruiseSpeedKn": cruise_speed_kn,
                "elevatedSpeedKn": elev_kn,
                "elevatedSpeedSource": "POLARIS Table 1.2 (MSC.1/Circ.1519)",
                "kmAtElevatedSpeed": round(slow_km, 0),
            },
            "fuelEstimate": None,
            "fuelNote": "NOT COMPUTED — no validated fuel-consumption model "
                        "for this vessel is available; an invented burn rate "
                        "would violate the data-honesty rule.",
            "notes": notes,
            "risk": {
                "overallSeverity": rr["overall"]["severity"],
                "worst": rr["overall"]["worst"],
                "exposurePct": rr["exposurePctByContributor"]["combined"],
                "exposureByContributor": rr["exposurePctByContributor"],
                "bergEncounters": rr["bergEncounters"],
                "explanations": rr["explanations"],
            },
        })
        routes.append(entry)

    # ── recommendation (documented rule, IMO-anchored) ──
    def high_plus_exposure(r: dict) -> float:
        e = r["risk"]["exposurePct"]
        return e.get("HIGH", 0.0) + e.get("CRITICAL", 0.0)

    ok_routes = [r for r in routes if r["status"] == "OK"]
    recommended, reason = None, None
    clean = [r for r in ok_routes if high_plus_exposure(r) == 0.0]
    if clean:
        recommended = min(clean, key=lambda r: r["estTimeH"])
        others = [r for r in clean if r is not recommended]
        cmp = ""
        if others:
            alt = min(others, key=lambda r: r["estTimeH"])
            cmp = (f" It is {alt['estTimeH'] - recommended['estTimeH']:.1f} h "
                   f"faster than the next zero-exposure alternative "
                   f"({alt['profile']}).")
        direct = next((r for r in ok_routes if r["profile"] == "DIRECT"), None)
        vs_direct = ""
        if direct and direct is not recommended:
            vs_direct = (f" Versus DIRECT it adds "
                         f"{recommended['distanceNm'] - direct['distanceNm']:.0f} nm / "
                         f"{recommended['estTimeH'] - direct['estTimeH']:.1f} h but "
                         f"eliminates {high_plus_exposure(direct):.1f}% of route "
                         f"length at HIGH/CRITICAL severity.")
        reason = (f"{recommended['profile']} is the shortest-time route with zero "
                  f"HIGH/CRITICAL exposure. MSC.1/Circ.1519 §1.4.5: voyage planning "
                  f"should avoid areas with elevated-risk potential.{cmp}{vs_direct}")
    elif ok_routes:
        recommended = min(ok_routes, key=high_plus_exposure)
        reason = (f"No feasible route achieves zero HIGH/CRITICAL exposure; "
                  f"{recommended['profile']} minimises it "
                  f"({high_plus_exposure(recommended):.1f}% of route length). "
                  f"Operator judgement required.")

    for r in routes:
        r["recommended"] = (r is recommended)

    return {
        "optimizer": {"name": OPTIMIZER_NAME, "version": OPTIMIZER_VERSION,
                      "method": "A* shortest path per profile; profiles are "
                                "severity-ceiling exclusions on the risk "
                                "surface — no weighted cost blending"},
        "request": {"origin": origin, "destination": destination,
                    "iceClass": ice_class, "cruiseSpeedKn": cruise_speed_kn,
                    "horizonH": horizon_h},
        "riskSurface": {"engine": risk["engine"],
                        "seaIce": risk["inputs"]["seaIce"],
                        "weatherHour": risk["inputs"]["weather"]["validHour"]},
        "routes": routes,
        "recommendation": {
            "profile": recommended["profile"] if recommended else None,
            "reason": reason or "No feasible route at any severity ceiling.",
            "rule": "shortest time among routes with zero HIGH/CRITICAL "
                    "exposure (IMO MSC.1/Circ.1519 §1.4.5); decision support "
                    "only — the operator decides",
        },
        "assumptions": [
            "Grid resolution 0.5°×0.25° (~14×28 km); routes follow cell "
            "centres and are simplified for display — not a nautical chart "
            "product.",
            "Speeds: operator cruise speed in normal-operation cells; POLARIS "
            "Table 1.2 recommended limits in elevated-risk cells.",
            "Fuel intentionally not estimated (no validated consumption model).",
            "Severity surface inherits all declared risk-engine assumptions "
            "(ice type, Tw=Tf, ≥10 nm bergs only).",
        ] + risk["assumptions"],
        "warnings": risk["warnings"],
        "executedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


if __name__ == "__main__":
    res = optimize({"lat": -57.5, "lon": 60.0}, {"lat": -69.35, "lon": 76.19})
    for r in res["routes"]:
        if r["status"] == "OK":
            print(f"{r['profile']:13s} {r['status']:4s} {r['distanceNm']:6.0f} nm "
                  f"{r['estTimeH']:6.1f} h  sev {r['risk']['overallSeverity']:8s} "
                  f"exp {r['risk']['exposurePct']}  wpts {len(r['waypoints'])}"
                  + ("  << RECOMMENDED" if r["recommended"] else ""))
        else:
            print(f"{r['profile']:13s} {r['status']} — {r['reason']}")
    print("\nreason:", res["recommendation"]["reason"])
