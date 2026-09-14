/**
 * Assembler — turn the recorded take + narration clips into the deliverables:
 *
 *   docs/video/Dakshin-Marg-demo.mp4         master (1280×720, 30 fps, narrated)
 *   docs/video/Dakshin-Marg-demo-720p.mp4    shareable cut (1280×720)
 *   docs/video/Dakshin-Marg-narration.mp3    voice track only
 *   docs/video/Dakshin-Marg-demo.srt         subtitles, paced from the real audio
 *
 * Structure: title card → recorded take (warm-up trimmed) → end card, with the
 * narration laid on at the cue times the recorder wrote into work/timeline.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// playwright-core is imported lazily so preflight can install it first
import { FILES, HERE, NARRATION_DIR, VIDEO, WORK, ensureDirs, makeLogger } from './config.mjs';
import { resolveFfmpeg } from './preflight.mjs';
import { probeDuration, spoken } from './tts.mjs';

const log = makeLogger();

function ff(args, label) {
  const bin = resolveFfmpeg({ install: false });
  if (!bin.ok) throw new Error(bin.reason);
  const r = spawnSync(bin.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed (${label}):\n${(r.stderr || r.stdout || '').slice(-1800)}`);
  }
  return r;
}

function newestWebm(dir = join(WORK, 'video')) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /\.(webm|mp4)$/i.test(f)).map((f) => join(dir, f));
  if (files.length === 0) return null;
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/* ── title / end cards ──────────────────────────────────────────────────── */

export async function renderCards({ chromium: chr, width = VIDEO.width, height = VIDEO.height, script }) {
  const cardsDir = join(WORK, 'cards');
  mkdirSync(cardsDir, { recursive: true });
  let executablePath = chr.executablePath;
  if (chr.inflate) executablePath = await chr.inflate();
  const { chromium: chromiumPw } = await import('playwright-core');
  const browser = await chromiumPw.launch({ executablePath, headless: true, args: chr.args ?? [] });
  try {
    const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
    for (const name of ['title', 'end']) {
      const html = join(HERE, 'cards', `${name}.html`);
      if (!existsSync(html)) throw new Error(`missing card template: ${html}`);
      let body = readFileSync(html, 'utf8')
        .replaceAll('{{PRODUCT}}', script.product ?? 'Dakshin Marg')
        .replaceAll('{{YEAR}}', String(new Date().getFullYear()));
      await page.setContent(body, { waitUntil: 'load' });
      await page.waitForTimeout(700);
      const out = join(cardsDir, `${name}.png`);
      await page.screenshot({ path: out });
      log.info(`  card ${name} → ${out}`);
    }
  } finally {
    await browser.close();
  }
  return { title: join(cardsDir, 'title.png'), end: join(cardsDir, 'end.png') };
}

/* ── subtitles ──────────────────────────────────────────────────────────── */

