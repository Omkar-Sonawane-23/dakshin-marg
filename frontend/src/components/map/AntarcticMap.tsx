/**
 * AntarcticMap — the 3D hero of the command center.
 *
 * Layering (kept deliberately strict):
 *
 *   src/map3d/*            3D rendering — WebGL, three.js, no React
 *   ./sceneData.ts         data mapping — stores → SceneInput
 *   this file              host + interaction semantics
 *   ./MapHud, ./MiniMap,   UI chrome floating over the scene
 *   ./MapLabels, ./MapTooltip
 *
 * Everything the flat renderer could do, this still does: the same layers,
 * the same selection model, the same tooltips, the same click-to-pick for the
 * mission wizard, the same fly-to requests, the same keyboard shortcuts. What
 * changed is that the chart is now a real environment.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CameraState, PickResult, PolarScene, SceneInput } from '../../map3d/PolarScene';
import { useStore } from '../../state/store';
import { useEnv } from '../../state/envStore';
import { useMission } from '../../state/missionStore';
import { useTheme } from '../../state/themeStore';
import { buildSceneInput, buildLabels, buildDrillView } from './sceneData';
import type { MapDataDeps, MapLabelSpec } from './sceneData';
import MapHud from './MapHud';
import type { CameraApi } from './MapHud';
import MapLabels from './MapLabels';
import MapTooltip from './MapTooltip';
import MiniMap from './MiniMap';

export default function AntarcticMap() {
  const { snapshot, scenario, layers, selection, setSelection } = useStore();
  const env = useEnv();
  const mission = useMission();
  const { theme } = useTheme();
  const live = env.mode === 'LIVE';
  const missionActive = live && mission.mission !== null;

  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PolarScene | null>(null);
  const tipBoxRef = useRef<HTMLDivElement>(null);
  const lastPointer = useRef({ x: 0, y: 0 });
  const probeRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [cam, setCam] = useState<CameraState | null>(null);
  const [viewMode, setViewMode] = useState<'3D' | '2D'>('3D');
  const [hover, setHover] = useState<PickResult>({ kind: 'none' });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const fitted = useRef(false);

  // ── sizing ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
      sceneRef.current?.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── store state → scene deps ──────────────────────────────────────────
  const deps = useMemo<MapDataDeps>(() => {
    // sea-ice / forecast / σ raster (exactly the source the canvas used)
    let seaIceGrid: SceneInput['field'] = null;
    let fieldMode: SceneInput['fieldMode'] = 'CONCENTRATION';
    if (env.forecastHorizon !== null && env.forecast) {
      if (env.showSigma) {
        seaIceGrid = { grid: env.forecast.data.grid, sigma: env.forecast.data.sigmaGrid };
        fieldMode = 'SIGMA';
      } else {
        seaIceGrid = { grid: env.forecast.data.grid, values: env.forecast.data.grid.values };
      }
    } else if (env.seaIce) {
      seaIceGrid = { grid: env.seaIce.data.grid, values: env.seaIce.data.grid.values };
    }

    const rg = env.risk?.data.grid ?? null;
    const riskGrid: SceneInput['field'] =
      env.riskEnabled && rg ? { grid: rg, severity: rg.severity } : null;

    const sampleSeverity = (lon: number, lat: number): string => {
      if (!rg) return 'HIGH';
      const i = Math.floor((lon - rg.lon0) / rg.dLon);
      const j = Math.floor((lat - rg.lat0) / rg.dLat);
      if (i < 0 || j < 0 || i >= rg.nLon || j >= rg.nLat) return 'HIGH';
      const idx = rg.severity[j][i];
      return idx >= 0 ? rg.severityScale[idx] : 'HIGH';
    };

    const sitMap = new Map<string, {
      bearingDeg: number | null;
      track: { lon: number; lat: number }[] | null;
      prediction: { lon: number; lat: number; corridorKm: number | null }[] | null;
      moving: boolean;
    }>();
    for (const s of env.bergSituation?.data.situations ?? []) {
      sitMap.set(s.id, {
        bearingDeg: s.track?.bearingDeg ?? null,
        track: s.track && s.track.recentPath.length > 1
          ? s.track.recentPath.map((p) => ({ lon: p.lon, lat: p.lat }))
          : null,
        prediction: s.prediction && s.prediction.regime === 'MOVING'
          ? s.prediction.trajectory.map((tp) => ({ lon: tp.lon, lat: tp.lat, corridorKm: tp.corridorP90Km }))
          : null,
        moving: s.prediction?.regime === 'MOVING',
      });
    }

    return {
      live,
      theme,
      layers,
      selection,
      scenario,
      snapshot,
      env: {
        seaIceGrid,
        riskGrid,
        fieldMode,
        riskEnabled: env.riskEnabled,
        icebergs: (env.icebergs?.data.icebergs ?? []).map((b) => ({
          id: b.id, lon: b.lon, lat: b.lat,
          length_nm: b.length_nm, width_nm: b.width_nm,
        })),
        bergSituation: sitMap,
        focusBergId: env.focusBergId,
        showBergPredictions: env.showBergPredictions,
        zones: (env.risk?.data.contributors.icebergs.zones ?? []).map((z) => ({
          id: z.id, lon: z.lon, lat: z.lat,
          coreRadiusKm: z.coreRadiusKm,
          p50RadiusKm: z.p50RadiusKm,
          p90RadiusKm: z.p90RadiusKm,
          severity: sampleSeverity(z.lon, z.lat) as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
          focused: env.focusBergId === z.id,
        })),
        wind: (env.weather?.data.cells ?? []).map((c) => ({
          lon: c.lon, lat: c.lat, windSpeedKn: c.windSpeedKn, windDirDeg: c.windDirDeg,
        })),
        optRoutes: env.routePlan?.data.routes ?? null,
        optOrigin: env.routePlan?.data.request.origin ?? null,
        optDestination: env.routePlan?.data.request.destination ?? null,
        selectedRouteProfile: env.selectedRouteProfile,
        drill: env.drill ? buildDrillView(env.drill.data, env.drillStage, env.drillAccepted) : null,
        error: !!env.error,
      },
      mission: {
        active: missionActive,
        mission: mission.mission,
        sim: mission.sim,
        candidatePlan: mission.candidatePlan?.data.routes ?? null,
        selectedProfile: mission.selectedProfile,
        reviewWorstAt: mission.reviewAlert?.worstAt ?? null,
      },
      animate: {
        waves: true,
        windParticles: layers.weather,
        routeFlow: true,
        pulses: true,
      },
    };
  }, [live, theme, layers, selection, scenario, snapshot, env, missionActive,
      mission.mission, mission.sim, mission.candidatePlan, mission.selectedProfile, mission.reviewAlert]);

  const input = useMemo(() => buildSceneInput(deps), [deps]);
  const labels = useMemo(() => buildLabels(input), [input]);

  // Pick handling lives in a ref so the scene (created once) always calls the
  // latest closure without being torn down on every store change.
  const pickRef = useRef<(r: PickResult) => void>(() => {});
  // The 3D chunk loads asynchronously, so the data-push effect below runs
  // before the scene exists. This holds the newest input to hand over.
  const inputRef = useRef<SceneInput>(input);
  inputRef.current = input;

  // ── scene lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const quality = window.innerWidth < 900 ? 0.6 : window.devicePixelRatio > 2 ? 0.85 : 1;
    // three.js is ~600 kB minified. Loading it on demand keeps the shell, the
    // panels and the mission workflows interactive while the chunk arrives.
    let scene: PolarScene | null = null;
    let cancelled = false;
    void import('../../map3d/PolarScene')
      .then(({ PolarScene: Scene }) => {
        if (cancelled) return;
        scene = new Scene(
          el,
          {
            onHover: (r) => setHover(r),
            onPointerMove: (x, y, under) => {
              lastPointer.current = { x, y };
              const box = tipBoxRef.current;
              if (box) {
                const w = box.offsetWidth || 220;
                const h = box.offsetHeight || 90;
                box.style.left = `${Math.min(x + 16, el.clientWidth - w - 8)}px`;
                box.style.top = `${Math.min(y + 14, el.clientHeight - h - 8)}px`;
              }
              const probe = probeRef.current;
              if (probe) {
                probe.textContent =
                  under.kind === 'background' && under.lat != null
                    ? `${Math.abs(under.lat).toFixed(2)}°S ${under.lon!.toFixed(2)}°E`
                    : '';
              }
            },
            onPick: (r) => pickRef.current(r),
            onCamera: (c) => setCam(c),
          },
          quality,
        );
        // The data-push effect already ran while the chunk was in flight.
        scene.setInput(inputRef.current);
        sceneRef.current = scene;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setSceneFailed(true);
      });
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, []);

  // Position a freshly-mounted tooltip immediately (the pointer already moved
  // before React had a box to position).
  useLayoutEffect(() => {
    const box = tipBoxRef.current;
    const el = wrapRef.current;
    if (!box || !el) return;
    const w = box.offsetWidth || 220;
    const h = box.offsetHeight || 90;
    box.style.left = `${Math.min(lastPointer.current.x + 16, el.clientWidth - w - 8)}px`;
    box.style.top = `${Math.min(lastPointer.current.y + 14, el.clientHeight - h - 8)}px`;
  }, [hover]);

  // ── push data into the scene ──────────────────────────────────────────
  useEffect(() => {
    sceneRef.current?.setInput(input);
  }, [input]);

  // ── initial fit to the mission corridor ───────────────────────────────
  useEffect(() => {
    if (!ready || fitted.current) return;
    fitted.current = true;
    sceneRef.current?.reset();
  }, [ready]);

  // ── fly to mission focus request ("View affected segment") ────────────
  useEffect(() => {
    if (!mission.focusRequest || !sceneRef.current) return;
    const s = sceneRef.current;
    s.flyTo(mission.focusRequest.lon, mission.focusRequest.lat, Math.min(
      s.cameraState().distanceKm, s.distanceForScale(0.5),
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission.focusRequest?.ts]);

  // ── fly to a focused berg (tracking layer) ────────────────────────────
  useEffect(() => {
    if (!env.focusBergId || !sceneRef.current) return;
    const s = env.bergSituation?.data.situations.find((x) => x.id === env.focusBergId);
    const pos = s?.usnicCurrent ?? (s?.track ? { lat: s.track.lastLat, lon: s.track.lastLon } : null);
    if (!pos) return;
    const sc = sceneRef.current;
    sc.flyTo(pos.lon, pos.lat, Math.min(sc.cameraState().distanceKm, sc.distanceForScale(0.55)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env.focusBergId]);

  // ── re-frame when routes are generated or drill changes ──────────────
  useEffect(() => {
    if (!ready || !sceneRef.current) return;
    if (deps.env.optRoutes && deps.env.optRoutes.length > 0) {
      sceneRef.current.reset();
    }
  }, [ready, deps.env.optRoutes]);

  useEffect(() => {
    if (!ready || !sceneRef.current) return;
    if (mission.mission?.routePlan?.data?.routes && mission.mission.routePlan.data.routes.length > 0) {
      sceneRef.current.reset();
    }
  }, [ready, mission.mission?.routePlan]);

  useEffect(() => {
    if (!ready || !sceneRef.current) return;
    if (deps.env.drill && deps.env.drill.stage >= 0) {
      sceneRef.current.reset();
    }
  }, [ready, deps.env.drill?.stage]);

  // ── picking ───────────────────────────────────────────────────────────
  const onPick = useCallback((r: PickResult) => {
    // mission wizard point picking (unchanged contract)
    if (mission.pickTarget) {
      if (r.kind === 'background' && r.lat != null && r.lon != null) {
        mission.reportPickedPoint(Number(r.lat.toFixed(4)), Number(r.lon.toFixed(4)));
      }
      return;
    }
    if (r.kind === 'iceberg' && r.id) {
      if (live) env.setFocusBergId(env.focusBergId === r.id ? null : r.id);
      else { setSelection({ kind: 'iceberg', id: r.id }); setHover(r); }
      return;
    }
    if (r.kind === 'vessel') { setSelection({ kind: 'vessel' }); return; }
    if (r.kind === 'route' && r.id) {
      const id = r.id;
      if (id.startsWith('opt:CAND:')) {
        const p = `CAND:${id.slice(9)}`;
        mission.setSelectedProfile(mission.selectedProfile === p ? null : p);
      } else if (id.startsWith('opt:')) {
        const p = id.slice(4);
        if (missionActive) mission.setSelectedProfile(mission.selectedProfile === p ? null : p);
        else env.setSelectedRouteProfile(env.selectedRouteProfile === p ? null : p);
      } else if (!live) {
        setSelection({ kind: 'route', id });
      }
      return;
    }
    setSelection({ kind: 'none' });
  }, [mission, missionActive, live, env, setSelection]);
  pickRef.current = onPick;

  // ── keyboard pan/zoom (unchanged shortcuts) ───────────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const s = sceneRef.current;
    if (!s) return;
    const step = 90;
    if (e.key === 'ArrowLeft') s.panByPixels(-step, 0);
    else if (e.key === 'ArrowRight') s.panByPixels(step, 0);
    else if (e.key === 'ArrowUp') s.panByPixels(0, -step);
    else if (e.key === 'ArrowDown') s.panByPixels(0, step);
    else if (e.key === '+' || e.key === '=') s.zoomBy(1.3);
    else if (e.key === '-') s.zoomBy(1 / 1.3);
    else if (e.key === '0') { s.reset(); setViewMode('3D'); s.setTopDownLock(false); }
    else return;
    e.preventDefault();
  }, []);

  // ── camera API for the HUD ────────────────────────────────────────────
  const activeRoutePoints = useMemo(() => {
    const r = input.routes.find((x) => x.animated) ?? input.routes.find((x) => x.emphasized);
    return r?.waypoints ?? null;
  }, [input.routes]);

  const api = useMemo<CameraApi>(() => ({
    setTopDown: (on) => {
      sceneRef.current?.setTopDown(on);
      setViewMode(on ? '2D' : '3D');
    },
    zoomBy: (f) => sceneRef.current?.zoomBy(f),
    rotateBy: (d) => sceneRef.current?.rotateBy(d),
    setTilt: (t) => {
      sceneRef.current?.setTilt(t);
      setViewMode(t > 80 ? '2D' : '3D');
    },
    reset: () => {
      sceneRef.current?.reset();
      sceneRef.current?.setTopDownLock(false);
      setViewMode('3D');
    },
    centerVessel: () => {
      const v = input.vessel;
      const s = sceneRef.current;
      if (!v || !s) return;
      s.flyTo(v.lon, v.lat, Math.min(s.cameraState().distanceKm, s.distanceForScale(0.9)));
    },
    centerRoute: () => {
      const s = sceneRef.current;
      if (!s || !activeRoutePoints) return;
      s.framePoints(activeRoutePoints, 1.35);
    },
    fullscreen: () => {
      const el = wrapRef.current;
      if (!el) return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void el.requestFullscreen?.();
    },
  }), [input.vessel, activeRoutePoints]);

  const onViewMode = useCallback((m: '3D' | '2D') => {
    setViewMode(m);
    sceneRef.current?.setTopDown(m === '2D');
  }, []);

  // ── derived readouts ──────────────────────────────────────────────────
  const kmPerPixel = useMemo(() => {
    if (!cam) return 4;
    return (2 * cam.distanceKm * Math.tan((42 * Math.PI) / 360)) / size.h;
  }, [cam, size.h]);

  const vesselMini = input.vessel ? { lon: input.vessel.lon, lat: input.vessel.lat, headingDeg: input.vessel.headingDeg } : null;
  const riskMini = useMemo(() => input.zones.map((z) => ({
    lon: z.lon, lat: z.lat, rKm: z.p90RadiusKm,
    sev: z.severity === 'CRITICAL' ? 'CRITICAL' : z.severity === 'MEDIUM' ? 'MEDIUM' : 'HIGH',
  })), [input.zones]);

  const drillActive = live && env.drill !== null && env.drillStage >= 0;
  const statusBadge = statusBadgeFor({ live, env, drillActive, missionActive, missionSim: mission.sim });

  return (
    <div
      ref={wrapRef}
      className={`nav-scene relative h-full w-full overflow-hidden select-none ${dragCursorClass(mission.pickTarget !== null)}`}
      tabIndex={0}
      role="application"
      aria-label="Antarctic 3D navigation environment. Drag to pan free like Google Maps, right-drag to orbit, scroll to zoom. Arrow keys pan, plus and minus zoom, 0 resets."
      onKeyDown={onKeyDown}
      style={{ background: theme === 'light' ? 'var(--map-bg-0)' : 'var(--color-abyss)' }}
    >
      {/* 3D canvas mounts here (appended by PolarScene) */}

      {/* The scene chunk is fetched on demand — show its state meanwhile. */}
      {!ready && !sceneFailed && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <span className="badge font-data">LOADING 3D SCENE…</span>
        </div>
      )}
      {sceneFailed && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <div className="panel rounded-sm px-4 py-3 max-w-sm text-center">
            <div className="label-xs mb-1">3D SCENE UNAVAILABLE</div>
            <p className="text-[10px] text-ink-dim leading-snug">
              The WebGL renderer could not be loaded. Panels, alerts and mission
              workflows are unaffected.
            </p>
            <button className="btn mt-2 !text-[9px]" onClick={() => window.location.reload()}>
              RETRY
            </button>
          </div>
        </div>
      )}

      <MapLabels scene={sceneRef.current} labels={labels} ready={ready} />

      <MapHud
        cam={cam}
        viewMode={viewMode}
        onViewMode={onViewMode}
        api={api}
        hasVessel={!!input.vessel}
        hasRoute={!!activeRoutePoints}
      />

      <MiniMap
        vessel={vesselMini}
        route={activeRoutePoints}
        endpoints={labels.filter((l) => l.kind === 'endpoint')}
        risk={riskMini}
        center={cam ? { lon: cam.centerLon, lat: cam.centerLat } : null}
        onReposition={(lon, lat) => sceneRef.current?.flyTo(lon, lat)}
      />

      <div className="absolute left-3 top-3 flex items-center gap-2 pointer-events-none flex-wrap max-w-[52%]">
        {statusBadge}
        {mission.pickTarget && (
          <span className="badge badge-live">CLICK THE MAP TO SET {mission.pickTarget.toUpperCase()}</span>
        )}
      </div>

      {live && (
        <div
          ref={probeRef}
          className="absolute bottom-8 right-16 pointer-events-none font-data text-[9px] text-ink-dim bg-panel/85 border border-line rounded-sm px-2 py-1"
        />
      )}

      <MapScaleBar kmPerPixel={kmPerPixel} />

      {hover.kind !== 'none' && hover.kind !== 'background' && (
        <div ref={tipBoxRef} className="tooltip absolute z-20 slide-up" style={{ left: 0, top: 0 }}>
          <MapTooltip pick={hover} />
        </div>
      )}
    </div>
  );
}

