# research/ — research library

Structure: one folder per scientific pillar, each with a `notes/` directory of individual
source notes using `NOTE-TEMPLATE.md`.

- `datasets/` — candidate data sources, access tests, format notes
- `forecasting/` — sea-ice forecasting methods & baselines
- `icebergs/` — detection, tracking, trajectory modeling
- `risk/` — POLARIS, icing, hazard combination
- `routing/` — path search & route ranking
- `validation/` — backtest protocols, leakage avoidance, metrics

Rules (from docs/research-foundation.md): primary sources only; record whether the source
was read in full; every note states what would change in our code if the claim holds.
The synthesis lives in `docs/research-foundation.md` — notes here are the raw material.
