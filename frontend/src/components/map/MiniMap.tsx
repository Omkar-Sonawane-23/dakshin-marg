/**
 * Mini chart — a compact polar overview that stays honest about what it shows.
 *
 * Drawn from the same coastline vectors and the same store state as the main
 * scene (Antarctica, vessel, current route, destination, major risk areas), so
 * it can never disagree with the hero view. Clicking or dragging on it
 * repositions the main camera.
 */
import { useMemo, useRef } from 'react';
import { project } from '../../lib/projection';
import { CENTRAL_MERIDIAN } from '../../lib/projection';
import antarctica from '../../assets/antarctica.json';
import type { MapLabelSpec } from './sceneData';

const MINI_LAT_LIMIT = -45;

/** Coastline path in a −1..1 polar disc, computed once. */
function useCoastPath() {
  return useMemo(() => {
    const fc = antarctica as unknown as {
      features: { properties: { kind: string }; geometry: { type: string; coordinates: number[] } }[];
    };
    const R = 2 * 6371 * Math.tan(((90 + MINI_LAT_LIMIT) * 0.5 * Math.PI) / 180);
    const norm = (lon: number, lat: number) => {
      const p = project(lon, lat);
      return `${(p.x / R).toFixed(3)},${(p.y / R).toFixed(3)}`;
    };
    let land = '';
    let shelf = '';
    for (const f of fc.features) {
      const geom = f.geometry;
      const polys: number[][][] =
        geom.type === 'Polygon'
          ? (geom.coordinates as unknown as number[][][])
          : (geom.coordinates as unknown as number[][][][]).flat();
      let out = '';
      let inside = false;
      for (const ring of polys) {
        let anyInside = false;
        for (const pt of ring) if (pt[1] <= MINI_LAT_LIMIT) { anyInside = true; break; }
        if (!anyInside) continue;
        inside = true;
        out += ring.map((pt, i) => (i === 0 ? 'M' : 'L') + norm(pt[0], pt[1])).join('') + 'Z';
      }
      if (inside) {
        if (f.properties.kind === 'shelf') shelf += out;
        else land += out;
      }
    }
    return { land, shelf };
  }, []);
}

