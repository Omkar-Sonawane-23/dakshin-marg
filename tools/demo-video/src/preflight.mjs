/**
 * Preflight — find (or install) every tool the pipeline needs, and report
 * exactly what will be used. Nothing here is magic: each resolver tries a
 * documented list of locations in order and tells you which one won.
 *
 *   ffmpeg     PATH → python `imageio-ffmpeg` (PyPI) → npm `ffmpeg-static`
 *   chromium   DM_CHROMIUM → Playwright's own browser → system Chrome/Edge
 *              → npm `@sparticuz/chromium` (bundled brotli build)
 *   python     python-services/.venv → python3 → python
 *   node deps  frontend/, backend/ and tools/demo-video/
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir, platform, arch } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { FILES, REPO_ROOT, SERVICES, TOOL_ROOT, WORK, ensureDirs, makeLogger } from './config.mjs';

const require = createRequire(import.meta.url);
const IS_WIN = platform() === 'win32';
const IS_MAC = platform() === 'darwin';
const NPM = IS_WIN ? 'npm.cmd' : 'npm';

export const log = makeLogger();

/* ── small helpers ───────────────────────────────────────────────────────── */

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? ''), error: r.error };
}

function npm(args, opts = {}) {
  return run(NPM, args, { ...opts });
}

function which(name) {
  const r = IS_WIN
    ? run('where', [name])
    : run('sh', ['-c', `command -v ${name}`]);
  const first = (r.out || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return r.code === 0 && first ? first : null;
}

/* ── python ──────────────────────────────────────────────────────────────── */

export function resolvePython() {
  const venv = join(SERVICES.python.dir, IS_WIN ? '.venv\\Scripts\\python.exe' : '.venv/bin/python');
  if (existsSync(venv)) return { python: venv, venv: true };
  for (const cand of (IS_WIN ? ['python', 'py'] : ['python3', 'python'])) {
    const p = which(cand);
    if (p) return { python: p, venv: false };
  }
  return null;
}

function pythonHas(python, module) {
  return run(python, ['-c', `import ${module}`]).code === 0;
}

export function ensurePythonDeps({ install = true } = {}) {
  const found = resolvePython();
  if (!found) return { ok: false, reason: 'no python interpreter on PATH' };
  let { python } = found;

  const needs = ['fastapi', 'uvicorn', 'numpy', 'rasterio'];
  const missing = needs.filter((m) => !pythonHas(python, m));

  if (missing.length === 0) return { ok: true, python, venv: found.venv, installed: [] };
  if (!install) return { ok: false, python, missing, reason: `python modules missing: ${missing.join(', ')}` };

  log.info(`python: creating venv + installing ${missing.length} missing module(s)…`);
  const venvDir = join(SERVICES.python.dir, '.venv');
  if (!found.venv) {
    const v = run(python, ['-m', 'venv', venvDir]);
    if (v.code !== 0) return { ok: false, python, missing, reason: `venv creation failed: ${v.out.slice(-400)}` };
    python = join(venvDir, IS_WIN ? 'Scripts\\python.exe' : 'bin/python');
  }
  const pip = run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet',
    '-r', join(SERVICES.python.dir, 'requirements.txt')], { cwd: SERVICES.python.dir });
  if (pip.code !== 0) return { ok: false, python, missing, reason: `pip install failed: ${pip.out.slice(-800)}` };
  const still = needs.filter((m) => !pythonHas(python, m));
  return { ok: still.length === 0, python, venv: true, installed: missing, missing: still };
}

/* ── node dependencies ───────────────────────────────────────────────────── */

export function ensureNodeDeps({ install = true } = {}) {
  const report = { frontend: false, backend: false, tool: false };

  // frontend
  if (existsSync(join(SERVICES.frontend.dir, 'node_modules', 'vite'))) report.frontend = true;
  else if (install) {
    log.info('frontend: npm install…');
    report.frontend = npm(['install', '--no-audit', '--no-fund'], { cwd: SERVICES.frontend.dir }).code === 0;
  }

  // backend: a Windows-installed tree ships @esbuild/win32-x64 only, which
  // cannot run `tsx` on Linux/macOS. Detect that and remember it.
  const be = join(SERVICES.backend.dir, 'node_modules');
  report.backend = existsSync(join(be, 'express'));
  const wantEsbuild = `@esbuild/${IS_WIN ? 'win32-x64' : IS_MAC ? `darwin-${arch()}` : `linux-${arch()}`}`;
  report.backendEsbuild = existsSync(join(be, wantEsbuild));
  if (!report.backend && install) {
    log.info('backend: npm install…');
    report.backend = npm(['install', '--no-audit', '--no-fund'], { cwd: SERVICES.backend.dir }).code === 0;
    report.backendEsbuild = existsSync(join(be, wantEsbuild));
  }

  // this tool
  if (existsSync(join(TOOL_ROOT, 'node_modules', 'playwright-core'))) report.tool = true;
  else if (install) {
    log.info('tools/demo-video: npm install…');
    report.tool = npm(['install', '--no-audit', '--no-fund'], { cwd: TOOL_ROOT }).code === 0;
  }
  return report;
}

