/**
 * Scene constants and unit conversions.
 *
 * This module deliberately has NO dependency on three.js. `coords.ts` builds
 * Vector3s and therefore pulls in the whole library, but the data-mapping
 * layer (`components/map/sceneData.ts`) only needs these numbers — importing
 * them from here keeps three.js out of the eagerly-loaded bundle so the 3D
 * scene can be code-split and loaded on demand.
 *
 * Anything added here must stay allocation-free and side-effect-free.
 */

export const DEG = Math.PI / 180;

/**
 * Vertical exaggeration. Real relief (±4 km) is invisible against a
 * 5 000 km-wide polar scene, so elevation is amplified for legibility.
 * The exaggeration factor is surfaced in the UI so the operator is never
 * misled about absolute heights.
 */
export const VERTICAL_EXAGGERATION = 26;

/** Scene Y (km, un-exaggerated) for a relief value in km. */
export function elevToY(elevKm: number): number {
  return elevKm * VERTICAL_EXAGGERATION;
}

/** Metres → scene km (relief unit). */
export const M_TO_KM = 0.001;

/** Nautical miles → scene km. */
export const NM_TO_KM = 1.852;

/**
 * Compass bearing (0 = north, 90 = east) → rotation about scene Y.
 * Three.js "forward" is −z, north is −z, east is +x ⇒ yaw = −bearing.
 */
export function headingToYaw(bearingDeg: number): number {
  return -bearingDeg * DEG;
}
