/**
 * Shader validator — the closest thing to a GPU we have in CI.
 *
 * No browser binary can be installed in this sandbox, so a shader that fails
 * to compile would only show up as a black map for the user. This rebuilds
 * every custom `ShaderMaterial` the 3D layers create, expands it exactly the
 * way `WebGLProgram` does (prefix + `#include` resolution), and then
 *
 *   · parses the GLSL (syntax),
 *   · checks every varying used in the fragment stage is emitted by the
 *     vertex stage — the classic "fog declared but never written" bug,
 *   · checks every uniform the shader reads is actually supplied.
 *
 * Run: npx tsx scripts/verify-shaders.ts
 */
import * as THREE from 'three';
// The GLSL parser lives outside the repo (it is a verification-only tool, not
// a product dependency) and is CommonJS, so it is loaded through require.
import { createRequire } from 'node:module';
const glslParser = createRequire(import.meta.url)(
  '/tmp/verify/node_modules/@shaderfrog/glsl-parser/index.js',
) as { parser: { parse: (src: string, opt?: unknown) => unknown } };
import { SeaIceLayer } from '../src/map3d/seaIce';
import { RouteLayer } from '../src/map3d/routes';
import { Ocean } from '../src/map3d/ocean';
import { WeatherLayer } from '../src/map3d/weather';
import { DARK_PALETTE } from '../src/map3d/palette';

let failures = 0;
const note = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

// ── the prefix three.js prepends to a GLSL ES 1.00 shader ───────────────
const VERT_PREFIX = `
precision highp float;
precision highp int;
#define HIGH_PRECISION
#define SHADER_NAME x
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
`;
const FRAG_PREFIX = `
precision highp float;
precision highp int;
#define HIGH_PRECISION
#define SHADER_NAME x
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
`;

function resolveIncludes(src: string, seen = new Set<string>()): string {
  return src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => {
    const chunk = (THREE.ShaderChunk as unknown as Record<string, string>)[name];
    if (chunk === undefined) {
      failures++;
      console.log(`FAIL  unknown shader chunk <${name}>`);
      return '';
    }
    if (seen.has(name)) return chunk;
    seen.add(name);
    return resolveIncludes(chunk, seen);
  });
}

/** Mimic the defines WebGLProgram injects for a fog-enabled material. */
function definesFor(mat: THREE.ShaderMaterial): string {
  const d: string[] = [];
  if (mat.fog) {
    d.push('#define USE_FOG');
    // the scene uses THREE.Fog (linear), not FogExp2
  }
  if (mat.transparent) d.push('');
  return d.join('\n');
}

interface Target { name: string; mat: THREE.ShaderMaterial }

