# Demo Guide — POLARIS-X (8 minutes)

## Act 1 — DEMO mode: deterministic scenario (~2 min)
1. App boots → **SYSTEM READY** → Mission Control (amber SIMULATED badge).
2. Press **PLAY** — clock rolls 72 h; **+24H** triggers BRG-0042 shift → risk rises → alert → **REVIEW → recalculated B-2**.

## Act 2 — LIVE mode: real datasets (~1.5 min)
3. Toggle **LIVE** (top-right). Badges switch: `REAL · OBSERVED` — 13 bergs, SIC field, wind.
4. **Sea Ice** → **+48H** forecast (violet MODEL badge, beats persistence per docs).

## Act 3 — Navigation Risk (~1.5 min)
5. Toggle **Show risk layer**. Severity ● ◆ ▲ ■.
6. Flip **PC5 → PC7 → NONE** — surface visibly worsens (worst RIO +10.4 → -48.4).
7. **Why this risk?** — generated explanations + assumptions.

## Act 4 — Route Optimization (~1 min)
8. **Route Planner** → **Calculate routes** → 3 severity-ceiling profiles, Pareto view, IMO-anchored recommendation, fuel honestly NOT COMPUTED.

## Act 5 — THE MOMENT: re-planning drill (~2 min)
9. **Route Simulation → Run simulation** → accept DIRECT → vessel underway (T+24) → **SIMULATED D23 deviation** → conflict **LOW→CRITICAL, 2.5 km** + pulsing alert → re-plan → **old red vs new green** + 4-point “why changed” → **Accept new route**.

## Fallback (if asked)
Kill Python mid-demo → TopBar **DATA FEED · DEGRADED**, map **LIVE FEED UNAVAILABLE**, DEMO still works.

## Full Scripted Scenario Tour
Scenario / What-If → run any of 20 edge-cases with one click (stale data, iceberg crossing, no safe route, offline, whiteout, etc.) and show provenance on every product.
