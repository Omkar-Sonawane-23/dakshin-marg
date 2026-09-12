/** Bottom bar for an active mission — simulation transport controls,
 * mission clock, forecast-window timeline with the data edge marked.
 */

import { SIM_SPEEDS, SIM_STEPS_H, useMission } from '../../state/missionStore';

const STEP_LABEL: Record<number, string> = { 0.25: '15m', 1: '1h', 3: '3h', 6: '6h', 12: '12h' };

export default function MissionTimeBar() {
  const ms = useMission();
  const m = ms.mission;
  const sim = ms.sim;
  if (!m || !sim) return null;

  const departMs = Date.parse(m.departureUtc);
  const windowEndMs = ms.availability ? Date.parse(ms.availability.window.end) : departMs;
  const span = Math.max(1, windowEndMs - departMs);
  const pct = Math.min(100, Math.max(0, ((sim.simTimeMs - departMs) / span) * 100));

  const simIso = new Date(sim.simTimeMs).toISOString();
  const route = ms.activeRoute;
  const remainNm = route?.distanceNm != null
    ? Math.max(0, (route.distanceNm) - (sim.distanceCoveredNm - (route.distanceNm >= sim.distanceCoveredNm ? 0 : 0)))
    : null;

  return (
    <div className="flex-none border-t border-line bg-deep/95 backdrop-blur px-4 py-2 z-20">
      {sim.dataEdge && (
        <div className="mb-1.5 text-[10px] text-risk-MEDIUM font-data" role="alert">
          ⚠ {sim.dataEdge}
        </div>
      )}
      <div className="flex items-center gap-4 flex-wrap">
        {/* transport */}
        <div className="flex items-center gap-1.5 flex-none">
          <button className="btn !px-2.5" onClick={() => ms.stepBy(-(SIM_STEPS_H[1]))}
            aria-label="Step back 1 hour" disabled={sim.playing}>◀</button>
          <button
            className={`btn ${sim.playing ? '' : 'btn-accent'} !px-3.5`}
            onClick={() => (sim.playing ? ms.pause() : ms.play())}
            disabled={sim.completed}
            aria-label={sim.playing ? 'Pause simulation' : 'Play simulation'}
          >
            {sim.playing ? '❚❚ PAUSE' : '▶ PLAY'}
          </button>
          {SIM_STEPS_H.map((h) => (
            <button key={h} className="btn !px-2 !text-[9px]"
              onClick={() => ms.stepBy(h)} disabled={sim.completed}>
              +{STEP_LABEL[h]}
            </button>
          ))}
          <button className="btn btn-ghost !text-[9px]" onClick={ms.resetSim} aria-label="Reset simulation">⟲ RESET</button>
        </div>

        {/* speed */}
        <div className="flex items-center gap-1 flex-none">
          <span className="label-xs mr-1">Speed</span>
          {SIM_SPEEDS.map((s) => (
            <button key={s}
              className={`btn !px-2 !py-1 !text-[9px] ${sim.speed === s ? 'btn-accent' : ''}`}
              onClick={() => ms.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>

        {/* timeline */}
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-baseline justify-between mb-1">
            <span className="label-xs">
              Mission clock · departure {m.departureUtc.slice(0, 16)}Z
            </span>
            <span className="font-data text-[11px] text-accent">
              {simIso.slice(0, 16)}Z · T+{sim.elapsedH.toFixed(1)}h
              {sim.completed && <span className="text-risk-LOW ml-2">ARRIVED</span>}
            </span>
          </div>
          <div className="relative h-2 rounded-sm bg-panel-2 border border-line overflow-hidden"
            role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
            aria-label="Mission time within the environmental data window">
            <div className="absolute inset-y-0 left-0 bg-accent/60" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between text-[8px] font-data text-ink-faint mt-0.5">
            <span>DEP {m.departureUtc.slice(5, 16)}Z</span>
            <span>
              {sim.distanceCoveredNm.toFixed(0)} nm covered
              {remainNm != null && route ? ` · route ${route.distanceNm} nm` : ''}
            </span>
            <span className="text-risk-MEDIUM">DATA WINDOW END {ms.availability?.window.end.slice(5, 16)}Z</span>
          </div>
        </div>
      </div>
    </div>
  );
}
