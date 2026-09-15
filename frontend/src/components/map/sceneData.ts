/**
 * Store state → `SceneInput`.
 *
 * This is the *data visualisation layer*: it reads exactly the same stores and
 * fields the 2D renderer read, and translates them into scene specs. No
 * invented objects — if a dataset is absent the corresponding spec list is
 * simply empty, and the layer control says so.
 *
 * Every branch mirrors a branch that existed in the SVG/canvas renderer, so
 * DEMO mode, LIVE mode, mission workspace and the re-planning drill all keep
 * their exact previous behaviour.
 */
import { NM_TO_KM } from '../../map3d/constants';   // three-free: keeps this out of the 3D chunk
import type { BergSpec, } from '../../map3d/icebergs';
import type { RouteSpec } from '../../map3d/routes';
import type { SceneInput } from '../../map3d/PolarScene';
import type { ZoneSpec } from '../../map3d/zones';
import type { EndpointSpec, HazardMarkerSpec } from '../../map3d/overlays';
import type { WindCellSpec } from '../../map3d/weather';
import type { LayerState, SelectionType } from '../../state/store';
import type { Scenario, ScenarioSnapshot } from '../../types/domain';
import type { OptRoute, ReplanDrillData } from '../../types/env';
import type { Mission } from '../../types/mission';
import type { SimState } from '../../state/missionStore';
import { bearingDeg } from '../../lib/geo';
import { tokenColors, type TokenName } from '../../map3d/tokens';

export interface MapDataDeps {
  live: boolean;
  theme: 'dark' | 'light';
  layers: LayerState;
  selection: SelectionType;
  scenario: Scenario | null;
  snapshot: ScenarioSnapshot | null;
  /** LIVE env slices actually consumed by the map */
  env: {
    seaIceGrid: SceneInput['field'];
    riskGrid: SceneInput['field'];
    fieldMode: SceneInput['fieldMode'];
    riskEnabled: boolean;
    icebergs: { id: string; lon: number; lat: number; length_nm: number | null; width_nm: number | null }[];
    bergSituation: Map<string, {
      bearingDeg: number | null;
      track: { lon: number; lat: number }[] | null;
      prediction: { lon: number; lat: number; corridorKm: number | null }[] | null;
      moving: boolean;
    }>;
    focusBergId: string | null;
    showBergPredictions: boolean;
    zones: ZoneSpec[];
    wind: WindCellSpec[];
    optRoutes: OptRoute[] | null;
    optOrigin: { lat: number; lon: number } | null;
    optDestination: { lat: number; lon: number } | null;
    selectedRouteProfile: string | null;
    drill: DrillView | null;
    error: boolean;
  };
  mission: {
    active: boolean;
    mission: Mission | null;
    sim: SimState | null;
    candidatePlan: OptRoute[] | null;
    selectedProfile: string | null;
    reviewWorstAt: { lat?: number; lon?: number } | null;
  };
  animate: SceneInput['animate'];
}

export interface DrillView {
  stage: number;
  accepted: boolean;
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  planRoutes: OptRoute[] | null;
  acceptedRoute: OptRoute | null;
  vesselPosition: { lat: number; lon: number } | null;
  vesselName: string;
  coveredNm: number | null;
  berg: { id: string; before: { lat: number; lon: number }; after: { lat: number; lon: number }; zone: ZoneSpec | null } | null;
  newRoute: OptRoute | null;
  conflict: boolean;
}

const VESSEL_LENGTH_KM = 0.14; // ~140 m icebreaker (true length; clamped on screen)

function col(t: TokenName, theme: 'dark' | 'light'): number {
  return tokenColors(theme)[t];
}

