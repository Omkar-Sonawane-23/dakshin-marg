/**
 * Types for the LIVE environmental data API (Python service, proxied at /env).
 *
 * Provenance vocabulary — the UI must always show which one applies:
 *   REAL_OBSERVATION  measured/analysed product (NSIDC sea ice, NIC bergs)
 *   REAL_HISTORICAL   archived model analysis (past weather hours)
 *   REAL_FORECAST     numerical forecast (future weather hours)
 *   SIMULATED         demo scenario generator (never served by /env)
 */

export type EnvProvenance = 'REAL_OBSERVATION' | 'REAL_HISTORICAL' | 'REAL_FORECAST';

export interface EnvMeta {
  provenance: EnvProvenance | string;
  temporal: { kind: string; validTime?: string; nowHour?: string };
  source: { id: string; name: string; provider: string; url: string };
  quality: 'ok' | 'degraded' | 'rejected';
  warnings: string[];
  servedAt: string;
}

export interface EnvEnvelope<T> {
  data: T;
  meta: EnvMeta;
}

export interface EnvGrid {
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
  nLon: number;
  nLat: number;
  values: number[][];
  noData: number;
  units: string;
}

export interface SeaIceData {
  grid: EnvGrid;
  stats: { validCells: number; meanConcPct: number | null; maxConcPct: number | null };
}

export interface NicIceberg {
  id: string;
  lat: number;
  lon: number;
  length_nm: number | null;
  width_nm: number | null;
  area_km2: number | null;
  last_update: string | null;
}

export interface IcebergData {
  icebergs: NicIceberg[];
  count: number;
  productNote: string;
}

export interface WeatherCellLive {
  lat: number;
  lon: number;
  windSpeedKn: number;
  windDirDeg: number;
  tempC: number;
}

export interface WeatherData {
  cells: WeatherCellLive[];
  summary: { maxWindKn: number | null; meanWindKn: number | null; minTempC: number | null };
  hour: string;
  hourIndex: number;
  availableHours: number;
}

// ── sea-ice forecast (ML pipeline) ─────────────────────────────────────

export interface SeaIceForecastData {
  grid: EnvGrid;
  sigmaGrid: number[][];
  stats: { meanConcPct: number; maxConcPct: number; validCells: number };
  uncertainty: {
    meanSigmaPct: number;
    backtestMaePct: number | null;
    backtestRmsePct: number | null;
    method: string;
  };
  validation: {
    metrics: Record<string, Record<string, { maePct: number; rmsePct: number; folds: number; cellsPerFold: number }>>;
    notes: string[];
  };
  inputDates: string[];
}

export interface SeaIceForecastMeta extends EnvMeta {
  inputProvenance: string;
  model: {
    name: string;
    version: string;
    baseline: string;
    selectedBy: string;
    trainWindowDays: number;
    damping: number | null;
  };
  temporal: { kind: string; baseTime: string; validTime: string; horizonH: number };
}

export interface SeaIceForecast {
  data: SeaIceForecastData;
  meta: SeaIceForecastMeta;
}

// ── iceberg tracking & trajectory (via Node application API /api) ─────

export interface BergTrackSummary {
  id: string;
  nObs: number;
  first: string;
  last: string;
  lastLat: number;
  lastLon: number;
  meanSpeedKmD: number;
  bearingDeg: number;
  maxGapDays: number;
  sensors: string[];
  recentPath: { t: string; lat: number; lon: number }[];
}

export interface BergTrajectoryPoint {
  horizonD: number;
  lat: number;
  lon: number;
  corridorP50Km: number | null;
  corridorP90Km: number | null;
}

export interface BergPrediction {
  id: string;
  lastObs: { t: string; lat: number; lon: number };
  velocityKmD: number;
  regime: 'MOVING' | 'GROUNDED_OR_SLOW';
  trajectory: BergTrajectoryPoint[];
  staleDays: number;
}

export interface BergSituation {
  id: string;
  track: BergTrackSummary | null;
  prediction: BergPrediction | null;
  usnicCurrent: { lat: number; lon: number; length_nm?: number } | null;
}

export interface BergSituationData {
  situations: BergSituation[];
  count: number;
  joinNote: string;
}

