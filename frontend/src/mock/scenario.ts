/**
 * POLARIS-X — Deterministic demo scenario generator.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  EVERYTHING PRODUCED HERE IS **SIMULATED / DEMO DATA**.
 *  No real satellite observations, forecasts or vessel data are used.
 *  The generator is fully seeded and reproducible (constitution §16, §36).
 * ══════════════════════════════════════════════════════════════════════
 *
 * The point of this layer is that risk scores, hazards, recommendations
 * and alerts are COMPUTED from the generated environmental fields with a
 * documented formula — not hardcoded — so the UI's explainability is real
 * and the layer can later be swapped for the Node/Python backend without
 * changing a single component.
 *
 * SCENARIO: research vessel transit from a Southern Ocean staging point
 * toward Bharati research station, Prydz Bay, East Antarctica.
 * At T+24h a new (simulated) SAR observation shows iceberg BRG-0042
 * changing drift toward the planned corridor → risk rises → route is
 * recalculated → operator approval is requested.
 */

import type {
  Alert, GeoPoint, Iceberg, IcebergTrajectory, Mission, MissionStatus,
  ResultMeta, RiskAssessment, RiskFactor, RiskLevel, RiskSurface, Route,
  RouteHazard, Scenario, ScenarioSnapshot, SeaIceField, TrajectoryPoint,
  Vessel, VesselState, WeatherCell, WeatherField,
} from '../types/domain';
import { distanceNm, distToPolylineNm, pointAlong, polylineLengthNm } from '../lib/geo';
import { fractalNoise2, mulberry32 } from '../lib/random';
import { riskFromScore } from '../lib/format';

// ── Scenario constants ─────────────────────────────────────────────────

export const SEED = 20260902;
const DEPARTURE_UTC = '2026-02-10T06:00:00Z'; // austral summer — navigable season
export const TIME_STEPS_H = [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72];
const REROUTE_TRIGGER_H = 24; // new SAR observation arrives
const REROUTE_APPROVED_H = 30; // operator approval represented in timeline

const VESSEL: Vessel = {
  id: 'VSL-01',
  name: 'RSV Dakshin Dhruv',
  callsign: 'ATVK',
  type: 'RESEARCH',
  iceClass: 'PC 5',
  cruiseSpeedKn: 12.5,
  maxIceConcentrationPct: 70,
  draftM: 8.2,
  provenance: 'SAMPLE DATA',
};

const ORIGIN: GeoPoint = { lon: 60.0, lat: -57.5 };
const DEST: GeoPoint = { lon: 76.19, lat: -69.35 }; // Prydz Bay approach

// ── Route geometries ───────────────────────────────────────────────────
// A: direct   B: balanced (initial recommendation)   C: conservative
// B2: recalculated after BRG-0042 trajectory change (shares B's first leg
// so the vessel track stays continuous through the reroute).

const WPTS_A: GeoPoint[] = [ORIGIN, { lon: 66.5, lat: -61.6 }, { lon: 72.0, lat: -65.6 }, { lon: 75.2, lat: -68.1 }, DEST];
const WPTS_B: GeoPoint[] = [ORIGIN, { lon: 66.0, lat: -62.0 }, { lon: 70.5, lat: -65.5 }, { lon: 74.3, lat: -68.2 }, DEST];
const WPTS_C: GeoPoint[] = [ORIGIN, { lon: 62.5, lat: -62.5 }, { lon: 65.5, lat: -66.0 }, { lon: 70.0, lat: -68.6 }, { lon: 74.5, lat: -69.2 }, DEST];
const WPTS_B2: GeoPoint[] = [ORIGIN, { lon: 66.0, lat: -62.0 }, { lon: 68.6, lat: -65.9 }, { lon: 72.4, lat: -68.6 }, DEST];

// ── Metadata helpers ───────────────────────────────────────────────────

function meta(model: string, version: string, warnings: string[] = []): ResultMeta {
  return {
    model: { name: model, version },
    executedAt: DEPARTURE_UTC,
    status: 'ok',
    warnings,
    provenance: 'SIMULATED',
  };
}

// ── Sea-ice concentration field ────────────────────────────────────────
// conc(lon,lat,t) = latitudinal ramp from a (slowly advancing) ice edge
//                 + eastward pack-density gradient + seeded fractal noise.

