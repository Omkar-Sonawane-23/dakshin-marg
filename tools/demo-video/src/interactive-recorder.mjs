/**
 * Script-aware visible browser recorder.
 *
 * The important rule:
 *
 * DO NOT invent the demo flow here.
 *
 * The existing script is the source of truth.
 *
 * Each act can define:
 *
 *   act.id
 *   act.holdSeconds
 *   act.actions
 *
 * Example:
 *
 * {
 *   id: '06_seaice',
 *   holdSeconds: 38,
 *   actions: [
 *     { type: 'move', selector: '[data-demo="seaice"]' },
 *     { type: 'click', selector: '[data-demo="seaice"]' },
 *     { type: 'wait', seconds: 3 }
 *   ]
 * }
 */

import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

import { chromium } from 'playwright';

import {
  WORK,
  VIDEO,
  makeLogger,
} from './config.mjs';


const log =
  makeLogger();


// ============================================================
// FFmpeg
// ============================================================

function getFFmpeg() {

  /**
   * NEVER assume ffmpeg.exe is in PATH if DM_FFMPEG exists.
   */

  if (
    "C:\\Users\\dell\\Downloads\\ffmpeg-master-latest-win64-gpl-shared\\ffmpeg-master-latest-win64-gpl-shared\\bin\\ffmpeg.exe"
  ) {

    return "C:\\Users\\dell\\Downloads\\ffmpeg-master-latest-win64-gpl-shared\\ffmpeg-master-latest-win64-gpl-shared\\bin\\ffmpeg.exe";

  }


  return process.platform === 'win32'
    ? 'ffmpeg.exe'
    : 'ffmpeg';

}


// ============================================================
// Start recording
// ============================================================

function startRecording({
  width,
  height,
}) {

  const ffmpeg =
    getFFmpeg();


  const dir =
    join(
      WORK,
      'recordings'
    );


  mkdirSync(
    dir,
    {
      recursive: true,
    }
  );


  const stamp =
    new Date()
      .toISOString()
      .replace(
        /[:.]/g,
        '-'
      );


  const output =
    join(
      dir,
      `dakshin-marg-${stamp}.mp4`
    );


  let args;


  if (
    process.platform ===
    'win32'
  ) {

    args = [

      '-y',

      '-f',
      'gdigrab',

      /**
       * Real Windows cursor.
       */
      '-draw_mouse',
      '1',

      '-framerate',
      '30',

      '-video_size',
      `${width}x${height}`,

      '-i',
      'desktop',

      '-c:v',
      'libx264',

      '-preset',
      'veryfast',

      '-crf',
      '18',

      '-pix_fmt',
      'yuv420p',

      '-movflags',
      '+faststart',

      output,

    ];

  }
  else {

    throw new Error(
      'This interactive recorder currently targets Windows. Use the existing recorder on macOS/Linux.'
    );

  }


  log.info(
    `FFmpeg: ${ffmpeg}`
  );


  log.info(
    `recording → ${output}`
  );


  const proc =
    spawn(
      ffmpeg,
      args,
      {
        stdio: [
          'pipe',
          'ignore',
          'pipe',
        ],

        windowsHide:
          true,
      }
    );


  proc.on(
    'error',
    (err) => {

      log.err(
        `FFmpeg failed: ${err.message}`
      );

      log.err(
        `Set DM_FFMPEG to the full path of ffmpeg.exe.`
      );

    }
  );


  return {
    proc,
    output,
  };

}


// ============================================================
// Stop recording
// ============================================================

async function stopRecording(
  recording
) {

  if (
    !recording?.proc ||
    recording.proc.killed
  ) {

    return;

  }


  return new Promise(
    (resolve) => {

      let done =
        false;


      const finish =
        () => {

          if (done) {
            return;
          }

          done = true;

          resolve();

        };


      recording.proc.once(
        'close',
        finish
      );


      try {

        recording.proc.stdin.write(
          'q'
        );

        recording.proc.stdin.end();

      }
      catch {

        try {

          recording.proc.kill(
            'SIGINT'
          );

        }
        catch {}

      }


      setTimeout(
        () => {

          if (!done) {

            try {

              recording.proc.kill(
                'SIGINT'
              );

            }
            catch {}

          }

        },
        5000
      );

    }
  );

}


// ============================================================
// Cursor
// ============================================================

