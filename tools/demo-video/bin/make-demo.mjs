#!/usr/bin/env node
/**
 * Dakshin Marg — one-click SIH demo video.
 *
 *   node tools/demo-video/bin/make-demo.mjs
 *
 * Runs the whole chain: preflight → services → narration (TTS) → record → assemble.
 * Every stage can be run alone with --only=<stage>, and nothing is downloaded
 * silently: each resolver reports what it found.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  FILES, VIDEO, WORK, ensureDirs, loadScript, makeLogger,
} from '../src/config.mjs';
import { preflight } from '../src/preflight.mjs';
import { startServices, stopServices, warmCaches } from '../src/services.mjs';
import { generateNarration } from '../src/tts.mjs';
import { recordTake } from '../src/recorder.mjs';
import { assemble, fmtTime } from '../src/assemble.mjs';

const log = makeLogger();

/* ── args ───────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const value = (name, fallback = undefined) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const list = (name) => (value(name) ? value(name).split(',').map((s) => s.trim()).filter(Boolean) : null);

const OPTS = {
  only: list('only'),
  skip: list('skip') ?? [],
  short: flag('short'),
  acts: value('acts'),
  tts: value('tts', 'auto'),
  voice: value('voice'),
  rate: value('rate'),
  frontend: value('frontend', 'dev'),
  url: value('url'),
  width: Number(value('width', VIDEO.width)),
  height: Number(value('height', VIDEO.height)),
  dry: flag('dry'),
  keepServices: flag('keep-services'),
  noShare: flag('no-share'),
  subtitles: flag('subtitles'),
  noInstall: flag('no-install'),
  forceNarration: flag('force-narration'),
  allowStale: flag('allow-stale-narration'),
  noWarm: flag('no-warm'),
  help: flag('help') || flag('h'),
};

const STAGES = ['preflight', 'narration', 'services', 'record', 'assemble'];

function usage() {
  console.log(`
Dakshin Marg — SIH demo video generator

  node tools/demo-video/bin/make-demo.mjs [options]

Stages (in order): ${STAGES.join(' → ')}

Options
  --only=<stage[,stage]>   run just these stages: ${STAGES.join('|')}
  --skip=<stage[,stage]>   skip stages
  --short                  core acts only (drops the tour + bridging beats)
  --acts=<id|group,…>      run only these acts / groups (cards|tour|workflow)
  --tts=<provider>         auto (default) | edge-tts | openai | elevenlabs | piper | sapi | espeak | cache
  --voice=<name>           provider voice (e.g. en-IN-NeerjaNeural, nova, en-gb)
  --rate=<±N%>             speech rate adjustment for providers that support it
  --frontend=dev|preview   vite dev server :5173 (default) or production build :4173
  --url=<url>              record an app that is already running (skips service management)
  --width=N --height=N     recording size (default ${VIDEO.width}×${VIDEO.height})
  --dry                    screenshots instead of video (fast rehearsal)
  --no-warm                skip the off-camera warm-up (only if caches are already hot)
  --no-share               do not render the 720p cut
  --subtitles              also write the .srt/.vtt subtitle sidecars (off by default)
  --no-install             never install anything; fail if a tool is missing
  --force-narration        re-synthesise every clip even if the text is unchanged
  --allow-stale-narration  keep an old clip if a provider fails mid-run
  --keep-services          leave the services running afterwards

Output
  ${FILES.master}
  ${FILES.share}
  ${FILES.narrationTrack}
  ${FILES.subtitles} (only with --subtitles)

Environment overrides
  DM_FFMPEG=/path/to/ffmpeg        DM_CHROMIUM=/path/to/chrome
  OPENAI_API_KEY=…                 ELEVENLABS_API_KEY=…
  DM_PIPER_MODEL=/path/voice.onnx  DM_PIPER_BIN=/path/to/piper
`);
}

/* ── run ────────────────────────────────────────────────────────────────── */

