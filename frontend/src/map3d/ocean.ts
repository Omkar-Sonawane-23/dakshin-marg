/**
 * Southern Ocean — a subtle animated 3D water surface.
 *
 * The surface is opaque (cheap, correctly sorted with the ice layer above it)
 * but communicates depth: it samples the coastline signed-distance field so
 * the continental shelf reads as shoaling teal and the abyssal plain as deep
 * navy, with an animated shoreline foam line where the water meets the ice.
 * Waves are analytic (normal perturbation + long swells) — no textures, no
 * per-frame CPU work.
 */
import * as THREE from 'three';
import { TERRAIN_RADIUS_KM } from './relief';
import type { ScenePalette } from './palette';
import { fogUniforms } from './uniforms';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uSwell;
varying vec3 vWorld;
varying vec2 vUv;
#include <fog_pars_vertex>

void main() {
  vUv = uv;
  vec3 p = position;
  // long-period Southern Ocean swell (km-scale, deliberately restrained)
  float w = sin(p.x * 0.0016 + uTime * 0.35) * cos(p.y * 0.0013 - uTime * 0.27)
          + 0.5 * sin(p.x * 0.0042 - p.y * 0.0031 + uTime * 0.5);
  p.z += w * uSwell;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3  uDeep;
uniform vec3  uShallow;
uniform vec3  uFoam;
uniform vec3  uSky;
uniform vec3  uLightDir;
uniform vec3  uLightColor;
uniform float uTime;
uniform float uWaveAmp;
uniform float uOpacity;
uniform sampler2D uDist;
uniform float uDistSpan;
varying vec3 vWorld;
varying vec2 vUv;

#include <fog_pars_fragment>

float wave(vec2 p, float t) {
  return sin(p.x * 0.055 + t * 1.1) * 0.5
       + sin(p.y * 0.041 - t * 0.8) * 0.35
       + sin((p.x + p.y) * 0.027 + t * 0.6) * 0.3;
}

void main() {
  // signed distance to the coastline, km (128/255 == coast)
  float enc = 0.0;
  if (vUv.x >= 0.0 && vUv.x <= 1.0 && vUv.y >= 0.0 && vUv.y <= 1.0) {
    enc = texture2D(uDist, vUv).r;
  }
  float dist = (enc * 255.0 - 128.0) / 127.0 * 500.0;
  if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) {
    dist = -500.0;
  }
  float coastal = exp(-max(dist, 0.0) / 260.0);

  vec3 base = mix(uDeep, uShallow, clamp(coastal, 0.0, 1.0) * 0.85);

  // analytic wave normals
  vec2 p = vWorld.xz * 0.06;
  float e = 0.9;
  float h0 = wave(p, uTime);
  float hx = wave(p + vec2(e, 0.0), uTime);
  float hz = wave(p + vec2(0.0, e), uTime);
  vec3 n = normalize(vec3(-(hx - h0) * uWaveAmp, 1.0, -(hz - h0) * uWaveAmp));

  vec3 V = normalize(cameraPosition - vWorld);
  float diff = clamp(dot(n, uLightDir), 0.0, 1.0);
  vec3 H = normalize(uLightDir + V);
  float spec = pow(clamp(dot(n, H), 0.0, 1.0), 90.0) * 0.55;

  float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
  vec3 col = base * (0.35 + 0.75 * diff) + uLightColor * spec + uSky * fres * 0.35;

  // shoreline foam where the water laps the grounding line
  float foam = smoothstep(26.0, 0.0, abs(dist)) * (0.55 + 0.45 * sin(dist * 0.35 - uTime * 1.6));
  col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.5);

  // bathymetric banding — quiet contouring that reads as depth
  float band = smoothstep(0.46, 0.5, fract(dist * 0.035)) * 0.05;
  col += band * uSky;

  gl_FragColor = vec4(col, uOpacity);
  #include <fog_fragment>
}
`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(distanceTexture: THREE.Texture, palette: ScenePalette) {
    const r = TERRAIN_RADIUS_KM * 1.55;
    const geo = new THREE.CircleGeometry(r, 192);
    // CircleGeometry lies in XY — rotate to XZ and give the UVs a full-square
    // mapping so the distance field (built over a square bbox) lines up.
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = new Float32Array(pos.count * 2);
    const span = TERRAIN_RADIUS_KM;
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + span) / (2 * span);
      uv[i * 2 + 1] = (pos.getZ(i) + span) / (2 * span);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...fogUniforms(),
        uTime: { value: 0 },
          uSwell: { value: 5.0 },
          uWaveAmp: { value: 0.9 },
          uOpacity: { value: 1 },
          uDeep: { value: new THREE.Color(palette.oceanDeep) },
          uShallow: { value: new THREE.Color(palette.oceanShallow) },
          uFoam: { value: new THREE.Color(palette.oceanFoam) },
          uSky: { value: new THREE.Color(palette.iceEdgeGlow) },
          uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
          uLightColor: { value: new THREE.Color(palette.keyLight) },
          uDist: { value: distanceTexture },
        uDistSpan: { value: TERRAIN_RADIUS_KM },
      },
      fog: true,
      transparent: false,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'ocean';
    this.mesh.position.y = -0.001;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.mesh.renderOrder = -10;
  }

  setPalette(p: ScenePalette) {
    this.mat.uniforms.uDeep.value.set(p.oceanDeep);
    this.mat.uniforms.uShallow.value.set(p.oceanShallow);
    this.mat.uniforms.uFoam.value.set(p.oceanFoam);
    this.mat.uniforms.uSky.value.set(p.iceEdgeGlow);
    this.mat.uniforms.uLightColor.value.set(p.keyLight);
  }

  setLight(dir: THREE.Vector3) {
    (this.mat.uniforms.uLightDir.value as THREE.Vector3).copy(dir);
  }

  update(t: number, waves: boolean) {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uWaveAmp.value = waves ? 0.9 : 0.12;
    this.mat.uniforms.uSwell.value = waves ? 5.0 : 0.6;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
