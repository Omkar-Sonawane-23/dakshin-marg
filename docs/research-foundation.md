# Dakshin Marg — Research Foundation & Scientific Decision Record

**Status of this document:** written 2026-09-03, *after* the prototype was built and
backtested. It is therefore a **decision record with evidence**, not a proposal: where the
prompt asks "which approach should we choose?", we report the approach we chose, why, what
we measured, and what we would change at the next maturity level.

**Epistemic labelling used throughout:**

| Tag | Meaning |
|---|---|
| `FACT` | Established public knowledge or a primary-source document we actually read |
| `MEASURED` | A number produced by our own code on real data, reproducible from this repo |
| `ASSUMPTION` | An engineering assumption we made consciously; plausible but not validated |
| `PROPOSED` | A methodology we invented for the prototype; requires expert validation |
| `UNKNOWN` | Something we could not determine without operational data or domain experts |

We do **not** cite papers we have not read. Primary sources actually consulted are listed in
§18. No accuracy or safety claim in this document goes beyond what our own backtests show.

---

## 1. The problem statement, explained twice

### 1.1 Plain language

India runs Antarctic research stations (Maitri, Bharati) supplied by ship through some of
the most dangerous water on Earth. The captain of a resupply vessel faces three moving
hazards at once: **sea ice** (can trap or crush a hull), **icebergs** (thousands of them,
some drifting several km per day), and **weather** (spray at sub-zero temperatures freezes
onto the ship and can capsize it). Today these hazards are assessed largely by hand from
separate data feeds. The problem statement asks for one system that watches all three,
predicts where they are going, converts them into a single navigational risk picture, and
proposes safer routes — while leaving every decision to the human operator.

### 1.2 Technical statement

Given heterogeneous geophysical inputs — passive-microwave sea-ice concentration rasters
(daily, 25 km), analyst-tracked iceberg positions (weekly), and NWP surface weather
(hourly) — over an area of interest in East Antarctica, the system must:

1. **OBSERVE** — ingest, validate and normalize the feeds onto a common grid and time base;
2. **PREDICT** — produce short-horizon (24–72 h) forecasts of ice concentration and
   iceberg displacement, each with quantified uncertainty;
3. **ASSESS** — map the combined state onto a navigational-risk field using recognized
   frameworks (IMO POLARIS for ice, an icing predictor for weather, empirical exclusion
   zones for bergs);
4. **OPTIMIZE** — search that risk field for feasible routes under a severity ceiling and
   rank them by explicit, explainable criteria;
5. **DECIDE** — present options, evidence and uncertainty to a human operator who accepts
   or rejects. The system never acts autonomously.

Constraints: decision support only; every simulated datum labelled; deterministic demo
mode; every recommendation explainable in the UI.

---

## 2. Component breakdown and pipeline

| # | Component | Status in prototype |
|---|---|---|
| A | Data ingestion & validation (NSIDC, USNIC, Open-Meteo, BYU/NIC) | IMPLEMENTED |
| B | Sea-ice concentration forecasting (damped anomaly trend + backtest) | IMPLEMENTED |
| C | Iceberg detection (SAR pipeline, validated on labelled simulated scene) | IMPLEMENTED (simulated input) |
| D | Iceberg tracking (identity association across sightings) | IMPLEMENTED |
| E | Iceberg trajectory forecasting (damped drift + empirical error corridor) | IMPLEMENTED |
| F | Navigation risk engine (POLARIS + Overland icing + berg hazard zones) | IMPLEMENTED — `PROPOSED` combination |
| G | Route optimization (severity-ceiling A*, three profiles) | IMPLEMENTED |
| H | Decision UI (map-centric command center, drill, explainability) | IMPLEMENTED |

Pipeline: `A → B, A → C → D → E` in parallel; `B + E + A(weather) → F → G → H`. Every arrow
is an HTTP contract between the Python scientific service (:8100), the Node application API
(:8200) and the React frontend; data crossing each arrow carries a provenance envelope
(`OBSERVED / HISTORICAL / FORECAST / MODEL_FORECAST / SIMULATED`) so that origin is never
lost downstream. This provenance chain is the single most important architectural decision
in the system: it is what makes the "never mix simulated with real" rule enforceable in
code rather than by discipline.

---

## 3. Dataset research

### 3.1 Evaluation criteria applied

