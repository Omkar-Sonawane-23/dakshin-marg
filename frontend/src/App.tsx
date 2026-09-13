import { useCallback, useEffect, useMemo, useState } from 'react';
import { StoreProvider, useStore } from './state/store';
import { EnvProvider, useEnv } from './state/envStore';
import { MissionProvider, useMission } from './state/missionStore';
import { VesselProvider, useVessels } from './state/vesselStore';
import { AuthProvider } from './state/authStore';
import TopBar from './components/TopBar';
import MissionPanel from './components/MissionPanel';
import AlertPanel from './components/AlertPanel';
import LiveEnvPanel from './components/LiveEnvPanel';
import MissionListPanel from './components/mission/MissionListPanel';
import MissionWorkspacePanel from './components/mission/MissionWorkspacePanel';
import MissionWizard from './components/mission/MissionWizard';
import MissionTimeBar from './components/mission/MissionTimeBar';
import RouteReviewAlert from './components/mission/RouteReviewAlert';
import NavRail from './components/nav/NavRail';
import type { Section } from './components/nav/NavRail';
import TimeBar from './components/TimeBar';
import AntarcticMap from './components/map/AntarcticMap';
import InspectorDrawer from './components/InspectorDrawer';
import RouteComparison from './components/RouteComparison';
import MapLegend from './components/map/MapLegend';
import { LoadingScreen, ErrorScreen } from './components/ScreenStates';
import VesselPanel from './features/vessel/VesselPanel';
import SeaIcePanel from './features/seaice/SeaIcePanel';
import IcebergPanel from './features/iceberg/IcebergPanel';
import WeatherPanel from './features/weather/WeatherPanel';
import RiskPanel from './features/risk/RiskPanel';
import ScenarioPanel from './features/scenario/ScenarioPanel';
import VerificationPanel from './features/verification/VerificationPanel';
import ProvenancePanel from './features/provenance/ProvenancePanel';
import AlertCenterPanel from './features/alerts/AlertCenterPanel';
import SystemHealthPanel from './features/health/SystemHealthPanel';
import CommandPalette from './components/CommandPalette';
import OfflineIndicator from './components/OfflineIndicator';
import type { ConnMode } from './components/OfflineIndicator';
import ParetoView from './components/ParetoView';

