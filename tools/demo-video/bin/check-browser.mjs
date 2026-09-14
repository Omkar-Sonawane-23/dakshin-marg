#!/usr/bin/env node

/**
 * Interactive Browser Recorder
 *
 * Features:
 *   - Opens a REAL visible Chromium browser
 *   - Records the screen using FFmpeg
 *   - Captures the REAL OS mouse cursor
 *   - Captures keyboard + mouse actions
 *   - Supports manual interaction
 *   - Supports Playwright automation
 *   - Saves final recording as MP4
 *
 * Usage:
 *
 *   node tools/demo-video/bin/check-browser.mjs
 *
 *   node tools/demo-video/bin/check-browser.mjs \
 *     --url=http://localhost:5173/
 *
 * Stop recording:
 *
 *   Press Ctrl+C
 *
 */

import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

import { chromium } from 'playwright';

import {
  WORK,
  VIDEO,
  ensureDirs,
  makeLogger,
} from '../src/config.mjs';

import { preflight } from '../src/preflight.mjs';


// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

const log = makeLogger();

const url =
  process.argv
    .find((arg) => arg.startsWith('--url='))
    ?.slice('--url='.length)
  ?? 'http://localhost:5173/';

const RECORDINGS_DIR = join(WORK, 'recordings');

mkdirSync(RECORDINGS_DIR, {
  recursive: true,
});

const timestamp =
  new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

const OUTPUT_FILE =
  join(
    RECORDINGS_DIR,
    `demo-${timestamp}.mp4`
  );


// ------------------------------------------------------------
// Find FFmpeg
// ------------------------------------------------------------

function findFFmpeg() {

  const candidates = [
    'ffmpeg',
    'ffmpeg.exe',
  ];

  for (const candidate of candidates) {

    try {

      const result = spawn(
        candidate,
        ['-version'],
        {
          stdio: 'ignore',
          windowsHide: true,
        }
      );

      return candidate;

    } catch {
      // Continue
    }
  }

  return null;
}


// ------------------------------------------------------------
// Start FFmpeg screen recorder
// ------------------------------------------------------------

function startRecorder() {

  const ffmpeg = findFFmpeg();

  if (!ffmpeg) {

    throw new Error(
      [
        '',
        'FFmpeg was not found.',
        '',
        'Install FFmpeg and make sure "ffmpeg" is available',
        'from your terminal PATH.',
        '',
        'Windows:',
        '  winget install Gyan.FFmpeg',
        '',
      ].join('\n')
    );
  }

  log.info(`FFmpeg: ${ffmpeg}`);

  /**
   * Windows desktop capture.
   *
   * gdigrab captures the actual desktop, including:
   *   - Chromium
   *   - real mouse cursor
   *   - browser animations
   *   - WebGL
   *   - anything else visible on screen
   */

  const args = [
    '-y',

    // Capture entire Windows desktop
    '-f',
    'gdigrab',

    // Capture mouse cursor
    '-draw_mouse',
    '1',

    // Desktop source
    '-i',
    'desktop',

    // Frame rate
    '-framerate',
    '30',

    // Video codec
    '-c:v',
    'libx264',

    // Quality
    '-preset',
    'veryfast',

    '-crf',
    '18',

    // Pixel format compatible with most players/editors
    '-pix_fmt',
    'yuv420p',

    // Fast start for MP4
    '-movflags',
    '+faststart',

    OUTPUT_FILE,
  ];

  log.info('Starting screen recording...');

  const recorder = spawn(
    ffmpeg,
    args,
    {
      stdio: [
        'pipe',
        'ignore',
        'pipe',
      ],

      windowsHide: true,
    }
  );

  recorder.stderr.on(
    'data',
    (data) => {

      const text =
        data
          .toString()
          .trim();

      if (
        text.includes('frame=') ||
        text.includes('fps=')
      ) {
        process.stdout.write(
          `\r${text.slice(-120)}`
        );
      }

    }
  );

  recorder.on(
    'error',
    (error) => {

      log.err(
        `FFmpeg error: ${error.message}`
      );

    }
  );

  return recorder;
}


