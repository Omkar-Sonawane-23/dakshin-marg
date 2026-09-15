import consoleOpen from '../../../docs/video/stills/01_open.jpg';
import liveMode from '../../../docs/video/stills/02_live_mode.jpg';
import consoleTour from '../../../docs/video/stills/03_console_tour.jpg';
import seaIce from '../../../docs/video/stills/04_sea_ice_forecast.jpg';
import risk from '../../../docs/video/stills/05_risk_pc7.jpg';
import routes from '../../../docs/video/stills/06_route_planner.jpg';
import missionWizard from '../../../docs/video/stills/07_mission_wizard.jpg';
import reviewRequired from '../../../docs/video/stills/08_review_required.jpg';
import replanning from '../../../docs/video/stills/09_drill_conflict.jpg';
import newRoute from '../../../docs/video/stills/10_new_route_active.jpg';
import demoVideo from '../../../docs/video/Dakshin-Marg-demo-720p.mp4';

export type ShowcaseShot = {
  src: string;
  title: string;
  eyebrow: string;
  description: string;
};

export const showcaseShots: ShowcaseShot[] = [
  {
    src: consoleOpen,
    title: 'Mission command center',
    eyebrow: '01 / SYSTEM',
    description: 'A map-dominant operational view for mission, vessel, layers and route context.',
  },
  {
    src: seaIce,
    title: 'Sea-ice intelligence',
    eyebrow: '02 / OBSERVE + PREDICT',
    description: 'Observation and short-horizon forecast products with freshness and uncertainty visible.',
  },
  {
    src: risk,
    title: 'Risk & navigability',
    eyebrow: '03 / ASSESS',
    description: 'POLARIS, icing and iceberg contributors are surfaced as an explainable risk picture.',
  },
  {
    src: routes,
    title: 'Route alternatives',
    eyebrow: '04 / OPTIMIZE',
    description: 'Severity-ceiling profiles let an operator compare route trade-offs without hidden weights.',
  },
  {
    src: replanning,
    title: 'Re-planning drill',
    eyebrow: '05 / DECIDE',
    description: 'A changed condition triggers review, comparison and an explicit human decision step.',
  },
  {
    src: newRoute,
    title: 'New route active',
    eyebrow: '06 / HUMAN-IN-THE-LOOP',
    description: 'The accepted recommendation is visible as a decision record, never autonomous control.',
  },
];

export const supportingShots = {
  liveMode,
  consoleTour,
  missionWizard,
  reviewRequired,
};

export { demoVideo };
