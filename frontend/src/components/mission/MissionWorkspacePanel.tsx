/** Right rail while a mission is open — route options / active route metrics,
 * conditions at the vessel, risk explanation, re-plan controls, event log.
 */

import { useState } from 'react';
import { useMission } from '../../state/missionStore';
import type { OptRoute } from '../../types/env';
import { Details, SectionTitle } from '../ui';

const SEV_ICON: Record<string, string> = { LOW: '●', MEDIUM: '◆', HIGH: '▲', CRITICAL: '■' };
function SevChip({ sev }: { sev: string }) {
  return <span className={`font-data text-[10px] font-bold risk-${sev}`}>{SEV_ICON[sev] ?? '●'} {sev}</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-ink-dim">{label}</span>
      <span className="font-data text-[10.5px] text-ice text-right">{children}</span>
    </div>
  );
}

const PROFILE_GLYPH: Record<string, string> = { DIRECT: '─ ─', BALANCED: '━━', CONSERVATIVE: '╍ ╍' };

function RouteCard({ r, selected, onSelect, onAccept, acceptLabel, departureUtc }: {
  r: OptRoute; selected: boolean; onSelect: () => void;
  onAccept?: () => void; acceptLabel?: string; departureUtc?: string;
}) {
  const hc = r.risk ? (r.risk.exposurePct.HIGH ?? 0) + (r.risk.exposurePct.CRITICAL ?? 0) : 0;
  const eta = departureUtc && r.estTimeH
    ? new Date(Date.parse(departureUtc) + r.estTimeH * 3600_000).toISOString().slice(0, 16) + 'Z'
    : null;
  return (
    <div className={`panel-inset rounded-sm p-2 ${selected ? '!border-accent/60 bg-panel-2' : ''}`}>
      <button className="w-full text-left" onClick={onSelect} aria-pressed={selected} disabled={r.status !== 'OK'}>
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
          <div className="text-[9.5px] text-ink-dim font-data leading-relaxed">
            {r.distanceNm?.toFixed(0)} nm · {r.estTimeH?.toFixed(1)} h{eta ? ` · ETA ${eta}` : ''}
            <br />
            {hc > 0
              ? <span className="text-risk-HIGH">{hc.toFixed(1)}% length at higher exposure</span>
              : <span className="text-risk-LOW">avoids HIGH/CRITICAL cells</span>}
            {' · fuel: Not calculated'}
          </div>
        ) : (
          <div className="text-[9px] text-ink-faint leading-snug">{r.reason}</div>
        )}
      </button>
      {selected && r.status === 'OK' && r.risk && (
        <div className="mt-1.5 space-y-1 fade-in">
          {r.risk.explanations.slice(0, 3).map((e, i) => (
            <p key={i} className="text-[9px] text-ink-faint leading-snug m-0">· {e}</p>
          ))}
          {r.notes?.map((n, i) => (
            <p key={`n${i}`} className="text-[9px] text-risk-MEDIUM leading-snug m-0">⚠ {n}</p>
          ))}
          {r.risk.bergEncounters.length > 0 && (
            <p className="text-[9px] text-ink-faint m-0">
              Iceberg zones on route: {r.risk.bergEncounters.map((b) => `${b.id} (${b.severity})`).join(', ')}
            </p>
          )}
          <p className="text-[9px] text-ink-faint m-0">
            Exposure — sea ice {((r.risk.exposureByContributor.seaIce?.HIGH ?? 0) + (r.risk.exposureByContributor.seaIce?.CRITICAL ?? 0)).toFixed(1)}% ·
            bergs {((r.risk.exposureByContributor.icebergs?.HIGH ?? 0) + (r.risk.exposureByContributor.icebergs?.CRITICAL ?? 0)).toFixed(1)}% ·
            icing {((r.risk.exposureByContributor.icing?.HIGH ?? 0) + (r.risk.exposureByContributor.icing?.CRITICAL ?? 0)).toFixed(1)}%
          </p>
        </div>
      )}
      {onAccept && r.status === 'OK' && (
        <button className="btn btn-accent w-full !py-1 !text-[9px] mt-1.5" onClick={onAccept}>
          {acceptLabel ?? 'Accept route'}
        </button>
      )}
    </div>
  );
}

