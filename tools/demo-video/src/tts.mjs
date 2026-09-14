/**
 * Narration — one clip per act, from whichever text-to-speech engine this
 * machine can actually reach.
 *
 * Provider order (first one that passes a probe synthesis wins):
 *   edge-tts    Microsoft neural voices, free, no key   (needs internet)
 *   openai      OPENAI_API_KEY                          (needs internet)
 *   elevenlabs  ELEVENLABS_API_KEY                      (needs internet)
 *   piper       local neural TTS, `piper` + a .onnx voice model
 *   sapi        Windows built-in System.Speech          (offline, Windows)
 *   espeak      espeak-ng                               (offline, robotic)
 *   cache       the clips committed in tools/demo-video/narration/
 *
 * Clips are cached by a hash of their text: re-running after editing one line
 * of narration re-synthesises only that line.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILES, NARRATION_DIR, WORK, ensureDirs, makeLogger } from './config.mjs';
import { resolveFfmpeg, resolvePython, run } from './preflight.mjs';

const log = makeLogger();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const hashText = (text) => createHash('sha256').update(String(text).trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 16);

/** Text as it will be spoken (also what the subtitle file shows). */
export function spoken(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\u2014/g, ' — ')      // keep the em dash as a breath
    .replace(/\s+—\s+/g, ' — ')
    .trim();
}

function manifest() {
  try { return JSON.parse(readFileSync(FILES.manifest, 'utf8')); } catch { return { clips: {} }; }
}
function saveManifest(m) {
  mkdirSync(NARRATION_DIR, { recursive: true });
  writeFileSync(FILES.manifest, JSON.stringify(m, null, 2) + '\n');
}

/* ── ffmpeg helper (used for probing durations and transcoding) ─────────── */

let FF = null;
function ffmpeg() {
  if (FF) return FF;
  const r = resolveFfmpeg({ install: true });
  if (!r.ok) throw new Error(r.reason);
  FF = r.ffmpeg;
  return FF;
}

export function probeDuration(file) {
  const r = run(ffmpeg(), ['-hide_banner', '-i', file]);
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.out || '');
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function toMp3(src, dst) {
  const r = run(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', src,
    '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1', dst]);
  return r.code === 0 && existsSync(dst);
}

/* ── providers ──────────────────────────────────────────────────────────── */

const edgeTts = {
  id: 'edge-tts',
  label: 'Microsoft Edge neural TTS (free, no key)',
  voiceOf: (v) => v['edge-tts'] || 'en-US-AriaNeural',
  available() {
    const py = resolvePython();
    if (!py) return false;
    if (run(py.python, ['-c', 'import edge_tts']).code !== 0) {
      log.info('edge-tts: pip install edge-tts…');
      const r = run(py.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'edge-tts']);
      if (r.code !== 0) return false;
    }
    return run(py.python, ['-c', 'import edge_tts']).code === 0;
  },
  async synth({ text, out, voice, rate }) {
    const py = resolvePython();
    const args = ['-m', 'edge_tts', '--voice', voice, '--text', text, '--write-media', out];
    if (rate) args.push('--rate', rate);
    const r = run(py.python, args, { timeout: 180_000 });
    if (r.code !== 0 || !existsSync(out) || probeDuration(out) < 0.4) {
      const msg = (r.out || '').trim().split(/\r?\n/).slice(-2).join(' | ');
      return { ok: false, error: msg || 'edge-tts produced no audio' };
    }
    return { ok: true };
  },
};

const openai = {
  id: 'openai',
  label: 'OpenAI TTS (OPENAI_API_KEY)',
  voiceOf: (v) => v['openai-voice'] || 'nova',
  available() { return Boolean(process.env.OPENAI_API_KEY); },
  async synth({ text, out, voice, voiceCfg }) {
    const model = voiceCfg?.openai || 'gpt-4o-mini-tts';
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, voice, input: text, response_format: 'mp3' }),
    });
    if (!res.ok) return { ok: false, error: `openai ${res.status}: ${(await res.text()).slice(0, 200)}` };
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    return { ok: existsSync(out) && probeDuration(out) > 0.4 };
  },
};

