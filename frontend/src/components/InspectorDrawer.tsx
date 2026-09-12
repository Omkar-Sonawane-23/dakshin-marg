/** Right-side inspector drawer: iceberg / route / vessel details. */

import { useStore } from '../state/store';
import { fmtHours, fmtPos, fmtScenarioTime } from '../lib/format';
import { RiskChip, ScoreBar, SimBadge, Stat } from './ui';
import type { Iceberg, Route } from '../types/domain';

export default function InspectorDrawer() {
  const { selection, setSelection, snapshot, scenario } = useStore();
  if (selection.kind === 'none' || !snapshot || !scenario) return null;

  let title = '';
  let body: React.ReactNode = null;

  if (selection.kind === 'iceberg') {
    const berg = snapshot.icebergs.find((b) => b.id === selection.id);
    if (!berg) return null;
    title = `ICEBERG ${berg.id}`;
    body = <BergDetail berg={berg} depIso={scenario.mission.departureUtc} />;
  } else if (selection.kind === 'route') {
    const route = snapshot.routes.find((r) => r.id === selection.id);
    if (!route) return null;
    title = route.label;
    body = <RouteDetail route={route} />;
  } else {
    title = scenario.vessel.name.toUpperCase();
    body = <VesselDetail />;
  }

  return (
    <aside
      className="absolute top-0 right-0 bottom-0 w-[320px] max-w-[85vw] panel border-l border-line z-20 flex flex-col slide-in-right"
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-line flex-none">
        <span className="font-data font-bold text-[12px] text-ice tracking-wider">{title}</span>
        <button className="btn btn-ghost !px-2 !py-1" onClick={() => setSelection({ kind: 'none' })} aria-label="Close inspector">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">{body}</div>
    </aside>
  );
}

// ── iceberg detail ─────────────────────────────────────────────────────

