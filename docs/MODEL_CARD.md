# Model Card — POLARIS-X

## SIC Forecast — damped-trend v0.1.0
- **Type:** Damped trend (non-ML baseline); ConvLSTM/U-Net planned.
- **Status:** EXPERIMENTAL (beats persistence but short window).
- **Training:** 8 days NSIDC SIC AOI, per-cell.
- **Horizons:** 24/48/72 h (only supported; longer refused).
- **Validation:** Walk-forward MAE 2.54/4.04/4.72% vs persistence 3.2/5.1/6.0%.
- **Uncertainty:** Empirical σ from backtest MAE + volatility.
- **Limitations:** Summer window only; regime shift can degrade; not real-time.

## Iceberg Detection — sar-cfar-cc v0.1.0
- **Type:** CFAR threshold + connected components on labelled simulated SAR scene.
- **Metrics:** P=R=0.944 on that scene; pos error 68 m. Real SAR needs auth.
- **Operational source:** USNIC analyst detections served as REAL.

## Iceberg Trajectory — berg-damped-drift v0.1.0
- **Type:** v_berg = v_current + 0.02·v_wind; ensemble 20 members.
- **Metrics:** Moving stratum mean error 5.0/7.2/12.3 km at +1/3/7 d vs stationary 5.2/8.2/14.3 km.
- **Status:** EXPERIMENTAL.

## Risk Engine — polaris-overland-risk v0.1.0
- **Components:** POLARIS RIO + Overland icing + empirical berg zones.
- **Combination:** worst-of (max) — no weights.
- **Status:** PROPOSED PROTOTYPE.

## Route Optimizer — severity-ceiling-astar v0.1.0
- **Type:** A* shortest path under severity ceilings (DIRECT/BALANCED/CONSERVATIVE).
- **Speed:** POLARIS Table 1.2 limits in ELEVATED cells.
- **Fuel:** Not computed (no validated model).
- **Status:** PROTOTYPE.