/** Demo route styles — identical semantics to the previous SVG renderer. */
function demoRoutes(snapshot: ScenarioSnapshot, layers: LayerState, selection: SelectionType, theme: 'dark' | 'light'): RouteSpec[] {
  if (!layers.routes) return [];
  return snapshot.routes.map((r) => {
    const isActive = r.id === snapshot.activeRouteId;
    const isRec = r.id === snapshot.recommendedRouteId && !isActive;
    const superseded = !!r.supersededByRouteId;
    const selected = selection.kind === 'route' && selection.id === r.id;
    const color = isActive ? col('accent', theme)
      : superseded ? col('risk-high', theme)
      : isRec ? col('risk-low', theme)
      : col('ink-dim', theme);
    return {
      id: r.id,
      waypoints: r.waypoints,
      color,
      dash: isActive ? 0 : isRec ? 26 : superseded ? 60 : 44,
      width: isActive ? 1.5 : isRec ? 1.2 : 0.85,
      emphasized: isActive || selected,
      dimmed: false,
      animated: isActive,
      waypointsVisible: selected,
      labelAt: 0.5,
    };
  });
}

/** LIVE optimizer routes (env store) — DIRECT / BALANCED / CONSERVATIVE. */
const OPT_COLOR: Record<string, TokenName> = {
  DIRECT: 'accent',
  BALANCED: 'risk-low',
  CONSERVATIVE: 'route-conservative',
};
const OPT_DASH: Record<string, number> = { DIRECT: 40, BALANCED: 0, CONSERVATIVE: 18 };

function optRoutes(
  routes: OptRoute[],
  selected: string | null,
  theme: 'dark' | 'light',
  opts: { hideNonActive?: boolean; activeProfile?: string | null; idPrefix?: string; candidate?: boolean } = {},
): RouteSpec[] {
  const out: RouteSpec[] = [];
  for (const r of routes) {
    if (r.status !== 'OK' || !r.waypoints) continue;
    const isUnderwayActive = !!opts.hideNonActive && opts.activeProfile === r.profile;
    if (opts.hideNonActive && !isUnderwayActive) continue;
    const selId = opts.idPrefix ? `${opts.idPrefix}${r.profile}` : r.profile;
    const sel = selected === selId;
    const token = opts.candidate ? 'model' : (OPT_COLOR[r.profile] ?? 'accent');
    const color = isUnderwayActive ? col('accent', theme) : col(token, theme);
    out.push({
      id: `opt:${opts.idPrefix ?? ''}${r.profile}`,
      waypoints: r.waypoints,
      color,
      dash: opts.candidate ? (r.recommended ? 22 : 52) : isUnderwayActive ? 0 : (OPT_DASH[r.profile] ?? 30),
      width: isUnderwayActive ? 1.7 : sel ? 1.45 : r.recommended ? 1.2 : 0.9,
      emphasized: isUnderwayActive || sel || (r.recommended && !opts.hideNonActive),
      dimmed: selected !== null && !sel && !isUnderwayActive,
      // Flow animation carries direction of travel, so exactly one route per
      // view should show it: the leg being sailed, else the operator's
      // selection, else the recommendation. Candidate re-plans only animate
      // once explicitly selected, so two flows never compete.
      animated: isUnderwayActive || sel
        || (selected === null && !!r.recommended && !opts.hideNonActive && !opts.candidate),
      waypointsVisible: sel || isUnderwayActive,
      labelAt: 0.45,
    });
  }
  return out;
}

function bergsDemo(snapshot: ScenarioSnapshot, layers: LayerState, selection: SelectionType, theme: 'dark' | 'light'): BergSpec[] {
  if (!layers.icebergs) return [];
  void theme;
  return snapshot.icebergs.map((b) => {
    const last = b.observations[b.observations.length - 1];
    const threat = b.routeThreatLevel === 'HIGH' || b.routeThreatLevel === 'CRITICAL';
    const selected = selection.kind === 'iceberg' && selection.id === b.id;
    const showTraj = layers.trajectories && (threat || selected);
    return {
      id: b.id,
      lon: last.position.lon,
      lat: last.position.lat,
      lengthKm: Math.max(0.2, b.lengthM * 0.001),
      widthKm: Math.max(0.12, b.lengthM * 0.0006),
      headingDeg: b.driftBearingDeg,
      threat: b.routeThreatLevel,
      focused: selected,
      selected,
      track: b.observations.map((o) => ({ lon: o.position.lon, lat: o.position.lat })),
      prediction: showTraj
        ? b.trajectory.points.map((p) => ({
            lon: p.position.lon, lat: p.position.lat, corridorKm: p.uncertaintyNm * NM_TO_KM,
          }))
        : undefined,
    };
  });
}

