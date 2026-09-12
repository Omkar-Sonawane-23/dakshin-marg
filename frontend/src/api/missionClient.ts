/** Client for the mission lifecycle API (Node :8200, proxied at /api). */

import type { EnvEnvelope, RouteOptimizationData } from '../types/env';
import type {
  EnvAvailability, Mission, MissionEvent, MissionSimulation, MissionState,
  MissionSummary, TimeResolution,
} from '../types/mission';

export class MissionApiError extends Error {
  code: string;
  window?: { start: string; end: string };
  constructor(code: string, message: string, window?: { start: string; end: string }) {
    super(message);
    this.code = code;
    this.window = window;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new MissionApiError('API_UNREACHABLE', 'Application API unreachable.');
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = `Request failed (${res.status}).`;
    let window: { start: string; end: string } | undefined;
    try {
      const body = await res.json();
      if (body?.detail?.code) {
        code = body.detail.code;
        message = body.detail.message;
        window = body.detail.window;
      }
    } catch { /* keep defaults */ }
    throw new MissionApiError(code, message, window);
  }
  return res.json() as Promise<T>;
}

export const fetchAvailability = () =>
  request<EnvAvailability>('/env/availability');

export const resolveTime = (whenIso: string) =>
  request<TimeResolution>(`/env/time/resolve?when=${encodeURIComponent(whenIso)}`);

export const listMissions = () =>
  request<{ missions: MissionSummary[]; persistence: string }>('/api/missions');

export const fetchMission = (id: string) =>
  request<{ mission: Mission; persistence: string }>(`/api/missions/${id}`);

export const createMission = (body: {
  name: string;
  origin: { lat: number; lon: number };
  originLabel?: string;
  destination: { lat: number; lon: number };
  destinationLabel?: string;
  departureUtc: string;
  vessel: {
    name: string; type?: string; iceClass: string; cruiseSpeedKn: number;
    maxSpeedKn?: number | null; maxAcceptableSeverity: 'LOW' | 'MEDIUM' | 'HIGH';
  };
}) => request<{ mission: Mission; persistence: string }>('/api/missions', {
  method: 'POST', body: JSON.stringify(body),
});

export const patchMission = (id: string, body: {
  name?: string;
  state?: MissionState;
  simTime?: string;
  activeProfile?: string | null;
  routePlan?: EnvEnvelope<RouteOptimizationData>;
  simulation?: MissionSimulation;
  appendEvents?: MissionEvent[];
}) => request<{ mission: Mission }>(`/api/missions/${id}`, {
  method: 'PATCH', body: JSON.stringify(body),
});

export const deleteMission = (id: string) =>
  request<{ deleted: string }>(`/api/missions/${id}`, { method: 'DELETE' });

export const generateMissionRoutes = (id: string) =>
  request<{ mission: Mission }>(`/api/missions/${id}/routes`, { method: 'POST' });

export const replanMission = (id: string, position: { lat: number; lon: number }, simTime: string) =>
  request<{ mission: Mission; candidatePlan: EnvEnvelope<RouteOptimizationData> }>(
    `/api/missions/${id}/replan`,
    { method: 'POST', body: JSON.stringify({ position, simTime }) },
  );
