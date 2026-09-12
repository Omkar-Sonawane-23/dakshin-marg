/** Right rail in LIVE mode — layers, conditions, risk, routing, simulation. */

import { useState } from 'react';
import { FORECAST_HORIZONS, useEnv } from '../state/envStore';
import EnvLayerControl from './EnvLayerControl';
import { Details, EmptyState, ProvBadge, SectionTitle, Skeleton, Toggle } from './ui';

/** Severity chip: text + shape icon, never color alone (accessibility rule). */
const SEV_ICON: Record<string, string> = { LOW: '●', MEDIUM: '◆', HIGH: '▲', CRITICAL: '■' };
function SevChip({ sev }: { sev: string }) {
  return (
    <span className={`font-data text-[10px] font-bold risk-${sev}`}>
      {SEV_ICON[sev] ?? '●'} {sev}
    </span>
  );
}

/** Compact metadata row: label left, value right. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-ink-dim">{label}</span>
      <span className="font-data text-[10.5px] text-ice text-right">{children}</span>
    </div>
  );
}

function ErrorNote({ code, message }: { code: string; message: string }) {
  return (
    <div className="border-l-2 border-l-risk-HIGH pl-2 py-0.5 text-[10px] text-ink-dim" role="alert">
      <span className="font-bold text-risk-HIGH">{code}</span> — {message}
    </div>
  );
}

/** Sea-ice section: observations ⇄ forecast + uncertainty. */
function SeaIceSection() {
  const env = useEnv();
  const fc = env.forecast;
  const active = env.forecastHorizon;
  const si = env.seaIce!;

  return (
    <div className="px-3 space-y-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Row label="Analysis">{si.meta.temporal.validTime?.slice(0, 10) ?? '—'}</Row>
        <Row label="Mean conc.">{si.data.stats.meanConcPct ?? '—'}%</Row>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[10px] text-ink-dim">Observation day</span>
          {env.seaIceLoading && <span className="text-[9px] text-accent pulse-dot">updating…</span>}
        </div>
        <input
          type="range" className="timeline" min={0} max={Math.max(0, env.seaIceTimes.length - 1)}
          value={env.seaIceTimes.length - 1 - env.seaIceIndex}
          style={{ '--fill': `${((env.seaIceTimes.length - 1 - env.seaIceIndex) / Math.max(1, env.seaIceTimes.length - 1)) * 100}%` } as React.CSSProperties}
          onChange={(e) => env.setSeaIceIndex(env.seaIceTimes.length - 1 - Number(e.target.value))}
          aria-label="Sea-ice observation day"
        />
        <div className="flex justify-between text-[8.5px] font-data text-ink-faint mt-0.5">
          <span>{env.seaIceTimes[env.seaIceTimes.length - 1]?.slice(5, 10)}</span>
          <span>{env.seaIceTimes[0]?.slice(5, 10)} (latest)</span>
        </div>
      </div>

      <div>
        <div className="text-[10px] text-ink-dim mb-1">Forecast</div>
        <div className="flex gap-1" role="tablist" aria-label="Sea-ice time selection">
          <button
            role="tab"
            aria-selected={active === null}
            className={`btn !py-1 !px-2.5 !text-[9px] ${active === null ? 'btn-accent' : ''}`}
            onClick={() => env.setForecastHorizon(null)}
          >
            Obs
          </button>
          {FORECAST_HORIZONS.map((h) => (
            <button
              key={h}
              role="tab"
              aria-selected={active === h}
              className={`btn !py-1 !px-2.5 !text-[9px] ${active === h ? '!bg-[color-mix(in srgb, var(--color-model) 20%, transparent)] !border-[color-mix(in srgb, var(--color-model) 60%, transparent)] !text-[var(--color-model)]' : ''}`}
              onClick={() => env.setForecastHorizon(h)}
              disabled={env.forecastLoading}
            >
              +{h}h
            </button>
          ))}
        </div>
      </div>

      {env.forecastLoading && (
        <div className="flex items-center gap-2 text-[10px] text-accent" aria-busy="true">
          <span className="pulse-dot">●</span> Computing forecast…
        </div>
      )}

      {env.forecastError && <ErrorNote code={env.forecastError.code} message={env.forecastError.message} />}

      {active !== null && fc && !env.forecastLoading && (
        <div className="space-y-1 fade-in">
          <Row label="Valid">{fc.meta.temporal.validTime.slice(0, 16).replace('T', ' ')}Z</Row>
          <Row label="Mean conc.">{fc.data.stats.meanConcPct}%</Row>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-ink-dim">Uncertainty</span>
            <span className="font-data text-[10.5px]" style={{ color: 'var(--color-model)' }}>±{fc.data.uncertainty.meanSigmaPct}%</span>
          </div>
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[10px] text-ink-dim">Show uncertainty</span>
            <Toggle on={env.showSigma} onChange={() => env.setShowSigma(!env.showSigma)} label="Toggle uncertainty layer" />
          </div>
          <Details label="Forecast model">
            <p className="text-[9.5px] text-ink-faint leading-snug m-0">
              {fc.meta.model.name} v{fc.meta.model.version}, selected over {fc.meta.model.baseline} by
              walk-forward backtest on {fc.meta.model.trainWindowDays} observation days.
              Backtest MAE at +{active}h: {fc.data.uncertainty.backtestMaePct}%
              ({fc.data.validation.metrics[fc.meta.model.name]?.[String(active)]?.folds ?? '?'} folds).
            </p>
          </Details>
        </div>
      )}
    </div>
  );
}

