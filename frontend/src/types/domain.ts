/**
 * Dakshin Marg domain types — the typed contract the UI is built against.
 * These mirror docs/api-contracts.md; the mock API layer implements them
 * today, and the real Node API will implement the same shapes later.
 *
 * ALL data flowing through these types in the current build is DEMO /
 * SIMULATED data and is labelled as such via `DataProvenance`.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type DataProvenance = 'SIMULATED' | 'DEMO DATA' | 'SAMPLE DATA';

export interface GeoPoint {
  lon: number;
  lat: number;
}

/** Mandatory metadata carried by every scientific/ML result. */
export interface ResultMeta {
  model: { name: string; version: string };
  executedAt: string; // ISO UTC
  status: 'ok' | 'degraded' | 'failed';
  warnings: string[];
  provenance: DataProvenance;
}

// ── Vessel ─────────────────────────────────────────────────────────────

export interface Vessel {
  id: string;
  name: string;
  callsign: string;
  type: 'RESEARCH' | 'SUPPLY' | 'ICEBREAKER';
  iceClass: string; // e.g. "PC 5"
  cruiseSpeedKn: number;
  maxIceConcentrationPct: number; // operational limit
  draftM: number;
  provenance: DataProvenance;
}

export interface VesselState {
  vesselId: string;
  position: GeoPoint;
  headingDeg: number;
  speedKn: number;
  timeOffsetH: number; // hours since scenario start
}

// ── Mission ────────────────────────────────────────────────────────────

export type MissionStatus = 'PLANNING' | 'ACTIVE' | 'REROUTE_PROPOSED' | 'COMPLETED';

export interface Mission {
  id: string;
  code: string; // e.g. "NCPOR-EXP-43"
  name: string;
  status: MissionStatus;
  vesselId: string;
  origin: { name: string; position: GeoPoint };
  destination: { name: string; position: GeoPoint };
  departureUtc: string; // ISO — scenario T+0
  riskPreference: 'BALANCED' | 'CONSERVATIVE' | 'FASTEST';
  activeRouteId: string;
  provenance: DataProvenance;
}

// ── Sea ice ────────────────────────────────────────────────────────────

/** Regular lon/lat grid of sea-ice concentration (0–100 %). */
export interface SeaIceField {
  meta: ResultMeta;
  timeOffsetH: number;
  grid: {
    lon0: number;
    lat0: number; // grid origin (south-west corner)
    dLon: number;
    dLat: number;
    nLon: number;
    nLat: number;
    /** concentration % row-major [lat][lon], 0–100 */
    values: number[][];
  };
  /** mean forecast uncertainty (± % concentration) at this horizon */
  uncertaintyPct: number;
}

// ── Icebergs ───────────────────────────────────────────────────────────

export type IcebergSizeClass = 'GROWLER' | 'BERGY BIT' | 'SMALL' | 'MEDIUM' | 'LARGE' | 'VERY LARGE';

export interface IcebergObservation {
  timeOffsetH: number; // when observed, relative to scenario start
  position: GeoPoint;
  source: string; // e.g. "SAR scene (simulated)"
}

export interface TrajectoryPoint {
  timeOffsetH: number;
  position: GeoPoint;
  /** 1-sigma positional uncertainty radius, nautical miles */
  uncertaintyNm: number;
}

export interface IcebergTrajectory {
  meta: ResultMeta;
  points: TrajectoryPoint[];
  horizonH: number;
  confidence: number; // 0–1
}

export interface Iceberg {
  id: string; // e.g. "BRG-0042"
  sizeClass: IcebergSizeClass;
  lengthM: number;
  observations: IcebergObservation[]; // history, oldest→newest
  driftSpeedKn: number;
  driftBearingDeg: number;
  detectionConfidence: number; // 0–1
  trajectory: IcebergTrajectory;
  /** distance from predicted corridor to active route, nm (recomputed per time step) */
  routeThreatLevel: RiskLevel;
  provenance: DataProvenance;
}

// ── Weather ────────────────────────────────────────────────────────────

export interface WeatherCell {
  position: GeoPoint;
  windSpeedKn: number;
  windDirDeg: number; // direction wind blows FROM
  waveHeightM: number;
  airTempC: number;
}

export interface WeatherField {
  meta: ResultMeta;
  timeOffsetH: number;
  cells: WeatherCell[];
  summary: { maxWindKn: number; maxWaveM: number; minTempC: number };
}

// ── Risk ───────────────────────────────────────────────────────────────

export interface RiskFactor {
  key: 'seaIce' | 'icebergs' | 'weather' | 'uncertainty';
  label: string;
  level: RiskLevel;
  score: number; // 0–100
  weight: number; // documented weight in overall formula
  detail: string; // machine-generated explanation from actual values
}

export interface RiskAssessment {
  meta: ResultMeta;
  timeOffsetH: number;
  routeId: string;
  overall: RiskLevel;
  overallScore: number; // 0–100
  factors: RiskFactor[];
  /** regularly-spaced samples of risk score along the route, 0–100 */
  alongRoute: { distNm: number; score: number }[];
}

/** Coarse spatial risk surface for the map heat layer. */
export interface RiskSurface {
  meta: ResultMeta;
  timeOffsetH: number;
  grid: SeaIceField['grid']; // same grid structure, values are risk 0–100
}

// ── Routes ─────────────────────────────────────────────────────────────

export type RouteKind = 'SHORTEST' | 'BALANCED' | 'CONSERVATIVE';

export interface RouteHazard {
  kind: 'ICEBERG' | 'SEA_ICE' | 'WEATHER';
  refId?: string; // iceberg id if applicable
  atDistNm: number;
  severity: RiskLevel;
  note: string;
}

export interface Route {
  id: string;
  kind: RouteKind;
  label: string; // "ROUTE A — DIRECT"
  waypoints: GeoPoint[];
  distanceNm: number;
  estTimeH: number;
  /** Fuel is a MODEL ESTIMATE (labelled), never a validated measurement. */
  estFuelT: number;
  riskScore: number;
  riskLevel: RiskLevel;
  hazards: RouteHazard[];
  recommended: boolean;
  recommendationReasons: string[]; // machine-generated from computed values
  meta: ResultMeta;
  supersededByRouteId?: string;
}

// ── Alerts ─────────────────────────────────────────────────────────────

export type AlertKind = 'ICEBERG' | 'SEA_ICE' | 'WEATHER' | 'ROUTE' | 'SYSTEM';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  timeOffsetH: number;
  title: string;
  reason: string;
  location?: GeoPoint;
  affectedComponent: string; // e.g. "ROUTE B — BALANCED"
  recommendedAction: string;
  acknowledged: boolean;
}

// ── Scenario / snapshot ────────────────────────────────────────────────

/** Everything the Command Center needs for one scenario time step. */
export interface ScenarioSnapshot {
  timeOffsetH: number;
  vesselState: VesselState;
  seaIce: SeaIceField;
  icebergs: Iceberg[];
  weather: WeatherField;
  routes: Route[];
  activeRouteId: string;
  recommendedRouteId: string;
  risk: RiskAssessment;
  riskSurface: RiskSurface;
  alerts: Alert[]; // cumulative up to this time
  missionStatus: MissionStatus;
  /** narrative of what changed at this step (drives the DECIDE panel) */
  events: string[];
}

export interface Scenario {
  mission: Mission;
  vessel: Vessel;
  timeStepsH: number[]; // e.g. [0, 6, 12, ...]
  snapshots: ScenarioSnapshot[];
}
