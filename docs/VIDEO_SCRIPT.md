# Dakshin Marg — Prototype Video Script (LIVE-mode recording)

**For:** Smart India Hackathon demo video · Ministry of Earth Sciences (NCPOR) · Transportation & Logistics
**Recording target:** 6:45 (hard cap 7:00) · **optional 3:00 cut in §8**
**Mode recorded:** **LIVE** — real datasets, real engines. Nothing in this script is a mock-up; every number quoted was read off the running system on 2026-09-13 and is re-verifiable from the API (§5).

> Read §1 and §2 once, do one silent rehearsal with §3, then record. Keep §9 (recovery) open on a second screen while recording.
>
> **This script is now automated.** [`../tools/demo-video/`](../tools/demo-video/README.md)
> records, narrates (TTS) and encodes it in one command (`./make-demo.sh`); the act list in
> `tools/demo-video/narration.json` is this script's shot list, machine-readable. For a
> hand-held take, this document remains the teleprompter.
>
> **A generated version of this script exists** — [`video/`](video/README.md)
> (narrated, LIVE mode, no subtitles, with stills). Use it as the reference take, or re-record
> with your own voice over the same cues.

---

## 1. What the video has to prove (the four things judges check)

1. **Real data, real math.** NSIDC sea-ice concentration, USNIC iceberg positions, BYU/NIC iceberg tracks, Open-Meteo wind/temperature → POLARIS ice-class risk + Overland icing + berg hazard zones.
2. **The full product loop runs:** OBSERVE → PREDICT → ASSESS → OPTIMIZE → DECIDE, on the actual UI, not slides.
3. **Dynamic re-planning works under way** — the route is invalidated by *new conditions*, alternatives are computed from the vessel's position at the current time, and a human accepts.
4. **Data honesty.** One labelled simulated fact in the drill, an explicit data window, refusals instead of guesses ("NOT COMPUTED", "DATA WINDOW END", "NO SAFE ROUTE").

**Never say in this video:** "real-time" / "live satellite feed" (the data window is a historical observation window — 25 Aug → 4 Sep 2026), "safe route" (the product says *lower risk*; MSC.1/Circ.1519 exists because no route is safe), "automatic rerouting" (every accept is a human click), any fuel number, any ETA presented as validated.

---

## 2. Pre-flight (do this 10 minutes before recording)

### 2.1 Start the stack

**Windows (recommended):** double-click **`START-DAKSHIN-MARG.bat`** → opens **http://localhost:4173**. It health-checks all three services and pre-computes the re-planning drill.

**Linux/macOS (three terminals):**

```bash
# 1 · Python scientific service  :8100
cd python-services && python3 -m uvicorn env_data.api:app --host 0.0.0.0 --port 8100
# 2 · Node application API       :8200
cd backend && npm run start
# 3 · Frontend (prod build)      :4173   (dev server: npm run dev → :5173)
cd frontend && npm run build && npm run preview
```

### 2.2 Health + warm-up (do NOT skip — this is your only latency risk)

```bash
curl -s localhost:8100/env/health      # expect {"status":"ok", seaice days 8, icebergs 33 (13 in AOI), weather 264 h}
curl -s localhost:8200/api/health      # expect {"status":"ok","dependencies":{"pythonServices":"up"}}
curl -s localhost:8200/api/routes/replan-drill > /dev/null   # ~6 s: pre-computes the drill
curl -s localhost:8200/api/missions    # confirm your mission list looks the way you want on camera
```

### 2.3 Screen setup

- Browser full screen (**F11**), bookmarks bar hidden, zoom **100 %**, window ≥ 1440×900 (layout is verified from 1280×800 up).
- **Dark theme** (top-right sun/moon button) — best contrast on video and the theme the badges are tuned for.
- Open the app in **LIVE** (top-right toggle) with **no mission open** → the right rail shows *Map Layers → Sea Ice → Icebergs → Navigation Risk → Route Planner → Route Simulation → Wind*.
- Recorder: 1080p30, capture the browser window, mouse cursor visible. Do a 20-second audio + video test before the real take (the UI uses 9–11 px type — check it is readable in the recording, not just on your monitor).
- Silence notifications; close chat/update popups; plug in power.