/**
 * On-demand dependencies live in their own tree (tools/demo-video/.extras) so
 * that installing one never prunes another: `npm install --no-save` reconciles
 * the tree against package.json and would delete whatever is not listed.
 */
const EXTRAS_DIR = join(TOOL_ROOT, '.extras');
const RESOLVE_PATHS = [EXTRAS_DIR, TOOL_ROOT, REPO_ROOT];

export function installToolDep(pkg) {
  if (canResolve(pkg)) return true;
  if (!existsSync(EXTRAS_DIR)) mkdirSync(EXTRAS_DIR, { recursive: true });
  const pj = join(EXTRAS_DIR, 'package.json');
  if (!existsSync(pj)) {
    writeFileSync(pj, JSON.stringify({ name: 'dakshin-marg-demo-extras', private: true, version: '1.0.0' }, null, 2));
  }
  log.info(`installing ${pkg} into tools/demo-video/.extras (not saved to package.json)…`);
  const r = npm(['install', '--no-audit', '--no-fund', pkg], { cwd: EXTRAS_DIR });
  if (r.code !== 0) {
    log.warn(`could not install ${pkg}: ${r.out.trim().split(/\r?\n/).slice(-3).join(' | ')}`);
    return false;
  }
  return canResolve(pkg);
}

function canResolve(pkg) {
  try { require.resolve(pkg, { paths: RESOLVE_PATHS }); return true; } catch { return false; }
}

/**
 * Absolute directory of an installed package. `require.resolve('<pkg>/package.json')`
 * is not always allowed by a package's `exports` map, so walk up from the entry
 * point instead.
 */
export function resolvePackageDir(pkg) {
  let entry;
  try { entry = require.resolve(pkg, { paths: RESOLVE_PATHS }); } catch { return null; }
  let dir = dirname(entry);
  for (let i = 0; i < 6 && dir && dir !== dirname(dir); i += 1) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      try { if (JSON.parse(readFileSync(pj, 'utf8')).name === pkg) return dir; } catch { /* keep walking */ }
    }
    dir = dirname(dir);
  }
  return null;
}

/* ── ffmpeg ──────────────────────────────────────────────────────────────── */

function ffmpegWorks(bin) {
  if (!bin || !existsSync(bin)) return false;
  try { if (statSync(bin).isFile() && !IS_WIN) chmodSync(bin, 0o755); } catch { /* ignore */ }
  return run(bin, ['-version']).code === 0;
}

export function resolveFfmpeg({ install = true } = {}) {
  ensureDirs();
  if (process.env.DM_FFMPEG && ffmpegWorks(process.env.DM_FFMPEG)) {
    return { ok: true, ffmpeg: process.env.DM_FFMPEG, via: 'DM_FFMPEG' };
  }
  if (existsSync(FILES.ffmpegPath)) {
    const cached = readFileSync(FILES.ffmpegPath, 'utf8').trim();
    if (ffmpegWorks(cached)) return { ok: true, ffmpeg: cached, via: 'cached' };
  }
  const onPath = which('ffmpeg');
  if (onPath && ffmpegWorks(onPath)) {
    writeFileSync(FILES.ffmpegPath, onPath);
    return { ok: true, ffmpeg: onPath, via: 'PATH' };
  }
  if (!install) return { ok: false, reason: 'ffmpeg not found on PATH' };

  // 1) PyPI wheel that bundles a static ffmpeg (works where GitHub releases do not)
  const py = resolvePython();
  if (py) {
    if (!pythonHas(py.python, 'imageio_ffmpeg')) {
      log.info('ffmpeg: pip install imageio-ffmpeg (bundles a static build)…');
      run(py.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'imageio-ffmpeg']);
    }
    const r = run(py.python, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']);
    const bin = (r.out || '').trim().split(/\r?\n/).pop();
    if (r.code === 0 && ffmpegWorks(bin)) {
      writeFileSync(FILES.ffmpegPath, bin);
      return { ok: true, ffmpeg: bin, via: 'python imageio-ffmpeg' };
    }
  }

  // 2) npm static build (downloads from GitHub releases)
  if (installToolDep('ffmpeg-static')) {
    try {
      const extraRequire = createRequire(join(EXTRAS_DIR, 'resolve.cjs'));
      const found = extraRequire('ffmpeg-static');
      const p = typeof found === 'string' ? found : found?.default;
      if (ffmpegWorks(p)) {
        writeFileSync(FILES.ffmpegPath, p);
        return { ok: true, ffmpeg: p, via: 'npm ffmpeg-static' };
      }
    } catch { /* fall through */ }
  }

  return {
    ok: false,
    reason: 'no ffmpeg available. Install it (https://ffmpeg.org/download.html) or set DM_FFMPEG=/path/to/ffmpeg',
  };
}

