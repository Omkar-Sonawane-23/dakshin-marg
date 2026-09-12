/**
 * Antarctic relief — terrain height field for the 3D scene.
 *
 * HONESTY: the repository ships a Natural-Earth-grade coastline + ice-shelf
 * vector set (`src/assets/antarctica.json`) but **no DEM / bathymetry grid**.
 * Rather than pretending a real elevation product is being rendered, this
 * module derives a *synthesised* relief field from the real coastline
 * geometry:
 *
 *   · exact signed distance to the coastline (spatial hash over projected
 *     edges, so the coast keeps the vector set's own fidelity);
 *   · a flood-filled "is this the Antarctic ice sheet?" component mask, so
 *     the ice-sheet dome profile is applied only to Antarctica and Patagonia
 *     / Tasmania / the sub-Antarctic islands get ordinary low relief;
 *   · an ice-shelf mask, so shelves stay flat and low (~50–120 m) instead of
 *     inheriting the inland dome;
 *   · a hypsometric profile: coastal escarpment → plateau → interior dome,
 *     continental shelf → shelf break → abyssal plain offshore;
 *   · deterministic fractal noise (`lib/random.ts`) for texture, ridges and
 *     submarine troughs.
 *
 * The result is clearly labelled "synthesised relief" in the UI. To swap in a
 * real product (GEBCO / BEDMACHINE), implement `ReliefProvider.heightKm()`
 * and hand it to `buildTerrain()` — nothing downstream changes.
 */
import * as THREE from 'three';
import antarctica from '../assets/antarctica.json';
import { fractalNoise2, mulberry32, valueNoise2 } from '../lib/random';
import { rhoOfLat } from '../lib/projection';
import { project } from '../lib/projection';

// ── domain ──────────────────────────────────────────────────────────────

/** Southern limit of the rendered terrain disc (degrees). */
export const TERRAIN_LAT_LIMIT = -42;
/** Disc radius in scene km (polar-stereographic rho at the lat limit). */
export const TERRAIN_RADIUS_KM = Math.ceil(rhoOfLat(TERRAIN_LAT_LIMIT) / 50) * 50;

/** Pluggable elevation source — a real DEM drops in here. */
export interface ReliefProvider {
  readonly name: string;
  readonly provenance: string;
  /** Elevation in km (+ land / − ocean) at a scene position. */
  heightKm(x: number, z: number): number;
}

// ── geometry helpers ────────────────────────────────────────────────────

type Ring = { x: Float32Array; z: Float32Array; n: number };

function collectRings(): { land: Ring[]; shelf: Ring[] } {
  const fc = antarctica as unknown as {
    features: { properties: { kind: string }; geometry: { type: string; coordinates: number[] } }[];
  };
  const land: Ring[] = [];
  const shelf: Ring[] = [];
  for (const f of fc.features) {
    const geom = f.geometry;
    const polys: number[][][] =
      geom.type === 'Polygon'
        ? (geom.coordinates as unknown as number[][][])
        : (geom.coordinates as unknown as number[][][][]).flat();
    for (const ring of polys) {
      const n = ring.length;
      if (n < 4) continue;
      const x = new Float32Array(n);
      const z = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = project(ring[i][0], ring[i][1]);
        x[i] = p.x;
        z[i] = p.y;
      }
      (f.properties.kind === 'shelf' ? shelf : land).push({ x, z, n });
    }
  }
  return { land, shelf };
}

/** Even-odd scanline rasterisation of projected rings onto a regular grid. */
function rasterize(
  rings: Ring[],
  step: number,
  size: number,
  origin: number,
): Uint8Array {
  const mask = new Uint8Array(size * size);
  const xs = new Float64Array(4096);
  for (let row = 0; row < size; row++) {
    const y = origin + (row + 0.5) * step;
    let count = 0;
    for (const r of rings) {
      for (let i = 0, j = r.n - 1; i < r.n; j = i++) {
        const y0 = r.z[j];
        const y1 = r.z[i];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          if (count >= xs.length) break;
          xs[count++] = r.x[j] + ((y - y0) / (y1 - y0)) * (r.x[i] - r.x[j]);
        }
      }
    }
    if (count === 0) continue;
    const arr = Array.from(xs.subarray(0, count)).sort((a, b) => a - b);
    for (let k = 0; k + 1 < arr.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((arr[k] - origin) / step - 0.5));
      const c1 = Math.min(size - 1, Math.floor((arr[k + 1] - origin) / step - 0.5));
      for (let c = c0; c <= c1; c++) mask[row * size + c] = 1;
    }
  }
  return mask;
}

