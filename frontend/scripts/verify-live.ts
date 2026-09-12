/**
 * LIVE-mode verification.
 *
 * `verify-3d.ts` proves the DEMO path. This script drives the SAME mapping
 * code (`buildSceneInput` / `buildLabels`) with data fetched over HTTP from the
 * real services, through the same Vite proxy the browser uses. It exists
 * because LIVE touches code paths DEMO never reaches:
 *
 *   · `opt:<PROFILE>` routes from the Python route optimizer
 *   · the σ (uncertainty) field mode
 *   · the risk-severity grid and the second SeaIceLayer it feeds
 *   · NIC icebergs with real dimensions, and berg prediction corridors
 *   · wind barbs from the live weather feed
 *
 * Requires the stack to be running (frontend :5173, env data :8100, api :8200).
 * Run: npx tsx scripts/verify-live.ts
 */
import { buildSceneInput, buildLabels } from '../src/components/map/sceneData';
import type { MapDataDeps } from '../src/components/map/sceneData';
import type { SceneInput } from '../src/map3d/PolarScene';
import type { ZoneSpec } from '../src/map3d/zones';
import type { WindCellSpec } from '../src/map3d/weather';
import type { OptRoute } from '../src/types/env';

const BASE = process.env.POLARIS_BASE ?? 'http://localhost:5173';
const AOI = '40,-72,100,-55';

let failures = 0;
const note = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

async function get(path: string) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

const EMPTY_LAYERS = {
  seaIce: true, icebergs: true, trajectories: true, risk: true,
  weather: true, routes: true, graticule: true,
};

