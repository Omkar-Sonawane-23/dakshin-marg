/**
 * Chart furniture in 3D — graticule and fixed waypoints.
 *
 * · graticule: meridians and parallels draped over the relief (they follow the
 *   ice surface, which is what makes the terrain legible as a chart);
 * · origin: a flat survey ring with a crosshair;
 * · destination: a pin plus a vertical beacon column, so the target stays
 *   findable when the camera is tilted low over the horizon;
 * · review/conflict points: a pulsing hazard marker (drill + mission review).
 *
 * All of it is optional and driven by the existing layer toggles.
 */
import * as THREE from 'three';
import { project, rhoOfLat } from '../lib/projection';
import { scenePoint } from './coords';
import type { ScenePalette } from './palette';

export interface EndpointSpec {
  id: string;
  lon: number;
  lat: number;
  label: string;
  kind: 'ORIGIN' | 'DESTINATION';
}

export interface HazardMarkerSpec {
  id: string;
  lon: number;
  lat: number;
  label: string;
}

export class OverlayLayer {
  readonly group = new THREE.Group();
  private grat: THREE.LineSegments | null = null;
  private gratMat: THREE.LineBasicMaterial;
  private endpoints = new THREE.Group();
  private hazards = new THREE.Group();
  private endpointSig = '';
  private hazardSig = '';
  private pulses: { mat: THREE.MeshBasicMaterial; ring: THREE.Mesh }[] = [];

  constructor() {
    this.group.name = 'overlay';
    this.gratMat = new THREE.LineBasicMaterial({
      color: 0x1d3a55, transparent: true, opacity: 0.5,
    });
    this.group.add(this.endpoints, this.hazards);
  }

  setGraticule(visible: boolean, palette: ScenePalette, heightAt: (x: number, z: number) => number, exaggeration: number) {
    if (!visible) {
      if (this.grat) this.grat.visible = false;
      return;
    }
    if (!this.grat) this.grat = this.buildGraticule(heightAt, exaggeration);
    this.grat.visible = true;
    this.gratMat.color.set(palette.inkDim);
  }