### 2.4 Tidy the mission list (optional, 1 minute — do it before recording, not during)

The mission list persists (MongoDB if present, otherwise `data/missions/missions.json`). Rename/delete anything named "Test 1" so the camera only shows real-looking missions. Keep "Prydz Bay resupply — demo" (COMPLETED) — it is a good on-camera artefact for "voyages resume and export".

### 2.5 One-take reset (between takes)

1. Right rail → **✕ Close mission workspace** (left rail stays on the mission list).
2. **Delete → Confirm** the mission you created in the take.
3. Drill: if it is mid-run, press **Exit**; press **⟲ RESET** if a voyage simulation is still open.
4. Switch back to **LIVE** and confirm no route lines are left on the chart.

---

## 3. Shot list (this is the running order)

| # | Time | Len | Where | What you do |
|---|------|-----|-------|-------------|
| 1 | 0:00 | 0:22 | Chart, idle | Let the 3-D polar chart breathe; slow drag only |
| 2 | 0:22 | 0:18 | TopBar + chart | Point at **LIVE** toggle, then the **LIVE** badge on the chart |
| 3 | 0:40 | 0:20 | Right rail → **Map Layers** | Hover the status chips; stop on the PLANNED rows |
| 4 | 1:00 | 0:30 | Right rail → **Sea Ice** | Drag *Observation day*, click **+48h**, open *Forecast model* |
| 5 | 1:30 | 0:20 | Right rail → **Icebergs** | Read the counts; click one berg row; toggle *Show forecast tracks* |
| 6 | 1:50 | 0:35 | Right rail → **Navigation Risk** | Toggle risk on; click **PC5 → PC7 → NONE**; open **▸ Why this risk?** |
| 7 | 2:25 | 0:35 | Right rail → **Route Planner** | **Calculate routes** → click DIRECT card → open *Method* |
| 8 | 3:00 | 0:40 | Left rail → **＋ CREATE NEW MISSION** | Wizard: name, vessel, map pick, Bharati, departure, vessel config, **Review mission ▸** |
| 9 | 3:40 | 0:25 | Right rail → **Route Options** | Click DIRECT → **Accept & start voyage simulation** |
| 10 | 4:05 | 0:30 | Bottom **Mission clock** bar | **+12h**, **+12h** — watch *Conditions at Vessel* + *Mission Event Log* |
| 11 | 4:35 | 0:35 | **ROUTE REVIEW REQUIRED** alert | Generate alternatives → compare → **Accept this route** |
| 12 | 5:10 | 0:20 | Right rail → **Route Simulation** | **Run simulation** (already warm) |
| 13 | 5:30 | 0:45 | Drill stepper | Accept → Advance → Advance → **Accept new route** → **✓ New route active** |
| 14 | 6:15 | 0:30 | Wide shot | Close on honesty + human-in-the-loop |

**On-screen labels used above are exact UI strings** (§5 lists the ones you may need to find by eye.)

---

## 4. Shot-by-shot script (narration is word-for-word)

### ACT 1 — Hook and state (0:00 – 1:00)

**Shot 1 · 0:00–0:22 · cold open on the chart**
- DO: nothing. Let the scene settle; drag once, slowly, to show depth (no zooming while talking).
- YOU SEE: 3-D south-polar chart, ice-shelf relief, coastline, graticule, **LIVE** badge.
- SAY:
  > "Every austral summer, India's research stations are resupplied through Antarctic sea ice — where the ice charts are days old, icebergs move, and the ice edge can shift overnight. Dakshin Marg turns open satellite and model data into a risk picture, route options, and a re-planning decision — and it keeps the human in command at every step."