/* ── chromium ────────────────────────────────────────────────────────────── */

const SWIFTSHADER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--no-zygote',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--in-process-gpu', '--font-render-hinting=none', '--hide-scrollbars', '--mute-audio',
  '--force-device-scale-factor=1', '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process'];

function playwrightBundled() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    IS_WIN && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    IS_MAC ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : null,
    join(homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).sort().reverse()) {
      if (!/^chromium(-headless-shell)?-\d+$/.test(entry)) continue;
      const candidates = IS_WIN
        ? ['chrome-win/chrome.exe', 'chrome-win64/chrome.exe']
        : IS_MAC
          ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']
          : ['chrome-linux/chrome', 'chrome-linux64/chrome'];
      for (const c of candidates) {
        const p = join(root, entry, c);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

function systemBrowser() {
  const paths = IS_WIN
    ? [join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
      join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe')]
    : IS_MAC
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const p of paths) if (p && existsSync(p)) return p;
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const w = which(name);
    if (w) return w;
  }
  return null;
}

/**
 * Resolve a Chromium the recorder can drive. Returns
 * `{ ok, executablePath?, channel?, args, inflate?, via }`.
 */
export async function resolveChromium({ install = true, headed = false } = {}) {
  const explicit = process.env.DM_CHROMIUM || process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicit && existsSync(explicit)) {
    return { ok: true, executablePath: explicit, args: SWIFTSHADER_ARGS, via: 'DM_CHROMIUM' };
  }

  const bundled = playwrightBundled();
  if (bundled) {
    try { if (!IS_WIN) chmodSync(bundled, 0o755); } catch { /* ignore */ }
    return { ok: true, executablePath: bundled, args: SWIFTSHADER_ARGS, via: 'playwright browsers' };
  }

  // Try to download Playwright's own Chromium (works on a normal machine).
  if (install && !process.env.DM_NO_BROWSER_DOWNLOAD) {
    log.info('chromium: npx playwright install chromium (one-off download)…');
    const r = npm(['exec', '--yes', 'playwright@1.63.0', '--', 'install', 'chromium'], { cwd: TOOL_ROOT, timeout: 600_000 });
    const after = playwrightBundled();
    if (r.code === 0 && after) return { ok: true, executablePath: after, args: SWIFTSHADER_ARGS, via: 'playwright install' };
    if (r.code !== 0) log.warn('playwright browser download unavailable — trying other sources');
  }

  const sys = systemBrowser();
  if (sys) return { ok: true, executablePath: sys, args: SWIFTSHADER_ARGS, via: 'system browser' };

  // Sandboxed CI / no-download environments: the brotli-packed Chromium that
  // ships inside the npm tarball (used by AWS Lambda deployments).
  if (install && installToolDep('@sparticuz/chromium')) {
    const pkgDir = resolvePackageDir('@sparticuz/chromium');
    if (pkgDir && existsSync(join(pkgDir, 'bin'))) {
      return {
        ok: true,
        via: '@sparticuz/chromium',
        args: SWIFTSHADER_ARGS,
        inflate: async () => inflateSparticuz(pkgDir),
      };
    }
    log.warn('@sparticuz/chromium installed but has no bin/ payloads');
  }

  return {
    ok: false,
    args: SWIFTSHADER_ARGS,
    reason: 'no Chromium found. Run `npx playwright install chromium`, install Chrome, or set DM_CHROMIUM=/path/to/chrome',
  };
}

