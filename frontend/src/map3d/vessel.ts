/**
 * The vessel — a small procedural icebreaker, not a flat icon.
 *
 * Built from primitives (hull shell, reinforced waterline belt, superstructure
 * blocks, funnel, mast, helideck) and merged into one geometry so the whole
 * ship is a single draw call. It is placed on the water surface, rotated to
 * the reported heading, and carries:
 *   · a heading/navigation sector laid on the sea (the operator's look-ahead),
 *   · a wake ribbon whose length follows speed over ground,
 *   · a selection ring + pulse when inspected.
 *
 * Scale note: a 140 m hull is sub-pixel at chart scale, so the model is
 * clamped to a minimum on-screen length (ECDIS convention). True dimensions
 * are reported in the inspector.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { headingToYaw, sceneXZ } from './coords';
import type { ScenePalette } from './palette';

/** Unit icebreaker (~1 length unit bow→stern, +z forward). */
function buildHull(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // hull: a tapered box, bow raked
  const hull = new THREE.BufferGeometry();
  const L = 1.0, W = 0.19, D = 0.13;
  const v = [
    // deck outline (y = 0) — bow tapered
    [-W * 0.55, 0, L * 0.5], [W * 0.55, 0, L * 0.5],
    [-W, 0, L * 0.22], [W, 0, L * 0.22],
    [-W, 0, -L * 0.5], [W, 0, -L * 0.5],
    // keel (y = -D)
    [-W * 0.45, -D, L * 0.42], [W * 0.45, -D, L * 0.42],
    [-W * 0.8, -D, L * 0.22], [W * 0.8, -D, L * 0.22],
    [-W * 0.8, -D, -L * 0.5], [W * 0.8, -D, -L * 0.5],
  ];
  const f = [
    [0, 1, 3, 2], [4, 5, 11, 10], [2, 3, 9, 8], [0, 2, 8, 6], [1, 4, 10, 7], [5, 1, 7, 11],
    [6, 7, 1, 0],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const p of v) pos.push(p[0], p[1], p[2]);
  let vi = 0;
  for (const q of f) {
    for (const t of [q[0], q[1], q[2]]) idx.push(vi + t);
    for (const t of [q[0], q[2], q[3]]) idx.push(vi + t);
    vi += 4;
  }
  // de-index for flat shading, duplicating per face
  const flatPos: number[] = [];
  for (let i = 0; i < idx.length; i++) {
    const s = idx[i] * 3;
    flatPos.push(pos[s], pos[s + 1], pos[s + 2]);
  }
  hull.setAttribute('position', new THREE.Float32BufferAttribute(flatPos, 3));
  hull.computeVertexNormals();
  hull.userData.color = 0xdfe9f2;
  parts.push(hull);

  const add = (g: THREE.BufferGeometry, color: number) => { g.userData.color = color; parts.push(g); };

  // ice belt along the waterline
  const belt = new THREE.BoxGeometry(W * 2.02, D * 0.55, L * 0.92);
  belt.translate(0, -D * 0.62, -L * 0.02);
  add(belt, 0xff5a4d);

  // superstructure blocks
  const sup1 = new THREE.BoxGeometry(W * 1.5, 0.1, L * 0.24);
  sup1.translate(0, 0.05, -L * 0.05);
  add(sup1, 0xf2f6fa);
  const bridge = new THREE.BoxGeometry(W * 1.62, 0.045, L * 0.085);
  bridge.translate(0, 0.115, L * 0.03);
  add(bridge, 0x1b3a52);
  const sup2 = new THREE.BoxGeometry(W * 1.1, 0.06, L * 0.14);
  sup2.translate(0, 0.128, -L * 0.14);
  add(sup2, 0xe8eef4);

  // funnel
  const funnel = new THREE.CylinderGeometry(W * 0.3, W * 0.34, 0.11, 10);
  funnel.translate(0, 0.2, -L * 0.2);
  add(funnel, 0xffb02e);

  // fore mast + crow's nest
  const mast = new THREE.CylinderGeometry(0.006, 0.008, 0.17, 6);
  mast.translate(0, 0.085, L * 0.3);
  add(mast, 0xc9d6e2);
  const nest = new THREE.SphereGeometry(0.018, 8, 6);
  nest.translate(0, 0.15, L * 0.3);
  add(nest, 0x9fb2c2);

  // helideck aft
  const heli = new THREE.CylinderGeometry(W * 0.62, W * 0.62, 0.008, 18);
  heli.translate(0, 0.162, -L * 0.3);
  add(heli, 0x2f6d4f);

  // crane
  const crane = new THREE.CylinderGeometry(0.007, 0.009, 0.12, 6);
  crane.rotateZ(-0.5);
  crane.translate(W * 0.55, 0.12, L * 0.12);
  add(crane, 0xffb02e);

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('vessel geometry merge failed');
  return merged;
}

export interface VesselSpec {
  name: string;
  lon: number;
  lat: number;
  headingDeg: number;
  speedKn: number;
  /** true length in km (clamped on screen) */
  lengthKm: number;
  selected: boolean;
  moving: boolean;
}

