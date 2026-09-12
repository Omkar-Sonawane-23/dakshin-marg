/**
 * Sea ice / risk surface — a spatially layered 3D field.
 *
 * Instead of flat opaque polygons the concentration grid is drawn as a
 * translucent, textured, slightly elevated ice sheet:
 *
 *   · one `DataTexture` carries every channel the app already has
 *     (R = concentration %, G = forecast σ, B = risk severity index);
 *   · the mesh is draped on the real grid nodes, lifted in proportion to
 *     concentration so pack ice has visible thickness and leads read as gaps;
 *   · a procedural floe/crack texture keeps the surface from looking like a
 *     colour swatch, and the fragment shader derives ridge shading from it;
 *   · hazardous boundaries glow: the shader takes the local concentration
 *     gradient and lights the edge of the pack (and of every HIGH/CRITICAL
 *     risk cell) so "where navigation becomes difficult" is legible at a
 *     glance.
 *
 * Everything is driven by the same grid objects the 2D canvas renderer used —
 * no invented data.
 */
import * as THREE from 'three';
import { project } from '../lib/projection';
import type { ScenePalette } from './palette';
import { fogUniforms } from './uniforms';

export interface FieldGrid {
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
  nLon: number;
  nLat: number;
}

export type IceMode = 'CONCENTRATION' | 'SIGMA' | 'SEVERITY';

interface FieldInput {
  grid: FieldGrid;
  /** concentration 0–100, −1 = no data */
  values?: number[][] | null;
  /** forecast σ in % concentration */
  sigma?: number[][] | null;
  /** risk severity index into `severityScale`, −1 = no data */
  severity?: number[][] | null;
}

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uField;
uniform vec2 uTexel;
uniform vec2 uCells;          // grid cell count (x = lon, y = lat)
uniform float uMode;          // 0 concentration · 1 sigma · 2 severity
uniform float uTime;
uniform float uOpacity;
uniform vec3 uThin, uThick, uEdge;
uniform vec3 uSigmaCol;
uniform vec3 uLow, uMed, uHigh, uCrit;
uniform vec3 uLightDir;
uniform float uGlow;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;

#include <fog_pars_fragment>

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec4 s = texture2D(uField, vUv);
  float valid = s.a;
  if (valid < 0.5) discard;

  float conc = s.r * 100.0;
  float sigma = s.g * 30.0;
  float sev = s.b * 3.0;

  vec3 col;
  float alpha;

  if (uMode < 0.5) {
    // ── sea-ice concentration ─────────────────────────────────────────
    if (conc < 8.0) discard;
    float t = clamp((conc - 8.0) / 84.0, 0.0, 1.0);
    // floe texture: two noise octaves carve leads and pressure ridges
    vec2 q = vWorld.xz * 0.02;
    float floe = vnoise(q * 1.0) * 0.6 + vnoise(q * 3.7 + 11.0) * 0.4;
    float lead = smoothstep(0.30, 0.18, floe) * (1.0 - t * 0.75);
    if (t < 0.35 && lead > 0.55) discard;

    col = mix(uThin, uThick, smoothstep(0.0, 1.0, t));
    // ridge shading from the same noise, lit by the key light
    float ridge = (vnoise(q * 6.3) - 0.5) * 0.55;
    col *= 0.86 + 0.34 * clamp(dot(normalize(vNormal + vec3(ridge, 0.0, ridge * 0.6)), uLightDir), 0.0, 1.4);
    alpha = (0.20 + 0.68 * t) * uOpacity;
    alpha *= (1.0 - lead * 0.55);

    // pack-edge glow: strong local gradient = the ice margin
    float gx = texture2D(uField, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uField, vUv - vec2(uTexel.x, 0.0)).r;
    float gy = texture2D(uField, vUv + vec2(0.0, uTexel.y)).r - texture2D(uField, vUv - vec2(0.0, uTexel.y)).r;
    float grad = length(vec2(gx, gy)) * 100.0;
    float margin = smoothstep(4.0, 16.0, grad) * (0.35 + 0.65 * t);
    col += uEdge * margin * uGlow * (0.55 + 0.45 * sin(uTime * 0.9));
    // hazardous pack (>= 80 %) gets a quiet warm rim
    col += uHigh * smoothstep(80.0, 98.0, conc) * 0.16 * uGlow;
  } else if (uMode < 1.5) {
    // ── forecast uncertainty σ ────────────────────────────────────────
    if (sigma < 2.0) discard;
    float t = clamp((sigma - 2.0) / 18.0, 0.0, 1.0);
    col = mix(uThin, uSigmaCol, t);
    alpha = (0.14 + 0.6 * t) * uOpacity;
    vec2 q = vWorld.xz * 0.03;
    col *= 0.9 + 0.25 * vnoise(q);
  } else {
    // ── navigation risk severity ──────────────────────────────────────
    if (sev < 0.5) discard;                 // LOW / nodata stay clear
    vec3 c = sev < 1.5 ? uMed : sev < 2.5 ? uHigh : uCrit;
    float pulse = sev > 2.5 ? (0.62 + 0.38 * sin(uTime * 2.2)) : 1.0;
    col = c * pulse;
    alpha = (sev < 1.5 ? 0.20 : sev < 2.5 ? 0.30 : 0.40) * uOpacity;
    // volumetric feel: cell borders stay denser, interiors breathe
    float dCell = min(fract(vUv.y * uCells.y), 1.0 - fract(vUv.y * uCells.y));
    alpha *= 1.0 - 0.35 * smoothstep(0.02, 0.16, dCell);
    if (sev > 2.5) col += uCrit * 0.25 * pulse * uGlow;
  }

  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
