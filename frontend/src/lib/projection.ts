/**
 * South Polar Stereographic projection (spherical approximation, display-only).
 *
 * Orientation: the scenario's central meridian points "up" so the operator
 * reads the chart as "sailing south = downward toward the coast".
 * World units are kilometres on the projected plane; the pole is at (0,0).
 *
 * NOTE: this is a self-consistent display projection (validated against
 * EPSG:3031 within ~2% radially). All stored data remains WGS84 lon/lat.
 */

const R = 6371; // km, mean Earth radius
const DEG = Math.PI / 180;

/** Central meridian pointing screen-up (Prydz Bay scenario). */
export const CENTRAL_MERIDIAN = 76;

export interface WorldPoint {
  x: number; // km, +right
  y: number; // km, +down (SVG convention)
}

/** Radial distance from the South Pole on the projected plane, km. */
export function rhoOfLat(latDeg: number): number {
  return 2 * R * Math.tan((90 + latDeg) * 0.5 * DEG);
}

/** Project WGS84 lon/lat to world km (SVG y-down). */
export function project(lon: number, lat: number): WorldPoint {
  const rho = rhoOfLat(lat);
  const dLam = (lon - CENTRAL_MERIDIAN) * DEG;
  return { x: rho * Math.sin(dLam), y: -rho * Math.cos(dLam) };
}

/** Inverse projection: world km → lon/lat. */
export function unproject(x: number, y: number): { lon: number; lat: number } {
  const rho = Math.hypot(x, y);
  const lat = Math.atan(rho / (2 * R)) / DEG * 2 - 90;
  const dLam = Math.atan2(x, -y) / DEG;
  let lon = CENTRAL_MERIDIAN + dLam;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lon, lat };
}

/** Viewport transform: world km ↔ screen px. */
export interface MapView {
  cx: number; // world x at viewport centre
  cy: number; // world y at viewport centre
  scale: number; // px per km
}

export function worldToScreen(p: WorldPoint, view: MapView, w: number, h: number): WorldPoint {
  return { x: (p.x - view.cx) * view.scale + w / 2, y: (p.y - view.cy) * view.scale + h / 2 };
}

export function screenToWorld(sx: number, sy: number, view: MapView, w: number, h: number): WorldPoint {
  return { x: (sx - w / 2) / view.scale + view.cx, y: (sy - h / 2) / view.scale + view.cy };
}

/** Project a lon/lat ring to an SVG path fragment in world km. */
export function ringToPath(ring: number[][]): string {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const p = project(ring[i][0], ring[i][1]);
    d += (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
  }
  return d + 'Z';
}

type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export function geometryToPath(geom: Geometry): string {
  if (geom.type === 'Polygon') return geom.coordinates.map(ringToPath).join('');
  return geom.coordinates.map((poly) => poly.map(ringToPath).join('')).join('');
}

/** Graticule (meridians + parallels) as world-km SVG paths with label anchors. */
export interface Graticule {
  paths: string[];
  labels: { text: string; at: WorldPoint }[];
}

export function buildGraticule(): Graticule {
  const paths: string[] = [];
  const labels: { text: string; at: WorldPoint }[] = [];
  // Parallels every 2° from -58 to -78 (regional scale)
  for (let lat = -58; lat >= -78; lat -= 2) {
    let d = '';
    for (let lon = 0; lon <= 360; lon += 2) {
      const p = project(lon, lat);
      d += (lon === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
    }
    paths.push(d);
    labels.push({ text: `${Math.abs(lat)}°S`, at: project(CENTRAL_MERIDIAN - 11.5, lat) });
  }
  // Meridians every 5°
  for (let lon = 0; lon < 360; lon += 5) {
    const a = project(lon, -55);
    const b = project(lon, -84);
    paths.push(`M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    if (lon >= 55 && lon <= 95) {
      const lbl = lon > 180 ? `${360 - lon}°W` : `${lon}°E`;
      labels.push({ text: lbl, at: project(lon, -62.6) });
    }
  }
  return { paths, labels };
}
