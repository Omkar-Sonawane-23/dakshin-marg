# Mission Planning, Voyage Simulation & Dynamic Re-planning

**Task 12 deliverable — written 2026-09-03. All statements verified against the
running system; nothing here describes unimplemented behaviour.**

Status vocabulary: IMPLEMENTED · IN PROGRESS · PLANNED.

---

## A. Feature summary

| Feature | Status | Where |
|---|---|---|
| Mission creation wizard (origin/destination via map click, station search, station/approach list, manual lat-lon) | IMPLEMENTED | `frontend/src/components/mission/MissionWizard.tsx` |
| Departure date + time + timezone, validated against the *actual* environmental data window; out-of-range dates are refused with the real available range shown — never silently substituted | IMPLEMENTED | wizard + `GET /env/time/resolve` |
| Vessel configuration (name, type, POLARIS ice class, cruise/max speed, max acceptable route severity). No hardcoded values enter route computation | IMPLEMENTED | wizard → mission document |
| Fuel model | PLANNED | No validated consumption model exists; every fuel field reads "Not calculated" |
| Mission review screen with [Edit mission] / [Create mission & generate routes] | IMPLEMENTED | wizard step 2 |
| ≥3 route options (DIRECT / BALANCED / CONSERVATIVE) with distance, est. time, ETA, overall severity, exposure fractions (sea ice / bergs / icing), plain-language reason; infeasible profiles are reported as INFEASIBLE, not hidden | IMPLEMENTED | `POST /api/missions/:id/routes` → Python optimizer |
| Mission workspace (header: mission · vessel · O/D · departure · sim clock · state; right rail: active route, conditions at vessel, remaining-route risk, event log; bottom: time controls) | IMPLEMENTED | `MissionWorkspacePanel.tsx`, `MissionTimeBar.tsx` |
| Time simulation: ◀ / PLAY / ⏸ / steps +15m +1h +3h +6h +12h / RESET; speeds 1×/10×/50×/100×; mission clock + elapsed | IMPLEMENTED | `missionStore.tsx` (position is a pure function of route geometry, effective speed and elapsed sim time — no random animation) |
| Time-indexed environmental refresh (nearest sea-ice observation/forecast day, nearest weather hour) as sim time advances | IMPLEMENTED | re-assessed every 3 simulated hours |
| Hard stop at the end of the real data window: "Forecast unavailable beyond [actual time]" + pause; never silent stale data | IMPLEMENTED | verified 2026-09-03 (shot: departure 04T00:00Z, paused at 04T12:00Z) |
| Dynamic re-planning: remaining-route severity re-assessed under way; ROUTE REVIEW REQUIRED alert with primary factor and operator actions; replan runs from *current vessel position at current sim time*; candidates shown with trade-offs; operator accepts or rejects — never auto-applied | IMPLEMENTED | `POST /api/missions/:id/replan` |
| Mission event log generated from real application state (creation, validation, route generation, acceptance, env updates, risk alerts, replan, route change, pause/resume, data-window end, arrival, rename) | IMPLEMENTED | server-side `pushEvent` + client `appendEvents` |
| Mission states DRAFT → READY → ROUTES_GENERATED → IN_PROGRESS ↔ ROUTE_REVIEW_REQUIRED ↔ RE_PLANNING ↔ PAUSED → COMPLETED / CANCELLED, visible in the header | IMPLEMENTED | state chip in TopBar + mission cards |
| Mission save / rename / reopen / resume / delete / export report (.md) | IMPLEMENTED | MongoDB when available, automatic file-backed fallback (`backend/data/missions/missions.json`); the UI displays which backend is active |
| Grouped environmental layer control (BASE / SEA ICE / ICEBERGS / ATMOSPHERE / OCEAN / NAVIGATION) with one primary raster at a time | IMPLEMENTED | `EnvLayerControl.tsx` |
| Per-layer status chips (OBSERVATION / FORECAST / MODEL / PLANNED) + data age; delayed data is never labelled "LIVE" | IMPLEMENTED | |
| Value-at-cursor probe over the active raster (concentration %, ±σ, or risk severity) | IMPLEMENTED | `AntarcticMap.tsx` |
| Route-risk contribution panel (used-in-risk vs analysis-only vs not-in-model) | IMPLEMENTED | see §E |

## B. Mission workflow (as built)

1. **CREATE NEW MISSION** (left rail, LIVE mode) opens the wizard.
   Origin/destination each accept: ⌖ PICK ON MAP (map click fills lat/lon),
   station search, the station/approach list (out-of-domain stations such as
   Maitri and Syowa are shown disabled with the reason), or manual lat/lon.