**Shot 2 · 0:22–0:40 · LIVE mode**
- DO: point at the **SIMULATION / LIVE** toggle (top-right, LIVE selected), then at the chart badge.
- SAY:
  > "This is the running system, in LIVE mode. Everything on screen is computed from real datasets — NSIDC sea-ice concentration, USNIC iceberg positions, BYU and NIC iceberg tracks, and Open-Meteo wind and temperature. No API keys, no invented data."

**Shot 3 · 0:40–1:00 · Map Layers = provenance**
- DO: hover the chips in **Map Layers**; pause on the two greyed-out PLANNED rows under the OCEAN group — *Waves / swell* and *Ocean currents*, both hinting `No data source connected`.
- YOU SEE: layer rows with status chips **OBSERVATION / FORECAST / MODEL / PLANNED** plus data age.
- SAY:
  > "Every layer declares what it is and how old it is — observation, model output, or planned. Ocean currents and waves are PLANNED: no data source is connected yet, so the system says so instead of drawing something that does not exist."

### ACT 2 — Real-data reconnaissance (1:00 – 2:25)

**Shot 4 · 1:00–1:30 · Sea Ice + uncertainty**
- DO: in **Sea Ice**, drag **Observation day** one day back and return; click **+48h**; switch on **Show uncertainty**; open **Forecast model**.
- YOU SEE: *Analysis 2026-09-01*, *Mean conc. 39.8 %*; on **+48h**: *Mean conc. 42.1 %*, *Uncertainty ±5.73 %*, the chart badge changes to **SEA-ICE FORECAST +48H** / **UNCERTAINTY +48H**; the details block names the model, the baseline and the backtest MAE.
- SAY:
  > "This is the latest NSIDC daily analysis in our data window — 1 September, mean concentration thirty-nine point eight percent over the corridor. I can step back through eight observation days, or forecast forward. At plus forty-eight hours the damped-trend model gives forty-two percent with an uncertainty band of five point seven percent, and a backtest error of four percent — against four point two for persistence. The badge changes to SEA-ICE FORECAST, because this number is model output, not an observation."

**Shot 5 · 1:30–1:50 · Iceberg intelligence**
- DO: in **Icebergs**, read the three rows; click **C18C** (or any moving berg) to focus it on the chart; toggle **Show forecast tracks**.
- YOU SEE: *Named bergs in area 13 · Tracked 17 · Moving / grounded 5 / 12*, the stale-archive warning, per-berg rows `C18C — 14.0 km/d · ±41.9 km @7d`, solid green observed tracks and violet dashed forecast tracks with a P90 corridor.
- SAY:
  > "Thirteen icebergs are charted in the area; seventeen have real tracks from the BYU database, and five are classified as moving. The drift forecast carries an empirical P90 corridor of about forty-two kilometres at seven days — and the card states openly that the track archive lags real time, which is why current positions come from the USNIC chart."

**Shot 6 · 1:50–2:25 · Risk, and why the vessel changes the answer**
- DO: **Navigation Risk** → **Show navigation risk** ON → click **PC5**, then **PC7**, then **NONE** (leave it on PC5 afterwards, and click PC5 again before moving on). Open **▸ Why this risk?** and leave it open for one beat.
- YOU SEE: *Worst cell in area* severity chip, per-severity extent bars, contributors *Sea ice / Icebergs / Icing*, then the explanation block with **RIO**, **PPR**, zone count and assumptions. Values: PC5 → RIO +10.3, LOW 84.9 % / MED 4.9 % / HIGH 4.5 % / CRIT 5.6 %; PC7 → RIO −9.4, HIGH extent 38.9 %; NONE → RIO −48.9, CRITICAL extent 52.4 %.
- SAY:
  > "Risk is the core product: the IMO POLARIS risk index for sea ice, Overland's icing predictor, and iceberg hazard zones — combined worst-case, never averaged. With a PC5 ice class the worst cell in the area is normal operation: RIO plus ten. Now watch the only thing I change — the vessel. PC7: minus nine, and a quarter of the cells move into the elevated band. No ice class at all: minus forty-nine, and over half the area becomes critical. Same ocean, same data — the vessel changes the answer."

