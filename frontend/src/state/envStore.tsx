/* eslint-disable react-refresh/only-export-components */
/**
 * State for the LIVE environmental data layers (real datasets served by the
 * Python /env API). Entirely separate from the demo scenario store so real
 * and simulated data can never blend silently.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  BergSituationData, EnvEnvelope, IcebergData, ReplanDrillData,
  RouteOptimizationData, SeaIceData, SeaIceForecast, SpatialRiskData, WeatherData,
} from '../types/env';
import {
  EnvApiError, fetchBergSituation, fetchIcebergs, fetchReplanDrill, fetchSeaIce,
  fetchSeaIceForecast, fetchSeaIceTimes, fetchSpatialRisk, fetchWeather,
  fetchWeatherTimes, optimizeRoutes,
} from '../api/envClient';

export const FORECAST_HORIZONS = [24, 48, 72] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];

export type DataMode = 'DEMO' | 'LIVE';

/** Mission-corridor bbox used for geographic filtering on every request. */
const AOI_BBOX = '40,-72,100,-55';

interface EnvStore {
  mode: DataMode;
  setMode: (m: DataMode) => void;

  loading: boolean;
  error: { code: string; message: string } | null;
  retry: () => void;

  seaIce: EnvEnvelope<SeaIceData> | null;
  seaIceTimes: string[];         // newest → oldest (ISO)
  seaIceIndex: number;           // index into seaIceTimes
  setSeaIceIndex: (i: number) => void;
  seaIceLoading: boolean;

  icebergs: EnvEnvelope<IcebergData> | null;

  /** Sea-ice FORECAST (ML pipeline). null horizon = showing observations. */
  forecastHorizon: ForecastHorizon | null;
  setForecastHorizon: (h: ForecastHorizon | null) => void;
  forecast: SeaIceForecast | null;
  forecastLoading: boolean;
  forecastError: { code: string; message: string } | null;
  showSigma: boolean;
  setShowSigma: (v: boolean) => void;

  weather: EnvEnvelope<WeatherData> | null;
  weatherTimes: string[];        // chronological ISO hours
  weatherNowHour: string;
  weatherIndex: number;
  setWeatherIndex: (i: number) => void;
  weatherLoading: boolean;

  /** Berg tracking + trajectory prediction (Node application API). */
  bergSituation: EnvEnvelope<BergSituationData> | null;
  bergSituationLoading: boolean;
  bergSituationError: { code: string; message: string } | null;
  /** Selected berg id for track/trajectory display; null = show all. */
  focusBergId: string | null;
  setFocusBergId: (id: string | null) => void;
  /** Whether predicted trajectories + corridors are drawn on the map. */
  showBergPredictions: boolean;
  setShowBergPredictions: (v: boolean) => void;

  /** Navigation risk engine (POLARIS + Overland + berg zones). */
  riskEnabled: boolean;
  setRiskEnabled: (v: boolean) => void;
  riskIceClass: string;
  setRiskIceClass: (c: string) => void;
  risk: EnvEnvelope<SpatialRiskData> | null;
  riskLoading: boolean;
  riskError: { code: string; message: string } | null;

  /** Route optimization (severity-ceiling shortest paths). */
  routePlan: EnvEnvelope<RouteOptimizationData> | null;
  routePlanLoading: boolean;
  routePlanError: { code: string; message: string } | null;
  runRoutePlan: () => void;
  clearRoutePlan: () => void;
  /** Selected profile for detail display; null = compare all. */
  selectedRouteProfile: string | null;
  setSelectedRouteProfile: (p: string | null) => void;

  /** Dynamic re-planning drill (deterministic SIMULATION). */
  drill: EnvEnvelope<ReplanDrillData> | null;
  drillLoading: boolean;
  drillError: { code: string; message: string } | null;
  drillStage: number;            // -1 = not running; 0..n-1 = active stage
  drillAccepted: boolean;        // operator accepted the new route (terminal)
  startDrill: () => void;
  advanceDrill: () => void;      // operator advances the timeline
  acceptDrillRoute: () => void;  // operator decision at DECISION_PENDING
  exitDrill: () => void;
}