For each candidate we assessed: physical variable & units; spatial/temporal resolution;
latency; coverage of the Prydz Bay corridor; access mechanism (auth? rate limits?);
format; documentation quality; license; and *prototype ingestibility* (can a hackathon
team actually wire it in days).

### 3.2 What we evaluated and what we verified

`FACT` (verified by ingestion, not just reading docs):

| Dataset | Variable | Resolution | Latency | Access | Verdict |
|---|---|---|---|---|---|
| **NSIDC Sea Ice Index v4 (G02135)** | SIC (passive microwave) | 25 km, daily | ~1 day | HTTPS, no auth | **USED** — primary ice feed |
| **USNIC current icebergs CSV** | Named bergs ≥10 nm, analyst positions | point, weekly | days | HTTPS, no auth | **USED** — current berg positions |
| **BYU/NIC consolidated iceberg DB v8** (DOI 10.1109/JSTARS.2017.2784186) | Historical berg tracks (scatterometer+NIC) | point, ~daily obs | archive (ends ~134 d before today) | HTTPS zip, no auth | **USED** — tracking/backtest corpus |
| **Open-Meteo forecast API** | 10 m wind, 2 m temp | ~11 km, hourly | real-time | HTTPS, no key | **USED** — weather + icing input |
| **Copernicus Sentinel-1 SAR** | C-band backscatter | 40 m | hours–days | **auth required** | **NOT USED live** — detector validated on a labelled simulated scene instead, and said so |

`FACT` (evaluated from documentation only, not ingested):

| Dataset | Why not in MVP |
|---|---|
| AMSR2 (e.g. U. Bremen 6.25 km SIC) | Higher resolution, but adds a second grid + format for marginal MVP gain |
| Copernicus Marine (GLORYS/analysis, currents) | Would materially improve berg drift physics; access + volume beyond MVP window |
| ERA5 reanalysis | Best-quality historical forcing for validation; CDS auth + queue latency |
| Antarctic bathymetry (GEBCO/IBCSO) | Needed for grounding prediction; not needed for a concentration-level MVP |

### 3.3 Recommended stacks

- **MVP (what we built):** G02135 + USNIC + BYU/NIC + Open-Meteo. Zero auth, zero cost,
  fully scriptable, covers all three hazards. Weakness: 25 km SIC cannot see leads or the
  marginal ice zone structure; berg positions lag reality.
- **Stronger demo:** add AMSR2 6.25 km SIC and Copernicus Marine surface currents (bergs
  drift mostly with current, `FACT` per the drift literature consensus; our MVP proxies
  this with per-berg historical motion instead).
- **Research-grade:** Sentinel-1 SAR for detection and ice-edge delineation, ERA5 for
  hindcast forcing, IBCSO bathymetry for grounding, and an ice-charting service (e.g.
  national ice service SIGRID-3 charts) as the authoritative ice-class input to POLARIS.

`ASSUMPTION`: for a corridor-scale (hundreds of km) decision-support prototype, 25 km SIC
is coarse but not misleading. For tactical navigation (ship-scale, leads, ridging) it is
categorically insufficient — no claim of tactical utility is made anywhere in the product.

---

## 4. Is "sea-ice concentration" the right variable?

Short answer: **it is the right *first* variable, and it is not sufficient.**

- `FACT` POLARIS risk values are indexed by **ice type/age (development stage)**, not by
  concentration alone. Concentration enters as the per-type partial concentration C_i in
  RIO = Σ(C_i × RIV_i).
- What we did: our LIVE risk engine maps SIC plus climatological context to a conservative
  ice-type assumption before applying POLARIS RIVs. `PROPOSED` — this mapping is our
  own construction, is labelled as such in the UI ("derived"), and is the single largest
  scientific approximation in the system.
- What the variable list should be at the next level: ice **stage of development**
  (SIGRID-3 charts), ice **thickness** (SMOS/CryoSat, or model), **drift** vectors
  (OSI SAF), floe size / ridging where available. `UNKNOWN`: which of these NCPOR can
  access operationally with what latency — a question for domain experts (§20).

---

## 5. Sea-ice forecasting approach

**Baseline-first discipline.** We implemented, in order: (1) persistence; (2)
climatological anomaly persistence; (3) **damped anomaly trend** (chosen); and rejected
deep learning for this prototype.

- `MEASURED` — walk-forward backtest, real G02135 grids, AOI 40–100°E / 55–72°S,
  MAE in concentration % (lower is better):

