/**
 * Headless verification of the 3D navigation layer.
 *
 * There is no browser in CI here, so this exercises everything that does not
 * need a GL context and *does* need to be right:
 *
 *   1. relief   — the coastline hash, masks and hypsometric profile actually
 *                 produce a sane Antarctic height field (land vs ocean,
 *                 ice-sheet dome, shelf flatness, no NaN, timing);
 *   2. terrain  — the polar disc mesh builds with the expected topology and
 *                 a valid colour/normal attribute set;
 *   3. mapping  — the REAL demo scenario is translated into a SceneInput:
 *                 routes, icebergs, vessel, endpoints, labels, and the
 *                 per-step evolution as the timeline advances;
 *   4. drill    — the deterministic re-planning drill flattens to the right
 *                 scene state at each stage.
 *
 * Run: npx tsx scripts/verify-3d.ts
 */
import { buildScenario } from '../src/mock/scenario';
import {
  SyntheticRelief, buildTerrain, darkTerrainColors, TERRAIN_RADIUS_KM,
} from '../src/map3d/relief';
import { project, unproject } from '../src/lib/projection';
import { buildSceneInput, buildLabels, buildDrillView } from '../src/components/map/sceneData';
import type { MapDataDeps } from '../src/components/map/sceneData';
import type { OptRoute } from '../src/types/env';
import { NM_TO_KM } from '../src/map3d/coords';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// ── 1. relief ───────────────────────────────────────────────────────────
console.log('\n── relief ───────────────────────────────────────────────────────');
const t0 = Date.now();
const relief = new SyntheticRelief();
const reliefMs = Date.now() - t0;
console.log(`relief built in ${reliefMs} ms · disc radius ${TERRAIN_RADIUS_KM} km`);
check('relief builds in reasonable time', reliefMs < 8000, `${reliefMs} ms`);

// Prydz Bay: Bharati station sits on the coast, the pole is deep inland ice
const bharati = relief.heightKm(project(76.19, -69.35).x, project(76.19, -69.35).y);
const inland = relief.heightKm(project(76, -82).x, project(76, -82).y);
const openOcean = relief.heightKm(project(60, -57.5).x, project(60, -57.5).y);
console.log(`height km — Bharati ${bharati.toFixed(3)} · interior(76E,82S) ${inland.toFixed(3)} · open ocean(60E,57.5S) ${openOcean.toFixed(3)}`);
check('interior is high ice-sheet', inland > 1.5, `${inland.toFixed(2)} km`);
check('open ocean is below sea level', openOcean < -1, `${openOcean.toFixed(2)} km`);
check('coastal station is low', bharati > -0.6 && bharati < 1.2, `${bharati.toFixed(2)} km`);

// signed distance changes sign across the coast (sampled well clear of it)
const dLand = relief.signedDistanceKm(project(76, -74).x, project(76, -74).y);
const dSea = relief.signedDistanceKm(project(60, -57.5).x, project(60, -57.5).y);
check('signed distance is + inland / − offshore', dLand > 0 && dSea < 0,
  `${dLand.toFixed(1)} / ${dSea.toFixed(1)} km`);

// the mission destination is an *approach* point in Prydz Bay, not the station:
// it must read as offshore, otherwise routes would be laid over the ice sheet
const dDest = relief.signedDistanceKm(project(76.19, -69.35).x, project(76.19, -69.35).y);
console.log(`Bharati approach 76.19E,69.35S → ${dDest.toFixed(1)} km (offshore expected)`);
check('destination reads as an offshore approach point', dDest < 0 && dDest > -120, `${dDest.toFixed(1)} km`);

// spot-check the synthetic field against well-known real elevations
const vostok = relief.heightKm(project(106.84, -78.46).x, project(106.84, -78.46).y);
const pole = relief.heightKm(project(0, -89.9).x, project(0, -89.9).y);
console.log(`Vostok ${vostok.toFixed(2)} km (real ≈3.49) · South Pole ${pole.toFixed(2)} km (real ≈2.84)`);
check('interior elevations are in the real ballpark', vostok > 2.5 && vostok < 5 && pole > 2 && pole < 4);

// ice shelves stay flat and low (Amery, ~70.5E 71S)
const shelf = relief.heightKm(project(70.5, -71).x, project(70.5, -71).y);
console.log(`Amery shelf sample ${shelf.toFixed(3)} km`);
check('ice shelf is low, not a dome', shelf >= -0.2 && shelf < 0.5, `${shelf.toFixed(3)} km`);

// projection round trip
const rt = unproject(project(86, -68).x, project(86, -68).y);
check('projection round-trips', Math.abs(rt.lon - 86) < 1e-6 && Math.abs(rt.lat + 68) < 1e-6,
  `${rt.lon.toFixed(5)}, ${rt.lat.toFixed(5)}`);