const Ctx = createContext<EnvStore | null>(null);

export function EnvProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DataMode>('DEMO');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<EnvStore['error']>(null);
  const [loaded, setLoaded] = useState(false);

  const [seaIce, setSeaIce] = useState<EnvEnvelope<SeaIceData> | null>(null);
  const [seaIceTimes, setSeaIceTimes] = useState<string[]>([]);
  const [seaIceIndex, setSeaIceIndexRaw] = useState(0);
  const [seaIceLoading, setSeaIceLoading] = useState(false);

  const [icebergs, setIcebergs] = useState<EnvEnvelope<IcebergData> | null>(null);

  const [forecastHorizon, setForecastHorizonRaw] = useState<ForecastHorizon | null>(null);
  const [forecast, setForecast] = useState<SeaIceForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<EnvStore['forecastError']>(null);
  const [showSigma, setShowSigma] = useState(false);
  const forecastCache = useState(() => new Map<number, SeaIceForecast>())[0];

  const [riskEnabled, setRiskEnabled] = useState(false);
  const [riskIceClass, setRiskIceClass] = useState('PC5');
  const [risk, setRisk] = useState<EnvEnvelope<SpatialRiskData> | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState<EnvStore['riskError']>(null);
  const riskCache = useState(() => new Map<string, EnvEnvelope<SpatialRiskData>>())[0];

  const [routePlan, setRoutePlan] = useState<EnvEnvelope<RouteOptimizationData> | null>(null);
  const [routePlanLoading, setRoutePlanLoading] = useState(false);
  const [routePlanError, setRoutePlanError] = useState<EnvStore['routePlanError']>(null);
  const [selectedRouteProfile, setSelectedRouteProfile] = useState<string | null>(null);

  const [drill, setDrill] = useState<EnvEnvelope<ReplanDrillData> | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<EnvStore['drillError']>(null);
  const [drillStage, setDrillStage] = useState(-1);
  const [drillAccepted, setDrillAccepted] = useState(false);

  const [bergSituation, setBergSituation] = useState<EnvEnvelope<BergSituationData> | null>(null);
  const [bergSituationLoading, setBergSituationLoading] = useState(false);
  const [bergSituationError, setBergSituationError] = useState<EnvStore['bergSituationError']>(null);
  const [focusBergId, setFocusBergId] = useState<string | null>(null);
  const [showBergPredictions, setShowBergPredictions] = useState(true);

  const [weather, setWeather] = useState<EnvEnvelope<WeatherData> | null>(null);
  const [weatherTimes, setWeatherTimes] = useState<string[]>([]);
  const [weatherNowHour, setWeatherNowHour] = useState('');
  const [weatherIndex, setWeatherIndexRaw] = useState(0);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const loadAll = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchSeaIceTimes(),
      fetchSeaIce(undefined, AOI_BBOX),
      fetchIcebergs(AOI_BBOX),
      fetchWeatherTimes(),
      fetchWeather(undefined, AOI_BBOX),
    ])
      .then(([sit, si, ib, wt, wx]) => {
        setSeaIceTimes(sit.times);
        setSeaIce(si);
        setSeaIceIndexRaw(0);
        setIcebergs(ib);
        setWeatherTimes(wt.times);
        setWeatherNowHour(wt.nowHour);
        setWeather(wx);
        setWeatherIndexRaw(wx.data.hourIndex);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (e instanceof EnvApiError) setError({ code: e.code, message: e.message });
        else setError({ code: 'UNKNOWN', message: 'Unexpected failure loading live environmental data.' });
      })
      .finally(() => setLoading(false));
  }, []);

  // fetch on first switch to LIVE
  useEffect(() => {
    if (mode === 'LIVE' && !loaded && !loading) loadAll();
  }, [mode, loaded, loading, loadAll]);

  // Risk surface follows the sea-ice view: observation (h=0) or the active
  // forecast horizon. Cached per (class, horizon).
  useEffect(() => {
    if (mode !== 'LIVE' || !riskEnabled) return;
    const h = forecastHorizon ?? 0;
    const key = `${riskIceClass}:${h}`;
    const cached = riskCache.get(key);
    if (cached) { setRisk(cached); return; }
    setRiskLoading(true);
    setRiskError(null);
    fetchSpatialRisk(riskIceClass, h)
      .then((r) => { riskCache.set(key, r); setRisk(r); })
      .catch((e: unknown) => {
        if (e instanceof EnvApiError) setRiskError({ code: e.code, message: e.message });
        else setRiskError({ code: 'UNKNOWN', message: 'Risk engine request failed unexpectedly.' });
      })
      .finally(() => setRiskLoading(false));
  }, [mode, riskEnabled, riskIceClass, forecastHorizon, riskCache]);

  // Mission corridor endpoints (same as demo scenario mission definition).
  const runRoutePlan = useCallback(() => {
    setRoutePlanLoading(true);
    setRoutePlanError(null);
    optimizeRoutes({
      origin: { lat: -57.5, lon: 60.0 },
      destination: { lat: -69.35, lon: 76.19 },
      iceClass: riskIceClass,
      cruiseSpeedKn: 12.5,
      horizonH: forecastHorizon ?? 0,
    })
      .then((r) => { setRoutePlan(r); setSelectedRouteProfile(r.data.recommendation.profile); })
      .catch((e: unknown) => {
        if (e instanceof EnvApiError) setRoutePlanError({ code: e.code, message: e.message });
        else setRoutePlanError({ code: 'UNKNOWN', message: 'Route optimization failed unexpectedly.' });
      })
      .finally(() => setRoutePlanLoading(false));
  }, [riskIceClass, forecastHorizon]);

  const clearRoutePlan = useCallback(() => {
    setRoutePlan(null);
    setSelectedRouteProfile(null);
    setRoutePlanError(null);
  }, []);

  // ── re-planning drill: precomputed deterministic timeline; the operator
  // advances stages and makes the accept decision — never auto-advanced.
  const startDrill = useCallback(() => {
    setDrillLoading(true);
    setDrillError(null);
    setDrillAccepted(false);
    fetchReplanDrill()
      .then((d) => { setDrill(d); setDrillStage(0); })
      .catch((e: unknown) => {
        if (e instanceof EnvApiError) setDrillError({ code: e.code, message: e.message });
        else setDrillError({ code: 'UNKNOWN', message: 'Drill failed to load.' });
      })
      .finally(() => setDrillLoading(false));
  }, []);

  const advanceDrill = useCallback(() => {
    setDrillStage((s) => {
      if (!drill) return s;
      return Math.min(s + 1, drill.data.stages.length - 1);
    });
  }, [drill]);

  const acceptDrillRoute = useCallback(() => setDrillAccepted(true), []);

  const exitDrill = useCallback(() => {
    setDrill(null);
    setDrillStage(-1);
    setDrillAccepted(false);
    setDrillError(null);
  }, []);

  // berg tracking/trajectory comes from the Node application API — loaded
  // separately so its failure degrades only the tracking layer, never the
  // core environmental layers.
  useEffect(() => {
    if (mode !== 'LIVE' || bergSituation || bergSituationLoading) return;
    setBergSituationLoading(true);
    setBergSituationError(null);
    fetchBergSituation()
      .then(setBergSituation)
      .catch((e: unknown) => {
        if (e instanceof EnvApiError) setBergSituationError({ code: e.code, message: e.message });
        else setBergSituationError({ code: 'UNKNOWN', message: 'Berg tracking service failed unexpectedly.' });
      })
      .finally(() => setBergSituationLoading(false));
  }, [mode, bergSituation, bergSituationLoading]);

  const setForecastHorizon = useCallback((h: ForecastHorizon | null) => {
    setForecastHorizonRaw(h);
    setForecastError(null);
    if (h === null) return;
    const cached = forecastCache.get(h);
    if (cached) { setForecast(cached); return; }
    setForecastLoading(true);
    fetchSeaIceForecast(h, AOI_BBOX)
      .then((f) => { forecastCache.set(h, f); setForecast(f); })
      .catch((e: unknown) => {
        if (e instanceof EnvApiError) setForecastError({ code: e.code, message: e.message });
        else setForecastError({ code: 'UNKNOWN', message: 'Forecast request failed unexpectedly.' });
        setForecastHorizonRaw(null);
      })
      .finally(() => setForecastLoading(false));
  }, [forecastCache]);

  const setSeaIceIndex = useCallback((i: number) => {
    setForecastHorizonRaw(null); // selecting an observation day exits forecast view
    setSeaIceIndexRaw(i);
    const t = seaIceTimes[i];
    if (!t) return;
    setSeaIceLoading(true);
    fetchSeaIce(t.slice(0, 10), AOI_BBOX)
      .then(setSeaIce)
      .catch((e: unknown) => {
        if (e instanceof EnvApiError) setError({ code: e.code, message: e.message });
      })
      .finally(() => setSeaIceLoading(false));
  }, [seaIceTimes]);

  const setWeatherIndex = useCallback((i: number) => {
    setWeatherIndexRaw(i);
    const t = weatherTimes[i];
    if (!t) return;
    setWeatherLoading(true);
    fetchWeather(t, AOI_BBOX)
      .then(setWeather)
      .catch((e: unknown) => {
        if (e instanceof EnvApiError) setError({ code: e.code, message: e.message });
      })
      .finally(() => setWeatherLoading(false));
  }, [weatherTimes]);

  const value = useMemo<EnvStore>(() => ({
    mode, setMode, loading, error, retry: loadAll,
    seaIce, seaIceTimes, seaIceIndex, setSeaIceIndex, seaIceLoading,
    icebergs,
    forecastHorizon, setForecastHorizon, forecast, forecastLoading, forecastError,
    showSigma, setShowSigma,
    weather, weatherTimes, weatherNowHour, weatherIndex, setWeatherIndex, weatherLoading,
    bergSituation, bergSituationLoading, bergSituationError,
    focusBergId, setFocusBergId, showBergPredictions, setShowBergPredictions,
    riskEnabled, setRiskEnabled, riskIceClass, setRiskIceClass,
    risk, riskLoading, riskError,
    routePlan, routePlanLoading, routePlanError, runRoutePlan, clearRoutePlan,
    selectedRouteProfile, setSelectedRouteProfile,
    drill, drillLoading, drillError, drillStage, drillAccepted,
    startDrill, advanceDrill, acceptDrillRoute, exitDrill,
  }), [mode, loading, error, loadAll, seaIce, seaIceTimes, seaIceIndex, setSeaIceIndex, seaIceLoading, icebergs, forecastHorizon, setForecastHorizon, forecast, forecastLoading, forecastError, showSigma, weather, weatherTimes, weatherNowHour, weatherIndex, setWeatherIndex, weatherLoading, bergSituation, bergSituationLoading, bergSituationError, focusBergId, showBergPredictions, riskEnabled, riskIceClass, risk, riskLoading, riskError, routePlan, routePlanLoading, routePlanError, runRoutePlan, clearRoutePlan, selectedRouteProfile, drill, drillLoading, drillError, drillStage, drillAccepted, startDrill, advanceDrill, acceptDrillRoute, exitDrill]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEnv(): EnvStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useEnv outside provider');
  return s;
}