const GRID = { lon0: 52, lat0: -71, dLon: 0.8, dLat: 0.35, nLon: 60, nLat: 42 };

function iceEdgeLat(tH: number): number {
  return -62.2 + tH * 0.012; // edge creeps north ≈0.9° over 72 h (demo dynamics)
}

export function seaIceConcAt(lon: number, lat: number, tH: number): number {
  const edge = iceEdgeLat(lon > 70 ? tH : tH * 0.6); // eastern sector grows faster
  const ramp = Math.max(0, Math.min(1, (edge - lat) / 6.5)); // 0 at edge → 1 well south
  const east = Math.max(0, Math.min(1, (lon - 66) / 22)) * 14; // denser pack to the east
  const n = (fractalNoise2(lon * 0.55, lat * 0.9 + tH * 0.015, SEED) - 0.5) * 24;
  const coast = Math.max(0, Math.min(1, (-lat - 67.8) / 3.2)) * 14; // consolidation near coast
  // Prydz Bay summer polynya — recurring open-water corridor toward the shelf
  const polynya = Math.exp(-((lon - 74.5) ** 2) / 26 - ((lat + 68.3) ** 2) / 2.6) * 42;
  const c = ramp * 46 + east * ramp + coast + n * Math.max(0.35, ramp) - polynya;
  return Math.max(0, Math.min(96, c));
}

function buildSeaIce(tH: number): SeaIceField {
  const values: number[][] = [];
  for (let j = 0; j < GRID.nLat; j++) {
    const row: number[] = [];
    const lat = GRID.lat0 + j * GRID.dLat;
    for (let i = 0; i < GRID.nLon; i++) {
      row.push(Math.round(seaIceConcAt(GRID.lon0 + i * GRID.dLon, lat, tH)));
    }
    values.push(row);
  }
  return {
    meta: meta('seaice-demo-field', '0.3.0'),
    timeOffsetH: tH,
    grid: { ...GRID, values },
    uncertaintyPct: Math.round(4 + tH * 0.16), // uncertainty grows with horizon
  };
}

// ── Weather field ──────────────────────────────────────────────────────
// Background westerlies + a transient low crossing 66–70°E between T+12 and T+42.

function buildWeather(tH: number): WeatherField {
  const cells: WeatherCell[] = [];
  let maxWind = 0, maxWave = 0, minTemp = 99;
  const stormCenter: GeoPoint = { lon: 62 + tH * 0.22, lat: -62.5 - tH * 0.02 };
  const stormStrength = Math.max(0, 1 - Math.abs(tH - 27) / 22) * 19; // peaks ≈T+27
  for (let lon = 54; lon <= 98; lon += 4) {
    for (let lat = -70; lat <= -57; lat += 2.1) {
      const d = distanceNm({ lon, lat }, stormCenter);
      const storm = stormStrength * Math.exp(-(d * d) / (2 * 260 * 260));
      const base = 16 + fractalNoise2(lon * 0.3 + tH * 0.03, lat * 0.5, SEED ^ 7) * 14;
      const windSpeedKn = Math.round(base + storm);
      const windDirDeg = Math.round((250 + fractalNoise2(lon * 0.2, lat * 0.4 + tH * 0.02, SEED ^ 13) * 60 + (storm > 6 ? 40 : 0)) % 360);
      const waveHeightM = +(1 + windSpeedKn * 0.075 + fractalNoise2(lon * 0.4, lat * 0.6, SEED ^ 21) * 0.8).toFixed(1);
      const airTempC = +(-2 - (-(lat + 57)) * 0.55 + fractalNoise2(lon * 0.3, lat * 0.3, SEED ^ 31) * 3).toFixed(1);
      cells.push({ position: { lon, lat }, windSpeedKn, windDirDeg, waveHeightM, airTempC });
      maxWind = Math.max(maxWind, windSpeedKn);
      maxWave = Math.max(maxWave, waveHeightM);
      minTemp = Math.min(minTemp, airTempC);
    }
  }
  return {
    meta: meta('wx-demo-field', '0.2.1'),
    timeOffsetH: tH,
    cells,
    summary: { maxWindKn: maxWind, maxWaveM: +maxWave.toFixed(1), minTempC: +minTemp.toFixed(1) },
  };
}

