# Dakshin Marg — one-click SIH demo video

This directory is a **complete, re-runnable pipeline** that produces the
Smart-India-Hackathon demo video *from the running application*: it starts the
three services, opens the web app in a real browser, scrolls and clicks through
every screen, records the session, narrates it with text-to-speech, and encodes
the final MP4 + subtitles.

One command, on any machine:

```bash
./make-demo.sh                 # Linux / macOS
MAKE-DEMO-VIDEO.bat            # Windows (double-click)
npm run demo:video             # anywhere Node runs
```

Outputs (written into `docs/video/`):

| File | What |
|---|---|
| `Dakshin-Marg-demo.mp4` | master render — 1600×900, 30 fps, narrated (git-ignored, big) |
| `Dakshin-Marg-demo-720p.mp4` | shareable submission cut — 1280×720 (committed) |
| `Dakshin-Marg-narration.mp3` | the voice track alone (git-ignored) |
| `Dakshin-Marg-demo.srt` | subtitles, paced from the real audio (committed) |
| `stills/*.jpg` | pitch-deck stills captured during the take (committed) |

Scratch (raw webm, cards, intermediates, logs) lives in `tools/demo-video/work/`
and is git-ignored.

---

## 1. What one click actually does

```
preflight → narration → services → record → assemble
```

**preflight** finds or installs every external tool and prints exactly which
source won:

| Tool | Tried, in order |
|---|---|
| ffmpeg | `$DM_FFMPEG` → `ffmpeg` on PATH → Python wheel `imageio-ffmpeg` (PyPI, bundles a static build) → npm `ffmpeg-static` |
| Chromium | `$DM_CHROMIUM` → Playwright's installed browsers → `npx playwright install chromium` → system Chrome/Edge/Chromium → npm `@sparticuz/chromium` (brotli-packed, for sandboxes/CI without browser downloads) |
| Python deps | `python-services/.venv` if present, else created + `pip install -r requirements.txt` |
| Node deps | `frontend/`, `backend/` and this tool; a Windows-installed `backend/node_modules` is detected and worked around with a tool-local `tsx` |

On-demand packages are installed into `tools/demo-video/.extras/` (git-ignored)
so a bare clone never has its tree pruned or polluted.

**narration** synthesises one clip per act of `narration.json` with the first
TTS engine that passes a probe synthesis:

1. `edge-tts` — Microsoft neural voices, free, no key (default voice
   `en-IN-NeerjaNeural`; needs internet)
2. `openai` — `OPENAI_API_KEY`, model `gpt-4o-mini-tts`
3. `elevenlabs` — `ELEVENLABS_API_KEY`
4. `piper` — local neural TTS (`DM_PIPER_MODEL=/path/voice.onnx`)
5. `sapi` — Windows System.Speech (offline)
6. `espeak` — espeak-ng (offline)
7. **cache** — the clips committed in `tools/demo-video/narration/`

Clips are cached by a hash of their text: editing one narration line
re-synthesises only that line. If *no* engine is reachable (air-gapped CI, this
kind of sandbox), the committed clips are used so the render still completes.

**services** starts `:8100` (Python scientific/ML API), `:8200` (Node
application API) and `:5173` (vite) health-gated, reusing anything already
running instead of killing it, then warms the server-side caches
(re-planning drill) so the recording never shows a spinner.

**record** drives a Playwright browser through the shot list:

- an off-camera **warm-up** exercises every heavy computation (LIVE feeds, +48 h
  forecast, three ice-class risk surfaces, the A\* optimizer, the mission path,
  the deterministic drill) — the take then runs at UI speed;
- the take **opens the site fresh** so the viewer sees it boot, then walks the
  whole console (every nav-rail section, each panel scrolled top to bottom),
  then runs the real workflow end to end (sea ice → icebergs → risk → routes →
  mission wizard → accept → voyage sim → ROUTE REVIEW REQUIRED → re-plan →
  drill → accept);
- each act is held for **at least its narration length**, so the voice can
  never overrun into the next act, and every cue time is written to
  `work/timeline.json` — the single source of truth for audio placement;
- a soft cursor with a click ripple is injected so clicks are visible on
  camera; the theme is pinned to mission-control dark for a deterministic look.

**assemble** renders the title/end cards, trims the warm-up, concatenates
`title → take → end`, mixes the narration at the recorded cue times, writes the
`.srt` (paced from each clip's real duration), and encodes the master plus the
720p cut with `+faststart`.

---

## 2. Editing the film

Everything editorial lives in **`narration.json`** — no code changes needed:

```jsonc
{
  "id": "08_risk",            // cue name: recorded as `08_risk_cue`
  "group": "workflow",        // cards | tour | workflow
  "core": true,               // kept by --short
  "screen": "…",              // what the viewer should see (documentation)
  "beat": "…",                // the choreography note (documentation)
  "text": "Risk is the core product: …"   // spoken, subtitled, and timed
}
```

- Changing `text` changes the voice, the subtitles and the act's screen time.
- The matching choreography is a function named after the act id in
  `src/recorder.mjs`; an act with no function gets a generic "scroll the panel"
  pass, so new narration-only beats work with zero code.
- `--short` keeps only `core` acts (≈ 2 minutes shorter); `--acts=` selects by
  id or group, e.g. `--acts=tour` or `--acts=06_seaice,08_risk`.

Useful invocations:

```bash
./make-demo.sh --dry                    # rehearsal: screenshots, no encode (~2 min/act-group)
./make-demo.sh --only=narration         # just (re)synthesise the voice
./make-demo.sh --only=record --url=http://localhost:5173/   # record an app you started yourself
./make-demo.sh --only=assemble          # re-cut from the last recording
./make-demo.sh --tts=edge-tts --voice=en-IN-NeerjaNeural
./make-demo.sh --tts=openai --voice=nova
./make-demo.sh --frontend=preview       # record the production build on :4173
./make-demo.sh --no-share               # master only, skip the 720p cut
```

Debugging a failing act: the take never aborts on a step error — it marks the
cue `*_ERROR`-free, logs `act <id> failed (continuing)` and moves on;
`--dry` plus `work/shots/*.png` shows what the selectors saw.

---

## 3. Files

```
tools/demo-video/
├── bin/make-demo.mjs        # CLI: parses flags, runs the stages in order
├── bin/check-browser.mjs    # browser/WebGL smoke test → work/shots/smoke.png
├── narration.json           # the script: acts, narration text, groups
├── narration/               # committed voice clips + manifest.json (offline fallback)
├── src/
│   ├── config.mjs           # paths, ports, pacing, script loader
│   ├── preflight.mjs        # ffmpeg / chromium / python / node resolution
│   ├── services.mjs         # start · health-gate · warm · stop
│   ├── tts.mjs              # provider chain + clip cache + durations
│   ├── recorder.mjs         # the director (warm-up, tour, workflow, cues)
│   ├── assemble.mjs         # cards · concat · narration mix · srt · 720p
│   └── cards/               # title.html, end.html ({{PRODUCT}} substituted)
└── work/                    # scratch (git-ignored)
```

The previous ad-hoc recording scripts that lived in `docs/video/tools/`
(`director.mjs`, `assemble.py`, `bootstrap.mjs`, `cards.mjs`) were replaced by
this pipeline; `docs/video/README.md` now documents only the outputs.
