/**
 * Bridge between the CSS design tokens and the WebGL palette.
 *
 * `index.css` stays the single source of truth for hue semantics (both
 * themes). Scene materials can't read CSS variables, so the handful of
 * semantic colours the 3D layers need are resolved from the computed style of
 * `<html>` — which means a theme switch recolours map and panels from the same
 * token set, exactly as the 2D renderer did.
 */

let cache: { theme: string; values: Record<string, number> } | null = null;

const NAMES = [
  'accent', 'risk-low', 'risk-med', 'risk-high', 'risk-crit',
  'model', 'ink-dim', 'ice', 'route-conservative', 'route-direct', 'route-balanced',
] as const;

export type TokenName = (typeof NAMES)[number];

/**
 * Values used when there is no DOM (headless verification, SSR). They mirror
 * the dark tokens in index.css so the mapping layer stays exercisable outside
 * a browser; in the app the computed style always wins.
 */
const FALLBACK: Record<string, number> = {
  accent: 0x46cfe4, 'risk-low': 0x3ddc97, 'risk-med': 0xf2c94c, 'risk-high': 0xff9046,
  'risk-crit': 0xff4d5e, model: 0xb48cff, 'ink-dim': 0x8aa2bc, ice: 0xeaf6ff,
  'route-conservative': 0x9db8d4, 'route-direct': 0x46cfe4, 'route-balanced': 0x3ddc97,
};

function parseColor(css: string): number {
  const v = css.trim();
  if (!v) return 0x88aacc;
  if (v.startsWith('#')) return parseInt(v.slice(1), 16) || 0;
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return ((parts[0] << 16) | (parts[1] << 8) | parts[2]) >>> 0;
  }
  return 0x88aacc;
}

/** Resolve `--color-*` tokens for the current theme. */
export function tokenColors(theme: 'dark' | 'light'): Record<TokenName, number> {
  if (cache && cache.theme === theme) return cache.values as Record<TokenName, number>;
  if (typeof document === 'undefined') return FALLBACK as Record<TokenName, number>;
  const cs = getComputedStyle(document.documentElement);
  const values = {} as Record<string, number>;
  for (const n of NAMES) values[n] = parseColor(cs.getPropertyValue(`--color-${n}`));
  cache = { theme, values };
  return values as Record<TokenName, number>;
}

/** Drop the cache (e.g. after a theme change has painted). */
export function invalidateTokenCache() {
  cache = null;
}