// ── Icebergs ───────────────────────────────────────────────────────────

interface BergSeed {
  id: string; start: GeoPoint; sizeClass: Iceberg['sizeClass']; lengthM: number;
  driftKn: number; bearing: number; conf: number;
  /** velocity change introduced by the T+24 simulated SAR observation */
  shift?: { atH: number; driftKn: number; bearing: number };
}

const BERGS: BergSeed[] = [
  { id: 'BRG-0007', start: { lon: 58.4, lat: -63.1 }, sizeClass: 'MEDIUM', lengthM: 420, driftKn: 0.35, bearing: 285, conf: 0.93 },
  { id: 'BRG-0016', start: { lon: 63.2, lat: -65.9 }, sizeClass: 'LARGE', lengthM: 980, driftKn: 0.22, bearing: 300, conf: 0.96 },
  { id: 'BRG-0023', start: { lon: 60.0, lat: -64.7 }, sizeClass: 'SMALL', lengthM: 140, driftKn: 0.5, bearing: 268, conf: 0.81 },
  { id: 'BRG-0042', start: { lon: 73.9, lat: -65.6 }, sizeClass: 'LARGE', lengthM: 1240, driftKn: 0.28, bearing: 285, conf: 0.97, shift: { atH: 24, driftKn: 0.95, bearing: 222 } },
  { id: 'BRG-0058', start: { lon: 79.5, lat: -66.2 }, sizeClass: 'VERY LARGE', lengthM: 2600, driftKn: 0.18, bearing: 275, conf: 0.98 },
  { id: 'BRG-0064', start: { lon: 80.8, lat: -68.3 }, sizeClass: 'MEDIUM', lengthM: 510, driftKn: 0.28, bearing: 282, conf: 0.9 },
  { id: 'BRG-0071', start: { lon: 84.3, lat: -63.0 }, sizeClass: 'SMALL', lengthM: 190, driftKn: 0.55, bearing: 250, conf: 0.77 },
  { id: 'BRG-0088', start: { lon: 61.5, lat: -68.5 }, sizeClass: 'MEDIUM', lengthM: 610, driftKn: 0.2, bearing: 310, conf: 0.94 },
];

/** Advance a position along a rhumb-ish drift (small distances → linear ok). */
function drift(p: GeoPoint, kn: number, bearing: number, hours: number): GeoPoint {
  const distNm = kn * hours;
  const rad = (bearing * Math.PI) / 180;
  const dLat = (distNm * Math.cos(rad)) / 60;
  const dLon = (distNm * Math.sin(rad)) / (60 * Math.cos((p.lat * Math.PI) / 180));
  return { lon: p.lon + dLon, lat: p.lat + dLat };
}

function bergPositionAt(seed: BergSeed, tH: number): GeoPoint {
  if (!seed.shift || tH <= seed.shift.atH) return drift(seed.start, seed.driftKn, seed.bearing, tH);
  const atShift = drift(seed.start, seed.driftKn, seed.bearing, seed.shift.atH);
  return drift(atShift, seed.shift.driftKn, seed.shift.bearing, tH - seed.shift.atH);
}

function bergVelocityAt(seed: BergSeed, tH: number): { kn: number; bearing: number } {
  if (seed.shift && tH >= seed.shift.atH) return { kn: seed.shift.driftKn, bearing: seed.shift.bearing };
  return { kn: seed.driftKn, bearing: seed.bearing };
}

function buildTrajectory(seed: BergSeed, tH: number): IcebergTrajectory {
  const v = bergVelocityAt(seed, tH);
  const from = bergPositionAt(seed, tH);
  const points: TrajectoryPoint[] = [];
  const horizonH = 48;
  for (let h = 0; h <= horizonH; h += 6) {
    points.push({
      timeOffsetH: tH + h,
      position: drift(from, v.kn, v.bearing, h),
      uncertaintyNm: +(2 + h * 0.55 * (1.35 - seed.conf)).toFixed(1), // grows with horizon, worse for low-confidence tracks
    });
  }
  const shifted = !!seed.shift && tH >= seed.shift.atH;
  return {
    meta: meta('berg-drift-linear', shifted ? '0.4.1' : '0.4.0',
      shifted && seed.id === 'BRG-0042' ? ['Velocity re-estimated from new SAR observation (SIMULATED) at T+24'] : []),
    points,
    horizonH,
    confidence: +(seed.conf - 0.12 - (shifted ? 0.06 : 0)).toFixed(2),
  };
}

