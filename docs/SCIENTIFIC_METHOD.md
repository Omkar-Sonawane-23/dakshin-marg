# Scientific Method — POLARIS-X

## Honesty Principle
Every number is either measured, computed from a documented formula over measured inputs, or labelled as an assumption. No fabrication.

## Sea-Ice Forecast
- Model: damped-trend (trend damping 0.85) on 0.5°×0.25° grid, trained on 8-day window.
- Baseline: persistence (last observation). Selected only if backtest MAE beats baseline.
- Uncertainty: empirical backtest MAE + per-cell volatility → σ grid, shown as halo.
- Validation: walk-forward (3 folds), metrics MAE/RMSE/IIEE. Horizons >72 h refused (window too short).

## Iceberg Drift
- Core: v_berg ≈ v_current + γ·v_wind, γ≈0.02, plus sea-ice drag where concentration >40%.
- Ensemble: perturb current/wind ±1σ, generate 20 members.
- Corridor: P50/P90 from backtest quantiles (5.0/7.2/12.3 km at +1/3/7 d).
- Detection: CFAR threshold on labelled simulated SAR scene (P=R=0.944) + USNIC analyst detections served as REAL.

## Risk Engine
- Sea ice: IMO POLARIS RIO (MSC.1/Circ.1519) Table per ice class.
- Icing: Overland (1990) PPR from wind/temp.
- Bergs: empirical hazard zones from drift-error backtest quantiles.
- Combination: worst-of (max severity) — no weighted sums.

## Routing
- Graph: 0.5° grid over AOI 40–100°E, 72–55°S.
- Constraints: hard no-go before optimization (land, shelves, POLARIS elevated, shallow draft).
- Profiles: severity ceilings (DIRECT=HIGH, BALANCED=MEDIUM, CONSERVATIVE=LOW) — not weighted costs.
- Speed: cruise in NORMAL cells, POLARIS Table 1.2 limits in ELEVATED (PC1 11, PC2 8, PC3-5 5, below 3 kn). CRITICAL never transited.
- Pareto: feasible set plotted time vs exposure; operator selects.

## Provenance & Uncertainty
Every product carries source, timestamps, CRS, resolution, version, quality, and warnings. Forecasts carry σ. Bergs carry corridor. Routes carry exposure. Confidence ≠ safety.

## Limitations
See LIMITATIONS.md and docs/research-foundation.md for regime-shift caveats, resolution limits, and fuel model absence.
