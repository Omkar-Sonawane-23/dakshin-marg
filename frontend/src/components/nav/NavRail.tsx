import { useEffect, useRef, useState } from 'react';
import { useEnv } from '../../state/envStore';
import { useStore } from '../../state/store';
import { useTheme } from '../../state/themeStore';

export type Section =
  | 'MAP'
  | 'MISSION'
  | 'ROUTE_PLANNER'
  | 'SEA_ICE'
  | 'ICEBERGS'
  | 'WEATHER'
  | 'VESSEL'
  | 'RISK'
  | 'SCENARIO'
  | 'VERIFICATION'
  | 'PROVENANCE'
  | 'ALERTS'
  | 'HEALTH'
  | 'SETTINGS';

const I = {
  map: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M3.5 12h17" /><path d="M12 7.5 15 13H9z" /></>,
  mission: <><path d="M5 4h9l4 4v12H5z" /><path d="M14 4v4h4" /><path d="M8 12h7M8 16h5" /></>,
  route: <><path d="M5 18c4-1.5 3-7 6.5-8.5S17 5 19 4" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="4" r="2" /><path d="M9 9l3 3 3-3" /></>,
  seaice: <><path d="M12 3L17 8L12 13L7 8Z" fill="none" /><path d="M7 13L12 18L17 13" /><path d="M4 8l3 3-3 3" /><path d="M20 8l-3 3 3 3" /></>,
  iceberg: <><path d="M12 4L18 14L12 20L6 14Z" /><path d="M6 14h12" /><path d="M9 9l6 6" /></>,
  weather: <><path d="M7 17a4 4 0 0 1 .6-8A5.2 5.2 0 0 1 17.4 10 3.5 3.5 0 0 1 17 17z" /><path d="M8 20h8" /><path d="M12 14v4" /></>,
  vessel: <><path d="M4 15h16l-2 4H6z" /><path d="M12 15V6" /><path d="M8 10h8l-4-4z" /></>,
  risk: <><path d="M12 3L3 8v5c0 4.5 3 8.5 9 11 6-2.5 9-6.5 9-11V8z" /><path d="M9 12l2 2 4-4" /></>,
  scenario: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /><circle cx="12" cy="12" r="3" /></>,
  verification: <><path d="M9 11l3 3 5-6" /><circle cx="12" cy="12" r="9" /><path d="M12 7v3" /></>,
  provenance: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 14h6M9 18h6" /></>,
  alerts: <><path d="M12 4 3 19h18z" /><path d="M12 10v4M12 16.5v.6" /></>,
  health: <><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>,
  layers: <><path d="m12 4 8 4-8 4-8-4z" /><path d="m4 12 8 4 8-4" /><path d="m4 16 8 4 8-4" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M15 15l4 4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></>,
};