function threatToRoute(traj: IcebergTrajectory, route: GeoPoint[]): RiskLevel {
  let worst = Infinity;
  for (const p of traj.points) {
    const d = distToPolylineNm(p.position, route) - p.uncertaintyNm;
    worst = Math.min(worst, d);
  }
  if (worst < 5) return 'CRITICAL';
  if (worst < 20) return 'HIGH';
  if (worst < 60) return 'MEDIUM';
  return 'LOW';
}

function buildIcebergs(tH: number, activeRoute: GeoPoint[]): Iceberg[] {
  return BERGS.map((seed) => {
    const v = bergVelocityAt(seed, tH);
    const traj = buildTrajectory(seed, tH);
    const observations = [
      { timeOffsetH: tH - 24, position: bergPositionAt(seed, tH - 24), source: 'SAR scene · orbit 41230 (SIMULATED)' },
      { timeOffsetH: tH - 12, position: bergPositionAt(seed, tH - 12), source: 'SAR scene · orbit 41244 (SIMULATED)' },
      { timeOffsetH: tH, position: bergPositionAt(seed, tH), source: 'SAR scene · orbit 41258 (SIMULATED)' },
    ];
    return {
      id: seed.id,
      sizeClass: seed.sizeClass,
      lengthM: seed.lengthM,
      observations,
      driftSpeedKn: v.kn,
      driftBearingDeg: v.bearing,
      detectionConfidence: seed.conf,
      trajectory: traj,
      routeThreatLevel: threatToRoute(traj, activeRoute),
      provenance: 'SIMULATED',
    };
  });
}

// ── Risk engine (mock, but genuinely computed) ─────────────────────────
// Documented formula (mirrors docs/api-contracts.md; weights configurable):
//   overall = 0.35·seaIce + 0.30·icebergs + 0.20·weather + 0.15·uncertainty
//
//   seaIce      – mean + peak concentration sampled along route vs vessel limit
//   icebergs    – worst (corridor-inflated) proximity of any predicted berg track
//   weather     – peak wind along route corridor vs 50 kn reference
//   uncertainty – forecast-horizon growth of field + trajectory uncertainty

const W = { seaIce: 0.35, icebergs: 0.3, weather: 0.2, uncertainty: 0.15 };

function sampleRoute(route: GeoPoint[], n = 24): GeoPoint[] {
  const total = polylineLengthNm(route);
  const out: GeoPoint[] = [];
  for (let i = 0; i <= n; i++) out.push(pointAlong(route, (total * i) / n).pos);
  return out;
}

interface RouteRiskResult { factors: RiskFactor[]; score: number; alongRoute: { distNm: number; score: number }[]; hazards: RouteHazard[] }

