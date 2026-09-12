/* eslint-disable react-refresh/only-export-components */
/**
 * Mission store — mission lifecycle, time-based voyage simulation and
 * dynamic re-planning.
 *
 * HONESTY RULES:
 *  · The vessel moves ONLY along accepted route geometry at the optimizer's
 *    own time model (mean route speed = distance / estimated time — both
 *    computed by the Python optimizer from POLARIS speed limits). There is
 *    no decorative animation.
 *  · Environmental conditions shown at a sim time come from the datasets
 *    valid at that time (resolver-selected). Past the data window the
 *    simulation PAUSES and says so — stale data is never shown silently.
 *  · Re-planning produces CANDIDATE routes for operator review. Nothing is
 *    applied automatically (decision support only).
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import type { EnvEnvelope, RouteOptimizationData, OptRoute, WeatherData, RiskSeverity } from '../types/env';
import type {
  EnvAvailability, Mission, MissionEvent, MissionState, MissionSummary,
} from '../types/mission';
import {
  MissionApiError, createMission as apiCreate, deleteMission as apiDelete,
  fetchAvailability, fetchMission, generateMissionRoutes, listMissions,
  patchMission, replanMission,
} from '../api/missionClient';
import { fetchWeather, postRouteRisk } from '../api/envClient';
import { pointAlong, polylineLengthNm } from '../lib/geo';

export const SIM_SPEEDS = [1, 10, 50, 100] as const;
export const SIM_STEPS_H = [0.25, 1, 3, 6, 12] as const;
const RISK_CHECK_INTERVAL_H = 3;   // sim-hours between automatic route-risk checks
const SEV_ORDER: RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const sevIdx = (s: string) => SEV_ORDER.indexOf(s as RiskSeverity);
const isoUtc = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface SimState {
  simTimeMs: number;
  elapsedH: number;                 // since departure
  distanceCoveredNm: number;        // total, across legs
  vesselPos: { lat: number; lon: number };
  headingDeg: number;
  playing: boolean;
  speed: (typeof SIM_SPEEDS)[number];
  completed: boolean;
  /** Sim paused because the data window ended (message shown, never silent). */
  dataEdge: string | null;
}

export interface ReviewAlert {
  primaryFactor: string;
  detail: string;
  simTime: string;
  riskDoc: unknown;                 // full /ml/risk/route data for the drawer
  worstAt: { lat?: number; lon?: number; atKm: number } | null;
}

/** Route-conditions snapshot re-assessed as sim time advances. */
export interface LiveRouteRisk {
  atSimTime: string;
  overallSeverity: RiskSeverity;
  worstDetail: string;
  exposurePct: Record<string, number>;
  bergEncounters: { id: string; severity: RiskSeverity; closestKm: number; atRouteKm: number }[];
  seaIceValid: string;
  weatherHour: string;
}

interface MissionStoreShape {
  // mission list / persistence
  missions: MissionSummary[];
  listLoading: boolean;
  listError: string | null;
  persistence: string | null;
  refreshList: () => void;
  deleteMissionById: (id: string) => Promise<void>;

  // data availability (drives all date validation UI)
  availability: EnvAvailability | null;

  // creation wizard
  wizardOpen: boolean;
  setWizardOpen: (v: boolean) => void;
  pickTarget: 'origin' | 'destination' | null;
  setPickTarget: (t: 'origin' | 'destination' | null) => void;
  pickedPoint: { target: 'origin' | 'destination'; lat: number; lon: number } | null;
  reportPickedPoint: (lat: number, lon: number) => void;
  clearPickedPoint: () => void;
  createMission: (body: Parameters<typeof apiCreate>[0]) => Promise<Mission>;

  // active mission
  mission: Mission | null;
  missionLoading: boolean;
  missionError: string | null;
  openMission: (id: string) => void;
  closeMission: () => void;

  // routes
  generateRoutes: () => Promise<void>;
  routesLoading: boolean;
  routesError: string | null;
  acceptRoute: (profile: string) => Promise<void>;
  activeRoute: OptRoute | null;
  selectedProfile: string | null;              // inspection selection
  setSelectedProfile: (p: string | null) => void;

  // simulation
  sim: SimState | null;
  play: () => void;
  pause: () => void;
  stepBy: (h: number) => void;
  resetSim: () => void;
  setSpeed: (s: (typeof SIM_SPEEDS)[number]) => void;

  // live conditions at the vessel / on the route
  vesselWeather: { windSpeedKn: number; windDirDeg: number; tempC: number; hour: string } | null;
  liveRouteRisk: LiveRouteRisk | null;
  riskCheckRunning: boolean;