function bergsLive(
  deps: MapDataDeps,
): BergSpec[] {
  const { env, layers } = deps;
  if (!layers.icebergs) return [];
  return env.icebergs.map((b) => {
    const sit = env.bergSituation.get(b.id);
    const focused = env.focusBergId === b.id;
    const showPred = layers.trajectories && env.showBergPredictions && !!sit?.moving && focused;
    return {
      id: b.id,
      lon: b.lon,
      lat: b.lat,
      lengthKm: Math.max(0.3, (b.length_nm ?? 4) * NM_TO_KM),
      widthKm: Math.max(0.15, (b.width_nm ?? (b.length_nm ?? 4) * 0.5) * NM_TO_KM),
      headingDeg: sit?.bearingDeg ?? 0,
      threat: 'NONE',
      focused,
      selected: focused,
      track: focused || env.focusBergId === null ? (sit?.track ?? undefined) : undefined,
      prediction: showPred ? (sit?.prediction ?? undefined) : undefined,
    };
  });
}

export function buildSceneInput(d: MapDataDeps): SceneInput {
  const { live, theme, layers, snapshot, scenario, env, mission } = d;
  const drill = env.drill;
  const drillActive = live && !!drill && drill.stage >= 0;
  const missionActive = live && mission.active && mission.mission !== null;

  // ── rasters ──────────────────────────────────────────────────────────
  let seaField: SceneInput['field'] = null;
  let riskField: SceneInput['field'] = null;
  let fieldMode: SceneInput['fieldMode'] = 'CONCENTRATION';
  if (live) {
    seaField = env.seaIceGrid;
    fieldMode = env.fieldMode;
    if (env.riskEnabled) riskField = env.riskGrid;
  } else if (snapshot) {
    if (layers.seaIce) seaField = { grid: snapshot.seaIce.grid, values: snapshot.seaIce.grid.values };
    if (layers.risk) riskField = { grid: snapshot.riskSurface.grid, severity: snapshot.riskSurface.grid.values };
    fieldMode = 'CONCENTRATION';
  }

  // ── routes ───────────────────────────────────────────────────────────
  let routes: RouteSpec[] = [];
  if (drillActive && drill) {
    routes = drillRoutes(drill, theme);
  } else if (missionActive && mission.mission) {
    const plan = mission.mission.routePlan?.data;
    const hasActive = !!mission.mission.activeProfile && mission.mission.state !== 'ROUTES_GENERATED';
    if (plan) {
      routes = optRoutes(plan.routes, mission.selectedProfile, theme, {
        hideNonActive: hasActive, activeProfile: mission.mission.activeProfile,
      });
    }
    if (mission.candidatePlan) {
      routes = routes.concat(optRoutes(mission.candidatePlan, mission.selectedProfile, theme, {
        idPrefix: 'CAND:', candidate: true,
      }));
    }
  } else if (live) {
    if (env.optRoutes) routes = optRoutes(env.optRoutes, env.selectedRouteProfile, theme);
  } else if (snapshot) {
    routes = demoRoutes(snapshot, layers, d.selection, theme);
  }

  // ── icebergs ─────────────────────────────────────────────────────────
  const icebergs = live ? bergsLive(d) : snapshot ? bergsDemo(snapshot, layers, d.selection, theme) : [];

  // ── zones ────────────────────────────────────────────────────────────
  let zones: ZoneSpec[] = [];
  if (live && layers.risk && env.riskEnabled) zones = env.zones;
  if (drillActive && drill?.berg?.zone && drill.stage >= 3) zones = zones.concat([drill.berg.zone]);

  // ── wind ─────────────────────────────────────────────────────────────
  let wind: WindCellSpec[] = [];
  if (layers.weather) {
    if (live) wind = env.wind;
    else if (snapshot) {
      wind = snapshot.weather.cells.map((c) => ({
        lon: c.position.lon, lat: c.position.lat, windSpeedKn: c.windSpeedKn, windDirDeg: c.windDirDeg,
      }));
    }
  }

  // ── endpoints & hazards ──────────────────────────────────────────────
  const endpoints: EndpointSpec[] = [];
  const hazards: HazardMarkerSpec[] = [];
  if (drillActive && drill) {
    endpoints.push(
      { id: 'o', lon: drill.origin.lon, lat: drill.origin.lat, label: 'ORIGIN', kind: 'ORIGIN' },
      { id: 'd', lon: drill.destination.lon, lat: drill.destination.lat, label: 'BHARATI', kind: 'DESTINATION' },
    );
    if (drill.stage >= 4 && !drill.accepted && drill.berg) {
      hazards.push({ id: 'conflict', lon: drill.berg.after.lon, lat: drill.berg.after.lat, label: 'CONFLICT' });
    }
  } else if (missionActive && mission.mission) {
    const m = mission.mission;
    endpoints.push(
      { id: 'o', lon: m.origin.lon, lat: m.origin.lat, label: (m.origin.label ?? 'ORIGIN').toUpperCase(), kind: 'ORIGIN' },
      { id: 'd', lon: m.destination.lon, lat: m.destination.lat, label: (m.destination.label ?? 'DESTINATION').toUpperCase(), kind: 'DESTINATION' },
    );
    if (mission.reviewWorstAt?.lat != null && mission.reviewWorstAt?.lon != null) {
      hazards.push({ id: 'review', lon: mission.reviewWorstAt.lon, lat: mission.reviewWorstAt.lat, label: 'REVIEW POINT' });
    }
  } else if (live && env.optOrigin && env.optDestination) {
    endpoints.push(
      { id: 'o', lon: env.optOrigin.lon, lat: env.optOrigin.lat, label: 'ORIGIN', kind: 'ORIGIN' },
      { id: 'd', lon: env.optDestination.lon, lat: env.optDestination.lat, label: 'DESTINATION', kind: 'DESTINATION' },
    );
  } else if (live) {
    endpoints.push(
      { id: 'st-bharati', lon: 76.192, lat: -69.407, label: 'BHARATI STATION', kind: 'DESTINATION' },
    );
  } else if (!live && scenario) {
    endpoints.push(
      { id: 'o', lon: scenario.mission.origin.position.lon, lat: scenario.mission.origin.position.lat, label: 'ORIGIN', kind: 'ORIGIN' },
      { id: 'd', lon: scenario.mission.destination.position.lon, lat: scenario.mission.destination.position.lat, label: 'BHARATI APPROACH', kind: 'DESTINATION' },
    );
  }

  return {
    theme,
    layers,
    field: seaField,
    fieldMode,
    riskField,
    icebergs,
    routes,
    vessel: vesselSpec(d),
    zones,
    wind,
    endpoints,
    hazards,
    animate: d.animate,
    vesselLengthKm: VESSEL_LENGTH_KM,
  };
}