| Horizon | Persistence | Damped trend (ours) |
|---|---|---|
| 24 h | 2.635 | **2.543** |
| 48 h | 4.236 | **4.036** |
| 72 h | 5.297 | **4.719** |

  A ~3–11 % improvement over persistence is modest and honestly reported as such; the
  value of the model is as much its calibrated per-cell σ (driving the uncertainty layer)
  as its mean skill.
- **Why not deep learning:** with one daily grid and a validation protocol that forbids
  temporal leakage, we had ~8 usable samples per cell in the training window.
  `FACT` (about our own setup): that sample count cannot train a deep model; it can only
  overfit one. A ConvLSTM/U-Net becomes defensible with multi-year archives (our roadmap
  §19 places it in phase 8, after an ERA5/AMSR2 archive is assembled).
- `ASSUMPTION`: 72 h is the longest horizon at which a damped local trend is a sensible
  model; beyond that, dynamics (advection, thermodynamics) dominate and our σ estimates
  would be misleadingly small.

---

## 6. Iceberg: detection vs classification vs tracking vs trajectory

Four distinct problems, deliberately decoupled:

1. **Detection** (is there a berg in this image?) — implemented as a classical CFAR-style
   pipeline for SAR backscatter. Because Sentinel-1 requires auth we validated it on a
   **labelled simulated scene** and the UI never presents its output as real.
2. **Classification** (what kind of object?) — **descoped**. `ASSUMPTION`: for corridor
   planning, "berg vs not-berg with size estimate" is sufficient; ship/berg discrimination
   matters for true SAR operations and is future work.
3. **Tracking** (same berg across sightings?) — implemented over the BYU/NIC + USNIC
   corpus: per-name association with gating on maximum plausible displacement, moving vs
   grounded classification from displacement statistics. 17 bergs in the AOI, 7,738
   observations. `MEASURED`.
4. **Trajectory forecasting** — see §8.

Comparison logic for tracking methods: full multi-target trackers (JPDA/MHT) solve the
association ambiguity problem, but our input is *analyst-curated and already named* —
ambiguity is largely pre-solved upstream. `FACT` about the data, so the simplest
defensible method (gated nearest-association per name, with QC rejection of >max-speed
jumps) is the right tool. A learned or probabilistic tracker would add complexity with no
measurable benefit *on this input*; it becomes necessary the day raw detections replace
named sightings.

---

## 7. Tracking method — recommendation

**Recommended (and used): gated per-identity association with kinematic QC.**
Rejected for MVP: Kalman-filter-per-berg (adds a motion model we cannot validate at weekly
cadence), JPDA/MHT (solves a problem our curated input does not have), deep re-ID
(no training data). The honest framing: our tracker's job is mostly *data cleaning* —
duplicate sightings, lon>180 wraps, (0,0) sensor artifacts, '#'-locked files — and the
value came from QC rigor, not from estimator sophistication.

---

## 8. Trajectory modeling — staged

- **MVP (built): damped-drift extrapolation.** Each moving berg's recent velocity is
  damped toward its long-run mean; grounded bergs are forecast stationary. Uncertainty is
  **not** a formula: it is the **walk-forward empirical error corridor** — we replayed the
  real track archive, forecast each historical position blind, and measured displacement
  error quantiles. `MEASURED` P50/P90 forecast error for moving bergs:
  1.18/10.36 km @1 d · 2.20/21.95 km @3 d · 2.09/41.92 km @7 d.
  The map's uncertainty rings are exactly these quantiles. No invented confidence values.
- **Advanced:** force-balance drift model (water drag from ocean currents, air drag from
  wind, Coriolis) forced by Copernicus currents + NWP wind. Needs per-berg mass/draft
  assumptions (`UNKNOWN` without thickness data).
- **Research-grade:** ensemble physics with data assimilation of sightings, giving
  flow-dependent corridors instead of climatological quantiles.

`ASSUMPTION` worth flagging: our corridor quantiles pool all moving bergs; a per-berg or
per-region decomposition would be better but the sample thins out fast.

---

## 9. Uncertainty methods

Principles applied (and where):

1. **Empirical backtest quantiles** wherever we have an archive — berg corridors (§8),
   forecast σ calibration (§5). This is the only uncertainty in the system, and none of it
   is invented.