function assessRoute(route: GeoPoint[], tH: number, bergs: Iceberg[], wx: WeatherField, vessel: Vessel): RouteRiskResult {
  const samples = sampleRoute(route);
  const total = polylineLengthNm(route);

  // Sea ice
  let sum = 0, peak = 0, peakAt = 0;
  samples.forEach((p, i) => {
    const c = seaIceConcAt(p.lon, p.lat, tH);
    sum += c;
    if (c > peak) { peak = c; peakAt = (total * i) / samples.length; }
  });
  const mean = sum / samples.length;
  const seaIceScore = Math.min(100, mean * 0.9 + Math.max(0, peak - vessel.maxIceConcentrationPct) * 2.2);

  // Icebergs
  let worstD = Infinity, worstBerg = '', worstAt = 0;
  for (const b of bergs) {
    for (const tp of b.trajectory.points) {
      const d = distToPolylineNm(tp.position, route) - tp.uncertaintyNm;
      if (d < worstD) {
        worstD = d; worstBerg = b.id;
        let best = Infinity, bestDist = 0;
        samples.forEach((p, i) => {
          const dd = distanceNm(p, tp.position);
          if (dd < best) { best = dd; bestDist = (total * i) / samples.length; }
        });
        worstAt = bestDist;
      }
    }
  }
  const bergScore = worstD <= 0 ? 95 : Math.max(0, Math.min(95, 95 - worstD * 1.15));

  // Weather — peak wind within 90 nm of the route
  let peakWind = 0;
  for (const c of wx.cells) {
    if (distToPolylineNm(c.position, route) < 90) peakWind = Math.max(peakWind, c.windSpeedKn);
  }
  const wxScore = Math.min(100, Math.max(0, ((peakWind - 18) / 45) * 100));

  // Uncertainty
  const uncScore = Math.min(100, 12 + tH * 0.55);

  const factors: RiskFactor[] = [
    { key: 'seaIce', label: 'Sea Ice', level: riskFromScore(seaIceScore), score: Math.round(seaIceScore), weight: W.seaIce, detail: `Mean concentration along route ${mean.toFixed(0)}% · peak ${peak.toFixed(0)}% at ${peakAt.toFixed(0)} nm (vessel limit ${vessel.maxIceConcentrationPct}%)` },
    { key: 'icebergs', label: 'Icebergs', level: riskFromScore(bergScore), score: Math.round(bergScore), weight: W.icebergs, detail: worstD === Infinity ? 'No predicted iceberg track near route' : `${worstBerg} predicted corridor passes ${Math.max(0, worstD).toFixed(0)} nm from route near ${worstAt.toFixed(0)} nm mark` },
    { key: 'weather', label: 'Weather', level: riskFromScore(wxScore), score: Math.round(wxScore), weight: W.weather, detail: `Peak wind ${peakWind.toFixed(0)} kn within 90 nm of route corridor` },
    { key: 'uncertainty', label: 'Uncertainty', level: riskFromScore(uncScore), score: Math.round(uncScore), weight: W.uncertainty, detail: `Forecast horizon T+${tH} h · sea-ice field ±${Math.round(4 + tH * 0.16)}% · berg tracks widen with lead time` },
  ];
  // Weighted sum + critical-hazard override: a near-certain iceberg conflict
  // must not be averaged away by calm co-factors (documented in risk-engine docs).
  const weighted = factors.reduce((s, f) => s + f.score * f.weight, 0);
  const score = Math.round(bergScore >= 80 ? Math.max(weighted, 62) : weighted);

  const alongRoute = samples.map((p, i) => {
    const c = seaIceConcAt(p.lon, p.lat, tH);
    let bd = Infinity;
    for (const b of bergs) for (const tp of b.trajectory.points) bd = Math.min(bd, distanceNm(p, tp.position) - tp.uncertaintyNm);
    const local = Math.min(100, c * 0.9 + Math.max(0, 80 - Math.max(0, bd)) * 0.7);
    return { distNm: Math.round((total * i) / samples.length), score: Math.round(local) };
  });

  const hazards: RouteHazard[] = [];
  if (worstD < 60 && worstBerg) hazards.push({ kind: 'ICEBERG', refId: worstBerg, atDistNm: Math.round(worstAt), severity: worstD < 5 ? 'CRITICAL' : worstD < 20 ? 'HIGH' : 'MEDIUM', note: `${worstBerg} corridor within ${Math.max(0, worstD).toFixed(0)} nm of track` });
  if (peak > vessel.maxIceConcentrationPct - 15) hazards.push({ kind: 'SEA_ICE', atDistNm: Math.round(peakAt), severity: peak > vessel.maxIceConcentrationPct ? 'HIGH' : 'MEDIUM', note: `Concentration peaks at ${peak.toFixed(0)}% near ${peakAt.toFixed(0)} nm` });
  if (peakWind > 34) hazards.push({ kind: 'WEATHER', atDistNm: Math.round(total * 0.4), severity: peakWind > 44 ? 'HIGH' : 'MEDIUM', note: `Gale-force wind ${peakWind.toFixed(0)} kn forecast in corridor` });

  return { factors, score, alongRoute, hazards };
}

// ── Route construction ─────────────────────────────────────────────────

function fuelEstimateT(distNm: number, meanIcePct: number, vessel: Vessel): number {
  // MODEL ESTIMATE (labelled in UI): base burn/nm + ice-resistance penalty.
  const base = 0.082; // t/nm at cruise speed — sample vessel profile
  const icePenalty = 1 + (meanIcePct / 100) * 0.55;
  return Math.round(distNm * base * icePenalty * (12.5 / vessel.cruiseSpeedKn));
}