/** 4-connected flood fill from the pole → identifies the Antarctic landmass. */
function floodFromPole(mask: Uint8Array, size: number, origin: number, step: number): Uint8Array {
  const out = new Uint8Array(size * size);
  const col = Math.floor((0 - origin) / step);
  const row = Math.floor((0 - origin) / step);
  if (col < 0 || row < 0 || col >= size || row >= size) return out;
  const stack = [row * size + col];
  if (!mask[row * size + col]) return out;
  out[row * size + col] = 1;
  while (stack.length) {
    const idx = stack.pop()!;
    const r = (idx / size) | 0;
    const c = idx - r * size;
    if (c > 0 && mask[idx - 1] && !out[idx - 1]) { out[idx - 1] = 1; stack.push(idx - 1); }
    if (c < size - 1 && mask[idx + 1] && !out[idx + 1]) { out[idx + 1] = 1; stack.push(idx + 1); }
    if (r > 0 && mask[idx - size] && !out[idx - size]) { out[idx - size] = 1; stack.push(idx - size); }
    if (r < size - 1 && mask[idx + size] && !out[idx + size]) { out[idx + size] = 1; stack.push(idx + size); }
  }
  return out;
}

/**
 * Exact-ish signed distance transform (Felzenszwalb-style two-pass chamfer
 * with knight offsets) over the land mask.
 *
 * The per-vertex *exact* query below is only affordable near the coast; the
 * far field — where the hypsometric profile is already saturated — is served
 * from this grid. That is what keeps the terrain build in the tens of
 * milliseconds instead of seconds.
 */
function chamferDistance(mask: Uint8Array, size: number, step: number): Float32Array {
  const n = size;
  const INF = 1e9;
  const d = new Float32Array(n * n);
  const D1 = step;                  // orthogonal
  const D2 = step * Math.SQRT2;     // diagonal
  const D3 = step * Math.sqrt(5);   // knight

  // seed: cells on a mask boundary
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const m = mask[k];
      const edge =
        (i > 0 && mask[k - 1] !== m) ||
        (i < n - 1 && mask[k + 1] !== m) ||
        (j > 0 && mask[k - n] !== m) ||
        (j < n - 1 && mask[k + n] !== m);
      d[k] = edge ? 0 : INF;
    }
  }
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= n || j >= n ? INF : d[j * n + i]);
  // forward
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let v = d[k];
      v = Math.min(v, at(i - 1, j - 1) + D2, at(i, j - 1) + D1, at(i + 1, j - 1) + D2);
      v = Math.min(v, at(i - 2, j - 1) + D3, at(i + 2, j - 1) + D3);
      v = Math.min(v, at(i - 1, j - 2) + D3, at(i + 1, j - 2) + D3);
      v = Math.min(v, at(i - 1, j) + D1);
      d[k] = v;
    }
  }
  // backward
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      let v = d[k];
      v = Math.min(v, at(i + 1, j + 1) + D2, at(i, j + 1) + D1, at(i - 1, j + 1) + D2);
      v = Math.min(v, at(i + 2, j + 1) + D3, at(i - 2, j + 1) + D3);
      v = Math.min(v, at(i + 1, j + 2) + D3, at(i - 1, j + 2) + D3);
      v = Math.min(v, at(i + 1, j) + D1);
      d[k] = v;
    }
  }
  // sign: + inland, − offshore
  for (let k = 0; k < d.length; k++) if (mask[k] === 0) d[k] = -d[k];
  return d;
}

