/**
 * Client for the LIVE environmental data API.
 * All URLs are relative (/env/...) — the dev server proxies them to the
 * Python FastAPI service, so this works identically behind the preview host.
 */

import type {
  BergSituationData, EnvEnvelope, EnvHealth, EnvSourcesCatalog, IcebergData,
  ReplanDrillData, RiskCatalog, RouteOptimizationData, RouteRiskData,
  SeaIceData, SeaIceForecast, SpatialRiskData, TrackerValidation, WeatherData,
} from '../types/env';

export class EnvApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new EnvApiError(
      'ENV_API_UNREACHABLE',
      'Environmental data service unreachable. Live layers unavailable — the demo scenario remains fully functional.',
    );
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = `Environmental data request failed (${res.status}).`;
    try {
      const body = await res.json();
      if (body?.detail?.code) { code = body.detail.code; message = body.detail.message; }
    } catch { /* keep defaults */ }
    throw new EnvApiError(code, message);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new EnvApiError('ENV_API_UNREACHABLE', 'Service unreachable.');
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = `Request failed (${res.status}).`;
    try {
      const body = await res.json();
      if (body?.detail?.code) { code = body.detail.code; message = body.detail.message; }
    } catch { /* keep defaults */ }
    throw new EnvApiError(code, message);
  }
  return res.json() as Promise<T>;
}

export const fetchEnvHealth = () => getJson<EnvHealth>('/env/health');
export const fetchEnvSources = () => getJson<EnvSourcesCatalog>('/env/sources');

export const fetchSeaIceTimes = () =>
  getJson<{ times: string[]; provenance: string }>('/env/sea-ice/times');

export const fetchSeaIce = (time?: string, bbox?: string) => {
  const q = new URLSearchParams();
  if (time) q.set('time', time);
  if (bbox) q.set('bbox', bbox);
  return getJson<EnvEnvelope<SeaIceData>>(`/env/sea-ice?${q}`);
};

export const fetchIcebergs = (bbox?: string) => {
  const q = new URLSearchParams();
  if (bbox) q.set('bbox', bbox);
  return getJson<EnvEnvelope<IcebergData>>(`/env/icebergs?${q}`);
};

export const fetchSeaIceForecast = (horizonH: 24 | 48 | 72, bbox?: string) => {
  const q = new URLSearchParams({ horizon_h: String(horizonH) });
  if (bbox) q.set('bbox', bbox);
  return getJson<SeaIceForecast>(`/ml/sea-ice/forecast?${q}`);
};

// ── iceberg tracking & trajectory — served by the Node application API ──
// (relative /api URLs; dev server proxies to :8200)

export const fetchBergSituation = () =>
  getJson<EnvEnvelope<BergSituationData>>('/api/icebergs/situation');

export const fetchTrackerValidation = () =>
  getJson<TrackerValidation>('/api/icebergs/tracks/validation');

// ── navigation risk engine — served by the Node application API ────────

export const fetchRiskCatalog = () =>
  getJson<RiskCatalog>('/api/risk/catalog');

export const fetchSpatialRisk = (iceClass: string, horizonH: number) =>
  getJson<EnvEnvelope<SpatialRiskData>>(
    `/api/risk/spatial?ice_class=${encodeURIComponent(iceClass)}&horizon_h=${horizonH}`,
  );

// ── route optimization — served by the Node application API ────────────

export const fetchReplanDrill = () =>
  getJson<EnvEnvelope<ReplanDrillData>>('/api/routes/replan-drill');

export const optimizeRoutes = (req: {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  iceClass: string;
  cruiseSpeedKn?: number;
  horizonH?: number;
}) =>
  postJson<EnvEnvelope<RouteOptimizationData>>('/api/routes/optimize', req);

export const fetchWeatherTimes = () =>
  getJson<{ times: string[]; nowHour: string }>('/env/weather/times');

export const fetchWeather = (time?: string, bbox?: string) => {
  const q = new URLSearchParams();
  if (time) q.set('time', time);
  if (bbox) q.set('bbox', bbox);
  return getJson<EnvEnvelope<WeatherData>>(`/env/weather?${q}`);
};

// ── route risk (mission simulation checks) — Node application API ─────

export const postRouteRisk = (req: {
  waypoints: { lat: number; lon: number }[];
  iceClass: string;
  horizonH?: number;
  /** ISO mission time — resolved server-side to real dataset valid times. */
  missionTime?: string;
}) => postJson<EnvEnvelope<RouteRiskData>>('/api/risk/route', req);
