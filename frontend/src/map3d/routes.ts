/**
 * Routes — spatial navigation paths integrated into the terrain.
 *
 * Each route is a tube that follows the real relief (sampled from the same
 * `ReliefProvider` the terrain uses) and floats a few hundred metres clear of
 * the surface, so it reads as a course laid over the environment rather than a
 * line pasted on a picture.
 *
 * Visual grammar (unchanged in meaning from the 2D renderer):
 *   · solid bright core + additive fresnel glow   → active / recommended
 *   · scrolling flow animation                    → the leg being sailed
 *   · dashes                                      → alternative / candidate
 *   · red + fade                                  → superseded / old
 * Direction cones are instanced along the tube; waypoint nodes sit on short
 * stalks so they stay legible against ice.
 */
import * as THREE from 'three';
import { densify } from '../lib/geo';
import { scenePoint } from './coords';
import type { ScenePalette } from './palette';
import { fogUniforms } from './uniforms';

export interface RouteSpec {
  id: string;
  waypoints: { lon: number; lat: number }[];
  color: number;
  /** 0 = solid; >0 = number of dash periods along the whole route */
  dash: number;
  /** core tube radius multiplier */
  width: number;
  emphasized: boolean;
  dimmed: boolean;
  animated: boolean;
  waypointsVisible: boolean;
  /** optional mid-route label anchor (0..1) */
  labelAt?: number;
  /** world anchor the label should attach to (filled in by the layer) */
  labelAnchor?: THREE.Vector3;
}

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uTime;
uniform float uDash;
uniform float uFlow;
uniform float uOpacity;
uniform float uGlow;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
#include <fog_pars_fragment>