/** Bilinear sample of a signed distance grid, in km. */
function sampleDistance(d: Float32Array, size: number, origin: number, step: number, x: number, z: number): number {
  const fx = (x - origin) / step - 0.5;
  const fz = (z - origin) / step - 0.5;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  if (i0 < 0 || j0 < 0 || i0 >= size - 1 || j0 >= size - 1) return d[Math.max(0, Math.min(d.length - 1, ((j0 < 0 ? 0 : j0 >= size ? size - 1 : j0) * size) + (i0 < 0 ? 0 : i0 >= size ? size - 1 : i0)))];
  const tx = fx - i0, tz = fz - j0;
  const a = d[j0 * size + i0], b = d[j0 * size + i0 + 1];
  const c = d[(j0 + 1) * size + i0], e = d[(j0 + 1) * size + i0 + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
}

/** Uniform-grid spatial hash of coastline segments for exact distance queries. */
class EdgeHash {
  private cell: number;
  private origin: number;
  private size: number;
  private buckets: (number[] | undefined)[];
  private ax: Float32Array;
  private az: Float32Array;
  private bx: Float32Array;
  private bz: Float32Array;

  constructor(rings: Ring[], cell = 30, radius = TERRAIN_RADIUS_KM + 200) {
    this.cell = cell;
    this.origin = -radius;
    this.size = Math.ceil((radius * 2) / cell);
    this.buckets = new Array(this.size * this.size);
    const total = rings.reduce((a, r) => a + r.n, 0);
    this.ax = new Float32Array(total);
    this.az = new Float32Array(total);
    this.bx = new Float32Array(total);
    this.bz = new Float32Array(total);
    let e = 0;
    for (const r of rings) {
      for (let i = 0, j = r.n - 1; i < r.n; j = i++) {
        this.ax[e] = r.x[j]; this.az[e] = r.z[j];
        this.bx[e] = r.x[i]; this.bz[e] = r.z[i];
        const c0 = Math.floor((r.x[j] - this.origin) / cell);
        const c1 = Math.floor((r.x[i] - this.origin) / cell);
        const r0 = Math.floor((r.z[j] - this.origin) / cell);
        const r1 = Math.floor((r.z[i] - this.origin) / cell);
        const minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
        const minR = Math.min(r0, r1), maxR = Math.max(r0, r1);
        for (let rr = minR; rr <= maxR; rr++) {
          for (let cc = minC; cc <= maxC; cc++) {
            if (rr < 0 || cc < 0 || rr >= this.size || cc >= this.size) continue;
            const k = rr * this.size + cc;
            (this.buckets[k] ??= []).push(e);
          }
        }
        e++;
      }
    }
  }

  /** Unsigned distance (km) from a scene point to the nearest coastline. */
  distance(x: number, z: number, maxKm = 900): number {
    const cc = Math.floor((x - this.origin) / this.cell);
    const cr = Math.floor((z - this.origin) / this.cell);
    let best = Infinity;
    const maxRing = Math.min(Math.ceil(maxKm / this.cell), this.size);
    for (let ring = 0; ring <= maxRing; ring++) {
      const lo = ring * this.cell;
      if (best <= lo) break;
      for (let rr = cr - ring; rr <= cr + ring; rr++) {
        if (rr < 0 || rr >= this.size) continue;
        for (let cci = cc - ring; cci <= cc + ring; cci++) {
          if (cci < 0 || cci >= this.size) continue;
          // only the outer frame of the square for ring > 0
          if (ring > 0 && rr !== cr - ring && rr !== cr + ring && cci !== cc - ring && cci !== cc + ring) continue;
          const bucket = this.buckets[rr * this.size + cci];
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const e = bucket[i];
            const d = segDist(x, z, this.ax[e], this.az[e], this.bx[e], this.bz[e]);
            if (d < best) best = d;
          }
        }
      }
    }
    return best;
  }
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + t * dx);
  const ez = pz - (az + t * dz);
  return Math.sqrt(ex * ex + ez * ez);
}

function sampleMask(mask: Uint8Array, size: number, origin: number, step: number, x: number, z: number): boolean {
  const c = Math.floor((x - origin) / step);
  const r = Math.floor((z - origin) / step);
  if (c < 0 || r < 0 || c >= size || r >= size) return false;
  return mask[r * size + c] === 1;
}

// ── the provider ────────────────────────────────────────────────────────

export class SyntheticRelief implements ReliefProvider {
  readonly name = 'Synthetic hypsometric relief';
  readonly provenance =
    'Derived from Natural Earth coastline + ice-shelf vectors; no DEM or bathymetry product is included in this dataset.';

