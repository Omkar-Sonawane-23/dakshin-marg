/** Collapsible map legend — bottom-center overlay. */

import { useState } from 'react';
import { useStore } from '../state/store';
import { useEnv } from '../state/envStore';

export default function MapLegend() {
  const [open, setOpen] = useState(true);
  const { layers } = useStore();
  const env = useEnv();
  const { mode, error: envError } = env;
  const live = mode === 'LIVE';

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
      {open ? (
        <div className="panel rounded-sm px-3.5 py-2 flex items-center gap-5 slide-up">
          {layers.seaIce && !(live && env.riskEnabled) && (
            <div className="flex items-center gap-2">
              <span className="label-xs">{live && env.forecastHorizon !== null ? `Sea ice +${env.forecastHorizon}h` : 'Sea ice'}</span>
              <div className="w-[72px] h-[7px] rounded-sm" style={{ background: 'linear-gradient(90deg, var(--legend-ice-0), var(--legend-ice-1), var(--legend-ice-2))' }} />
              <span className="font-data text-[8.5px] text-ink-faint">0–98% conc.</span>
            </div>
          )}
          {live && env.riskEnabled && (
            <div className="flex items-center gap-2">
              <span className="label-xs">Risk severity</span>
              {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((s) => (
                <span key={s} className="flex items-center gap-1">
                  <span className={`inline-block w-2.5 h-2.5 rounded-[2px] bg-risk-${s}`} style={{ opacity: 0.75 }} />
                  <span className="text-[8px] font-data text-ink-faint">{s.slice(0, 4)}</span>
                </span>
              ))}
            </div>
          )}
          {!live && layers.risk && (
            <div className="flex items-center gap-2">
              <span className="label-xs">Risk</span>
              <div className="w-[72px] h-[7px] rounded-sm" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-risk-low) 30%, transparent), color-mix(in srgb, var(--color-risk-med) 55%, transparent), color-mix(in srgb, var(--color-risk-high) 60%, transparent), color-mix(in srgb, var(--color-risk-crit) 65%, transparent))' }} />
            </div>
          )}
          {!live && (
            <div className="flex items-center gap-2">
              <span className="label-xs">Routes</span>
              <span className="flex items-center gap-1"><span className="inline-block w-4 h-[2px] bg-accent" /><span className="text-[8.5px] text-ink-faint">active</span></span>
              <span className="flex items-center gap-1"><span className="inline-block w-4 h-[2px]" style={{ background: 'repeating-linear-gradient(90deg,var(--color-risk-low) 0 4px,transparent 4px 7px)' }} /><span className="text-[8.5px] text-ink-faint">recommended</span></span>
              <span className="flex items-center gap-1"><span className="inline-block w-4 h-[2px]" style={{ background: 'repeating-linear-gradient(90deg,var(--color-ink-faint) 0 2px,transparent 2px 5px)' }} /><span className="text-[8.5px] text-ink-faint">alternative</span></span>
            </div>
          )}
          {live ? (
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden="true"><rect x="3" y="3" width="6" height="6" transform="rotate(45 6 6)" fill="none" stroke="var(--color-risk-low)" strokeWidth="1.3" /></svg>
              <span className="text-[8.5px] text-ink-faint">iceberg (observed)</span>
              {envError && (
                <span className="badge" style={{ color: 'var(--color-risk-high)', borderColor: 'color-mix(in srgb, var(--color-risk-high) 50%, transparent)', background: 'color-mix(in srgb, var(--color-risk-high) 8%, transparent)', marginLeft: 6 }}>FEED DOWN</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <svg width="11" height="10" aria-hidden="true"><path d="M5.5 0 L11 9 L0 9 Z" fill="none" stroke="var(--map-berg)" strokeWidth="1.2" /></svg>
              <span className="text-[8.5px] text-ink-faint">iceberg</span>
              <svg width="11" height="10" aria-hidden="true"><path d="M5.5 0 L11 9 L0 9 Z" fill="none" stroke="var(--color-risk-high)" strokeWidth="1.2" /></svg>
              <span className="text-[8.5px] text-ink-faint">threat</span>
            </div>
          )}
          <button className="btn btn-ghost !p-1 !text-[9px]" onClick={() => setOpen(false)} aria-label="Collapse legend">▾</button>
        </div>
      ) : (
        <button className="btn !text-[9px]" onClick={() => setOpen(true)} aria-label="Expand legend">LEGEND ▴</button>
      )}
    </div>
  );
}
