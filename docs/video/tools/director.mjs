/**
 * POLARIS-X demo-video director (final).
 *
 * Model: each act has a narration cue. Slow, latency-bearing actions (LIVE
 * fetch, forecast, risk recompute, route optimisation, drill compute) are
 * PRE-WARMED before the cue, so the narration always lands on content that is
 * already on screen. Each act is then held for at least the length of its
 * narration, which makes the video self-timing: no narration can overlap the
 * next act, and the audio is placed afterwards using the recorded cue times.
 *
 *   REC=1 node director.mjs       → records video to /tmp/vidgen/video/
 *   SHOTS=key|all|none node …     → dry run (screenshots cost ~9 s each here)
 */
import { bootstrap } from './bootstrap.mjs';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const REC = process.env.REC === '1';
const SHOTS = REC ? 'none' : (process.env.SHOTS ?? 'key');
const OUT = '/tmp/vidgen';
mkdirSync(`${OUT}/shots`, { recursive: true });
mkdirSync(`${OUT}/video`, { recursive: true });

const log = [];
let videoT0 = Date.now();
let readyRel = 0;
const rel = () => (Date.now() - videoT0) / 1000;
const mark = (name) => {
  const t = rel();
  log.push({ name, t: Number(t.toFixed(2)) });
  console.log(`  [${t.toFixed(2).padStart(7)}] ${name}`);
  return t;
};
const until = async (s) => { const ms = s * 1000 - (Date.now() - videoT0); if (ms > 0) await page.waitForTimeout(ms); };

/* narration lengths, seconds (measured from the generated audio) */
const AUDIO = { 1: 22.0, 2: 28.8, 3: 30.3, 4: 21.5, 5: 35.1, 6: 33.7, 7: 27.7, 71: 12.0, 8: 29.2, 9: 31.5, 10: 44.2 };
const hold = async (cueT, key, slack = 2.0) => { await until(cueT + AUDIO[key] + slack); };
const at = async (t) => until(t);
const KEY_SHOTS = new Set(['01_hook', '02_live', '03_uncertainty', '05_risk_on', '06_routes', '07f_mission_open', '09b_candidates', '10g_replan']);

const exe = await bootstrap();
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--no-zygote', '--single-process',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--in-process-gpu', '--font-render-hinting=none',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
    '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process'],
});
videoT0 = Date.now();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
  ...(REC ? { recordVideo: { dir: `${OUT}/video`, size: { width: 1600, height: 900 } } } : {}),
});
const page = await ctx.newPage();
page.on('pageerror', () => {});