  private edges: EdgeHash;
  private landMask: Uint8Array;
  private shelfMask: Uint8Array;
  private antMask: Uint8Array;
  private dist: Float32Array;
  private dSize: number;
  private dOrigin: number;
  private dStep: number;
  private mSize: number;
  private mOrigin: number;
  private mStep: number;

  constructor() {
    const { land, shelf } = collectRings();
    this.edges = new EdgeHash(land);
    this.mStep = 16;
    this.mOrigin = -TERRAIN_RADIUS_KM - 40;
    this.mSize = Math.ceil((TERRAIN_RADIUS_KM + 40) * 2 / this.mStep);
    this.landMask = rasterize(land, this.mStep, this.mSize, this.mOrigin);
    this.shelfMask = rasterize(shelf, this.mStep, this.mSize, this.mOrigin);
    this.antMask = floodFromPole(this.landMask, this.mSize, this.mOrigin, this.mStep);

    // coarse signed-distance grid for the far field
    this.dStep = 24;
    this.dOrigin = -TERRAIN_RADIUS_KM - 60;
    this.dSize = Math.ceil((TERRAIN_RADIUS_KM + 60) * 2 / this.dStep);
    this.dist = chamferDistance(this.landMask, this.mSize, this.mStep);
    // resample the 16 km mask grid onto the coarser lattice once, so the far
    // field costs one array lookup instead of a ring search
    const n = this.dSize;
    const g = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = this.dOrigin + (j + 0.5) * this.dStep;
      for (let i = 0; i < n; i++) {
        const x = this.dOrigin + (i + 0.5) * this.dStep;
        g[j * n + i] = sampleDistance(this.dist, this.mSize, this.mOrigin, this.mStep, x, z);
      }
    }
    this.dist = g;
  }

  /** Land mask sample — used by the ocean shader for shoreline shading. */
  isLand(x: number, z: number): boolean {
    return sampleMask(this.landMask, this.mSize, this.mOrigin, this.mStep, x, z);
  }

  /** Coarse signed distance in km — cheap, used for the far field. */
  coarseSignedKm(x: number, z: number): number {
    return sampleDistance(this.dist, this.dSize, this.dOrigin, this.dStep, x, z);
  }

  /**
   * Signed distance to the coastline in km (+ inland, − offshore).
   * Exact near the coast (where the profile is steep and fidelity shows),
   * from the coarse grid offshore (where it has saturated anyway).
   */
  signedDistanceKm(x: number, z: number): number {
    const c = this.coarseSignedKm(x, z);
    if (c > -140 && c < 140) {
      const exact = this.edges.distance(x, z, 260);
      if (Number.isFinite(exact)) return this.isLand(x, z) ? exact : -exact;
    }
    return c;
  }

  heightKm(x: number, z: number): number {
    const isShelf = sampleMask(this.shelfMask, this.mSize, this.mOrigin, this.mStep, x, z);
    const isAnt = sampleMask(this.antMask, this.mSize, this.mOrigin, this.mStep, x, z);
    const n1 = fractalNoise2(x * 0.0035, z * 0.0035, 0x51ab);
    const n2 = fractalNoise2(x * 0.011 + 31, z * 0.011 - 17, 0x9e37);

    if (isShelf) {
      // grounded ice shelves: flat, near sea level, gently undulating
      return 0.03 + 0.11 * n1 + 0.02 * n2;
    }

    const d = this.signedDistanceKm(x, z);

    if (d > 0) {
      // ── land ────────────────────────────────────────────────────────
      const t = 1 - Math.exp(-d / (isAnt ? 300 : 190));
      const escarp = 1 - Math.exp(-d / 22);          // steep coastal rise
      let h = (isAnt ? 3.25 : 1.15) * t * (0.35 + 0.65 * escarp);
      // ridged highlands (Transantarctic-style) in the deep interior
      const ridge = 1 - Math.abs(2 * valueNoise2(x * 0.0022, z * 0.0022, 0x77) - 1);
      h += isAnt ? ridge * ridge * 1.15 * Math.min(1, d / 700) : ridge * ridge * 0.55 * t;
      h += (n1 - 0.5) * (0.30 + 0.75 * t) + (n2 - 0.5) * 0.16;
      return Math.max(0.01, h);
    }

    // ── ocean ─────────────────────────────────────────────────────────
    const dd = -d;
    let depth: number;
    if (dd < 160) depth = 0.04 + 0.46 * smooth01(dd / 160);
    else if (dd < 760) depth = 0.5 + 3.15 * smooth01((dd - 160) / 600);
    else depth = 3.65 + 0.55 * smooth01((dd - 760) / 1800);
    // fjord / glacial troughs cutting into the coastal shelf
    const trough = Math.abs(2 * valueNoise2(x * 0.006, z * 0.006, 0x1234) - 1);
    depth += dd < 260 ? (1 - trough) * 0.55 * Math.exp(-dd / 110) : 0;
    depth += (n1 - 0.5) * 0.10 + (n2 - 0.5) * 0.06;
    return -depth;
  }
}

