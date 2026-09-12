/**
 * Scene palette — the 3D counterpart of the CSS design tokens.
 *
 * `index.css` owns the DOM tokens; this module owns the same hues for
 * materials, lights and fog so a theme switch re-tints the environment and
 * the panels together. Values intentionally mirror `--color-*` / `--map-*`.
 */

export interface ScenePalette {
  /** clear colour / deep space behind the disc */
  background: number;
  fog: number;
  fogNear: number;
  fogFar: number;

  /** ocean */
  oceanDeep: number;
  oceanShallow: number;
  oceanFoam: number;

  /** land + ice */
  landLow: number;
  landHigh: number;
  landShadow: number;
  shelf: number;
  coastline: number;

  /** sea-ice ramp (transparent → pale pack) */
  iceThin: number;
  iceThick: number;
  iceEdgeGlow: number;

  /** semantic */
  safe: number;
  caution: number;
  danger: number;
  critical: number;
  accent: number;
  model: number;
  ink: number;
  inkDim: number;

  /** lighting */
  keyLight: number;
  fillLight: number;
  ambient: number;
  keyIntensity: number;
  fillIntensity: number;
  ambientIntensity: number;
}

export const DARK_PALETTE: ScenePalette = {
  background: 0x03080f,
  fog: 0x061426,
  fogNear: 2600,
  fogFar: 12500,

  oceanDeep: 0x04101f,
  oceanShallow: 0x0d3350,
  oceanFoam: 0x9fd8ef,

  landLow: 0x1d4a6b,
  landHigh: 0xdceeff,
  landShadow: 0x0a1c2c,
  shelf: 0x9fd0ea,
  coastline: 0x63b6d8,

  iceThin: 0x5f9dc4,
  iceThick: 0xe8f6ff,
  iceEdgeGlow: 0x7fe3ff,

  safe: 0x3ddc97,
  caution: 0xf2c94c,
  danger: 0xff9046,
  critical: 0xff4d5e,
  accent: 0x46cfe4,
  model: 0xb48cff,
  ink: 0xeaf6ff,
  inkDim: 0x8aa2bc,

  keyLight: 0xdff1ff,
  fillLight: 0x2f6f96,
  ambient: 0x2a4d68,
  keyIntensity: 2.5,
  fillIntensity: 0.9,
  ambientIntensity: 0.55,
};

export const LIGHT_PALETTE: ScenePalette = {
  background: 0xdbe7f2,
  fog: 0xcfe0ee,
  fogNear: 3200,
  fogFar: 13000,

  oceanDeep: 0x8fb3cd,
  oceanShallow: 0xb9d4e6,
  oceanFoam: 0xffffff,

  landLow: 0x7ea8c4,
  landHigh: 0xffffff,
  landShadow: 0x93b0c6,
  shelf: 0xcfe6f4,
  coastline: 0x4a7fa0,

  iceThin: 0x9dc4dd,
  iceThick: 0xffffff,
  iceEdgeGlow: 0x2e8fb0,

  safe: 0x0a7a4f,
  caution: 0x7e6008,
  danger: 0xbc5310,
  critical: 0xd21f33,
  accent: 0x086b81,
  model: 0x6d3fd4,
  ink: 0x10233a,
  inkDim: 0x46617c,

  keyLight: 0xffffff,
  fillLight: 0xbcd6e8,
  ambient: 0xd7e6f2,
  keyIntensity: 2.9,
  fillIntensity: 0.8,
  ambientIntensity: 0.85,
};

export function paletteFor(theme: 'dark' | 'light'): ScenePalette {
  return theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}
