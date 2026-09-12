/**
 * Slim anchored navigation rail.
 *
 * The information architecture is unchanged — this is a *switch* over panels
 * that already exist, plus the two actions that already exist (route planner,
 * report export). Nothing here opens a page that wasn't in the app before:
 *
 *   MAP          collapse both rails, chart only
 *   MISSION      left rail  → MissionListPanel / MissionPanel
 *   PLANNER      action     → MissionWizard (LIVE) / RouteComparison (DEMO)
 *   CONDITIONS   right rail → LiveEnvPanel (weather · ice · risk · routing)
 *   VESSEL       right rail → MissionWorkspacePanel; DEMO selects the vessel
 *   ALERTS       right rail → AlertPanel
 *   LAYERS       right rail → EnvLayerControl (LIVE) / AlertPanel (DEMO)
 *   REPORT       action     → mission.exportReport()
 *   SETTINGS     popover    → theme, data mode, provenance of the relief
 */
import { useEffect, useRef, useState } from 'react';
import { useEnv } from '../../state/envStore';
import { useMission } from '../../state/missionStore';
import { useStore } from '../../state/store';
import { useTheme } from '../../state/themeStore';

export type Section =
  | 'MAP' | 'MISSION' | 'CONDITIONS' | 'VESSEL' | 'ALERTS' | 'LAYERS';

const I = {
  map: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M3.5 12h17" /><path d="M12 7.5 15 13H9z" /></>,
  mission: <><path d="M5 4h9l4 4v12H5z" /><path d="M14 4v4h4" /><path d="M8 12h7M8 16h5" /></>,
  planner: <><path d="M5 18c4-1.5 3-7 6.5-8.5S17 5 19 4" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="4" r="2" /></>,
  conditions: <><path d="M7 17a4 4 0 0 1 .6-8A5.2 5.2 0 0 1 17.4 10 3.5 3.5 0 0 1 17 17z" /><path d="M8 20h8" /></>,
  vessel: <><path d="M4 15h16l-2 4H6z" /><path d="M12 15V6" /><path d="M8 10h8l-4-4z" /></>,
  alerts: <><path d="M12 4 3 19h18z" /><path d="M12 10v4M12 16.5v.6" /></>,
  layers: <><path d="m12 4 8 4-8 4-8-4z" /><path d="m4 12 8 4 8-4" /><path d="m4 16 8 4 8-4" /></>,
  report: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 17h4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></>,
};

function RailBtn({
  id, label, icon, active, badge, onClick, disabled,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  badge?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`nav-rail-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-section={id}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icon}
      </svg>
      {badge && <span className="dot" aria-hidden="true" />}
    </button>
  );
}

export default function NavRail({
  section, onSection,
}: {
  section: Section | null;
  onSection: (s: Section | null) => void;
}) {
  const env = useEnv();
  const mission = useMission();
  const { snapshot, setComparisonOpen, setSelection } = useStore();
  const { theme, toggleTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const live = env.mode === 'LIVE';
  const missionOpen = live && mission.mission !== null;

  useEffect(() => {
    if (!settingsOpen) return;
    const h = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [settingsOpen]);

  const unacked = snapshot?.alerts.filter((a) => a.severity !== 'INFO').length ?? 0;

  const toggle = (s: Section) => onSection(section === s ? null : s);

  return (
    <nav className="nav-rail" aria-label="Primary sections" onPointerDown={(e) => e.stopPropagation()}>
      <RailBtn id="MAP" label="Chart only — hide panels" icon={I.map}
        active={section === null} onClick={() => onSection(null)} />
      <div className="nav-rail-sep" />
      <RailBtn id="MISSION" label="Missions" icon={I.mission}
        active={section === 'MISSION'} onClick={() => toggle('MISSION')} />
      <RailBtn id="PLANNER" label={live ? 'New mission / route planner' : 'Compare routes'} icon={I.planner}
        onClick={() => { if (live) mission.setWizardOpen(true); else setComparisonOpen(true); }} />
      <RailBtn id="CONDITIONS" label="Weather & ice" icon={I.conditions}
        active={section === 'CONDITIONS'} onClick={() => toggle('CONDITIONS')} />
      <RailBtn id="VESSEL" label="Vessel tracking" icon={I.vessel}
        active={section === 'VESSEL'}
        onClick={() => {
          if (missionOpen) toggle('VESSEL');
          else { setSelection({ kind: 'vessel' }); onSection(null); }
        }} />
      <RailBtn id="ALERTS" label="Alerts" icon={I.alerts} badge={unacked > 0}
        active={section === 'ALERTS'} onClick={() => toggle('ALERTS')} />
      <RailBtn id="LAYERS" label="Data layers" icon={I.layers}
        active={section === 'LAYERS'} onClick={() => toggle('LAYERS')} />
      <div className="nav-rail-sep" />
      <RailBtn id="REPORT" label={missionOpen ? 'Export mission report (Markdown)' : 'Report — open a mission first'}
        icon={I.report} disabled={!missionOpen} onClick={() => mission.exportReport()} />

      <div ref={popRef} style={{ position: 'relative' }}>
        <RailBtn id="SETTINGS" label="Settings" icon={I.settings}
          active={settingsOpen} onClick={() => setSettingsOpen((v) => !v)} />
        {settingsOpen && (
          <div className="glass nav-settings slide-up" role="dialog" aria-label="Settings">
            <div className="label-xs mb-2">Display</div>
            <button className="btn w-full !justify-between" onClick={toggleTheme}>
              <span>Theme</span>
              <span className="font-data text-[10px] text-accent">{theme === 'dark' ? 'NIGHT' : 'DAY'}</span>
            </button>
            <div className="hairline my-2" />
            <div className="label-xs mb-1.5">Data mode</div>
            <div className="font-data text-[10px] text-ink-dim leading-relaxed">
              {live ? 'LIVE — NSIDC · USNIC · Open-Meteo' : 'SIMULATION — deterministic scenario'}
            </div>
            <div className="hairline my-2" />
            <div className="label-xs mb-1.5">Terrain</div>
            <p className="text-[9.5px] text-ink-faint leading-snug m-0">
              Coastline and ice shelves are real vector data. Relief is <b>synthesised</b> from that
              coastline and exaggerated ×26 for legibility — no DEM or bathymetry product ships with
              this dataset, so elevations are illustrative, not measured.
            </p>
            <div className="hairline my-2" />
            <p className="text-[9.5px] text-ink-faint leading-snug m-0">
              POLARIS-X is decision support. Routes, risk and forecasts are recommendations —
              the navigation decision stays with the operator.
            </p>
          </div>
        )}
      </div>
    </nav>
  );
}