export interface TrackerValidation {
  windowDays: number;
  observations: number;
  trueBergs: number;
  rebuiltTracks: number;
  meanPurity: number;
  minPurity: number | null;
  fragmentedBergs: number;
  note: string;
}

// ── navigation risk engine (POLARIS + Overland + empirical berg zones) ─

export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskZone {
  id: string;
  lat: number;
  lon: number;
  lengthNm: number | null;
  positionDate: string | null;
  positionAgeDays: number;
  regime: 'MOVING' | 'GROUNDED_OR_UNTRACKED';
  coreRadiusKm: number;
  p50RadiusKm: number;
  p90RadiusKm: number;
  quantileHorizonD: number;
  tracked: boolean;
}

export interface SpatialRiskData {
  engine: { name: string; version: string };
  overall: {
    severity: RiskSeverity;
    extentPct: Record<RiskSeverity, number>;
    validCells: number;
  };
  grid: {
    lon0: number; lat0: number; dLon: number; dLat: number;
    nLon: number; nLat: number;
    severity: number[][];        // -1 nodata else index into severityScale
    flags: number[][];           // bit 1 ice, 2 berg, 4 icing, 8 sigma-sensitive
    severityScale: RiskSeverity[];
  };
  contributors: {
    seaIce: {
      method: string; iceClass: string; assumedIceType: string;
      worstRio: number; worstCategory: string; severity: RiskSeverity;
      pctElevated: number; pctSpecialConsideration: number;
      sensitivity: {
        thinnerType: { type: string; worstRio: number };
        thickerType: { type: string; worstRio: number };
      };
      sigmaSensitiveCells: number | null;
    };
    icebergs: {
      method: string; zones: RiskZone[]; severity: RiskSeverity; zoneCount: number;
    };
    icing: {
      method: string; maxPpr: number; class: string; severity: RiskSeverity;
      validHour: string;
    };
  };
  worstCells: {
    lat: number; lon: number; severity: RiskSeverity; rio: number;
    concPct: number; bergZone: string | null; icingClass: string | null;
  }[];
  explanations: string[];
  assumptions: string[];
  inputs: Record<string, unknown>;
  warnings: string[];
  executedAt: string;
}

export interface RiskCatalog {
  iceClasses: string[];
  horizons: number[];
  severityScale: RiskSeverity[];
  methodology: Record<string, string>;
}

// ── route optimization (severity-ceiling shortest paths) ──────────────

export interface OptRouteRisk {
  overallSeverity: RiskSeverity;
  worst: { severity: RiskSeverity; atKm: number; lat?: number; lon?: number; detail: string };
  exposurePct: Record<RiskSeverity, number>;
  exposureByContributor: Record<string, Record<RiskSeverity, number>>;
  bergEncounters: { id: string; severity: RiskSeverity; closestKm: number; atRouteKm: number }[];
  explanations: string[];
}

export interface OptRoute {
  profile: 'DIRECT' | 'BALANCED' | 'CONSERVATIVE';
  label: string;
  severityCeiling: RiskSeverity;
  excludes: string;
  status: 'OK' | 'INFEASIBLE';
  reason?: string;                 // when INFEASIBLE
  recommended: boolean;
  waypoints?: { lat: number; lon: number }[];
  distanceNm?: number;
  distanceKm?: number;
  estTimeH?: number;
  timeModel?: {
    cruiseSpeedKn: number;
    elevatedSpeedKn: number;
    elevatedSpeedSource: string;
    kmAtElevatedSpeed: number;
  };
  fuelEstimate: null;
  fuelNote?: string;
  notes?: string[];
  risk?: OptRouteRisk;
}

/** POST /ml/risk/route response data — dense risk assessment of a polyline. */
export interface RouteRiskData {
  engine: { name: string; version: string };
  route: { waypoints: { lat: number; lon: number }[]; lengthKm: number; samples: number };
  overall: {
    severity: RiskSeverity;
    worst: { severity: RiskSeverity; atKm: number; lat?: number; lon?: number; detail: string };
  };
  exposurePctByContributor: Record<string, Record<RiskSeverity, number>>;
  bergEncounters: {
    id: string; severity: RiskSeverity; closestKm: number; atRouteKm: number;
    zoneP90Km?: number; positionAgeDays?: number;
  }[];
  profile: unknown[];
  explanations: string[];
  assumptions: string[];
  inputs: {
    seaIce: { kind: string; validTime: string; inputProvenance?: string };
    weather: { validHour: string };
    horizonH: number;
    iceClass: string;
  };
  warnings: string[];
  executedAt: string;
}

