/** Geodesy helpers on WGS84 lon/lat (spherical approximations, display/demo grade). */

import type { GeoPoint } from '../types/domain';

const R_NM = 3440.065; // Earth radius in nautical miles
const DEG = Math.PI / 180;

/** Great-circle distance in nautical miles. */
export function distanceNm(a: GeoPoint, b: GeoPoint): number {
  const p1 = a.lat * DEG;
  const p2 = b.lat * DEG;
  const dp = (b.lat - a.lat) * DEG;
  const dl = (b.lon - a.lon) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(h));
}

/** Initial bearing in degrees (0–360). */
export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const p1 = a.lat * DEG;
  const p2 = b.lat * DEG;
  const dl = (b.lon - a.lon) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Total polyline length in nautical miles. */
export function polylineLengthNm(pts: GeoPoint[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distanceNm(pts[i - 1], pts[i]);
  return d;
}

/** Point at a given distance (nm) along a polyline, clamped to the ends. */
export function pointAlong(pts: GeoPoint[], distNm: number): { pos: GeoPoint; headingDeg: number } {
  if (distNm <= 0) return { pos: pts[0], headingDeg: bearingDeg(pts[0], pts[1]) };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = distanceNm(pts[i - 1], pts[i]);
    if (acc + seg >= distNm) {
      const f = (distNm - acc) / seg;
      return {
        pos: {
          lon: pts[i - 1].lon + (pts[i].lon - pts[i - 1].lon) * f,
          lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f,
        },
        headingDeg: bearingDeg(pts[i - 1], pts[i]),
      };
    }
    acc += seg;
  }
  const n = pts.length;
  return { pos: pts[n - 1], headingDeg: bearingDeg(pts[n - 2], pts[n - 1]) };
}

/** Densify a polyline by subdividing each segment (smoother projected curves). */
export function densify(pts: GeoPoint[], perSegment = 8): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (let i = 1; i < pts.length; i++) {
    for (let k = 0; k < perSegment; k++) {
      const f = k / perSegment;
      out.push({
        lon: pts[i - 1].lon + (pts[i].lon - pts[i - 1].lon) * f,
        lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f,
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Minimum distance (nm) from a point to a polyline (vertex approximation on densified line). */
export function distToPolylineNm(p: GeoPoint, pts: GeoPoint[]): number {
  const dense = densify(pts, 6);
  let min = Infinity;
  for (const q of dense) min = Math.min(min, distanceNm(p, q));
  return min;
}