function collect(): Target[] {
  const out: Target[] = [];

  // sea ice / risk raster
  const ice = new SeaIceLayer();
  const grid = { lon0: 60, lat0: -70, dLon: 1, dLat: 0.5, nLon: 8, nLat: 6 };
  const values = Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => 55));
  const sigma = Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => 6));
  const severity = Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => 2));
  for (const mode of ['CONCENTRATION', 'SIGMA', 'SEVERITY'] as const) {
    ice.update({ grid, values, sigma, severity }, mode, DARK_PALETTE, 1);
    const m = (ice.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    out.push({ name: `seaIce[${mode}]`, mat: m });
  }

  // routes (core + glow share one shader)
  const rl = new RouteLayer();
  rl.update(
    [{
      id: 'r1',
      waypoints: [{ lon: 60, lat: -57.5 }, { lon: 70, lat: -63 }, { lon: 76.19, lat: -69.35 }],
      color: 0x46cfe4, dash: 0, width: 1.4, emphasized: true, dimmed: false,
      animated: true, waypointsVisible: true,
    }],
    {
      visible: true, palette: DARK_PALETTE, time: 0, kmPerPixel: 3,
      heightAt: () => 0, liftKm: 2.4, exaggeration: 26,
    },
  );
  const routeMats = new Set<THREE.ShaderMaterial>();
  rl.group.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m && (m as THREE.ShaderMaterial).isShaderMaterial) routeMats.add(m as THREE.ShaderMaterial);
  });
  let i = 0;
  for (const m of routeMats) out.push({ name: `route[${i++}]`, mat: m });

  // ocean
  const tex = new THREE.DataTexture(new Uint8Array(16), 4, 4, THREE.RedFormat);
  const ocean = new Ocean(tex, DARK_PALETTE);
  out.push({ name: 'ocean', mat: ocean.mesh.material as THREE.ShaderMaterial });

  // wind particles
  const wx = new WeatherLayer(DARK_PALETTE);
  wx.group.traverse((o) => {
    const m = (o as THREE.Points).material;
    if (m && (m as THREE.ShaderMaterial).isShaderMaterial) out.push({ name: 'windParticles', mat: m as THREE.ShaderMaterial });
  });

  // scene backdrop (lives inside PolarScene, which needs a GL context)
  out.push({
    name: 'backdrop',
    mat: new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vP;
        void main(){ float h = clamp(vP.y / 28000.0 * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 0.75)), 1.0); }`,
    }),
  });

  return out;
}

function declaredVaryings(src: string): Set<string> {
  const s = new Set<string>();
  for (const m of src.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)) s.add(m[1]);
  return s;
}
function assignedNames(src: string): Set<string> {
  const s = new Set<string>();
  for (const m of src.matchAll(/\b(\w+)\s*(?:=[^=]|\.\w+\s*=)/g)) s.add(m[1]);
  return s;
}
function readUniforms(src: string): Set<string> {
  const s = new Set<string>();
  for (const m of src.matchAll(/\buniform\s+\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/g)) s.add(m[1]);
  return s;
}

console.log('\n── shader validation ────────────────────────────────────────────');
const targets = collect();
console.log(`${targets.length} shader materials collected\n`);

for (const { name, mat } of targets) {
  const vSrc = resolveIncludes(definesFor(mat) + VERT_PREFIX + mat.vertexShader);
  const fSrc = resolveIncludes(definesFor(mat) + FRAG_PREFIX + mat.fragmentShader);

  // 1. syntax
  try {
    glslParser.parser.parse(vSrc, { quiet: true });
    glslParser.parser.parse(fSrc, { quiet: true });
    note(true, `${name}: GLSL parses`);
  } catch (e) {
    note(false, `${name}: GLSL parse — ${(e as Error).message.split('\n')[0]}`);
    continue;
  }

  // 2. every varying the fragment stage declares must be emitted by the vertex stage
  const fv = declaredVaryings(fSrc);
  const vv = declaredVaryings(vSrc);
  // scan the *resolved* source: the assignment lives in <fog_vertex> itself
  const vAssigned = assignedNames(vSrc);
  const missing: string[] = [];
  for (const v of fv) {
    if (!vv.has(v)) missing.push(`${v} (not declared in vertex stage)`);
    else if (!vAssigned.has(v)) missing.push(`${v} (declared but never written)`);
  }
  note(missing.length === 0, `${name}: varyings wired${missing.length ? ' — ' + missing.join(', ') : ''}`);

  // 3. every uniform the shader declares is supplied by the material
  const needed = new Set([...readUniforms(vSrc), ...readUniforms(fSrc)]);
  const supplied = new Set(Object.keys(mat.uniforms));
  // three injects these itself
  const injected = new Set(['modelMatrix', 'modelViewMatrix', 'projectionMatrix', 'viewMatrix',
    'normalMatrix', 'cameraPosition', 'isOrthographic']);
  const unsupplied = [...needed].filter((u) => !supplied.has(u) && !injected.has(u));
  note(unsupplied.length === 0, `${name}: uniforms supplied${unsupplied.length ? ' — missing ' + unsupplied.join(', ') : ''}`);

  // 4. no stale include directives left behind
  note(!/#include\s*</.test(vSrc) && !/#include\s*</.test(fSrc), `${name}: all #include resolved`);
}

console.log(`\n${failures === 0 ? 'ALL SHADER CHECKS PASSED' : `${failures} SHADER CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
