#!/usr/bin/env node

/**
 * Dakshin Marg — one-click SIH demo video.
 *
 * IMPORTANT:
 *
 * The --interactive flag does NOT mean "wait for the user".
 *
 * It means:
 *
 *   SCRIPT
 *      ↓
 *   VISIBLE CHROMIUM
 *      ↓
 *   PLAYWRIGHT ACTIONS
 *      ↓
 *   REALISTIC CURSOR ANIMATION
 *      ↓
 *   FFMPEG DESKTOP RECORDING
 *
 * The narration remains the timing source.
 *
 * Usage:
 *
 *   node tools/demo-video/bin/make-demo.mjs
 *
 * Scripted visible recording:
 *
 *   node tools/demo-video/bin/make-demo.mjs --interactive
 *
 * Existing app:
 *
 *   node tools/demo-video/bin/make-demo.mjs \
 *     --interactive \
 *     --url=http://localhost:5173/
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  FILES,
  VIDEO,
  WORK,
  ensureDirs,
  loadScript,
  makeLogger,
} from '../src/config.mjs';

import { preflight } from '../src/preflight.mjs';

import {
  startServices,
  stopServices,
  warmCaches,
} from '../src/services.mjs';

import { generateNarration } from '../src/tts.mjs';

import { recordTake } from '../src/recorder.mjs';

import {
  assemble,
  fmtTime,
} from '../src/assemble.mjs';

import {
  recordScriptedBrowser,
} from '../src/interactive-recorder.mjs';


const log = makeLogger();


// ============================================================
// Arguments
// ============================================================

const argv =
  process.argv.slice(2);


const value = (
  name,
  fallback = undefined,
) => {

  const hit =
    argv.find(
      (a) =>
        a.startsWith(
          `--${name}=`
        )
    );

  return hit
    ? hit.slice(
        name.length + 3
      )
    : fallback;
};


const flag =
  (name) =>
    argv.includes(
      `--${name}`
    );


const list =
  (name) =>
    value(name)
      ? value(name)
          .split(',')
          .map(
            (s) =>
              s.trim()
          )
          .filter(Boolean)
      : null;


// ============================================================
// Options
// ============================================================

const OPTS = {

  only:
    list('only'),

  skip:
    list('skip') ?? [],

  short:
    flag('short'),

  acts:
    value('acts'),

  tts:
    value(
      'tts',
      'auto'
    ),

  voice:
    value('voice'),

  rate:
    value('rate'),

  frontend:
    value(
      'frontend',
      'dev'
    ),

  url:
    value('url'),

  width:
    Number(
      value(
        'width',
        VIDEO.width
      )
    ),

  height:
    Number(
      value(
        'height',
        VIDEO.height
      )
    ),

  dry:
    flag('dry'),

  keepServices:
    flag('keep-services'),

  noShare:
    flag('no-share'),

  noInstall:
    flag('no-install'),

  forceNarration:
    flag('force-narration'),

  allowStale:
    flag('allow-stale-narration'),

  noWarm:
    flag('no-warm'),

  /**
   * Scripted visible-browser recording.
   */
  interactive:
    flag('interactive'),

  help:
    flag('help') ||
    flag('h'),

};


const STAGES = [
  'preflight',
  'narration',
  'services',
  'record',
  'assemble',
];


// ============================================================
// Help
// ============================================================

function usage() {

  console.log(`

Dakshin Marg — SIH demo video generator

Stages:

  ${STAGES.join(' → ')}


Normal automated recording:

  node tools/demo-video/bin/make-demo.mjs


Script-driven visible recording:

  node tools/demo-video/bin/make-demo.mjs --interactive


Options:

  --interactive
      Execute the complete demo script in a visible browser.
      Cursor movement and clicks are shown and the desktop
      is recorded with FFmpeg.

  --only=<stage[,stage]>
      Run only selected stages.

  --skip=<stage[,stage]>
      Skip selected stages.

  --short
      Core acts only.

  --acts=<id|group,…>
      Run selected acts/groups.

  --tts=<provider>
      auto | edge-tts | openai | elevenlabs |
      piper | sapi | espeak | cache

  --voice=<name>
      TTS voice.

  --rate=<±N%>
      Speech rate.

  --frontend=dev|preview
      Vite dev server :5173
      or production preview :4173.

  --url=<url>
      Use an already-running app.

  --width=N
  --height=N
      Recording dimensions.

  --dry
      Screenshots instead of video.

  --no-warm
      Skip warm-up.

  --no-share
      Do not render 720p cut.

  --no-install
      Never install missing tools.

  --force-narration
      Re-synthesise narration.

  --allow-stale-narration
      Keep cached narration if provider fails.

  --keep-services
      Keep services running.

Environment:

  DM_FFMPEG=C:\\Users\\dell\\Downloads\\ffmpeg-master-latest-win64-gpl-shared\\ffmpeg-master-latest-win64-gpl-shared\\bin\\ffmpeg.exe
  DM_CHROMIUM=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe

`);

}


// ============================================================
// Stage selection
// ============================================================

const want =
  (stage) => {

    if (OPTS.only) {

      return OPTS.only.includes(
        stage
      );

    }

    return !OPTS.skip.includes(
      stage
    );

  };


// ============================================================
// Main
// ============================================================