2. **Departure time** — any date/time+timezone. The wizard displays the actual
   data window (currently 2026-08-25T00:00Z → 2026-09-04T12:00Z) and the
   backend re-validates: outside the window it refuses with
   `Environmental data is unavailable for this date. Available range: […]`.
3. **Vessel configuration** — type, POLARIS ice class (PC1–PC7 + below),
   cruise/max speed (validated 3–30 kn), max acceptable route severity
   (LOW/MEDIUM/HIGH). These parameters flow into the optimizer and risk engine;
   nothing is hardcoded.
4. **MISSION REVIEW** — full read-back with [Edit mission] and
   [Create mission & generate routes].
5. **Route options** — three profiles per mission from the Python optimizer
   using environmental data resolved for the *mission departure time*. Each
   card: distance, est. time (POLARIS Table 1.2 speed limits applied per cell),
   ETA, overall severity, exposure fractions, uncertainty note when a forecast
   horizon is used, fuel "Not calculated", and the reason the profile differs.
   Language is "lower risk / higher exposure" — the word "safe" is not used.
6. **Accept & start voyage simulation** — the workspace becomes the active
   view; the vessel moves along the accepted geometry at the route's effective
   speed. Conditions at the vessel (wind, air temperature, nearest-cell ice)
   are re-read for the current sim time.
7. **Under way** — remaining-route risk is re-assessed every 3 simulated hours.
   If severity exceeds the vessel's declared maximum, or a tracked berg
   encounter reaches HIGH, the sim pauses with ROUTE REVIEW REQUIRED and the
   primary factor. Operator actions: view affected segment, generate
   alternatives from the current position/time, compare, continue current
   route, or accept a replacement (which restarts the leg from the replan
   point — verified: accepted 683 nm replacement replaced the 775 nm plan in
   the ACTIVE ROUTE panel and survived close/reopen).
8. **Arrival** — the vessel reaching the destination logs MISSION_COMPLETED
   and sets state COMPLETED (verified with the Prydz Bay demo mission).
9. Missions can be closed, renamed, resumed (simulation checkpoint restored,
   including mid-leg replan state) and exported as a Markdown report.

## C. API changes (Node application API, all under `/api/missions`)

| Endpoint | Purpose |
|---|---|
| `GET /api/missions` | List (id, name, state, vessel, dep, simTime, event count) + active persistence backend |
| `POST /api/missions` | Create; validates fields and departure time against `/env/time/resolve`; 422 `TIME_OUT_OF_RANGE` includes the actual window |
| `GET /api/missions/:id` | Full mission document |
| `PATCH /api/missions/:id` | Rename (`name`), state transition (`state`+`simTime`), `activeProfile`, accepted replan (`routePlan` envelope stored verbatim), simulation checkpoint (`simulation` incl. `legStartSimTime`/`legStartDistanceNm`), `appendEvents[]` |
| `DELETE /api/missions/:id` | Delete |
| `POST /api/missions/:id/routes` | Generate route options for mission departure time from mission origin |
| `POST /api/missions/:id/replan` | `{position, simTime}` → candidate plan from current vessel position at current sim time; candidates are returned, **not** applied |

Python service additions: `GET /env/availability` (real data window),
`GET /env/time/resolve?when=` (nearest sea-ice day / weather hour or 422),
and `missionTime` + `bergOverrides` parameters on `/route/optimize` and
`/risk/route`.

## D. Data model changes

`MissionDoc` (MongoDB collection `missions`, or file fallback):
`id, name, state, createdAt, updatedAt, vessel{name,type,iceClass,cruiseSpeedKn,
maxSpeedKn,maxAcceptableSeverity,fuelModel:'NOT_AVAILABLE'}, origin{lat,lon,label},
destination{...}, departureUtc, forecastHorizonH, routePlan (verbatim Python
envelope), activeProfile, simulation{simTime,elapsedH,distanceCoveredNm,
vesselPos,completed,legStartSimTime,legStartDistanceNm}, events[]`.

The `legStart*` checkpoint fields are what make replan-resume correct: after an
accepted replacement route, the leg no longer starts at the mission origin, so
resume reconstructs the leg from the persisted leg start rather than guessing.

Persistence: MongoDB if reachable at startup, otherwise an atomic-write JSON
file store. The frontend shows `PERSISTENCE: …` so the operator always knows.
A 10-second background checkpoint keeps simulation progress durable while a
mission is open.