### ACT 3 — Route optimization on the live surface (2:25 – 3:00)

**Shot 7 · 2:25–3:00 · Calculate routes**
- DO: **Route Planner** → **Calculate routes** (wait for the three cards) → click the **DIRECT** card → open the *DIRECT route details* / **Method** disclosure.
- YOU SEE: *Origin: Staging point 60°E · Destination: Bharati approach · Vessel: PC5 · 12.5 kn*; cards **DIRECT — 867 nm · 69.4 h · 19.9 % in high risk... (MEDIUM), RECOMMENDED**, **BALANCED**, **CONSERVATIVE — 998 nm · 79.9 h · LOW**; the *Recommendation* reason citing **MSC.1/Circ.1519 §1.4.5**; a fuel line reading **NOT COMPUTED — no validated fuel-consumption model…**.
- SAY:
  > "For routing, the optimizer does not invent cost weights — it applies severity ceilings as hard constraints. DIRECT is eight hundred and sixty-seven nautical miles, sixty-nine hours, with twenty percent of the route in medium severity. CONSERVATIVE costs a hundred and thirty extra miles to keep the whole route LOW. The recommendation cites IMO circular 1519 — avoid elevated-risk areas when planning. And fuel reads NOT COMPUTED, because no validated consumption model exists. We do not guess numbers we cannot defend."

### ACT 4 — The application flow: mission, voyage, dynamic re-plan (3:00 – 5:10)

**Shot 8 · 3:00–3:40 · Create the mission**
- DO: left rail **＋ CREATE NEW MISSION** →
  1. *Mission name*: `Bharati resupply — leg 2`; *Vessel name*: `MV Vasiliy Golovnin`.
  2. **ORIGIN** → **⌖ Pick on map** → click open water in the Southern Ocean near **57.5°S 60°E** (label becomes *Map point*).
  3. **DESTINATION** → type `bharati` in the station search → click **Bharati · India (NCPOR) · 76.192°E, 69.407°S**.
  4. **DEPARTURE TIME**: `2026-09-02 00:00`, timezone **UTC** → wait for the green tick line.
  5. **VESSEL CONFIGURATION**: type *Research / resupply*, ice class **PC5**, cruise **12.5**, max acceptable severity **LOW**.
  6. Click **Review mission ▸** → read the table → **Create mission & generate routes**.
- YOU SEE: the wizard shows the real availability line `2026-08-25 00:00Z → 2026-09-04 12:00Z`, then `✓ Data available — sea ice: OBSERVATION valid 2026-09-01T12:00Z · weather: OBSERVED_ARCHIVE 2026-09-02T00:00Z`. Any date outside the window is **refused** with the range shown (mention this; do not demonstrate it unless §7.5).
- SAY:
  > "Now the real workflow — a resupply mission. Origin picked on the map, destination Bharati station in Prydz Bay, departure the second of September. The wizard validates the date against the actual data window — the twenty-fifth of August to the fourth of September — and tells me which observation and which weather hour it will use. Ice class PC5, twelve and a half knots, and a deliberately strict ceiling: nothing worse than LOW on the remaining route."

**Shot 9 · 3:40–4:05 · Accept the route**
- DO: in **Route Options** click the **DIRECT** card, read one explanation line, then **Accept & start voyage simulation**.
- YOU SEE: three cards for this departure — all `869 nm · 69.5 h · ● LOW`, DIRECT tagged **RECOMMENDED**; the *Recommendation* block; the state chip changes **ROUTES_GENERATED → IN_PROGRESS**, and the chart badge becomes **VOYAGE SIMULATION · 2026-09-02T00:00Z**.
- SAY:
  > "Three options for that departure time — all eight hundred and sixty-nine miles and LOW at this hour. I take the recommended DIRECT line. Notice that acceptance is a human click: the system never starts a voyage by itself. The vessel now moves along the accepted geometry at the optimizer's own speed model — there is no decorative animation."