2. **No arbitrary confidence percentages.** The UI shows P50/P90 rings labelled as
   "empirical from walk-forward backtest", σ shading labelled MODEL_FORECAST, and text
   explanations. Where we have no basis for uncertainty (e.g. USNIC position accuracy)
   we display the *data lag* instead (`Track database lags real time by ~134 d`) rather
   than a fake error bar.
3. Rejected for MVP: Bayesian deep learning / MC-dropout (no deep model to apply it to),
   conformal prediction (attractive next step over the damped-trend residuals — roadmap
   phase 8).

---

## 10. Risk formulation — **PROPOSED PROTOTYPE METHODOLOGY**

The combined risk field is our own construction and is labelled in-app as
"PROPOSED PROTOTYPE METHODOLOGY — derived". Components:

- **Sea ice:** IMO POLARIS (MSC.1/Circ.1519) RIO = Σ(C_i × RIV_i). `FACT` — we read the
  circular's tables; elevated-risk speed limits (PC1 11 kn / PC2 8 kn / PC3–PC5 5 kn /
  below PC5 3 kn) feed the route time model. `PROPOSED` — the SIC→ice-type mapping
  upstream of the RIVs (§4).
- **Icing:** Overland (1990) predictor PPR = V_a(T_f − T_a)/(1 + 0.3(T_w − T_f)),
  thresholds 22.4/53.3/83.0 m·°C/s. `FACT` for the formula; `ASSUMPTION` that it applies
  to a modern resupply vessel (it was derived for 20–75 m vessels steaming into wind); we
  suppress spray icing in ≥70 % pack (spray cannot form in closed pack — physical
  reasoning, `ASSUMPTION`).
- **Bergs:** exclusion zones sized by the empirical drift quantiles of §8 around each
  tracked berg. `PROPOSED`.
- **Combination:** worst-of (max severity) across the three components per cell —
  deliberately **no invented weights**. A weighted sum would imply we know the relative
  operational importance of ice vs icing vs bergs; we do not (`UNKNOWN`).

**Requires expert validation before any operational use:** the SIC→type mapping; Overland
applicability to the actual vessel class; berg zone sizing policy (quantile choice);
worst-of vs other combination rules; and whether severity categories map correctly onto
NCPOR's own go/no-go doctrine.

---

## 11. Route optimization

Compared: Dijkstra / A* on the risk grid (chosen), RRT*/sampling (suits continuous
kinodynamic problems, ours is a gridded field), genetic/PSO (no optimality story,
hyperparameters to tune, harder to explain). **A\* with a severity ceiling** was selected
because (a) the risk field is already a grid; (b) admissible great-circle heuristic keeps
it optimal; (c) *hard ceilings are explainable* — "this route never enters HIGH" is a
sentence an operator can trust, whereas a soft-penalty optimum is not. Three profiles
(DIRECT / BALANCED / CONSERVATIVE) differ only in declared ceiling and cost trade, and the
recommendation logic (`MSC.1/Circ.1519 §1.4.5` voyage-planning guidance: avoid
elevated-risk areas) is quoted in the explanation panel. Time model uses POLARIS speed
limits per cell (`FACT`, Table 1.2) rather than invented speed penalties.

---

## 12. Fuel estimation honesty

Fuel figures are labelled `*model estimate — not a validated measurement` in the UI.
Method: distance × nominal consumption with a speed-regime adjustment from the POLARIS
limits. `ASSUMPTION`, prominently: we have **no** vessel performance curve, no hotel-load
data, no ice-resistance model. Anything beyond a labelled estimate would be fabrication.
Next level requires the actual vessel's noon-report history (`UNKNOWN` availability).

---

## 13. Validation methodology

What we actually did (all `MEASURED`, all reproducible from the repo):

1. **Walk-forward backtesting only** — for both SIC forecasting and berg trajectories, the
   model at time T sees data strictly before T. No random train/test splits on time
   series; no tuning on the evaluation window (leakage avoidance).
2. **Baseline gating** — a model ships only if it beats persistence at every horizon (§5).
3. **Determinism tests** — the demo scenario and the re-planning drill are byte-identical
   across runs (seeded), verified by repeated execution.
4. **Contract/regression tests** — risk regression pinned to known outputs (e.g. PC5 h=0
   severity extents 80.9/9.1/2.8/7.2 %, worst RIO +10.4); UI verified by scripted
   Playwright flows over every screen and state, in both themes.

What we did **not** do (and say so): validation against ship tracks or voyage outcomes;
comparison to official ice-service charts; any human-factors evaluation with actual
navigators. These define "operational validation" and are beyond a prototype.