function dragCursorClass(picking: boolean): string {
  return picking ? 'cursor-crosshair' : 'map-grab';
}

/** Mode/provenance badge — the operator must always know which data is on screen. */
function statusBadgeFor(args: {
  live: boolean;
  env: ReturnType<typeof useEnv>;
  drillActive: boolean;
  missionActive: boolean;
  missionSim: ReturnType<typeof useMission>['sim'];
}) {
  const { live, env, drillActive, missionActive, missionSim } = args;
  if (!live) return <span className="badge badge-sim">SIMULATION</span>;
  if (env.error) {
    return (
      <span className="badge" style={{
        color: 'var(--color-risk-high)',
        borderColor: 'color-mix(in srgb, var(--color-risk-high) 50%, transparent)',
        background: 'color-mix(in srgb, var(--color-risk-high) 8%, transparent)',
      }}>
        ▲ FEED UNAVAILABLE
      </span>
    );
  }
  if (drillActive) {
    return <span className="badge badge-sim">SIMULATION · {env.drill?.data.stages[env.drillStage]?.simTime}</span>;
  }
  if (missionActive && missionSim) {
    return (
      <span className="badge badge-sim">
        VOYAGE SIMULATION · {new Date(missionSim.simTimeMs).toISOString().slice(0, 16)}Z
      </span>
    );
  }
  if (env.forecastHorizon !== null && env.forecast) {
    return (
      <span className="badge" style={{
        color: 'var(--color-model)',
        borderColor: 'color-mix(in srgb, var(--color-model) 50%, transparent)',
        background: 'color-mix(in srgb, var(--color-model) 10%, transparent)',
      }}>
        {env.showSigma ? `UNCERTAINTY +${env.forecastHorizon}H` : `SEA-ICE FORECAST +${env.forecastHorizon}H`}
      </span>
    );
  }
  return <span className="badge badge-live">LIVE</span>;
}

/** Scale bar — computed from the camera, so it stays true in 3D and 2D. */
function MapScaleBar({ kmPerPixel }: { kmPerPixel: number }) {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000];
  const targetKm = 120 * kmPerPixel;
  const km = steps.reduce((a, b) => (Math.abs(b - targetKm) < Math.abs(a - targetKm) ? b : a));
  const px = km / kmPerPixel;
  return (
    <div className="absolute bottom-3 left-3 pointer-events-none z-10">
      <div className="text-[9px] font-data text-ink-faint mb-0.5">{km} km · {Math.round(km / 1.852)} nm</div>
      <div style={{ width: px }} className="h-[3px] bg-ink-dim/70 relative">
        <div className="absolute left-0 -top-[3px] w-[1px] h-[9px] bg-ink-dim/70" />
        <div className="absolute right-0 -top-[3px] w-[1px] h-[9px] bg-ink-dim/70" />
      </div>
    </div>
  );
}

export type { MapLabelSpec };