function drillRoutes(drill: NonNullable<MapDataDeps['env']['drill']>, theme: 'dark' | 'light'): RouteSpec[] {
  const out: RouteSpec[] = [];
  const stg = drill.stage;
  const decided = drill.accepted;
  if (stg === 0 && drill.planRoutes) {
    for (const r of drill.planRoutes) {
      if (r.status !== 'OK' || !r.waypoints) continue;
      out.push({
        id: `drill0:${r.profile}`,
        waypoints: r.waypoints,
        color: r.recommended ? col('accent', theme) : col('ink-dim', theme),
        dash: r.recommended ? 0 : 34,
        width: r.recommended ? 1.2 : 0.8,
        emphasized: r.recommended,
        dimmed: false,
        animated: false,
        waypointsVisible: false,
      });
    }
  }
  const conflictOn = stg >= 4;
  const replanOn = stg >= 5;
  if (stg >= 1 && drill.acceptedRoute?.waypoints) {
    const danger = (replanOn || conflictOn) && !decided;
    out.push({
      id: 'drill:accepted',
      waypoints: drill.acceptedRoute.waypoints,
      color: danger ? col('risk-crit', theme) : col('accent', theme),
      dash: replanOn ? 24 : stg >= 2 ? 16 : 0,
      width: replanOn ? 1.0 : 1.5,
      emphasized: !danger,
      dimmed: decided,
      animated: stg >= 2 && !conflictOn && !replanOn,
      waypointsVisible: false,
    });
  }
  if (replanOn && drill.newRoute?.waypoints) {
    out.push({
      id: 'drill:new',
      waypoints: drill.newRoute.waypoints,
      color: col('risk-low', theme),
      dash: 0,
      width: decided ? 1.7 : 1.4,
      emphasized: true,
      dimmed: false,
      animated: decided,
      waypointsVisible: decided,
      labelAt: 0.45,
    });
  }
  return out;
}