export class VesselLayer {
  readonly group = new THREE.Group();
  private ship: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private cone: THREE.Mesh;
  private coneMat: THREE.MeshBasicMaterial;
  private wake: THREE.Mesh;
  private wakeMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private pickProxy: THREE.Mesh;
  private labelAnchor = new THREE.Vector3();
  visible = false;

  constructor(palette: ScenePalette) {
    this.group.name = 'vessel';
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.55, metalness: 0.15 });
    this.ship = new THREE.Mesh(buildHull(), this.mat);
    this.ship.rotation.order = 'YXZ';
    this.ship.raycast = () => {};
    this.ship.name = 'vessel-hull';

    // navigation sector on the sea
    const sector = new THREE.CircleGeometry(1, 28, -Math.PI / 7, (Math.PI * 2) / 7);
    sector.rotateX(-Math.PI / 2);
    sector.rotateY(Math.PI);
    this.coneMat = new THREE.MeshBasicMaterial({
      color: palette.accent, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
    });
    this.cone = new THREE.Mesh(sector, this.coneMat);
    this.cone.renderOrder = 6;
    this.cone.raycast = () => {};

    // wake
    const wake = new THREE.PlaneGeometry(1, 1, 1, 8);
    wake.translate(0, 0.5, 0);   // span 0 → 1 so the wake trails astern
    wake.rotateX(-Math.PI / 2);
    this.wakeMat = new THREE.MeshBasicMaterial({
      color: 0xdff4ff, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide,
    });
    this.wake = new THREE.Mesh(wake, this.wakeMat);
    this.wake.renderOrder = 6;
    this.wake.raycast = () => {};

    // selection ring
    const ring = new THREE.RingGeometry(0.78, 1, 40);
    ring.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: palette.accent, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(ring, this.ringMat);
    this.ring.renderOrder = 7;
    this.ring.raycast = () => {};

    // generous invisible proxy so the ship stays clickable at any zoom
    this.pickProxy = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 12, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.pickProxy.name = 'vessel-hull';
    this.group.add(this.cone, this.wake, this.ring, this.ship, this.pickProxy);
  }

  update(spec: VesselSpec | null, opts: {
    palette: ScenePalette; kmPerPixel: number; minScreenPx: number;
    time: number; surfaceY: (x: number, z: number) => number; exaggeration: number;
  }) {
    if (!spec) {
      this.visible = false;
      this.group.visible = false;
      return;
    }
    this.visible = true;
    this.group.visible = true;

    const len = Math.max(spec.lengthKm, opts.minScreenPx * opts.kmPerPixel);
    const pos = new THREE.Vector3();
    // resolve scene x/z through the same projection helper used everywhere
    const sp = sceneXZ(spec.lon, spec.lat);
    pos.set(sp.x, opts.surfaceY(sp.x, sp.z) + len * 0.06, sp.z);

    this.pickProxy.position.copy(pos);
    this.pickProxy.scale.setScalar(len * 1.6);
    this.ship.position.copy(pos);
    this.ship.rotation.y = headingToYaw(spec.headingDeg);
    this.ship.scale.setScalar(len);
    this.ship.castShadow = false;

    const yaw = headingToYaw(spec.headingDeg);
    const ahead = len * 9;
    this.cone.position.set(pos.x, pos.y - len * 0.03, pos.z);
    this.cone.rotation.y = yaw;
    this.cone.scale.set(ahead, 1, ahead);
    this.coneMat.color.set(opts.palette.accent);
    this.coneMat.opacity = 0.08 + 0.05 * Math.sin(opts.time * 1.4);

    const wakeLen = len * (2.2 + Math.min(4.5, spec.speedKn / 5));
    this.wake.position.set(pos.x, pos.y - len * 0.04, pos.z);
    this.wake.rotation.y = yaw;
    this.wake.scale.set(len * 0.9, 1, wakeLen);
    this.wakeMat.opacity = spec.moving ? 0.28 : 0.12;

    this.ring.position.set(pos.x, pos.y - len * 0.05, pos.z);
    this.ring.scale.setScalar(len * (spec.selected ? 2.6 + 0.25 * Math.sin(opts.time * 3) : 1.9));
    this.ringMat.color.set(spec.selected ? opts.palette.accent : opts.palette.inkDim);
    this.ringMat.opacity = spec.selected ? 0.85 : 0.35;

    this.labelAnchor.set(pos.x, pos.y + len * 0.28, pos.z);
  }

  anchor(): THREE.Vector3 {
    return this.labelAnchor;
  }

  pickTargets(): THREE.Object3D[] {
    return [this.pickProxy];
  }

  setPalette(p: ScenePalette) {
    this.coneMat.color.set(p.accent);
    this.ringMat.color.set(p.accent);
  }

  dispose() {
    this.ship.geometry.dispose();
    this.mat.dispose();
    this.cone.geometry.dispose();
    this.coneMat.dispose();
    this.wake.geometry.dispose();
    this.wakeMat.dispose();
    this.ring.geometry.dispose();
    this.ringMat.dispose();
    this.pickProxy.geometry.dispose();
    (this.pickProxy.material as THREE.Material).dispose();
  }
}