function RailBtn({ id, label, icon, active, badge, onClick, disabled, small }: { id: string; label: string; icon: React.ReactNode; active?: boolean; badge?: boolean|string; onClick: () => void; disabled?: boolean; small?: boolean }) {
  return (
    <button
      className={`nav-rail-btn ${active ? 'active' : ''} ${small ? '!w-7 !h-7' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-section={id}
    >
      <svg width={small?14:18} height={small?14:18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icon}
      </svg>
      {badge && <span className="dot" aria-hidden="true" />}
      {typeof badge==='string' && <span className="absolute -top-1 -right-1 font-data text-[7px] bg-risk-CRITICAL text-white rounded-full w-4 h-4 flex items-center justify-center">{badge}</span>}
    </button>
  );
}

export default function NavRail({ section, onSection, onCommand }: { section: Section | null; onSection: (s: Section | null) => void; onCommand?: ()=>void }) {
  const env = useEnv();
  const { snapshot } = useStore();
  const { theme, toggleTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const live = env.mode === 'LIVE';

  useEffect(() => {
    if (!settingsOpen) return;
    const h = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setSettingsOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [settingsOpen]);

  const unacked = snapshot?.alerts.filter(a=>a.severity!=='INFO').length ?? 0;
  const toggle = (s: Section) => onSection(section === s ? null : s);

  const GroupLabel = ({ children }: {children:string}) => <div className="text-[7px] font-bold tracking-[0.12em] text-ink-faint text-center py-0.5">{children}</div>;

  return (
    <nav className="nav-rail !w-[60px] !gap-0.5 !py-1 overflow-y-auto scrollbar-none" aria-label="Primary sections" onPointerDown={e=>e.stopPropagation()}>
      <RailBtn id="MAP" label="Mission Control — 3D chart only" icon={I.map} active={section===null} onClick={()=>onSection(null)} />
      {onCommand && <RailBtn id="SEARCH" label="Command palette (⌘K)" icon={I.search} onClick={onCommand} />}
      <div className="nav-rail-sep !my-1" />

      <GroupLabel>PLAN</GroupLabel>
      <RailBtn id="MISSION" label="Mission Control" icon={I.mission} active={section==='MISSION'} onClick={()=>toggle('MISSION')} />
      <RailBtn id="ROUTE_PLANNER" label="Route Planner — Pareto & trade-offs" icon={I.route} active={section==='ROUTE_PLANNER'} onClick={()=>toggle('ROUTE_PLANNER')} />
      <RailBtn id="VESSEL" label="Vessel Profiles — capability comparison" icon={I.vessel} active={section==='VESSEL'} onClick={()=>toggle('VESSEL')} />

      <div className="nav-rail-sep !my-1" />
      <GroupLabel>ENV</GroupLabel>
      <RailBtn id="SEA_ICE" label="Sea-Ice Forecast — SIC + uncertainty" icon={I.seaice} active={section==='SEA_ICE'} onClick={()=>toggle('SEA_ICE')} />
      <RailBtn id="ICEBERGS" label="Iceberg Intelligence — detection & trajectory" icon={I.iceberg} active={section==='ICEBERGS'} onClick={()=>toggle('ICEBERGS')} />
      <RailBtn id="WEATHER" label="Weather & Ocean — wind · current · waves" icon={I.weather} active={section==='WEATHER'} onClick={()=>toggle('WEATHER')} />
      <RailBtn id="RISK" label="Risk & Navigability — POLARIS" icon={I.risk} active={section==='RISK'} onClick={()=>toggle('RISK')} />

      <div className="nav-rail-sep !my-1" />
      <GroupLabel>OPS</GroupLabel>
      <RailBtn id="SCENARIO" label="Scenario / What-If — robustness" icon={I.scenario} active={section==='SCENARIO'} onClick={()=>toggle('SCENARIO')} />
      <RailBtn id="VERIFICATION" label="Verification / Hindsight — skill scores" icon={I.verification} active={section==='VERIFICATION'} onClick={()=>toggle('VERIFICATION')} />
      <RailBtn id="PROVENANCE" label="Data & Provenance — traceability" icon={I.provenance} active={section==='PROVENANCE'} onClick={()=>toggle('PROVENANCE')} />

      <div className="nav-rail-sep !my-1" />
      <RailBtn id="ALERTS" label="Alert Center — critical & warnings" icon={I.alerts} badge={unacked>0? String(unacked):undefined} active={section==='ALERTS'} onClick={()=>toggle('ALERTS')} />
      <RailBtn id="HEALTH" label="System Health — ingestion & models" icon={I.health} active={section==='HEALTH'} onClick={()=>toggle('HEALTH')} />

      <div className="flex-1" />

      <div ref={popRef} style={{ position:'relative' }}>
        <RailBtn id="SETTINGS" label="Settings — theme, mode, offline" icon={I.settings} active={settingsOpen} onClick={()=>setSettingsOpen(v=>!v)} />
        {settingsOpen && (
          <div className="glass nav-settings slide-up !left-[62px] !right-auto !bottom-0 !top-auto" role="dialog" aria-label="Settings" style={{ width: 300 }}>
            <div className="label-xs mb-2">Display</div>
            <button className="btn w-full !justify-between" onClick={toggleTheme}><span>Theme</span><span className="font-data text-[10px] text-accent">{theme==='dark'?'NIGHT':'DAY'}</span></button>
            <div className="hairline my-2" />
            <div className="label-xs mb-1.5">Data mode</div>
            <div className="flex gap-1">
              <button className={`btn flex-1 !py-1 !text-[9px] ${!live?'btn-accent':''}`} onClick={()=>env.setMode('DEMO')}>DEMO</button>
              <button className={`btn flex-1 !py-1 !text-[9px] ${live?'btn-accent':''}`} onClick={()=>env.setMode('LIVE')}>LIVE</button>
            </div>
            <div className="font-data text-[9px] text-ink-dim leading-relaxed mt-1">{live?'LIVE — NSIDC · USNIC · Open-Meteo':'SIMULATION — deterministic'}</div>
            <div className="hairline my-2" />
            <div className="label-xs mb-1.5">Offline</div>
            <p className="text-[9.5px] text-ink-faint leading-snug m-0">When offline, cached SIC, bergs, routes and maps remain available. Data age is shown on every product. Sync resumes on reconnect.</p>
            <div className="hairline my-2" />
            <p className="text-[9.5px] text-ink-faint leading-snug m-0">POLARIS-X is decision support. Routes, risk and forecasts are recommendations — the navigation decision stays with the operator.</p>
          </div>
        )}
      </div>
    </nav>
  );
}