async function installCursor(
  page
) {

  await page.addStyleTag({
    content: `

      #dakshin-demo-cursor {

        position: fixed;

        z-index: 2147483647;

        width: 24px;

        height: 24px;

        pointer-events: none;

        left: 50%;

        top: 50%;

        transition:
          left 0.45s cubic-bezier(.2,.8,.2,1),
          top 0.45s cubic-bezier(.2,.8,.2,1);

      }


      #dakshin-demo-cursor::before {

        content: "";

        position: absolute;

        left: 2px;

        top: 1px;

        width: 0;

        height: 0;

        border-top:
          19px solid #111;

        border-right:
          7px solid transparent;

        transform:
          rotate(-8deg);

      }


      #dakshin-demo-cursor::after {

        content: "";

        position: absolute;

        left: 4px;

        top: 3px;

        width: 0;

        height: 0;

        border-top:
          14px solid white;

        border-right:
          5px solid transparent;

        transform:
          rotate(-8deg);

      }


      #dakshin-demo-click {

        position: fixed;

        z-index: 2147483646;

        pointer-events: none;

        width: 46px;

        height: 46px;

        border:
          2px solid white;

        border-radius: 50%;

        opacity: 0;

        transform:
          translate(-50%, -50%)
          scale(.2);

        box-shadow:
          0 0 0 2px rgba(0,0,0,.3),
          0 0 20px rgba(255,255,255,.5);

      }


      #dakshin-demo-click.active {

        animation:
          dakshin-click .45s ease-out;

      }


      @keyframes dakshin-click {

        0% {

          opacity: .9;

          transform:
            translate(-50%, -50%)
            scale(.2);

        }

        100% {

          opacity: 0;

          transform:
            translate(-50%, -50%)
            scale(1.5);

        }

      }

    `,
  });


  await page.evaluate(
    () => {

      const cursor =
        document.createElement(
          'div'
        );

      cursor.id =
        'dakshin-demo-cursor';


      const click =
        document.createElement(
          'div'
        );

      click.id =
        'dakshin-demo-click';


      document.body.appendChild(
        cursor
      );

      document.body.appendChild(
        click
      );

    }
  );

}


// ============================================================
// Move cursor
// ============================================================

async function moveCursorTo(
  page,
  selector,
  options = {}
) {

  const locator =
    page.locator(
      selector
    ).first();


  await locator.waitFor({
    state: 'visible',
    timeout: 30000,
  });


  const box =
    await locator.boundingBox();


  if (!box) {

    throw new Error(
      `Element has no bounding box: ${selector}`
    );

  }


  const x =
    box.x +
    box.width / 2;


  const y =
    box.y +
    box.height / 2;


  await page.evaluate(
    ({ x, y }) => {

      const cursor =
        document.querySelector(
          '#dakshin-demo-cursor'
        );


      if (cursor) {

        cursor.style.left =
          `${x}px`;

        cursor.style.top =
          `${y}px`;

      }

    },
    {
      x,
      y,
    }
  );


  await page.waitForTimeout(
    options.duration ??
    600
  );

}


// ============================================================
// Click
// ============================================================

async function clickElement(
  page,
  selector
) {

  await moveCursorTo(
    page,
    selector
  );


  await page.evaluate(
    () => {

      const click =
        document.querySelector(
          '#dakshin-demo-click'
        );

      const cursor =
        document.querySelector(
          '#dakshin-demo-cursor'
        );


      if (!click || !cursor) {
        return;
      }


      const rect =
        cursor.getBoundingClientRect();


      click.style.left =
        `${
          rect.left +
          rect.width / 2
        }px`;


      click.style.top =
        `${
          rect.top +
          rect.height / 2
        }px`;


      click.classList.remove(
        'active'
      );


      void click.offsetWidth;


      click.classList.add(
        'active'
      );

    }
  );


  await page.waitForTimeout(
    180
  );


  await page
    .locator(selector)
    .first()
    .click();


  await page.waitForTimeout(
    500
  );

}


// ============================================================
// Execute one action
// ============================================================

async function executeAction(
  page,
  action
) {

  if (!action) {
    return;
  }


  switch (
    action.type
  ) {

    // --------------------------------------------------------
    // move
    // --------------------------------------------------------

    case 'move':

      await moveCursorTo(
        page,
        action.selector,
        {
          duration:
            action.duration ??
            700,
        }
      );

      break;


    // --------------------------------------------------------
    // click
    // --------------------------------------------------------

    case 'click':

      await clickElement(
        page,
        action.selector
      );

      break;


    // --------------------------------------------------------
    // wait
    // --------------------------------------------------------

    case 'wait':

      await page.waitForTimeout(
        (
          action.seconds ??
          1
        ) * 1000
      );

      break;


    // --------------------------------------------------------
    // scroll
    // --------------------------------------------------------

    case 'scroll':

      await page.mouse.wheel(
        action.x ?? 0,
        action.y ?? 500
      );

      await page.waitForTimeout(
        action.wait ??
        700
      );

      break;


    // --------------------------------------------------------
    // type
    // --------------------------------------------------------

    case 'type':

      await page
        .locator(
          action.selector
        )
        .first()
        .fill(
          action.text ?? ''
        );

      break;


    // --------------------------------------------------------
    // press
    // --------------------------------------------------------

    case 'press':

      await page
        .locator(
          action.selector
        )
        .first()
        .press(
          action.key
        );

      break;


    // --------------------------------------------------------
    // hover
    // --------------------------------------------------------

    case 'hover':

      await moveCursorTo(
        page,
        action.selector
      );

      await page
        .locator(
          action.selector
        )
        .first()
        .hover();

      break;


    // --------------------------------------------------------
    // drag
    // --------------------------------------------------------

    case 'drag':

      await moveCursorTo(
        page,
        action.from
      );


      await page
        .locator(
          action.from
        )
        .first()
        .dragTo(
          page.locator(
            action.to
          ).first()
        );

      break;


    // --------------------------------------------------------
    // evaluate
    // --------------------------------------------------------

    case 'evaluate':

      if (
        typeof action.code ===
        'function'
      ) {

        await action.code(
          page
        );

      }

      break;


    default:

      log.warn(
        `Unknown action: ${action.type}`
      );

  }

}