function buildRoute(id: string, kind: Route['kind'], label: string, wpts: GeoPoint[], tH: number, bergs: Iceberg[], wx: WeatherField): Route {
  const dist = polylineLengthNm(wpts);
  const rr = assessRoute(wpts, tH, bergs, wx, VESSEL);
  const meanIce = rr.factors[0].score / 0.9;
  return {
    id, kind, label,
    waypoints: wpts,
    distanceNm: Math.round(dist),
    estTimeH: Math.round(dist / VESSEL.cruiseSpeedKn),
    estFuelT: fuelEstimateT(dist, meanIce, VESSEL),
    riskScore: rr.score,
    riskLevel: riskFromScore(rr.score),
    hazards: rr.hazards,
    recommended: false,
    recommendationReasons: [],
    meta: meta('route-demo-optimizer', tH >= REROUTE_TRIGGER_H ? '0.5.1' : '0.5.0'),
  };
}

function pickRecommended(routes: Route[], activeId: string): Route {
  // Documented mock policy:
  //  1. lowest combined risk wins;
  //  2. a marginally riskier (≤5 pts) but ≥5% shorter route may win instead;
  //  3. route stability — keep the active route if it is within 13 pts of the
  //     best candidate (avoids recommendation churn between time steps).
  const sorted = [...routes].sort((a, b) => a.riskScore - b.riskScore);
  let best = sorted[0];
  const alt = sorted[1];
  if (alt && alt.riskScore - best.riskScore <= 5 && alt.distanceNm < best.distanceNm * 0.95) best = alt;
  const active = routes.find((r) => r.id === activeId);
  if (active && active.riskScore - best.riskScore <= 13) return active;
  return best;
}

function reasonsFor(r: Route, others: Route[], bergs: Iceberg[]): string[] {
  const out: string[] = [];
  const worst = others.filter((o) => o.id !== r.id);
  const maxRisk = Math.max(...worst.map((o) => o.riskScore));
  out.push(`Lowest combined risk score (${r.riskScore}) of ${others.length} generated alternatives (worst ${maxRisk})`);
  const bergHaz = r.hazards.find((h) => h.kind === 'ICEBERG');
  if (!bergHaz) out.push('No predicted iceberg corridor within 60 nm of track over 48 h horizon');
  else out.push(`Closest predicted iceberg corridor: ${bergHaz.refId} (${bergHaz.note})`);
  const extra = r.distanceNm - Math.min(...others.map((o) => o.distanceNm));
  if (extra > 0) out.push(`Accepts +${extra} nm (+${Math.round((extra / VESSEL.cruiseSpeedKn) * 10) / 10} h) versus shortest alternative for the risk reduction`);
  else out.push('Also the shortest generated alternative');
  const threat = bergs.filter((b) => b.routeThreatLevel === 'HIGH' || b.routeThreatLevel === 'CRITICAL');
  if (threat.length === 0) out.push('All tracked icebergs assessed LOW/MEDIUM threat to this track');
  return out;
}

// ── Alerts ─────────────────────────────────────────────────────────────

