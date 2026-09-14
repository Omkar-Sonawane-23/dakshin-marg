/**
 * Recorder — a Playwright "director" that opens the running Dakshin Marg web
 * app and drives it through the shot list in narration.json, recording video
 * and writing a cue timeline that the assembler uses to place the narration.
 *
 * Timing model: every act is held for at least its narration length, so the
 * voice can never overrun into the next act, and the recorded cue times are the
 * single source of truth for where each clip starts. Slow computations (LIVE
 * feeds, forecast, risk surfaces, optimizer, drill) are pre-warmed *before* the
 * take, so nothing on camera is a spinner.
 *
 *   node src/recorder.mjs --url=http://localhost:5173   (record)
 *   … --dry                                             (screenshots only)
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// playwright-core is imported lazily so preflight can install it first
import { FILES, STILLS, VIDEO, WORK, ensureDirs, makeLogger } from './config.mjs';
import { ensurePlaywrightFfmpeg, resolveFfmpeg } from './preflight.mjs';
import { readDurations } from './tts.mjs';

const log = makeLogger();

/* ── injected cursor: a visible pointer + click ripple ───────────────────── */
const CURSOR_JS = () => {
  const add = () => {
    // deterministic look on camera: mission-control dark theme (DM_THEME=light to override)
    try {
      const want = (window.__DM_THEME ?? 'dark');
      localStorage.setItem('dakshin-marg-theme', want);
      document.documentElement.dataset.theme = want;
    } catch { /* ignore */ }
    if (document.getElementById('__dm_cursor')) return;
    const st = document.createElement('style');
    st.textContent = `
      #__dm_cursor { position: fixed; left: 0; top: 0; width: 20px; height: 20px; margin: -10px 0 0 -10px;
        pointer-events: none; z-index: 2147483647; transition: transform 70ms linear; }
      #__dm_cursor .ring { position: absolute; inset: 0; border-radius: 50%;
        border: 1.6px solid rgba(255,255,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 0 10px rgba(0,0,0,.5); }
      #__dm_cursor .dot { position: absolute; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
        border-radius: 50%; background: #7fd8ff; box-shadow: 0 0 6px rgba(127,216,255,.9); }
      #__dm_cursor.click .ring { animation: __dm_pulse 420ms ease-out; }
      @keyframes __dm_pulse { 0% { transform: scale(1); opacity: 1 } 100% { transform: scale(2.1); opacity: 0 } }
      html, body { scrollbar-width: none !important; }
      ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
    `;
    document.head.appendChild(st);
    const el = document.createElement('div');
    el.id = '__dm_cursor';
    el.innerHTML = '<div class="ring"></div><div class="dot"></div>';
    (document.body ?? document.documentElement).appendChild(el);
    const draw = (x, y) => { el.style.transform = `translate(${x}px, ${y}px)`; };
    draw(innerWidth / 2, innerHeight / 2);
    document.addEventListener('mousemove', (e) => draw(e.clientX, e.clientY), true);
    document.addEventListener('mousedown', () => { el.classList.remove('click'); void el.offsetWidth; el.classList.add('click'); }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
};

/* ── main entry ─────────────────────────────────────────────────────────── */

/**
 * @param {object} opts
 * @param {object} opts.script      parsed narration.json (acts already filtered)
 * @param {string} opts.url         web app base URL
 * @param {object} opts.chromium    descriptor from preflight.resolveChromium()
 * @param {boolean} opts.record     false = dry run (screenshots, no video)
 * @param {boolean} opts.stills     write the pitch-deck stills into docs/video/stills
 * @param {number} opts.width/height
 */
export async function recordTake(opts) {
  const {
    script, url, chromium: chr, record = true, stills = true,
    width = VIDEO.width, height = VIDEO.height, warm = true,
  } = opts;
  ensureDirs();
  mkdirSync(join(WORK, 'video'), { recursive: true });
  mkdirSync(join(WORK, 'shots'), { recursive: true });

  const durations = readDurations();
  const knownAudio = Object.keys(durations).length > 0;
  if (!knownAudio) log.warn('no measured narration durations yet — holds use the word-count estimate');
  const shotsOn = opts.shots ?? !record;

  log.step(`Recorder — ${script.acts.length} act(s), ${record ? 'recording' : 'DRY RUN'} ${width}×${height}`);

  let executablePath = chr.executablePath;
  if (chr.inflate) executablePath = await chr.inflate();

  const { chromium: chromiumPw } = await import('playwright-core');
  const browser = await chromiumPw.launch({
    executablePath,
    headless: true,
    args: chr.args ?? [],
  });

  let videoT0 = Date.now();
  const cues = [];
  const rel = () => (Date.now() - videoT0) / 1000;
  const mark = (name) => {
    const t = Number(rel().toFixed(2));
    cues.push({ name, t });
    log.info(`  [${String(t).padStart(7)}] ${name}`);
    return t;
  };
  const until = async (s) => { const ms = s * 1000 - (Date.now() - videoT0); if (ms > 0) await page.waitForTimeout(ms); };

  videoT0 = Date.now();
  if (record) {
    // Playwright's video recorder needs an ffmpeg inside its own registry
    const ff = resolveFfmpeg({ install: false });
    if (ff.ok) ensurePlaywrightFfmpeg(ff.ffmpeg);
  }
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(record ? { recordVideo: { dir: join(WORK, 'video'), size: { width, height } } } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.addInitScript((theme) => { window.__DM_THEME = theme; }, opts.theme ?? process.env.DM_THEME ?? 'dark');
  await page.addInitScript(CURSOR_JS);

  /* ── helpers handed to every step ─────────────────────────────────────── */
  const sleep = (s) => page.waitForTimeout(Math.max(0, s * 1000));
  const rail = () => page.locator('.dss-right-rail');
  const railScroller = () => page.locator('.dss-right-rail > div').first();
  const leftScroller = () => page.locator('.dss-left-rail > div').first();
  const btn = (name) => page.getByRole('button', { name });
  const waitText = (t, ms = 25000) => page.waitForSelector(`text=${t}`, { timeout: ms }).catch(() => null);
  const waitBtn = (name, ms = 90000) => btn(name).first().waitFor({ state: 'visible', timeout: ms }).catch(() => null);
  const section = async (id, settle = 0.9) => {
    const b = page.locator(`button[data-section="${id}"]`).first();
    if (await b.count() === 0) { log.warn(`    nav section ${id} not found`); return false; }
    await b.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    const box = await b.boundingBox().catch(() => null);
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    await b.click({ timeout: 8000 }).catch(() => {});
    await sleep(settle);
    return true;
  };
  const shot = async (name) => {
    if (!shotsOn) return null;             // screenshots cost ~9 s each here; debug-only
    const p = join(WORK, 'shots', `${name}.png`);
    await page.screenshot({ path: p }).catch(() => {});
    return p;
  };
  const still = async (name) => {
    if (!stills) return;
    const p = join(STILLS, `${name}.jpg`);
    await page.screenshot({ path: p, type: 'jpeg', quality: 88 }).catch(() => {});
  };

  async function glide(x, y, steps = 8) {
    await page.mouse.move(x, y, { steps }).catch(() => {});
    await page.waitForTimeout(160);
  }
  async function clickAt(locator, { steps = 8, settle = 0.4, label, timeout = 15000 } = {}) {
    await locator.scrollIntoViewIfNeeded({ timeout: 6000 }).catch(() => {});
    const box = await locator.boundingBox({ timeout }).catch(() => null);
    if (!box) throw new Error(`no bounding box for ${label ?? 'locator'}`);
    await glide(box.x + box.width / 2, box.y + box.height / 2, steps);
    await locator.click({ timeout });
    await sleep(settle);
  }
  const railScroll = async (text, settle = 0.45) => {
    await rail().getByText(text, { exact: false }).first().scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await sleep(settle);
  };
  /** Slow, readable scroll of a panel from top to bottom and back. */
  async function scrollThrough(locator, { passes = 1, stepMs = 220 } = {}) {
    const el = locator.first();
    if (await el.count() === 0) return;
    await el.evaluate((n) => { n.scrollTop = 0; }).catch(() => {});
    await sleep(0.3);
    for (let p = 0; p < passes; p += 1) {
      const h = await el.evaluate((n) => Math.max(0, n.scrollHeight - n.clientHeight)).catch(() => 0);
      if (!h) return;
      const steps = Math.max(4, Math.min(26, Math.round(h / 130)));
      for (let i = 1; i <= steps; i += 1) {
        await el.evaluate((n, y) => { n.scrollTop = y; }, Math.round((h * i) / steps)).catch(() => {});
        await page.waitForTimeout(stepMs);
      }
      if (p + 1 < passes) {
        await el.evaluate((n) => { n.scrollTop = 0; }).catch(() => {});
        await sleep(0.4);
      }
    }
  }

  const C = {
    page, sleep, rail, railScroller, leftScroller, btn, waitText, waitBtn, section, shot, still,
    glide, clickAt, railScroll, scrollThrough, mark, until, log, url, width, height,
  };

  /** Hold the act for at least its narration length (+ slack). */
  const holdAct = async (act, cueT, slack = 1.5) => {
    const audio = durations[act.id] ?? 0;
    const target = cueT + Math.max(act.holdSeconds ?? 0, audio + slack);
    await until(target);
  };

  /* ── warm-up: everything heavy happens here, off camera ───────────────── */
  if (warm) await warmUp(C, mark, log);

  /* ── the take ─────────────────────────────────────────────────────────── */
  const errors = [];
  try {
    // a fresh load so the viewer watches the app open; the LIVE switch and
    // its feed load happen here, in the trimmed prologue, so the first frame
    // of the take is already the live system (the brief: LIVE mode only)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('.dss-map-stage canvas', { timeout: 60000 }).catch(() => {});
    await sleep(1.2);
    // gate on a LIVE-only signal (the top-bar analysis stamp), retrying the
    // tab click once in case the boot overlay swallowed the first one
    await clickAt(page.getByRole('tab', { name: 'LIVE' }), { settle: 0.6, label: 'LIVE tab (prologue)' }).catch(() => {});
    if (!await waitText('LATEST ANALYSIS', 25000)) {
      await clickAt(page.getByRole('tab', { name: 'LIVE' }), { settle: 0.6, label: 'LIVE tab (retry)' }).catch(() => {});
    }
    await waitText('LATEST ANALYSIS', 120000);
    await waitText('Named bergs in area', 60000);
    await sleep(1.5);
    mark('take_start');

    for (const act of script.acts) {
      if (act.group === 'cards') {
        // title/end cards are rendered separately; their cue still matters for
        // narration placement, but there is nothing to drive on screen.
        if (act.id === '16_close') {
          const cueT = mark(`${act.id}_cue`);
          try { await (STEPS[act.id] ?? noop)(C, act); } catch (e) { fail(act, e, errors); }
          await holdAct(act, cueT);
        } else {
          mark(`${act.id}_cue`);
        }
        continue;
      }
      const cueT = mark(`${act.id}_cue`);
      let actOk = true;
      try {
        await (STEPS[act.id] ?? genericTour)(C, act);
      } catch (e) {
        actOk = false;
        fail(act, e, errors);
      }
      await holdAct(act, cueT);
      const stillName = HOLD_STILLS[act.id];
      if (stillName && actOk && record) await C.still(stillName);
    }
    mark('end');
  } catch (e) {
    mark('FATAL');
    log.err(`take aborted: ${String(e.message || e).slice(0, 300)}`);
    await page.screenshot({ path: join(WORK, 'shots', 'error_state.png') }).catch(() => {});
  } finally {
    const total = rel();
    writeFileSync(FILES.timeline, JSON.stringify({
      videoT0, recordedAt: new Date().toISOString(), url,
      size: { width, height }, recorded: record,
      acts: script.acts.map((a) => ({ id: a.id, group: a.group, holdSeconds: a.holdSeconds })),
      durations, cues, total, errors,
    }, null, 2));
    log.ok(`take complete — ${total.toFixed(1)}s, ${cues.length} cues → ${FILES.timeline}`);
    if (errors.length) log.warn(`${errors.length} act(s) reported errors: ${errors.map((e) => e.act).join(', ')}`);
    await ctx.close();
    await browser.close();
  }

  return { timeline: FILES.timeline, total: rel(), errors };
}

function fail(act, e, errors) {
  const msg = String(e?.message || e).slice(0, 200);
  errors.push({ act: act.id, error: msg });
  log.warn(`  act ${act.id} failed (continuing): ${msg}`);
}

/** Stills captured at the end of an act's hold (screen idle, state settled). */
const HOLD_STILLS = {
  '01_open': '01_open',
  '02_live': '02_live_mode',
  '03_tour_plan': '03_console_tour',
  '06_seaice': '04_sea_ice_forecast',
  '09_routes': '06_route_planner',
  '10_mission': '07_mission_wizard',
  '12_underway': '08_review_required',
  '15_drill': '10_new_route_active',
};

const noop = async () => {};

/* ── act choreography ───────────────────────────────────────────────────── */

const STEPS = {
  /* ACT 01 · open the app in LIVE mode: cold-open drift on the 3-D polar chart */
  async '01_open'(C) {
    const cx = C.width * 0.44;
    const cy = C.height * 0.55;
    await C.glide(cx, cy, 18);
    await C.page.mouse.down();
    for (const [dx, dy] of [[70, 10], [150, 22], [210, 30]]) {
      await C.page.mouse.move(cx + dx, cy + dy, { steps: 14 });
      await C.sleep(1.0);
    }
    await C.page.mouse.up();
    await C.shot('01_open');
    await C.glide(C.width * 0.62, C.height * 0.6, 12);
  },

  /* ACT 02 · LIVE badge + provenance (already live since act 01) */
  async '02_live'(C) {
    await C.shot('02_live');
    await C.railScroll('PLANNED', 0.9);
    await C.glide(C.width * 0.84, C.height * 0.52, 10);
    await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 200 });
  },

  /* ACT 03 · tour: PLAN group */
  async '03_tour_plan'(C) {
    for (const [id, name] of [['MISSION', 'mission_control'], ['ROUTE_PLANNER', 'route_planner'], ['VESSEL', 'vessel_profiles']]) {
      if (!await C.section(id)) continue;
      await C.sleep(0.5);
      await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 200 });
      await C.shot(`03_${name}`);
    }
  },

  /* ACT 04 · tour: ENV group + the map layer list */
  async '04_tour_env'(C) {
    for (const [id, name] of [['SEA_ICE', 'sea_ice'], ['ICEBERGS', 'icebergs'], ['WEATHER', 'weather'], ['RISK', 'risk']]) {
      if (!await C.section(id)) continue;
      await C.sleep(0.5);
      await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 190 });
      await C.shot(`04_${name}`);
    }
    // map layers: the control that lists every layer with its provenance
    const layers = C.page.getByRole('button', { name: /layers/i }).first();
    if (await layers.count()) {
      await C.clickAt(layers, { settle: 1.0, label: 'map layers' }).catch(() => {});
      await C.shot('04_layers');
    }
  },

  /* ACT 05 · tour: OPS group */
  async '05_tour_ops'(C) {
    for (const [id, name] of [['SCENARIO', 'scenario'], ['VERIFICATION', 'verification'],
      ['PROVENANCE', 'provenance'], ['ALERTS', 'alerts'], ['HEALTH', 'health']]) {
      if (!await C.section(id)) continue;
      await C.sleep(0.45);
      await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 170 });
      await C.shot(`05_${name}`);
    }
  },

  /* ACT 06 · sea ice: observations → +48 h → σ band → model card */
  async '06_seaice'(C) {
    // In LIVE the whole environment is one stacked, scrollable panel on the
    // default section — the console tour left us on a module section, so come
    // back before the deep-dive acts (risk/routes/drill live in this stack).
    await C.section('MISSION');
    await C.railScroll('Observation day', 0.8);
    await C.shot('06_obs');
    const slider = C.page.getByLabel('Sea-ice observation day');
    if (await slider.count()) {
      await C.clickAt(slider, { settle: 0.2, label: 'sea-ice slider' }).catch(() => {});
      await C.page.keyboard.press('ArrowRight');
      await C.sleep(1.0);
      await C.page.keyboard.press('ArrowLeft');
      await C.sleep(0.8);
    }
    await C.shot('06_obs_days');
    await C.clickAt(C.page.getByRole('tab', { name: '+48H' }), { settle: 0.4, label: '+48H tab' }).catch(() => {});
    await C.waitText('Uncertainty', 60000);
    await C.shot('06_forecast48');
    const sigma = C.page.getByRole('switch', { name: 'Toggle uncertainty layer' });
    if (await sigma.count()) { await C.clickAt(sigma, { settle: 1.3, label: 'uncertainty layer' }).catch(() => {}); }
    await C.shot('06_uncertainty');
    await C.railScroll('Forecast model', 0.4);
    await C.clickAt(C.btn(/Forecast model/), { settle: 1.2, label: 'forecast model card' }).catch(() => {});
    await C.shot('06_model_card');
  },

  /* ACT 07 · icebergs */
  async '07_icebergs'(C) {
    await C.railScroll('Named bergs in area', 0.8);
    const berg = C.btn(/C18C/).first();
    if (await berg.count()) await C.clickAt(berg, { settle: 1.4, label: 'berg C18C' }).catch(() => {});
    await C.shot('07_icebergs');
    const tracks = C.page.getByRole('switch', { name: 'Toggle berg drift forecasts' });
    if (await tracks.count()) {
      await C.clickAt(tracks, { settle: 0.6, label: 'drift tracks on' }).catch(() => {});
      await C.sleep(1.4);
      await C.clickAt(tracks, { settle: 1.0, label: 'drift tracks off' }).catch(() => {});
    }
    await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 180 });
  },

  /* ACT 08 · risk: layer on, ice-class sweep, why-this-risk */
  async '08_risk'(C) {
    await C.railScroll('Show navigation risk', 0.6);
    const sw = C.page.getByRole('switch', { name: 'Toggle risk layer' });
    if (await sw.count()) await C.clickAt(sw, { settle: 0.4, label: 'risk layer' }).catch(() => {});
    await C.waitText('Worst cell in area', 90000);
    await C.shot('08_risk_on');
    const iceTabs = C.page.getByRole('tablist', { name: 'Vessel ice class' });
    for (const ic of ['PC7', 'NONE', 'PC5']) {
      const tab = iceTabs.getByRole('tab', { name: ic, exact: true }).first();
      if (await tab.count()) { await C.clickAt(tab, { settle: 1.3, label: `ice class ${ic}` }).catch(() => {}); }
      await C.shot(`08_risk_${ic}`);
      if (ic === 'PC7') await C.still('05_risk_pc7');
    }
    await C.clickAt(C.btn(/Why this risk/), { settle: 1.1, label: 'why this risk' }).catch(() => {});
    await C.shot('08_why_risk');
  },

  /* ACT 09 · routes */
  async '09_routes'(C) {
    await C.railScroll('Calculate routes', 0.5);
    await C.clickAt(C.btn(/Calculate routes/i), { settle: 0.4, label: 'calculate routes' });
    await C.waitText('RECOMMENDED', 180000);
    await C.shot('09_routes');
    const direct = C.rail().getByRole('button', { name: /DIRECT/ }).first();
    if (await direct.count()) await C.clickAt(direct, { settle: 0.8, label: 'DIRECT card' }).catch(() => {});
    await C.railScroll('route details', 0.4);
    await C.clickAt(C.btn(/route details/), { settle: 1.0, label: 'route details' }).catch(() => {});
    await C.waitText('NOT COMPUTED', 15000);
    await C.shot('09_details');
    await C.railScroll('Method', 0.3);
    await C.clickAt(C.btn(/Method/), { settle: 1.0, label: 'method' }).catch(() => {});
    await C.shot('09_method');
    await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 170 });
  },

  /* ACT 10 · mission wizard */
  async '10_mission'(C) {
    await C.railScroll('CREATE NEW MISSION', 0.5);
    await C.clickAt(C.btn(/CREATE NEW MISSION/), { settle: 0.8, label: 'create new mission' });
    await C.waitText('All parameters are operator-defined', 40000);
    await C.shot('10_wizard');
    const nameInput = C.page.locator('input[placeholder="Bharati resupply — leg 2"]');
    if (await nameInput.count()) await nameInput.first().fill('Bharati resupply — leg 2');
    const vesselInput = C.page.locator('input[placeholder="MV Vasiliy Golovnin"]');
    if (await vesselInput.count()) await vesselInput.first().type('MV Vasiliy Golovnin', { delay: 16 });
    await C.shot('10_filled');

    const originPanel = C.page.locator('div.panel-inset', { hasText: 'ORIGIN' }).first();
    if (await originPanel.count()) {
      const pick = originPanel.getByRole('button', { name: /Pick on map/ }).first();
      if (await pick.count()) await C.clickAt(pick, { settle: 0.7, label: 'pick on map' }).catch(() => {});
      const canvas = C.page.locator('.dss-map-stage canvas').first();
      const box = await canvas.boundingBox().catch(() => null);
      if (box) {
        await C.glide(box.x + box.width * 0.30, box.y + box.height * 0.42, 16);
        await C.page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.42);
        await C.sleep(0.9);
      }
      const oi = originPanel.locator('input');
      const n = await oi.count();
      if (n >= 3) {
        await oi.nth(0).fill('-57.500');
        await oi.nth(1).fill('60.000');
        await oi.nth(2).fill('Southern Ocean staging');
      }
      await C.shot('10_map_pick');
    }

    const destPanel = C.page.locator('div.panel-inset', { hasText: 'DESTINATION' }).first();
    if (await destPanel.count()) {
      const search = destPanel.locator('input[placeholder^="Search stations"]').first();
      if (await search.count()) await search.type('bharati', { delay: 20 });
      await C.sleep(1.0);
      const hit = destPanel.getByRole('button', { name: /Bharati/ }).first();
      if (await hit.count()) await C.clickAt(hit, { settle: 0.8, label: 'Bharati station' }).catch(() => {});
      await C.shot('10_station');
    }

    const when = C.page.locator('input[type="datetime-local"]').first();
    if (await when.count()) await when.fill('2026-09-02T00:00');
    const ceiling = C.page.getByRole('button', { name: 'LOW', exact: true }).first();
    if (await ceiling.count()) await C.clickAt(ceiling, { settle: 0.5, label: 'ceiling LOW' }).catch(() => {});
    await C.shot('10_departure');
  },

  /* ACT 10b · review → create → routes generated */
  async '10b_bridge'(C) {
    await C.clickAt(C.btn(/Review mission/), { settle: 1.3, label: 'review mission' }).catch(() => {});
    await C.shot('10b_review');
    await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 200 });
    await C.clickAt(C.btn(/Create mission & generate routes/), { settle: 0.4, label: 'create mission' }).catch(() => {});
    C.mark('mission_created');
    await C.waitBtn(/Accept & start voyage simulation/, 180000);
    C.mark('mission_routes_ready');
    await C.shot('10b_mission_open');
  },

  /* ACT 11 · accept the recommended route */
  async '11_accept'(C) {
    await C.railScroll('Route Options', 0.5);
    const direct = C.rail().getByRole('button', { name: /DIRECT/ }).first();
    if (await direct.count()) await C.clickAt(direct, { settle: 0.9, label: 'DIRECT option' }).catch(() => {});
    await C.clickAt(C.btn(/Accept & start voyage simulation/).first(), { settle: 1.4, label: 'accept route' });
    C.mark('route_accepted');
    await C.shot('11_underway');
  },

  /* ACT 12 · voyage simulation: advance the clock */
  async '12_underway'(C) {
    const plus12 = () => C.page.getByRole('button', { name: '+12h' }).last();
    if (await plus12().count()) {
      await C.clickAt(plus12(), { settle: 1.4, label: '+12h #1' }).catch(() => {});
      C.mark('step_plus12_1');
    }
    await C.railScroll('Conditions at Vessel', 0.8);
    await C.shot('12_conditions');
    if (await plus12().count()) {
      await C.clickAt(plus12(), { settle: 1.0, label: '+12h #2' }).catch(() => {});
      C.mark('step_plus12_2');
    }
    await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 190 });
    await C.waitText('ROUTE REVIEW REQUIRED', 60000);
    await C.shot('12_alert');
  },

  /* ACT 13 · re-plan and accept */
  async '13_review'(C) {
    await C.clickAt(C.btn(/Generate alternative routes/).first(), { settle: 0.4, label: 'generate alternatives' }).catch(() => {});
    await C.waitText('Candidate Routes', 150000);
    C.mark('candidates_ready');
    await C.shot('13_candidates');
    await C.railScroll('Candidate Routes', 0.6);
    const cand = C.page.locator('div.panel-inset', { hasText: 'CONSERVATIVE' }).first();
    if (await cand.count()) {
      await C.clickAt(cand.getByRole('button').first(), { settle: 1.0, label: 'select CONSERVATIVE' }).catch(() => {});
      await C.shot('13_selected');
      await C.clickAt(cand.getByRole('button', { name: /Accept this route/ }), { settle: 1.4, label: 'accept route' }).catch(() => {});
    }
    C.mark('alternative_accepted');
    await C.shot('13_accepted');
  },

  /* ACT 14 · drill set-up */
  async '14_drill_setup'(C) {
    await C.clickAt(C.btn(/Close mission workspace/), { settle: 0.9, label: 'close mission' }).catch(() => {});
    await C.railScroll('Route Simulation', 0.6);
    await C.clickAt(C.btn(/Run simulation/), { settle: 0.4, label: 'run simulation' });
    await C.waitText('Mission start', 180000);
    await C.shot('14_drill_stage1');
    await C.still('09_drill_conflict');
    await C.clickAt(C.btn(/Accept recommended route/), { settle: 1.3, label: 'accept recommended route' }).catch(() => {});
    await C.shot('14_drill_accepted');
  },

  /* ACT 15 · drill stages → accept the new route */
  async '15_drill'(C) {
    for (const [i, name] of ['underway', 'deviation', 'conflict', 'replan', 'decision'].entries()) {
      await C.sleep(3.2);
      const adv = C.btn('Advance').first();
      if (await adv.count()) await C.clickAt(adv, { settle: 0.4, label: `advance ${i + 1}` }).catch(() => {});
      C.mark(`drill_${name}`);
      await C.shot(`15_${name}`);
    }
    await C.sleep(1.2);
    await C.clickAt(C.btn(/Accept new route/), { settle: 1.6, label: 'accept new route' }).catch(() => {});
    C.mark('drill_new_route_active');
    await C.shot('15_active');
    await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 200 });
  },

  /* ACT 16 · close on the audit trail */
  async '16_close'(C) {
    await C.railScroll('Mission Event Log', 0.5).catch(() => {});
    await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 260 });
    await C.shot('16_close');
    await C.glide(C.width * 0.5, C.height * 0.5, 20);
  },
};