---

## 14. Research discovery guide (how to go deeper)

Where to look, in decreasing order of trust: IMO instruments and national ice-service
manuals → peer-reviewed literature (search scholar for the terms below) → agency dataset
documentation (NSIDC/OSI SAF/Copernicus user guides) → conference/hackathon material.
Blogs are not evidence.

Suggested queries: `POLARIS risk index outcome polar ship`, `sea ice concentration
short-term forecast persistence baseline`, `iceberg drift model wind current drag`,
`Antarctic iceberg tracking scatterometer database`, `vessel icing prediction Overland`,
`marginal ice zone navigation risk`, `conformal prediction geophysical forecast`.
For each paper kept, record: claim used, dataset/region it was validated on, and whether
its regime matches ours (East Antarctic coastal, corridor scale).

## 15. Research library structure

Created under `research/` (one folder per pillar: `datasets/ forecasting/ icebergs/ risk/
routing/ validation/`, each with `notes/`). Note template: `research/NOTE-TEMPLATE.md` —
fields for source, claim, epistemic tag, regime match, and "what would change in our code
if this is true".

---

## 16. Final scientific recommendation (decision table)

| Decision | Chosen | Grade |
|---|---|---|
| Ice variable | SIC now; ice **type** at next level | `FACT`-aligned, gap acknowledged |
| Ice forecast | Damped anomaly trend, σ-calibrated | `MEASURED` beats persistence |
| Berg tracking | Gated identity association + QC | Simplest defensible on curated input |
| Berg trajectory | Damped drift + empirical P50/P90 corridor | `MEASURED`, no invented physics |
| Risk | POLARIS + Overland + berg zones, worst-of | `PROPOSED`, expert list in §10 |
| Routing | Severity-ceiling A*, 3 profiles | Optimal + explainable |
| Uncertainty | Backtest quantiles only | No fabricated confidence |
| DL anywhere? | No — sample sizes forbid it | Revisit at phase 8 with archives |

## 17. Limitations (consolidated)

25 km SIC blind to leads/MIZ · SIC→type mapping unvalidated (`PROPOSED`) · berg feed lags
~134 d (shown in UI) · detection validated on simulated SAR only · Overland outside its
derivation class (`ASSUMPTION`) · fuel is a labelled estimate · pooled berg-error quantiles
· no operational or human-factors validation · demo scenario is simulated and labelled.

## 18. Primary sources actually consulted

1. IMO MSC.1/Circ.1519 — POLARIS (RIO formula, RIV tables, Table 1.2 speed limits, §1.4.5).
2. Overland (1990) icing predictor — formula & thresholds via NOAA/NPS references.
3. NSIDC G02135 Sea Ice Index v4 documentation + data (ingested daily GeoTIFFs).
4. BYU/NIC consolidated iceberg database v8.0 — DOI 10.1109/JSTARS.2017.2784186 (ingested).
5. USNIC current iceberg product (ingested CSV); Open-Meteo API docs (ingested).

No other papers are cited because no others were read in full. The literature review in
§14 is a *guide to further reading*, not a claim of having read it.

## 19. Light Mode

Implemented (see `frontend/src/index.css`, `state/themeStore.tsx`): single design system,
all colors are semantic tokens; `[data-theme="light"]` re-points every token (designed
palette, **not** an inversion); toggle in the top bar with accessible label; OS preference
followed until the user chooses; choice persisted in `localStorage`; pre-paint inline
script prevents flash; 180 ms surface transition; map rasters, SVG layers, legends, badges
and drill visuals all theme-aware; verified by scripted screenshots of every major screen
in both themes with zero console errors.

## 20. Questions requiring expert confirmation

1. What ice-type/stage product does NCPOR trust operationally for this corridor, and at
   what latency? (Determines the correct POLARIS input.)
2. Is the resupply vessel's ice class and displacement compatible with the Overland icing
   predictor, or is a vessel-specific icing model required?
3. What berg standoff distance does current NCPOR/master's doctrine use — and should our
   P90 corridor replace or complement it?
4. Is worst-of the right hazard combination rule for their go/no-go doctrine?
5. Can vessel noon reports be made available to calibrate speed-in-ice and fuel models?
6. What is the acceptable false-alarm rate for re-planning alerts before operators start
   ignoring them? (Human-factors question; determines alert thresholds.)