void main() {
  // dash mask (0.55 duty cycle), expressed in whole-route periods
  float dash = uDash > 0.5 ? step(0.45, fract(vUv.x * uDash)) : 1.0;
  if (dash < 0.5) discard;

  // travelling flow packets — 3 along the leg, moving toward the destination
  float flowPhase = fract(vUv.x * 3.0 - uTime * uFlow);
  float flow = uFlow > 0.01 ? smoothstep(0.0, 0.10, flowPhase) * smoothstep(0.34, 0.18, flowPhase) : 0.0;

  // fresnel rim → the tube glows at its silhouette
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - clamp(abs(dot(normalize(vNormal), V)), 0.0, 1.0), 1.7);

  vec3 col = uColor * (0.55 + 0.75 * rim + 1.5 * flow);
  float a = uOpacity * (0.45 + 0.55 * rim + 0.6 * flow);
  a *= uGlow;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <fog_fragment>
}
`;

interface BuiltRoute {
  id: string;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  pick: THREE.Mesh;
  nodes: THREE.Group;
  arrows: THREE.InstancedMesh;
  mat: THREE.ShaderMaterial;
  glowMat: THREE.ShaderMaterial;
  color: number;
  labelAnchor: THREE.Vector3;
}

export class RouteLayer {
  readonly group = new THREE.Group();
  private built = new Map<string, BuiltRoute>();
  private sig = '';
  private arrowGeo = new THREE.ConeGeometry(1, 2.4, 6);
  private nodeGeo = new THREE.OctahedronGeometry(1, 0);
  private stalkGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 5);

  constructor() {
    this.group.name = 'routes';
    this.arrowGeo.rotateX(Math.PI / 2); // point along +z (curve tangent)
  }

  update(
    routes: RouteSpec[],
    opts: {
      visible: boolean;
      palette: ScenePalette;
      time: number;
      kmPerPixel: number;
      heightAt: (x: number, z: number) => number;
      liftKm: number;
      exaggeration: number;
    },
  ) {
    this.group.visible = opts.visible;
    if (!opts.visible) return;

    const sig = routes
      .map((r) => `${r.id}:${r.waypoints.length}:${r.color}:${r.dash}:${r.width}:${r.emphasized ? 1 : 0}:${r.animated ? 1 : 0}:${r.waypointsVisible ? 1 : 0}`)
      .join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.rebuild(routes, opts);
    }

    for (const r of routes) {
      const b = this.built.get(r.id);
      if (!b) continue;
      const u = b.mat.uniforms;
      u.uColor.value.set(r.color);
      u.uDash.value = r.dash;
      u.uFlow.value = r.animated ? 0.55 : 0;
      u.uOpacity.value = r.dimmed ? 0.35 : 1;
      u.uGlow.value = r.emphasized ? 1.25 : 0.9;
      u.uTime.value = opts.time;
      const gu = b.glowMat.uniforms;
      gu.uColor.value.set(r.color);
      gu.uTime.value = opts.time;
      gu.uFlow.value = r.animated ? 0.55 : 0;
      gu.uDash.value = r.dash;
      gu.uOpacity.value = (r.dimmed ? 0.15 : r.emphasized ? 0.5 : 0.28);
      gu.uGlow.value = 1;
      b.glow.visible = !r.dimmed;
      b.nodes.visible = r.waypointsVisible && !r.dimmed;
      b.arrows.visible = !r.dimmed;
      b.core.renderOrder = r.emphasized ? 12 : 10;
    }
  }

  private rebuild(routes: RouteSpec[], opts: {
    palette: ScenePalette; kmPerPixel: number;
    heightAt: (x: number, z: number) => number; liftKm: number; exaggeration: number;
  }) {
    this.disposeAll();
    const radius = Math.max(1.6, opts.kmPerPixel * 2.2);

    for (const r of routes) {
      if (r.waypoints.length < 2) continue;
      const dense = densify(r.waypoints, 12);
      const pts = dense.map((p) => {
        const sp = scenePoint(p.lon, p.lat, 0);
        const h = opts.heightAt(sp.x, sp.z);
        const base = Math.max(0, h) * opts.exaggeration;
        return new THREE.Vector3(sp.x, base + opts.liftKm + radius * 1.5, sp.z);
      });
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.4);
      const tubular = Math.min(900, Math.max(64, dense.length * 6));
      const coreGeo = new THREE.TubeGeometry(curve, tubular, radius * r.width, 8, false);
      const glowGeo = new THREE.TubeGeometry(curve, Math.round(tubular * 0.6), radius * r.width * 3.4, 8, false);

      const mat = this.makeMat(r.color, r.dash, r.animated);
      const glowMat = this.makeMat(r.color, r.dash, r.animated);

      const core = new THREE.Mesh(coreGeo, mat);
      core.renderOrder = 10;
      core.raycast = () => {};
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.renderOrder = 9;
      glow.raycast = () => {};

      // generous invisible pick tube
      const pickGeo = new THREE.TubeGeometry(curve, Math.min(220, tubular), radius * 7, 6, false);
      const pick = new THREE.Mesh(pickGeo, new THREE.MeshBasicMaterial({ visible: false }));
      pick.name = `route:${r.id}`;
      pick.userData.routeId = r.id;

      // waypoint nodes on stalks
      const nodes = new THREE.Group();
      const nodeMat = new THREE.MeshStandardMaterial({
        color: r.color, emissive: new THREE.Color(r.color), emissiveIntensity: 0.5, roughness: 0.4,
      });
      const stalkMat = new THREE.MeshBasicMaterial({ color: r.color, transparent: true, opacity: 0.4 });
      r.waypoints.forEach((w, i) => {
        const sp = scenePoint(w.lon, w.lat, 0);
        const h = opts.heightAt(sp.x, sp.z);
        const groundY = Math.max(0, h) * opts.exaggeration;
        const topY = pts[Math.round((i / Math.max(1, r.waypoints.length - 1)) * (pts.length - 1))].y;
        const node = new THREE.Mesh(this.nodeGeo, nodeMat);
        node.position.set(sp.x, topY, sp.z);
        node.scale.setScalar(radius * 1.5);
        node.raycast = () => {};
        nodes.add(node);
        const stalk = new THREE.Mesh(this.stalkGeo, stalkMat);
        const hgt = Math.max(1, topY - groundY);
        stalk.scale.set(radius * 0.5, hgt, radius * 0.5);
        stalk.position.set(sp.x, groundY + hgt / 2, sp.z);
        stalk.raycast = () => {};
        nodes.add(stalk);
      });

      // direction cones
      const nArrows = Math.min(24, Math.max(6, Math.floor(pts.length / 22)));
      const arrowMat = new THREE.MeshStandardMaterial({
        color: r.color, emissive: new THREE.Color(r.color), emissiveIntensity: 0.7, roughness: 0.35,
        transparent: true, opacity: 0.95,
      });
      const arrows = new THREE.InstancedMesh(this.arrowGeo, arrowMat, nArrows);
      arrows.raycast = () => {};
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < nArrows; i++) {
        const t = (i + 0.5) / nArrows;
        const p = curve.getPointAt(t);
        const tan = curve.getTangentAt(t).normalize();
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
        m4.compose(p, q, new THREE.Vector3(radius * 1.5, radius * 1.5, radius * 1.5));
        arrows.setMatrixAt(i, m4);
      }
      arrows.instanceMatrix.needsUpdate = true;

      const labelAnchor = curve.getPointAt(Math.min(0.98, Math.max(0.02, r.labelAt ?? 0.5)));
      r.labelAnchor = labelAnchor.clone();

      const g = new THREE.Group();
      g.name = `route-group:${r.id}`;
      g.add(glow, core, pick, nodes, arrows);
      this.group.add(g);
      this.built.set(r.id, {
        id: r.id, core, glow, pick, nodes, arrows, mat, glowMat, color: r.color, labelAnchor,
      });
    }
  }

  private makeMat(color: number, dash: number, animated: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...fogUniforms(),
        uColor: { value: new THREE.Color(color) },
          uTime: { value: 0 },
          uDash: { value: dash },
          uFlow: { value: animated ? 0.55 : 0 },
        uOpacity: { value: 1 },
        uGlow: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
  }

  /** Route ids under a raycast hit list. */
  pickables(): THREE.Object3D[] {
    return [...this.built.values()].map((b) => b.pick);
  }

  anchorFor(id: string): THREE.Vector3 | null {
    return this.built.get(id)?.labelAnchor ?? null;
  }

  private disposeAll() {
    for (const b of this.built.values()) {
      this.group.remove(b.core.parent as THREE.Group);
      b.core.geometry.dispose();
      b.glow.geometry.dispose();
      b.pick.geometry.dispose();
      (b.pick.material as THREE.Material).dispose();
      b.mat.dispose();
      b.glowMat.dispose();
      b.nodes.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.material) (m.material as THREE.Material).dispose();
      });
      b.arrows.dispose();
      (b.arrows.material as THREE.Material).dispose();
    }
    this.built.clear();
  }

  dispose() {
    this.disposeAll();
    this.arrowGeo.dispose();
    this.nodeGeo.dispose();
    this.stalkGeo.dispose();
  }
}
