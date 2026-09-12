/**
 * Risk zones — volumetric hazard envelopes.
 *
 * The risk engine publishes, per tracked berg, empirical backtest quantiles
 * (core / P50 / P90 radius in km — see docs/risk-methodology.md §4). Those are
 * drawn as nested translucent domes sitting on the sea surface, so the
 * operator sees the *volume* of uncertainty rather than a flat circle:
 *
 *   P90 dome  — amber, the plausible outer envelope
 *   P50 dome  — orange, the more likely envelope
 *   core      — red, pulsing quietly (a live hazard, not a decoration)
 *
 * No protected / no-go polygon dataset ships with the project, so none is
 * invented; the layer control lists it as unavailable.
 */
import * as THREE from 'three';
import { scenePoint } from './coords';
import type { ScenePalette } from './palette';

export interface ZoneSpec {
  id: string;
  lon: number;
  lat: number;
  coreRadiusKm: number;
  p50RadiusKm: number;
  p90RadiusKm: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  focused: boolean;
}

export class ZoneLayer {
  readonly group = new THREE.Group();
  private meshes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; core: boolean; sev: string }[] = [];
  private sig = '';
  private domeGeo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  private ringGeo = new THREE.RingGeometry(0.985, 1, 64).rotateX(-Math.PI / 2) as THREE.BufferGeometry;

  constructor() {
    this.group.name = 'riskZones';
  }

  update(zones: ZoneSpec[], opts: { visible: boolean; palette: ScenePalette; time: number }) {
    this.group.visible = opts.visible;
    if (!opts.visible) {
      this.sig = '';
      return;
    }
    const sig = zones.map((z) => `${z.id}:${z.p90RadiusKm.toFixed(1)}:${z.severity}:${z.focused ? 1 : 0}`).join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.rebuild(zones, opts.palette);
    }
    for (const m of this.meshes) {
      const pulse = m.core ? 0.55 + 0.45 * Math.sin(opts.time * 2.0) : 1;
      m.mat.opacity = (m.core ? 0.34 : 0.1) * pulse * (m.sev === 'CRITICAL' ? 1.25 : 1);
      m.ringMat.opacity = (m.core ? 0.85 : 0.4) * pulse;
    }
  }

  private rebuild(zones: ZoneSpec[], palette: ScenePalette) {
    this.disposeMeshes();
    for (const z of zones) {
      const base = scenePoint(z.lon, z.lat, 0);
      const tiers: { r: number; color: number; core: boolean }[] = [
        { r: Math.max(z.p90RadiusKm, 4), color: palette.caution, core: false },
        { r: Math.max(z.p50RadiusKm, 3), color: palette.danger, core: false },
        { r: Math.max(z.coreRadiusKm, 1.6), color: palette.critical, core: true },
      ];
      for (const t of tiers) {
        const mat = new THREE.MeshBasicMaterial({
          color: t.color, transparent: true, opacity: t.core ? 0.32 : 0.09,
          depthWrite: false, side: THREE.DoubleSide,
        });
        const dome = new THREE.Mesh(this.domeGeo, mat);
        dome.position.set(base.x, 0.2, base.z);
        // flatten the dome: real berg hazard is horizontal extent, not height
        dome.scale.set(t.r, t.r * 0.22, t.r);
        dome.renderOrder = 5;
        dome.raycast = () => {};

        const ringMat = new THREE.MeshBasicMaterial({
          color: t.color, transparent: true, opacity: t.core ? 0.8 : 0.35,
          depthWrite: false, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(this.ringGeo, ringMat);
        ring.position.set(base.x, 0.35, base.z);
        ring.scale.setScalar(t.r);
        ring.renderOrder = 6;
        ring.raycast = () => {};

        this.group.add(dome, ring);
        this.meshes.push({ mesh: dome, mat, ring, ringMat, core: t.core, sev: z.severity });
      }
    }
  }

  private disposeMeshes() {
    for (const m of this.meshes) {
      this.group.remove(m.mesh, m.ring);
      m.mat.dispose();
      m.ringMat.dispose();
    }
    this.meshes = [];
  }

  dispose() {
    this.disposeMeshes();
    this.domeGeo.dispose();
    this.ringGeo.dispose();
  }
}
