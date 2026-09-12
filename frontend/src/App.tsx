import { useState } from 'react';
import { StoreProvider, useStore } from './state/store';
import { EnvProvider, useEnv } from './state/envStore';
import { MissionProvider, useMission } from './state/missionStore';
import TopBar from './components/TopBar';
import MissionPanel from './components/MissionPanel';
import AlertPanel from './components/AlertPanel';
import LiveEnvPanel from './components/LiveEnvPanel';
import MissionListPanel from './components/mission/MissionListPanel';
import MissionWorkspacePanel from './components/mission/MissionWorkspacePanel';
import MissionWizard from './components/mission/MissionWizard';
import MissionTimeBar from './components/mission/MissionTimeBar';
import RouteReviewAlert from './components/mission/RouteReviewAlert';
import TimeBar from './components/TimeBar';
import AntarcticMap from './components/map/AntarcticMap';
import InspectorDrawer from './components/InspectorDrawer';
import RouteComparison from './components/RouteComparison';
import MapLegend from './components/MapLegend';
import { LoadingScreen, ErrorScreen } from './components/ScreenStates';

function CommandCenter() {
  const { loading, error, retry, snapshot } = useStore();
  const env = useEnv();
  const ms = useMission();
  const live = env.mode === 'LIVE';
  const missionOpen = live && ms.mission !== null;
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen code={error.code} message={error.message} onRetry={retry} />;
  if (!snapshot) return <LoadingScreen />;

  return (
    <div className="h-full flex flex-col bg-abyss">
      <TopBar />
      <div className="dss-stage flex-1 flex min-h-0 relative">
        {/* left rail — mission */}
        <aside
          className={`dss-left-rail flex-none border-r border-line bg-panel/80 backdrop-blur transition-[width] duration-200 overflow-hidden hidden md:block ${
            leftOpen ? 'w-[302px]' : 'w-0'
          }`}
          aria-label="Mission panel"
        >
          <div className="w-[302px] h-full">{leftOpen && (live ? <MissionListPanel /> : <MissionPanel />)}</div>
        </aside>
        <button
          className="absolute top-1/2 z-20 -translate-y-1/2 h-14 w-[16px] items-center justify-center bg-panel border border-line text-ink-faint hover:text-accent hover:border-accent-dim transition-colors text-[9px] hidden md:flex"
          style={{ left: leftOpen ? 302 : 0, borderRadius: '0 4px 4px 0' }}
          onClick={() => setLeftOpen(!leftOpen)}
          aria-label={leftOpen ? 'Collapse mission panel' : 'Expand mission panel'}
        >
          {leftOpen ? '◂' : '▸'}
        </button>

        {/* map — the centerpiece */}
        <main className="dss-map-stage flex-1 relative min-w-0">
          <AntarcticMap />
          <MapLegend />
          <InspectorDrawer />
        </main>

        {/* right rail — layers + alerts */}
        <button
          className="absolute top-1/2 z-20 -translate-y-1/2 h-14 w-[16px] items-center justify-center bg-panel border border-line text-ink-faint hover:text-accent hover:border-accent-dim transition-colors text-[9px] hidden lg:flex"
          style={{ right: rightOpen ? 302 : 0, borderRadius: '4px 0 0 4px' }}
          onClick={() => setRightOpen(!rightOpen)}
          aria-label={rightOpen ? 'Collapse alert panel' : 'Expand alert panel'}
        >
          {rightOpen ? '▸' : '◂'}
        </button>
        <aside
          className={`dss-right-rail flex-none border-l border-line bg-panel/80 backdrop-blur transition-[width] duration-200 overflow-hidden hidden lg:block ${
            rightOpen ? 'w-[302px]' : 'w-0'
          }`}
          aria-label="Layers and alerts panel"
        >
          <div className="w-[302px] h-full">
            {rightOpen && (live ? (missionOpen ? <MissionWorkspacePanel /> : <LiveEnvPanel />) : <AlertPanel />)}
          </div>
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
