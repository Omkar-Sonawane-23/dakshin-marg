import { useCallback, useState } from 'react';
import { StoreProvider, useStore } from './state/store';
import { EnvProvider, useEnv } from './state/envStore';
import { MissionProvider, useMission } from './state/missionStore';
import TopBar from './components/TopBar';
import MissionPanel from './components/MissionPanel';
import AlertPanel from './components/AlertPanel';
import LiveEnvPanel from './components/LiveEnvPanel';
import EnvLayerControl from './components/EnvLayerControl';
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

function CommandCenter() {
  const { loading, error, retry, snapshot } = useStore();
  const env = useEnv();
  const ms = useMission();
  const live = env.mode === 'LIVE';
  const missionOpen = live && ms.mission !== null;

  /**
   * `section` is a view switch over panels that already existed. `null` means
   * "chart only". On first load the default reproduces the previous layout:
   * both rails open with their mode-appropriate content.
   */
  const [section, setSection] = useState<Section | null>('MISSION');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const rightIsExplicit = section === 'CONDITIONS' || section === 'ALERTS'
    || section === 'LAYERS' || section === 'VESSEL';

  const onSection = useCallback((s: Section | null) => {
    setSection(s);
    if (s === null) { setLeftOpen(false); setRightOpen(false); return; }
    if (s === 'MISSION') { setLeftOpen(true); setRightOpen(true); return; }
    // every other section drives the right rail only
    setLeftOpen(false);
    setRightOpen(true);
  }, []);

  // Switching data mode restores the default two-rail layout, as before.
  // React's "adjust state when a value changes" pattern: keep the previous
  // value in state and update during render. No effect (which would add a
  // second commit) and no ref read during render.
  const [seenMode, setSeenMode] = useState(env.mode);
  if (seenMode !== env.mode) {
    setSeenMode(env.mode);
    setSection('MISSION');   // also clears the derived rightIsExplicit
    setLeftOpen(true);
    setRightOpen(true);
  }

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen code={error.code} message={error.message} onRetry={retry} />;
  if (!snapshot) return <LoadingScreen />;

  /** Right-rail content — every branch is an existing panel. */
  const rightContent = () => {
    if (section === 'ALERTS') return <AlertPanel />;
    if (section === 'LAYERS') return live ? (
      <div className="h-full overflow-y-auto">
        <div className="px-3 pt-3 pb-1.5 label-xs">Map Layers</div>
        <EnvLayerControl />
      </div>
    ) : <AlertPanel />;
    if (section === 'VESSEL' && missionOpen) return <MissionWorkspacePanel />;
    if (live) return missionOpen ? <MissionWorkspacePanel /> : <LiveEnvPanel />;
    return <AlertPanel />;
  };

  return (
    <div className="h-full flex flex-col bg-abyss">
      <TopBar />
      <div className="dss-stage flex-1 flex min-h-0 relative">
        {/* the 3D environment is the hero: it fills the stage */}
        <main className="dss-map-stage flex-1 relative min-w-0">
          <AntarcticMap />
          <MapLegend />
          <InspectorDrawer />
        </main>

        {/* slim anchored navigation rail */}
        <NavRail section={rightIsExplicit || section === 'MISSION' ? section : null} onSection={onSection} />

        {/* left rail — mission */}
        <aside
          className={`dss-left-rail flex-none transition-[width] duration-200 overflow-hidden hidden md:block ${
            leftOpen ? 'w-[302px]' : 'w-0'
          }`}
          aria-label="Mission panel"
        >
          <div className="w-[302px] h-full">{leftOpen && (live ? <MissionListPanel /> : <MissionPanel />)}</div>
        </aside>
        <button
          className="dss-rail-tab absolute top-1/2 z-20 -translate-y-1/2 h-14 w-[16px] items-center justify-center text-[9px] hidden md:flex"
          style={{ left: leftOpen ? 366 : 64, borderRadius: '0 4px 4px 0' }}
          onClick={() => setLeftOpen(!leftOpen)}
          aria-label={leftOpen ? 'Collapse mission panel' : 'Expand mission panel'}
        >
          {leftOpen ? '◂' : '▸'}
        </button>

        {/* right rail — layers + alerts */}
        <button
          className="dss-rail-tab absolute top-1/2 z-20 -translate-y-1/2 h-14 w-[16px] items-center justify-center text-[9px] hidden lg:flex"
          style={{ right: rightOpen ? 302 : 0, borderRadius: '4px 0 0 4px' }}
          onClick={() => setRightOpen(!rightOpen)}
          aria-label={rightOpen ? 'Collapse alert panel' : 'Expand alert panel'}
        >
          {rightOpen ? '▸' : '◂'}
        </button>
        <aside
          className={`dss-right-rail flex-none transition-[width] duration-200 overflow-hidden hidden lg:block ${
            rightOpen ? 'w-[302px]' : 'w-0'
          }`}
          aria-label="Layers and alerts panel"
        >
          <div className="w-[302px] h-full">{rightOpen && rightContent()}</div>
        </aside>

        {!live && <RouteComparison />}
        {live && ms.wizardOpen && <MissionWizard />}
        {missionOpen && <RouteReviewAlert />}
      </div>
      {!live && <TimeBar />}
      {missionOpen && <MissionTimeBar />}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <EnvProvider>
        <MissionProvider>
          <CommandCenter />
        </MissionProvider>
      </EnvProvider>
    </StoreProvider>
  );
}
