# Dakshin Marg — SIH demo video (generated from the running system)

**Master:** `Dakshin-Marg-demo.mp4` — 1600×900, 30 fps, narrated (kept out of Git: too large)
**Shareable:** `Dakshin-Marg-demo-720p.mp4` — 1280×720, 30 fps, narrated (committed)
**Narration only:** `Dakshin-Marg-narration.mp3` · **Subtitles:** `Dakshin-Marg-demo.srt`
**Stills for the pitch deck:** `stills/01…10.jpg`

> The video is **not** a mock-up: it is a screen recording of the real
> application, driven end to end by the pipeline in
> [`../../tools/demo-video/`](../../tools/demo-video/README.md) —
> one command (`./make-demo.sh`, `MAKE-DEMO-VIDEO.bat` or `npm run demo:video`)
> boots the three services, opens the site, walks every screen, runs the full
> mission workflow on the real datasets in `data/` (NSIDC sea ice, USNIC
> icebergs, BYU/NIC tracks, Open-Meteo wind), narrates it with TTS and encodes
> this folder. Every number visible on screen came out of the running risk
> engine / optimizer.

---

## 1. Storyboard

Narration is placed automatically from the recorded cue timeline
(`tools/demo-video/work/timeline.json`, rewritten on every take), so
re-recording the visuals never means re-timing the voice.

| Act | Group | On screen | Narration |
|---|---|---|---|
| 00_title | cards | title card — brand, pipeline, data sources | what Dakshin Marg is |
| 01_open | tour | app boots → 3-D polar chart, slow drift, wordmark | why Antarctic resupply needs decision support |
| 02_live | tour | `SIMULATION → LIVE`, LIVE badge, latest analysis date | the real datasets, no keys, no invented data |
| 03_console_tour | tour | nav rail PLAN group: Mission Control · Route Planner · Vessel Profiles, each scrolled | the whole console, no mock screens |
| 04_tour_env | tour | ENV group: Sea-Ice · Icebergs · Weather & Ocean · Risk + map layer list | every layer declares what it is and how old |
| 05_tour_ops | tour | OPS group: Scenario · Verification · Provenance · Alerts · Health | the audit trail |
| 06_seaice | workflow | observation-day scrubber → **+48 h** → σ band → model card | observation vs forecast, uncertainty, backtest |
| 07_icebergs | workflow | catalogue → C18C focus → drift tracks | charted/tracked/moving counts, P90 corridor, archive lag |
| 08_risk | workflow | risk ON · ice class **PC5 → PC7 → NONE → PC5** · *Why this risk?* | IMO POLARIS + Overland + berg zones, worst-case |
| 09_routes | workflow | **Calculate routes** → DIRECT/BALANCED/CONSERVATIVE → details → method | severity ceilings, MSC.1/Circ.1519, fuel NOT COMPUTED |
| 10_mission | workflow | wizard: name, vessel, origin map pick, Bharati, departure, PC5 · 12.5 kn · ceiling LOW | validation against the data window |
| 10b_bridge | workflow | review panel → *Create mission & generate routes* | one profile per ceiling: feasible plan or honest refusal |
| 11_accept | workflow | accept DIRECT → voyage simulation starts | acceptance is a human click |
| 12_underway | workflow | `+12 h` ×2 → conditions at vessel → re-assessment | the system watches the change for you |
| 13_review | workflow | **ROUTE REVIEW REQUIRED** → alternatives → accept CONSERVATIVE | it pauses; the operator decides |
| 14_drill_setup | workflow | deterministic drill: run → stages → accept recommended route | exactly one labelled simulated fact |
| 15_drill | workflow | deviation → conflict → re-plan → **accept new route (GREEN)** | every number from the live engines |
| 16_close | cards | mission event log → end card | honesty summary · "the officer on the bridge decides" |

Wall-clock timecodes land where the recorder's cues say they land; the `.srt`
is generated from the same cues plus each clip's real duration.

## 2. What is simulated in this video

- **All of it is real UI + real engines + the cached real datasets.** The video
  is a screen recording.
- Inside the final act the drill's contract applies unchanged: **exactly one
  fact is simulated** (iceberg D23 re-sighted ~100 km north of its USNIC
  position). The UI labels it `SIMULATED` everywhere it appears, and the payload
  carries `simulated: true` plus a warning.
- The end card states this on screen, so the video cannot be mistaken for
  claiming a live feed.

**Artefact left behind by a take:** `data/missions/missions.json` gains the
mission the video creates (`Bharati resupply — leg 2`, PC5 · 12.5 kn · ceiling
LOW) with its real event log. Open it from the Missions list to replay the run,
or delete it before a live demo if you want a clean list.

## 3. Regenerating

```bash
./make-demo.sh                # full render
./make-demo.sh --short        # core acts only (drops the console tour)
./make-demo.sh --dry          # rehearsal with screenshots, no encode
```

See [`../../tools/demo-video/README.md`](../../tools/demo-video/README.md) for
the whole pipeline: tool resolution, the TTS provider chain (edge-tts → OpenAI →
ElevenLabs → Piper → Windows SAPI → espeak → bundled clips), the warm-up model,
and how to edit the film by editing `tools/demo-video/narration.json`.