(async () => {
  console.log(`\n── LIVE feeds via ${BASE} ───────────────────────────────────────`);

  // ── fetch the real feeds ──────────────────────────────────────────────
  const seaIce = await get(`/env/sea-ice?bbox=${AOI}`);
  const bergs = await get('/env/icebergs');
  const weather = await get(`/env/weather?bbox=${AOI}`);
  const risk = await get('/api/risk/spatial?ice_class=PC5&horizon_h=24');
  const opt = await fetch(`${BASE}/api/routes/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: { lat: -57.5, lon: 60 },
      destination: { lat: -69.35, lon: 76.19 },
      iceClass: 'PC5',
      cruiseSpeedKn: 12,
      horizonH: 24,
    }),
  }).then((r) => (r.ok ? r.json() : null));

  const iceGrid = seaIce.data.grid;
  const riskGrid = risk?.data?.grid ?? null;
  const bergList = (bergs.data?.icebergs ?? bergs.data ?? []) as {
    id: string; lat: number; lon: number;
    length_nm: number | null; width_nm: number | null;
  }[];
  const cells = (weather.data?.cells ?? []) as {
    lat: number; lon: number; windSpeedKn: number; windDirDeg: number;
  }[];
  const optRoutes = (opt?.data?.routes ?? []) as OptRoute[];

  const validIce = iceGrid.values.flat().filter((v: number) => v !== iceGrid.noData).length;
  console.log(`sea ice  ${iceGrid.nLon}×${iceGrid.nLat} · ${validIce} valid cells · lon0 ${iceGrid.lon0}`);
  console.log(`icebergs ${bergList.length} · weather ${cells.length} cells`);
  console.log(`risk     ${riskGrid ? `${riskGrid.nLon}×${riskGrid.nLat}` : 'ABSENT'} · routes ${optRoutes.length} (${optRoutes.map((r) => r.profile).join(',') || '—'})`);

  // ── the feeds must actually be populated ──────────────────────────────
  note(validIce > 100, `sea-ice grid carries real concentration (${validIce} cells)`);
  note(bergList.length > 0, `iceberg feed non-empty (${bergList.length})`);
  note(cells.length > 0, `weather feed non-empty (${cells.length} cells)`);
  note(riskGrid !== null, 'risk grid served');
  note(optRoutes.length > 0, `route optimizer returned profiles (${optRoutes.length})`);

  // ── map them exactly the way AntarcticMap does ────────────────────────
  const wind: WindCellSpec[] = cells.map((c) => ({
    lon: c.lon, lat: c.lat, windSpeedKn: c.windSpeedKn, windDirDeg: c.windDirDeg,
  }));

  const seaIceGrid: SceneInput['field'] = { grid: iceGrid, values: iceGrid.values };
  const riskField: SceneInput['field'] =
    riskGrid ? { grid: riskGrid, severity: (riskGrid as unknown as { severity: number[][] }).severity } : null;

  const deps: MapDataDeps = {
    live: true,
    theme: 'dark',
    layers: EMPTY_LAYERS,
    selection: { kind: 'none' },
    scenario: null,
    snapshot: null,
    env: {
      seaIceGrid,
      riskGrid: riskField,
      fieldMode: 'CONCENTRATION',
      riskEnabled: true,
      icebergs: bergList.map((b) => ({
        id: b.id, lon: b.lon, lat: b.lat, length_nm: b.length_nm, width_nm: b.width_nm,
      })),
      bergSituation: new Map(),
      focusBergId: null,
      showBergPredictions: true,
      zones: [] as ZoneSpec[],
      wind,
      optRoutes,
      optOrigin: { lat: -57.5, lon: 60 },
      optDestination: { lat: -69.35, lon: 76.19 },
      selectedRouteProfile: optRoutes.find((r) => r.recommended)?.profile ?? null,
      drill: null,
      error: false,
    },
    mission: {
      active: false, mission: null, sim: null,
      candidatePlan: null, selectedProfile: null, reviewWorstAt: null,
    },
    animate: { waves: true, windParticles: true, routeFlow: true, pulses: true },
  };

  const input = buildSceneInput(deps);
  const labels = buildLabels(input);

  // ── assertions on what reaches the GPU ────────────────────────────────
  console.log(`\n── SceneInput ───────────────────────────────────────────────────`);
  console.log(`routes ${input.routes.length} [${input.routes.map((r) => r.id).join(', ')}]`);
  console.log(`bergs  ${input.icebergs.length} · wind ${input.wind.length} · zones ${input.zones.length}`);
  console.log(`field  ${input.field ? `${input.field.grid.nLon}×${input.field.grid.nLat}` : 'null'} · riskField ${input.riskField ? 'present' : 'null'} · mode ${input.fieldMode}`);
  console.log(`labels ${labels.length} [${labels.map((l) => l.kind).join(', ')}]`);

  note(input.routes.length > 0, 'LIVE routes mapped from the optimizer');
  note(input.routes.every((r) => r.id.startsWith('opt:')), `route ids use the opt: prefix (${input.routes[0]?.id})`);
  const withWp = input.routes.filter((r) => r.waypoints.length >= 2);
  note(withWp.length === input.routes.length, `every route has ≥2 waypoints (${withWp.length}/${input.routes.length})`);

  const animated = input.routes.filter((r) => r.animated);
  note(animated.length === 1, `exactly one route animates — the selected profile (${animated.map((r) => r.id).join(',') || 'none'})`);

  note(input.icebergs.length === bergList.length, `all ${bergList.length} bergs reached the scene`);
  const dims = input.icebergs.filter((b) => b.lengthKm > 0 && b.widthKm > 0);
  note(dims.length > 0, `berg geometry sized from real dimensions (${dims.length} with both axes)`);

  note(input.wind.length > 0, `wind barbs mapped (${input.wind.length})`);
  note(input.wind.every((w) => Number.isFinite(w.windSpeedKn) && Number.isFinite(w.windDirDeg)),
    'wind cells carry finite speed and direction');

  note(input.field !== null, 'sea-ice field attached');
  note(input.riskField !== null, 'risk-severity field attached (drives the 2nd ice layer)');
  note(input.fieldMode === 'CONCENTRATION', `field mode is ${input.fieldMode}`);

  note(labels.some((l) => l.kind === 'endpoint'), 'origin/destination labels present');
  note(labels.filter((l) => l.kind === 'route').length > 0, 'route labels present');

  // no NaN anywhere in what we hand the GPU
  const badWp = input.routes.flatMap((r) => r.waypoints).filter((w) => !Number.isFinite(w.lon) || !Number.isFinite(w.lat));
  note(badWp.length === 0, `no NaN waypoints (${badWp.length})`);
  const badBerg = input.icebergs.filter((b) => !Number.isFinite(b.lon) || !Number.isFinite(b.lat));
  note(badBerg.length === 0, `no NaN berg positions (${badBerg.length})`);

  // ── σ mode: the uncertainty raster must survive the same mapping ──────
  const fc = await fetch(`${BASE}/ml/sea-ice/forecast?horizon_h=24&bbox=${AOI}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (fc?.data?.sigmaGrid) {
    const sigmaField: SceneInput['field'] = { grid: fc.data.grid, sigma: fc.data.sigmaGrid };
    const sigmaInput = buildSceneInput({
      ...deps,
      env: { ...deps.env, seaIceGrid: sigmaField, fieldMode: 'SIGMA' },
    });
    const sigVals = sigmaField.sigma.flat().filter((v: number) => v > 0).length;
    console.log(`\nσ mode: ${sigVals} non-zero uncertainty cells`);
    note(sigmaInput.fieldMode === 'SIGMA', 'σ field mode propagates');
    note(sigVals > 0, 'σ grid carries real uncertainty values');
  } else {
    console.log('\nσ mode: forecast unavailable — skipped');
  }

  console.log(`\n${failures === 0 ? 'ALL LIVE CHECKS PASSED' : `${failures} LIVE CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nERROR:', (e as Error).message);
  process.exit(2);
});