**Shot 10 · 4:05–4:35 · Under way**
- DO: on the bottom **Mission clock** bar press **+12h**, pause one beat, press **+12h** again. Point at *Conditions at Vessel* and the *Mission Event Log*.
- YOU SEE: clock `T+24.0h`, `300 nm covered`, vessel position ≈ `61.57°S 64.64°E`, wind/air temperature for the current sim time, event log lines (env updates, state changes). The badge tracks the mission clock.
- SAY:
  > "I advance the mission clock twelve hours at a time. Conditions at the vessel update with the clock — wind, air temperature, nearest ice cell. And every three simulated hours the remaining route is re-assessed against the data valid at that time. This is where the system earns its keep: I do not have to notice the change — the system watches it."

**Shot 11 · 4:35–5:10 · ROUTE REVIEW REQUIRED → re-plan → accept**
- DO: wait for the alert to appear (it fires on the T+24h step, within a second or two) → click **⟳ Generate alternative routes** (2–5 s) → compare the *Candidate Routes* cards with *Active Route* → **Accept this route (replaces current)**.
- YOU SEE: floating alert **▲ ROUTE REVIEW REQUIRED** with *Primary factor*: `Remaining-route severity MEDIUM exceeds the vessel's declared maximum acceptable severity (LOW).` and `Simulation paused… nothing is changed automatically.` Candidates computed **from the vessel's current position at mission time 2026-09-03T00:00Z**: DIRECT 579 nm / 46.3 h MEDIUM, BALANCED 579 nm / 46.3 h, **CONSERVATIVE 570 nm / 45.6 h — smallest exposure — recommended**. After accepting: **ACTIVE ROUTE** switches to CONSERVATIVE, the chart re-draws the line, event log gains `ROUTE_CHANGED`.
- SAY:
  > "There it is — ROUTE REVIEW REQUIRED. The re-assessment found medium severity on the remaining route, which breaks the ceiling the operator set. It names the primary factor, and it pauses. It does not reroute on its own. I ask for alternatives from our current position at the current time. Three candidates; CONSERVATIVE is recommended — five hundred and seventy miles, and the smallest exposure of the three. I accept it: the active route changes, the track restarts from this point, and the decision is written into the mission log with the operator action."

### ACT 5 — The moment: deterministic re-planning drill (5:10 – 6:15)

**Shot 12 · 5:10–5:30 · Set up the drill**
- DO: right rail → **✕ Close mission workspace** (returning the right rail to the LIVE panel) → scroll to **Route Simulation** → point at `Scenario: Iceberg deviation`, `Horizon: +24h` → **Run simulation**.
- YOU SEE: first click returns from cache (it was pre-computed in §2.2); stepper appears with **7 stages**; chart badge becomes **SIMULATION · T+0h**.
- SAY:
  > "For the finale, a repeatable drill. It simulates exactly one fact — iceberg D23 ungrounding and drifting a hundred kilometres north, into our corridor — and it is deterministic: the same document every run. Every route, every risk number, every corridor radius is computed by the same live engines you have just seen."

