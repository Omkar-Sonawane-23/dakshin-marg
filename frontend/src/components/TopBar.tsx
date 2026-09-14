import { useStore } from '../state/store';
import { useEnv } from '../state/envStore';
import { useMission } from '../state/missionStore';
import { useTheme } from '../state/themeStore';
import { useAuth } from '../state/authStore';
import { fmtScenarioTime } from '../lib/format';
import { RiskChip } from './ui';

const MISSION_STATE_COLOR: Record<string, string> = {
  READY: 'var(--color-accent)',
  ROUTES_GENERATED: 'var(--color-accent)',
  IN_PROGRESS: 'var(--color-risk-low)',
  ROUTE_REVIEW_REQUIRED: 'var(--color-risk-high)',
  RE_PLANNING: 'var(--color-risk-med)',
  PAUSED: 'var(--color-ink-dim)',
  COMPLETED: 'var(--color-risk-low)',
};

export default function TopBar() {
  const { scenario, snapshot } = useStore();
  const env = useEnv();
  const ms = useMission();
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const m = env.mode === 'LIVE' ? ms.mission : null;

  const statusColor =
    snapshot?.missionStatus === 'REROUTE_PROPOSED' ? 'text-risk-HIGH' :
    snapshot?.missionStatus === 'ACTIVE' ? 'text-risk-LOW' : 'text-ink-dim';
  const statusText = snapshot?.missionStatus === 'REROUTE_PROPOSED' ? 'REROUTE PROPOSED' : snapshot?.missionStatus ?? '—';

  return (
    <header className="h-12 flex items-center gap-4 px-4 border-b border-line bg-deep/90 backdrop-blur z-30 flex-none">
      {/* wordmark */}
      <div className="flex items-center gap-2.5">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="none" stroke="var(--color-accent)" strokeWidth="1.4" />
          <path d="M12 3 L12 21 M3 12 L21 12" stroke="var(--color-line-2)" strokeWidth="0.8" />
          <path d="M12 5 L17 15 L7 15 Z" fill="none" stroke="var(--color-ice)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <div className="leading-none">
          <div className="font-data font-bold text-[14px] tracking-[0.22em] text-ice">DAKSHIN MARG</div>
          <div className="text-[8px] tracking-[0.18em] text-ink-faint mt-0.5">ANTARCTIC NAVIGATION DECISION SUPPORT</div>
        </div>
      </div>

      <div className="h-6 w-px bg-line" />

      {/* mission id / live context */}
      <div className="leading-none min-w-0">
        <div className="label-xs">Mission</div>
        <div className="font-data text-[12px] text-ice mt-0.5 truncate">
          {env.mode === 'DEMO'
            ? scenario ? `${scenario.mission.code} · ${scenario.mission.name}` : '—'
            : m
              ? `${m.id} · ${m.name}`
              : 'Prydz Bay corridor · East Antarctica'}
        </div>
        {m && (
          <div className="text-[9px] text-ink-faint font-data mt-0.5 truncate">
            {m.vessel.name} ({m.vessel.iceClass}) · {m.origin.label ?? `${m.origin.lat.toFixed(1)}°,${m.origin.lon.toFixed(1)}°`} → {m.destination.label ?? `${m.destination.lat.toFixed(1)}°,${m.destination.lon.toFixed(1)}°`} · dep {m.departureUtc.slice(0, 16)}Z
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* status cluster — demo scenario values only shown in DEMO mode */}
      {env.mode === 'DEMO' ? (
        <div className="hidden lg:flex items-center gap-5 whitespace-nowrap">
          <div className="leading-none text-right">
            <div className="label-xs">Mission Status</div>
            <div className={`font-data text-[12px] font-bold mt-0.5 ${statusColor}`}>
              <span className="pulse-dot inline-block mr-1.5" aria-hidden="true">●</span>
              {statusText}
            </div>
          </div>
          <div className="leading-none text-right">
            <div className="label-xs">Route Risk</div>
            <div className="mt-0.5">{snapshot ? <RiskChip level={snapshot.risk.overall} /> : <span className="text-ink-faint">—</span>}</div>
          </div>
          <div className="leading-none text-right">
            <div className="label-xs">Scenario Clock</div>
            <div className="font-data text-[12px] text-ice mt-0.5">
              {scenario && snapshot ? fmtScenarioTime(scenario.mission.departureUtc, snapshot.timeOffsetH) : '—'}
              {snapshot && <span className="text-accent ml-1.5">T+{snapshot.timeOffsetH}h</span>}
            </div>
          </div>
        </div>
      ) : m ? (
        <div className="hidden lg:flex items-center gap-5 whitespace-nowrap">
          <div className="leading-none text-right">
            <div className="label-xs">Mission Status</div>
            <div className="font-data text-[12px] font-bold mt-0.5"
              style={{ color: MISSION_STATE_COLOR[m.state] ?? 'var(--color-ink-dim)' }}>
              <span className="pulse-dot inline-block mr-1.5" aria-hidden="true">●</span>
              {m.state.replace(/_/g, ' ')}
            </div>
          </div>
          <div className="leading-none text-right">
            <div className="label-xs">Sim Clock</div>
            <div className="font-data text-[12px] text-ice mt-0.5">
              {ms.sim
                ? <>{new Date(ms.sim.simTimeMs).toISOString().slice(0, 16)}Z<span className="text-accent ml-1.5">T+{ms.sim.elapsedH.toFixed(1)}h</span></>
                : '—'}
            </div>
          </div>
        </div>
      ) : (
        <div className="hidden lg:flex items-center gap-5 whitespace-nowrap">
          <div className="leading-none text-right">
            <div className="label-xs">Data</div>
            <div className="font-data text-[12px] font-bold mt-0.5" style={{ color: env.error ? 'var(--color-risk-high)' : 'var(--color-risk-low)' }}>
              <span className="pulse-dot inline-block mr-1.5" aria-hidden="true">●</span>
              {env.error ? 'DEGRADED' : env.loading ? 'CONNECTING' : 'LIVE'}
            </div>
          </div>
          <div className="leading-none text-right">
            <div className="label-xs">Latest analysis</div>
            <div className="font-data text-[12px] text-ice mt-0.5">
              {env.seaIce?.meta.temporal.validTime?.slice(0, 10) ?? '—'}
            </div>
          </div>
        </div>
      )}

      <div className="h-6 w-px bg-line hidden md:block" />

      {/* data-mode switch: DEMO scenario vs LIVE real datasets */}
      <div
        className="flex-none flex items-center rounded-sm border border-line overflow-hidden whitespace-nowrap"
        role="tablist"
        aria-label="Data mode"
      >
        <button
          role="tab"
          aria-selected={env.mode === 'DEMO'}
          className={`px-2.5 py-1 text-[9.5px] font-bold tracking-[0.12em] transition-colors ${
            env.mode === 'DEMO' ? 'mode-tab-demo' : 'text-ink-faint hover:text-ink-dim'
          }`}
          onClick={() => env.setMode('DEMO')}
          title="Simulated mission scenario — repeatable, clearly labelled"
        >
          SIMULATION
        </button>
        <button
          role="tab"
          aria-selected={env.mode === 'LIVE'}
          className={`px-2.5 py-1 text-[9.5px] font-bold tracking-[0.12em] transition-colors ${
            env.mode === 'LIVE' ? 'mode-tab-live' : 'text-ink-faint hover:text-ink-dim'
          }`}
          onClick={() => env.setMode('LIVE')}
          title="Live data: NSIDC sea ice, USNIC icebergs, Open-Meteo wind"
        >
          LIVE
        </button>
      </div>

      <div className="hidden sm:flex items-center gap-1.5 text-[9px] font-data text-ink-faint border border-line rounded-sm px-2 py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-risk-LOW" />{user?.role ?? 'VIEWER'} · {user?.name ?? '—'}
      </div>

      {/* theme toggle — explicit choice persists; system preference otherwise */}
      <button
        type="button"
        className="btn btn-ghost flex-none px-2"
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? (
          /* sun — action: go light */
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" />
          </svg>
        ) : (
          /* moon — action: go dark */
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.4 14.2A8.4 8.4 0 0 1 9.8 3.6a8.4 8.4 0 1 0 10.6 10.6Z" />
          </svg>
        )}
      </button>
    </header>
  );
}
