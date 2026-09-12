/**
 * Atmosphere — wind vectors and an advected particle field.
 *
 * Two complementary encodings, both driven by the same real wind cells:
 *
 *   1. instanced wind barbs at the observation/forecast grid points —
 *      direction (where the wind blows TO), length ∝ speed, colour ∝ speed
 *      band. This is the quantitative read.
 *   2. a particle field advected through a coarse re-gridding of those same
 *      cells — the qualitative read of the flow. Particle count is capped and
 *      the whole system is skipped when the layer is off.
 *
 * Ocean currents, wave direction and SST are listed as PLANNED in the layer
 * control: no dataset ships with the project, so nothing is faked here.
 */
import * as THREE from 'three';
import { sceneXZ } from './coords';
import { unproject } from '../lib/projection';
import type { ScenePalette } from './palette';

export interface WindCellSpec {
  lon: number;
  lat: number;
  windSpeedKn: number;
  /** direction the wind blows FROM (meteorological convention) */
  windDirDeg: number;
}

const DEG = Math.PI / 180;
const MAX_PARTICLES = 2600;

function speedColor(kn: number, p: ScenePalette): THREE.Color {
  if (kn < 22) return new THREE.Color(p.inkDim);
  if (kn < 34) return new THREE.Color(p.caution);
  return new THREE.Color(p.danger);
}

const PARTICLE_VERT = /* glsl */ `
attribute float aLife;
uniform float uSize;
uniform float uPixelRatio;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixelRatio * (1.0 - 0.35 * aLife);
}
`;