// ── 2. terrain mesh ─────────────────────────────────────────────────────
console.log('\n── terrain mesh ─────────────────────────────────────────────────');
const t1 = Date.now();
const terrain = buildTerrain(relief, darkTerrainColors(), 1);
const meshMs = Date.now() - t1;
const pos = terrain.mesh.geometry.getAttribute('position');
const col = terrain.mesh.geometry.getAttribute('color');
const idx = terrain.mesh.geometry.getIndex()!;
let nan = 0;
let minY = Infinity;
let maxY = -Infinity;
for (let i = 0; i < pos.count; i++) {
  const y = pos.getY(i);
  if (!Number.isFinite(y) || !Number.isFinite(pos.getX(i))) nan++;
  minY = Math.min(minY, y);
  maxY = Math.max(maxY, y);
}
console.log(`terrain: ${pos.count} vertices, ${idx.count / 3} triangles, built in ${meshMs} ms`);
console.log(`scene Y range ${minY.toFixed(1)} … ${maxY.toFixed(1)} (×26 exaggeration)`);
check('no NaN geometry', nan === 0, `${nan} bad vertices`);
check('vertex count is substantial', pos.count > 100000, `${pos.count}`);
check('colour attribute matches vertex count', col.count === pos.count, `${col.count}`);
check('terrain has vertical extent', maxY - minY > 50, `${(maxY - minY).toFixed(0)}`);

// recolour path (theme switch) must not throw or lose data
terrain.recolor(darkTerrainColors());
check('recolor keeps vertex count', (terrain.mesh.geometry.getAttribute('color')).count === pos.count);

// ── 3. real demo scenario → SceneInput ──────────────────────────────────
console.log('\n── scenario → SceneInput ────────────────────────────────────────');
const scenario = buildScenario();
console.log(`scenario: ${scenario.mission.code} · ${scenario.snapshots.length} time steps · ${scenario.snapshots[0].icebergs.length} bergs`);

function depsFor(step: number): MapDataDeps {
  const snapshot = scenario.snapshots[step];
  return {
    live: false,
    theme: 'dark',
    layers: {
      seaIce: true, icebergs: true, trajectories: true, risk: true,
      weather: true, routes: true, graticule: true,
    },
    selection: { kind: 'none' },
    scenario,
    snapshot,
    env: {
      seaIceGrid: null, riskGrid: null, fieldMode: 'CONCENTRATION', riskEnabled: false,
      icebergs: [], bergSituation: new Map(), focusBergId: null, showBergPredictions: true,
      zones: [], wind: [], optRoutes: null, optOrigin: null, optDestination: null,
      selectedRouteProfile: null, drill: null, error: false,
    },
    mission: { active: false, mission: null, sim: null, candidatePlan: null, selectedProfile: null, reviewWorstAt: null },
    animate: { waves: true, windParticles: true, routeFlow: true, pulses: true },
  };
}

const input0 = buildSceneInput(depsFor(0));
console.log(`T+0 → ${input0.routes.length} routes, ${input0.icebergs.length} bergs, ` +
  `${input0.wind.length} wind cells, ${input0.endpoints.length} endpoints, ` +
  `field ${input0.field ? `${input0.field.grid.nLon}×${input0.field.grid.nLat}` : 'none'}, ` +
  `risk ${input0.riskField ? 'on' : 'off'}`);
check('routes mapped', input0.routes.length === scenario.snapshots[0].routes.length, `${input0.routes.length}`);
check('icebergs mapped', input0.icebergs.length === scenario.snapshots[0].icebergs.length);
check('wind cells mapped', input0.wind.length === scenario.snapshots[0].weather.cells.length);
check('origin + destination present', input0.endpoints.length === 2);
check('vessel present', !!input0.vessel, input0.vessel?.name ?? 'none');
check('sea-ice field attached', !!input0.field && !!input0.field.values);
check('risk field attached (layers.risk on)', !!input0.riskField && !!input0.riskField.severity);
check('exactly one route is animated (the active leg)',
  input0.routes.filter((r) => r.animated).length === 1,
  input0.routes.map((r) => `${r.id}:${r.animated ? 'A' : '-'}`).join(' '));

const labels0 = buildLabels(input0);
console.log('labels:', labels0.map((l) => `${l.id}=${l.text}`).join(' · '));
check('vessel label present', labels0.some((l) => l.kind === 'vessel'));
check('endpoint labels present', labels0.filter((l) => l.kind === 'endpoint').length === 2);

// berg geometry is derived from real dimensions
const big = input0.icebergs.reduce((a, b) => (a.lengthKm > b.lengthKm ? a : b));
console.log(`largest berg ${big.id}: ${big.lengthKm.toFixed(2)} km long, ${big.widthKm.toFixed(2)} km wide, heading ${big.headingDeg}°`);
check('berg length matches metres → km', Math.abs(big.lengthKm * 1000 - scenario.snapshots[0].icebergs
  .find((b) => b.id === big.id)!.lengthM) < 1e-6);
check('nm→km constant is right', Math.abs(NM_TO_KM - 1.852) < 1e-9);

// threatened bergs carry a prediction corridor; others do not (matches old renderer)
const threat = scenario.snapshots[24 / 6].icebergs.filter((b) => b.routeThreatLevel === 'HIGH' || b.routeThreatLevel === 'CRITICAL');
const inputT24 = buildSceneInput(depsFor(4));
const withPred = inputT24.icebergs.filter((b) => b.prediction);
console.log(`T+24 → ${inputT24.routes.length} routes, ${withPred.length}/${inputT24.icebergs.length} bergs with corridors, ${threat.length} threatening`);
check('only threatened/selected bergs get corridors', withPred.length === threat.length,
  `${withPred.length} vs ${threat.length}`);
