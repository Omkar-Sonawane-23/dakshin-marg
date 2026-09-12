import { useState, type ReactNode } from 'react';
import type { AlertSeverity, RiskLevel } from '../types/domain';

/**
 * Collapsed-by-default technical details. Keeps methodology, provenance
 * notes and caveats available without printing them on the main screen.
 */
export function Details({ label = 'Details', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="text-[9.5px] text-ink-faint hover:text-ink-dim transition-colors bg-transparent border-0 p-0 cursor-pointer"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {label}
      </button>
      {open && <div className="mt-1.5 space-y-1 fade-in">{children}</div>}
    </div>
  );
}

/** Risk chip — communicates level with shape + text, never color alone. */
const RISK_GLYPH: Record<RiskLevel, string> = {
  LOW: '▁', MEDIUM: '▄', HIGH: '▆', CRITICAL: '█',
};

export function RiskChip({ level, size = 'sm' }: { level: RiskLevel; size?: 'sm' | 'lg' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-data font-bold risk-${level} ${
        size === 'lg' ? 'text-[15px]' : 'text-[11px]'
      }`}
      role="status"
      aria-label={`Risk level ${level}`}
    >
      <span aria-hidden="true" className="leading-none">{RISK_GLYPH[level]}</span>
      {level}
    </span>
  );
}

export function SevIcon({ sev }: { sev: AlertSeverity }) {
  if (sev === 'CRITICAL')
    return <span aria-label="critical" className="risk-CRITICAL font-bold text-[12px] leading-none">◆</span>;
  if (sev === 'WARNING')
    return <span aria-label="warning" className="risk-MEDIUM font-bold text-[12px] leading-none">▲</span>;
  return <span aria-label="info" className="text-accent font-bold text-[12px] leading-none">●</span>;
}

export function SimBadge({ text = 'SIMULATED' }: { text?: string }) {
  return <span className="badge badge-sim">{text}</span>;
}

/**
 * Provenance badge — data origin, one word.
 *   OBSERVED → green   ARCHIVE → blue-grey
 *   FORECAST → cyan    MODEL   → violet   SIMULATED → amber
 */
const PROV_STYLE: Record<string, { color: string; label: string; title: string }> = {
  REAL_OBSERVATION: { color: 'var(--color-risk-low)', label: 'OBSERVED', title: 'Real observation' },
  REAL_HISTORICAL: { color: 'var(--route-conservative)', label: 'ARCHIVE', title: 'Real historical data' },
  REAL_FORECAST: { color: 'var(--color-accent)', label: 'FORECAST', title: 'Forecast from real data' },
  MODEL_FORECAST: { color: 'var(--color-model)', label: 'MODEL', title: 'Model forecast' },
  SIMULATED: { color: 'var(--color-sim)', label: 'SIMULATED', title: 'Simulated data' },
};

export function ProvBadge({ prov }: { prov: string; compact?: boolean }) {
  const s = PROV_STYLE[prov] ?? PROV_STYLE.SIMULATED;
  return (
    <span
      className="badge"
      style={{ color: s.color, borderColor: `${s.color}55`, background: `${s.color}12` }}
      title={s.title}
    >
      {s.label}
    </span>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
      <div className="label-xs">{children}</div>
      {right}
    </div>
  );
}

export function Stat({ label, value, sub, mono = true }: { label: string; value: ReactNode; sub?: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label-xs mb-0.5">{label}</div>
      <div className={`${mono ? 'font-data' : ''} text-[13px] text-ice truncate`}>{value}</div>
      {sub && <div className="text-[10px] text-ink-faint mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

export function ScoreBar({ score, level }: { score: number; level: RiskLevel }) {
  return (
    <div className="h-[3px] w-full bg-line rounded-full overflow-hidden" role="presentation">
      <div
        className={`h-full bg-risk-${level} transition-all duration-700 ease-out`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function EmptyState({ icon = '◌', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 px-4 text-center fade-in">
      <div className="text-[22px] text-ink-faint" aria-hidden="true">{icon}</div>
      <div className="text-[12px] text-ink-dim font-semibold">{title}</div>
      {hint && <div className="text-[10.5px] text-ink-faint max-w-[220px]">{hint}</div>}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-on={on}
      className="toggle"
      onClick={onChange}
    />
  );
}
