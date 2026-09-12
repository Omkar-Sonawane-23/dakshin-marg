/**
 * AntarcticMap — the visual centerpiece of the command center.
 *
 * Rendering strategy:
 *  · south-polar stereographic projection (display-only; data stays WGS84)
 *  · <canvas> underlay for raster fields (sea-ice concentration, risk surface)
 *  · SVG overlay for vectors (coastline, graticule, routes, trajectories)
 *  · screen-space markers for icebergs/vessel so glyph size is zoom-invariant
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import antarctica from '../../assets/antarctica.json';
import {
  buildGraticule, geometryToPath, project, screenToWorld, unproject, type MapView, type WorldPoint,
} from '../../lib/projection';
import { densify } from '../../lib/geo';
import { fmtPos, fmtScenarioTime } from '../../lib/format';
import { seaIceColor, riskColor, sigmaColor, windColor, liveRiskColor } from './mapColors';
import { useStore } from '../../state/store';
import { useEnv } from '../../state/envStore';
import { useMission } from '../../state/missionStore';
import { useTheme } from '../../state/themeStore';
import type { GeoPoint, Iceberg, Route } from '../../types/domain';
import type { BergSituation, NicIceberg, OptRoute } from '../../types/env';

const NM_TO_KM = 1.852;

interface TooltipState {
  x: number; y: number; content: ReactNode;
}

// ── static vector prep (computed once) ─────────────────────────────────

interface GeoFeature { properties: { kind: string }; geometry: Parameters<typeof geometryToPath>[0] }

function useStaticPaths() {
  return useMemo(() => {
    const fc = antarctica as unknown as { features: GeoFeature[] };
    let land = '', shelf = '';
    for (const f of fc.features) {
      if (f.properties.kind === 'shelf') shelf += geometryToPath(f.geometry);
      else land += geometryToPath(f.geometry);
    }
    return { land, shelf, graticule: buildGraticule() };
  }, []);
}

function routeWorldPath(wpts: GeoPoint[]): string {
  const dense = densify(wpts, 10);
  let d = '';
  dense.forEach((p, i) => {
    const w = project(p.lon, p.lat);
    d += (i === 0 ? 'M' : 'L') + w.x.toFixed(1) + ' ' + w.y.toFixed(1);
  });
  return d;
}

const ROUTE_STYLE: Record<string, { stroke: string; dash?: string; width: number }> = {
  ACTIVE: { stroke: 'var(--color-accent)', width: 2.4 },
  RECOMMENDED: { stroke: 'var(--color-risk-low)', dash: '7 5', width: 2 },
  ALT: { stroke: 'var(--color-ink-faint)', dash: '3 5', width: 1.4 },
  SUPERSEDED: { stroke: 'var(--color-risk-high)', dash: '2 6', width: 1.4 },
};

// ═══════════════════════════════════════════════════════════════════════

export default function AntarcticMap() {
  const { snapshot, scenario, layers, selection, setSelection } = useStore();
  const env = useEnv();
  const mission = useMission();
  const { theme } = useTheme(); // rasters must repaint when tokens change
  const live = env.mode === 'LIVE';
  const missionActive = live && mission.mission !== null;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<MapView>({ cx: 0, cy: 0, scale: 0.32 });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewMode, setViewMode] = useState<'3D' | '2D'>('3D');
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const fitted = useRef(false);
  const staticPaths = useStaticPaths();

  // ── sizing ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── initial fit to mission corridor ──────────────────────────────────
  useEffect(() => {
    if (fitted.current || !scenario || size.w < 300) return;
    const pts = [
      scenario.mission.origin.position, scenario.mission.destination.position,
      { lon: 56, lat: -60 }, { lon: 86, lat: -68 },
    ].map((p) => project(p.lon, p.lat));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min(size.w / (maxX - minX + 500), size.h / (maxY - minY + 420));
    setView({ cx: (minX + maxX) / 2 + 30, cy: (minY + maxY) / 2, scale });
    fitted.current = true;
  }, [scenario, size]);

  // ── fly to mission focus request ("View affected segment") ──────────
  useEffect(() => {
    if (!mission.focusRequest) return;
    const w = project(mission.focusRequest.lon, mission.focusRequest.lat);
    setView((v) => ({ cx: w.x, cy: w.y, scale: Math.max(v.scale, 0.5) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission.focusRequest?.ts]);

  // ── fly to focused berg (tracking layer) ─────────────────────────────
  useEffect(() => {
    if (!env.focusBergId || !env.bergSituation) return;
    const s = env.bergSituation.data.situations.find((x) => x.id === env.focusBergId);
    const pos = s?.usnicCurrent ?? (s?.track ? { lat: s.track.lastLat, lon: s.track.lastLon } : null);
    if (!pos) return;
    const w = project(pos.lon, pos.lat);
    setView((v) => ({ cx: w.x, cy: w.y, scale: Math.max(v.scale, 0.55) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env.focusBergId]);

  const w2s = useCallback(
    (p: WorldPoint): WorldPoint => ({
      x: (p.x - view.cx) * view.scale + size.w / 2,
      y: (p.y - view.cy) * view.scale + size.h / 2,
    }),
    [view, size],
  );

  const geo2s = useCallback((g: GeoPoint) => w2s(project(g.lon, g.lat)), [w2s]);

  // ── canvas raster layers ─────────────────────────────────────────────
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !snapshot) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const drawGrid = (
      grid: { lon0: number; lat0: number; dLon: number; dLat: number; nLon: number; nLat: number; values: number[][] },
      colorOf: (v: number) => [number, number, number, number],
    ) => {
      for (let j = 0; j < grid.nLat; j++) {
        for (let i = 0; i < grid.nLon; i++) {
          const v = grid.values[j][i];
          if (v < 0) continue; // no-data cells (live grids use -1)
          const [r, g, b, a] = colorOf(v);
          if (a <= 0.01) continue;
          const lon = grid.lon0 + i * grid.dLon;
          const lat = grid.lat0 + j * grid.dLat;
          const p00 = geo2s({ lon, lat });
          const p10 = geo2s({ lon: lon + grid.dLon, lat });
          const p11 = geo2s({ lon: lon + grid.dLon, lat: lat + grid.dLat });
          const p01 = geo2s({ lon, lat: lat + grid.dLat });
          // cull off-screen
          if (
            Math.max(p00.x, p10.x, p11.x, p01.x) < -40 || Math.min(p00.x, p10.x, p11.x, p01.x) > size.w + 40 ||
            Math.max(p00.y, p10.y, p11.y, p01.y) < -40 || Math.min(p00.y, p10.y, p11.y, p01.y) > size.h + 40
          ) continue;
          ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`;
          ctx.beginPath();
          ctx.moveTo(p00.x, p00.y);
          ctx.lineTo(p10.x, p10.y);
          ctx.lineTo(p11.x, p11.y);
          ctx.lineTo(p01.x, p01.y);
          ctx.closePath();
          ctx.fill();
        }
      }
    };

    if (live) {
      if (layers.seaIce) {
        if (env.forecastHorizon !== null && env.forecast) {
          // FORECAST view: model concentration, or σ-uncertainty overlay
          if (env.showSigma) {
            const g = env.forecast.data.grid;
            drawGrid({ ...g, values: env.forecast.data.sigmaGrid }, sigmaColor);
          } else {
            drawGrid(env.forecast.data.grid, seaIceColor);
          }
        } else if (env.seaIce) {
          drawGrid(env.seaIce.data.grid, seaIceColor);
        }
      }
      // Risk severity overlay (POLARIS + Overland + berg zones)
      if (env.riskEnabled && env.risk) {
        const rg = env.risk.data.grid;
        drawGrid(
          { lon0: rg.lon0, lat0: rg.lat0, dLon: rg.dLon, dLat: rg.dLat,
            nLon: rg.nLon, nLat: rg.nLat, values: rg.severity },
          liveRiskColor,
        );
      }
    } else {
      if (layers.seaIce) drawGrid(snapshot.seaIce.grid, seaIceColor);
      if (layers.risk) drawGrid(snapshot.riskSurface.grid, riskColor);
    }
  }, [snapshot, layers.seaIce, layers.risk, view, size, geo2s, live, env.seaIce,
      env.forecastHorizon, env.forecast, env.showSigma, env.riskEnabled, env.risk, theme]);

  // ── interaction ──────────────────────────────────────────────────────
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const rect = wrapRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const before = screenToWorld(mx, my, view, size.w, size.h);
      const factor = Math.exp(-e.deltaY * 0.0016);
      const scale = Math.min(3.2, Math.max(0.045, view.scale * factor));
      const cx = before.x - (mx - size.w / 2) / scale;
      const cy = before.y - (my - size.h / 2) / scale;
      setView({ cx, cy, scale });
    },
    [view, size],
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: view.cx, cy: view.cy };
    setDragging(true);
  }, [view]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    setView((v) => ({
      ...v,
      cx: d.cx - (e.clientX - d.sx) / v.scale,
      cy: d.cy - (e.clientY - d.sy) / v.scale,
    }));
  }, []);

  // ── raster value-at-cursor readout (LIVE mode, bottom-right chip) ────
  const [cursorProbe, setCursorProbe] = useState<string | null>(null);
  const onProbeMove = useCallback((e: React.PointerEvent) => {
    if (!live || dragRef.current) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, view, size.w, size.h);
    const g = unproject(w.x, w.y);
    const parts: string[] = [`${Math.abs(g.lat).toFixed(2)}°S ${g.lon.toFixed(2)}°E`];
    const sample = (grid: { lon0: number; lat0: number; dLon: number; dLat: number; nLon: number; nLat: number; values: number[][] }) => {
      const i = Math.floor((g.lon - grid.lon0) / grid.dLon);
      const j = Math.floor((g.lat - grid.lat0) / grid.dLat);
      if (i < 0 || j < 0 || i >= grid.nLon || j >= grid.nLat) return null;
      const v = grid.values[j][i];
      return v < 0 ? null : v;
    };
    if (env.riskEnabled && env.risk) {
      const rg = env.risk.data.grid;
      const v = sample({ ...rg, values: rg.severity });
      if (v !== null) parts.push(`risk ${rg.severityScale[v]}`);
    } else if (env.forecastHorizon !== null && env.forecast) {
      const v = sample(env.showSigma
        ? { ...env.forecast.data.grid, values: env.forecast.data.sigmaGrid }
        : env.forecast.data.grid);
      if (v !== null) parts.push(env.showSigma ? `σ ±${v.toFixed(1)}%` : `ice ${v.toFixed(0)}% (+${env.forecastHorizon}h fc)`);
    } else if (env.seaIce) {
      const v = sample(env.seaIce.data.grid);
      if (v !== null) parts.push(`ice ${v.toFixed(0)}%`);
    }
    setCursorProbe(parts.join(' · '));
  }, [live, view, size, env.riskEnabled, env.risk, env.forecastHorizon, env.forecast, env.showSigma, env.seaIce]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  const zoomBy = useCallback((f: number) => {
    setView((v) => ({ ...v, scale: Math.min(3.2, Math.max(0.045, v.scale * f)) }));
  }, []);

  const resetView = useCallback(() => {
    fitted.current = false;
    setSize((s) => ({ ...s })); // trigger refit effect
  }, []);

  // keyboard pan/zoom on the map surface
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 90 / view.scale;
    if (e.key === 'ArrowLeft') setView((v) => ({ ...v, cx: v.cx - step }));
    else if (e.key === 'ArrowRight') setView((v) => ({ ...v, cx: v.cx + step }));
    else if (e.key === 'ArrowUp') setView((v) => ({ ...v, cy: v.cy - step }));
    else if (e.key === 'ArrowDown') setView((v) => ({ ...v, cy: v.cy + step }));
    else if (e.key === '+' || e.key === '=') zoomBy(1.3);
    else if (e.key === '-') zoomBy(1 / 1.3);
    else if (e.key === '0') resetView();
    else return;
    e.preventDefault();
  }, [view.scale, zoomBy, resetView]);

  const showTip = useCallback((e: React.MouseEvent, content: ReactNode) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, content });
  }, []);

  // ── derived render data ──────────────────────────────────────────────
  const worldTransform = `translate(${size.w / 2} ${size.h / 2}) scale(${view.scale}) translate(${-view.cx} ${-view.cy})`;

  const routeElems = useMemo(() => {
    if (!snapshot || !layers.routes) return null;
    return snapshot.routes.map((r) => {
      const isActive = r.id === snapshot.activeRouteId;
      const isRec = r.id === snapshot.recommendedRouteId && !isActive;
      const superseded = !!r.supersededByRouteId;
      const style = isActive ? ROUTE_STYLE.ACTIVE : superseded ? ROUTE_STYLE.SUPERSEDED : isRec ? ROUTE_STYLE.RECOMMENDED : ROUTE_STYLE.ALT;
      const sel = selection.kind === 'route' && selection.id === r.id;
      return (
        <g key={r.id}>
          {/* wide invisible hit line */}
          <path
            d={routeWorldPath(r.waypoints)}
            fill="none" stroke="transparent" strokeWidth={14 / view.scale}
            style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
            onClick={(e) => { e.stopPropagation(); setSelection({ kind: 'route', id: r.id }); }}
            onMouseMove={(e) => showTip(e, <RouteTip route={r} active={isActive} />)}
            onMouseLeave={() => setTooltip(null)}
          />
          <path
            d={routeWorldPath(r.waypoints)}
            fill="none"
            stroke={style.stroke}
            strokeWidth={(sel ? style.width + 1 : style.width)}
            strokeDasharray={style.dash}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            className={isActive ? 'route-active-dash' : ''}
            style={isActive ? { strokeDasharray: '12 8' } : undefined}
            opacity={superseded ? 0.7 : 1}
            pointerEvents="none"
          />
          {sel && r.waypoints.map((p, i) => {
            const w = project(p.lon, p.lat);
            return <circle key={i} cx={w.x} cy={w.y} r={4 / view.scale} fill="var(--map-marker-core)" stroke={style.stroke} strokeWidth={1.6 / view.scale} pointerEvents="none" />;
          })}
        </g>
      );
    });
  }, [snapshot, layers.routes, selection, view.scale, setSelection, showTip]);

  const trajectoryElems = useMemo(() => {
    if (!snapshot || !layers.trajectories) return null;
    return snapshot.icebergs.map((b) => {
      const threat = b.routeThreatLevel === 'HIGH' || b.routeThreatLevel === 'CRITICAL';
      const sel = selection.kind === 'iceberg' && selection.id === b.id;
      if (!threat && !sel && view.scale < 0.12) return null;
      const pts = b.trajectory.points;
      let d = '';
      pts.forEach((tp, i) => {
        const w = project(tp.position.lon, tp.position.lat);
        d += (i === 0 ? 'M' : 'L') + w.x.toFixed(1) + ' ' + w.y.toFixed(1);
      });
      const col = threat ? 'var(--color-risk-high)' : 'var(--map-traj)';
      return (
        <g key={b.id} pointerEvents="none" opacity={sel ? 1 : threat ? 0.9 : 0.45}>
          {/* uncertainty corridor: growing rings at forecast points */}
          {(sel || threat) && pts.filter((_, i) => i % 2 === 0).map((tp, i) => {
            const w = project(tp.position.lon, tp.position.lat);
            return (
              <circle
                key={i} cx={w.x} cy={w.y}
                r={tp.uncertaintyNm * NM_TO_KM}
                fill={threat ? 'color-mix(in srgb, var(--color-risk-high) 5%, transparent)' : 'color-mix(in srgb, var(--map-traj) 5%, transparent)'}
                stroke={threat ? 'color-mix(in srgb, var(--color-risk-high) 30%, transparent)' : 'color-mix(in srgb, var(--map-traj) 28%, transparent)'}
                strokeWidth={0.8 / view.scale}
                strokeDasharray={`${3 / view.scale} ${3 / view.scale}`}
              />
            );
          })}
          <path d={d} fill="none" stroke={col} strokeWidth={sel ? 1.8 : 1.2} vectorEffect="non-scaling-stroke" strokeDasharray="2 4" strokeLinecap="round" />
          {/* arrowhead at end */}
          {(() => {
            const a = project(pts[pts.length - 2].position.lon, pts[pts.length - 2].position.lat);
            const bp = project(pts[pts.length - 1].position.lon, pts[pts.length - 1].position.lat);
            const ang = (Math.atan2(bp.y - a.y, bp.x - a.x) * 180) / Math.PI;
            return (
              <g transform={`translate(${bp.x} ${bp.y}) rotate(${ang}) scale(${1 / view.scale})`}>
                <path d="M0 0 L-9 -4 L-9 4 Z" fill={col} />
              </g>
            );
          })()}
        </g>
      );
    });
  }, [snapshot, layers.trajectories, selection, view.scale]);

  // Live weather vectors (real Open-Meteo hours)
  const liveWeatherElems = useMemo(() => {
    if (!live || !layers.weather || !env.weather) return null;
    return env.weather.data.cells.map((c, i) => {
      const w = project(c.lon, c.lat);
      const s = w2s(w);
      if (s.x < -20 || s.x > size.w + 20 || s.y < -20 || s.y > size.h + 20) return null;
      const len = 6 + c.windSpeedKn * 0.35;
      return (
        <g key={i} transform={`translate(${w.x} ${w.y}) rotate(${c.windDirDeg + 180}) scale(${1 / view.scale})`} opacity={0.85} pointerEvents="none">
          <line x1={0} y1={len / 2} x2={0} y2={-len / 2} stroke={windColor(c.windSpeedKn)} strokeWidth={1.3} />
          <path d={`M0 ${-len / 2} L-3 ${-len / 2 + 5} M0 ${-len / 2} L3 ${-len / 2 + 5}`} stroke={windColor(c.windSpeedKn)} strokeWidth={1.3} fill="none" />
        </g>
      );
    });
  }, [live, layers.weather, env.weather, view.scale, w2s, size]);

  const weatherElems = useMemo(() => {
    if (live || !snapshot || !layers.weather) return null;
    const step = view.scale < 0.16 ? 2 : 1;
    return snapshot.weather.cells
      .filter((_, i) => i % step === 0)
      .map((c, i) => {
        const w = project(c.position.lon, c.position.lat);
        const s = w2s(w);
        if (s.x < -20 || s.x > size.w + 20 || s.y < -20 || s.y > size.h + 20) return null;
        const len = 6 + c.windSpeedKn * 0.35;
        return (
          <g key={i} transform={`translate(${w.x} ${w.y}) rotate(${c.windDirDeg + 180}) scale(${1 / view.scale})`} opacity={0.85} pointerEvents="none">
            <line x1={0} y1={len / 2} x2={0} y2={-len / 2} stroke={windColor(c.windSpeedKn)} strokeWidth={1.3} />
            <path d={`M0 ${-len / 2} L-3 ${-len / 2 + 5} M0 ${-len / 2} L3 ${-len / 2 + 5}`} stroke={windColor(c.windSpeedKn)} strokeWidth={1.3} fill="none" />
          </g>
        );
      });
  }, [live, snapshot, layers.weather, view.scale, w2s, size]);

  // Berg TRACKS (real BYU history) + PREDICTED trajectories with corridors.
  // Tracking and prediction are separate capabilities: the solid line is the
  // observed track (REAL), the dashed line + rings are the model forecast.
  const bergTrackElems = useMemo(() => {
    if (!live || !layers.trajectories || !env.bergSituation) return null;
    const out: ReactNode[] = [];
    for (const s of env.bergSituation.data.situations) {
      const focused = env.focusBergId === s.id;
      if (env.focusBergId !== null && !focused) continue;

      // — observed track (CAPABILITY 2: tracking) —
      if (s.track && s.track.recentPath.length > 1) {
        let d = '';
        s.track.recentPath.forEach((p, i) => {
          const w = project(p.lon, p.lat);
          d += (i === 0 ? 'M' : 'L') + w.x.toFixed(1) + ' ' + w.y.toFixed(1);
        });
        out.push(
          <path key={`trk-${s.id}`} d={d} fill="none" stroke="var(--color-risk-low)"
            strokeWidth={focused ? 1.8 : 1.1} vectorEffect="non-scaling-stroke"
            opacity={focused ? 0.95 : 0.55} pointerEvents="none" />,
        );
      }

      // — predicted trajectory + uncertainty corridor (CAPABILITY 3) —
      if (env.showBergPredictions && s.prediction && s.prediction.regime === 'MOVING') {
        const p0 = project(s.prediction.lastObs.lon, s.prediction.lastObs.lat);
        let d = `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)}`;
        for (const tp of s.prediction.trajectory) {
          const w = project(tp.lon, tp.lat);
          d += `L${w.x.toFixed(1)} ${w.y.toFixed(1)}`;
        }
        out.push(
          <g key={`prd-${s.id}`} pointerEvents="none" opacity={focused ? 1 : 0.8}>
            {s.prediction.trajectory.map((tp) => {
              const w = project(tp.lon, tp.lat);
              return tp.corridorP90Km === null ? null : (
                <circle key={tp.horizonD} cx={w.x} cy={w.y} r={tp.corridorP90Km}
                  fill="color-mix(in srgb, var(--color-model) 5%, transparent)" stroke="color-mix(in srgb, var(--color-model) 35%, transparent)"
                  strokeWidth={0.9 / view.scale}
                  strokeDasharray={`${3 / view.scale} ${3 / view.scale}`} />
              );
            })}
            <path d={d} fill="none" stroke="var(--color-model)" strokeWidth={focused ? 2 : 1.4}
              vectorEffect="non-scaling-stroke" strokeDasharray="5 4" strokeLinecap="round" />
          </g>,
        );
      }
    }
    return out;
  }, [live, layers.trajectories, env.bergSituation, env.focusBergId,
      env.showBergPredictions, view.scale]);

  // Optimized routes (LIVE): severity-ceiling shortest paths.
  // Styles differ by dash pattern AND color AND label — never color alone.
  const OPT_STYLE: Record<string, { stroke: string; dash?: string; width: number }> = useMemo(() => ({
    DIRECT: { stroke: 'var(--color-accent)', dash: '2 6', width: 1.6 },
    BALANCED: { stroke: 'var(--color-risk-low)', width: 2.2 },
    CONSERVATIVE: { stroke: 'var(--route-conservative)', dash: '9 5', width: 1.6 },
  }), []);

  const optRouteElems = useMemo(() => {
    if (!live || !env.routePlan) return null;
    const req = env.routePlan.data.request;
    const o = project(req.origin.lon, req.origin.lat);
    const d = project(req.destination.lon, req.destination.lat);
    const els: ReactNode[] = [];
    for (const r of env.routePlan.data.routes) {
      if (r.status !== 'OK' || !r.waypoints) continue;
      const sel = env.selectedRouteProfile === r.profile;
      const dimmed = env.selectedRouteProfile !== null && !sel;
      const style = OPT_STYLE[r.profile] ?? OPT_STYLE.DIRECT;
      let path = '';
      r.waypoints.forEach((p, i) => {
        const w = project(p.lon, p.lat);
        path += (i === 0 ? 'M' : 'L') + w.x.toFixed(1) + ' ' + w.y.toFixed(1);
      });
      els.push(
        <g key={`opt-${r.profile}`}>
          <path
            d={path} fill="none" stroke="transparent" strokeWidth={14 / view.scale}
            style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
            onClick={(e) => {
              e.stopPropagation();
              env.setSelectedRouteProfile(sel ? null : r.profile);
            }}
            onMouseMove={(e) => showTip(e, <OptRouteTip route={r} />)}
            onMouseLeave={() => setTooltip(null)}
          />
          <path
            d={path} fill="none"
            stroke={style.stroke}
            strokeWidth={sel ? style.width + 1 : style.width}
            strokeDasharray={style.dash}
            vectorEffect="non-scaling-stroke" strokeLinecap="round"
            opacity={dimmed ? 0.3 : r.recommended ? 1 : 0.85}
            pointerEvents="none"
          />
          {r.recommended && !dimmed && (() => {
            const mid = r.waypoints![Math.floor(r.waypoints!.length / 2)];
            const w = project(mid.lon, mid.lat);
            return (
              <g transform={`translate(${w.x} ${w.y}) scale(${1 / view.scale})`} pointerEvents="none">
                <text x={10} y={-8} fill={style.stroke} fontSize={10} fontWeight={700} className="font-data">
                  ★ {r.profile}
                </text>
              </g>
            );
          })()}
        </g>,
      );
    }
    // endpoints
    els.push(
      <g key="opt-origin" transform={`translate(${o.x} ${o.y})`} pointerEvents="none">
        <g transform={`scale(${1 / view.scale})`}>
          <circle r={5} fill="none" stroke="var(--color-ink-dim)" strokeWidth={1.6} />
          <circle r={1.6} fill="var(--color-ink-dim)" />
          <text x={-10} y={-9} fill="var(--color-ink-dim)" fontSize={10} textAnchor="end" className="font-data">ORIGIN</text>
        </g>
      </g>,
      <g key="opt-dest" transform={`translate(${d.x} ${d.y})`} pointerEvents="none">
        <g transform={`scale(${1 / view.scale})`}>
          <path d="M0 -8 L6 4 L-6 4 Z" fill="none" stroke="var(--color-risk-low)" strokeWidth={1.6} />
          <text x={10} y={4} fill="var(--color-risk-low)" fontSize={10} className="font-data">DESTINATION</text>
        </g>
      </g>,
    );
    return els;
  }, [live, env.routePlan, env.selectedRouteProfile, env.setSelectedRouteProfile,
      view.scale, showTip, OPT_STYLE]);

  // ── Mission workspace layers: planned routes, candidates, vessel ────
  const missionElems = useMemo(() => {
    if (!missionActive) return null;
    const m = mission.mission!;
    const els: ReactNode[] = [];

    const pathOfWpts = (wpts: { lat: number; lon: number }[]) =>
      wpts.map((p, i) => {
        const w = project(p.lon, p.lat);
        return (i === 0 ? 'M' : 'L') + w.x.toFixed(1) + ' ' + w.y.toFixed(1);
      }).join('');

    const plan = m.routePlan?.data;
    const hasActive = Boolean(m.activeProfile) && m.state !== 'ROUTES_GENERATED';

    if (plan) {
      for (const r of plan.routes) {
        if (r.status !== 'OK' || !r.waypoints) continue;
        const isActive = hasActive && r.profile === m.activeProfile;
        if (hasActive && !isActive) continue;   // under way: show only the active route
        const style = OPT_STYLE[r.profile] ?? OPT_STYLE.DIRECT;
        const sel = mission.selectedProfile === r.profile;
        els.push(
          <g key={`mr-${r.profile}`}>
            <path
              d={pathOfWpts(r.waypoints)} fill="none" stroke="transparent"
              strokeWidth={14 / view.scale} style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={(e) => {
                e.stopPropagation();
                mission.setSelectedProfile(sel ? null : r.profile);
              }}
              onMouseMove={(e) => showTip(e, <OptRouteTip route={r} />)}
              onMouseLeave={() => setTooltip(null)}
            />
            <path
              d={pathOfWpts(r.waypoints)} fill="none"
              stroke={isActive ? 'var(--color-accent)' : style.stroke}
              strokeWidth={isActive ? 2.6 : sel ? style.width + 1 : style.width}
              strokeDasharray={isActive ? undefined : style.dash}
              vectorEffect="non-scaling-stroke" strokeLinecap="round"
              opacity={isActive ? 1 : r.recommended ? 0.95 : 0.75}
              pointerEvents="none"
              className={isActive && mission.sim?.playing ? 'route-active-dash' : ''}
              style={isActive && mission.sim?.playing ? { strokeDasharray: '12 8' } : undefined}
            />
            {(r.recommended && !hasActive) && (() => {
              const mid = r.waypoints![Math.floor(r.waypoints!.length / 2)];
              const w = project(mid.lon, mid.lat);
              return (
                <g transform={`translate(${w.x} ${w.y}) scale(${1 / view.scale})`} pointerEvents="none">
                  <text x={10} y={-8} fill={style.stroke} fontSize={10} fontWeight={700} className="font-data">
                    ★ {r.profile}
                  </text>
                </g>
              );
            })()}
          </g>,
        );
      }
    }

    // candidate replan routes (violet accents = model output pending decision)
    const cand = mission.candidatePlan?.data;
    if (cand) {
      for (const r of cand.routes) {
        if (r.status !== 'OK' || !r.waypoints) continue;
        const sel = mission.selectedProfile === `CAND:${r.profile}`;
        els.push(
          <g key={`mc-${r.profile}`}>
            <path
              d={pathOfWpts(r.waypoints)} fill="none" stroke="transparent"
              strokeWidth={14 / view.scale} style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={(e) => {
                e.stopPropagation();
                mission.setSelectedProfile(sel ? null : `CAND:${r.profile}`);
              }}
              onMouseMove={(e) => showTip(e, <OptRouteTip route={r} candidate />)}
              onMouseLeave={() => setTooltip(null)}
            />
            <path
              d={pathOfWpts(r.waypoints)} fill="none"
              stroke="var(--color-model)"
              strokeWidth={sel ? 2.8 : r.recommended ? 2.2 : 1.5}
              strokeDasharray={r.recommended ? '10 4' : '3 5'}
              vectorEffect="non-scaling-stroke" strokeLinecap="round"
              opacity={sel || r.recommended ? 1 : 0.7}
              pointerEvents="none"
            />
            {r.recommended && (() => {
              const mid = r.waypoints![Math.floor(r.waypoints!.length / 2)];
              const w = project(mid.lon, mid.lat);
              return (
                <g transform={`translate(${w.x} ${w.y}) scale(${1 / view.scale})`} pointerEvents="none">
                  <text x={10} y={-8} fill="var(--color-model)" fontSize={10} fontWeight={700} className="font-data">
                    ★ CANDIDATE {r.profile}
                  </text>
                </g>
              );
            })()}
          </g>,
        );
      }
    }

    // origin / destination
    const o = project(m.origin.lon, m.origin.lat);
    const d = project(m.destination.lon, m.destination.lat);
    els.push(
      <g key="m-origin" transform={`translate(${o.x} ${o.y})`} pointerEvents="none">
        <g transform={`scale(${1 / view.scale})`}>
          <circle r={5} fill="none" stroke="var(--color-ink-dim)" strokeWidth={1.6} />
          <circle r={1.6} fill="var(--color-ink-dim)" />
          <text x={-10} y={-9} fill="var(--color-ink-dim)" fontSize={10} textAnchor="end" className="font-data">
            {(m.origin.label ?? 'ORIGIN').toUpperCase()}
          </text>
        </g>
      </g>,
      <g key="m-dest" transform={`translate(${d.x} ${d.y})`} pointerEvents="none">
        <g transform={`scale(${1 / view.scale})`}>
          <path d="M0 -8 L6 4 L-6 4 Z" fill="none" stroke="var(--color-risk-low)" strokeWidth={1.6} />
          <text x={10} y={4} fill="var(--color-risk-low)" fontSize={10} className="font-data">
            {(m.destination.label ?? 'DESTINATION').toUpperCase()}
          </text>
        </g>
      </g>,
    );

    // vessel at the simulated position (pure function of route + sim time)
    if (mission.sim) {
      const s = mission.sim;
      const w = project(s.vesselPos.lon, s.vesselPos.lat);
      els.push(
        <g key="m-vessel" transform={`translate(${w.x} ${w.y})`} pointerEvents="none">
          <g transform={`scale(${1 / view.scale}) rotate(${s.headingDeg})`}>
            <path d="M0 -9 L5.5 7 L0 3.5 L-5.5 7 Z" fill="var(--color-ice)" stroke="var(--color-accent)" strokeWidth={1.2} />
          </g>
          <g transform={`scale(${1 / view.scale})`}>
            <text x={11} y={-6} fill="var(--color-ice)" fontSize={10.5} fontWeight={700} className="font-data">
              {m.vessel.name.toUpperCase()}
            </text>
            <text x={11} y={6} fill="var(--color-ink-dim)" fontSize={9} className="font-data">
              T+{s.elapsedH.toFixed(1)}h · {s.distanceCoveredNm.toFixed(0)} nm
            </text>
          </g>
        </g>,
      );
    }

    // review-alert worst point marker
    if (mission.reviewAlert?.worstAt?.lat != null) {
      const w = project(mission.reviewAlert.worstAt.lon!, mission.reviewAlert.worstAt.lat!);
      els.push(
        <g key="m-worst" pointerEvents="none">
          <circle cx={w.x} cy={w.y} r={10 / view.scale} fill="none"
            stroke="var(--color-risk-crit)" strokeWidth={1.6 / view.scale} className="drill-berg-ping" />
          <g transform={`translate(${w.x} ${w.y}) scale(${1 / view.scale})`}>
            <text x={12} y={-8} fill="var(--color-risk-crit)" fontSize={10} fontWeight={700} className="font-data">
              ▲ REVIEW POINT
            </text>
          </g>
        </g>,
      );
    }

    return els;
  }, [missionActive, mission.mission, mission.candidatePlan, mission.sim,
      mission.selectedProfile, mission.setSelectedProfile, mission.reviewAlert,
      view.scale, showTip, OPT_STYLE]);

  // ── Re-planning drill layer (deterministic SIMULATION) ──────────────
  // Stage-driven mission theater: accepted route → vessel underway →
  // SIMULATED berg deviation → conflict → OLD (red) vs NEW (green) routes.
  const drillElems = useMemo(() => {
    if (!live || !env.drill || env.drillStage < 0) return null;
    const stages = env.drill.data.stages;
    const stg = env.drillStage;
    const byId = Object.fromEntries(stages.map((s) => [s.id, s]));
    const els: ReactNode[] = [];

    const pathOf = (wpts: { lat: number; lon: number }[]) =>
      wpts.map((p, i) => {
        const w = project(p.lon, p.lat);
        return (i === 0 ? 'M' : 'L') + w.x.toFixed(1) + ' ' + w.y.toFixed(1);
      }).join('');

    const scn = env.drill.data.scenario;
    const o = project(scn.origin.lon, scn.origin.lat);
    const d = project(scn.destination.lon, scn.destination.lat);

    const plan0 = byId.MISSION_START?.data.plan;
    const acceptedProfile = byId.ROUTE_ACCEPTED?.data.acceptedProfile;
    const accepted = plan0?.routes.find((r) => r.profile === acceptedProfile);
    const underway = byId.UNDERWAY?.data;
    const replan = byId.REPLAN?.data;
    const conflictOn = stg >= 4;   // CONFLICT_DETECTED onward
    const replanOn = stg >= 5;     // REPLAN onward
    const decided = env.drillAccepted;

    // stage 0: all alternatives faint; accepted route emphasized from stage 1
    if (stg === 0 && plan0) {
      for (const r of plan0.routes) {
        if (r.status !== 'OK' || !r.waypoints) continue;
        els.push(
          <path key={`dr0-${r.profile}`} d={pathOf(r.waypoints)} fill="none"
            stroke={r.recommended ? 'var(--color-accent)' : 'var(--color-ink-faint)'}
            strokeWidth={r.recommended ? 2 : 1.2}
            strokeDasharray={r.recommended ? undefined : '4 5'}
            vectorEffect="non-scaling-stroke" opacity={0.9} pointerEvents="none" />,
        );
      }
    }

    // accepted route (stage 1+): the mission line
    if (stg >= 1 && accepted?.waypoints) {
      const oldIsDanger = conflictOn && !decided;
      els.push(
        <path key="dr-accepted" d={pathOf(accepted.waypoints)} fill="none"
          stroke={replanOn ? 'var(--color-risk-crit)' : oldIsDanger ? 'var(--color-risk-crit)' : 'var(--color-accent)'}
          strokeWidth={replanOn ? 1.8 : 2.4}
          strokeDasharray={replanOn ? '7 5' : stg >= 2 ? '10 6' : undefined}
          vectorEffect="non-scaling-stroke" strokeLinecap="round"
          className={replanOn ? 'drill-old-route' : stg >= 2 && !conflictOn ? 'route-active-dash' : undefined}
          opacity={decided ? 0.28 : replanOn ? 0.75 : 1}
          pointerEvents="none" />,
      );
      if (replanOn) {
        const mid = accepted.waypoints[Math.floor(accepted.waypoints.length * 0.72)];
        const w = project(mid.lon, mid.lat);
        els.push(
          <g key="dr-oldlbl" transform={`translate(${w.x} ${w.y}) scale(${1 / view.scale})`} pointerEvents="none" opacity={decided ? 0.4 : 1}>
            <rect x={8} y={-22} width={92} height={16} rx={2} fill="var(--map-plate)" stroke="var(--color-risk-crit)" strokeWidth={0.8} />
            <text x={14} y={-10} fill="var(--color-risk-crit)" fontSize={10} fontWeight={700} className="font-data">✕ OLD ROUTE</text>
          </g>,
        );
      }
    }

    // vessel (stage 2+)
    if (stg >= 2 && underway?.vesselPosition) {
      const w = project(underway.vesselPosition.lon, underway.vesselPosition.lat);
      els.push(
        <g key="dr-vessel" transform={`translate(${w.x} ${w.y})`} pointerEvents="none">
          <g transform={`scale(${1 / view.scale})`}>
            <path d="M0 -9 L5.5 7 L0 3.5 L-5.5 7 Z" fill="var(--color-ice)" stroke="var(--color-accent)" strokeWidth={1.2} />
            <text x={11} y={-6} fill="var(--color-ice)" fontSize={10.5} fontWeight={700} className="font-data">RSV DAKSHIN DHRUV</text>
            <text x={11} y={6} fill="var(--color-ink-dim)" fontSize={9} className="font-data">T+{scn.advanceHours}h · {underway.coveredNm?.toFixed(0)} nm run</text>
          </g>
        </g>,
      );
    }

    // simulated berg deviation (stage 3+)
    const dev = byId.BERG_DEVIATION?.data;
    if (stg >= 3 && dev?.before && dev?.after) {
      const b = project(dev.before.lon, dev.before.lat);
      const a = project(dev.after.lon, dev.after.lat);
      const z = dev.zone;
      els.push(
        <g key="dr-berg" pointerEvents="none">
          {/* displacement arrow */}
          <line x1={b.x} y1={b.y} x2={a.x} y2={a.y} stroke="var(--color-risk-med)"
            strokeWidth={1.4} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <circle cx={b.x} cy={b.y} r={3 / view.scale} fill="none" stroke="var(--color-ink-dim)" strokeWidth={1 / view.scale} />
          {/* hazard rings at simulated position (real backtest radii) */}
          {z && <>
            <circle cx={a.x} cy={a.y} r={z.p90RadiusKm} fill="color-mix(in srgb, var(--color-risk-med) 8%, transparent)"
              stroke="color-mix(in srgb, var(--color-risk-med) 55%, transparent)" strokeWidth={1 / view.scale}
              strokeDasharray={`${4 / view.scale} ${3 / view.scale}`} />
            <circle cx={a.x} cy={a.y} r={z.p50RadiusKm} fill="color-mix(in srgb, var(--color-risk-high) 10%, transparent)"
              stroke="color-mix(in srgb, var(--color-risk-high) 60%, transparent)" strokeWidth={1 / view.scale}
              strokeDasharray={`${2.5 / view.scale} ${2.5 / view.scale}`} />
            <circle cx={a.x} cy={a.y} r={Math.max(z.coreRadiusKm, 2)}
              fill="color-mix(in srgb, var(--color-risk-crit) 30%, transparent)" stroke="color-mix(in srgb, var(--color-risk-crit) 90%, transparent)" strokeWidth={1.2 / view.scale} />
          </>}
          <circle cx={a.x} cy={a.y} r={8 / view.scale} fill="none" stroke="var(--color-risk-crit)"
            strokeWidth={1.5 / view.scale} className="drill-berg-ping" />
          <g transform={`translate(${a.x} ${a.y}) scale(${1 / view.scale})`}>
            <rect x={12} y={-30} width={150} height={30} rx={2} fill="var(--map-plate)" stroke="var(--color-risk-med)" strokeWidth={0.8} />
            <text x={18} y={-18} fill="var(--color-risk-med)" fontSize={10} fontWeight={700} className="font-data">▲ {dev.bergId} — SIMULATED</text>
            <text x={18} y={-6} fill="var(--route-conservative)" fontSize={8.5} className="font-data">ungrounded · drifting into corridor</text>
          </g>
        </g>,
      );
    }

    // conflict point (stage 4+, until accepted)
    const conflict = byId.CONFLICT_DETECTED?.data;
    const enc = conflict?.riskAfter?.bergEncounters?.[0];
    if (conflictOn && !decided && enc && underway?.remainingWaypoints && dev?.after) {
      const a = project(dev.after.lon, dev.after.lat);
      els.push(
        <g key="dr-conflict" transform={`translate(${a.x} ${a.y}) scale(${1 / view.scale})`} pointerEvents="none">
          <text x={-8} y={40} fill="var(--color-risk-crit)" fontSize={11} fontWeight={800} className="font-data">■ CONFLICT</text>
          <text x={-8} y={52} fill="var(--map-crit-soft)" fontSize={8.5} className="font-data">closest approach {enc.closestKm} km</text>
        </g>,
      );
    }

    // NEW route (stage 5+): draws itself in
    const newProfile = replan?.plan?.recommendation.profile;
    const newRoute = replan?.plan?.routes.find((r) => r.profile === newProfile);
    if (replanOn && newRoute?.waypoints) {
      els.push(
        <path key={`dr-new-${stg >= 5}`} d={pathOf(newRoute.waypoints)} fill="none"
          stroke="var(--color-risk-low)" strokeWidth={decided ? 2.6 : 2.2}
          vectorEffect="non-scaling-stroke" strokeLinecap="round"
          pathLength={1} className={decided ? 'route-active-dash' : 'drill-draw-route'}
          strokeDasharray={decided ? '10 6' : undefined}
          pointerEvents="none" />,
      );
      const mid = newRoute.waypoints[Math.floor(newRoute.waypoints.length * 0.45)];
      const w = project(mid.lon, mid.lat);
      els.push(
        <g key="dr-newlbl" transform={`translate(${w.x} ${w.y}) scale(${1 / view.scale})`} pointerEvents="none">
          <rect x={-118} y={-8} width={110} height={16} rx={2} fill="var(--map-plate)" stroke="var(--color-risk-low)" strokeWidth={0.8} />
          <text x={-112} y={4} fill="var(--color-risk-low)" fontSize={10} fontWeight={700} className="font-data">
            {decided ? '✓ ACTIVE ROUTE' : '➜ NEW ROUTE'}
          </text>
        </g>,
      );
    }

    // endpoints always
    els.push(
      <g key="dr-o" transform={`translate(${o.x} ${o.y}) scale(${1 / view.scale})`} pointerEvents="none">
        <circle r={5} fill="none" stroke="var(--color-ink-dim)" strokeWidth={1.6} />
        <circle r={1.6} fill="var(--color-ink-dim)" />
        <text x={-10} y={-9} fill="var(--color-ink-dim)" fontSize={10} textAnchor="end" className="font-data">ORIGIN</text>
      </g>,
      <g key="dr-d" transform={`translate(${d.x} ${d.y}) scale(${1 / view.scale})`} pointerEvents="none">
        <path d="M0 -8 L6 4 L-6 4 Z" fill="none" stroke="var(--color-risk-low)" strokeWidth={1.6} />
        <text x={10} y={4} fill="var(--color-risk-low)" fontSize={10} className="font-data">BHARATI</text>
      </g>,
    );
    return els;
  }, [live, env.drill, env.drillStage, env.drillAccepted, view.scale]);

  const drillActive = live && env.drill !== null && env.drillStage >= 0;

  // Iceberg hazard zones from the risk engine (core / P50 / P90 radii are
  // empirical backtest quantiles — see docs/risk-methodology.md §4).
  const riskZoneElems = useMemo(() => {
    if (!live || !env.riskEnabled || !env.risk) return null;
    return env.risk.data.contributors.icebergs.zones.map((z) => {
      const w = project(z.lon, z.lat);
      return (
        <g key={`rz-${z.id}`} pointerEvents="none">
          <circle cx={w.x} cy={w.y} r={z.p90RadiusKm}
            fill="color-mix(in srgb, var(--color-risk-med) 6%, transparent)" stroke="color-mix(in srgb, var(--color-risk-med) 45%, transparent)"
            strokeWidth={0.8 / view.scale}
            strokeDasharray={`${4 / view.scale} ${3 / view.scale}`} />
          <circle cx={w.x} cy={w.y} r={z.p50RadiusKm}
            fill="color-mix(in srgb, var(--color-risk-high) 8%, transparent)" stroke="color-mix(in srgb, var(--color-risk-high) 55%, transparent)"
            strokeWidth={0.9 / view.scale}
            strokeDasharray={`${2.5 / view.scale} ${2.5 / view.scale}`} />
          <circle cx={w.x} cy={w.y} r={Math.max(z.coreRadiusKm, 2)}
            fill="color-mix(in srgb, var(--color-risk-crit) 25%, transparent)" stroke="color-mix(in srgb, var(--color-risk-crit) 80%, transparent)"
            strokeWidth={1 / view.scale} />
        </g>
      );
    });
  }, [live, env.riskEnabled, env.risk, view.scale]);

  // Live NIC iceberg markers (real observed positions — analyst product)
  const liveMarkers = useMemo(() => {
    if (!live || !layers.icebergs || !env.icebergs) return null;
    return env.icebergs.data.icebergs.map((b) => {
      const s = geo2s({ lon: b.lon, lat: b.lat });
      if (s.x < -30 || s.x > size.w + 30 || s.y < -30 || s.y > size.h + 30) return null;
      const sz = Math.min(9, 4 + (b.length_nm ?? 5) * 0.15);
      const situation = env.bergSituation?.data.situations.find((x) => x.id === b.id) ?? null;
      const focused = env.focusBergId === b.id;
      const toggleFocus = () => env.setFocusBergId(focused ? null : b.id);
      return (
        <g
          key={b.id}
          transform={`translate(${s.x} ${s.y})`}
          className="map-focusable"
          tabIndex={0}
          role="button"
          aria-label={`Iceberg ${b.id}, observed position${situation?.track ? ', tracked' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); setTooltip(null); toggleFocus(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') toggleFocus(); }}
          onMouseMove={(e) => showTip(e, <LiveBergTip berg={b} situation={situation} />)}
          onMouseLeave={() => setTooltip(null)}
        >
          {/* square-diamond glyph = REAL observed berg (vs triangle = demo) */}
          {focused && <circle r={sz + 5} fill="none" stroke="var(--color-model)" strokeWidth={1.2} strokeDasharray="3 3" />}
          <rect x={-sz * 0.7} y={-sz * 0.7} width={sz * 1.4} height={sz * 1.4}
            transform="rotate(45)" fill={focused ? 'color-mix(in srgb, var(--color-model) 25%, transparent)' : 'var(--map-plate)'} stroke="var(--color-risk-low)" strokeWidth={1.5} />
          <text x={sz + 5} y={3.5} fill="var(--color-risk-low)" fontSize={9.5} className="font-data">{b.id}</text>
        </g>
      );
    });
  }, [live, layers.icebergs, env.icebergs, env.bergSituation, env.focusBergId, env.setFocusBergId, geo2s, size, showTip]);

  // screen-space markers (demo scenario objects)
  const markers = useMemo(() => {
    if (live || !snapshot || !scenario) return null;
    const out: ReactNode[] = [];
    const dep = scenario.mission.departureUtc;

    // origin & destination
    const o = geo2s(scenario.mission.origin.position);
    const dst = geo2s(scenario.mission.destination.position);
    out.push(
      <g key="origin" transform={`translate(${o.x} ${o.y})`} pointerEvents="none">
        <circle r={4} fill="none" stroke="var(--color-ink-dim)" strokeWidth={1.4} />
        <circle r={1.5} fill="var(--color-ink-dim)" />
        <text x={-9} y={-7} fill="var(--color-ink-dim)" fontSize={10} textAnchor="end" className="font-data">ORIGIN</text>
      </g>,
      <g key="dest" transform={`translate(${dst.x} ${dst.y})`} pointerEvents="none">
        <path d="M0 -8 L6 4 L-6 4 Z" fill="none" stroke="var(--color-risk-low)" strokeWidth={1.6} />
        <circle r={1.4} fill="var(--color-risk-low)" cy={0.5} />
        <text x={9} y={4} fill="var(--color-risk-low)" fontSize={10} className="font-data">BHARATI APPROACH</text>
      </g>,
    );

    // icebergs
    if (layers.icebergs) {
      for (const b of snapshot.icebergs) {
        const s = geo2s(b.observations[b.observations.length - 1].position);
        if (s.x < -30 || s.x > size.w + 30 || s.y < -30 || s.y > size.h + 30) continue;
        const threat = b.routeThreatLevel === 'HIGH' || b.routeThreatLevel === 'CRITICAL';
        const sel = selection.kind === 'iceberg' && selection.id === b.id;
        const sizePx = b.sizeClass === 'VERY LARGE' ? 7.5 : b.sizeClass === 'LARGE' ? 6.5 : b.sizeClass === 'MEDIUM' ? 5.2 : 4.2;
        const col = threat ? 'var(--color-risk-high)' : 'var(--map-berg)';
        out.push(
          <g
            key={b.id}
            transform={`translate(${s.x} ${s.y})`}
            className="map-focusable"
            tabIndex={0}
            role="button"
            aria-label={`Iceberg ${b.id}, threat ${b.routeThreatLevel}`}
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); setTooltip(null); setSelection({ kind: 'iceberg', id: b.id }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') setSelection({ kind: 'iceberg', id: b.id }); }}
            onMouseMove={(e) => showTip(e, <BergTip berg={b} depIso={dep} />)}
            onMouseLeave={() => setTooltip(null)}
          >
            {threat && <circle r={6} fill="none" stroke="var(--color-risk-high)" strokeWidth={1} style={{ animation: 'berg-ping 1.8s ease-out infinite' }} />}
            <path
              d={`M0 ${-sizePx} L${sizePx * 0.9} ${sizePx * 0.55} L${-sizePx * 0.9} ${sizePx * 0.55} Z`}
              fill={sel ? col : 'var(--map-plate)'}
              stroke={col}
              strokeWidth={sel ? 2 : 1.4}
            />
            {(view.scale > 0.14 || threat || sel) && (
              <text x={sizePx + 4} y={3.5} fill={col} fontSize={9.5} className="font-data" opacity={0.95}>{b.id}</text>
            )}
          </g>,
        );
      }
    }

    // vessel
    const vs = geo2s(snapshot.vesselState.position);
    out.push(
      <g
        key="vessel"
        transform={`translate(${vs.x} ${vs.y})`}
        style={{ cursor: 'pointer', transition: 'transform 900ms cubic-bezier(0.4,0,0.2,1)' }}
        role="button"
        tabIndex={0}
        aria-label={`Vessel ${scenario.vessel.name}`}
        className="map-focusable"
        onClick={(e) => { e.stopPropagation(); setTooltip(null); setSelection({ kind: 'vessel' }); }}
        onKeyDown={(e) => { if (e.key === 'Enter') setSelection({ kind: 'vessel' }); }}
        onMouseMove={(e) => showTip(e, <VesselTip />)}
        onMouseLeave={() => setTooltip(null)}
      >
        <circle r={13} fill="color-mix(in srgb, var(--color-accent) 10%, transparent)" />
        <circle r={13} fill="none" stroke="color-mix(in srgb, var(--color-accent) 45%, transparent)" strokeWidth={1} className="pulse-dot" />
        <g transform={`rotate(${snapshot.vesselState.headingDeg})`}>
          <path d="M0 -9 L5 5 L0 2.4 L-5 5 Z" fill="var(--color-accent)" stroke="var(--map-marker-core)" strokeWidth={0.8} />
        </g>
        <text x={16} y={-8} fill="var(--color-accent)" fontSize={10} fontWeight={700} className="font-data">{scenario.vessel.name.split(' ').pop()?.toUpperCase()}</text>
        <text x={16} y={3} fill="var(--color-ink-dim)" fontSize={9} className="font-data">{snapshot.vesselState.speedKn.toFixed(1)} kn · {String(snapshot.vesselState.headingDeg).padStart(3, '0')}°</text>
      </g>,
    );
    return out;
  }, [live, snapshot, scenario, layers.icebergs, selection, geo2s, size, view.scale, setSelection, showTip]);

  if (!snapshot || !scenario) return null;

  return (
    <div
      ref={wrapRef}
      className={`nav-scene relative h-full w-full overflow-hidden select-none ${viewMode === '3D' ? 'nav-scene-3d' : ''} ${dragging ? 'map-grabbing' : 'map-grab'}`}
      style={{ background: 'radial-gradient(120% 90% at 50% 10%, var(--map-bg-0) 0%, var(--map-bg-1) 45%, var(--map-bg-2) 100%)' }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => { onPointerMove(e); onProbeMove(e); }}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="application"
      aria-label="Antarctic mission map. Arrow keys pan, plus and minus zoom, 0 resets."
    >
      {/* raster underlay */}
      <canvas ref={canvasRef} className="absolute inset-0" style={{ width: size.w, height: size.h }} />

      {/* vector overlay */}
      <svg
        width={size.w} height={size.h} className="absolute inset-0"
        style={mission.pickTarget ? { cursor: 'crosshair' } : undefined}
        onClick={(e) => {
          if (mission.pickTarget) {
            const rect = wrapRef.current!.getBoundingClientRect();
            const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, view, size.w, size.h);
            const g = unproject(w.x, w.y);
            mission.reportPickedPoint(Number(g.lat.toFixed(4)), Number(g.lon.toFixed(4)));
            return;
          }
          setSelection({ kind: 'none' });
        }}
      >
        <g transform={worldTransform}>
          {/* graticule */}
          {layers.graticule && (
            <g pointerEvents="none">
              {staticPaths.graticule.paths.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="var(--map-graticule)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
              ))}
              {view.scale > 0.09 && staticPaths.graticule.labels.map((l, i) => (
                <text key={i} x={l.at.x} y={l.at.y} fill="var(--map-graticule-label)" fontSize={10 / view.scale} className="font-data" textAnchor="middle">{l.text}</text>
              ))}
            </g>
          )}

          {/* ice shelves + land */}
          <path d={staticPaths.shelf} fill="var(--map-shelf)" stroke="var(--map-shelf-line)" strokeWidth={0.7} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <path d={staticPaths.land} fill="var(--map-land)" stroke="var(--map-land-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />

          {weatherElems}
          {liveWeatherElems}
          {live && riskZoneElems}
          {live && bergTrackElems}
          {!drillActive && !missionActive && live && optRouteElems}
          {missionActive && missionElems}
          {drillActive && drillElems}
          {!live && trajectoryElems}
          {!live && routeElems}
        </g>

        {/* screen-space markers */}
        {markers}
        {liveMarkers}
      </svg>

      {/* spatial navigation furniture */}
      <div className="nav-instrument-bar absolute top-3 right-3 z-10 flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
        <button className={`nav-mode-btn ${viewMode === '3D' ? 'active' : ''}`} onClick={() => setViewMode('3D')} aria-pressed={viewMode === '3D'}>3D PERSPECTIVE</button>
        <button className={`nav-mode-btn ${viewMode === '2D' ? 'active' : ''}`} onClick={() => setViewMode('2D')} aria-pressed={viewMode === '2D'}>2D POLAR</button>
        <span className="nav-divider" />
        <span className="nav-compass" aria-label="North up">N</span>
        <span className="nav-readout">NORTH UP · HUMAN REVIEW</span>
      </div>
      <div className="nav-depth-grid" aria-hidden="true" />
      {live && cursorProbe && !dragging && (
        <div className="absolute bottom-8 right-14 pointer-events-none font-data text-[9px] text-ink-dim bg-panel/85 border border-line rounded-sm px-2 py-1">
          {cursorProbe}
        </div>
      )}
      <MapScaleBar view={view} />
      <ZoomControls zoomIn={() => zoomBy(1.35)} zoomOut={() => zoomBy(1 / 1.35)} reset={resetView} />
      <div className="absolute left-3 top-3 flex items-center gap-2 pointer-events-none">
        {live ? (
          <>
            {env.error ? (
              <span className="badge" style={{ color: 'var(--color-risk-high)', borderColor: 'color-mix(in srgb, var(--color-risk-high) 50%, transparent)', background: 'color-mix(in srgb, var(--color-risk-high) 8%, transparent)' }}>
                ▲ FEED UNAVAILABLE
              </span>
            ) : drillActive ? (
              <span className="badge badge-sim">
                SIMULATION · {env.drill?.data.stages[env.drillStage]?.simTime}
              </span>
            ) : missionActive && mission.sim ? (
              <span className="badge badge-sim">
                VOYAGE SIMULATION · {new Date(mission.sim.simTimeMs).toISOString().slice(0, 16)}Z
              </span>
            ) : env.forecastHorizon !== null && env.forecast ? (
              <span className="badge" style={{ color: 'var(--color-model)', borderColor: 'color-mix(in srgb, var(--color-model) 50%, transparent)', background: 'color-mix(in srgb, var(--color-model) 10%, transparent)' }}>
                {env.showSigma ? `UNCERTAINTY +${env.forecastHorizon}H` : `SEA-ICE FORECAST +${env.forecastHorizon}H`}
              </span>
            ) : (
              <span className="badge badge-live">LIVE</span>
            )}
          </>
        ) : (
          <span className="badge badge-sim">SIMULATION</span>
        )}
      </div>

      {tooltip && (
        <div
          className="tooltip absolute z-20 slide-up"
          style={{
            left: Math.min(tooltip.x + 14, size.w - 270),
            top: Math.min(tooltip.y + 12, size.h - 120),
          }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}

// ── furniture & tooltips ───────────────────────────────────────────────

function MapScaleBar({ view }: { view: MapView }) {
  // choose a nice round km distance ≈120 px
  const targetKm = 120 / view.scale;
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000];
  const km = steps.reduce((a, b) => (Math.abs(b - targetKm) < Math.abs(a - targetKm) ? b : a));
  const px = km * view.scale;
  return (
    <div className="absolute bottom-3 left-3 pointer-events-none">
      <div className="flex items-end gap-2">
        <div>
          <div className="text-[9px] font-data text-ink-faint mb-0.5">{km} km · {Math.round(km / NM_TO_KM)} nm</div>
          <div style={{ width: px }} className="h-[3px] bg-ink-dim/70 relative">
            <div className="absolute left-0 -top-[3px] w-[1px] h-[9px] bg-ink-dim/70" />
            <div className="absolute right-0 -top-[3px] w-[1px] h-[9px] bg-ink-dim/70" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoomControls({ zoomIn, zoomOut, reset }: { zoomIn: () => void; zoomOut: () => void; reset: () => void }) {
  return (
    <div className="absolute right-3 bottom-3 flex flex-col gap-1">
      <button className="btn !px-2.5 !py-1.5 font-data !text-[13px]" onClick={zoomIn} aria-label="Zoom in">+</button>
      <button className="btn !px-2.5 !py-1.5 font-data !text-[13px]" onClick={zoomOut} aria-label="Zoom out">−</button>
      <button className="btn !px-2 !py-1.5 !text-[9px]" onClick={reset} aria-label="Reset view">FIT</button>
    </div>
  );
}

function LiveBergTip({ berg, situation }: { berg: NicIceberg; situation: BergSituation | null }) {
  const pred = situation?.prediction ?? null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-data font-bold text-ice">{berg.id}</span>
        <span className="font-data text-[9px]" style={{ color: 'var(--color-risk-low)' }}>OBSERVED</span>
      </div>
      <div className="text-ink-dim text-[10.5px] leading-relaxed">
        {berg.length_nm ?? '?'} × {berg.width_nm ?? '?'} nm · {berg.area_km2 ?? '?'} km²<br />
        {fmtPos(berg.lon, berg.lat)}<br />
        USNIC analysis {berg.last_update ?? 'date unknown'}
      </div>
      {situation?.track && (
        <div className="text-ink-dim text-[10px] mt-1 leading-relaxed">
          <span style={{ color: 'var(--color-risk-low)' }}>TRACK</span> {situation.track.nObs} obs → {situation.track.last} ·
          drift {situation.track.meanSpeedKmD} km/d
          {pred && (
            <>
              <br />
              <span style={{ color: 'var(--color-model)' }}>FORECAST</span> {pred.regime === 'MOVING'
                ? `+7 d corridor ±${pred.trajectory[pred.trajectory.length - 1]?.corridorP90Km ?? '?'} km (P90)`
                : 'grounded/slow — stationary expected'}
            </>
          )}
        </div>
      )}
      <div className="text-ink-faint text-[9.5px] mt-1">
        {situation?.track ? 'Click to focus track & prediction' : 'U.S. National Ice Center · named bergs ≥10 nm'}
      </div>
    </div>
  );
}

function BergTip({ berg, depIso }: { berg: Iceberg; depIso: string }) {
  const last = berg.observations[berg.observations.length - 1];
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-data font-bold text-ice">{berg.id}</span>
        <span className={`font-data text-[10px] risk-${berg.routeThreatLevel}`}>{berg.routeThreatLevel} THREAT</span>
      </div>
      <div className="text-ink-dim text-[10.5px] leading-relaxed">
        {berg.sizeClass} · {berg.lengthM} m · drift {berg.driftSpeedKn.toFixed(2)} kn @ {berg.driftBearingDeg}°<br />
        {fmtPos(last.position.lon, last.position.lat)}<br />
        Last obs {fmtScenarioTime(depIso, last.timeOffsetH)} <span className="text-risk-MEDIUM">(SIMULATED)</span>
      </div>
      <div className="text-ink-faint text-[9.5px] mt-1">Click for full intelligence panel</div>
    </div>
  );
}

function OptRouteTip({ route, candidate = false }: { route: OptRoute; candidate?: boolean }) {
  const exp = route.risk?.exposurePct;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-data font-bold text-ice">{route.profile}</span>
        {candidate && <span className="font-data text-[9px]" style={{ color: 'var(--color-model)' }}>CANDIDATE</span>}
        {route.recommended && <span className="font-data text-[9px] text-risk-LOW">★ RECOMMENDED</span>}
      </div>
      <div className="text-ink-dim text-[10.5px] leading-relaxed">
        {route.distanceNm?.toFixed(0)} nm · est {route.estTimeH?.toFixed(1)} h ·
        max severity {route.risk?.overallSeverity}<br />
        {exp && (exp.HIGH > 0 || exp.CRITICAL > 0)
          ? `HIGH+CRITICAL exposure ${(exp.HIGH + exp.CRITICAL).toFixed(1)}% of length`
          : 'No HIGH/CRITICAL exposure'}
      </div>
      <div className="text-ink-faint text-[9.5px] mt-1">Ceiling {route.severityCeiling} · click to focus</div>
    </div>
  );
}

function RouteTip({ route, active }: { route: Route; active: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-data font-bold text-ice">{route.label}</span>
        {active && <span className="font-data text-[9px] text-accent">ACTIVE</span>}
      </div>
      <div className="text-ink-dim text-[10.5px]">
        {route.distanceNm} nm · est {Math.round(route.estTimeH)} h · risk {route.riskScore} ({route.riskLevel})
      </div>
    </div>
  );
}

function VesselTip() {
  const { scenario, snapshot } = useStore();
  if (!scenario || !snapshot) return null;
  return (
    <div>
      <div className="font-data font-bold text-ice mb-1">{scenario.vessel.name}</div>
      <div className="text-ink-dim text-[10.5px] leading-relaxed">
        {scenario.vessel.type} · ICE CLASS {scenario.vessel.iceClass}<br />
        {fmtPos(snapshot.vesselState.position.lon, snapshot.vesselState.position.lat)}<br />
        SOG {snapshot.vesselState.speedKn.toFixed(1)} kn · HDG {String(snapshot.vesselState.headingDeg).padStart(3, '0')}°
      </div>
    </div>
  );
}