const ICE_CLASSES = ['PC3', 'PC5', 'PC7', 'IA', 'NONE'];

/** Navigation risk section. */
function RiskSection() {
  const env = useEnv();
  const [showWhy, setShowWhy] = useState(false);
  const r = env.risk?.data;

  return (
    <div className="px-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-dim">Show navigation risk</span>
        <Toggle on={env.riskEnabled} onChange={() => env.setRiskEnabled(!env.riskEnabled)} label="Toggle risk layer" />
      </div>

      <div>
        <div className="text-[10px] text-ink-dim mb-1">Vessel ice class</div>
        <div className="flex gap-1" role="tablist" aria-label="Vessel ice class">
          {ICE_CLASSES.map((c) => (
            <button key={c} role="tab" aria-selected={env.riskIceClass === c}
              className={`btn !py-1 !px-2 !text-[9px] ${env.riskIceClass === c ? 'btn-accent' : ''}`}
              onClick={() => env.setRiskIceClass(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {env.riskLoading && (
        <div className="flex items-center gap-2 text-[10px] text-accent" aria-busy="true">
          <span className="pulse-dot">●</span> Assessing risk…
        </div>
      )}

      {env.riskError && <ErrorNote code={env.riskError.code} message={env.riskError.message} />}

      {r && env.riskEnabled && !env.riskLoading && (
        <div className="space-y-2 fade-in">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-dim">Worst cell in area</span>
            <SevChip sev={r.overall.severity} />
          </div>
          <div className="flex gap-1" aria-label="Risk extent by severity">
            {r.grid.severityScale.map((s) => (
              <div key={s} className="flex-1 leading-tight">
                <div className={`h-1 rounded-sm bg-risk-${s}`} style={{ opacity: r.overall.extentPct[s] > 0 ? 1 : 0.15 }} />
                <div className="text-[8.5px] font-data text-ink-faint mt-0.5">{SEV_ICON[s]} {r.overall.extentPct[s]}%</div>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-ink-dim">Sea ice</span>
              <SevChip sev={r.contributors.seaIce.severity} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-ink-dim">Icebergs</span>
              <SevChip sev={r.contributors.icebergs.severity} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-ink-dim">Icing</span>
              <SevChip sev={r.contributors.icing.severity} />
            </div>
          </div>

          <button className="btn w-full !py-1 !text-[9px]" onClick={() => setShowWhy(!showWhy)}
            aria-expanded={showWhy}>
            {showWhy ? '▾ Hide' : '▸ Why this risk?'}
          </button>
          {showWhy && (
            <div className="space-y-1.5">
              {r.explanations.map((e, i) => (
                <p key={i} className="text-[9.5px] text-ink-dim leading-relaxed m-0">· {e}</p>
              ))}
              <div className="hairline" />
              <p className="text-[9px] text-ink-faint leading-snug m-0">
                Sea ice: IMO POLARIS (RIO {r.contributors.seaIce.worstRio}).
                Icing: Overland predictor (PPR {r.contributors.icing.maxPpr}).
                Icebergs: {r.contributors.icebergs.zoneCount} hazard zones from backtested drift errors.
                Combined by worst case — no weighting. docs/risk-methodology.md
              </p>
              <div className="text-[9px] text-ink-faint">Assumptions:</div>
              {r.assumptions.map((a, i) => (
                <p key={i} className="text-[9px] text-ink-faint leading-snug m-0">△ {a}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PROFILE_GLYPH: Record<string, string> = {
  DIRECT: '─ ─', BALANCED: '━━', CONSERVATIVE: '╍ ╍',
};

/** Route planner section. */
function RoutePlannerSection() {
  const env = useEnv();
  const plan = env.routePlan?.data;

  return (
    <div className="px-3 space-y-2">
      <div className="space-y-1">
        <Row label="Origin">Staging point 60°E</Row>
        <Row label="Destination">Bharati approach</Row>
        <Row label="Vessel">{env.riskIceClass} · 12.5 kn</Row>
        {env.forecastHorizon !== null && <Row label="Surface">+{env.forecastHorizon}h forecast</Row>}
      </div>

      <div className="flex gap-1.5">
        <button className="btn btn-accent flex-1 !py-1.5 !text-[10px]"
          onClick={env.runRoutePlan} disabled={env.routePlanLoading}>
          {env.routePlanLoading ? 'Calculating…' : plan ? 'Recalculate' : 'Calculate routes'}
        </button>
        {plan && (
          <button className="btn !py-1.5 !text-[10px]" onClick={env.clearRoutePlan}>Clear</button>
        )}
      </div>

      {env.routePlanError && <ErrorNote code={env.routePlanError.code} message={env.routePlanError.message} />}

      {plan && !env.routePlanLoading && (
        <div className="space-y-1.5 fade-in">
          {plan.routes.map((r) => {
            const sel = env.selectedRouteProfile === r.profile;
            const hc = r.risk ? r.risk.exposurePct.HIGH + r.risk.exposurePct.CRITICAL : 0;
            return (
              <button
                key={r.profile}
                className={`w-full text-left panel-inset rounded-sm p-2 transition-colors ${sel ? '!border-accent/60 bg-panel-2' : 'hover:bg-panel-2'}`}
                onClick={() => env.setSelectedRouteProfile(sel ? null : r.profile)}
                aria-pressed={sel}
                disabled={r.status !== 'OK'}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-data text-[10.5px] font-bold text-ice">
                    {PROFILE_GLYPH[r.profile]} {r.profile}
                    {r.recommended && <span className="text-[8.5px] font-bold ml-1.5" style={{ color: 'var(--color-risk-low)' }}>RECOMMENDED</span>}
                  </span>
                  {r.status === 'OK' && r.risk
                    ? <SevChip sev={r.risk.overallSeverity} />
                    : <span className="font-data text-[9px] text-risk-MEDIUM">INFEASIBLE</span>}
                </div>
                {r.status === 'OK' ? (
                  <div className="text-[9.5px] text-ink-dim font-data">
                    {r.distanceNm?.toFixed(0)} nm · {r.estTimeH?.toFixed(1)} h
                    {' · '}
                    {hc > 0
                      ? <span className="text-risk-HIGH">{hc.toFixed(1)}% in high risk</span>
                      : <span className="text-risk-LOW">avoids high risk</span>}
                  </div>
                ) : (
                  <div className="text-[9px] text-ink-faint leading-snug">{r.reason}</div>
                )}
              </button>
            );
          })}

          <div className="border-l-2 pl-2 py-0.5" style={{ borderLeftColor: 'var(--color-risk-low)' }}>
            <div className="text-[9px] font-semibold text-ink-dim mb-0.5">Recommendation</div>
            <p className="text-[9.5px] text-ink-dim leading-relaxed m-0">{plan.recommendation.reason}</p>
          </div>

          {(() => {
            const selRoute = plan.routes.find((r) => r.profile === env.selectedRouteProfile);
            if (!selRoute || selRoute.status !== 'OK' || !selRoute.risk) return null;
            return (
              <Details label={`${selRoute.profile} route details`}>
                {selRoute.risk.explanations.map((e, i) => (
                  <p key={i} className="text-[9px] text-ink-faint leading-snug m-0">· {e}</p>
                ))}
                {selRoute.notes?.map((n, i) => (
                  <p key={`n${i}`} className="text-[9px] text-risk-MEDIUM leading-snug m-0">⚠ {n}</p>
                ))}
                {selRoute.risk.bergEncounters.length > 0 && (
                  <p className="text-[9px] text-ink-faint leading-snug m-0">
                    Iceberg encounters: {selRoute.risk.bergEncounters.map((b) => b.id).join(', ')}
                  </p>
                )}
                <p className="text-[9px] text-ink-faint leading-snug m-0">Fuel: {selRoute.fuelNote}</p>
              </Details>
            );
          })()}

          <Details label="Method">
            <p className="text-[9.5px] text-ink-faint leading-snug m-0">
              Shortest paths under severity ceilings on the current risk surface;
              speed limits in elevated-risk cells follow POLARIS Table 1.2.
              docs/route-optimization.md
            </p>
          </Details>
        </div>
      )}
    </div>
  );
}

/** Route simulation (re-planning exercise) — clearly labelled SIMULATION. */
function RouteSimulationSection() {
  const env = useEnv();
  const d = env.drill?.data;
  const stage = d && env.drillStage >= 0 ? d.stages[env.drillStage] : null;
  const isLast = d ? env.drillStage >= d.stages.length - 1 : false;
  const atDecision = stage?.id === 'DECISION_PENDING';
  const conflictStage = d?.stages.find((s) => s.id === 'CONFLICT_DETECTED');
  const replanStage = d?.stages.find((s) => s.id === 'REPLAN');
  const alertVisible = stage && ['CONFLICT_DETECTED', 'REPLAN', 'DECISION_PENDING'].includes(stage.id) && !env.drillAccepted;

  return (
    <div className="px-3 space-y-2">
      {!d && !env.drillLoading && (
        <>
          <div className="space-y-1">
            <Row label="Scenario">Iceberg deviation</Row>
            <Row label="Horizon">+24h</Row>
          </div>
          <button className="btn btn-accent w-full !py-1.5 !text-[10px]" onClick={env.startDrill}>
            Run simulation
          </button>
          <Details label="About this simulation">
            <p className="text-[9.5px] text-ink-faint leading-snug m-0">
              One simulated iceberg re-sighting is injected; every route and risk
              figure is computed by the live engines. The run is repeatable.
              docs/replanning-drill.md
            </p>
          </Details>
        </>
      )}

      {env.drillLoading && (
        <div className="flex items-center gap-2 text-[10px] text-accent" aria-busy="true">
          <span className="pulse-dot">●</span> Preparing simulation…
        </div>
      )}

      {env.drillError && <ErrorNote code={env.drillError.code} message={env.drillError.message} />}

      {d && stage && (
        <div className="space-y-2 fade-in">
          {/* timeline stepper */}
          <div className="flex items-center gap-0.5" role="list" aria-label="Simulation timeline">
            {d.stages.map((s, i) => (
              <span key={s.id} role="listitem" title={s.title}
                className="flex-1 h-1.5 rounded-full"
                style={{
                  background: i < env.drillStage ? 'var(--color-accent)'
                    : i === env.drillStage
                      ? (['CONFLICT_DETECTED', 'BERG_DEVIATION'].includes(s.id) ? 'var(--color-risk-crit)' : 'var(--color-risk-low)')
                      : 'var(--btn-line)',
                }} />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="font-data text-[10px] font-bold text-ice">{stage.title}</span>
            <span className="font-data text-[9px] text-ink-faint">{stage.simTime} · {env.drillStage + 1}/{d.stages.length}</span>
          </div>
          <p className="text-[9.5px] text-ink-dim leading-relaxed m-0">{stage.narrative}</p>

          {/* ALERT banner */}
          {alertVisible && conflictStage?.data.alert && (
            <div className="drill-alert panel-inset rounded-sm border border-risk-HIGH/70 p-2" role="alert">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-risk-CRITICAL font-data text-[10px] font-bold">■ {conflictStage.data.alert.title}</span>
              </div>
              <p className="text-[9px] text-ink-dim leading-snug m-0">{conflictStage.data.alert.body}</p>
            </div>
          )}

          {/* OLD vs NEW comparison */}
          {['REPLAN', 'DECISION_PENDING'].includes(stage.id) && replanStage?.data.comparison && (() => {
            const c = replanStage.data.comparison!;
            const oldR = c.oldRoute;
            const newR = c.newRoute;
            return (
              <div className="grid grid-cols-2 gap-1.5">
                <div className={`panel-inset rounded-sm p-2 border-l-2 border-l-risk-CRITICAL ${env.drillAccepted ? 'opacity-40' : ''}`}>
                  <div className="font-data text-[9px] font-bold text-risk-CRITICAL mb-1">✕ Current — {oldR.profile}</div>
                  <div className="text-[9px] text-ink-dim space-y-0.5">
                    <div>severity <SevChip sev={oldR.riskAfterDeviation.overallSeverity} /></div>
                    <div>was <SevChip sev={oldR.riskBeforeDeviation.overallSeverity} /> before deviation</div>
                    {oldR.riskAfterDeviation.bergEncounters[0] && (
                      <div className="text-risk-HIGH">
                        {oldR.riskAfterDeviation.bergEncounters[0].id} at {oldR.riskAfterDeviation.bergEncounters[0].closestKm} km
                      </div>
                    )}
                  </div>
                </div>
                <div className={`panel-inset rounded-sm p-2 border-l-2 ${env.drillAccepted ? '!border-accent/70' : ''}`} style={{ borderLeftColor: 'var(--color-risk-low)' }}>
                  <div className="font-data text-[9px] font-bold mb-1" style={{ color: 'var(--color-risk-low)' }}>
                    {env.drillAccepted ? '✓ Active' : '➜ Proposed'} — {newR?.profile}
                  </div>
                  <div className="text-[9px] text-ink-dim space-y-0.5">
                    <div>severity <SevChip sev={newR!.overallSeverity} /></div>
                    <div>{newR!.distanceNm.toFixed(0)} nm · {newR!.estTimeH.toFixed(1)} h</div>
                    <div>{c.delta.distanceNm !== null && c.delta.distanceNm >= 0 ? `+${c.delta.distanceNm.toFixed(0)}` : c.delta.distanceNm?.toFixed(0)} nm vs current remaining</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* why the recommendation changed */}
          {['REPLAN', 'DECISION_PENDING'].includes(stage.id) && replanStage?.data.whyChanged && (
            <Details label="Why the recommendation changed">
              {replanStage.data.whyChanged.map((w, i) => (
                <p key={i} className="text-[9px] text-ink-faint leading-snug m-0">{i + 1}. {w}</p>
              ))}
            </Details>
          )}

          {/* controls — the operator advances and decides */}
          <div className="flex gap-1.5">
            {atDecision && !env.drillAccepted ? (
              <button className="btn btn-accent flex-1 !py-1.5 !text-[10px]" onClick={env.acceptDrillRoute}>
                Accept new route
              </button>
            ) : !isLast ? (
              <button className="btn btn-accent flex-1 !py-1.5 !text-[10px]" onClick={env.advanceDrill}>
                {env.drillStage === 0 ? 'Accept recommended route' : 'Advance'}
              </button>
            ) : env.drillAccepted ? (
              <div className="flex-1 text-center font-data text-[10px] py-1.5 rounded-sm" style={{ color: 'var(--color-risk-low)', background: 'color-mix(in srgb, var(--color-risk-low) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-risk-low) 40%, transparent)' }}>
                ✓ New route active
              </div>
            ) : null}
            <button className="btn !py-1.5 !text-[10px]" onClick={env.exitDrill}>Exit</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Iceberg section — positions, tracking and drift forecast. */
function IcebergSection() {
  const env = useEnv();

  if (env.bergSituationLoading) {
    return (
      <div className="px-3" aria-busy="true">
        <div className="text-[10px] text-ink-faint mb-2">Loading iceberg tracks…</div>
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (env.bergSituationError) {
    return (
      <div className="px-3">
        <ErrorNote code={env.bergSituationError.code} message={env.bergSituationError.message} />
      </div>
    );
  }

  const sit = env.bergSituation;
  if (!sit) return null;

  const situations = sit.data.situations;
  const moving = situations.filter((s) => s.prediction?.regime === 'MOVING');
  const tracked = situations.filter((s) => s.track);
  const staleDays = situations[0]?.prediction?.staleDays ?? null;

  return (
    <div className="px-3 space-y-2">
      <div className="space-y-1">
        <Row label="Named bergs in area">{env.icebergs?.data.count ?? '—'}</Row>
        <Row label="Tracked">{tracked.length}</Row>
        <Row label="Moving / grounded">{moving.length} / {tracked.length - moving.length}</Row>
      </div>

      {staleDays !== null && staleDays > 14 && (
        <div className="text-[9.5px] leading-snug text-risk-MEDIUM">
          ⚠ Track archive lags real time by ~{staleDays} d; current positions from USNIC.
        </div>
      )}

      <div>
        <div className="text-[10px] text-ink-dim mb-1">Drift forecast — moving bergs</div>
        {moving.length === 0 && (
          <div className="text-[10px] text-ink-faint">No bergs currently classified as moving.</div>
        )}
        {moving.map((s) => {
          const p7 = s.prediction!.trajectory.find((t) => t.horizonD === 7);
          const focused = env.focusBergId === s.id;
          return (
            <button
              key={s.id}
              className={`w-full text-left flex items-center justify-between py-1 px-2 -mx-2 rounded-sm transition-colors ${focused ? 'bg-[color-mix(in srgb, var(--color-model) 12%, transparent)]' : 'hover:bg-panel-2'}`}
              onClick={() => env.setFocusBergId(focused ? null : s.id)}
              aria-pressed={focused}
            >
              <span className="font-data text-[10.5px] text-ice">{s.id}</span>
              <span className="font-data text-[9.5px] text-ink-dim">
                {(s.track?.meanSpeedKmD ?? s.prediction!.velocityKmD).toFixed(1)} km/d · ±{p7?.corridorP90Km ?? '—'} km @7d
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-dim">Show forecast tracks</span>
        <Toggle
          on={env.showBergPredictions}
          onChange={() => env.setShowBergPredictions(!env.showBergPredictions)}
          label="Toggle berg drift forecasts"
        />
      </div>

      <Details label="Track data">
        <p className="text-[9.5px] text-ink-faint leading-snug m-0">
          History: BYU/NIC consolidated database v8 (observed, solid green).
          Forecast: damped-drift model (violet dashed). The ± corridor is the
          empirical P90 forecast error from backtests on real tracks.
        </p>
      </Details>
    </div>
  );
}

export default function LiveEnvPanel() {
  const env = useEnv();

  if (env.loading) {
    return (
      <div className="p-3 space-y-3" aria-busy="true" aria-label="Loading live environmental data">
        <div className="label-xs">Connecting…</div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (env.error) {
    return (
      <div className="p-3">
        <div className="border-l-2 border-l-risk-HIGH pl-3 py-1" role="alert">
          <div className="text-[11.5px] font-bold text-ice mb-1">Live data unavailable</div>
          <div className="font-data text-[9px] text-ink-faint mb-2">ERROR {env.error.code}</div>
          <p className="text-[10.5px] text-ink-dim leading-relaxed mb-3">{env.error.message}</p>
          <button className="btn btn-accent !text-[9.5px]" onClick={env.retry}>Retry</button>
        </div>
      </div>
    );
  }

  if (!env.seaIce && !env.icebergs && !env.weather) {
    return <EmptyState icon="◌" title="No live data loaded" hint="Switch to Live mode to load environmental data." />;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <SectionTitle>Map Layers</SectionTitle>
      <EnvLayerControl />

      {env.seaIce && (
        <>
          <SectionTitle right={<ProvBadge prov={env.forecastHorizon !== null ? 'MODEL_FORECAST' : env.seaIce.meta.provenance} />}>
            Sea Ice
          </SectionTitle>
          <SeaIceSection />
        </>
      )}

      {env.icebergs && (
        <>
          <SectionTitle right={<ProvBadge prov={env.icebergs.meta.provenance} />}>Icebergs</SectionTitle>
          <IcebergSection />

          <SectionTitle>Navigation Risk</SectionTitle>
          <RiskSection />

          <SectionTitle>Route Planner</SectionTitle>
          <RoutePlannerSection />

          <SectionTitle>Route Simulation</SectionTitle>
          <RouteSimulationSection />
        </>
      )}

      {env.weather && (
        <>
          <SectionTitle right={<ProvBadge prov={env.weather.meta.provenance} />}>Wind</SectionTitle>
          <div className="px-3 space-y-2">
            <div className="space-y-1">
              <Row label="Valid hour">{env.weather.data.hour.replace('T', ' ')}Z</Row>
              <Row label="Max wind in area">{env.weather.data.summary.maxWindKn ?? '—'} kn</Row>
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[10px] text-ink-dim">Hour</span>
                {env.weatherLoading && <span className="text-[9px] text-accent pulse-dot">updating…</span>}
              </div>
              <input
                type="range" className="timeline" min={0} max={Math.max(0, env.weatherTimes.length - 1)}
                value={env.weatherIndex}
                style={{ '--fill': `${(env.weatherIndex / Math.max(1, env.weatherTimes.length - 1)) * 100}%` } as React.CSSProperties}
                onChange={(e) => env.setWeatherIndex(Number(e.target.value))}
                aria-label="Weather hour"
              />
              <div className="flex justify-between text-[8.5px] font-data text-ink-faint mt-0.5">
                <span>{env.weatherTimes[0]?.slice(5, 13).replace('T', ' ')}</span>
                <span className="text-accent">now</span>
                <span>{env.weatherTimes[env.weatherTimes.length - 1]?.slice(5, 13).replace('T', ' ')}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