## E. Environmental layer matrix

| Group / layer | Status chip | Data source | In risk model? |
|---|---|---|---|
| BASE · Graticule | OBSERVATION | computed | — |
| BASE · Coastline & ice shelves | OBSERVATION | Natural Earth 1:50m | — (always shown) |
| SEA ICE · Concentration | OBSERVATION + age | NSIDC Sea Ice Index v4, daily | **Yes** (POLARIS RIO) |
| SEA ICE · Forecast uncertainty ±σ | MODEL | backtest MAE per horizon | Analysis only |
| ICEBERGS · Charted positions | OBSERVATION + age | USNIC named bergs ≥10 nm | **Yes** (hazard zones) |
| ICEBERGS · Tracks & drift forecasts | MODEL | BYU/NIC history + validated predictor | Analysis only (trajectory encounter check uses predictor) |
| ATMOSPHERE · Wind field 10 m | OBSERVATION + age | Open-Meteo hourly | **Yes** (Overland icing) |
| ATMOSPHERE · Air temperature 2 m | OBSERVATION | Open-Meteo (same cells; readouts, not mapped) | **Yes** (Overland icing) |
| OCEAN · Waves/swell | PLANNED | **No data source connected** | No — and the UI says so |
| OCEAN · Ocean currents | PLANNED | **No data source connected** | No |
| NAVIGATION · Risk severity surface | MODEL | POLARIS + icing + berg zones | Is the model output |

Rules enforced in the UI: exactly one raster (sea ice XOR risk) is primary at a
time; the legend always matches the primary raster with correct units; PLANNED
layers cannot be enabled; status chips never read "LIVE" for delayed data —
they show the observation/forecast type plus age.

## F. Honest missing-data report

- **No wave, swell, or current data** — no free authenticated-less source was
  integrated; layers exist as disabled PLANNED rows and contribute nothing.
- **No fuel model** — fuel is everywhere "Not calculated".
- **Iceberg track archive lags real time by ~134 days** (BYU/NIC consolidated
  DB v8); current *positions* come from USNIC weekly charts. The UI states this.
- **Sea-ice forecasts extend +72 h only**, with per-horizon MAE from backtest
  (2.54/4.04/4.72 % vs persistence 2.64/4.24/5.30 %). Beyond the window the
  simulation refuses to continue rather than extrapolating.
- **Smaller ice (< 10 nm bergs, growlers, bergy bits) is not charted** — route
  reasons say "route crosses no *charted* iceberg hazard zone".
- Sentinel-1 SAR detection was validated on a labelled **simulated** scene
  (Copernicus requires auth); it is labelled as such everywhere it appears.

## G. Testing report (executed 2026-09-03, Playwright + API checks)

| Test | Result |
|---|---|
| Mission creation: map pick, station list, search, manual entry | PASS (map click filled −62.595/65.591) |
| Departure outside data window | PASS — 422 with actual range; wizard shows it; nothing substituted |
| Route generation (3 profiles, infeasible reported) | PASS (Enderby PC5: DIRECT 775 nm HIGH, CONSERVATIVE INFEASIBLE at LOW ceiling) |
| Accept → voyage sim; vessel follows geometry; conditions update | PASS |
| Steps, speeds, PLAY/pause, RESET | PASS |
| Data-window end | PASS — paused at 2026-09-04T12:00Z with explicit message + DATA_WINDOW_END event |
| Risk alert → replan from current position → accept replacement | PASS — ACTIVE ROUTE panel switches to the replacement (683 nm), leg restarts at replan point (required a Node restart to pick up the PATCH routePlan handler + persisted leg-start fields; both verified after fix) |
| Reject candidates / continue current route | PASS (events logged) |
| Save / close / rename / resume (incl. mid-replan checkpoint) | PASS — resume restores sim clock, position and replacement plan; missions accepted but never checkpointed re-arm at departure |
| Arrival → COMPLETED | PASS (Prydz demo mission) |
| Export mission report (.md) | PASS — real state + full event log |
| Layer control: primary-raster exclusivity, PLANNED rows disabled, chips + age, contribution panel | PASS |
| Legend correctness per primary raster | PASS |
| Value-at-cursor probe | PASS |
| DEMO mode untouched | PASS |
| Dark + light themes | PASS |
| Responsive 1280×800 | PASS |
| `tsc` (frontend+backend) and `npm run build` | PASS (build 598 kB / 182 kB gzip) |

Known limitation: the periodic checkpoint means at most ~10 s of simulated
progress can be lost on abrupt browser close.