  private buildGraticule(heightAt: (x: number, z: number) => number, exaggeration: number): THREE.LineSegments {
    const pts: number[] = [];
    const lift = 3.0;
    // parallels
    for (let lat = -50; lat >= -84; lat -= 2) {
      const rho = rhoOfLat(lat);
      let prev: THREE.Vector3 | null = null;
      for (let lon = 0; lon <= 360; lon += 3) {
        const p = project(lon, lat);
        const y = Math.max(0, heightAt(p.x, p.y)) * exaggeration + lift;
        const cur = new THREE.Vector3(p.x, y, p.y);
        if (prev) pts.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
        prev = cur;
      }
      void rho;
    }
    // meridians
    for (let lon = 0; lon < 360; lon += 10) {
      let prev: THREE.Vector3 | null = null;
      for (let lat = -44; lat >= -88; lat -= 2) {
        const p = project(lon, lat);
        const y = Math.max(0, heightAt(p.x, p.y)) * exaggeration + lift;
        const cur = new THREE.Vector3(p.x, y, p.y);
        if (prev) pts.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
        prev = cur;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const ls = new THREE.LineSegments(geo, this.gratMat);
    ls.renderOrder = 2;
    ls.raycast = () => {};
    this.group.add(ls);
    return ls;
  }

  updateEndpoints(
    eps: EndpointSpec[],
    palette: ScenePalette,
    heightAt: (x: number, z: number) => number,
    exaggeration: number,
    scaleKm: number,
  ) {
    const sig = eps.map((e) => `${e.id}:${e.lon.toFixed(3)},${e.lat.toFixed(3)}`).join('|');
    if (sig === this.endpointSig) {
      this.rescaleEndpoints(scaleKm);
      return;
    }
    this.endpointSig = sig;
    this.clear(this.endpoints);
    for (const e of eps) {
      const sp = scenePoint(e.lon, e.lat, 0);
      const y = Math.max(0, heightAt(sp.x, sp.z)) * exaggeration;
      const col = e.kind === 'DESTINATION' ? palette.safe : palette.inkDim;
      const g = new THREE.Group();
      g.position.set(sp.x, y, sp.z);

      const ringMat = new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 32).rotateX(-Math.PI / 2) as THREE.BufferGeometry, ringMat);
      ring.position.y = 0.5;
      ring.renderOrder = 7;
      g.add(ring);

      if (e.kind === 'DESTINATION') {
        // beacon column
        const beaconMat = new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide,
        });
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 1, 12, 1, true), beaconMat);
        beacon.name = 'beacon';
        g.add(beacon);
        const pin = new THREE.Mesh(
          new THREE.ConeGeometry(0.3, 0.62, 4),
          new THREE.MeshStandardMaterial({ color: col, emissive: new THREE.Color(col), emissiveIntensity: 0.55, roughness: 0.4 }),
        );
        pin.name = 'pin';
        pin.rotation.y = Math.PI / 4;
        g.add(pin);
      } else {
        const cross = new THREE.Mesh(
          new THREE.TorusGeometry(0.22, 0.05, 6, 16),
          new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }),
        );
        cross.rotation.x = Math.PI / 2;
        cross.name = 'pin';
        cross.position.y = 0.5;
        g.add(cross);
      }
      g.userData.kind = e.kind;
      this.endpoints.add(g);
    }
    this.rescaleEndpoints(scaleKm);
  }

  private rescaleEndpoints(scaleKm: number) {
    for (const g of this.endpoints.children) {
      g.scale.setScalar(Math.max(4, scaleKm));
      const beacon = g.getObjectByName('beacon') as THREE.Mesh | undefined;
      if (beacon) {
        const h = scaleKm * 22;
        beacon.scale.set(scaleKm, h, scaleKm);
        beacon.position.y = h / 2;
      }
      const pin = g.getObjectByName('pin') as THREE.Mesh | undefined;
      if (pin && g.userData.kind === 'DESTINATION') pin.position.y = scaleKm * 1.4;
    }
  }

  updateHazards(
    hz: HazardMarkerSpec[],
    palette: ScenePalette,
    heightAt: (x: number, z: number) => number,
    exaggeration: number,
    scaleKm: number,
    time: number,
  ) {
    const sig = hz.map((h) => `${h.id}:${h.lon.toFixed(3)},${h.lat.toFixed(3)}`).join('|');
    if (sig !== this.hazardSig) {
      this.hazardSig = sig;
      this.clear(this.hazards);
      this.pulses = [];
      for (const h of hz) {
        const sp = scenePoint(h.lon, h.lat, 0);
        const y = Math.max(0, heightAt(sp.x, sp.z)) * exaggeration;
        const g = new THREE.Group();
        g.position.set(sp.x, y, sp.z);
        const mat = new THREE.MeshBasicMaterial({
          color: palette.critical, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2) as THREE.BufferGeometry, mat);
        ring.position.y = 0.6;
        ring.renderOrder = 8;
        g.add(ring);
        const core = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.42, 0),
          new THREE.MeshStandardMaterial({
            color: palette.critical, emissive: new THREE.Color(palette.critical), emissiveIntensity: 0.8, roughness: 0.3,
          }),
        );
        core.name = 'core';
        core.position.y = 1.6;
        g.add(core);
        this.hazards.add(g);
        this.pulses.push({ mat, ring });
      }
    }
    for (const g of this.hazards.children) {
      g.scale.setScalar(Math.max(4, scaleKm));
      const core = g.getObjectByName('core') as THREE.Mesh | undefined;
      if (core) core.position.y = scaleKm * 1.6;
    }
    for (const p of this.pulses) {
      const t = (time * 0.55) % 1;
      p.ring.scale.setScalar(1 + t * 2.6);
      p.mat.opacity = 0.7 * (1 - t);
    }
  }

  private clear(g: THREE.Group) {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i];
      g.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mm = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
          else mm.dispose();
        }
      });
    }
  }

  dispose() {
    this.clear(this.endpoints);
    this.clear(this.hazards);
    this.grat?.geometry.dispose();
    this.gratMat.dispose();
  }
}