export default function MiniMap({
  vessel,
  route,
  endpoints,
  risk,
  center,
  onReposition,
}: {
  vessel: { lon: number; lat: number; headingDeg: number } | null;
  route: { lon: number; lat: number }[] | null;
  endpoints: MapLabelSpec[];
  risk: { lon: number; lat: number; rKm: number; sev: string }[];
  center: { lon: number; lat: number } | null;
  onReposition: (lon: number, lat: number) => void;
}) {
  const coast = useCoastPath();
  const svgRef = useRef<SVGSVGElement>(null);

  const R = 2 * 6371 * Math.tan(((90 + MINI_LAT_LIMIT) * 0.5 * Math.PI) / 180);
  const toXY = (lon: number, lat: number) => {
    const p = project(lon, lat);
    return { x: 50 + (p.x / R) * 47, y: 50 + (p.y / R) * 47 };
  };

  const pick = (e: React.PointerEvent) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    const x = nx * R;
    const y = ny * R;
    const rho = Math.hypot(x, y);
    if (rho > R) return;
    const lat = (Math.atan(rho / (2 * 6371)) * 180) / Math.PI * 2 - 90;
    const dLam = (Math.atan2(x, -y) * 180) / Math.PI;
    let lon = CENTRAL_MERIDIAN + dLam;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    onReposition(Number(lon.toFixed(3)), Number(lat.toFixed(3)));
  };

  const c = center ? toXY(center.lon, center.lat) : null;
  const v = vessel ? toXY(vessel.lon, vessel.lat) : null;

  return (
    <div className="nav-mini" onPointerDown={(e) => e.stopPropagation()}>
      <div className="nav-mini-head">
        <span className="label-xs">Polar overview</span>
        <span className="font-data text-[8px] text-ink-faint">CLICK TO RECENTRE</span>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        className="nav-mini-svg"
        onPointerDown={pick}
        role="button"
        aria-label="Polar overview — click to re-centre the main view"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && center) onReposition(center.lon, center.lat);
        }}
      >
        <defs>
          <radialGradient id="miniSea" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--map-bg-0)" />
            <stop offset="100%" stopColor="var(--map-bg-2)" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#miniSea)" stroke="var(--color-line-2)" strokeWidth="0.5" />
        {/* graticule rings */}
        {[-60, -70, -80].map((lat) => {
          const rho = 2 * 6371 * Math.tan(((90 + lat) * 0.5 * Math.PI) / 180);
          return (
            <circle key={lat} cx="50" cy="50" r={(rho / R) * 47}
              fill="none" stroke="var(--map-graticule)" strokeWidth="0.35" />
          );
        })}
        {[0, 45, 90, 135].map((a) => {
          const rad = ((a - 90) * Math.PI) / 180;
          return (
            <line key={a} x1={50 - Math.cos(rad) * 47} y1={50 - Math.sin(rad) * 47}
              x2={50 + Math.cos(rad) * 47} y2={50 + Math.sin(rad) * 47}
              stroke="var(--map-graticule)" strokeWidth="0.35" />
          );
        })}
        <g transform="translate(50 50) scale(47)">
          <path d={coast.shelf} fill="var(--map-shelf)" opacity="0.85" />
          <path d={coast.land} fill="var(--map-land)" stroke="var(--map-land-line)" strokeWidth="0.008" />
        </g>

        {/* risk areas */}
        {risk.map((z, i) => {
          const p = toXY(z.lon, z.lat);
          const r = Math.max(1.2, (z.rKm / R) * 47);
          return (
            <circle key={i} cx={p.x} cy={p.y} r={r}
              fill={`color-mix(in srgb, var(--color-risk-${z.sev}) 22%, transparent)`}
              stroke={`color-mix(in srgb, var(--color-risk-${z.sev}) 70%, transparent)`}
              strokeWidth="0.35" />
          );
        })}

        {/* route */}
        {route && route.length > 1 && (
          <polyline
            points={route.map((p) => { const q = toXY(p.lon, p.lat); return `${q.x},${q.y}`; }).join(' ')}
            fill="none" stroke="var(--color-accent)" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"
          />
        )}

        {/* endpoints */}
        {endpoints.map((e) => {
          if (e.lon == null || e.lat == null) return null;
          const p = toXY(e.lon, e.lat);
          return e.kind === 'berg' ? null : (
            <g key={e.id}>
              {e.text.includes('BHARATI') || e.color.includes('risk-low') ? (
                <path d={`M${p.x} ${p.y - 2.2} L${p.x + 1.6} ${p.y + 1.2} L${p.x - 1.6} ${p.y + 1.2} Z`}
                  fill="var(--color-risk-low)" />
              ) : (
                <circle cx={p.x} cy={p.y} r="1.2" fill="none" stroke="var(--color-ink-dim)" strokeWidth="0.6" />
              )}
            </g>
          );
        })}

        {/* camera footprint */}
        {c && (
          <g pointerEvents="none">
            <circle cx={c.x} cy={c.y} r="7" fill="none" stroke="var(--color-accent)"
              strokeWidth="0.5" strokeDasharray="1.6 1.4" opacity="0.8" />
            <circle cx={c.x} cy={c.y} r="0.9" fill="var(--color-accent)" />
          </g>
        )}

        {/* vessel */}
        {v && vessel && (
          <g transform={`translate(${v.x} ${v.y}) rotate(${vessel.headingDeg})`} pointerEvents="none">
            <path d="M0 -2.4 L1.5 1.8 L0 0.9 L-1.5 1.8 Z" fill="var(--color-ice)" stroke="var(--color-accent)" strokeWidth="0.35" />
          </g>
        )}
      </svg>
    </div>
  );
}