// ============================================================
// Execute act
// ============================================================

async function executeAct(
  page,
  act
) {

  log.step(
    `ACT ${act.id} — ${
      act.holdSeconds
    }s`
  );


  const started =
    Date.now();


  /**
   * Execute actions defined by the script.
   */
  if (
    Array.isArray(
      act.actions
    )
  ) {

    for (
      const action
      of act.actions
    ) {

      await executeAction(
        page,
        action
      );

    }

  }


  /**
   * Keep the act on screen for its
   * declared duration.
   *
   * This is what prevents the next act
   * from starting too early.
   */

  const elapsed =
    (
      Date.now() -
      started
    ) / 1000;


  const remaining =
    Math.max(
      0,
      act.holdSeconds -
      elapsed
    );


  if (
    remaining > 0
  ) {

    await page.waitForTimeout(
      remaining * 1000
    );

  }


  log.info(
    `act ${act.id} complete`
  );

}


// ============================================================
// Main recorder
// ============================================================

export async function recordScriptedBrowser({

  script,

  narration,

  url,

  chromium: chromiumInfo,

  width,

  height,

  dry = false,

}) {

  let executablePath =
    chromiumInfo.executablePath;


  if (
    chromiumInfo.inflate
  ) {

    executablePath =
      await chromiumInfo.inflate();

  }


  // ----------------------------------------------------------
  // Browser
  // ----------------------------------------------------------

  const browser =
    await chromium.launch({

      executablePath,

      /**
       * MUST be visible.
       */
      headless:
        false,

      args: [

        ...(chromiumInfo.args ?? []),

        '--no-first-run',

        '--no-default-browser-check',

        '--disable-infobars',

        '--disable-features=TranslateUI',

        `--window-size=${width},${height}`,

      ],

    });


  const context =
    await browser.newContext({

      viewport: {
        width,
        height,
      },

      deviceScaleFactor: 1,

    });


  const page =
    await context.newPage();


  // ----------------------------------------------------------
  // Browser diagnostics
  // ----------------------------------------------------------

  const errors = [];


  page.on(
    'pageerror',
    (e) => {

      errors.push(
        String(
          e.message || e
        )
      );

    }
  );


  page.on(
    'console',
    (m) => {

      if (
        m.type() ===
        'error'
      ) {

        errors.push(
          `console: ${m.text()}`
        );

      }

    }
  );


  // ----------------------------------------------------------
  // Open app
  // ----------------------------------------------------------

  log.info(
    `opening ${url}`
  );


  await page.goto(
    url,
    {
      waitUntil:
        'domcontentloaded',

      timeout:
        60000,
    }
  );


  await page.waitForTimeout(
    5000
  );


  await installCursor(
    page
  );


  // ----------------------------------------------------------
  // Start desktop recording
  // ----------------------------------------------------------

  let recording =
    null;


  if (!dry) {

    recording =
      startRecording({
        width,
        height,
      });

  }


  // ----------------------------------------------------------
  // Script
  // ----------------------------------------------------------

  log.step(
    `Executing ${script.acts.length} scripted acts`
  );


  for (
    const act
    of script.acts
  ) {

    await executeAct(
      page,
      act
    );

  }


  // ----------------------------------------------------------
  // Final hold
  // ----------------------------------------------------------

  await page.waitForTimeout(
    1000
  );


  // ----------------------------------------------------------
  // Close
  // ----------------------------------------------------------

  await context.close();


  await browser.close();


  if (recording) {

    await stopRecording(
      recording
    );


    log.ok(
      `video: ${recording.output}`
    );

  }


  if (
    errors.length
  ) {

    log.warn(
      `${errors.length} browser error(s)`
    );

  }


  return recording?.output ??
    null;

}
