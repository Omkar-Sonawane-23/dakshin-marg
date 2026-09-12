/**
 * Icebergs — real 3D objects, not flat markers.
 *
 * · geometry: a deterministically deformed icosahedron per instance family,
 *   scaled from the observed dimensions (length × width) with a freeboard
 *   height derived from the same length (tabular bergs: ~1:6 aspect);
 * · material: flat-shaded translucent ice with a cool emissive core, so the
 *   facets read as ice rather than as painted plastic;
 * · a soft contact-shadow/reflection disc sits on the water under each berg
 *   (a real shadow map over a 10 000 km scene would cost more than it says);
 * · instanced: one draw call for the whole field, one for the shadows, with
 *   two geometry LODs swapped by camera distance;
 * · trajectories: observed track (solid) + predicted path with a swept
 *   uncertainty corridor whose radius is the model's own P90 (or 1σ) value,
 *   plus a marker that travels the forecast to make lead time visible.
 *
 * NOTE ON SIZE: at chart scale a 30 km berg is a few pixels. Instances are
 * therefore clamped to a minimum on-screen size (a standard ECDIS
 * convention); the inspector always reports true dimensions.
 */
import * as THREE from 'three';
import { mulberry32 } from '../lib/random';
import { headingToYaw, NM_TO_KM, scenePoint } from './coords';
import type { ScenePalette } from './palette';

export type BergThreat = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface BergSpec {
  id: string;
  lon: number;
  lat: number;
  /** longest observed axis, km */
  lengthKm: number;
  widthKm: number;
  /** orientation of the long axis (compass degrees) */
  headingDeg: number;
  threat: BergThreat;
  focused: boolean;
  selected: boolean;
  /** observed positions, oldest → newest */
  track?: { lon: number; lat: number }[];
  /** predicted positions with a 1-σ / P90 corridor radius in km (null = none) */
  prediction?: { lon: number; lat: number; corridorKm: number | null }[];
}

const MAX_BERGS = 512;

/** Irregular berg hull — deformed icosahedron, deterministic per seed. */
function bergGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail) as THREE.BufferGeometry;
  const rnd = mulberry32(seed);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  const jitter: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let j = seen.get(key);
    if (j === undefined) {
      j = 0.72 + rnd() * 0.5;
      seen.set(key, j);
    }
    jitter.push(j);
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const j = jitter[i];
    pos.setXYZ(i, x * j, y * (y > 0 ? j * 0.85 : j * 0.62), z * j);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Swept corridor with a radius that follows the model's uncertainty. */