check('route set grows when the re-plan appears',
  inputT24.routes.length >= input0.routes.length, `${input0.routes.length} → ${inputT24.routes.length}`);

// ── 4. re-planning drill ────────────────────────────────────────────────
console.log('\n── re-planning drill ────────────────────────────────────────────');
const drillRoutes: OptRoute[] = [
  {
    profile: 'BALANCED', label: 'Balanced', severityCeiling: 'MEDIUM', excludes: 'HIGH+',
    status: 'OK', recommended: true,
    waypoints: [{ lat: -57.5, lon: 60 }, { lat: -63, lon: 70 }, { lat: -69.35, lon: 76.19 }],
    distanceNm: 900, estTimeH: 74, fuelEstimate: null,
  },
  {
    profile: 'CONSERVATIVE', label: 'Conservative', severityCeiling: 'LOW', excludes: 'MEDIUM+',
    status: 'OK', recommended: false,
    waypoints: [{ lat: -57.5, lon: 60 }, { lat: -61, lon: 82 }, { lat: -69.35, lon: 76.19 }],
    distanceNm: 1050, estTimeH: 86, fuelEstimate: null,
  },
];
const drillData = {
  drill: { name: 'drill', version: '1', simulated: true as const, simulatedFacts: [], realFacts: '', deterministic: true as const },
  scenario: {
    origin: { lat: -57.5, lon: 60 }, destination: { lat: -69.35, lon: 76.19 },
    iceClass: 'PC5', cruiseSpeedKn: 12.5, advanceHours: 24,
  },
  stages: [
    { id: 'MISSION_START', simTime: 'T0', title: '', narrative: '', data: { plan: { routes: drillRoutes, recommendation: { profile: 'BALANCED', reason: '', rule: '' }, request: { origin: { lat: 0, lon: 0 }, destination: { lat: 0, lon: 0 }, iceClass: 'PC5', cruiseSpeedKn: 12.5, horizonH: 0 }, assumptions: [], warnings: [], executedAt: '', optimizer: { name: '', version: '', method: '' } } } },
    { id: 'ROUTE_ACCEPTED', simTime: 'T0', title: '', narrative: '', data: { acceptedProfile: 'BALANCED' } },
    { id: 'UNDERWAY', simTime: 'T+24', title: '', narrative: '', data: { vesselPosition: { lat: -63, lon: 70 }, coveredNm: 300 } },
    { id: 'BERG_DEVIATION', simTime: 'T+24', title: '', narrative: '', data: { bergId: 'B09B', before: { lat: -64, lon: 71, regime: 'GROUNDED' }, after: { lat: -63.4, lon: 70.6, regime: 'MOVING' }, zone: { lat: -63.4, lon: 70.6, coreRadiusKm: 12, p50RadiusKm: 40, p90RadiusKm: 95 } } },
    { id: 'CONFLICT_DETECTED', simTime: 'T+24', title: '', narrative: '', data: {} },
    { id: 'REPLAN', simTime: 'T+25', title: '', narrative: '', data: { plan: { routes: drillRoutes, recommendation: { profile: 'CONSERVATIVE', reason: '', rule: '' }, request: { origin: { lat: 0, lon: 0 }, destination: { lat: 0, lon: 0 }, iceClass: 'PC5', cruiseSpeedKn: 12.5, horizonH: 0 }, assumptions: [], warnings: [], executedAt: '', optimizer: { name: '', version: '', method: '' } } } },
    { id: 'DECISION_PENDING', simTime: 'T+25', title: '', narrative: '', data: {} },
  ],
  warnings: [],
  executedAt: '',
};

for (const stage of [0, 1, 2, 3, 4, 5, 6]) {
  const view = buildDrillView(drillData, stage, stage === 6);
  const d: MapDataDeps = {
    ...depsFor(0),
    live: true,
    env: { ...depsFor(0).env, drill: view },
  };
  const out = buildSceneInput(d);
  const ids = out.routes.map((r) => r.id).join(',');
  console.log(`stage ${stage} → routes [${ids}] · vessel ${out.vessel ? 'yes' : 'no'} · zones ${out.zones.length} · hazards ${out.hazards.length}`);
  if (stage === 0) check('stage 0 shows all alternatives', out.routes.length === 2, ids);
  if (stage === 2) check('stage 2 shows only the accepted route + vessel', out.routes.length === 1 && !!out.vessel, ids);
  if (stage === 3) check('stage 3 raises the berg hazard zone', out.zones.length === 1);
  if (stage === 4) check('stage 4 marks the conflict point', out.hazards.length === 1);
  if (stage === 5) check('stage 5 draws the new route', out.routes.some((r) => r.id === 'drill:new'), ids);
  if (stage === 6) check('stage 6 keeps the new route after acceptance', out.routes.some((r) => r.id === 'drill:new'));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