const CURSOR_JS = () => {
  const add = () => {
    if (document.getElementById('__pe_cursor')) return;
    const st = document.createElement('style');
    st.textContent = `
      #__pe_cursor { position: fixed; left: 0; top: 0; width: 20px; height: 20px; margin: -10px 0 0 -10px;
        pointer-events: none; z-index: 2147483647; transition: transform 70ms linear; }
      #__pe_cursor .ring { position: absolute; inset: 0; border-radius: 50%;
        border: 1.6px solid rgba(255,255,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 0 10px rgba(0,0,0,.5); }
      #__pe_cursor .dot { position: absolute; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
        border-radius: 50%; background: #7fd8ff; box-shadow: 0 0 6px rgba(127,216,255,.9); }
      #__pe_cursor.click .ring { animation: __pe_pulse 420ms ease-out; }
      @keyframes __pe_pulse { 0% { transform: scale(1); opacity: 1 } 100% { transform: scale(2.1); opacity: 0 } }
    `;
    document.head.appendChild(st);
    const el = document.createElement('div');
    el.id = '__pe_cursor';
    el.innerHTML = '<div class="ring"></div><div class="dot"></div>';
    document.body.appendChild(el);
    const draw = (x, y) => { el.style.transform = `translate(${x}px, ${y}px)`; };
    draw(innerWidth / 2, innerHeight / 2);
    document.addEventListener('mousemove', (e) => draw(e.clientX, e.clientY), true);
    document.addEventListener('mousedown', () => { el.classList.remove('click'); void el.offsetWidth; el.classList.add('click'); }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
};
await page.addInitScript(CURSOR_JS);

/* ── helpers ─────────────────────────────────────────────────────────────── */
const sleep = (s) => page.waitForTimeout(Math.max(0, s * 1000));
const shot = async (name, key) => {
  if (SHOTS === 'none') return;
  if (SHOTS === 'key' && !KEY_SHOTS.has(name)) return;
  await page.screenshot({ path: `${OUT}/shots/${name}.png` });
};
const rail = () => page.locator('.dss-right-rail');
const btn = (name) => page.getByRole('button', { name });
const waitText = (t, ms = 25000) => page.waitForSelector(`text=${t}`, { timeout: ms }).catch(() => {});
const waitBtn = (name, ms = 60000) => btn(name).first().waitFor({ state: 'visible', timeout: ms }).catch(() => {});

async function glide(x, y, steps = 7) { await page.mouse.move(x, y, { steps }); await page.waitForTimeout(200); }
async function clickAt(locator, { steps = 7, settle = 0.35, label } = {}) {
  await locator.scrollIntoViewIfNeeded({ timeout: 6000 }).catch(() => {});
  const box = await locator.boundingBox({ timeout: 15000 });
  if (!box) throw new Error(`no bounding box for ${label ?? locator}`);
  await glide(box.x + box.width / 2, box.y + box.height / 2, steps);
  await locator.click({ timeout: 20000 });
  await sleep(settle);
}
const railScroll = async (text, settle = 0.45) => {
  await rail().getByText(text, { exact: false }).first().scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  await sleep(settle);
};


/* ── WARM-UP (trimmed from the final video) ──────────────────────────────
 * Every heavy computation the take depends on is triggered here so the take
 * itself runs at UI speed: LIVE feeds, +48 h forecast, spatial risk for three
 * ice classes, the A* optimizer, the mission path (create → routes → replan)
 * and the deterministic re-planning drill.
 * ─────────────────────────────────────────────────────────────────────── */
async function warmUp() {
  const t = (m) => console.log(`  warm ${((Date.now() - videoT0) / 1000).toFixed(1).padStart(6)}s  ${m}`);
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.dss-map-stage canvas', { timeout: 40000 });
  await page.waitForTimeout(2200);
  t('app booted');

  await clickAt(page.getByRole('tab', { name: 'LIVE' }), { settle: 0.3 });
  await waitText('Named bergs in area', 120000);
  t('live feeds loaded');

  await railScroll('Observation day', 0.5);
  for (const h of ['+48H', 'OBS']) {                       // caches the forecast client-side
    await clickAt(page.getByRole('tab', { name: h }), { settle: 0.3 });
    await page.waitForTimeout(1500);
  }
  t('forecast cached');

  await railScroll('Show navigation risk', 0.5);
  await clickAt(page.getByRole('switch', { name: 'Toggle risk layer' }), { settle: 0.3 });
  await waitText('Worst cell in area', 90000);
  const iceTabs = page.getByRole('tablist', { name: 'Vessel ice class' });
  for (const ic of ['PC7', 'NONE', 'PC5']) {
    await clickAt(iceTabs.getByRole('tab', { name: ic, exact: true }), { settle: 1.2 });
  }
  t('risk surfaces warmed');

  await railScroll('Calculate routes', 0.5);
  await clickAt(btn(/Calculate routes/i), { settle: 0.3 });
  await waitText('RECOMMENDED', 180000);
  t('optimizer warmed');
  await clickAt(btn(/^Clear$/), { settle: 0.4 }).catch(() => {});

  await railScroll('Route Simulation', 0.5);
  await clickAt(btn(/Run simulation/), { settle: 0.3 });
  await waitText('Mission start', 180000);
  t('drill warmed');
  await clickAt(btn(/Exit/), { settle: 0.5 });
  await page.waitForTimeout(1200);

  // mission path through the API (same code paths the wizard uses)
  await page.evaluate(async () => {
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const body = {
      name: 'warmup', origin: { lat: -57.5, lon: 60 }, destination: { lat: -69.407, lon: 76.192 },
      departureUtc: '2026-09-02T00:00:00Z',
      vessel: { name: 'warmup', type: 'Research / resupply', iceClass: 'PC5', cruiseSpeedKn: 12.5, maxAcceptableSeverity: 'LOW' },
    };
    const r = await post('/api/missions', body);
    const id = r?.mission?.id;
    if (!id) return;
    await post(`/api/missions/${id}/routes`, {});
    await post(`/api/missions/${id}/replan`, { position: { lat: -61.57, lon: 64.64 }, simTime: '2026-09-03T00:00:00Z' });
    await fetch(`/api/missions/${id}`, { method: 'DELETE' });
    window.__warmMission = id;
  });
  t('mission path warmed');

  /* reset the UI so the take starts from a clean LIVE state */
  await clickAt(page.getByRole('switch', { name: 'Toggle risk layer' }), { settle: 0.5 }).catch(() => {});
  await clickAt(btn(/Why this risk/), { settle: 0.3 }).catch(() => {});
  await rail().evaluate((el) => { el.scrollTop = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(800, 620);
  await page.waitForTimeout(1500);
  t('reset done');
}

/* ── take ────────────────────────────────────────────────────────────────── */
try {
  await warmUp();
  const takeStart = mark('take_start');
  await page.waitForTimeout(600);
  readyRel = rel();
  const c1 = mark('shot01_cue');

  /* ACT 1 · hook */
  await glide(700, 300, 16);
  await page.mouse.down();
  for (const [dx, dy] of [[95, 12], [200, 24]]) { await page.mouse.move(700 + dx, 300 + dy, { steps: 12 }); await sleep(1.1); }
  await page.mouse.up();
  await shot('01_hook');
  await glide(980, 520, 10);
  await hold(c1, 1);

  /* ACT 2 · LIVE + provenance */
  const c2 = mark('shot02_cue');
  await shot('02_live', true);
  await at(c2 + 7);
  await clickAt(page.getByRole('tab', { name: 'SIMULATION' }), { settle: 0.8 });
  await at(c2 + 10);
  await clickAt(page.getByRole('tab', { name: 'LIVE' }), { settle: 0.4 });
  await waitText('Named bergs in area', 60000);
  await at(c2 + 15);
  await railScroll('PLANNED', 0.7);
  await glide(1350, 470, 10);
  await shot('02b_provenance');
  await hold(c2, 2);

  /* ACT 3 · sea ice — observations first, then forecast (selecting a forecast
     horizon clears the observation selection, so the order matters) */
  await railScroll('Observation day', 0.8);
  const c3 = mark('shot03_cue');
  await shot('03_seaice_obs');
  const slider = page.getByLabel('Sea-ice observation day');
  await at(c3 + 3); await clickAt(slider, { settle: 0.15, label: 'sea-ice slider' });
  await page.keyboard.press('ArrowRight');
  await at(c3 + 5); await page.keyboard.press('ArrowLeft');
  await shot('03b_observed_days');
  await at(c3 + 11);
  await clickAt(page.getByRole('tab', { name: '+48H' }), { settle: 0.3 });
  await waitText('Uncertainty', 60000);
  mark('shot03_forecast_loaded');
  await shot('03c_forecast48');
  await at(c3 + 21);
  await clickAt(page.getByRole('switch', { name: 'Toggle uncertainty layer' }), { settle: 1.2 });
  await shot('03_uncertainty', true);
  await at(c3 + 26);
  await railScroll('Forecast model', 0.4);
  await clickAt(btn(/Forecast model/), { settle: 1.2 });
  await shot('03d_model');
  await hold(c3, 3);

  /* ACT 4 · iceberg intelligence */
  const c4 = mark('shot04_cue');
  await railScroll('Named bergs in area', 0.8);
  await at(c4 + 5);
  await clickAt(btn(/C18C/), { settle: 1.4 });
  await shot('04_icebergs');
  await at(c4 + 13);
  const trackToggle = page.getByRole('switch', { name: 'Toggle berg drift forecasts' });
  await clickAt(trackToggle, { settle: 0.5 });
  await at(c4 + 16);
  await clickAt(trackToggle, { settle: 1.0 });
  await hold(c4, 4);

  /* ACT 5 · risk — pre-warm the spatial risk surface */
  await railScroll('Show navigation risk', 0.6);
  await clickAt(page.getByRole('switch', { name: 'Toggle risk layer' }), { settle: 0.3 });
  await waitText('Worst cell in area', 60000);
  const c5 = mark('shot05_cue');
  await shot('05_risk_on', true);
  const iceTabs = page.getByRole('tablist', { name: 'Vessel ice class' });
  await at(c5 + 13);
  await clickAt(iceTabs.getByRole('tab', { name: 'PC7', exact: true }), { settle: 1.2 });
  await shot('05_risk_PC7');
  await at(c5 + 22);
  await clickAt(iceTabs.getByRole('tab', { name: 'NONE', exact: true }), { settle: 1.2 });
  await shot('05_risk_NONE');
  await at(c5 + 29);
  await clickAt(iceTabs.getByRole('tab', { name: 'PC5', exact: true }), { settle: 1.0 });
  await at(c5 + 30);
  await clickAt(btn(/Why this risk/), { settle: 1.0 });
  await shot('05b_why');
  /* pre-warm inside the narration window: switch to the planner and optimise */
  await at(c5 + 33);
  await railScroll('Calculate routes', 0.4);
  await clickAt(btn(/Calculate routes/i), { settle: 0.3 });
  await waitText('RECOMMENDED', 120000);
  const c6 = mark('shot06_cue');
  await shot('06_routes', true);
  await at(c6 + 12);
  const directCard = rail().getByRole('button', { name: /DIRECT/ }).first();
  await clickAt(directCard, { settle: 0.7 });
  if (await btn(/route details/).count() === 0) await clickAt(directCard, { settle: 0.7 });
  await at(c6 + 18);
  await railScroll('route details', 0.4);
  await clickAt(btn(/route details/), { settle: 1.0 }).catch(() => {});
  await waitText('NOT COMPUTED', 12000);
  await shot('06b_details');
  await at(c6 + 26);
  await railScroll('Method', 0.3);
  await clickAt(btn(/Method/), { settle: 0.9 }).catch(() => {});
  await shot('06c_method');
  /* pre-warm inside the narration window: open the mission wizard */
  await at(c6 + 31);
  await railScroll('CREATE NEW MISSION', 0.4);
  await clickAt(btn(/CREATE NEW MISSION/), { settle: 0.6 });
  await waitText('All parameters are operator-defined', 30000);
  await hold(c6, 6);
  const c7 = mark('shot07_cue');
  await shot('07a_wizard');
  await page.locator('input[placeholder="Bharati resupply — leg 2"]').fill('Bharati resupply — leg 2');
  await at(c7 + 3);
  await page.locator('input[placeholder="MV Vasiliy Golovnin"]').type('MV Vasiliy Golovnin', { delay: 18 });
  await shot('07b_filled');
  const originPanel = page.locator('div.panel-inset', { hasText: 'ORIGIN' }).first();
  await at(c7 + 8);
  await clickAt(originPanel.getByRole('button', { name: /Pick on map/ }), { settle: 0.6 });
  const canvas = page.locator('.dss-map-stage canvas').first();
  const cbox = await canvas.boundingBox();
  await at(c7 + 11);
  await glide(cbox.x + cbox.width * 0.30, cbox.y + cbox.height * 0.42, 14);
  await page.mouse.click(cbox.x + cbox.width * 0.30, cbox.y + cbox.height * 0.42);
  await sleep(0.8);
  await shot('07c_map_pick');
  const oi = originPanel.locator('input');
  await oi.nth(0).fill('-57.500');
  await oi.nth(1).fill('60.000');
  await oi.nth(2).fill('Southern Ocean staging');
  await at(c7 + 14);
  const destPanel = page.locator('div.panel-inset', { hasText: 'DESTINATION' }).first();
  await destPanel.locator('input[placeholder="Search stations & approach points…"]').type('bharati', { delay: 22 });
  await at(c7 + 17);
  await clickAt(destPanel.getByRole('button', { name: /Bharati · India/ }), { settle: 0.6 });
  await shot('07d_station');
  await at(c7 + 19);
  await page.locator('input[type="datetime-local"]').fill('2026-09-02T00:00');
  await at(c7 + 22);
  await clickAt(page.getByRole('button', { name: 'LOW', exact: true }), { settle: 0.3 });
  await shot('07e_departure');
  mark('shot07b_cue');                       // narration 7b starts here (fields already filled)
  await at(c7 + 26);
  await clickAt(btn(/Review mission/), { settle: 1.2 });
  await shot('07f_review');
  /* hold for the rest of narration 7 + narration 7b, then create the mission */
  await hold(c7, 7);
  await hold(c7 + AUDIO[7] + 2, 71);
  await clickAt(btn(/Create mission & generate routes/), { settle: 0.3 });
  mark('shot07_created');
  await waitBtn(/Accept & start voyage simulation/, 150000);
  mark('shot07_routes_ready');
  await shot('07g_mission_open', true);

  /* ACT 8 · accept route, voyage simulation, risk re-check */
  const c8 = mark('shot08_cue');
  await railScroll('Route Options', 0.5);
  await at(c8 + 4);
  await clickAt(rail().getByRole('button', { name: /DIRECT/ }).first(), { settle: 0.8 });
  await at(c8 + 8);
  await clickAt(btn(/Accept & start voyage simulation/).first(), { settle: 1.2 });
  mark('shot08_accepted');
  await shot('08b_underway');
  await at(c8 + 14);
  await clickAt(page.getByRole('button', { name: '+12h' }).last(), { settle: 1.2 });
  mark('shot08_step1');
  await railScroll('Conditions at Vessel', 0.7);
  await at(c8 + 24);
  await clickAt(page.getByRole('button', { name: '+12h' }).last(), { settle: 0.6 });
  mark('shot08_step2');
  await waitText('ROUTE REVIEW REQUIRED', 45000);
  await shot('09a_alert', true);

  /* ACT 9 · re-plan and accept */
  await hold(c8, 8);
  const c9 = mark('shot09_cue');
  await at(c9 + 4);
  await clickAt(btn(/Generate alternative routes/).first(), { settle: 0.3 });
  await waitText('Candidate Routes', 120000);
  mark('shot09_candidates');
  await shot('09b_candidates', true);
  await railScroll('Candidate Routes', 0.6);
  await at(c9 + 15);
  const candCard = page.locator('div.panel-inset', { hasText: 'CONSERVATIVE' }).first();
  await clickAt(candCard.getByRole('button').first(), { settle: 1.0 });
  await shot('09c_selected');
  await at(c9 + 21);
  await clickAt(candCard.getByRole('button', { name: /Accept this route/ }), { settle: 1.3 });
  mark('shot09_accepted');
  await shot('09d_accepted');
  await hold(c9, 9);

  /* ACT 10 · the drill — pre-warm: leave the mission, start the simulation */
  await clickAt(btn(/Close mission workspace/), { settle: 0.8 });
  await railScroll('Route Simulation', 0.6);
  await clickAt(btn(/Run simulation/), { settle: 0.3 });
  await waitText('Mission start', 150000);
  const c10 = mark('shot10_cue');
  await shot('10b_stage1');
  await at(c10 + 6);
  await clickAt(btn(/Accept recommended route/), { settle: 1.2 });
  await shot('10c_accepted_route');
  const advance = async (off, name, waitS) => {
    await at(c10 + off);
    await clickAt(btn('Advance'), { settle: 0.3 });
    await sleep(waitS);
    mark(name);
    await shot(name);
  };
  await advance(20, '10d_underway', 2.0);
  await advance(25, '10e_deviation', 2.2);
  await advance(29, '10f_conflict', 2.4);
  await advance(34, '10g_replan', 2.6);
  await advance(39, '10h_decision', 1.6);
  await at(c10 + 42);
  await clickAt(btn(/Accept new route/), { settle: 1.4 });
  mark('shot10_accepted_new');
  await shot('10i_accepted_new');
  await at(c10 + 46);
  await shot('10j_active');
  await hold(c10, 10, 3);
  await railScroll('Mission Event Log', 0.4).catch(() => {});
  await at(c10 + 52);
  await shot('11_close');
  mark('end');
} catch (e) {
  mark('ERROR');
  console.log('DIRECTOR ERROR:', String(e).slice(0, 500));
  if (SHOTS !== 'none') await page.screenshot({ path: `${OUT}/shots/error_state.png` }).catch(() => {});
} finally {
  const total = rel();
  writeFileSync(`${OUT}/timeline.json`, JSON.stringify({ videoT0, readyRel, cues: log, total, audio: AUDIO }, null, 2));
  console.log('total seconds:', total.toFixed(1));
  await ctx.close();
  await browser.close();
}
