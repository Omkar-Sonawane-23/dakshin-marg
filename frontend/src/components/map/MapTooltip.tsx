/**
 * Map hover cards.
 *
 * These are the same tooltips the flat renderer showed — same fields, same
 * provenance wording — moved into their own module so the 3D host stays small.
 * Each card resolves its own record from the stores by id, so nothing about
 * what the operator reads on hover has changed.
 */
import { useStore } from '../../state/store';
import { useEnv } from '../../state/envStore';
import { useMission } from '../../state/missionStore';
import { fmtPos, fmtScenarioTime } from '../../lib/format';
import type { PickResult } from '../../map3d/PolarScene';

export default function MapTooltip({ pick }: { pick: PickResult }) {
  if (pick.kind === 'iceberg' && pick.id) return <BergCard id={pick.id} />;
  if (pick.kind === 'route' && pick.id) return <RouteCard id={pick.id} />;
  if (pick.kind === 'vessel') return <VesselCard />;
  return null;
}

// ── icebergs ────────────────────────────────────────────────────────────

function BergCard({ id }: { id: string }) {
  const { snapshot, scenario } = useStore();
  const env = useEnv();

  if (env.mode === 'LIVE') {
    const berg = env.icebergs?.data.icebergs.find((b) => b.id === id);
    if (!berg) return null;
    const sit = env.bergSituation?.data.situations.find((x) => x.id === id) ?? null;
    const pred = sit?.prediction ?? null;
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
        {sit?.track && (
          <div className="text-ink-dim text-[10px] mt-1 leading-relaxed">
            <span style={{ color: 'var(--color-risk-low)' }}>TRACK</span> {sit.track.nObs} obs → {sit.track.last} ·
            drift {sit.track.meanSpeedKmD} km/d
            {pred && (
              <>
                <br />
                <span style={{ color: 'var(--color-model)' }}>FORECAST</span>{' '}
                {pred.regime === 'MOVING'
                  ? `+7 d corridor ±${pred.trajectory[pred.trajectory.length - 1]?.corridorP90Km ?? '?'} km (P90)`
                  : 'grounded/slow — stationary expected'}
              </>
            )}
          </div>
        )}
        <div className="text-ink-faint text-[9.5px] mt-1">
          {sit?.track ? 'Click to focus track & prediction' : 'U.S. National Ice Center · named bergs ≥10 nm'}
        </div>
      </div>
    );
  }

  const berg = snapshot?.icebergs.find((b) => b.id === id);
  if (!berg || !scenario) return null;
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
        Last obs {fmtScenarioTime(scenario.mission.departureUtc, last.timeOffsetH)}{' '}
        <span className="text-risk-MEDIUM">(SIMULATED)</span>
      </div>
      <div className="text-ink-faint text-[9.5px] mt-1">Click for full intelligence panel</div>
    </div>
  );
}

// ── routes ──────────────────────────────────────────────────────────────

function RouteCard({ id }: { id: string }) {
  const { snapshot } = useStore();
  const env = useEnv();
  const mission = useMission();

  if (id.startsWith('opt:')) {
    const key = id.slice(4);
    const candidate = key.startsWith('CAND:');
    const profile = candidate ? key.slice(5) : key;
    const list = candidate
      ? mission.candidatePlan?.data.routes
      : mission.mission?.routePlan
        ? mission.mission.routePlan.data.routes
        : env.routePlan?.data.routes;
    const route = list?.find((r) => r.profile === profile);
    if (!route) return null;
    return <OptRouteCard route={route} candidate={candidate} />;
  }

  if (id.startsWith('drill')) {
    const plan = env.drill?.data.stages.find((s) => s.id === 'REPLAN')?.data.plan;
    const rec = plan?.recommendation.profile;
    const route = id === 'drill:new'
      ? plan?.routes.find((r) => r.profile === rec)
      : env.drill?.data.stages.find((s) => s.id === 'MISSION_START')?.data.plan?.routes
          .find((r) => r.profile === id.slice(7));
    if (!route) {
      return (
        <div>
          <div className="font-data font-bold text-ice mb-0.5">
            {id === 'drill:accepted' ? 'ACCEPTED ROUTE' : 'ROUTE'}
          </div>
          <div className="text-ink-dim text-[10.5px]">Operator-accepted track · SIMULATION</div>
        </div>
      );
    }
    return <OptRouteCard route={route} candidate={id === 'drill:new'} />;
  }

  const route = snapshot?.routes.find((r) => r.id === id);
  if (!route || !snapshot) return null;
  const isActive = route.id === snapshot.activeRouteId;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-data font-bold text-ice">{route.label}</span>
        {isActive && <span className="font-data text-[9px] text-accent">ACTIVE</span>}
      </div>
      <div className="text-ink-dim text-[10.5px]">
        {route.distanceNm} nm · est {Math.round(route.estTimeH)} h · risk {route.riskScore} ({route.riskLevel})
      </div>
      <div className="text-ink-faint text-[9.5px] mt-1">Est. fuel {route.estFuelT} t (model estimate)</div>
    </div>
  );
}

function OptRouteCard({ route, candidate }: { route: import('../../types/env').OptRoute; candidate: boolean }) {
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

// ── vessel ──────────────────────────────────────────────────────────────

function VesselCard() {
  const { scenario, snapshot } = useStore();
  const env = useEnv();
  const mission = useMission();

  if (env.mode === 'LIVE') {
    const m = mission.mission;
    if (mission.sim && m) {
      const s = mission.sim;
      return (
        <div>
          <div className="font-data font-bold text-ice mb-1">{m.vessel.name}</div>
          <div className="text-ink-dim text-[10.5px] leading-relaxed">
            {m.vessel.iceClass} · {m.vessel.type}<br />
            {fmtPos(s.vesselPos.lon, s.vesselPos.lat)}<br />
            HDG {String(Math.round(s.headingDeg)).padStart(3, '0')}° · T+{s.elapsedH.toFixed(1)} h ·{' '}
            {s.distanceCoveredNm.toFixed(0)} nm run
          </div>
        </div>
      );
    }
    if (env.drill && env.drillStage >= 2) {
      return (
        <div>
          <div className="font-data font-bold text-ice mb-1">RSV DAKSHIN DHRUV</div>
          <div className="text-ink-dim text-[10.5px] leading-relaxed">
            SIMULATED position · drill stage {env.drillStage + 1}
          </div>
        </div>
      );
    }
    return null;
  }

  if (!scenario || !snapshot) return null;
  return (
    <div>
      <div className="font-data font-bold text-ice mb-1">{scenario.vessel.name}</div>
      <div className="text-ink-dim text-[10.5px] leading-relaxed">
        {scenario.vessel.type} · ICE CLASS {scenario.vessel.iceClass}<br />
        {fmtPos(snapshot.vesselState.position.lon, snapshot.vesselState.position.lat)}<br />
        SOG {snapshot.vesselState.speedKn.toFixed(1)} kn · HDG{' '}
        {String(snapshot.vesselState.headingDeg).padStart(3, '0')}°
      </div>
    </div>
  );
}