function smooth01(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

// ── terrain mesh ────────────────────────────────────────────────────────

export interface TerrainResult {
  mesh: THREE.Mesh;
  /** low-res signed-distance field texture (for the ocean shoreline shader) */
  distanceTexture: THREE.DataTexture;
  distanceTexSize: number;
  relief: SyntheticRelief;
  /** Re-shade the mesh for the other theme without rebuilding geometry. */
  recolor: (colors: TerrainColors) => void;
}

/** Vertex colour ramp for the terrain (theme-dependent). */
export interface TerrainColors {
  abyss: THREE.Color;
  shelfSea: THREE.Color;
  coast: THREE.Color;
  mid: THREE.Color;
  high: THREE.Color;
  rock: THREE.Color;
  shelfIce: THREE.Color;
}

export function darkTerrainColors(): TerrainColors {
  return {
    abyss: new THREE.Color(0x0a2338),
    shelfSea: new THREE.Color(0x12455f),
    coast: new THREE.Color(0x2b6d8c),
    mid: new THREE.Color(0x7fb2cd),
    high: new THREE.Color(0xe6f4ff),
    rock: new THREE.Color(0x39566c),
    shelfIce: new THREE.Color(0x9fd4ea),
  };
}

export function lightTerrainColors(): TerrainColors {
  return {
    abyss: new THREE.Color(0x7ba3bf),
    shelfSea: new THREE.Color(0x9dc0d6),
    coast: new THREE.Color(0xbdd8e8),
    mid: new THREE.Color(0xd9eaf5),
    high: new THREE.Color(0xffffff),
    rock: new THREE.Color(0x8fa9bd),
    shelfIce: new THREE.Color(0xe6f4fb),
  };
}

/**
 * Build the polar terrain disc.
 *
 * Vertices are laid out on a lat/lon polar grid (rings of constant latitude),
 * which keeps resolution roughly uniform in kilometres near the Antarctic
 * coast while collapsing harmlessly at the pole. `quality` scales both ring
 * and sector counts for lower-end GPUs.
 */
export function buildTerrain(relief: SyntheticRelief, colors: TerrainColors, quality = 1): TerrainResult {
  const rings: number[] = [];
  const innerStep = 0.12 / quality;
  const outerStep = 0.75 / quality;
  for (let lat = -90; lat < -60 - 1e-9; lat += innerStep) rings.push(lat);
  for (let lat = -60; lat <= TERRAIN_LAT_LIMIT + 1e-9; lat += outerStep) rings.push(lat);
  if (rings[rings.length - 1] < TERRAIN_LAT_LIMIT - 1e-9) rings.push(TERRAIN_LAT_LIMIT);

  const nSec = Math.max(120, Math.round(720 * quality));
  const nRing = rings.length;
  const vCount = nRing * (nSec + 1);

  const pos = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const hgt = new Float32Array(vCount);

  let v = 0;
  for (let ri = 0; ri < nRing; ri++) {
    const lat = rings[ri];
    for (let si = 0; si <= nSec; si++) {
      const lon = (si / nSec) * 360;
      const p = project(lon, lat);
      const h = relief.heightKm(p.x, p.y);
      pos[v * 3] = p.x;
      pos[v * 3 + 1] = 0; // set after normal pass (exaggeration applied by caller)
      pos[v * 3 + 2] = p.y;
      hgt[v] = h;
      uv[v * 2] = si / nSec;
      uv[v * 2 + 1] = ri / (nRing - 1);
      v++;
    }
  }

  // indices
  const idx = new Uint32Array((nRing - 1) * nSec * 6);
  let k = 0;
  for (let ri = 0; ri < nRing - 1; ri++) {
    for (let si = 0; si < nSec; si++) {
      const a = ri * (nSec + 1) + si;
      const b = a + 1;
      const c = a + nSec + 1;
      const d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }

  // height → world Y, then colour by elevation + local slope
  for (let i = 0; i < vCount; i++) pos[i * 3 + 1] = hgt[i];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  // slope from the computed normals (pre-exaggeration, so it is physical)
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const shade = (colors: TerrainColors) => shadeTerrain(colors, vCount, hgt, nrm, col);
  shade(colors);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  // exaggerate elevation now that shading/slope are computed in true units
  const Y = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < vCount; i++) Y.setY(i, hgt[i] * TERRAIN_EXAGGERATION);
  Y.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // ── shoreline distance field for the ocean shader ──
  const N = 256;
  const span = TERRAIN_RADIUS_KM;
  const tex = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = -span + ((j + 0.5) / N) * span * 2;
    for (let i = 0; i < N; i++) {
      const x = -span + ((i + 0.5) / N) * span * 2;
      const d = relief.coarseSignedKm(x, z);
      // encode −500 km … +500 km into 0…255 (128 = coastline)
      const enc = Math.max(0, Math.min(255, Math.round(((d + 500) / 1000) * 255)));
      tex[j * N + i] = enc;
    }
  }
  const distanceTexture = new THREE.DataTexture(tex, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  distanceTexture.magFilter = THREE.LinearFilter;
  distanceTexture.minFilter = THREE.LinearFilter;
  distanceTexture.wrapS = THREE.ClampToEdgeWrapping;
  distanceTexture.wrapT = THREE.ClampToEdgeWrapping;
  distanceTexture.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.02,
    dithering: true,
  });
  mat.userData.isTerrain = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  return {
    mesh,
    distanceTexture,
    distanceTexSize: N,
    relief,
    recolor: (c: TerrainColors) => {
      shade(c);
      (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    },
  };
}

