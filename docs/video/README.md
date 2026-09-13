# POLARIS-X — demo video (generated from the running system)

**Master:** `POLARIS-X-demo.mp4` — 1600×900, 30 fps, 7:10, narrated (kept out of Git: 55 MB)
**Shareable:** `POLARIS-X-demo-720p.mp4` — 1280×720, 30 fps, 7:10, narrated (29 MB, committed)
**Narration only:** `POLARIS-X-narration.mp3` · **Subtitles:** `POLARIS-X-demo.srt`
**Stills for the pitch deck:** `stills/01…08.jpg`

> The video is **not** a mock-up: it is a screen recording of the real application driven
> through the shot list in [`../VIDEO_SCRIPT.md`](../VIDEO_SCRIPT.md) in **LIVE mode**, on the
> real datasets in `data/` (NSIDC sea ice, USNIC icebergs, BYU/NIC tracks, Open-Meteo wind).
> Every number visible on screen came out of the running risk engine / optimizer.

---

## 1. Storyboard (timecodes in the master)

| Time | Act | On screen | Narration |
|---|---|---|---|
| 0:00 | Title card | POLARIS-X · OBSERVE → PREDICT → ASSESS → OPTIMIZE → DECIDE | hook |
| 0:05 | Hook | 3-D polar chart, slow drift, LIVE badge | why Antarctic resupply needs decision support |
| 0:33 | LIVE mode | `SIMULATION → LIVE` toggle; LIVE badge + latest analysis date | real datasets: NSIDC · USNIC · BYU/NIC · Open-Meteo |
| 1:02 | Provenance | Map Layers: status chips, age, PLANNED ocean rows | "it says so instead of inventing data" |
| 1:08 | Sea ice | observation day scrubber → **+48 h** forecast → σ uncertainty band → model card | 39.8 % observation; +48 h 42.1 % ± 5.7 %, MAE 4.0 % vs persistence 4.2 % |
| 1:47 | Icebergs | 13 charted · 17 tracked · 5 moving; focus C18C; drift tracks toggled | P90 corridor ±41.9 km @ 7 d; archive lag stated |
| 2:07 | Risk | risk layer ON; ice class **PC5 → PC7 → NONE → PC5**; *Why this risk?* | RIO +10 → −9 → −49; worst-case combination, never averaged |
| 2:54 | Route planner | **Calculate routes** → DIRECT / BALANCED / CONSERVATIVE → details + method | severity ceilings, MSC.1/Circ.1519, fuel **NOT COMPUTED** |
| 3:43 | Mission | wizard: name, map pick, Bharati station, departure, PC5 · 12.5 kn · ceiling LOW, review | data window validated, nothing hardcoded |
| 4:36 | Voyage sim | accept DIRECT → voyage sim → `+12 h` ×2 (T+24 h, 288 nm) → conditions at vessel | vessel moves on the accepted geometry at the optimizer's speed model |
| 5:08 | **ROUTE REVIEW REQUIRED** | alert (primary factor), pause, `Generate alternative routes` → candidates → accept CONSERVATIVE | doesn't reroute on its own; operator decides |
| 6:13 | Re-planning drill | `Run simulation` → 7 stages → D23 deviation → LOW → CRITICAL, 2.5 km → new route GREEN | one labelled simulated fact; every number from the real engines |
| 6:5x | End card | honesty summary | the human decides |

## 2. What is simulated in this video

- **All of it is real UI + real engines + the cached real datasets.** The video is a screen recording.
- Inside the final act, the drill's contract applies unchanged: **exactly one fact is simulated**
  (iceberg D23 re-sighted ~100 km north of its USNIC position). The UI labels it `SIMULATED`
  everywhere it appears, and the payload carries `simulated: true` + a warning.
- The end card states this on screen, so the video cannot be mistaken for claiming a live feed.

## 3. Regenerating / re-recording

The exact pipeline that produced these files is in [`tools/`](tools/):

| File | Role |
|---|---|
| `tools/director.mjs` | Playwright director: warms every heavy endpoint, then drives the app through the shot list with an injected cursor, recording video + a cue timeline (`tools/timeline.json`) |
| `tools/bootstrap.mjs` | Inflates the headless Chromium used in the sandbox (SwiftShader WebGL + fonts) |
| `tools/card_title.html`, `tools/card_end.html`, `tools/cards.mjs` | Title / end cards |
| `tools/assemble.py` | Cuts the warm-up, builds the narration mix from the cue timeline, concats cards, encodes the master, writes the `.srt` |

```bash
# 1 · services (three terminals, or START-POLARIS-X.bat)
python3 -m uvicorn env_data.api:app --host 0.0.0.0 --port 8100      # in python-services/
cd backend && npm run start                                          # :8200
cd frontend && npm run dev                                           # :5173

# 2 · warm caches, then record (≈ 9 minutes wall-clock)
curl -s localhost:8200/api/routes/replan-drill > /dev/null
cd /tmp/vidgen && REC=1 node director.mjs            # writes video/ + timeline.json

# 3 · assemble (needs the narration clips in docs/video/audio/)
python3 assemble.py                                   # → POLARIS-X-demo.mp4 + .srt
```

Notes for a re-record on your own machine: swap `tools/bootstrap.mjs` for
`npx playwright install chromium` and use the real `ffmpeg`; put the three services on
localhost as above; keep the browser window at **1600×900**. The narration is generated from
`../video-script-narration.txt` with one voice, one clip per act — regenerate the clips, then
`assemble.py` places them automatically from the recorded cue times.

## 4. Re-using the narration without re-recording

`POLARIS-X-narration.mp3` (plus the per-act clips in `audio/`) can be laid over your own
screen recording: start each clip at the cue time in `tools/timeline.json`
(`shot01_cue` … `shot10_cue`, seconds from `take_start`), or simply use the whole track with
the `.srt` as the timing reference.