**Shot 13 · 5:30–6:15 · Step through the drill**
- DO: **Accept recommended route** → **Advance** (T+24h) → **Advance** (SIMULATED D23) → **Advance** (CONFLICT) → **Advance** (REPLAN) → **Accept new route**.
- YOU SEE, stage by stage:
  1. `MISSION_START` — 3 feasible alternatives, DIRECT recommended.
  2. `ROUTE_ACCEPTED` — DIRECT, `869 nm, est 69.5 h, all-LOW corridor`.
  3. `UNDERWAY` — `T+24h · 300 nm covered`, vessel at `−61.569°, 64.6381°`.
  4. `SIMULATED: D23 trajectory deviation` — re-sighted at `−68.625°, 75.75°`, flagged SIMULATED on the chart, the tooltip and the legend.
  5. `Conflict detected — route risk LOW → CRITICAL` — red alert banner: `Route risk increased: LOW → CRITICAL`, `closest approach 2.5 km`.
  6. `RE-PLANNING complete — CONSERVATIVE now recommended` — side-by-side **✕ Current — DIRECT** (severity CRITICAL, was LOW before deviation, D23 at 2.5 km) vs **➜ Proposed — CONSERVATIVE** (`592 nm · 47.4 h · LOW`, `+25 nm vs current remaining`), plus **Why the recommendation changed** (4 points).
  7. `DECISION_PENDING` — **Accept new route** → **✓ New route active**; the chart strikes the old line and draws the new one.
- SAY:
  > "Accept the recommended route. Twenty-four hours at cruise speed: three hundred miles covered — then the simulated re-sighting arrives, and D23 is inside the corridor. The remaining leg goes from LOW to CRITICAL, with a closest approach of two and a half kilometres. Re-planning recommends CONSERVATIVE: five hundred and ninety-two miles, all LOW — twenty-five miles longer than staying put. The why-changed panel gives four reasons, including that the old line would keep one point four percent of the route in critical severity. I accept it — and the new route becomes active."

### ACT 6 — Close (6:15 – 6:45)

**Shot 14 · 6:15–6:45 · wide shot, honesty + human-in-the-loop**
- DO: scroll the event log once, slowly, then stop on the whole screen.
- SAY:
  > "One thing on honesty, because it matters for a decision-support system. Everything in this demo is real open data and real math, with exactly one labelled simulated fact — the berg re-sighting. The system refuses dates outside the data window, refuses horizons beyond seventy-two hours, and reports no safe route when there is not one. Dakshin Marg predicts, assesses and recommends. The officer on the bridge decides. Thank you."

---

## 5. Number cheat-sheet (verified on the running system, 2026-09-13)

Numbers move as the cached datasets move. **If your screen differs, read the screen — never read this sheet over a different value.**

| Thing | Value today |
|---|---|
| Data window | `2026-08-25T00:00Z → 2026-09-04T12:00Z` · 8 sea-ice observation days · forecasts +24/48/72 h · 264 weather hours |
| Sea ice (AOI 40–100°E, 55–72°S) | latest analysis `2026-09-01T12:00Z` · mean **39.8 %** · max 98 % |
| Sea-ice forecast | +24 h: 41.1 %, σ ±3.87 %, MAE 2.54 % (persistence 2.64 %) · **+48 h: 42.1 %, σ ±5.73 %, MAE 4.04 % (persistence 4.24 %)** · +72 h: 42.8 %, σ ±6.89 %, MAE 4.72 % (persistence 5.30 %) |
| Icebergs | 33 in the USNIC chart, **13 in the AOI** · 17 BYU/NIC tracks · **5 MOVING** (C18B, C18C, C39, D15C, D32) · P90 corridor `±41.9 km @7 d` for moving bergs · archive lag ≈ 144 d |
| Risk, PC5 (+24 h surface) | worst RIO **+10.3** (normal operation) · extent LOW 84.9 / MED 4.9 / HIGH 4.5 / CRIT 5.6 % · icebergs + icing CRITICAL contributors · Overland PPR 470 m·°C/s (wind 32 kn / −30 °C) |
| Risk, PC7 | worst RIO **−9.4** (elevated) · 25 % of ocean cells in the elevated band · HIGH extent 38.9 % |
| Risk, NONE | worst RIO **−48.9** (special consideration) · CRITICAL extent 52.4 % |
| Route planner (PC5, 12.5 kn, +24 h) | DIRECT **867 nm · 69.4 h · MEDIUM (19.9 % MEDIUM)** RECOMMENDED · BALANCED same · CONSERVATIVE **998 nm · 79.9 h · LOW** · fuel **NOT COMPUTED** |
| Mission (dep 2026-09-02T00:00Z, PC5, 12.5 kn, ceiling LOW) | 3 profiles, all **869 nm · 69.5 h · LOW** · DIRECT recommended |
| Mission risk check | T+12 h: LOW (no alert) · **T+24 h: MEDIUM (3.1 % MEDIUM) → alert** |
| Mission re-plan @ T+24 h from `−61.57°, 64.64°` | DIRECT / BALANCED **579 nm · 46.3 h · MEDIUM** · **CONSERVATIVE 570 nm · 45.6 h · MEDIUM (98.5 % LOW) RECOMMENDED** |
| Drill constants | PC5 · 12.5 kn · +24 h · origin `−57.5°, 60.0°` → destination `−69.35°, 76.19°` |
| Drill conflict | `LOW → CRITICAL` · D23 closest approach **2.5 km** at route-km 969 · zone P90 28.4 km · 2-day-old fix · MEDIUM 4.4 % + CRITICAL 1.4 % |
| Drill re-plan | **CONSERVATIVE 592 nm · 47.4 h · LOW** · **+25 nm** vs the remaining old line · old line would keep 1.4 % at HIGH/CRITICAL |

