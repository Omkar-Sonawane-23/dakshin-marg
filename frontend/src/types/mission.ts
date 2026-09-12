/** Mission domain types — mirror of backend/src/missionStore.ts documents. */

import type { EnvEnvelope, RouteOptimizationData } from './env';

export type MissionState =
  | 'DRAFT' | 'READY' | 'ROUTES_GENERATED' | 'IN_PROGRESS'
  | 'ROUTE_REVIEW_REQUIRED' | 'RE_PLANNING' | 'PAUSED'
  | 'COMPLETED' | 'CANCELLED';

export interface MissionEvent {
  at: string;
  simTime?: string | null;
  type: string;
  message: string;
  data?: unknown;
}

export interface MissionVessel {
  name: string;
  type: string;
  iceClass: string;
  cruiseSpeedKn: number;
  maxSpeedKn: number | null;
  maxAcceptableSeverity: 'LOW' | 'MEDIUM' | 'HIGH';
  fuelModel: 'NOT_AVAILABLE';
}

export interface MissionPoint { lat: number; lon: number; label?: string }

export interface MissionSimulation {
  simTime: string;
  elapsedH: number;
  distanceCoveredNm: number;
  vesselPos: { lat: number; lon: number } | null;
  completed: boolean;
  /** Navigation-leg checkpoint (changes when a replan is accepted). */
  legStartSimTime?: string;
  legStartDistanceNm?: number;
}

export interface Mission {
  id: string;
  name: string;
  state: MissionState;
  createdAt: string;
  updatedAt: string;
  vessel: MissionVessel;
  origin: MissionPoint;
  destination: MissionPoint;
  departureUtc: string;
  timeResolution?: TimeResolution;
  routePlan?: EnvEnvelope<RouteOptimizationData>;
  activeProfile?: string | null;
  simulation?: MissionSimulation | null;
  events: MissionEvent[];
}

export interface MissionSummary {
  id: string;
  name: string;
  state: MissionState;
  createdAt: string;
  updatedAt: string;
  vessel: { name: string; iceClass: string };
  origin: MissionPoint;
  destination: MissionPoint;
  departureUtc: string;
  activeProfile: string | null;
  simTime: string | null;
  eventCount: number;
}

/** Output of the Python environmental time resolver. */
export interface TimeResolution {
  status: 'OK' | 'OUT_OF_RANGE' | 'BAD_TIME';
  requested?: string;
  message?: string;
  window: { start: string; end: string };
  weatherHour?: string;
  weatherKind?: 'OBSERVED_ARCHIVE' | 'FORECAST';
  seaIceKind?: 'OBSERVATION' | 'FORECAST';
  seaIceValidTime?: string;
  seaIceDeltaH?: number;
  seaIceDay?: string | null;
  horizonH?: number;
  notes?: string[];
}

/** /env/availability — the REAL data window, computed server-side. */
export interface EnvAvailability {
  window: { start: string; end: string };
  seaIce: {
    observationDays: string[];
    observationValidTimes: string[];
    latestObservation: string;
    forecastHorizonsH: number[];
    forecastValidTimes: string[];
  };
  weather: { firstHour: string; lastHour: string; nowHour: string; hourCount: number };
  icebergs: { note: string };
  note: string;
}