const elevenlabs = {
  id: 'elevenlabs',
  label: 'ElevenLabs (ELEVENLABS_API_KEY)',
  voiceOf: (v) => v.elevenlabs || '21m00Tcm4TlvDq8ikWAM',
  available() { return Boolean(process.env.ELEVENLABS_API_KEY); },
  async synth({ text, out, voice }) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
    });
    if (!res.ok) return { ok: false, error: `elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const tmp = `${out}.mp3`;
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    const ok = toMp3(tmp, out);
    rmSync(tmp, { force: true });
    return { ok };
  },
};

const piper = {
  id: 'piper',
  label: 'Piper local neural TTS',
  voiceOf: () => process.env.DM_PIPER_VOICE || 'en_GB-alba-medium',
  available() {
    const bin = process.env.DM_PIPER_BIN || 'piper';
    const model = process.env.DM_PIPER_MODEL;
    return Boolean(model) && run(bin, ['--help']).code !== null;
  },
  async synth({ text, out, voice }) {
    const bin = process.env.DM_PIPER_BIN || 'piper';
    const model = process.env.DM_PIPER_MODEL;
    const wav = `${out}.wav`;
    const r = spawnSync(bin, ['--model', model, '--output_file', wav], { input: text, encoding: 'utf8' });
    if (r.status !== 0 || !existsSync(wav)) return { ok: false, error: (r.stderr || '').slice(0, 200) };
    const ok = toMp3(wav, out);
    rmSync(wav, { force: true });
    return { ok, voice };
  },
};

const sapi = {
  id: 'sapi',
  label: 'Windows System.Speech (offline)',
  voiceOf: (v) => v.sapi || '',
  available() { return process.platform === 'win32'; },
  async synth({ text, out, voice, rate }) {
    const ps = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$v = '${String(voice).replace(/'/g, '')}'`,
      'if ($v) { try { $s.SelectVoice($v) } catch { } }',
      `$s.Rate = ${Number.isFinite(parseInt(rate, 10)) ? Math.max(-5, Math.min(5, Math.round(parseInt(rate, 10) / 4))) : -1}`,
      `$s.SetOutputToWaveFile('${out.replace(/'/g, '')}.wav')`,
      '$s.Speak([Console]::In.ReadToEnd())',
      '$s.Dispose()',
    ].join('\n');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { input: text, encoding: 'utf8' });
    const wav = `${out}.wav`;
    if (r.status !== 0 || !existsSync(wav)) return { ok: false, error: (r.stderr || 'sapi produced no wav').slice(0, 200) };
    const ok = toMp3(wav, out);
    rmSync(wav, { force: true });
    return { ok };
  },
};

const espeak = {
  id: 'espeak',
  label: 'espeak-ng (offline, mechanical)',
  voiceOf: () => process.env.DM_ESPEAK_VOICE || 'en-gb',
  available() {
    for (const bin of ['espeak-ng', 'espeak']) {
      if (run(bin, ['--version']).code === 0) { espeak._bin = bin; return true; }
    }
    return false;
  },
  async synth({ text, out, voice, rate }) {
    const bin = espeak._bin || 'espeak-ng';
    const wav = `${out}.wav`;
    const wpm = rate ? Math.max(80, Math.min(260, Math.round(165 * (1 + parseInt(rate, 10) / 100)))) : 155;
    const r = run(bin, ['-v', voice, '-s', String(wpm), '-w', wav, text]);
    if (r.code !== 0 || !existsSync(wav)) return { ok: false, error: (r.out || '').slice(0, 200) };
    const ok = toMp3(wav, out);
    rmSync(wav, { force: true });
    return { ok };
  },
};

export const PROVIDERS = [edgeTts, openai, elevenlabs, piper, sapi, espeak];

/** First provider that is installed AND can actually synthesise a word. */
export async function pickProvider({ tts, voiceCfg } = {}) {
  if (tts === 'cache') return { provider: null, voice: null };   // bundled clips only
  const wanted = tts && tts !== 'auto' ? PROVIDERS.filter((p) => p.id === tts) : PROVIDERS;
  if (tts && tts !== 'auto' && wanted.length === 0) {
    throw new Error(`unknown TTS provider "${tts}" — pick one of: ${PROVIDERS.map((p) => p.id).join(', ')}, cache`);
  }
  const probeOut = join(WORK, 'tts-probe.mp3');
  for (const p of wanted) {
    let installed = false;
    try { installed = Boolean(p.available()); } catch { installed = false; }
    if (!installed) { log.info(`tts ${p.id}: not available`); continue; }
    const voice = process.env.DM_TTS_VOICE || p.voiceOf(voiceCfg ?? {});
    rmSync(probeOut, { force: true });
    const r = await p.synth({ text: 'Dakshin Marg, decision support.', out: probeOut, voice, voiceCfg });
    if (r.ok) {
      log.ok(`tts ${p.id}: ${p.label}${voice ? ` · voice ${voice}` : ''}`);
      rmSync(probeOut, { force: true });
      return { provider: p, voice };
    }
    log.info(`tts ${p.id}: probe failed — ${String(r.error).slice(0, 160)}`);
  }
  return { provider: null, voice: null };
}

