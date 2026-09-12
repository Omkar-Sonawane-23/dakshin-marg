/** Color ramps for scientific raster layers (canvas).
 *
 * Canvas pixels can't use CSS variables, so each ramp is defined per
 * theme and selected at call time from <html data-theme>. The canvas
 * redraw effect in AntarcticMap depends on the theme, so rasters
 * repaint on toggle. Hue semantics (green→amber→orange→red for risk,
 * violet for model uncertainty) are identical in both themes — only
 * lightness/alpha change so layers stay legible on each ocean color.
 */

function isLight(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
}

/** Sea-ice concentration 0–100 % → rgba. */
export function seaIceColor(pct: number): [number, number, number, number] {
  if (pct < 8) return [120, 190, 235, 0];
  const t = Math.min(1, (pct - 8) / 84);
  if (isLight()) {
    // light ocean → ice reads as deepening steel blue
    const r = 168 - t * 100;
    const g = 205 - t * 85;
    const b = 232 - t * 62;
    const a = 0.16 + t * 0.6;
    return [r, g, b, a];
  }
  // dark ocean → deep teal-blue → pale ice white
  const r = 96 + t * 140;
  const g = 150 + t * 96;
  const b = 200 + t * 55;
  const a = 0.10 + t * 0.62;
  return [r, g, b, a];
}

/** Risk score 0–100 → rgba heat (green → amber → orange → red). */
export function riskColor(score: number): [number, number, number, number] {
  if (score < 30) return [61, 220, 151, 0]; // suppress low-risk wash — highlight hazards only
  const stops: [number, [number, number, number]][] = isLight()
    ? [
        [0, [12, 143, 93]],
        [35, [147, 112, 10]],
        [62, [188, 83, 16]],
        [85, [210, 31, 51]],
        [100, [185, 15, 40]],
      ]
    : [
        [0, [61, 220, 151]],
        [35, [242, 201, 76]],
        [62, [255, 144, 70]],
        [85, [255, 77, 94]],
        [100, [255, 45, 70]],
      ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (score >= stops[i][0] && score <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const f = (score - lo[0]) / Math.max(1, hi[0] - lo[0]);
  const c = lo[1].map((v, i) => v + (hi[1][i] - v) * f) as [number, number, number];
  const a = Math.min(0.5, ((score - 30) / 70) * 0.55);
  return [c[0], c[1], c[2], a];
}

/** Forecast uncertainty σ (% concentration) → violet ramp. */
export function sigmaColor(sigma: number): [number, number, number, number] {
  if (sigma < 2) return [160, 130, 250, 0];
  const t = Math.min(1, (sigma - 2) / 18);
  if (isLight()) {
    return [120 - t * 30, 70 - t * 20, 205 - t * 25, 0.12 + t * 0.45];
  }
  return [150 + t * 80, 120 + t * 30, 250, 0.10 + t * 0.5];
}

/** Live risk severity ordinal (0 LOW … 3 CRITICAL) → rgba.
 * LOW is fully transparent — the layer highlights hazards, not safety. */
export function liveRiskColor(sevIdx: number): [number, number, number, number] {
  if (isLight()) {
    switch (sevIdx) {
      case 1: return [147, 112, 10, 0.30];  // MEDIUM  dark amber
      case 2: return [188, 83, 16, 0.42];   // HIGH    burnt orange
      case 3: return [210, 31, 51, 0.52];   // CRITICAL red
      default: return [0, 0, 0, 0];
    }
  }
  switch (sevIdx) {
    case 1: return [242, 201, 76, 0.28];   // MEDIUM  amber
    case 2: return [255, 144, 70, 0.40];   // HIGH    orange
    case 3: return [255, 77, 94, 0.52];    // CRITICAL red
    default: return [0, 0, 0, 0];          // LOW / nodata
  }
}

/** Wind speed kn → stroke color. */
export function windColor(kn: number): string {
  if (isLight()) {
    if (kn < 22) return 'rgba(70,97,124,0.55)';
    if (kn < 34) return 'rgba(147,112,10,0.85)';
    return 'rgba(188,83,16,0.95)';
  }
  if (kn < 22) return 'rgba(138,162,188,0.5)';
  if (kn < 34) return 'rgba(242,201,76,0.75)';
  return 'rgba(255,144,70,0.9)';
}
