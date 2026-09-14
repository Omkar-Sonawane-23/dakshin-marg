/**
 * Services — bring the three Dakshin Marg services up, health-gated, and tear
 * them down again at the end.
 *
 * Anything already listening (a developer's own `npm run dev`, a Windows
 * START-DAKSHIN-MARG.bat session) is *reused*, never killed.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LOGS, SERVICES, ensureDirs, makeLogger } from './config.mjs';
import { installToolDep, resolvePackageDir, resolvePython, run } from './preflight.mjs';

const IS_WIN = process.platform === 'win32';
const log = makeLogger();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function healthy(port, path = '/', timeoutMs = 2500) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: ctl.signal });
    clearTimeout(t);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitHealthy(svc, timeoutSec = 90) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (await healthy(svc.port, svc.health)) return true;
    await sleep(700);
  }
  return false;
}

class Service {
  constructor(def, { reuse = false } = {}) {
    this.def = def;
    this.proc = null;
    this.reuse = reuse;
    this.logPath = join(LOGS, `${def.key}.log`);
  }

  start(command, args, opts = {}) {
    ensureDirs();
    const out = createWriteStream(this.logPath, { flags: 'a' });
    out.write(`\n--- ${new Date().toISOString()} ${command} ${args.join(' ')} (cwd ${opts.cwd ?? this.def.dir}) ---\n`);
    this.proc = spawn(command, args, {
      cwd: opts.cwd ?? this.def.dir,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      // own process group on POSIX so `npm run …` can be killed with its child
      detached: !IS_WIN,
    });
    this.proc.stdout.pipe(out);
    this.proc.stderr.pipe(out);
    this.proc.on('exit', (code, sig) => { this.exitCode = code; this.signal = sig; });
    return this.proc;
  }

  alive() {
    return this.reuse || (this.proc !== null && this.proc.exitCode === null);
  }

  stop() {
    if (!this.proc || this.reuse) return;
    try {
      if (IS_WIN) {
        // /T walks the child tree (npm → vite/tsx), /F forces it
        run('taskkill', ['/pid', String(this.proc.pid), '/T', '/F']);
      } else {
        process.kill(-this.proc.pid, 'SIGTERM');
      }
    } catch {
      try { this.proc.kill('SIGTERM'); } catch { /* already gone */ }
    }
  }
}

/** How to launch the Node application API on this machine. */
function backendCommand() {
  const be = join(SERVICES.backend.dir, 'node_modules');
  const wantEsbuild = `@esbuild/${process.platform === 'win32' ? 'win32-x64'
    : process.platform === 'darwin' ? `darwin-${process.arch}` : `linux-${process.arch}`}`;
  const localRunner = existsSync(join(be, 'tsx', 'dist', 'cli.mjs')) && existsSync(join(be, wantEsbuild));
  if (localRunner) return { cmd: 'npm', args: ['run', 'start'], via: 'npm run start' };

  // The committed backend/node_modules tree was installed on Windows, so its
  // esbuild binary cannot run here. Use a tsx from the tool's own tree instead
  // (installed on demand, nothing in the repo is modified).
  if (existsSync(join(be, 'express')) && installToolDep('tsx')) {
    const pkgDir = resolvePackageDir('tsx');
    const cli = pkgDir ? join(pkgDir, 'dist', 'cli.mjs') : null;
    if (cli && existsSync(cli)) {
      return { cmd: process.execPath, args: [cli, 'src/server.ts'], via: 'tsx (tool-local)', cwd: SERVICES.backend.dir };
    }
  }
  return { cmd: 'npm', args: ['run', 'start'], via: 'npm run start' };
}

/**
 * @param {object} opts
 * @param {'dev'|'preview'} opts.frontend  dev = vite :5173, preview = built dist on :4173
 */