**Exact UI strings you may need to find by eye:** `＋ CREATE NEW MISSION`, `⌖ Pick on map`, `Review mission ▸`, `Create mission & generate routes`, `Accept & start voyage simulation`, `⌖ View affected segment`, `⟳ Generate alternative routes`, `▶ Continue current route`, `⇄ Compare routes`, `Accept this route (replaces current)`, `Reject candidates — keep current route`, `Run simulation`, `Accept recommended route`, `Advance`, `Accept new route`, `✓ New route active`, `⤓ Export mission report (.md)`, `✕ Close mission workspace`.

---

## 6. Optional shots (only if you have time, or for jury Q&A afterwards)

Each of these is a left-rail module; click, hold 4–6 seconds, one sentence:

| Module | One-line narration |
|---|---|
| **Vessel Profiles** | "Five vessel configurations with draft, beam and power; ice-class comparison shows why a PC5 and a PC7 see different navigable water." |
| **Scenario / What-If** | "Perturb concentration, ice edge, wind, berg drift; the baseline and the scenario are compared side by side, and weak stability is called out instead of hidden." |
| **Verification / Hindsight** | "The forecast is scored against reanalysis — ME/RMSE and ice-edge error — with the regime-shift caveat printed on the same panel." |
| **Data & Provenance** | "Every product traces back to source, valid time, CRS, resolution and quality, with a lineage chain and stale flags." |
| **Alert Center** | "Critical alerts require acknowledgement; deduplicated, with escalation and an offline queue note." |
| **System Health** | "Twelve services with latency and last-sync; the BYU archive lag shows as DEGRADED rather than being hidden." |
| **╱ Command palette** | Press `/` or ⌘K — "every module and layer is reachable from the keyboard." |

---

## 7. Recovery — what to do if something happens on camera