export interface RouteOptimizationData {
  optimizer: { name: string; version: string; method: string };
  request: {
    origin: { lat: number; lon: number };
    destination: { lat: number; lon: number };
    iceClass: string;
    cruiseSpeedKn: number;
    horizonH: number;
  };
  riskSurface?: {
    engine: { name: string; version: string };
    seaIce: { kind: string; validTime: string; inputProvenance?: string; model?: string };
    weatherHour: string;
  };
  routes: OptRoute[];
  recommendation: { profile: string | null; reason: string; rule: string };
  assumptions: string[];
  warnings: string[];
  executedAt: string;
}

// ── dynamic re-planning drill (deterministic SIMULATION) ──────────────

export interface DrillStage {
  id: 'MISSION_START' | 'ROUTE_ACCEPTED' | 'UNDERWAY' | 'BERG_DEVIATION'
    | 'CONFLICT_DETECTED' | 'REPLAN' | 'DECISION_PENDING';
  simTime: string;
  title: string;
  narrative: string;
  data: {
    plan?: RouteOptimizationData;
    acceptedProfile?: string;
    acceptedRoute?: DrillRouteSummary;
    vesselPosition?: { lat: number; lon: number };
    coveredNm?: number;
    remainingWaypoints?: { lat: number; lon: number }[];
    bergId?: string;
    before?: { lat: number; lon: number; regime: string };
    after?: { lat: number; lon: number; regime: string };
    zone?: { lat: number; lon: number; coreRadiusKm: number; p50RadiusKm: number; p90RadiusKm: number };
    simulated?: boolean;
    note?: string;
    riskBefore?: { overallSeverity: RiskSeverity; exposurePct: Record<RiskSeverity, number> };
    riskAfter?: {
      overallSeverity: RiskSeverity;
      exposurePct: Record<RiskSeverity, number>;
      bergEncounters: { id: string; severity: RiskSeverity; closestKm: number; atRouteKm: number }[];
    };
    alert?: DrillAlert;
    comparison?: DrillComparison;
    whyChanged?: string[];
    proposedProfile?: string;
    requiresOperatorAction?: boolean;
  };
}

export interface DrillRouteSummary {
  profile: string;
  distanceNm: number;
  estTimeH: number;
  overallSeverity: RiskSeverity;
  exposurePct: Record<RiskSeverity, number>;
  bergEncounters: string[];
}

export interface DrillAlert {
  id: string;
  severity: RiskSeverity;
  kind: string;
  title: string;
  body: string;
  simTime: string;
  requiresOperatorAction: boolean;
}

export interface DrillComparison {
  oldRoute: {
    acceptedAt: string;
    profile: string;
    remainingFrom: { lat: number; lon: number };
    remainingWaypoints: { lat: number; lon: number }[];
    riskBeforeDeviation: { overallSeverity: RiskSeverity; exposurePct: Record<RiskSeverity, number> };
    riskAfterDeviation: {
      overallSeverity: RiskSeverity;
      exposurePct: Record<RiskSeverity, number>;
      bergEncounters: { id: string; severity: RiskSeverity; closestKm: number; atRouteKm: number }[];
    };
  };
  newRoute: DrillRouteSummary | null;
  delta: { distanceNm: number | null; note: string };
}

export interface ReplanDrillData {
  drill: {
    name: string; version: string; simulated: true;
    simulatedFacts: string[]; realFacts: string; deterministic: true;
  };
  scenario: {
    origin: { lat: number; lon: number };
    destination: { lat: number; lon: number };
    iceClass: string; cruiseSpeedKn: number; advanceHours: number;
  };
  stages: DrillStage[];
  warnings: string[];
  executedAt: string;
}

export interface EnvHealth {
  status: string;
  datasets: {
    seaice: { days: number; latest: string | null };
    icebergs: { total: number; inAOI: number } | null;
    weather: { hours: number | null; nowHour: string | null };
  };
}

export interface EnvSourcesCatalog {
  sources: {
    id: string; name: string; provider: string; url: string;
    provenance: string; cadence: string; crs: string; license: string; notes: string;
  }[];
  ingestion: Record<string, unknown>;
}
