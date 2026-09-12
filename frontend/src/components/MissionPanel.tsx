/** Left rail — mission overview, active route, environment summary. */

import { useStore } from '../state/store';
import { fmtHours, fmtPos } from '../lib/format';
import { RiskChip, ScoreBar, SectionTitle, Stat } from './ui';

export default function MissionPanel() {
  const { scenario, snapshot, setSelection, setComparisonOpen } = useStore();
  if (!scenario || !snapshot) return null;

  const active = snapshot.routes.find((r) => r.id === snapshot.activeRouteId)!;
  const remaining = Math.max(0, active.distanceNm - snapshot.vesselState.speedKn * 0 - scenario.vessel.cruiseSpeedKn * snapshot.timeOffsetH);
  const etaH = snapshot.vesselState.speedKn > 0 ? remaining / scenario.vessel.cruiseSpeedKn : 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* mission */}
      <SectionTitle>Mission</SectionTitle>
      <div className="px-3 space-y-2">
        <Stat label="Vessel" value={scenario.vessel.name} sub={`${scenario.vessel.type} · ice class ${scenario.vessel.iceClass} · ${scenario.vessel.cruiseSpeedKn} kn cruise`} mono={false} />
        <Stat label="Origin" value={scenario.mission.origin.name} sub={fmtPos(scenario.mission.origin.position.lon, scenario.mission.origin.position.lat)} mono={false} />
        <Stat label="Destination" value={scenario.mission.destination.name} sub={fmtPos(scenario.mission.destination.position.lon, scenario.mission.destination.position.lat)} mono={false} />
        <div className="hairline" />
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Distance to go" value={`${Math.round(remaining)} nm`} sub={etaH > 0 ? `ETA in ${fmtHours(etaH)}` : 'On approach'} />
          <Stat label="Speed / heading" value={`${snapshot.vesselState.speedKn.toFixed(1)} kn`} sub={`HDG ${String(snapshot.vesselState.headingDeg).padStart(3, '0')}°`} />
        </div>
      </div>

      {/* overall risk */}
      <SectionTitle>Route Risk</SectionTitle>
      <div className="px-3">
        <div className="flex items-center justify-between mb-2">
          <RiskChip level={snapshot.risk.overall} size="lg" />
          <span className="font-data text-[15px] text-ice">{snapshot.risk.overallScore}<span className="text-ink-faint text-[10px]">/100</span></span>
        </div>
        <ScoreBar score={snapshot.risk.overallScore} level={snapshot.risk.overall} />
        <div className="mt-2.5 space-y-1.5">
          {snapshot.risk.factors.map((f) => (
            <div key={f.key} className="group" title={f.detail}>
              <div className="flex items-center justify-between text-[10.5px]">
                <span className="text-ink-dim">{f.label}</span>
                <span className={`font-data font-bold risk-${f.level}`}>{f.level} · {f.score}</span>
              </div>
              <ScoreBar score={f.score} level={f.level} />
              <div className="text-[9.5px] text-ink-faint mt-0.5 leading-snug hidden group-hover:block">{f.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* active route */}
      <SectionTitle
        right={
          <button className="btn btn-ghost !py-0.5 !px-2 !text-[9px]" onClick={() => setComparisonOpen(true)}>
            Compare ▸
          </button>
        }
      >
        Active Route
      </SectionTitle>
      <div className="px-3 pb-3">
        <button
          className="panel-inset rounded-sm p-2.5 w-full text-left hover:border-accent-dim transition-colors"
          onClick={() => setSelection({ kind: 'route', id: active.id })}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-data text-[12px] font-bold text-accent">{active.label}</span>
            <RiskChip level={active.riskLevel} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="label-xs">Dist</div>
              <div className="font-data text-[12px] text-ice">{active.distanceNm} nm</div>
            </div>
            <div>
              <div className="label-xs">Time</div>
              <div className="font-data text-[12px] text-ice">{fmtHours(active.estTimeH)}</div>
            </div>
            <div>
              <div className="label-xs">Fuel est.</div>
              <div className="font-data text-[12px] text-ice">{active.estFuelT} t</div>
            </div>
          </div>
          <div className="text-[8.5px] text-ink-faint mt-1.5">Fuel is a model estimate</div>
        </button>
      </div>

      {/* environment digest */}
      <SectionTitle>Conditions — T+{snapshot.timeOffsetH}h</SectionTitle>
      <div className="px-3 pb-4 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Stat label="Sea-ice edge" value={`≈${(-62.2 + snapshot.timeOffsetH * 0.012).toFixed(1)}°S`} sub={`±${snapshot.seaIce.uncertaintyPct}% conc.`} />
        <Stat label="Peak wind" value={`${snapshot.weather.summary.maxWindKn} kn`} sub={`waves to ${snapshot.weather.summary.maxWaveM} m`} />
        <Stat label="Tracked bergs" value={snapshot.icebergs.length} sub={`${snapshot.icebergs.filter((b) => b.routeThreatLevel === 'HIGH' || b.routeThreatLevel === 'CRITICAL').length} near route`} />
        <Stat label="Air temp (min)" value={`${snapshot.weather.summary.minTempC}°C`} sub="corridor minimum" />
      </div>

      {/* event narrative */}
      {snapshot.events.length > 0 && (
        <>
          <SectionTitle>Log</SectionTitle>
          <div className="px-3 pb-4 space-y-1.5">
            {snapshot.events.map((e, i) => (
              <div key={i} className="border-l-2 border-l-line-2 pl-2 text-[10.5px] text-ink-dim leading-relaxed fade-in">
                {e}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
