/** ROUTE REVIEW REQUIRED — floating alert raised by trigger detection.
 * Explains the primary factor and offers the four operator actions.
 * Nothing is applied automatically (decision support only).
 */

import { useMission } from '../../state/missionStore';

export default function RouteReviewAlert() {
  const ms = useMission();
  const alert = ms.reviewAlert;
  if (!alert || ms.candidatePlan) return null;

  return (
    <div
      className="absolute top-14 left-1/2 -translate-x-1/2 z-40 w-[min(560px,92%)] bg-panel border rounded shadow-2xl fade-in"
      style={{ borderColor: 'var(--color-risk-high)' }}
      role="alertdialog" aria-label="Route review required"
    >
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2.5">
        <span className="font-data text-[12px] font-bold text-risk-HIGH">▲ ROUTE REVIEW REQUIRED</span>
        <span className="font-data text-[9px] text-ink-faint ml-auto">sim {alert.simTime.slice(0, 16)}Z</span>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-ink-faint mb-0.5">Primary factor</div>
          <p className="text-[11px] text-ink leading-relaxed m-0">{alert.primaryFactor}</p>
        </div>
        {alert.detail && (
          <p className="text-[10px] text-ink-dim leading-relaxed m-0">{alert.detail}</p>
        )}
        <p className="text-[9px] text-ink-faint leading-snug m-0">
          Simulation paused. The current route remains active until the operator decides —
          nothing is changed automatically.
        </p>
      </div>
      <div className="px-4 pb-3 grid grid-cols-2 gap-1.5">
        <button className="btn !py-1.5 !text-[9.5px]"
          disabled={!alert.worstAt?.lat}
          onClick={() => alert.worstAt?.lat && ms.requestFocus(alert.worstAt.lat!, alert.worstAt.lon!)}>
          ⌖ View affected segment
        </button>
        <button className="btn btn-accent !py-1.5 !text-[9.5px]"
          onClick={() => void ms.runReplan()} disabled={ms.replanLoading}>
          {ms.replanLoading ? 'Re-optimizing…' : '⟳ Generate alternative routes'}
        </button>
        <button className="btn !py-1.5 !text-[9.5px]" onClick={ms.continueCurrentRoute}>
          ▶ Continue current route
        </button>
        <button className="btn !py-1.5 !text-[9.5px]"
          onClick={() => { void ms.runReplan(); }} disabled={ms.replanLoading}
          title="Alternatives appear in the right panel for side-by-side comparison">
          ⇄ Compare routes
        </button>
      </div>
    </div>
  );
}