  // review / re-planning
  reviewAlert: ReviewAlert | null;
  continueCurrentRoute: () => void;
  runReplan: () => Promise<void>;
  replanLoading: boolean;
  replanError: string | null;
  candidatePlan: EnvEnvelope<RouteOptimizationData> | null;
  acceptCandidate: (profile: string) => Promise<void>;
  dismissCandidate: () => void;

  // events (local mirror, persisted in batches)
  events: MissionEvent[];

  exportReport: () => void;

  /** Map focus request (e.g. "View affected segment"). */
  focusRequest: { lat: number; lon: number; ts: number } | null;
  requestFocus: (lat: number, lon: number) => void;
}

const Ctx = createContext<MissionStoreShape | null>(null);

export function MissionProvider({ children }: { children: ReactNode }) {
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<string | null>(null);
  const [availability, setAvailability] = useState<EnvAvailability | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [pickTarget, setPickTarget] = useState<'origin' | 'destination' | null>(null);
  const [pickedPoint, setPickedPoint] = useState<MissionStoreShape['pickedPoint']>(null);

  const [mission, setMission] = useState<Mission | null>(null);
  const [missionLoading, setMissionLoading] = useState(false);
  const [missionError, setMissionError] = useState<string | null>(null);

  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);

  const [sim, setSim] = useState<SimState | null>(null);
  const [vesselWeather, setVesselWeather] = useState<MissionStoreShape['vesselWeather']>(null);
  const [liveRouteRisk, setLiveRouteRisk] = useState<LiveRouteRisk | null>(null);
  const [riskCheckRunning, setRiskCheckRunning] = useState(false);

  const [reviewAlert, setReviewAlert] = useState<ReviewAlert | null>(null);
  const [replanLoading, setReplanLoading] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  const [candidatePlan, setCandidatePlan] = useState<EnvEnvelope<RouteOptimizationData> | null>(null);

  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [focusRequest, setFocusRequest] = useState<{ lat: number; lon: number; ts: number } | null>(null);
  const requestFocus = useCallback((lat: number, lon: number) => {
    setFocusRequest({ lat, lon, ts: Date.now() });
  }, []);

  // Current navigation leg (changes when a replan candidate is accepted).
  const legRef = useRef<{
    waypoints: { lat: number; lon: number }[];
    lengthNm: number;
    effSpeedKn: number;             // optimizer distance / optimizer time
    startSimMs: number;
    startDistanceNm: number;        // covered before this leg started
  } | null>(null);

  const lastRiskCheckRef = useRef<number>(0);   // simMs of last route-risk check
  const seaIceValidRef = useRef<string | null>(null);
  const weatherCacheRef = useRef<Map<string, WeatherData>>(new Map());
  const pendingEventsRef = useRef<MissionEvent[]>([]);
  const missionRef = useRef<Mission | null>(null);
  missionRef.current = mission;
  const simRef = useRef<SimState | null>(null);
  simRef.current = sim;

  // ── bootstrap ────────────────────────────────────────────────────────
  const refreshList = useCallback(() => {
    setListLoading(true);
    setListError(null);
    listMissions()
      .then((r) => { setMissions(r.missions); setPersistence(r.persistence); })
      .catch((e: MissionApiError) => setListError(e.message))
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    refreshList();
    fetchAvailability().then(setAvailability).catch(() => setAvailability(null));
  }, [refreshList]);

  // ── event log helpers ────────────────────────────────────────────────
  const logEvent = useCallback((type: string, message: string, simTime?: string | null) => {
    const ev: MissionEvent = {
      at: isoUtc(Date.now()), simTime: simTime ?? null, type, message,
    };
    setEvents((prev) => [...prev, ev]);
    pendingEventsRef.current.push(ev);
  }, []);

  const flushToServer = useCallback(async (extra?: Parameters<typeof patchMission>[1]) => {
    const m = missionRef.current;
    if (!m) return;
    const body: Parameters<typeof patchMission>[1] = { ...(extra ?? {}) };
    if (pendingEventsRef.current.length) {
      body.appendEvents = pendingEventsRef.current.splice(0);
    }
    const s = simRef.current;
    if (s) {
      body.simulation = {
        simTime: isoUtc(s.simTimeMs),
        elapsedH: Math.round(s.elapsedH * 100) / 100,
        distanceCoveredNm: Math.round(s.distanceCoveredNm * 10) / 10,
        vesselPos: s.vesselPos,
        completed: s.completed,
        legStartSimTime: legRef.current ? isoUtc(legRef.current.startSimMs) : undefined,
        legStartDistanceNm: legRef.current
          ? Math.round(legRef.current.startDistanceNm * 10) / 10 : undefined,
      };
    }
    if (Object.keys(body).length === 0) return;
    try {
      const r = await patchMission(m.id, body);
      setMission((cur) => (cur && cur.id === r.mission.id ? r.mission : cur));
    } catch { /* persistence retry on next flush; UI state remains source of truth */ }
  }, []);

  const setStateAndFlush = useCallback((state: MissionState) => {
    setMission((m) => (m ? { ...m, state } : m));
    void flushToServer({ state, simTime: simRef.current ? isoUtc(simRef.current.simTimeMs) : undefined });
  }, [flushToServer]);

  // ── wizard ───────────────────────────────────────────────────────────
  const reportPickedPoint = useCallback((lat: number, lon: number) => {
    setPickedPoint((_) => (pickTarget ? { target: pickTarget, lat, lon } : null));
    setPickTarget(null);
  }, [pickTarget]);

  const createMission = useCallback(async (body: Parameters<typeof apiCreate>[0]) => {
    const r = await apiCreate(body);
    refreshList();
    return r.mission;
  }, [refreshList]);

  const deleteMissionById = useCallback(async (id: string) => {
    await apiDelete(id);
    refreshList();
  }, [refreshList]);

  // ── open / close ─────────────────────────────────────────────────────
  const hydrateSim = useCallback((m: Mission) => {
    // Rebuild the sim + leg from the persisted checkpoint (save/resume).
    const plan = m.routePlan?.data;
    const active = plan?.routes.find((r) => r.profile === m.activeProfile && r.status === 'OK');
    if (!active?.waypoints) { setSim(null); legRef.current = null; return; }
    const departMs = Date.parse(m.departureUtc);
    if (!m.simulation) {
      // Route accepted but no checkpoint was ever persisted (e.g. the browser
      // closed right after acceptance) — arm the voyage at departure.
      if (m.state === 'IN_PROGRESS' || m.state === 'PAUSED' ||
          m.state === 'ROUTE_REVIEW_REQUIRED' || m.state === 'RE_PLANNING') {
        const len = active.distanceNm ?? polylineLengthNm(active.waypoints);
        legRef.current = {
          waypoints: active.waypoints, lengthNm: len,
          effSpeedKn: active.estTimeH ? len / active.estTimeH : (m.vessel.cruiseSpeedKn || 10),
          startSimMs: departMs, startDistanceNm: 0,
        };
        setSim({
          simTimeMs: departMs, elapsedH: 0, distanceCoveredNm: 0,
          vesselPos: { lat: m.origin.lat, lon: m.origin.lon },
          headingDeg: pointAlong(active.waypoints, 0.01).headingDeg,
          playing: false, speed: 50, completed: false, dataEdge: null,
        });
      } else { setSim(null); legRef.current = null; }
      return;
    }
    const s = m.simulation;
    const simMs = Date.parse(s.simTime);
    // Leg reconstruction from the persisted checkpoint. The active route's
    // waypoints ARE the current leg geometry (replans store a fresh plan
    // whose request origin is the leg start).
    const legWpts = active.waypoints;
    const legLen = active.distanceNm ?? polylineLengthNm(legWpts);
    const effSpeed = active.estTimeH ? legLen / active.estTimeH : (m.vessel.cruiseSpeedKn || 10);
    const legStartDist = s.legStartDistanceNm ?? 0;
    const legStartMs = s.legStartSimTime ? Date.parse(s.legStartSimTime) : departMs;
    legRef.current = {
      waypoints: legWpts, lengthNm: legLen, effSpeedKn: effSpeed,
      startSimMs: legStartMs,
      startDistanceNm: legStartDist,
    };
    const along = pointAlong(legWpts, Math.min(legLen, Math.max(0, s.distanceCoveredNm - legStartDist)));
    setSim({
      simTimeMs: simMs,
      elapsedH: (simMs - departMs) / 3600_000,
      distanceCoveredNm: s.distanceCoveredNm,
      vesselPos: s.vesselPos ?? along.pos,
      headingDeg: along.headingDeg,
      playing: false,
      speed: 50,
      completed: s.completed,
      dataEdge: null,
    });
  }, []);

  const openMission = useCallback((id: string) => {
    setMissionLoading(true);
    setMissionError(null);
    fetchMission(id)
      .then((r) => {
        setMission(r.mission);
        setEvents(r.mission.events);
        setSelectedProfile(r.mission.activeProfile ?? null);
        setReviewAlert(null);
        setCandidatePlan(null);
        setLiveRouteRisk(null);
        setVesselWeather(null);
        lastRiskCheckRef.current = 0;
        seaIceValidRef.current = null;
        hydrateSim(r.mission);
      })
      .catch((e: MissionApiError) => setMissionError(e.message))
      .finally(() => setMissionLoading(false));
  }, [hydrateSim]);

  const closeMission = useCallback(() => {
    void flushToServer();
    setMission(null);
    setSim(null);
    setEvents([]);
    setReviewAlert(null);
    setCandidatePlan(null);
    setLiveRouteRisk(null);
    legRef.current = null;
    refreshList();
  }, [flushToServer, refreshList]);

  // ── route generation & acceptance ────────────────────────────────────
  const generateRoutes = useCallback(async () => {
    const m = missionRef.current;
    if (!m) return;
    setRoutesLoading(true);
    setRoutesError(null);
    try {
      const r = await generateMissionRoutes(m.id);
      setMission(r.mission);
      setEvents(r.mission.events);
    } catch (e) {
      setRoutesError((e as MissionApiError).message);
    } finally {
      setRoutesLoading(false);
    }
  }, []);

  const startLeg = useCallback((route: OptRoute, startSimMs: number, startDistanceNm: number,
                                startPos: { lat: number; lon: number }) => {
    const wpts = route.waypoints!;
    const len = route.distanceNm ?? polylineLengthNm(wpts);
    const eff = route.estTimeH ? len / route.estTimeH : 10;
    legRef.current = {
      waypoints: wpts, lengthNm: len, effSpeedKn: eff,
      startSimMs, startDistanceNm,
    };
    const departMs = Date.parse(missionRef.current!.departureUtc);
    setSim({
      simTimeMs: startSimMs,
      elapsedH: (startSimMs - departMs) / 3600_000,
      distanceCoveredNm: startDistanceNm,
      vesselPos: startPos,
      headingDeg: pointAlong(wpts, 0.01).headingDeg,
      playing: false,
      speed: 50,
      completed: false,
      dataEdge: null,
    });
  }, []);

  const acceptRoute = useCallback(async (profile: string) => {
    const m = missionRef.current;
    const route = m?.routePlan?.data.routes.find((r) => r.profile === profile && r.status === 'OK');
    if (!m || !route?.waypoints) return;
    setMission({ ...m, activeProfile: profile, state: 'IN_PROGRESS' });
    setSelectedProfile(profile);
    logEvent('ROUTE_ACCEPTED',
      `Operator accepted ${profile} (${route.distanceNm} nm, est ${route.estTimeH} h). ` +
      `Voyage simulation armed at departure ${m.departureUtc}.`, m.departureUtc);
    startLeg(route, Date.parse(m.departureUtc), 0, { lat: m.origin.lat, lon: m.origin.lon });
    lastRiskCheckRef.current = Date.parse(m.departureUtc);
    await flushToServer({ state: 'IN_PROGRESS', activeProfile: profile });
  }, [logEvent, startLeg, flushToServer]);

  const activeRoute = useMemo(() => {
    if (!mission?.routePlan || !mission.activeProfile) return null;
    return mission.routePlan.data.routes.find(
      (r) => r.profile === mission.activeProfile && r.status === 'OK') ?? null;
  }, [mission]);

  // ── simulation advance ───────────────────────────────────────────────
  const windowEndMs = useMemo(
    () => (availability ? Date.parse(availability.window.end) : Number.POSITIVE_INFINITY),
    [availability]);

  const advanceTo = useCallback((targetMs: number) => {
    const leg = legRef.current;
    const m = missionRef.current;
    if (!leg || !m) return;
    setSim((prev) => {
      if (!prev || prev.completed) return prev;
      let simMs = targetMs;
      let dataEdge: string | null = null;
      if (simMs > windowEndMs) {
        simMs = windowEndMs;
        dataEdge = `Forecast unavailable beyond ${isoUtc(windowEndMs)} — simulation paused at the end of the real data window.`;
      }
      const legElapsedH = Math.max(0, (simMs - leg.startSimMs) / 3600_000);
      const legDist = Math.min(leg.lengthNm, leg.effSpeedKn * legElapsedH);
      const along = pointAlong(leg.waypoints, legDist);
      const completed = legDist >= leg.lengthNm - 0.05;
      const departMs = Date.parse(m.departureUtc);
      return {
        ...prev,
        simTimeMs: simMs,
        elapsedH: (simMs - departMs) / 3600_000,
        distanceCoveredNm: leg.startDistanceNm + legDist,
        vesselPos: along.pos,
        headingDeg: along.headingDeg,
        completed,
        playing: dataEdge || completed ? false : prev.playing,
        dataEdge,
      };
    });
  }, [windowEndMs]);

  // playback ticker: every 250 ms real → speed × 0.25 s sim
  useEffect(() => {
    if (!sim?.playing) return;
    const t = window.setInterval(() => {
      const s = simRef.current;
      if (!s) return;
      advanceTo(s.simTimeMs + s.speed * 250);
    }, 250);
    return () => window.clearInterval(t);
  }, [sim?.playing, advanceTo]);

  // periodic checkpoint: persist the sim state every 10 s while a mission is
  // open and under way, so browser loss never costs more than a few sim-hours.
  useEffect(() => {
    if (!mission || !sim || sim.completed) return;
    const t = window.setInterval(() => { void flushToServer(); }, 10_000);
    return () => window.clearInterval(t);
  }, [mission?.id, sim?.completed, flushToServer]); // eslint-disable-line react-hooks/exhaustive-deps

  // completion side-effect (event + state), fired once
  const completedRef = useRef(false);
  useEffect(() => {
    if (!sim || !mission) { completedRef.current = false; return; }
    if (sim.completed && !completedRef.current && mission.state === 'IN_PROGRESS') {
      completedRef.current = true;
      logEvent('MISSION_COMPLETED',
        `Vessel arrived at destination after ${sim.elapsedH.toFixed(1)} h / ` +
        `${sim.distanceCoveredNm.toFixed(0)} nm (simulated voyage).`,
        isoUtc(sim.simTimeMs));
      setStateAndFlush('COMPLETED');
    }
    if (!sim.completed) completedRef.current = false;
  }, [sim, mission, logEvent, setStateAndFlush]);

  // data-edge pause event, fired once per edge hit
  const edgeRef = useRef(false);
  useEffect(() => {
    if (!sim?.dataEdge) { edgeRef.current = false; return; }
    if (!edgeRef.current) {
      edgeRef.current = true;
      logEvent('DATA_WINDOW_END', sim.dataEdge, isoUtc(sim.simTimeMs));
    }
  }, [sim?.dataEdge, sim, logEvent]);

  const play = useCallback(() => {
    setSim((s) => (s && !s.completed ? { ...s, playing: true, dataEdge: null } : s));
    const m = missionRef.current;
    if (m && (m.state === 'PAUSED' || m.state === 'IN_PROGRESS')) {
      if (m.state === 'PAUSED') setStateAndFlush('IN_PROGRESS');
    }
  }, [setStateAndFlush]);

  const pause = useCallback(() => {
    setSim((s) => (s ? { ...s, playing: false } : s));
    const m = missionRef.current;
    if (m?.state === 'IN_PROGRESS') {
      setMission({ ...m, state: 'PAUSED' });
      void flushToServer({ state: 'PAUSED' });
    } else {
      void flushToServer();
    }
  }, [flushToServer]);

  const stepBy = useCallback((h: number) => {
    const s = simRef.current;
    if (!s) return;
    if (h > 0) advanceTo(s.simTimeMs + h * 3600_000);
    else {
      // step back: recompute from scratch (position is a pure function of time)
      const target = Math.max(legRef.current?.startSimMs ?? s.simTimeMs, s.simTimeMs + h * 3600_000);
      advanceTo(target);
    }
  }, [advanceTo]);

  const resetSim = useCallback(() => {
    const m = missionRef.current;
    const route = activeRoute;
    if (!m || !route?.waypoints) return;
    // Reset is only meaningful for the ORIGINAL leg (no accepted replan yet).
    startLeg(route, Date.parse(m.departureUtc), 0, { lat: m.origin.lat, lon: m.origin.lon });
    lastRiskCheckRef.current = Date.parse(m.departureUtc);
    setReviewAlert(null);
    setLiveRouteRisk(null);
    logEvent('SIM_RESET', 'Simulation reset to departure.', m.departureUtc);
    if (m.state === 'COMPLETED' || m.state === 'PAUSED' || m.state === 'ROUTE_REVIEW_REQUIRED') {
      setStateAndFlush('IN_PROGRESS');
    }
  }, [activeRoute, startLeg, logEvent, setStateAndFlush]);

  const setSpeed = useCallback((sp: (typeof SIM_SPEEDS)[number]) => {
    setSim((s) => (s ? { ...s, speed: sp } : s));
  }, []);

  // ── conditions at sim time ───────────────────────────────────────────
  // Weather: exact hour from the real hourly series (cached per hour).
  useEffect(() => {
    if (!sim) { setVesselWeather(null); return; }
    const hour = new Date(sim.simTimeMs).toISOString().slice(0, 13) + ':00';
    const cached = weatherCacheRef.current.get(hour);
    const apply = (wd: WeatherData) => {
      let best = null as MissionStoreShape['vesselWeather'];
      let bestD = Infinity;
      for (const c of wd.cells) {
        const d = (c.lat - sim.vesselPos.lat) ** 2
          + ((c.lon - sim.vesselPos.lon) * Math.cos(sim.vesselPos.lat * Math.PI / 180)) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { windSpeedKn: c.windSpeedKn, windDirDeg: c.windDirDeg, tempC: c.tempC, hour: wd.hour };
        }
      }
      setVesselWeather(best);
    };
    if (cached) { apply(cached); return; }
    let stale = false;
    fetchWeather(hour, '40,-72,100,-55')
      .then((r) => {
        weatherCacheRef.current.set(hour, r.data);
        if (!stale) apply(r.data);
      })
      .catch(() => { if (!stale) setVesselWeather(null); });
    return () => { stale = true; };
  }, [sim?.simTimeMs !== undefined ? Math.floor((sim?.simTimeMs ?? 0) / 3600_000) : null, sim?.vesselPos.lat, sim?.vesselPos.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sea-ice validity transitions → forecast-update events (computed locally
  // from the availability catalog; same nearest-valid-time rule as the
  // server resolver).
  useEffect(() => {
    if (!sim || !availability) return;
    const cands: { t: number; label: string }[] = [
      ...availability.seaIce.observationValidTimes.map((t) => ({
        t: Date.parse(t), label: `observation ${t.slice(0, 10)}` })),
      ...availability.seaIce.forecastValidTimes.map((t, i) => ({
        t: Date.parse(t),
        label: `+${availability.seaIce.forecastHorizonsH[i]} h forecast (valid ${t.slice(0, 16)}Z)` })),
    ];
    let best = cands[0];
    for (const c of cands) {
      if (Math.abs(c.t - sim.simTimeMs) < Math.abs(best.t - sim.simTimeMs)) best = c;
    }
    if (seaIceValidRef.current !== null && seaIceValidRef.current !== best.label) {
      logEvent('ENV_UPDATE', `Sea-ice field now resolves to ${best.label}.`, isoUtc(sim.simTimeMs));
    }
    seaIceValidRef.current = best.label;
  }, [sim?.simTimeMs, availability, logEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── automatic route-risk checks (trigger detection) ─────────────────
  useEffect(() => {
    const m = missionRef.current;
    const s = sim;
    const leg = legRef.current;
    if (!m || !s || !leg || s.completed) return;
    if (m.state !== 'IN_PROGRESS' && m.state !== 'PAUSED') return;
    if (reviewAlert || candidatePlan) return;
    if (s.simTimeMs - lastRiskCheckRef.current < RISK_CHECK_INTERVAL_H * 3600_000) return;
    lastRiskCheckRef.current = s.simTimeMs;

    // remaining geometry = vessel position + waypoints not yet passed
    const covered = s.distanceCoveredNm - leg.startDistanceNm;
    const remaining: { lat: number; lon: number }[] = [s.vesselPos];
    let acc = 0;
    for (let i = 1; i < leg.waypoints.length; i++) {
      acc += polylineLengthNm([leg.waypoints[i - 1], leg.waypoints[i]]);
      if (acc > covered) remaining.push(leg.waypoints[i]);
    }
    if (remaining.length < 2) return;

    const simTimeIso = isoUtc(s.simTimeMs);
    setRiskCheckRunning(true);
    postRouteRisk({
      waypoints: remaining, iceClass: m.vessel.iceClass, missionTime: simTimeIso,
    })
      .then((env) => {
        const d = env.data;
        setLiveRouteRisk({
          atSimTime: simTimeIso,
          overallSeverity: d.overall.severity,
          worstDetail: d.overall.worst.detail,
          exposurePct: d.exposurePctByContributor.combined,
          bergEncounters: d.bergEncounters,
          seaIceValid: d.inputs.seaIce.validTime,
          weatherHour: d.inputs.weather.validHour,
        });
        // TRIGGERS (all computed from the real risk engine output):
        const maxSev = m.vessel.maxAcceptableSeverity;
        const triggers: string[] = [];
        if (sevIdx(d.overall.severity) > sevIdx(maxSev)) {
          triggers.push(
            `Remaining-route severity ${d.overall.severity} exceeds the vessel's ` +
            `declared maximum acceptable severity (${maxSev}).`);
        }
        const hotBergs = d.bergEncounters.filter((b) => sevIdx(b.severity) >= sevIdx('HIGH'));
        if (hotBergs.length) {
          triggers.push(
            `Iceberg hazard-zone encounter ahead: ` +
            hotBergs.map((b) => `${b.id} (${b.severity}, closest ${b.closestKm} km, at route km ${b.atRouteKm})`).join('; ') + '.');
        }
        if (triggers.length) {
          setReviewAlert({
            primaryFactor: triggers[0],
            detail: [d.overall.worst.detail, ...triggers.slice(1)].filter(Boolean).join(' '),
            simTime: simTimeIso,
            riskDoc: d,
            worstAt: d.overall.worst
              ? { lat: d.overall.worst.lat, lon: d.overall.worst.lon, atKm: d.overall.worst.atKm }
              : null,
          });
          setSim((prev) => (prev ? { ...prev, playing: false } : prev));
          logEvent('RISK_ALERT',
            `ROUTE REVIEW REQUIRED — ${triggers[0]}`, simTimeIso);
          setMission((cur) => (cur ? { ...cur, state: 'ROUTE_REVIEW_REQUIRED' } : cur));
          void flushToServer({ state: 'ROUTE_REVIEW_REQUIRED' });
        }
      })
      .catch(() => { /* risk check unavailable — retried at the next interval */ })
      .finally(() => setRiskCheckRunning(false));
  }, [sim, reviewAlert, candidatePlan, logEvent, flushToServer]);

  // ── review / re-planning ─────────────────────────────────────────────
  const continueCurrentRoute = useCallback(() => {
    const alert = reviewAlert;
    setReviewAlert(null);
    setCandidatePlan(null);
    if (alert) {
      logEvent('REVIEW_DISMISSED',
        'Operator reviewed the alert and chose to CONTINUE on the current route.',
        alert.simTime);
    }
    setStateAndFlush('IN_PROGRESS');
  }, [reviewAlert, logEvent, setStateAndFlush]);

  const runReplan = useCallback(async () => {
    const m = missionRef.current;
    const s = simRef.current;
    if (!m || !s) return;
    setReplanLoading(true);
    setReplanError(null);
    setMission({ ...m, state: 'RE_PLANNING' });
    const simTimeIso = isoUtc(s.simTimeMs);
    try {
      const r = await replanMission(m.id, s.vesselPos, simTimeIso);
      setCandidatePlan(r.candidatePlan);
      setEvents(r.mission.events);
      logEvent('REPLAN_READY',
        `Candidate routes computed from ${s.vesselPos.lat.toFixed(2)}°, ` +
        `${s.vesselPos.lon.toFixed(2)}° at ${simTimeIso}. Awaiting operator decision.`,
        simTimeIso);
      void flushToServer({ state: 'RE_PLANNING' });
    } catch (e) {
      setReplanError((e as MissionApiError).message);
      setMission((cur) => (cur ? { ...cur, state: 'ROUTE_REVIEW_REQUIRED' } : cur));
    } finally {
      setReplanLoading(false);
    }
  }, [logEvent, flushToServer]);

  const acceptCandidate = useCallback(async (profile: string) => {
    const m = missionRef.current;
    const s = simRef.current;
    const cand = candidatePlan;
    const route = cand?.data.routes.find((r) => r.profile === profile && r.status === 'OK');
    if (!m || !s || !cand || !route?.waypoints) return;
    const simTimeIso = isoUtc(s.simTimeMs);
    setMission({
      ...m, routePlan: cand, activeProfile: profile, state: 'IN_PROGRESS',
    });
    setSelectedProfile(profile);
    setCandidatePlan(null);
    setReviewAlert(null);
    startLeg(route, s.simTimeMs, s.distanceCoveredNm, s.vesselPos);
    lastRiskCheckRef.current = s.simTimeMs;
    setLiveRouteRisk(null);
    logEvent('ROUTE_CHANGED',
      `Operator accepted replacement route ${profile} from current position ` +
      `(${route.distanceNm} nm remaining, est ${route.estTimeH} h).`, simTimeIso);
    await flushToServer({
      state: 'IN_PROGRESS', activeProfile: profile, routePlan: cand,
    });
  }, [candidatePlan, startLeg, logEvent, flushToServer]);

  const dismissCandidate = useCallback(() => {
    setCandidatePlan(null);
    logEvent('REPLAN_REJECTED',
      'Operator rejected the candidate routes — continuing on the current route.',
      simRef.current ? isoUtc(simRef.current.simTimeMs) : null);
    setStateAndFlush(reviewAlert ? 'ROUTE_REVIEW_REQUIRED' : 'IN_PROGRESS');
  }, [logEvent, setStateAndFlush, reviewAlert]);

  // ── report export ────────────────────────────────────────────────────
  const exportReport = useCallback(() => {
    const m = missionRef.current;
    if (!m) return;
    const s = simRef.current;
    const route = m.routePlan?.data.routes.find((r) => r.profile === m.activeProfile);
    const lines: string[] = [
      `# Mission report — ${m.name} (${m.id})`, '',
      `Generated ${isoUtc(Date.now())} by POLARIS-X (decision support; simulated voyage).`, '',
      `## Mission`,
      `- State: ${m.state}`,
      `- Vessel: ${m.vessel.name} (${m.vessel.type}), ice class ${m.vessel.iceClass}, cruise ${m.vessel.cruiseSpeedKn} kn`,
      `- Max acceptable severity: ${m.vessel.maxAcceptableSeverity}`,
      `- Origin: ${m.origin.label ?? ''} ${m.origin.lat.toFixed(3)}°, ${m.origin.lon.toFixed(3)}°`,
      `- Destination: ${m.destination.label ?? ''} ${m.destination.lat.toFixed(3)}°, ${m.destination.lon.toFixed(3)}°`,
      `- Departure (UTC): ${m.departureUtc}`, '',
      `## Active route`,
      route && route.status === 'OK'
        ? `- ${route.profile}: ${route.distanceNm} nm, est ${route.estTimeH} h, overall severity ${route.risk?.overallSeverity}`
        : '- No route accepted.',
      `- Fuel: NOT COMPUTED (no validated fuel-consumption model — labelled estimate policy).`, '',
      `## Simulation`,
      s ? `- Sim time ${isoUtc(s.simTimeMs)} · elapsed ${s.elapsedH.toFixed(1)} h · ${s.distanceCoveredNm.toFixed(0)} nm covered · ${s.completed ? 'ARRIVED' : 'under way'}`
        : '- Not started.', '',
      `## Event log`,
      ...events.map((e) => `- [${e.at}]${e.simTime ? ` (sim ${e.simTime})` : ''} ${e.type}: ${e.message}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${m.id}-report.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    logEvent('REPORT_EXPORTED', 'Mission report exported (Markdown).',
      s ? isoUtc(s.simTimeMs) : null);
  }, [events, logEvent]);

  const value = useMemo<MissionStoreShape>(() => ({
    missions, listLoading, listError, persistence, refreshList, deleteMissionById,
    availability,
    wizardOpen, setWizardOpen, pickTarget, setPickTarget,
    pickedPoint, reportPickedPoint, clearPickedPoint: () => setPickedPoint(null),
    createMission,
    mission, missionLoading, missionError, openMission, closeMission,
    generateRoutes, routesLoading, routesError, acceptRoute, activeRoute,
    selectedProfile, setSelectedProfile,
    sim, play, pause, stepBy, resetSim, setSpeed,
    vesselWeather, liveRouteRisk, riskCheckRunning,
    reviewAlert, continueCurrentRoute, runReplan, replanLoading, replanError,
    candidatePlan, acceptCandidate, dismissCandidate,
    events, exportReport,
    focusRequest, requestFocus,
  }), [missions, listLoading, listError, persistence, refreshList, deleteMissionById,
       availability, wizardOpen, pickTarget, pickedPoint, reportPickedPoint,
       createMission, mission, missionLoading, missionError, openMission,
       closeMission, generateRoutes, routesLoading, routesError, acceptRoute,
       activeRoute, selectedProfile, sim, play, pause, stepBy, resetSim,
       setSpeed, vesselWeather, liveRouteRisk, riskCheckRunning, reviewAlert,
       continueCurrentRoute, runReplan, replanLoading, replanError,
       candidatePlan, acceptCandidate, dismissCandidate, events, exportReport,
       focusRequest, requestFocus]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMission(): MissionStoreShape {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMission outside MissionProvider');
  return v;
}