/** Any act without explicit choreography: open its section and scroll. */
async function genericTour(C, act) {
  log.info(`  (generic tour for ${act.id})`);
  await C.scrollThrough(C.railScroller(), { passes: 1, stepMs: 200 });
  await C.shot(`${act.id}_generic`);
}

/* ── warm-up (off camera) ───────────────────────────────────────────────── */

async function warmUp(C, mark, log2) {
  const { page, clickAt, waitText, railScroll, btn, rail, sleep, glide } = C;
  const t = (m) => log2.info(`  warm ${m}`);
  try {
    await page.goto(C.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('.dss-map-stage canvas', { timeout: 60000 });
    await page.waitForTimeout(2500);
    t('app booted');

    await clickAt(page.getByRole('tab', { name: 'LIVE' }), { settle: 0.4, label: 'LIVE (warm)' });
    await waitText('LATEST ANALYSIS', 150000);
    await waitText('Named bergs in area', 150000);
    t('live feeds loaded');

    await railScroll('Observation day', 0.5);
    for (const h of ['+48H', 'OBS']) {
      await clickAt(page.getByRole('tab', { name: h }), { settle: 0.4, label: `${h} (warm)` }).catch(() => {});
      await sleep(1.4);
    }
    t('forecast cached');

    await railScroll('Show navigation risk', 0.5);
    await clickAt(page.getByRole('switch', { name: 'Toggle risk layer' }), { settle: 0.4, label: 'risk layer (warm)' }).catch(() => {});
    await waitText('Worst cell in area', 120000);
    const iceTabs = page.getByRole('tablist', { name: 'Vessel ice class' });
    for (const ic of ['PC7', 'NONE', 'PC5']) {
      await clickAt(iceTabs.getByRole('tab', { name: ic, exact: true }), { settle: 1.2, label: `${ic} (warm)` }).catch(() => {});
    }
    t('risk surfaces warmed');

    await railScroll('Calculate routes', 0.5);
    await clickAt(btn(/Calculate routes/i), { settle: 0.4, label: 'calculate routes (warm)' }).catch(() => {});
    await waitText('RECOMMENDED', 240000);
    t('optimizer warmed');
    await clickAt(btn(/^Clear$/), { settle: 0.5, label: 'clear routes (warm)' }).catch(() => {});

    await railScroll('Route Simulation', 0.5);
    await clickAt(btn(/Run simulation/), { settle: 0.4, label: 'run simulation (warm)' }).catch(() => {});
    await waitText('Mission start', 240000);
    t('drill warmed');
    await clickAt(btn(/Exit/), { settle: 0.6, label: 'exit drill (warm)' }).catch(() => {});
    await sleep(1.2);

    // exercise the mission code paths once, then delete the artefact
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
    }).catch(() => {});
    t('mission path warmed');

    // reset to a clean LIVE state before the take
    await clickAt(page.getByRole('switch', { name: 'Toggle risk layer' }), { settle: 0.5, label: 'risk off (reset)' }).catch(() => {});
    await clickAt(btn(/Why this risk/), { settle: 0.3, label: 'close why (reset)' }).catch(() => {});
    await rail().evaluate((el) => { el.scrollTop = 0; }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await glide(800, 620, 10);
    await sleep(1.5);
    t('reset done');
  } catch (e) {
    log2.warn(`warm-up incomplete (the take will still run): ${String(e.message || e).slice(0, 200)}`);
    await page.screenshot({ path: join(WORK, 'shots', 'warmup_state.png') }).catch(() => {});
  }
}

/* ── direct invocation ──────────────────────────────────────────────────── */

function argOf(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { loadScript, FILES: F } = await import('./config.mjs');
  const { preflight } = await import('./preflight.mjs');
  const script = loadScript({ short: process.argv.includes('--short'), acts: argOf('acts', null) });
  const pf = await preflight({ install: true });
  if (!pf.chromium.ok) throw new Error(pf.chromium.reason);
  const url = argOf('url', 'http://localhost:5173/');
  const dry = process.argv.includes('--dry');
  if (dry && existsSync(F.timeline)) log.info(`dry run; previous timeline at ${F.timeline}`);
  if (dry) writeFileSync(join(WORK, 'durations.json'), existsSync(F.durations) ? readFileSync(F.durations) : '{}');
  await recordTake({ script, url, chromium: pf.chromium, record: !dry, stills: !dry });
}