`;

export class SeaIceLayer {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  private texture: THREE.DataTexture | null = null;
  private key = '';

  constructor() {
    this.group.name = 'seaIce';
  }

  /** (Re)build only when the grid geometry changes; otherwise just re-upload. */
  update(input: FieldInput | null, mode: IceMode, palette: ScenePalette, glow: number) {
    if (!input) {
      this.clear();
      return;
    }
    const g = input.grid;
    const key = `${g.lon0}|${g.lat0}|${g.dLon}|${g.dLat}|${g.nLon}|${g.nLat}`;
    if (key !== this.key || !this.mesh) {
      this.rebuild(g, input);
      this.key = key;
    }
    this.upload(input);
    if (!this.mat) return;
    const u = this.mat.uniforms;
    u.uMode.value = mode === 'SIGMA' ? 1 : mode === 'SEVERITY' ? 2 : 0;
    u.uThin.value.set(palette.iceThin);
    u.uThick.value.set(palette.iceThick);
    u.uEdge.value.set(palette.iceEdgeGlow);
    u.uSigmaCol.value.set(palette.model);
    u.uLow.value.set(palette.safe);
    u.uMed.value.set(palette.caution);
    u.uHigh.value.set(palette.danger);
    u.uCrit.value.set(palette.critical);
    u.uGlow.value = glow;
    this.group.visible = true;
  }

  private rebuild(g: FieldGrid, input: FieldInput) {
    this.disposeMesh();
    const nx = g.nLon;
    const ny = g.nLat;
    const pos = new Float32Array(nx * ny * 3);
    const uv = new Float32Array(nx * ny * 2);
    let v = 0;
    for (let j = 0; j < ny; j++) {
      const lat = g.lat0 + j * g.dLat;
      for (let i = 0; i < nx; i++) {
        const lon = g.lon0 + i * g.dLon;
        const p = project(lon, lat);
        pos[v * 3] = p.x;
        pos[v * 3 + 1] = 0;
        pos[v * 3 + 2] = p.y;
        uv[v * 2] = nx > 1 ? i / (nx - 1) : 0;
        uv[v * 2 + 1] = ny > 1 ? j / (ny - 1) : 0;
        v++;
      }
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let k = 0;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));

    const tex = new THREE.DataTexture(new Uint8Array(nx * ny * 4), nx, ny, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...fogUniforms(),
        uField: { value: tex },
          uTexel: { value: new THREE.Vector2(1 / nx, 1 / ny) },
          uCells: { value: new THREE.Vector2(nx, ny) },
          uMode: { value: 0 },
          uTime: { value: 0 },
          uOpacity: { value: 1 },
          uGlow: { value: 1 },
          uThin: { value: new THREE.Color() },
          uThick: { value: new THREE.Color() },
          uEdge: { value: new THREE.Color() },
          uSigmaCol: { value: new THREE.Color() },
          uLow: { value: new THREE.Color() },
          uMed: { value: new THREE.Color() },
          uHigh: { value: new THREE.Color() },
          uCrit: { value: new THREE.Color() },
        uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'seaIceMesh';
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.texture = tex;
    this.lift(input);
    geo.computeVertexNormals();
  }

  /** Raise pack ice out of the water in proportion to concentration. */
  private lift(input: FieldInput) {
    if (!this.mesh) return;
    const g = input.grid;
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vals = input.values;
    let v = 0;
    for (let j = 0; j < g.nLat; j++) {
      for (let i = 0; i < g.nLon; i++) {
        const c = vals ? vals[j][i] : -1;
        const t = c > 0 ? Math.min(1, c / 100) : 0;
        pos.setY(v, 0.6 + Math.pow(t, 1.6) * 9.0);
        v++;
      }
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
  }

  private upload(input: FieldInput) {
    const tex = this.texture;
    if (!tex) return;
    const g = input.grid;
    const arr = tex.image.data as Uint8Array;
    let v = 0;
    for (let j = 0; j < g.nLat; j++) {
      for (let i = 0; i < g.nLon; i++) {
        const conc = input.values ? input.values[j][i] : -1;
        const sig = input.sigma ? input.sigma[j][i] : -1;
        const sev = input.severity ? input.severity[j][i] : -1;
        const o = v * 4;
        arr[o] = conc > 0 ? Math.min(255, Math.round(conc * 2.55)) : 0;
        arr[o + 1] = sig > 0 ? Math.min(255, Math.round((sig / 30) * 255)) : 0;
        arr[o + 2] = sev > 0 ? Math.round((sev / 3) * 255) : 0;
        arr[o + 3] = (conc > 0 || sig > 0 || sev >= 0) ? 255 : 0;
        v++;
      }
    }
    tex.needsUpdate = true;
  }

  updateAnimated(t: number) {
    if (this.mat) this.mat.uniforms.uTime.value = t;
  }

  setOpacity(o: number) {
    if (this.mat) this.mat.uniforms.uOpacity.value = o;
  }

  clear() {
    this.group.visible = false;
  }

  private disposeMesh() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    this.texture?.dispose();
    this.texture = null;
    this.mat = null;
  }

  dispose() {
    this.disposeMesh();
  }
}
