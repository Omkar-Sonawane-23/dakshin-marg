# Verification — POLARIS-X

## How to Verify
1. Open **Verification / Hindsight** in the left rail.
2. Select a historical window (e.g., 2026-08-28 → 2026-09-01) and click **Run hindsight**.
3. System replays forecasts against reanalysis and shows MAE/RMSE/IIEE, planned vs actual route, and constraint satisfaction.

## Metrics Produced
- **SIC:** MAE % / RMSE % / IIEE (ice-edge error) at +24/48/72 h vs persistence.
- **Icebergs:** drift error quantiles at +1/3/7 d vs stationary baseline.
- **Routes:** feasibility, risk exposure delta, length/time delta.

## No Manufactured Accuracy
All percentages are backtest-measured. The system never invents “98% accurate”.

## Invariants Tested
- A route crossing a hard no-go cell is never returned feasible.
- PC7 vs PC3 must not auto-produce identical masks.
- Increasing berg probability never decreases risk.
- Staling a source changes freshness.
- Removing all feasible cells → NO SAFE ROUTE.
- Invalidation → critical alert.
See `tests/` for automated invariant checks.