export async function startServices({ frontend = 'dev', timeoutSec = 120, build = true } = {}) {
  ensureDirs();
  log.step(`Services — python :${SERVICES.python.port} · backend :${SERVICES.backend.port} · frontend (${frontend})`);
  const started = [];

  /* python scientific/ML API */
  const pyDef = SERVICES.python;
  if (await healthy(pyDef.port, pyDef.health)) {
    log.ok(`python :${pyDef.port} already up — reusing`);
    started.push(new Service(pyDef, { reuse: true }));
  } else {
    const py = resolvePython();
    if (!py) throw new Error('no python interpreter found; run preflight with --install');
    const svc = new Service(pyDef);
    svc.start(py.python, ['-m', 'uvicorn', 'env_data.api:app', '--host', '0.0.0.0', '--port', String(pyDef.port)],
      { env: { PYTHONUNBUFFERED: '1' } });
    if (!await waitHealthy(pyDef, timeoutSec)) {
      throw new Error(`python API did not become healthy on :${pyDef.port} — see ${svc.logPath}`);
    }
    log.ok(`python :${pyDef.port} healthy (${py.venv ? 'venv' : 'system python'})`);
    started.push(svc);
  }

  /* node application API */
  const beDef = SERVICES.backend;
  if (await healthy(beDef.port, beDef.health)) {
    log.ok(`backend :${beDef.port} already up — reusing`);
    started.push(new Service(beDef, { reuse: true }));
  } else {
    const launch = backendCommand();
    const svc = new Service(beDef);
    log.info(`backend: ${launch.via}`);
    svc.start(launch.cmd, launch.args, { cwd: launch.cwd ?? beDef.dir });
    if (!await waitHealthy(beDef, timeoutSec)) {
      throw new Error(`application API did not become healthy on :${beDef.port} — see ${svc.logPath}`);
    }
    log.ok(`backend :${beDef.port} healthy`);
    started.push(svc);
  }

  /* frontend */
  const feDef = frontend === 'preview' ? SERVICES.frontendPreview : SERVICES.frontend;
  if (await healthy(feDef.port, feDef.health)) {
    log.ok(`frontend :${feDef.port} already up — reusing`);
    started.push(new Service(feDef, { reuse: true }));
  } else {
    const svc = new Service(feDef);
    if (frontend === 'preview') {
      if (build || !existsSync(join(SERVICES.frontend.dir, 'dist'))) {
        log.info('frontend: production build (vite build)…');
        const b = run('npm', ['run', 'build'], { cwd: SERVICES.frontend.dir });
        if (b.code !== 0) {
          log.warn('vite build failed — falling back to the dev server');
          return finishWithDev(started, timeoutSec);
        }
      }
      svc.start('npm', ['run', 'preview']);
    } else {
      svc.start('npm', ['run', 'dev']);
    }
    if (!await waitHealthy(feDef, timeoutSec)) {
      throw new Error(`web app did not become healthy on :${feDef.port} — see ${svc.logPath}`);
    }
    log.ok(`frontend :${feDef.port} healthy`);
    started.push(svc);
  }

  const url = `http://localhost:${feDef.port}/`;
  log.ok(`all services up → ${url}`);
  return { services: started, url, port: feDef.port };
}

async function finishWithDev(started, timeoutSec) {
  const feDef = SERVICES.frontend;
  const svc = new Service(feDef);
  svc.start('npm', ['run', 'dev']);
  if (!await waitHealthy(feDef, timeoutSec)) throw new Error(`web app did not become healthy on :${feDef.port}`);
  started.push(svc);
  return { services: started, url: `http://localhost:${feDef.port}/`, port: feDef.port };
}

/** Warm the caches the take depends on, so recording runs at UI speed. */
export async function warmCaches(port = SERVICES.backend.port, timeoutSec = 240) {
  log.info('warming server-side caches (risk surface, optimizer, re-planning drill)…');
  const endpoints = ['/api/routes/replan-drill'];
  for (const ep of endpoints) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutSec * 1000);
      const res = await fetch(`http://127.0.0.1:${port}${ep}`, { signal: ctl.signal });
      clearTimeout(t);
      log.info(`  ${ep} → ${res.status}`);
    } catch (e) {
      log.warn(`  ${ep} failed: ${String(e.message || e).slice(0, 120)}`);
    }
  }
}

export function stopServices(services = []) {
  for (const s of services) {
    if (s.reuse) { log.info(`leaving ${s.def.name} running (it was already up)`); continue; }
    log.info(`stopping ${s.def.name}`);
    s.stop();
  }
}