const srtTs = (sec) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${rest.toFixed(3).padStart(6, '0')}`.replace('.', ',');
};

function chunkText(text, n) {
  const words = text.split(/\s+/).filter(Boolean);
  const size = Math.max(1, Math.ceil(words.length / Math.max(1, n)));
  const out = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(' '));
  return out;
}

function buildSrt(placements) {
  const lines = [];
  let idx = 1;
  for (const p of placements) {
    const text = spoken(p.text);
    const parts = chunkText(text, Math.max(2, Math.round(p.duration / 6.5)));
    const chars = parts.reduce((a, b) => a + b.length, 0) || 1;
    let t = p.start;
    for (const part of parts) {
      const d = p.duration * (part.length / chars);
      lines.push(`${idx}\n${srtTs(t)} --> ${srtTs(t + d - 0.05)}\n${part}\n`);
      idx += 1;
      t += d;
    }
  }
  writeFileSync(FILES.subtitles, lines.join('\n'));
  return idx - 1;
}

/* ── the assembly ───────────────────────────────────────────────────────── */

export async function assemble({ script, chromium: chr, share = true, keepBuild = false } = {}) {
  ensureDirs();
  log.step('Assemble — cards, take, narration, subtitles');

  if (!existsSync(FILES.timeline)) throw new Error(`no recorded timeline at ${FILES.timeline} — run the record step first`);
  const tl = JSON.parse(readFileSync(FILES.timeline, 'utf8'));
  const cues = Object.fromEntries((tl.cues ?? []).map((c) => [c.name, c.t]));
  const takeStart = cues.take_start;
  if (takeStart === undefined) throw new Error('timeline has no take_start cue');
  const takePad = Number(process.env.DM_TAKE_PAD ?? 0);   // extra seconds trimmed off the take head

  const take = (tl.takeFile && existsSync(tl.takeFile)) ? tl.takeFile : newestWebm();
  if (!take) throw new Error(`no recording in ${join(WORK, 'video')} — run the record step first`);
  log.info(`take: ${take} (${(statSync(take).size / 1e6).toFixed(1)} MB)`);

  const durations = tl.durations ?? {};
  const missing = script.acts.filter((a) => !existsSync(join(NARRATION_DIR, `${a.id}.mp3`)));
  if (missing.length) log.warn(`no audio for: ${missing.map((a) => a.id).join(', ')} (these acts stay silent)`);

  /* cards */
  const cards = await renderCards({ chromium: chr, script, width: 1600, height: 900 });  // cards are laid out for 1600×900; segments downscale
  const titleDur = Math.max(script.cards?.titleSeconds ?? 5, (durations['00_title'] ?? 0) + 1.6);

  /* narration placement */
  const OFFSET = 0.4;                                  // seconds after the cue
  const placements = [];
  for (const act of script.acts) {
    const file = join(NARRATION_DIR, `${act.id}.mp3`);
    if (!existsSync(file)) continue;
    const dur = durations[act.id] ?? probeDuration(file);
    let start;
    if (act.id === '00_title') start = 0.35;
    else {
      const cue = cues[`${act.id}_cue`];
      if (cue === undefined) { log.warn(`act ${act.id} has no recorded cue — skipping its narration`); continue; }
      start = Math.max(titleDur + 0.3, titleDur + (cue - takeStart - takePad) + OFFSET);
    }
    placements.push({ id: act.id, file, start, duration: dur, text: act.text });
  }
  placements.sort((a, b) => a.start - b.start);

  /* narration mix */
  const inputs = [];
  const filters = [];
  placements.forEach((p, i) => {
    inputs.push('-i', p.file);
    const delay = Math.max(0, Math.round(p.start * 1000));
    filters.push(`[${i}:a]aresample=48000,adelay=${delay}|${delay},volume=1.0[a${i}]`);
  });
  const mixFile = join(WORK, 'build', 'narration.m4a');
  if (placements.length === 0) {
    log.warn('no narration clips — the video will be silent');
    ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', '-c:a', 'aac', mixFile], 'silent track');
  } else {
    filters.push(`${placements.map((_, i) => `[a${i}]`).join('')}amix=inputs=${placements.length}:normalize=0:duration=longest[out]`);
    ff([...inputs, '-filter_complex', filters.join(';'), '-map', '[out]',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', mixFile], 'narration mix');
    log.ok(`narration mix — ${placements.length} clip(s)`);
  }

  /* video segments */
  const takeDur = Math.max(1, (tl.total ?? 0) - takeStart + 2.5 - takePad);
  const buildDir = join(WORK, 'build');
  mkdirSync(buildDir, { recursive: true });

  ff(['-loop', '1', '-t', String(titleDur), '-i', cards.title,
    '-vf', `scale=${VIDEO.width}:${VIDEO.height},fps=${VIDEO.fps},fade=t=in:st=0:d=0.7,fade=t=out:st=${(titleDur - 0.7).toFixed(2)}:d=0.7,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(VIDEO.crf), '-an',
    join(buildDir, '01_title.mp4')], 'title card');

  const capFirst = tl.capture?.firstFrameMy ?? 0;   // take-file time of the session clock zero
  ff(['-ss', `${Math.max(0, takeStart - 1.0 - capFirst + takePad).toFixed(2)}`, '-i', take, '-t', `${takeDur.toFixed(2)}`,
    '-vf', `fps=${VIDEO.fps},scale=${VIDEO.width}:${VIDEO.height}:force_original_aspect_ratio=decrease,pad=${VIDEO.width}:${VIDEO.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(VIDEO.crf), '-an',
    join(buildDir, '02_take.mp4')], 'take segment');

  // the end card must cover any narration that runs past the take
  const voiceEnd = placements.reduce((m, p) => Math.max(m, p.start + p.duration), 0);
  const videoBeforeEnd = titleDur + takeDur;
  const endDur = Math.max(script.cards?.endSeconds ?? 8, voiceEnd - videoBeforeEnd + 1.8, 4);
  ff(['-loop', '1', '-t', `${endDur.toFixed(2)}`, '-i', cards.end,
    '-vf', `scale=${VIDEO.width}:${VIDEO.height},fps=${VIDEO.fps},fade=t=in:st=0:d=0.7,fade=t=out:st=${(endDur - 0.9).toFixed(2)}:d=0.9,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(VIDEO.crf), '-an',
    join(buildDir, '03_end.mp4')], 'end card');

  const list = join(buildDir, 'list.txt');
  writeFileSync(list, ['01_title', '02_take', '03_end'].map((s) => `file '${join(buildDir, `${s}.mp4`)}'\n`).join(''));
  const silent = join(buildDir, 'silent.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent], 'concat');

  const totalDur = titleDur + takeDur + endDur;
  ff(['-i', silent, '-i', mixFile,
    '-filter_complex', `[1:a]apad,atrim=0:${totalDur.toFixed(2)},asetpts=PTS-STARTPTS[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart', FILES.master], 'final mux');
  log.ok(`master → ${FILES.master}`);

  if (share) {
    ff(['-i', FILES.master,
      '-vf', `scale=${VIDEO.shareWidth}:${VIDEO.shareHeight},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(VIDEO.shareCrf),
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', FILES.share], '720p share cut');
    log.ok(`shareable → ${FILES.share}`);
  }

  ff(['-i', mixFile, '-t', `${totalDur.toFixed(2)}`, '-c:a', 'libmp3lame', '-b:a', '160k', FILES.narrationTrack], 'narration track');

  const subs = buildSrt(placements);
  log.ok(`subtitles → ${FILES.subtitles} (${subs} cues)`);

  if (!keepBuild) {
    for (const f of ['01_title.mp4', '02_take.mp4', '03_end.mp4', 'silent.mp4']) {
      rmSync(join(buildDir, f), { force: true });
    }
  }

  const mb = (p) => (existsSync(p) ? `${(statSync(p).size / 1e6).toFixed(1)} MB` : '—');
  log.step('Done');
  log.info(`master      ${FILES.master}   ${mb(FILES.master)}`);
  log.info(`720p        ${FILES.share}   ${mb(FILES.share)}`);
  log.info(`narration   ${FILES.narrationTrack}   ${mb(FILES.narrationTrack)}`);
  log.info(`subtitles   ${FILES.subtitles}`);
  log.info(`runtime     ${fmtTime(totalDur)} (title ${titleDur.toFixed(1)}s + take ${takeDur.toFixed(1)}s + end ${endDur.toFixed(1)}s)`);
  return { master: FILES.master, share: FILES.share, subtitles: FILES.subtitles, totalDur, titleDur, takeDur, endDur };
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