function vesselSpec(d: MapDataDeps): SceneInput['vessel'] {
  const { live, scenario, snapshot, env, mission } = d;
  const drill = env.drill;
  if (live && drill && drill.stage >= 2 && drill.vesselPosition) {
    const next = drill.acceptedRoute?.waypoints?.find(
      (w) => Math.abs(w.lat - drill.vesselPosition!.lat) > 1e-6 || Math.abs(w.lon - drill.vesselPosition!.lon) > 1e-6,
    );
    const heading = next
      ? bearingDeg(
          { lat: drill.vesselPosition.lat, lon: drill.vesselPosition.lon },
          { lat: next.lat, lon: next.lon },
        )
      : 180;
    return {
      name: drill.vesselName,
      lon: drill.vesselPosition.lon,
      lat: drill.vesselPosition.lat,
      headingDeg: heading,
      speedKn: 12.5,
      lengthKm: VESSEL_LENGTH_KM,
      selected: d.selection.kind === 'vessel',
      moving: true,
    };
  }
  if (live && mission.active && mission.sim && mission.mission) {
    const s = mission.sim;
    return {
      name: mission.mission.vessel.name,
      lon: s.vesselPos.lon,
      lat: s.vesselPos.lat,
      headingDeg: s.headingDeg,
      speedKn: 12.5,
      lengthKm: VESSEL_LENGTH_KM,
      selected: d.selection.kind === 'vessel',
      moving: s.playing,
    };
  }
  if (!live && snapshot && scenario) {
    return {
      name: scenario.vessel.name,
      lon: snapshot.vesselState.position.lon,
      lat: snapshot.vesselState.position.lat,
      headingDeg: snapshot.vesselState.headingDeg,
      speedKn: snapshot.vesselState.speedKn,
      lengthKm: VESSEL_LENGTH_KM,
      selected: d.selection.kind === 'vessel',
      moving: true,
    };
  }
  return null;
}

/** Screen-facing label descriptors, derived from the same specs. */
export interface MapLabelSpec {
  id: string;
  kind: 'vessel' | 'endpoint' | 'route' | 'berg';
  lon?: number;
  lat?: number;
  routeId?: string;
  text: string;
  sub?: string;
  color: string;
  liftKm: number;
  strong?: boolean;
}