async function main() {

  if (OPTS.help) {

    usage();

    return 0;

  }


  ensureDirs();


  const t0 =
    Date.now();


  log.step(
    `Dakshin Marg demo video — ${
      OPTS.dry
        ? 'DRY RUN'
        : OPTS.interactive
          ? 'SCRIPTED VISIBLE RECORDING'
          : 'FULL RENDER'
    }`
  );


  // ==========================================================
  // Load script
  // ==========================================================

  const script =
    loadScript({
      short:
        OPTS.short,

      acts:
        OPTS.acts,
    });


  const holdTotal =
    script.acts.reduce(
      (total, act) =>
        total +
        act.holdSeconds,
      0
    );


  log.info(
    `script: ${
      script.acts.length
    } act(s) · ${
      script.acts
        .map(
          (a) => a.id
        )
        .join(' ')
    }`
  );


  log.info(
    `planned screen time ≈ ${
      fmtTime(
        holdTotal +
        (
          script.cards
            ?.titleSeconds ??
          5
        ) +
        (
          script.cards
            ?.endSeconds ??
          8
        )
      )}`
  );


  // ==========================================================
  // 1. Preflight
  // ==========================================================

  const pf =
    await preflight({
      install:
        !OPTS.noInstall,
    });


  if (!pf.report.ok) {

    log.err(
      'Fix the preflight errors above.'
    );

    return 1;

  }


  // ==========================================================
  // 2. Narration
  // ==========================================================

  let narration =
    null;


  if (
    want('narration')
  ) {

    narration =
      await generateNarration(
        script,
        {

          tts:
            OPTS.tts,

          voice:
            OPTS.voice,

          rate:
            OPTS.rate,

          force:
            OPTS.forceNarration,

          allowStale:
            OPTS.allowStale,

        }
      );

  }


  // ==========================================================
  // 3. Services
  // ==========================================================

  let running =
    null;


  const url =
    OPTS.url ??
    `http://localhost:${
      OPTS.frontend === 'preview'
        ? 4173
        : 5173
    }/`;


  if (
    want('services') &&
    !OPTS.url
  ) {

    running =
      await startServices({
        frontend:
          OPTS.frontend,
      });


    if (!OPTS.noWarm) {

      await warmCaches();

    }

  }
  else if (
    OPTS.url
  ) {

    log.info(
      `using app already running at ${OPTS.url}`
    );

  }


  // ==========================================================
  // Cleanup
  // ==========================================================

  const stop =
    () => {

      if (
        running &&
        !OPTS.keepServices
      ) {

        stopServices(
          running.services
        );

      }
      else if (
        running
      ) {

        log.info(
          'leaving services running (--keep-services)'
        );

      }

    };


  // ==========================================================
  // RECORD
  // ==========================================================

  try {

    if (
      want('record')
    ) {

      // ======================================================
      // SCRIPTED VISIBLE BROWSER
      // ======================================================

      if (
        OPTS.interactive
      ) {

        await recordScriptedBrowser({

          script,

          narration,

          url,

          chromium:
            pf.chromium,

          width:
            OPTS.width,

          height:
            OPTS.height,

          dry:
            OPTS.dry,

        });

      }


      // ======================================================
      // EXISTING AUTOMATED RECORDER
      // ======================================================

      else {

        await recordTake({

          script,

          url,

          chromium:
            pf.chromium,

          record:
            !OPTS.dry,

          stills:
            !OPTS.dry,

          width:
            OPTS.width,

          height:
            OPTS.height,

          warm:
            !OPTS.noWarm,

        });

      }

    }


    // ========================================================
    // Assemble normal automated take
    // ========================================================

    if (
      want('assemble') &&
      !OPTS.dry &&
      !OPTS.interactive
    ) {

      if (
        !existsSync(
          FILES.timeline
        )
      ) {

        throw new Error(
          'nothing to assemble: run the record stage first'
        );

      }


      const out =
        await assemble({

          script,

          chromium:
            pf.chromium,

          share:
            !OPTS.noShare,

        });


      log.step(
        'Deliverables'
      );


      log.info(
        `video     ${out.master}`
      );


      log.info(
        `runtime   ${fmtTime(
          out.totalDur
        )}`
      );


      log.info(
        `voice     ${
          narration
            ? narration.provider
            : '(from an earlier stage)'
        }${
          narration?.voice
            ? ` · ${narration.voice}`
            : ''
        }`
      );

    }


    // ========================================================
    // Interactive result
    // ========================================================

    if (
      OPTS.interactive &&
      !OPTS.dry
    ) {

      log.step(
        'Scripted recording complete'
      );

      log.info(
        'The recorded video follows the demo script.'
      );

      log.info(
        'Narration timing was used to pace each act.'
      );

    }


    // ========================================================
    // Dry
    // ========================================================

    if (
      OPTS.dry
    ) {

      log.step(
        'Dry run complete'
      );


      log.info(
        `screenshots in ${
          join(
            WORK,
            'shots'
          )
        }`
      );

    }

  }
  finally {

    stop();

  }


  log.ok(
    `finished in ${
      fmtTime(
        (Date.now() - t0) /
        1000
      )
    }`
  );


  return 0;

}


// ============================================================
// Execute
// ============================================================

main().then(

  (code) =>
    process.exit(
      code ?? 0
    ),

  (err) => {

    log.err(
      String(
        err?.stack ||
        err?.message ||
        err
      )
        .split('\n')
        .slice(
          0,
          14
        )
        .join(
          '\n        '
        )
    );


    process.exit(1);

  }

);