export default function MissionWorkspacePanel() {
  const ms = useMission();
  const m = ms.mission;
  const [logOpen, setLogOpen] = useState(true);
  if (!m) return null;

  const plan = m.routePlan?.data;
  const showAcceptButtons = m.state === 'ROUTES_GENERATED';
  const cand = ms.candidatePlan?.data;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ── candidate replan comparison (takes priority when present) ── */}
      {cand && (
        <>
          <SectionTitle right={<span className="font-data text-[8px] text-risk-MEDIUM font-bold">RE-PLAN</span>}>
            Candidate Routes
          </SectionTitle>
          <div className="px-3 pb-2 space-y-1.5">
            <div className="text-[9.5px] text-ink-dim leading-snug">
              Computed from the vessel's current position at mission time{' '}
              <span className="font-data">{ms.sim ? new Date(ms.sim.simTimeMs).toISOString().slice(0, 16) + 'Z' : '—'}</span>.
              Compare against the current route below — the operator decides.
            </div>
            {cand.routes.map((r) => (
              <RouteCard key={r.profile} r={r}
                selected={ms.selectedProfile === `CAND:${r.profile}`}
                onSelect={() => ms.setSelectedProfile(ms.selectedProfile === `CAND:${r.profile}` ? null : `CAND:${r.profile}`)}
                onAccept={() => void ms.acceptCandidate(r.profile)}
                acceptLabel="Accept this route (replaces current)"
              />
            ))}
            <div className="border-l-2 pl-2 py-0.5" style={{ borderLeftColor: 'var(--color-risk-low)' }}>
              <p className="text-[9.5px] text-ink-dim leading-relaxed m-0">{cand.recommendation.reason}</p>
            </div>
            {ms.activeRoute && (
              <div className="text-[9.5px] text-ink-dim leading-snug">
                Current route remaining: continuing on <b>{ms.activeRoute.profile}</b> — see alert for its present risk.
              </div>
            )}
            <button className="btn w-full !py-1 !text-[9px]" onClick={ms.dismissCandidate}>
              Reject candidates — keep current route
            </button>
          </div>
          <div className="hairline mx-3" />
        </>
      )}

      {/* ── route options / active route ── */}
      <SectionTitle>{m.activeProfile && !showAcceptButtons ? 'Active Route' : 'Route Options'}</SectionTitle>
      <div className="px-3 pb-2 space-y-1.5">
        {ms.routesLoading && (
          <div className="flex items-center gap-2 text-[10px] text-accent" aria-busy="true">
            <span className="pulse-dot">●</span> Optimizing routes on the {m.departureUtc.slice(0, 10)} risk surface…
          </div>
        )}
        {ms.routesError && <div className="text-[10px] text-risk-HIGH" role="alert">⚠ {ms.routesError}</div>}
        {!plan && !ms.routesLoading && (
          <button className="btn btn-accent w-full !py-1.5 !text-[10px]" onClick={() => void ms.generateRoutes()}>
            Generate routes
          </button>
        )}
        {plan && !ms.routesLoading && (
          <>
            {(m.activeProfile && !showAcceptButtons
              ? plan.routes.filter((r) => r.profile === m.activeProfile)
              : plan.routes
            ).map((r) => (
              <RouteCard key={r.profile} r={r}
                selected={ms.selectedProfile === r.profile}
                onSelect={() => ms.setSelectedProfile(ms.selectedProfile === r.profile ? null : r.profile)}
                onAccept={showAcceptButtons ? () => void ms.acceptRoute(r.profile) : undefined}
                acceptLabel="Accept & start voyage simulation"
                departureUtc={m.departureUtc}
              />
            ))}
            {showAcceptButtons && (
              <div className="border-l-2 pl-2 py-0.5" style={{ borderLeftColor: 'var(--color-risk-low)' }}>
                <div className="text-[9px] font-semibold text-ink-dim mb-0.5">Recommendation (decision support)</div>
                <p className="text-[9.5px] text-ink-dim leading-relaxed m-0">{plan.recommendation.reason}</p>
              </div>
            )}
            {m.timeResolution != null && (
              <Details label="Environmental data used for this plan">
                {(m.timeResolution as { notes?: string[] }).notes?.map((n, i) => (
                  <p key={i} className="text-[9.5px] text-ink-faint leading-snug m-0">· {n}</p>
                ))}
                <p className="text-[9px] text-ink-faint m-0">
                  Sea ice {plan.riskSurface?.seaIce?.kind === 'OBSERVATION' ? 'observation' : 'forecast'} valid{' '}
                  {plan.riskSurface?.seaIce?.validTime} · weather hour {plan.riskSurface?.weatherHour}Z.
                </p>
              </Details>
            )}
          </>
        )}
      </div>

      {/* ── conditions at the vessel (sim-time indexed) ── */}
      {ms.sim && (
        <>
          <SectionTitle>Conditions at Vessel</SectionTitle>
          <div className="px-3 pb-2 space-y-1">
            <Row label="Position">
              {Math.abs(ms.sim.vesselPos.lat).toFixed(2)}°S {ms.sim.vesselPos.lon.toFixed(2)}°E
            </Row>
            <Row label="Heading / progress">
              {ms.sim.headingDeg.toFixed(0)}° · {ms.sim.distanceCoveredNm.toFixed(0)} nm
            </Row>
            {ms.vesselWeather ? (
              <>
                <Row label="Wind (10 m)">{ms.vesselWeather.windSpeedKn.toFixed(0)} kn / {ms.vesselWeather.windDirDeg.toFixed(0)}°</Row>
                <Row label="Air temp (2 m)">{ms.vesselWeather.tempC.toFixed(1)} °C</Row>
                <div className="text-[8.5px] text-ink-faint font-data">nearest cell · hour {ms.vesselWeather.hour}Z</div>
              </>
            ) : (
              <div className="text-[9.5px] text-ink-faint">Weather at sim time unavailable.</div>
            )}
          </div>

          <SectionTitle right={ms.riskCheckRunning
            ? <span className="text-[8px] text-accent pulse-dot">checking…</span> : undefined}>
            Remaining-Route Risk
          </SectionTitle>
          <div className="px-3 pb-2 space-y-1">
            {ms.liveRouteRisk ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-ink-dim">Overall (ahead of vessel)</span>
                  <SevChip sev={ms.liveRouteRisk.overallSeverity} />
                </div>
                <p className="text-[9.5px] text-ink-dim leading-snug m-0">{ms.liveRouteRisk.worstDetail}</p>
                {ms.liveRouteRisk.bergEncounters.length > 0 && (
                  <p className="text-[9px] text-ink-faint m-0">
                    Berg zones ahead: {ms.liveRouteRisk.bergEncounters.map((b) => `${b.id} (${b.severity})`).join(', ')}
                  </p>
                )}
                <div className="text-[8.5px] text-ink-faint font-data">
                  assessed {ms.liveRouteRisk.atSimTime.slice(0, 16)}Z · ice {ms.liveRouteRisk.seaIceValid.slice(0, 10)} · wx {ms.liveRouteRisk.weatherHour}Z
                </div>
              </>
            ) : (
              <div className="text-[9.5px] text-ink-faint">
                Assessed automatically every 3 simulated hours while under way.
              </div>
            )}
            {(m.state === 'IN_PROGRESS' || m.state === 'PAUSED' || m.state === 'ROUTE_REVIEW_REQUIRED') && (
              <button className="btn w-full !py-1 !text-[9px]" onClick={() => void ms.runReplan()} disabled={ms.replanLoading}>
                {ms.replanLoading ? 'Re-optimizing…' : '⟳ Generate alternative routes from current position'}
              </button>
            )}
            {ms.replanError && <div className="text-[9.5px] text-risk-HIGH" role="alert">⚠ {ms.replanError}</div>}
          </div>
        </>
      )}

      {/* ── event log ── */}
      <SectionTitle right={
        <button className="text-[8px] font-data text-ink-faint hover:text-accent" onClick={() => setLogOpen(!logOpen)}>
          {logOpen ? 'HIDE' : 'SHOW'}
        </button>
      }>
        Mission Event Log
      </SectionTitle>
      {logOpen && (
        <div className="px-3 pb-3 space-y-1">
          {[...ms.events].reverse().map((e, i) => (
            <div key={`${e.at}-${i}`} className="border-l-2 border-line pl-2 py-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-data text-[8.5px] font-bold text-ink-dim">{e.type.replace(/_/g, ' ')}</span>
                <span className="font-data text-[8px] text-ink-faint whitespace-nowrap">
                  {e.simTime ? `sim ${e.simTime.slice(5, 16)}Z` : e.at.slice(5, 16) + 'Z'}
                </span>
              </div>
              <p className="text-[9.5px] text-ink-dim leading-snug m-0">{e.message}</p>
            </div>
          ))}
          {ms.events.length === 0 && <div className="text-[9.5px] text-ink-faint">No events yet.</div>}
        </div>
      )}

      <div className="px-3 pb-4 mt-auto space-y-1.5 pt-2">
        <button className="btn w-full !py-1 !text-[9px]" onClick={ms.exportReport}>⤓ Export mission report (.md)</button>
        <button className="btn w-full !py-1 !text-[9px]" onClick={ms.closeMission}>✕ Close mission workspace</button>
      </div>
    </div>
  );
}
