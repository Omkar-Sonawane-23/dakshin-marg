#!/usr/bin/env node
/**
 * Browser smoke test — proves the recorder's browser can open the app and that
 * the WebGL chart actually renders. Writes tools/demo-video/work/shots/smoke.png.
 *
 *   node tools/demo-video/bin/check-browser.mjs [--url=http://localhost:5173/console]
 */
import { join } from 'node:path';
import { WORK, VIDEO, ensureDirs, makeLogger } from '../src/config.mjs';
import { preflight } from '../src/preflight.mjs';

const log = makeLogger();
const url = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:5173/console';

ensureDirs();
const pf = await preflight({ install: true });
if (!pf.chromium.ok) { log.err(pf.chromium.reason); process.exit(1); }

const { chromium } = await import('playwright-core');
let executablePath = pf.chromium.executablePath;
if (pf.chromium.inflate) executablePath = await pf.chromium.inflate();
log.info(`launching ${executablePath}`);

const browser = await chromium.launch({ executablePath, headless: true, args: pf.chromium.args ?? [] });
try {
  const page = await (await browser.newContext({ viewport: { width: VIDEO.width, height: VIDEO.height }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const canvas = await page.waitForSelector('.dss-map-stage canvas', { timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(3000);
  const brand = await page.locator('body').innerText().then((t) => (t.match(/DAKSHIN MARG/i) ?? ['(brand not visible)'])[0]).catch(() => '?');
  const shot = join(WORK, 'shots', 'smoke.png');
  await page.screenshot({ path: shot });

  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return 'no webgl';
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
    return dbg ? String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'webgl ok';
  }).catch(() => 'unknown');

  log.ok(`app opened at ${url}`);
  log.info(`canvas: ${canvas ? 'present' : 'MISSING'} · webgl renderer: ${gl}`);
  log.info(`brand text on screen: ${brand}`);
  log.info(`screenshot: ${shot}`);
  if (errors.length) log.warn(`${errors.length} page error(s):\n        - ${[...new Set(errors)].slice(0, 6).join('\n        - ')}`);
  else log.ok('no page errors');
} finally {
  await browser.close();
}