| Situation | Do this | Say this |
|---|---|---|
| **7.1** First click on **Run simulation** spins ~6 s | It is the one-time compute. Wait, do not click twice. | "The engines are computing the whole timeline now — every stage is pre-computed so the steps are instant." |
| **7.2** The mission alert does **not** fire at T+24 h | Press **+12h** once more (T+36 h). If still nothing, skip to Shot 12 and run the drill as the finale. | "The remaining-route assessment is clean at this hour — the system will raise the review the moment it is not." |
| **7.3** A route comes back **INFEASIBLE** or **NO SAFE ROUTE** | Show it — this is a feature. Point at the blocked constraints. | "When no profile satisfies the ceiling, the system refuses: NO SAFE ROUTE is a valid output, and a false route is not." |
| **7.4** A number differs from §5 | Read the value on screen. | Nothing special — the datasets update; say the number you see. |
| **7.5** You want to show date refusal (10 s, optional) | Wizard → set departure `2026-09-10 00:00` → the wizard refuses. | "Outside the data window it refuses rather than substituting data — and it shows the real available range." |
| **7.6** The Python service dies mid-demo | TopBar shows **DATA FEED · DEGRADED**, chart shows **▲ FEED UNAVAILABLE** + **RETRY**. Click **Retry**; if it stays down, restart the service (or the launcher) and keep recording in SIMULATION mode. | "That is the degradation contract: it tells you the feed is down instead of serving stale numbers silently." |
| **7.7** You mis-click and lose a step | Drill: **Exit** → re-run (deterministic, identical). Mission: **✕ Close mission workspace** → **Resume** on the mission card (checkpointed state returns). | — |
| **7.8** Voyage stops at the end of the data window | Show it: **DATA WINDOW END** + paused clock. | "It refuses to extrapolate past the last real forecast hour — that is where the data ends, so the simulation ends." |

---

## 8. 3-minute cut (if the submission form caps length)

Keep Shots **1, 2, 6, 7, 11, 13, 14** and re-record bridging sentences:

| Keep | From | Why |
|---|---|---|
| Shot 1 + 2 (40 s) | Hook + LIVE state | Establishes real data |
| Shot 6 (35 s) | PC5 → PC7 → NONE | Shows the science responds to the vessel |
| Shot 7 (35 s) | Route planner | Shows the optimizer + honesty on fuel |
| Shot 11 (50 s) | ROUTE REVIEW → re-plan → accept | The real application flow, dynamic re-planning |
| Shot 13 (45 s) | The drill | The dramatic, deterministic moment |
| Shot 14 (25 s) | Close | Data honesty + human decides |

Bridging line for the missing mission-creation shot:
> "A mission is created in three steps — endpoints, a departure time validated against the real data window, and vessel parameters — then routes are generated and a human accepts one."

---

## 9. Appendix — exact commands used on the machine this script was verified on

```bash
# Python deps (verified working install)
pip install fastapi "uvicorn[standard]" numpy pillow rasterio pandas python-multipart

# Service health (paste into a spare terminal; keep it open while recording)
curl -s localhost:8100/env/health
curl -s localhost:8200/api/health
curl -s "localhost:8100/env/availability"          # data window + horizons
curl -s "localhost:8100/env/time/resolve?when=2026-09-02T00:00:00Z"   # what the wizard shows
curl -s "localhost:8200/api/routes/replan-drill" > /dev/null          # warm-up (~6 s)

# The exact numbers quoted in §5 (re-check the morning of the recording)
curl -s "localhost:8100/env/sea-ice?bbox=40,-72,100,-55"
curl -s "localhost:8100/ml/sea-ice/forecast?horizon_h=48&bbox=40,-72,100,-55"
curl -s "localhost:8100/ml/risk/spatial?ice_class=PC5&horizon_h=24"
curl -s -X POST localhost:8200/api/routes/optimize -H 'Content-Type: application/json' \
  -d '{"origin":{"lat":-57.5,"lon":60},"destination":{"lat":-69.35,"lon":76.19},"iceClass":"PC5","cruiseSpeedKn":12.5,"horizonH":24}'
```

**Related documents:** `docs/DEMO_GUIDE.md` (8-minute live walkthrough), `docs/setup-and-demo.md` (setup + limitations), `docs/mission-simulation.md` (what the mission workflow does, feature by feature), `docs/replanning-drill.md` (the drill's real-vs-simulated contract), `docs/implementation-status.md` (authoritative implemented-vs-planned list — read this before answering judge questions).