function CommandCenter() {
  const { loading, error, retry, snapshot } = useStore();
  const env = useEnv();
  const ms = useMission();
  const { selected } = useVessels();
  const live = env.mode === 'LIVE';
  const missionOpen = live && ms.mission !== null;

  const [section, setSection] = useState<Section | null>('MISSION');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [connMode, setConnMode] = useState<ConnMode>('CONNECTED');
  const [lastSync] = useState<string>(new Date().toISOString());
  const [bootDone, setBootDone] = useState(false);

  // Boot sequence — 2.2s cinematic init
  useEffect(() => {
    const t = setTimeout(() => setBootDone(true), 2200);
    return () => clearTimeout(t);
  }, []);

  // Keyboard shortcut ⌘K / Ctrl+K
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(v=>!v); }
      if (e.key === '/' && !paletteOpen && (e.target as HTMLElement)?.tagName !== 'INPUT') { e.preventDefault(); setPaletteOpen(true); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [paletteOpen]);

  const onSection = useCallback((s: Section | null) => {
    setSection(s);
    if (s === null) { setLeftOpen(false); setRightOpen(false); return; }
    if (s === 'MISSION') { setLeftOpen(true); setRightOpen(true); return; }
    // route planner & mission-adjacent use both rails in demo mode
    if (s === 'ROUTE_PLANNER' && !live) { setLeftOpen(true); setRightOpen(true); return; }
    setLeftOpen(false);
    setRightOpen(true);
  }, [live]);

  const [seenMode, setSeenMode] = useState(env.mode);
  if (seenMode !== env.mode) {
    setSeenMode(env.mode);
    setSection('MISSION');
    setLeftOpen(true);
    setRightOpen(true);
  }

  // Palette commands
  const commands = useMemo(() => [
    { id:'go-mission', label:'Mission Control', hint:'Open mission panel', action:()=>onSection('MISSION') },
    { id:'go-route', label:'Route Planner', hint:'Pareto · alternatives', action:()=>onSection('ROUTE_PLANNER') },
    { id:'go-seaice', label:'Sea-Ice Forecast', hint:'SIC · σ · edge uncertainty', action:()=>onSection('SEA_ICE') },
    { id:'go-icebergs', label:'Iceberg Intelligence', hint:'Catalogue · trajectory', action:()=>onSection('ICEBERGS') },
    { id:'go-weather', label:'Weather & Ocean', hint:'Wind · current · waves', action:()=>onSection('WEATHER') },
    { id:'go-vessel', label:'Vessel Profiles', hint:`Current: ${selected.name} (${selected.iceClass})`, action:()=>onSection('VESSEL') },
    { id:'go-risk', label:'Risk & Navigability', hint:'POLARIS · GO/CAUTION/NO-GO', action:()=>onSection('RISK') },
    { id:'go-scenario', label:'Scenario / What-If', hint:'Perturb & recompute', action:()=>onSection('SCENARIO') },
    { id:'go-verify', label:'Verification / Hindsight', hint:'Skill scores', action:()=>onSection('VERIFICATION') },
    { id:'go-prov', label:'Data & Provenance', hint:'Lineage · staleness', action:()=>onSection('PROVENANCE') },
    { id:'go-alerts', label:'Alert Center', hint:'Critical · warnings', action:()=>onSection('ALERTS') },
    { id:'go-health', label:'System Health', hint:'Ingestion · models', action:()=>onSection('HEALTH') },
    { id:'toggle-mode', label: live ? 'Switch to DEMO' : 'Switch to LIVE', hint: live ? 'Simulated scenario':'Real datasets', action:()=>env.setMode(live?'DEMO':'LIVE') },
    { id:'offline', label: connMode==='OFFLINE'?'Go online':'Go offline (demo)', hint:'Test degraded ops', action:()=>setConnMode(m=>m==='OFFLINE'?'CONNECTED':'OFFLINE') },
    { id:'new-mission', label:'New Mission', hint:'Create voyage', action:()=>ms.setWizardOpen(true) },
  ], [onSection, live, env, selected, connMode, ms]);

  if (!bootDone) return <BootScreen />;

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen code={error.code} message={error.message} onRetry={retry} />;
  if (!snapshot) return <LoadingScreen />;

  const rightContent = () => {
    switch (section) {
      case 'ROUTE_PLANNER':
        if (live) {
          return (
            <div className="h-full overflow-y-auto">
              <LiveEnvPanel />
              {env.routePlan?.data && <div className="px-3 pb-3"><ParetoView routes={env.routePlan.data.routes} selected={env.selectedRouteProfile} onSelect={env.setSelectedRouteProfile} /></div>}
            </div>
          );
        }
        return (
          <div className="h-full overflow-y-auto pb-4">
            <div className="px-3 pt-3 label-xs">Route Planner — DEMO</div>
            <div className="px-3 pb-3 text-[10px] text-ink-dim leading-relaxed">DEMO routing is in the left Mission panel and the Route Comparison modal. Switch to LIVE to use the POLARIS severity-ceiling optimizer with Pareto view.</div>
          </div>
        );
      case 'SEA_ICE': return <SeaIcePanel />;
      case 'ICEBERGS': return <IcebergPanel />;
      case 'WEATHER': return <WeatherPanel />;
      case 'VESSEL': return missionOpen ? <MissionWorkspacePanel /> : <VesselPanel />;
      case 'RISK': return <RiskPanel />;
      case 'SCENARIO': return <ScenarioPanel onRun={(id)=>{
        if(id==='5' || id==='6') onSection('ALERTS');
        if(id==='7') { /* trigger no-safe-route demo */ }
        if(id==='8') setConnMode(m=>m==='OFFLINE'?'CONNECTED':'OFFLINE');
      }} />;
      case 'VERIFICATION': return <VerificationPanel />;
      case 'PROVENANCE': return <ProvenancePanel />;
      case 'ALERTS': return <AlertCenterPanel />;
      case 'HEALTH': return <SystemHealthPanel />;
      case 'SETTINGS':
        return (
          <div className="p-4 space-y-3">
            <div className="label-xs">Settings</div>
            <div className="panel-inset rounded-sm p-3 space-y-2">
              <div className="text-[11px] text-ink">Theme, units, data mode and offline behavior are in the rail settings popover.</div>
              <button className="btn btn-accent w-full !py-1.5 !text-[10px]" onClick={()=>onSection('MISSION')}>Back to Mission Control</button>
              <button className="btn w-full !py-1 !text-[10px]" onClick={()=>setConnMode(m=>m==='OFFLINE'?'CONNECTED':'OFFLINE')}>{connMode==='OFFLINE'?'Restore connection':'Simulate offline'}</button>
              <button className="btn w-full !py-1 !text-[10px]" onClick={()=>setPaletteOpen(true)}>Open command palette (⌘K)</button>
            </div>
          </div>
        );
      case 'ALERTS': return <AlertCenterPanel />;
      default:
        if (live) return missionOpen ? <MissionWorkspacePanel /> : <LiveEnvPanel />;
        return <AlertPanel />;
    }
  };

  // Left content — mission always, but route planner in demo shares it
  const leftContent = () => {
    if (section === 'ROUTE_PLANNER' && !live) return <MissionPanel />;
    if (live) return <MissionListPanel />;
    return <MissionPanel />;
  };

  const isModule = section && !['MISSION','ALERTS'].includes(section);

  return (
    <div className="h-full flex flex-col bg-abyss">
      <TopBar />
      <OfflineIndicator mode={connMode} lastSync={lastSync} />
      <div className="dss-stage flex-1 flex min-h-0 relative">
        <main className="dss-map-stage flex-1 relative min-w-0">
          <AntarcticMap />
          <MapLegend />
          <InspectorDrawer />
          {/* Module label overlay when a focused module is active */}
          {isModule && (
            <div className="absolute top-3 left-3 z-10 pointer-events-none">
              <span className="badge" style={{background:'var(--color-panel)', borderColor:'var(--color-line)', color:'var(--color-ink-dim)'}}>{section.replace('_',' ')}</span>
            </div>
          )}
        </main>

        <NavRail section={section} onSection={onSection} onCommand={()=>setPaletteOpen(true)} />

        <aside className={`dss-left-rail flex-none transition-[width] duration-200 overflow-hidden hidden md:block ${leftOpen ? 'w-[320px]' : 'w-0'}`} aria-label="Mission panel">
          <div className="w-[320px] h-full border-l border-line bg-panel">{leftOpen && leftContent()}</div>
        </aside>
        <button className="dss-rail-tab absolute top-1/2 z-20 -translate-y-1/2 h-14 w-[16px] items-center justify-center text-[9px] hidden md:flex" style={{ left: leftOpen ? 380 : 62, borderRadius:'0 4px 4px 0' }} onClick={()=>setLeftOpen(!leftOpen)} aria-label={leftOpen?'Collapse':'Expand'}>{leftOpen?'◂':'▸'}</button>

        <button className="dss-rail-tab absolute top-1/2 z-20 -translate-y-1/2 h-14 w-[16px] items-center justify-center text-[9px] hidden lg:flex" style={{ right: rightOpen ? 336 : 0, borderRadius:'4px 0 0 4px' }} onClick={()=>setRightOpen(!rightOpen)} aria-label={rightOpen?'Collapse':'Expand'}>{rightOpen?'▸':'◂'}</button>
        <aside className={`dss-right-rail flex-none transition-[width] duration-200 overflow-hidden hidden lg:block ${rightOpen ? 'w-[336px]' : 'w-0'}`} aria-label="Module panel">
          <div className="w-[336px] h-full border-l border-line bg-panel">{rightOpen && rightContent()}</div>
        </aside>

        {!live && section==='MISSION' && <RouteComparison />}
        {!live && section==='ROUTE_PLANNER' && <RouteComparison />}
        {live && ms.wizardOpen && <MissionWizard />}
        {missionOpen && <RouteReviewAlert />}
      </div>
      {!live && <TimeBar />}
      {missionOpen && <MissionTimeBar />}
      <CommandPalette open={paletteOpen} onClose={()=>setPaletteOpen(false)} commands={commands} />
      {/* Decision boundary — persistent, subtle but always visible */}
      <div className="h-[22px] flex items-center justify-center gap-2 bg-panel border-t border-line text-[9px] text-ink-faint flex-none">
        <span className="h-1.5 w-1.5 rounded-full bg-risk-MEDIUM" />
        DECISION SUPPORT — Human operator retains final navigation authority. No autonomous control. Estimates are unvalidated where labelled.
        <span className="hidden sm:inline font-data">·</span>
        <span className="hidden sm:inline">MODE: {connMode} · {live?'LIVE':'SIMULATED'} · {new Date().toISOString().slice(11,16)}Z</span>
      </div>
    </div>
  );
}