export function buildLabels(input: SceneInput): MapLabelSpec[] {
  const out: MapLabelSpec[] = [];

  for (const e of input.endpoints) {
    out.push({
      id: `ep-${e.id}`,
      kind: 'endpoint',
      lon: e.lon,
      lat: e.lat,
      text: e.label,
      color: e.kind === 'DESTINATION' ? `var(--color-risk-low)` : `var(--color-ink-dim)`,
      liftKm: 2,
    });
  }

  for (const r of input.routes) {
    if (!r.emphasized || r.dimmed) continue;
    const label = routeLabel(r.id);
    if (!label) continue;
    out.push({
      id: `rt-${r.id}`,
      kind: 'route',
      routeId: r.id,
      text: label,
      color: `#${r.color.toString(16).padStart(6, '0')}`,
      liftKm: 8,
    });
  }

  if (input.vessel) {
    out.push({
      id: 'vessel',
      kind: 'vessel',
      text: input.vessel.name.split(' ').slice(-1)[0]?.toUpperCase() ?? input.vessel.name,
      sub: `${input.vessel.speedKn.toFixed(1)} kn · ${String(Math.round(input.vessel.headingDeg)).padStart(3, '0')}°`,
      color: `var(--color-accent)`,
      liftKm: 12,
      strong: true,
    });
  }

  for (const b of input.icebergs) {
    if (!b.focused && !b.selected) continue;
    out.push({
      id: `berg-${b.id}`,
      kind: 'berg',
      lon: b.lon,
      lat: b.lat,
      text: b.id,
      color: b.threat === 'HIGH' || b.threat === 'CRITICAL' ? 'var(--color-risk-high)' : 'var(--color-model)',
      liftKm: 6,
    });
  }
  return out;
}

function routeLabel(id: string): string | null {
  if (id.startsWith('drill:accepted')) return null;
  if (id === 'drill:new') return '➜ NEW ROUTE';
  if (id.startsWith('drill0:')) return `★ ${id.slice(7)}`;
  if (id.startsWith('opt:CAND:')) return `★ CANDIDATE ${id.slice(9)}`;
  if (id.startsWith('opt:')) return `★ ${id.slice(4)}`;
  return null;
}

// ── re-planning drill → scene view ──────────────────────────────────────

/**
 * Flatten the deterministic drill timeline into the handful of facts the map
 * needs at the current stage. Mirrors the previous `drillElems` branch for
 * branch, including which routes are drawn at which stage.
 */
export function buildDrillView(
  data: ReplanDrillData,
  stage: number,
  accepted: boolean,
): DrillView | null {
  if (stage < 0) return null;
  const byId = Object.fromEntries(data.stages.map((s) => [s.id, s]));
  const plan0 = byId.MISSION_START?.data.plan ?? null;
  const acceptedProfile = byId.ROUTE_ACCEPTED?.data.acceptedProfile ?? null;
  const acceptedRoute = plan0?.routes.find((r) => r.profile === acceptedProfile) ?? null;
  const underway = byId.UNDERWAY?.data;
  const replan = byId.REPLAN?.data;
  const dev = byId.BERG_DEVIATION?.data;
  const newProfile = replan?.plan?.recommendation.profile ?? null;
  const newRoute = replan?.plan?.routes.find((r) => r.profile === newProfile) ?? null;

  return {
    stage,
    accepted,
    origin: data.scenario.origin,
    destination: data.scenario.destination,
    planRoutes: plan0?.routes ?? null,
    acceptedRoute,
    vesselPosition: underway?.vesselPosition ?? null,
    vesselName: 'RSV DAKSHIN DHRUV',
    coveredNm: underway?.coveredNm ?? null,
    berg: dev?.before && dev?.after
      ? {
          id: dev.bergId ?? 'BERG',
          before: dev.before,
          after: dev.after,
          zone: dev.zone
            ? {
                id: dev.bergId ?? 'BERG',
                lat: dev.after.lat,
                lon: dev.after.lon,
                coreRadiusKm: dev.zone.coreRadiusKm,
                p50RadiusKm: dev.zone.p50RadiusKm,
                p90RadiusKm: dev.zone.p90RadiusKm,
                severity: 'HIGH',
                focused: true,
              }
            : null,
        }
      : null,
    newRoute,
    conflict: stage >= 4 && !accepted,
  };
}
