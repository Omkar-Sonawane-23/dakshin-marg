/**
 * Scene coordinate system.
 *
 * The whole 3D environment is built on the SAME south-polar stereographic
 * projection the 2D renderer used (`lib/projection.ts`), so every existing
 * lon/lat dataset, minimap calculation and scale-bar formula keeps working:
 *
 *    scene.x  =  project(lon, lat).x     (km east of the central meridian)
 *    scene.z  =  project(lon, lat).y     (km south — SVG "down" becomes +z)
 *    scene.y  =  elevation above mean sea level, in km (exaggerated)
 *
 * Nothing is stored in scene units: all data remains WGS84 lon/lat and is
 * converted on the way into the GPU buffers.
 */
import * as THREE from 'three';
import { project, unproject } from '../lib/projection';
// Re-exported so existing importers of `coords` are unaffected. Modules that
// only need these numbers should import `./constants` directly and thereby
// avoid pulling three.js into their chunk.
export { DEG, M_TO_KM, NM_TO_KM, VERTICAL_EXAGGERATION, elevToY, headingToYaw } from './constants';
import { DEG, elevToY } from './constants';

/** Convert lon/lat (+ optional elevation in km) to scene coordinates. */
export function scenePoint(lon: number, lat: number, elevKm = 0): THREE.Vector3 {
  const p = project(lon, lat);
  return new THREE.Vector3(p.x, elevToY(elevKm), p.y);
}

/** Cheap flat variant (no allocation of a Vector3). */
export function sceneXZ(lon: number, lat: number): { x: number; z: number } {
  const p = project(lon, lat);
  return { x: p.x, z: p.y };
}

/** Inverse: scene x/z (km) → WGS84. */
export function xzToGeo(x: number, z: number): { lon: number; lat: number } {
  return unproject(x, z);
}

/** Unit vector a compass bearing points towards. */
export function headingVector(bearingDeg: number): THREE.Vector3 {
  const a = bearingDeg * DEG;
  return new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
}