function corridorGeometry(
  pts: { lon: number; lat: number }[],
  radii: (number | null)[],
  y: number,
  segments = 10,
): THREE.BufferGeometry | null {
  const ring: { c: THREE.Vector3; r: number }[] = [];
  let lastR = 6;
  for (let i = 0; i < pts.length; i++) {
    const r = radii[i];
    if (r !== null && r > 0) lastR = r;
    if (r === null && i > 0 && i < pts.length - 1) continue;
    ring.push({ c: scenePoint(pts[i].lon, pts[i].lat, 0).setY(y), r: Math.max(2, lastR) });
  }
  if (ring.length < 2) return null;

  const verts: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i];
    const prev = ring[Math.max(0, i - 1)].c;
    const next = ring[Math.min(ring.length - 1, i + 1)].c;
    const tangent = next.clone().sub(prev).normalize();
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    let side = new THREE.Vector3().crossVectors(up, tangent).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const p = cur.c.clone().add(side.clone().multiplyScalar(Math.cos(a) * cur.r))
        .add(up.clone().multiplyScalar(Math.sin(a) * cur.r * 0.55));
      verts.push(p.x, p.y, p.z);
    }
  }
  const stride = segments + 1;
  for (let i = 0; i < ring.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class IcebergLayer {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private shadow: THREE.InstancedMesh;
  private hi: THREE.BufferGeometry;
  private lo: THREE.BufferGeometry;
  private mat: THREE.MeshStandardMaterial;
  private shadowMat: THREE.MeshBasicMaterial;
  private trackLines: THREE.Group;
  private predLines: THREE.Group;
  private corridors: THREE.Group;
  private markers: THREE.Group;
  private marker: THREE.Mesh;
  private markerPath: THREE.Vector3[] = [];
  /** instance index → berg id (for raycast hits) */
  idAt: string[] = [];
  private detailHi = true;

  constructor(palette: ScenePalette) {
    this.group.name = 'icebergs';
    this.hi = bergGeometry(0x1f3a, 2);
    this.lo = bergGeometry(0x1f3a, 0);

    this.mat = new THREE.MeshStandardMaterial({
      color: 0xdff1ff,
      roughness: 0.32,
      metalness: 0.0,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
      emissive: new THREE.Color(palette.accent),
      emissiveIntensity: 0.14,
    });
    this.mesh = new THREE.InstancedMesh(this.hi, this.mat, MAX_BERGS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'icebergs-instanced';
    this.mesh.count = 0;

    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x02090f,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.shadow = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2) as THREE.BufferGeometry,
      this.shadowMat,
      MAX_BERGS,
    );
    this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 3;
    this.shadow.count = 0;
    this.shadow.raycast = () => {};

    this.trackLines = new THREE.Group();
    this.predLines = new THREE.Group();
    this.corridors = new THREE.Group();
    this.markers = new THREE.Group();
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: palette.model, transparent: true, opacity: 0.95 }),
    );
    this.marker.visible = false;
    this.marker.raycast = () => {};

    this.group.add(this.shadow, this.corridors, this.trackLines, this.predLines, this.mesh, this.markers, this.marker);
  }

  update(
    bergs: BergSpec[],
    opts: {
      visible: boolean;
      trajectories: boolean;
      predictions: boolean;
      kmPerPixel: number;
      cameraDistance: number;
      palette: ScenePalette;
      time: number;
      minScreenPx: number;
    },
  ) {
    this.group.visible = opts.visible;
    if (!opts.visible) return;

    // LOD swap — cheap, one geometry reference
    const wantHi = opts.cameraDistance < 2400;
    if (wantHi !== this.detailHi) {
      this.mesh.geometry = wantHi ? this.hi : this.lo;
      this.detailHi = wantHi;
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();

    this.idAt.length = 0;
    let n = 0;
    for (const b of bergs) {
      if (n >= MAX_BERGS) break;
      const pos = scenePoint(b.lon, b.lat, 0);
      const trueHalf = Math.max(0.6, b.lengthKm / 2);
      // clamp to a minimum on-screen footprint (see module note)
      const minKm = opts.minScreenPx * opts.kmPerPixel * 0.5;
      const half = Math.max(trueHalf, minKm);
      const aspect = THREE.MathUtils.clamp(b.widthKm / Math.max(0.1, b.lengthKm), 0.25, 1);
      const freeboard = half * 0.42;

      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingToYaw(b.headingDeg));
      s.set(half, freeboard, half * aspect);
      p.copy(pos).setY(freeboard * 0.45);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(n, m);

      const threatCol =
        b.threat === 'CRITICAL' ? opts.palette.critical
        : b.threat === 'HIGH' ? opts.palette.danger
        : b.threat === 'MEDIUM' ? opts.palette.caution
        : opts.palette.iceThick;
      col.set(threatCol);
      if (b.selected || b.focused) col.lerp(new THREE.Color(0xffffff), 0.35);
      this.mesh.setColorAt(n, col);
      this.idAt.push(b.id);

      // contact shadow / water reflection
      m.compose(pos.clone().setY(0.4), q, s.clone().multiplyScalar(1.35).setY(1));
      this.shadow.setMatrixAt(n, m);
      n++;
    }
    this.mesh.count = n;
    this.shadow.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shadow.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mat.emissive.set(opts.palette.accent);

    this.rebuildLines(bergs, opts);
    this.updateMarker(opts.time, opts.palette);
  }

  private rebuildLines(
    bergs: BergSpec[],
    opts: { trajectories: boolean; predictions: boolean; palette: ScenePalette; kmPerPixel: number; minScreenPx: number },
  ) {
    const show = opts.trajectories;
    this.trackLines.visible = show;
    this.predLines.visible = show && opts.predictions;
    this.corridors.visible = show && opts.predictions;
    // rebuild only when the line budget actually changes shape
    const sig = show
      ? bergs.map((b) => `${b.id}:${b.focused ? 1 : 0}${b.track?.length ?? 0}${b.prediction?.length ?? 0}`).join(',')
      : '';
    if (sig === this.lineSig) return;
    this.lineSig = sig;
    this.clearGroup(this.trackLines);
    this.clearGroup(this.predLines);
    this.clearGroup(this.corridors);
    this.markerPath = [];
    if (!show) return;

    const minKm = Math.max(3, opts.minScreenPx * opts.kmPerPixel * 0.12);
    for (const b of bergs) {
      // observed track — real observations, solid
      if (b.track && b.track.length > 1) {
        const pts = b.track.map((t) => scenePoint(t.lon, t.lat, 0).setY(1.2));
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({
          color: b.focused ? opts.palette.safe : opts.palette.safe,
          transparent: true,
          opacity: b.focused ? 0.95 : 0.45,
        }));
        line.raycast = () => {};
        this.trackLines.add(line);
      }
      // predicted path + uncertainty corridor — model output
      if (opts.predictions && b.prediction && b.prediction.length > 1) {
        const pts = b.prediction.map((t) => scenePoint(t.lon, t.lat, 0));
        const geo = new THREE.BufferGeometry().setFromPoints(pts.map((v) => v.setY(2.4)));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
          color: opts.palette.model,
          transparent: true,
          opacity: b.focused ? 0.95 : 0.6,
        }));
        line.raycast = () => {};
        this.predLines.add(line);

        const cg = corridorGeometry(
          [{ lon: b.lon, lat: b.lat }, ...b.prediction],
          [null, ...b.prediction.map((t) => t.corridorKm)],
          1.0,
          b.focused ? 14 : 8,
        );
        if (cg) {
          const mesh = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({
            color: b.threat === 'HIGH' || b.threat === 'CRITICAL' ? opts.palette.danger : opts.palette.model,
            transparent: true,
            opacity: b.focused ? 0.2 : 0.09,
            side: THREE.DoubleSide,
            depthWrite: false,
          }));
          mesh.renderOrder = 5;
          mesh.raycast = () => {};
          this.corridors.add(mesh);
        }
        if (b.focused) {
          this.markerPath = [scenePoint(b.lon, b.lat, 0).setY(4), ...pts.map((v) => v.setY(4))];
        }
      }
      // a subtle base ring so a berg stays findable when zoomed right out
      if (minKm > 0 && !b.focused) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1, 1.18, 24).rotateX(-Math.PI / 2) as THREE.BufferGeometry,
          new THREE.MeshBasicMaterial({
            color: b.threat === 'HIGH' || b.threat === 'CRITICAL' ? opts.palette.danger : opts.palette.inkDim,
            transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide,
          }),
        );
        const c = scenePoint(b.lon, b.lat, 0);
        ring.position.set(c.x, 0.6, c.z);
        ring.scale.setScalar(Math.max(b.lengthKm * 0.7, minKm * 2.2));
        ring.renderOrder = 3;
        ring.raycast = () => {};
        this.trackLines.add(ring);
      }
    }
  }

  private lineSig = '';

  private updateMarker(time: number, palette: ScenePalette) {
    if (this.markerPath.length < 2) {
      this.marker.visible = false;
      return;
    }
    this.marker.visible = true;
    (this.marker.material as THREE.MeshBasicMaterial).color.set(palette.model);
    // 12 s per full forecast lead time — communicates elapsed prediction time
    const f = (time % 12) / 12;
    const seg = f * (this.markerPath.length - 1);
    const i = Math.min(this.markerPath.length - 2, Math.floor(seg));
    const t = seg - i;
    const a = this.markerPath[i];
    const b = this.markerPath[i + 1];
    this.marker.position.lerpVectors(a, b, t);
    this.marker.scale.setScalar(3 + 1.5 * Math.sin(time * 3));
  }

  private clearGroup(g: THREE.Group) {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i] as THREE.Mesh | THREE.Line;
      g.remove(c);
      c.geometry?.dispose();
      const m = c.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    }
  }

  /** Raycast target (instanced — `instanceId` maps through `idAt`). */
  pickTarget(): THREE.Object3D {
    return this.mesh;
  }

  setPalette(p: ScenePalette) {
    this.mat.emissive.set(p.accent);
    (this.marker.material as THREE.MeshBasicMaterial).color.set(p.model);
  }

  /** Force a rebuild of trajectory geometry on the next update. */
  invalidateLines() {
    this.lineSig = '';
  }

  dispose() {
    this.clearGroup(this.trackLines);
    this.clearGroup(this.predLines);
    this.clearGroup(this.corridors);
    this.hi.dispose();
    this.lo.dispose();
    this.mesh.dispose();
    this.shadow.dispose();
    this.mat.dispose();
    this.shadowMat.dispose();
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
  }
}

/** Observed length in nautical miles → scene km. */
export const nmToKm = (nm: number) => nm * NM_TO_KM;
