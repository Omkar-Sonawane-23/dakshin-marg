/** Shared response types for the Dakshin Marg application API. */

export type Provenance =
  | 'REAL_OBSERVATION'
  | 'REAL_HISTORICAL'
  | 'REAL_FORECAST'
  | 'MODEL_FORECAST'
  | 'SIMULATED'
  | 'MIXED';

export interface Envelope<T> {
  data: T;
  meta: {
    provenance: Provenance;
    temporal: Record<string, unknown>;
    source: Record<string, unknown>;
    quality: string;
    warnings: string[];
    servedAt: string;
  };
}

export interface ApiError {
  detail: { code: string; message: string };
}

export interface TrackSummary {
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

export interface TrajectoryPoint {
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
  trajectory: TrajectoryPoint[];
  staleDays: number;
}

/** Combined per-berg situation record served to the UI. */
export interface BergSituation {
  id: string;
  track: TrackSummary | null;
  prediction: BergPrediction | null;
  /** USNIC current-product position, if this berg is in the latest CSV. */
  usnicCurrent: { lat: number; lon: number; length_nm?: number } | null;
}