function BergDetail({ berg, depIso }: { berg: Iceberg; depIso: string }) {
  const last = berg.observations[berg.observations.length - 1];
  const final = berg.trajectory.points[berg.trajectory.points.length - 1];
  return (
    <>
      <div className="flex items-center gap-2">
        <SimBadge />
        <RiskChip level={berg.routeThreatLevel} />
      </div>

      <div className="panel-inset rounded-sm p-2.5 grid grid-cols-2 gap-2.5">
        <Stat label="Size class" value={berg.sizeClass} mono={false} />
        <Stat label="Length" value={`${berg.lengthM} m`} />
        <Stat label="Drift speed" value={`${berg.driftSpeedKn.toFixed(2)} kn`} />
        <Stat label="Drift bearing" value={`${String(berg.driftBearingDeg).padStart(3, '0')}°`} />
        <Stat label="Detection conf." value={`${Math.round(berg.detectionConfidence * 100)}%`} />
        <Stat label="Track conf." value={`${Math.round(berg.trajectory.confidence * 100)}%`} />
      </div>

      <div>
        <div className="label-xs mb-1.5">Current position</div>
        <div className="panel-inset rounded-sm p-2.5">
          <div className="font-data text-[12px] text-ice">{fmtPos(last.position.lon, last.position.lat)}</div>
          <div className="text-[9.5px] text-ink-faint mt-1">Last observation: {fmtScenarioTime(depIso, last.timeOffsetH)}</div>
          <div className="text-[9.5px] text-risk-MEDIUM mt-0.5">{last.source}</div>
        </div>
      </div>

      <div>
        <div className="label-xs mb-1.5">Observation history</div>
        <div className="panel-inset rounded-sm overflow-hidden">
          {berg.observations.map((o, i) => (
            <div key={i} className={`flex justify-between px-2.5 py-1.5 text-[10px] ${i > 0 ? 'border-t border-line' : ''}`}>
              <span className="font-data text-ink-dim">T{o.timeOffsetH >= 0 ? '+' : ''}{o.timeOffsetH}h</span>
              <span className="font-data text-ink">{fmtPos(o.position.lon, o.position.lat)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="label-xs mb-1.5">Trajectory prediction · {berg.trajectory.horizonH}h horizon</div>
        <div className="panel-inset rounded-sm p-2.5 space-y-1.5">
          <Stat label="Predicted position (end of horizon)" value={fmtPos(final.position.lon, final.position.lat)} sub={`±${final.uncertaintyNm.toFixed(0)} nm (1σ) at T+${final.timeOffsetH}h`} />
          <div className="hairline" />
          <div className="flex justify-between text-[10px]">
            <span className="text-ink-faint">Model</span>
            <span className="font-data text-ink-dim">{berg.trajectory.meta.model.name} v{berg.trajectory.meta.model.version}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-ink-faint">Confidence</span>
            <span className="font-data text-ink-dim">{Math.round(berg.trajectory.confidence * 100)}%</span>
          </div>
          {berg.trajectory.meta.warnings.map((w, i) => (
            <div key={i} className="text-[9.5px] text-risk-MEDIUM leading-snug">⚠ {w}</div>
          ))}
          <div className="text-[9px] text-ink-faint leading-snug">
            Uncertainty corridor widens with lead time. Prediction is probabilistic — it must not be read as a certain path.
          </div>
        </div>
      </div>
    </>
  );
}

// ── route detail ───────────────────────────────────────────────────────

function RouteDetail({ route }: { route: Route }) {
  const { snapshot } = useStore();
  const isActive = snapshot?.activeRouteId === route.id;
  const isRec = snapshot?.recommendedRouteId === route.id;
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <SimBadge text="DEMO ROUTE" />
        {isActive && <span className="badge badge-live">ACTIVE</span>}
        {isRec && <span className="badge" style={{ color: 'var(--color-risk-low)', borderColor: 'color-mix(in srgb, var(--color-risk-low) 40%, transparent)', background: 'color-mix(in srgb, var(--color-risk-low) 7%, transparent)' }}>RECOMMENDED</span>}
        {route.supersededByRouteId && <span className="badge" style={{ color: 'var(--color-risk-high)', borderColor: 'color-mix(in srgb, var(--color-risk-high) 40%, transparent)', background: 'color-mix(in srgb, var(--color-risk-high) 7%, transparent)' }}>SUPERSEDED</span>}
      </div>

      <div className="panel-inset rounded-sm p-2.5 grid grid-cols-2 gap-2.5">
        <Stat label="Distance" value={`${route.distanceNm} nm`} />
        <Stat label="Est. time" value={fmtHours(route.estTimeH)} />
        <Stat label="Est. fuel *" value={`${route.estFuelT} t`} />
        <Stat label="Risk score" value={<span className={`risk-${route.riskLevel}`}>{route.riskScore} · {route.riskLevel}</span>} />
      </div>
      <div className="text-[8.5px] text-ink-faint -mt-1.5">*fuel is a model estimate (distance × ice-resistance factor) — not validated</div>

      <div>
        <div className="label-xs mb-1.5">Risk along route</div>
        <div className="panel-inset rounded-sm p-2.5">
          <ScoreBar score={route.riskScore} level={route.riskLevel} />
          <div className="text-[9.5px] text-ink-faint mt-1.5">
            Combined score from sea ice (×0.35), icebergs (×0.30), weather (×0.20), uncertainty (×0.15).
          </div>
        </div>
      </div>

      <div>
        <div className="label-xs mb-1.5">Hazards on this track</div>
        {route.hazards.length === 0 ? (
          <div className="panel-inset rounded-sm p-2.5 text-[10.5px] text-risk-LOW">▁ No significant hazards identified on this track.</div>
        ) : (
          <div className="space-y-1.5">
            {route.hazards.map((h, i) => (
              <div key={i} className="panel-inset rounded-sm p-2.5">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="font-data text-[10px] font-bold text-ink">{h.kind}{h.refId ? ` · ${h.refId}` : ''}</span>
                  <RiskChip level={h.severity} />
                </div>
                <div className="text-[10px] text-ink-dim">{h.note}</div>
                <div className="text-[9px] text-ink-faint mt-0.5">≈{h.atDistNm} nm from origin</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {route.recommendationReasons.length > 0 && (
        <div>
          <div className="label-xs mb-1.5">Why recommended</div>
          <div className="panel-inset rounded-sm p-2.5 space-y-1">
            {route.recommendationReasons.map((r, i) => (
              <div key={i} className="text-[10.5px] text-ink-dim leading-relaxed flex gap-1.5">
                <span className="text-risk-LOW flex-none">✓</span>{r}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[9px] text-ink-faint">
        {route.meta.model.name} v{route.meta.model.version} · generated {route.meta.executedAt}
      </div>
    </>
  );
}

// ── vessel detail ──────────────────────────────────────────────────────

function VesselDetail() {
  const { scenario, snapshot } = useStore();
  if (!scenario || !snapshot) return null;
  const v = scenario.vessel;
  return (
    <>
      <SimBadge text="SAMPLE VESSEL PROFILE" />
      <div className="panel-inset rounded-sm p-2.5 grid grid-cols-2 gap-2.5">
        <Stat label="Callsign" value={v.callsign} />
        <Stat label="Type" value={v.type} mono={false} />
        <Stat label="Ice class" value={v.iceClass} />
        <Stat label="Cruise speed" value={`${v.cruiseSpeedKn} kn`} />
        <Stat label="Draft" value={`${v.draftM} m`} />
        <Stat label="Ice limit" value={`${v.maxIceConcentrationPct}% conc.`} />
      </div>
      <div className="panel-inset rounded-sm p-2.5 space-y-2">
        <Stat label="Position" value={fmtPos(snapshot.vesselState.position.lon, snapshot.vesselState.position.lat)} />
        <Stat label="SOG / HDG" value={`${snapshot.vesselState.speedKn.toFixed(1)} kn · ${String(snapshot.vesselState.headingDeg).padStart(3, '0')}°`} />
      </div>
      <div className="text-[9.5px] text-ink-faint leading-relaxed">
        The vessel's ice-class concentration limit ({v.maxIceConcentrationPct}%) feeds directly into the
        sea-ice risk factor and route scoring.
      </div>
    </>
  );
}