const want = (stage) => (OPTS.only ? OPTS.only.includes(stage) : !OPTS.skip.includes(stage));

async function main() {
  if (OPTS.help) { usage(); return 0; }
  ensureDirs();

  const t0 = Date.now();
  log.step(`Dakshin Marg demo video — ${OPTS.dry ? 'DRY RUN' : 'full render'}`);
  log.info(`repo ${join(WORK, '..', '..', '..')} · stages ${OPTS.only ? OPTS.only.join(',') : STAGES.filter((s) => !OPTS.skip.includes(s)).join(',')}`);

  const script = loadScript({ short: OPTS.short, acts: OPTS.acts });
  const holdTotal = script.acts.reduce((a, b) => a + b.holdSeconds, 0);
  log.info(`script: ${script.acts.length} act(s) · ${script.acts.map((a) => a.id).join(' ')}`);
  log.info(`planned screen time ≈ ${fmtTime(holdTotal + (script.cards?.titleSeconds ?? 5) + (script.cards?.endSeconds ?? 8))} (plus any waiting on live computations)`);

  /* 1 · preflight */
  const pf = await preflight({ install: !OPTS.noInstall });
  if (!pf.report.ok) {
    log.err('fix the items above (or pass --no-install to see what a bare machine is missing), then re-run.');
    return 1;
  }

  /* 2 · narration (before recording: the recorder paces each act to its audio) */
  let narration = null;
  if (want('narration')) {
    narration = await generateNarration(script, {
      tts: OPTS.tts, voice: OPTS.voice, rate: OPTS.rate,
      force: OPTS.forceNarration, allowStale: OPTS.allowStale,
    });
  }

  /* 3 · services */
  let running = null;
  const url = OPTS.url ?? `http://localhost:${OPTS.frontend === 'preview' ? 4173 : 5173}/console`;
  if (want('services') && !OPTS.url) {
    running = await startServices({ frontend: OPTS.frontend });
    await warmCaches();
  } else if (OPTS.url) {
    log.info(`using the app already running at ${OPTS.url}`);
  }

  const stop = () => {
    if (running && !OPTS.keepServices) stopServices(running.services);
    else if (running) log.info('leaving services running (--keep-services)');
  };
  process.on('SIGINT', () => { log.warn('interrupted — stopping services'); stop(); process.exit(130); });
  process.on('SIGTERM', () => { stop(); process.exit(143); });

  try {
    /* 4 · record */
    if (want('record')) {
      await recordTake({
        script, url, chromium: pf.chromium,
        record: !OPTS.dry, stills: !OPTS.dry,
        width: OPTS.width, height: OPTS.height,
        warm: !OPTS.noWarm,
      });
    }

    /* 5 · assemble */
    if (want('assemble') && !OPTS.dry) {
      if (!existsSync(FILES.timeline)) throw new Error('nothing to assemble: run the record stage first');
      const out = await assemble({ script, chromium: pf.chromium, share: !OPTS.noShare, subtitles: OPTS.subtitles });
      log.step('Deliverables');
      log.info(`video     ${out.master}`);
      log.info(`runtime   ${fmtTime(out.totalDur)}`);
      log.info(`voice     ${narration ? narration.provider : '(from an earlier stage)'}${narration?.voice ? ` · ${narration.voice}` : ''}`);
      log.info(`next      commit docs/video/, or re-run with --short for the tight cut`);
    } else if (OPTS.dry) {
      log.step('Dry run complete');
      log.info(`screenshots in ${join(WORK, 'shots')}`);
      log.info('re-run without --dry to record and assemble the video');
    }
  } finally {
    stop();
  }

  log.ok(`finished in ${fmtTime((Date.now() - t0) / 1000)}`);
  return 0;
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    log.err(String(err?.stack || err?.message || err).split('\n').slice(0, 14).join('\n        '));
    process.exit(1);
  },
);