/* ── the narration pass ─────────────────────────────────────────────────── */

/**
 * @param {object} script      parsed narration.json
 * @param {object} opts        { tts, voice, rate, force, allowStale }
 * @returns {Promise<{acts: Array, durations: object, provider: string, voice: string}>}
 */
export async function generateNarration(script, opts = {}) {
  ensureDirs();
  mkdirSync(NARRATION_DIR, { recursive: true });
  log.step(`Narration — ${script.acts.length} act(s)`);

  const man = manifest();
  man.clips ??= {};
  const chosen = await pickProvider({ tts: opts.tts, voiceCfg: script.voice });
  const useCache = !chosen.provider || opts.tts === 'cache';
  if (useCache) {
    log.warn(opts.tts === 'cache'
      ? 'using the bundled narration cache (--tts=cache)'
      : 'no TTS engine reachable on this machine — falling back to the bundled narration cache');
  }

  const voice = opts.voice || process.env.DM_TTS_VOICE || chosen.voice || (man.voice ?? null);
  const rate = opts.rate ?? script.voice?.rate ?? null;
  const durations = {};
  const results = [];

  for (const act of script.acts) {
    const text = spoken(act.text);
    const h = hashText(text);
    const file = join(NARRATION_DIR, `${act.id}.mp3`);
    const prev = man.clips[act.id];
    const fresh = prev && prev.hash === h && existsSync(join(NARRATION_DIR, prev.file ?? `${act.id}.mp3`));

    if (fresh && !opts.force) {
      durations[act.id] = prev.duration ?? probeDuration(file);
      results.push({ id: act.id, source: `cache:${prev.provider ?? 'bundled'}` });
      log.info(`  ${act.id.padEnd(16)} reuse (${durations[act.id].toFixed(1)}s)`);
      continue;
    }

    if (useCache) {
      if (!existsSync(file)) {
        if (opts.allowStale) { log.warn(`  ${act.id}: no clip and stale narration allowed — act will be silent`); continue; }
        throw new Error(`no TTS engine available and no bundled clip for act "${act.id}" (${file}).\n`
          + `Install one of: pip install edge-tts · set OPENAI_API_KEY · set ELEVENLABS_API_KEY · espeak-ng\n`
          + `or pass --tts=cache with the clips present.`);
      }
      durations[act.id] = probeDuration(file);
      results.push({ id: act.id, source: 'bundled' });
      log.info(`  ${act.id.padEnd(16)} bundled (${durations[act.id].toFixed(1)}s)`);
      continue;
    }

    const tmp = `${file}.tmp.mp3`;
    rmSync(tmp, { force: true });
    const r = await chosen.provider.synth({ text, out: tmp, voice, rate, voiceCfg: script.voice });
    if (!r.ok) {
      rmSync(tmp, { force: true });
      if (existsSync(file) && opts.allowStale) {
        log.warn(`  ${act.id}: ${chosen.provider.id} failed (${String(r.error).slice(0, 100)}) — keeping the previous clip`);
        durations[act.id] = probeDuration(file);
        results.push({ id: act.id, source: 'stale' });
        continue;
      }
      throw new Error(`TTS failed for act "${act.id}": ${r.error}`);
    }
    renameSync(tmp, file);
    const d = probeDuration(file);
    if (d < 0.4) throw new Error(`TTS produced a suspiciously short clip for "${act.id}" (${d.toFixed(2)}s)`);
    durations[act.id] = d;
    results.push({ id: act.id, source: chosen.provider.id });
    log.info(`  ${act.id.padEnd(16)} ${chosen.provider.id} (${d.toFixed(1)}s · ${text.split(/\s+/).length} words)`);
    man.clips[act.id] = { file: `${act.id}.mp3`, hash: h, provider: chosen.provider.id, voice, duration: d, at: new Date().toISOString() };
  }

  man.provider = useCache ? 'cache' : chosen.provider.id;
  man.voice = voice;
  man.product = script.product;
  man.updated = new Date().toISOString();
  if (!useCache) saveManifest(man);

  writeFileSync(FILES.durations, JSON.stringify({ provider: man.provider, voice, durations }, null, 2));
  const total = Object.values(durations).reduce((a, b) => a + b, 0);
  log.ok(`narration ready — ${Object.keys(durations).length} clip(s), ${Math.round(total)}s of voice [${man.provider}]`);
  return { acts: results, durations, provider: man.provider, voice, totalSeconds: total };
}

/** Durations from a previous pass (used by the recorder before it starts). */
export function readDurations() {
  try { return JSON.parse(readFileSync(FILES.durations, 'utf8')).durations ?? {}; } catch { return {}; }
}