function BootScreen(){
  const [step,setStep]=useState(0);
  const steps = ['Initializing geospatial environment…','Loading mission data…','Checking environmental products…','Checking vessel profile…','Checking route engine…','Checking cached offline products…','SYSTEM READY'];
  useEffect(()=>{ const id=setInterval(()=>setStep(s=>Math.min(s+1, steps.length-1)), 300); return ()=>clearInterval(id); }, []);
  return (
    <div className="h-full flex flex-col items-center justify-center bg-abyss text-ice">
      <svg width={48} height={48} viewBox="0 0 24 24" className="mb-4"><circle cx={12} cy={12} r={10} fill="none" stroke="var(--color-accent)" strokeWidth={1.4} /><path d="M12 5 L17 15 L7 15 Z" fill="none" stroke="var(--color-ice)" strokeWidth={1.5} /></svg>
      <div className="font-data font-bold text-[18px] tracking-[0.22em]">POLARIS-X</div>
      <div className="text-[9px] tracking-[0.18em] text-ink-faint mt-1">ANTARCTIC NAVIGATION DSS</div>
      <div className="mt-6 font-data text-[11px] text-accent">{steps[step]}</div>
      <div className="mt-3 w-[220px] h-1 bg-line rounded-full overflow-hidden"><div className="h-full bg-accent transition-all duration-300" style={{width:`${((step+1)/steps.length)*100}%`}} /></div>
      <div className="mt-2 text-[9px] text-ink-faint">AI-Enabled Sea-Ice, Iceberg Trajectory & Navigation Decision Support · NCPOR</div>
    </div>
  );
}

export default function App(){
  return (
    <StoreProvider>
      <EnvProvider>
        <MissionProvider>
          <VesselProvider>
            <AuthProvider>
              <CommandCenter />
            </AuthProvider>
          </VesselProvider>
        </MissionProvider>
      </EnvProvider>
    </StoreProvider>
  );
}