/** Unpack the brotli payloads of @sparticuz/chromium into the OS temp dir. */
async function inflateSparticuz(pkgDir) {
  const lambdafs = pathToFileURL(join(pkgDir, 'build', 'lambdafs.js')).href;
  const { inflate } = await import(lambdafs);
  const binDir = join(pkgDir, 'bin');
  const tmp = tmpdir();
  if (!existsSync(join(tmp, 'chromium'))) await inflate(join(binDir, 'chromium.br'));
  if (!existsSync(join(tmp, 'fonts'))) await inflate(join(binDir, 'fonts.tar.br'));
  if (existsSync(join(binDir, 'al2023.tar.br')) && !existsSync(join(tmp, 'al2023'))) {
    await inflate(join(binDir, 'al2023.tar.br'));
  }
  if (existsSync(join(binDir, 'swiftshader.tar.br'))) await inflate(join(binDir, 'swiftshader.tar.br'));

  process.env.LD_LIBRARY_PATH = [join(tmp, 'al2023', 'lib'), tmp, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  process.env.FONTCONFIG_PATH ??= join(tmp, 'fonts');
  process.env.HOME ??= tmp;
  process.env.XDG_CACHE_HOME ??= join(tmp, 'cache');
  return join(tmp, 'chromium');
}

/**
 * Playwright's video recorder execs its *own* ffmpeg from its browser registry
 * (e.g. ~/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux) and refuses to record
 * without it. Point that slot at the ffmpeg we already resolved, so recording
 * works on machines where Playwright's CDN download is unavailable.
 */
export function ensurePlaywrightFfmpeg(ffmpegBin) {
  if (!ffmpegBin || !existsSync(ffmpegBin)) return null;
  try {
    const pwDir = resolvePackageDir('playwright-core');
    if (!pwDir) return null;
    const browsers = JSON.parse(readFileSync(join(pwDir, 'browsers.json'), 'utf8'));
    const rev = (browsers.browsers ?? []).find((b) => b.name === 'ffmpeg')?.revision;
    if (!rev) return null;
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH
      ?? join(IS_WIN ? (process.env.LOCALAPPDATA ?? homedir()) : (process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')), 'ms-playwright');
    const exe = IS_WIN ? 'ffmpeg-win64.exe' : IS_MAC ? 'ffmpeg-mac' : 'ffmpeg-linux';
    const dir = join(base, `ffmpeg-${rev}`);
    const target = join(dir, exe);
    if (existsSync(target)) return target;
    mkdirSync(dir, { recursive: true });
    if (IS_WIN) {
      run('cmd', ['/c', 'copy', '/y', `"${ffmpegBin}"`, `"${target}"`]);
    } else {
      chmodSync(ffmpegBin, 0o755);
      run('ln', ['-sf', ffmpegBin, target]);
    }
    return existsSync(target) ? target : null;
  } catch (e) {
    log.warn(`could not link ffmpeg for Playwright recording: ${String(e.message || e).slice(0, 120)}`);
    return null;
  }
}

/* ── the whole check, as one call ────────────────────────────────────────── */

export async function preflight({ install = true, headed = false } = {}) {
  log.step('Preflight — tools, dependencies, browser');
  ensureDirs();

  const node = process.version;
  log.info(`node ${node} · ${platform()}/${arch()} · repo ${REPO_ROOT}`);

  const deps = ensureNodeDeps({ install });
  log.info(`node deps: frontend ${deps.frontend ? 'ok' : 'MISSING'} · backend ${deps.backend ? 'ok' : 'MISSING'} · tool ${deps.tool ? 'ok' : 'MISSING'}`);

  const py = ensurePythonDeps({ install });
  if (py.ok) log.info(`python: ${py.python}${py.venv ? ' (venv)' : ''}`);
  else log.warn(`python: ${py.reason}`);

  const ff = resolveFfmpeg({ install });
  if (ff.ok) log.info(`ffmpeg: ${ff.ffmpeg}  [via ${ff.via}]`);
  else log.warn(`ffmpeg: ${ff.reason}`);

  const ch = await resolveChromium({ install, headed });
  if (ch.ok) log.info(`chromium: ${ch.executablePath ?? '(inflate on demand)'}  [via ${ch.via}]`);
  else log.warn(`chromium: ${ch.reason}`);

  const ttsHint = 'resolved at narration time (edge-tts → openai → elevenlabs → piper → sapi → espeak → bundled cache)';
  log.info(`tts: ${ttsHint}`);

  const report = {
    at: new Date().toISOString(), node, platform: platform(), arch: arch(), deps,
    python: py, ffmpeg: ff, chromium: { ...ch, inflate: undefined },
    ok: Boolean(deps.frontend && deps.backend && py.ok && ff.ok && ch.ok),
  };
  writeFileSync(FILES.report, JSON.stringify(report, null, 2));

  if (!report.ok) {
    const missing = [];
    if (!deps.frontend) missing.push('frontend node_modules');
    if (!deps.backend) missing.push('backend node_modules');
    if (!py.ok) missing.push(`python services (${py.reason})`);
    if (!ff.ok) missing.push(`ffmpeg (${ff.reason})`);
    if (!ch.ok) missing.push(`chromium (${ch.reason})`);
    log.err('preflight incomplete:\n        - ' + missing.join('\n        - '));
  } else {
    log.ok('preflight complete');
  }
  return { report, ffmpeg: ff, chromium: ch, python: py, deps };
}
