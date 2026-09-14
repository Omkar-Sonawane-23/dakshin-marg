/** Route comparison modal — the OPTIMIZE → DECIDE moment. */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { fmtHours } from '../lib/format';
import { RiskChip, ScoreBar, SimBadge } from './ui';

export default function RouteComparison() {
  const { comparisonOpen, setComparisonOpen, snapshot } = useStore();
  const [decided, setDecided] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (comparisonOpen) {
      setDecided(null);
      closeRef.current?.focus();
    }
  }, [comparisonOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setComparisonOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setComparisonOpen]);

  if (!comparisonOpen || !snapshot) return null;

  const routes = [...snapshot.routes].sort((a, b) => a.riskScore - b.riskScore);
  const rec = snapshot.routes.find((r) => r.id === snapshot.recommendedRouteId);
  const minDist = Math.min(...routes.map((r) => r.distanceNm));

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center p-6 fade-in"
      style={{ background: 'color-mix(in srgb, var(--color-abyss) 88%, transparent)', backdropFilter: 'blur(3px)' }}
      onClick={() => setComparisonOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Route comparison"
    >
      <div
        className="panel rounded-sm w-full max-w-[880px] max-h-full flex flex-col slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line flex-none">
          <div>
            <div className="font-data font-bold text-[13px] text-ice tracking-wider">Route comparison — T+{snapshot.timeOffsetH}h</div>
            <div className="text-[10px] text-ink-faint mt-0.5">
              {routes.length} alternatives, ranked by risk, distance, time and fuel estimate
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SimBadge text="SIMULATION" />
            <button ref={closeRef} className="btn btn-ghost !px-2" onClick={() => setComparisonOpen(false)} aria-label="Close comparison">✕</button>
          </div>
        </div>

        <div className="overflow-y-auto p-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(routes.length, 4)}, minmax(0, 1fr))` }}>
            {routes.map((r) => {
              const isRec = r.id === snapshot.recommendedRouteId;
              const isActive = r.id === snapshot.activeRouteId;
              const superseded = !!r.supersededByRouteId;
              return (
                <div
                  key={r.id}
                  className={`rounded-sm border p-3 flex flex-col gap-2 transition-colors ${
                    isRec ? 'border-risk-LOW/60 bg-risk-LOW/[0.04]' : superseded ? 'border-risk-HIGH/40 opacity-80' : 'border-line bg-panel-inset'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-data font-bold text-[11px] text-ice">{r.label.split('—')[0].trim()}</span>
                    {isRec && <span className="text-[8px] font-bold tracking-widest text-risk-LOW">★ RECOMMENDED</span>}
                    {superseded && <span className="text-[8px] font-bold tracking-widest text-risk-HIGH">SUPERSEDED</span>}
                    {isActive && !isRec && <span className="text-[8px] font-bold tracking-widest text-accent">ACTIVE</span>}
                  </div>
                  <div className="text-[9.5px] text-ink-faint -mt-1">{r.label.split('—')[1]?.trim()} · {r.kind}</div>

                  <div className="space-y-1">
                    <Row k="Risk" v={<span className={`font-data font-bold risk-${r.riskLevel}`}>{r.riskScore}</span>} />
                    <ScoreBar score={r.riskScore} level={r.riskLevel} />
                    <Row k="Distance" v={<>{r.distanceNm} nm {r.distanceNm > minDist && <span className="text-ink-faint">(+{r.distanceNm - minDist})</span>}</>} />
                    <Row k="Est. time" v={fmtHours(r.estTimeH)} />
                    <Row k="Est. fuel *" v={`${r.estFuelT} t`} />
                    <Row k="Hazards" v={r.hazards.length === 0 ? <span className="risk-LOW">none</span> : r.hazards.map((h) => h.kind).join(', ')} />
                  </div>

                  <div className="mt-auto pt-1">
                    <RiskChip level={r.riskLevel} />
                  </div>
                </div>
              );
            })}
          </div>

          {rec && (
            <div className="mt-4 panel-inset rounded-sm p-3">
              <div className="label-xs mb-2">Why {rec.label} is recommended</div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                {rec.recommendationReasons.map((reason, i) => (
                  <div key={i} className="text-[10.5px] text-ink-dim leading-relaxed flex gap-1.5">
                    <span className="text-risk-LOW flex-none">✓</span>{reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DECIDE strip */}
          <div className="mt-4 flex items-center justify-between gap-3 border border-line rounded-sm px-3 py-2.5">
            <div className="text-[10.5px] text-ink-dim leading-snug">
              <span className="font-bold text-ice">OPERATOR DECISION REQUIRED.</span>{' '}
              Dakshin Marg is a decision-support system — route selection authority remains with the navigator.
            </div>
            <div className="flex gap-2 flex-none">
              {decided ? (
                <span className="font-data text-[11px] text-risk-LOW self-center fade-in">✓ {decided} — decision recorded (DEMO)</span>
              ) : (
                <>
                  <button className="btn btn-danger" onClick={() => setDecided('RECOMMENDATION REJECTED')}>Reject</button>
                  <button className="btn btn-accent" onClick={() => setDecided(`${rec?.label ?? 'ROUTE'} APPROVED`)}>
                    Approve Recommended
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="text-[8.5px] text-ink-faint mt-2">
            *Fuel figures are model estimates from a documented demo formula — not real-world validated measurements.
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-[10.5px]">
      <span className="text-ink-faint">{k}</span>
      <span className="font-data text-ink text-right">{v}</span>
    </div>
  );
}