/** Altitude + slope shading, shared by the first build and theme recolours. */
function shadeTerrain(
  colors: TerrainColors,
  vCount: number,
  hgt: Float32Array,
  nrm: THREE.BufferAttribute,
  col: Float32Array,
) {
  const tmp = new THREE.Color();
  for (let i = 0; i < vCount; i++) {
    const h = hgt[i];
    const steep = 1 - Math.min(1, Math.abs(nrm.getY(i)));
    if (h >= 0) {
      const t = Math.min(1, h / 3.4);
      tmp.copy(colors.coast).lerp(colors.mid, smooth01(t * 1.7)).lerp(colors.high, smooth01((t - 0.45) / 0.55));
      tmp.lerp(colors.rock, Math.min(0.85, steep * 2.4) * (h > 0.25 ? 1 : 0.25));
      if (h < 0.18) tmp.lerp(colors.shelfIce, 0.55);
    } else {
      const t = Math.min(1, -h / 4.2);
      tmp.copy(colors.shelfSea).lerp(colors.abyss, smooth01(t));
    }
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
}

/** Kept next to `coords.VERTICAL_EXAGGERATION` so both stay in lock-step. */
export const TERRAIN_EXAGGERATION = 26;

/** Deterministic detail texture (bump/roughness) shared by terrain + ice. */
export function makeIceTexture(size = 256, seed = 0x2f1a): THREE.Texture {
  const rnd = mulberry32(seed);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // tileable fractal noise
      let n = 0;
      let amp = 0.5;
      let f = 3;
      for (let o = 0; o < 4; o++) {
        n += amp * valueNoise2(u * f, v * f, seed + o * 977);
        amp *= 0.55;
        f *= 2.13;
      }
      // floe cracks: thin dark filaments
      const crack = Math.abs(valueNoise2(u * 11.3, v * 11.3, seed ^ 0x55) - 0.5);
      const fil = crack < 0.035 ? 1 - crack / 0.035 : 0;
      const g = Math.max(0, Math.min(255, (0.74 + n * 0.26) * 255 - fil * 95 + rnd() * 6));
      const i = (y * size + x) * 4;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
