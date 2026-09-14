/**
 * Dakshin Marg demo-video pipeline — paths, ports and defaults.
 * Everything the other modules need lives here, so the pipeline can be pointed
 * at another checkout or another port without editing code.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

export const HERE = dirname(fileURLToPath(import.meta.url));   // tools/demo-video/src
export const TOOL_ROOT = resolve(HERE, '..');                  // tools/demo-video
export const REPO_ROOT = resolve(TOOL_ROOT, '..', '..');       // repository root

/** Scratch space: raw recording, card renders, intermediate encodes. Not committed. */
export const WORK = join(TOOL_ROOT, 'work');
/** Narration clips + manifest. Committed on purpose: the offline fallback voice. */
export const NARRATION_DIR = join(TOOL_ROOT, 'narration');
/** Final, shareable artefacts. */
export const OUT = join(REPO_ROOT, 'docs', 'video');
export const STILLS = join(OUT, 'stills');
export const LOGS = join(WORK, 'logs');

export const SERVICES = {
  python: { key: 'python', name: 'python env/ML API', dir: join(REPO_ROOT, 'python-services'), port: 8100, health: '/env/health' },
  backend: { key: 'backend', name: 'application API', dir: join(REPO_ROOT, 'backend'), port: 8200, health: '/api/health' },
  frontend: { key: 'frontend', name: 'web app', dir: join(REPO_ROOT, 'frontend'), port: 5173, health: '/' },
  frontendPreview: { key: 'frontend', name: 'web app (production build)', dir: join(REPO_ROOT, 'frontend'), port: 4173, health: '/' },
};

export const VIDEO = {
  width: 1280,
  height: 720,
  fps: 30,
  crf: 19,
  shareWidth: 1280,
  shareHeight: 720,
  shareCrf: 23,
};

export const FILES = {
  script: join(TOOL_ROOT, 'narration.json'),
  manifest: join(NARRATION_DIR, 'manifest.json'),
  timeline: join(WORK, 'timeline.json'),
  durations: join(WORK, 'durations.json'),
  report: join(WORK, 'preflight.json'),
  ffmpegPath: join(WORK, 'ffmpeg.txt'),
  master: join(OUT, 'Dakshin-Marg-demo.mp4'),
  share: join(OUT, 'Dakshin-Marg-demo-720p.mp4'),
  narrationTrack: join(OUT, 'Dakshin-Marg-narration.mp3'),
  subtitles: join(OUT, 'Dakshin-Marg-demo.srt'),
};

/**
 * Narration pacing: how many seconds of screen time a script line deserves.
 * ~2.55 words/second is a calm documentary read; the +2 s tail lets the last
 * interaction settle before the next act starts.
 */
export const WORDS_PER_SECOND = 2.55;
export const ACT_SLACK_SECONDS = 2.0;
export const MIN_ACT_SECONDS = 6;

export function estimateHold(text, override) {
  if (typeof override === 'number' && override > 0) return override;
  const words = String(text ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_ACT_SECONDS, Math.ceil(words / WORDS_PER_SECOND) + ACT_SLACK_SECONDS);
}

/** Read the shot list / narration script, with computed holds. */
export function loadScript({ short = false, acts = null } = {}) {
  if (!existsSync(FILES.script)) throw new Error(`missing narration script: ${FILES.script}`);
  const raw = JSON.parse(readFileSync(FILES.script, 'utf8'));
  if (!Array.isArray(raw.acts) || raw.acts.length === 0) throw new Error('narration.json has no acts');

  let list = raw.acts.map((a) => ({ ...a, holdSeconds: estimateHold(a.text, a.holdSeconds) }));
  if (short) list = list.filter((a) => a.core !== false);
  if (acts) {
    const keep = new Set(String(acts).split(',').map((s) => s.trim()).filter(Boolean));
    const groups = [...keep].filter((k) => ['cards', 'tour', 'workflow'].includes(k));
    const ids = [...keep].filter((k) => !['cards', 'tour', 'workflow'].includes(k));
    list = list.filter((a) => ids.includes(a.id) || groups.includes(a.group));
  }
  if (list.length === 0) throw new Error('act filter removed every act');
  return { ...raw, acts: list };
}

export function ensureDirs() {
  for (const d of [WORK, join(WORK, 'video'), join(WORK, 'build'), join(WORK, 'cards'),
    join(WORK, 'shots'), LOGS, NARRATION_DIR, OUT, STILLS]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

/** One-line logger with an elapsed stamp, so the log reads as a timeline. */
export function makeLogger() {
  const t0 = Date.now();
  const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1).padStart(7)}s`;
  const fmt = (tag, msg) => `${stamp()} ${tag.padEnd(5)} ${msg}`;
  return {
    step: (m) => console.log(`\n${fmt('==>', m)}`),
    info: (m) => console.log(fmt('·', m)),
    ok: (m) => console.log(fmt('ok', m)),
    warn: (m) => console.log(fmt('WARN', m)),
    err: (m) => console.error(fmt('FAIL', m)),
  };
}