const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vLife;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d) * (1.0 - vLife) * 0.55;
  gl_FragColor = vec4(uColor, a);
}
`;

export class WeatherLayer {
  readonly group = new THREE.Group();
  private arrows: THREE.InstancedMesh;
  private arrowMat: THREE.MeshStandardMaterial;
  private arrowGeo: THREE.BufferGeometry;

  private points: THREE.Points;
  private pMat: THREE.ShaderMaterial;
  private px: Float32Array;
  private pz: Float32Array;
  private plife: Float32Array;
  private pCount = 0;

  /** coarse flow grid for advection */
  private flow: { lon0: number; lat0: number; dLon: number; dLat: number; nLon: number; nLat: number; u: Float32Array; v: Float32Array; w: Float32Array } | null = null;
  private bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private arrowSig = '';
  private maxWindKn = 0;

  constructor(palette: ScenePalette) {
    this.group.name = 'weather';

    // arrow: shaft + head merged, pointing along +z
    const shaft = new THREE.CylinderGeometry(0.05, 0.05, 0.72, 5);
    shaft.rotateX(Math.PI / 2);
    shaft.translate(0, 0, -0.14);
    const head = new THREE.ConeGeometry(0.17, 0.34, 6);
    head.rotateX(Math.PI / 2);
    head.translate(0, 0, 0.38);
    const tail = new THREE.ConeGeometry(0.1, 0.2, 5);
    tail.rotateX(-Math.PI / 2);
    tail.translate(0, 0, -0.52);
    this.arrowGeo = merge([shaft, head, tail]);

    this.arrowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.9,
    });
    this.arrows = new THREE.InstancedMesh(this.arrowGeo, this.arrowMat, 1024);
    this.arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrows.frustumCulled = false;
    this.arrows.raycast = () => {};
    this.arrows.count = 0;
    this.arrows.name = 'wind-arrows';

    // particles
    this.px = new Float32Array(MAX_PARTICLES);
    this.pz = new Float32Array(MAX_PARTICLES);
    this.plife = new Float32Array(MAX_PARTICLES);
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const life = new Float32Array(MAX_PARTICLES);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(palette.accent) },
        uSize: { value: 3.2 },
        uPixelRatio: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.pMat);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.points.renderOrder = 8;

    this.group.add(this.arrows, this.points);
  }

  setPixelRatio(r: number) {
    this.pMat.uniforms.uPixelRatio.value = r;
  }

  /** Highest wind speed in the current field — drives ocean state. */
  get peakWindKn(): number {
    return this.maxWindKn;
  }

  update(cells: WindCellSpec[], opts: {
    visible: boolean; particles: boolean; palette: ScenePalette;
    time: number; dt: number; heightAt: (x: number, z: number) => number; exaggeration: number;
    kmPerPixel: number;
  }) {
    this.group.visible = opts.visible;
    if (!opts.visible) return;

    // ── barbs ──────────────────────────────────────────────────────────
    const sig = cells.length + ':' + (cells[0] ? `${cells[0].lat.toFixed(2)},${cells[0].windSpeedKn.toFixed(1)}` : '');
    if (sig !== this.arrowSig) {
      this.arrowSig = sig;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const c = new THREE.Color();
      let n = 0;
      let maxKn = 0;
      for (const cell of cells) {
        if (n >= 1024) break;
        const sp = sceneXZ(cell.lon, cell.lat);
        const y = Math.max(0, opts.heightAt(sp.x, sp.z)) * opts.exaggeration + 14;
        const len = Math.max(10, opts.kmPerPixel * (10 + cell.windSpeedKn * 0.55));
        // blow TOWARD (dir + 180); +z is the arrow's forward axis
        const to = (cell.windDirDeg + 180) * DEG;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -to);
        m.compose(
          new THREE.Vector3(sp.x, y, sp.z),
          q,
          new THREE.Vector3(len * 0.55, len * 0.55, len),
        );
        this.arrows.setMatrixAt(n, m);
        c.copy(speedColor(cell.windSpeedKn, opts.palette));
        this.arrows.setColorAt(n, c);
        maxKn = Math.max(maxKn, cell.windSpeedKn);
        n++;
      }
      this.arrows.count = n;
      this.arrows.instanceMatrix.needsUpdate = true;
      if (this.arrows.instanceColor) this.arrows.instanceColor.needsUpdate = true;
      this.maxWindKn = maxKn;
      this.buildFlow(cells);
    }

    // ── particle advection ─────────────────────────────────────────────
    this.points.visible = opts.particles && !!this.flow;
    if (!opts.particles || !this.flow) return;
    if (this.pCount === 0) this.seed(opts.time);

    const dt = Math.min(0.05, opts.dt);
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const life = this.points.geometry.getAttribute('aLife') as THREE.BufferAttribute;
    const speedScale = opts.kmPerPixel * 260;
    for (let i = 0; i < this.pCount; i++) {
      const s = this.sample(this.px[i], this.pz[i]);
      if (s) {
        this.px[i] += s.u * speedScale * dt;
        this.pz[i] += s.v * speedScale * dt;
      }
      this.plife[i] += dt * 0.16;
      const out =
        this.px[i] < this.bounds.minX || this.px[i] > this.bounds.maxX ||
        this.pz[i] < this.bounds.minZ || this.pz[i] > this.bounds.maxZ ||
        this.plife[i] > 1 || !s;
      if (out) {
        this.respawn(i);
      }
      pos.setXYZ(i, this.px[i], this.surfaceY(i, opts), this.pz[i]);
      life.setX(i, this.plife[i]);
    }
    pos.needsUpdate = true;
    life.needsUpdate = true;
    this.pMat.uniforms.uColor.value.set(opts.palette.accent);
  }

  private surfaceY(i: number, opts: { heightAt: (x: number, z: number) => number; exaggeration: number }): number {
    return Math.max(0, opts.heightAt(this.px[i], this.pz[i])) * opts.exaggeration + 10;
  }

  private seed(t: number) {
    this.pCount = Math.min(MAX_PARTICLES, 1600);
    for (let i = 0; i < this.pCount; i++) {
      this.respawn(i);
      this.plife[i] = ((i * 0.6180339887 + t * 0.01) % 1);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private respawn(i: number) {
    const b = this.bounds;
    this.px[i] = b.minX + Math.random() * (b.maxX - b.minX);
    this.pz[i] = b.minZ + Math.random() * (b.maxZ - b.minZ);
    this.plife[i] = 0;
  }

  /** Re-grid the irregular wind cells onto a coarse regular lattice. */
  private buildFlow(cells: WindCellSpec[]) {
    if (cells.length === 0) {
      this.flow = null;
      return;
    }
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const c of cells) {
      minLon = Math.min(minLon, c.lon); maxLon = Math.max(maxLon, c.lon);
      minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat);
    }
    const dLon = Math.max(0.5, (maxLon - minLon) / 40);
    const dLat = Math.max(0.4, (maxLat - minLat) / 24);
    const nLon = Math.max(2, Math.round((maxLon - minLon) / dLon) + 1);
    const nLat = Math.max(2, Math.round((maxLat - minLat) / dLat) + 1);
    const u = new Float32Array(nLon * nLat);
    const v = new Float32Array(nLon * nLat);
    const w = new Float32Array(nLon * nLat);
    const acc = new Float32Array(nLon * nLat);
    for (const c of cells) {
      const i = Math.min(nLon - 1, Math.max(0, Math.round((c.lon - minLon) / dLon)));
      const j = Math.min(nLat - 1, Math.max(0, Math.round((c.lat - minLat) / dLat)));
      const to = (c.windDirDeg + 180) * DEG;
      const s = c.windSpeedKn / 30;
      const k = j * nLon + i;
      u[k] += Math.sin(to) * s;
      v[k] += -Math.cos(to) * s;
      w[k] += c.windSpeedKn;
      acc[k] += 1;
    }
    for (let k = 0; k < acc.length; k++) {
      if (acc[k] > 0) { u[k] /= acc[k]; v[k] /= acc[k]; w[k] /= acc[k]; }
    }
    // fill empty nodes from the field mean so particles never stall
    let mu = 0, mv = 0, mw = 0, cnt = 0;
    for (let k = 0; k < acc.length; k++) if (acc[k] > 0) { mu += u[k]; mv += v[k]; mw += w[k]; cnt++; }
    if (cnt > 0) { mu /= cnt; mv /= cnt; mw /= cnt; }
    for (let k = 0; k < acc.length; k++) {
      if (acc[k] === 0) { u[k] = mu; v[k] = mv; w[k] = mw; }
    }
    this.flow = { lon0: minLon, lat0: minLat, dLon, dLat, nLon, nLat, u, v, w };

    const a = sceneXZ(minLon, minLat);
    const b = sceneXZ(maxLon, maxLat);
    const c = sceneXZ(minLon, maxLat);
    const d = sceneXZ(maxLon, minLat);
    this.bounds = {
      minX: Math.min(a.x, b.x, c.x, d.x),
      maxX: Math.max(a.x, b.x, c.x, d.x),
      minZ: Math.min(a.z, b.z, c.z, d.z),
      maxZ: Math.max(a.z, b.z, c.z, d.z),
    };
    this.pCount = 0;
  }

  /**
   * Flow lookup. Particles live in scene km, the flow lattice in lon/lat, so
   * the position is inverted once per particle (O(1)) instead of scanning the
   * lattice — 1 600 particles × 60 fps has to stay off the hot path.
   */
  private sample(x: number, z: number): { u: number; v: number } | null {
    const f = this.flow;
    if (!f) return null;
    const g = unproject(x, z);
    const i = Math.round((g.lon - f.lon0) / f.dLon);
    const j = Math.round((g.lat - f.lat0) / f.dLat);
    if (i < 0 || j < 0 || i >= f.nLon || j >= f.nLat) return null;
    const k = j * f.nLon + i;
    const mag = Math.hypot(f.u[k], f.v[k]);
    if (mag < 1e-4) return null;
    return { u: f.u[k] / mag, v: f.v[k] / mag };
  }

  setPalette(p: ScenePalette) {
    this.pMat.uniforms.uColor.value.set(p.accent);
  }

  dispose() {
    this.arrowGeo.dispose();
    this.arrowMat.dispose();
    this.arrows.dispose();
    this.points.geometry.dispose();
    this.pMat.dispose();
  }
}

/** tiny merge helper (avoids pulling BufferGeometryUtils into this module) */
function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const arrays: number[][] = [];
  let total = 0;
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute('position') as THREE.BufferAttribute;
    const a: number[] = [];
    for (let i = 0; i < p.count; i++) a.push(p.getX(i), p.getY(i), p.getZ(i));
    arrays.push(a);
    total += a.length;
    if (ng !== g) ng.dispose();
  }
  const out = new Float32Array(total);
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(out, 3));
  bg.computeVertexNormals();
  geos.forEach((g) => g.dispose());
  return bg;
}