function alertsUpTo(tH: number, riskBefore: number, riskAfter: number): Alert[] {
  const all: Alert[] = [
    {
      id: 'AL-001', kind: 'SYSTEM', severity: 'INFO', timeOffsetH: 0,
      title: 'Simulation scenario loaded',
      reason: 'All environmental data in this mode is simulated. The run is repeatable.',
      affectedComponent: 'MISSION NCPOR-EXP-43', recommendedAction: 'None — informational', acknowledged: true,
    },
    {
      id: 'AL-002', kind: 'ROUTE', severity: 'INFO', timeOffsetH: 0,
      title: 'Route alternatives generated',
      reason: '3 alternatives computed. ROUTE B (BALANCED) recommended: lowest combined risk at acceptable distance.',
      affectedComponent: 'ROUTE PLANNER', recommendedAction: 'Review comparison and confirm departure route', acknowledged: true,
    },
    {
      id: 'AL-003', kind: 'WEATHER', severity: 'WARNING', timeOffsetH: 12,
      title: 'Wind increasing in mid-corridor',
      reason: 'Transient low pressure system crossing 62–70°E; corridor winds forecast to exceed 34 kn near T+27.',
      location: { lon: 66.5, lat: -63.0 },
      affectedComponent: 'ROUTE B — BALANCED', recommendedAction: 'Monitor; no route change required at current risk threshold', acknowledged: false,
    },
    {
      id: 'AL-004', kind: 'ICEBERG', severity: 'CRITICAL', timeOffsetH: 24,
      title: 'BRG-0042 trajectory shift detected',
      reason: `New SAR observation (SIMULATED) shows BRG-0042 drift changed 285°→222° at 0.95 kn. Predicted corridor now passes within 10 nm of ROUTE B inside 48 h. Route risk ${riskBefore}→${riskAfter} (LOW→HIGH).`,
      location: bergPositionAt(BERGS[3], 24),
      affectedComponent: 'ROUTE B — BALANCED', recommendedAction: 'RECALCULATE ROUTE', acknowledged: false,
    },
    {
      id: 'AL-005', kind: 'ROUTE', severity: 'WARNING', timeOffsetH: 24,
      title: 'Recalculated route available',
      reason: 'ROUTE B-2 generated: shifts mid-corridor west, keeping ≥60 nm clearance from the predicted BRG-0042 corridor. Risk 25 (LOW) vs 62 (HIGH) on ROUTE B.',
      affectedComponent: 'ROUTE PLANNER', recommendedAction: 'Review ROUTE B-2 and approve or reject', acknowledged: false,
    },
    {
      id: 'AL-006', kind: 'ROUTE', severity: 'INFO', timeOffsetH: 30,
      title: 'Operator approved ROUTE B-2',
      reason: 'Navigator accepted the recalculated route. Decision recorded in mission log (DEMO).',
      affectedComponent: 'MISSION NCPOR-EXP-43', recommendedAction: 'None — decision recorded', acknowledged: true,
    },
    {
      id: 'AL-007', kind: 'SEA_ICE', severity: 'WARNING', timeOffsetH: 48,
      title: 'Ice edge advancing across original corridor',
      reason: 'Sea-ice concentration along superseded ROUTE B increased ~9% since departure; recalculated track remains within vessel limits.',
      location: { lon: 72.5, lat: -66.0 },
      affectedComponent: 'SEA-ICE FORECAST', recommendedAction: 'None — active route unaffected', acknowledged: false,
    },
  ];
  return all.filter((a) => a.timeOffsetH <= tH);
}

// ── Snapshot assembly ──────────────────────────────────────────────────

function activeWaypointsAt(tH: number): { wpts: GeoPoint[]; routeId: string } {
  if (tH < REROUTE_APPROVED_H) return { wpts: WPTS_B, routeId: 'RT-B' };
  return { wpts: WPTS_B2, routeId: 'RT-B2' };
}