// ------------------------------------------------------------
// Stop FFmpeg cleanly
// ------------------------------------------------------------

function stopRecorder(recorder) {

  return new Promise((resolve) => {

    if (!recorder || recorder.killed) {
      resolve();
      return;
    }

    log.info('');
    log.info('Stopping recorder...');

    let finished = false;

    const done = () => {

      if (finished) return;

      finished = true;

      resolve();

    };

    recorder.once(
      'close',
      done
    );

    /**
     * q tells FFmpeg to finish the MP4 properly.
     *
     * This is important.
     * Do NOT simply kill FFmpeg because the MP4 can become corrupt.
     */

    try {

      recorder.stdin.write('q');
      recorder.stdin.end();

    } catch {

      recorder.kill('SIGINT');

    }

    setTimeout(
      () => {

        if (!finished) {

          try {
            recorder.kill('SIGINT');
          } catch {}

        }

      },
      5000
    );

  });
}


// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

async function main() {

  ensureDirs();

  log.info('Running browser preflight...');

  const pf =
    await preflight({
      install: true,
    });

  if (!pf.chromium.ok) {

    log.err(
      pf.chromium.reason
    );

    process.exit(1);
  }

  let executablePath =
    pf.chromium.executablePath;

  if (pf.chromium.inflate) {

    executablePath =
      await pf.chromium.inflate();

  }

  log.info(
    `Chromium: ${executablePath}`
  );


  // ----------------------------------------------------------
  // Start screen recording FIRST
  // ----------------------------------------------------------

  const recorder =
    startRecorder();


  // ----------------------------------------------------------
  // Launch visible Chromium
  // ----------------------------------------------------------

  log.info(
    'Launching visible Chromium...'
  );

  const browser =
    await chromium.launch({

      executablePath,

      /**
       * THIS IS THE IMPORTANT PART.
       *
       * headless: false
       *
       * The browser window is physically visible.
       */

      headless: false,

      args: [
        ...(pf.chromium.args ?? []),

        '--disable-infobars',

        '--disable-features=TranslateUI',

        '--no-first-run',

        '--no-default-browser-check',

        /**
         * Give Chromium a predictable window size.
         */
        '--window-size=1920,1080',

      ],

    });


  // ----------------------------------------------------------
  // Browser context
  // ----------------------------------------------------------

  const context =
    await browser.newContext({

      viewport: {
        width: VIDEO.width,
        height: VIDEO.height,
      },

      deviceScaleFactor: 1,

    });


  const page =
    await context.newPage();


  // ----------------------------------------------------------
  // Error monitoring
  // ----------------------------------------------------------

  const errors = [];

  page.on(
    'pageerror',
    (error) => {

      errors.push(
        `pageerror: ${String(
          error.message || error
        ).slice(0, 300)}`
      );

    }
  );


  page.on(
    'console',
    (message) => {

      if (
        message.type() === 'error'
      ) {

        errors.push(
          `console: ${message.text().slice(
            0,
            300
          )}`
        );

      }

    }
  );


  // ----------------------------------------------------------
  // Open website
  // ----------------------------------------------------------

  log.info(
    `Opening ${url}`
  );

  await page.goto(
    url,
    {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    }
  );


  log.ok(
    `Application opened at ${url}`
  );


  // ----------------------------------------------------------
  // Wait for application
  // ----------------------------------------------------------

  await page.waitForTimeout(
    5000
  );


  // ----------------------------------------------------------
  // Check DSS canvas
  // ----------------------------------------------------------

  const canvas =
    await page.waitForSelector(
      '.dss-map-stage canvas',
      {
        timeout: 60000,
      }
    )
    .catch(() => null);


  // ----------------------------------------------------------
  // Check brand
  // ----------------------------------------------------------

  const brand =
    await page
      .locator('body')
      .innerText()
      .then(
        (text) =>
          (
            text.match(
              /DAKSHIN MARG/i
            ) ?? [
              '(brand not visible)'
            ]
          )[0]
      )
      .catch(
        () => '?'
      );


  // ----------------------------------------------------------
  // WebGL check
  // ----------------------------------------------------------

  const gl =
    await page.evaluate(() => {

      const canvas =
        document.createElement(
          'canvas'
        );

      const context =
        canvas.getContext(
          'webgl2'
        ) ||
        canvas.getContext(
          'webgl'
        );

      if (!context) {
        return 'no webgl';
      }

      const debug =
        context.getExtension(
          'WEBGL_debug_renderer_info'
        );

      if (!debug) {
        return 'webgl ok';
      }

      return String(
        context.getParameter(
          debug.UNMASKED_RENDERER_WEBGL
        )
      );

    }).catch(
      () => 'unknown'
    );


  // ----------------------------------------------------------
  // Status
  // ----------------------------------------------------------

  log.info(
    `canvas: ${
      canvas
        ? 'present'
        : 'MISSING'
    }`
  );

  log.info(
    `webgl renderer: ${gl}`
  );

  log.info(
    `brand text: ${brand}`
  );


  if (errors.length) {

    log.warn(
      `${errors.length} browser error(s):\n` +
      [
        ...new Set(errors)
      ]
        .slice(0, 10)
        .map(
          (error) =>
            `  - ${error}`
        )
        .join('\n')
    );

  } else {

    log.ok(
      'No browser errors'
    );

  }


  // ----------------------------------------------------------
  // Interactive mode
  // ----------------------------------------------------------

  console.log('');
  console.log(
    '======================================================'
  );
  console.log(
    '               INTERACTIVE RECORDING'
  );
  console.log(
    '======================================================'
  );
  console.log('');
  console.log(
    'The Chromium window is now visible.'
  );
  console.log('');
  console.log(
    'You can manually:'
  );
  console.log(
    '  • Move the real mouse'
  );
  console.log(
    '  • Click buttons'
  );
  console.log(
    '  • Scroll'
  );
  console.log(
    '  • Type'
  );
  console.log(
    '  • Navigate the application'
  );
  console.log(
    '  • Interact with your 3D/WebGL map'
  );
  console.log('');
  console.log(
    'Everything visible on the desktop is being recorded.'
  );
  console.log('');
  console.log(
    'Press CTRL+C when you want to finish recording.'
  );
  console.log('');
  console.log(
    `Output: ${OUTPUT_FILE}`
  );
  console.log('');
  console.log(
    '======================================================'
  );
  console.log('');


  // ----------------------------------------------------------
  // Keep browser alive
  // ----------------------------------------------------------

  await new Promise(
    (resolve) => {

      let stopping = false;

      const shutdown =
        async () => {

          if (stopping) return;

          stopping = true;

          console.log('');
          console.log(
            'Finishing recording...'
          );

          try {

            await context.close();

          } catch {}

          try {

            await browser.close();

          } catch {}

          await stopRecorder(
            recorder
          );

          resolve();

        };


      process.once(
        'SIGINT',
        shutdown
      );

      process.once(
        'SIGTERM',
        shutdown
      );

    }
  );


  // ----------------------------------------------------------
  // Finished
  // ----------------------------------------------------------

  console.log('');

  if (existsSync(OUTPUT_FILE)) {

    log.ok(
      `Recording saved: ${OUTPUT_FILE}`
    );

  } else {

    log.err(
      'Recording file was not created.'
    );

  }

  console.log('');
}


// ------------------------------------------------------------
// Run
// ------------------------------------------------------------

main().catch(
  async (error) => {

    log.err(
      error?.stack ||
      String(error)
    );

    process.exit(1);

  }
);