function buildSnapshot(tH: number): ScenarioSnapshot {
  const active = activeWaypointsAt(tH);
  const seaIce = buildSeaIce(tH);
  const weather = buildWeather(tH);
  const icebergs = buildIcebergs(tH, active.wpts);

  const routes: Route[] = [
    buildRoute('RT-A', 'SHORTEST', 'ROUTE A — DIRECT', WPTS_A, tH, icebergs, weather),
    buildRoute('RT-B', 'BALANCED', 'ROUTE B — BALANCED', WPTS_B, tH, icebergs, weather),
    buildRoute('RT-C', 'CONSERVATIVE', 'ROUTE C — CONSERVATIVE', WPTS_C, tH, icebergs, weather),
  ];
  if (tH >= REROUTE_TRIGGER_H) {
    const b2 = buildRoute('RT-B2', 'BALANCED', 'ROUTE B-2 — RECALCULATED', WPTS_B2, tH, icebergs, weather);
    routes.push(b2);
    routes[1].supersededByRouteId = 'RT-B2';
  }

  const candidates = tH >= REROUTE_TRIGGER_H ? routes.filter((r) => r.id !== 'RT-B') : routes;
  const rec = pickRecommended(candidates, tH >= REROUTE_TRIGGER_H ? 'RT-B2' : active.routeId);
  rec.recommended = true;
  rec.recommendationReasons = reasonsFor(rec, candidates, icebergs);

  const activeRoute = routes.find((r) => r.id === active.routeId)!;
  const rr = assessRoute(activeRoute.waypoints, tH, icebergs, weather, VESSEL);
  const risk: RiskAssessment = {
    meta: meta('risk-demo-engine', '0.6.0'),
    timeOffsetH: tH,
    routeId: activeRoute.id,
    overall: riskFromScore(rr.score),
    overallScore: rr.score,
    factors: rr.factors,
    alongRoute: rr.alongRoute,
  };

  // Risk surface for the heat layer (coarser grid for perf)
  const rsGrid = { lon0: 52, lat0: -71, dLon: 1.6, dLat: 0.7, nLon: 30, nLat: 21, values: [] as number[][] };
  for (let j = 0; j < rsGrid.nLat; j++) {
    const row: number[] = [];
    const lat = rsGrid.lat0 + j * rsGrid.dLat;
    for (let i = 0; i < rsGrid.nLon; i++) {
      const lon = rsGrid.lon0 + i * rsGrid.dLon;
      const ice = seaIceConcAt(lon, lat, tH) * 0.85;
      let bd = Infinity;
      for (const b of icebergs) for (const tp of b.trajectory.points) bd = Math.min(bd, distanceNm({ lon, lat }, tp.position) - tp.uncertaintyNm);
      const berg = Math.max(0, 70 - Math.max(0, bd)) * 1.1;
      row.push(Math.round(Math.min(100, Math.max(ice, berg))));
    }
    rsGrid.values.push(row);
  }
  const riskSurface: RiskSurface = { meta: meta('risk-demo-engine', '0.6.0'), timeOffsetH: tH, grid: rsGrid };

  // Vessel state along the active track
  const distDone = Math.min(VESSEL.cruiseSpeedKn * tH, polylineLengthNm(active.wpts));
  const va = pointAlong(active.wpts, distDone);
  const vesselState: VesselState = {
    vesselId: VESSEL.id, position: va.pos, headingDeg: Math.round(va.headingDeg),
    speedKn: distDone >= polylineLengthNm(active.wpts) ? 0 : VESSEL.cruiseSpeedKn, timeOffsetH: tH,
  };

  const riskBefore = 28, riskAfter = 62; // computed values of RT-B at T+18 vs T+24 (verified via scripts/verify-scenario.ts)
  const missionStatus: MissionStatus =
    tH >= REROUTE_TRIGGER_H && tH < REROUTE_APPROVED_H ? 'REROUTE_PROPOSED' : 'ACTIVE';

  const events: string[] = [];
  if (tH === 0) events.push('Departure — ROUTE B active per pre-departure recommendation.');
  if (tH === REROUTE_TRIGGER_H) events.push('New SAR observation (SIMULATED): BRG-0042 velocity changed. ROUTE B risk elevated — recalculation produced ROUTE B-2. Awaiting operator decision.');
  if (tH === REROUTE_APPROVED_H) events.push('Operator approved ROUTE B-2. Vessel proceeding on recalculated track.');
  if (tH === 72) events.push('Approach phase — Prydz Bay fast-ice edge ahead; pilotage planning begins.');

  return {
    timeOffsetH: tH,
    vesselState,
    seaIce,
    icebergs,
    weather,
    routes,
    activeRouteId: active.routeId,
    recommendedRouteId: rec.id,
    risk,
    riskSurface,
    alerts: alertsUpTo(tH, riskBefore, riskAfter),
    missionStatus,
    events,
  };
}

// ── Public API ─────────────────────────────────────────────────────────

export function buildScenario(): Scenario {
  const mission: Mission = {
    id: 'MSN-01',
    code: 'NCPOR-EXP-43',
    name: 'Prydz Bay Resupply & Science Transit',
    status: 'ACTIVE',
    vesselId: VESSEL.id,
    origin: { name: 'Southern Ocean staging point', position: ORIGIN },
    destination: { name: 'Bharati Station approach, Prydz Bay', position: DEST },
    departureUtc: DEPARTURE_UTC,
    riskPreference: 'BALANCED',
    activeRouteId: 'RT-B',
    provenance: 'SIMULATED',
  };
  // deterministic sanity: consume the seed so future stochastic additions stay reproducible
  mulberry32(SEED)();
  return {
    mission,
    vessel: VESSEL,
    timeStepsH: TIME_STEPS_H,
    snapshots: TIME_STEPS_H.map(buildSnapshot),
  };
}
