import type { RiskLevel } from '../types/domain';

export function fmtLat(lat: number): string {
  const d = Math.abs(lat);
  return `${Math.floor(d)}°${String(Math.round((d % 1) * 60)).padStart(2, '0')}′${lat < 0 ? 'S' : 'N'}`;
}

export function fmtLon(lon: number): string {
  const d = Math.abs(lon);
  return `${Math.floor(d)}°${String(Math.round((d % 1) * 60)).padStart(2, '0')}′${lon < 0 ? 'W' : 'E'}`;
}

export function fmtPos(lon: number, lat: number): string {
  return `${fmtLat(lat)}  ${fmtLon(lon)}`;
}

export function fmtHours(h: number): string {
  const d = Math.floor(h / 24);
  const r = Math.round(h % 24);
  if (d === 0) return `${r} h`;
  return `${d} d ${r} h`;
}

export function fmtOffset(h: number): string {
  return h === 0 ? 'NOW' : `+${h} H`;
}

/** Scenario clock: departure epoch + offset hours → 'DD MMM HH:MM UTC'. */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function fmtScenarioTime(baseIso: string, offsetH: number): string {
  const d = new Date(new Date(baseIso).getTime() + offsetH * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${String(
    d.getUTCHours(),
  ).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export const RISK_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function riskFromScore(score: number): RiskLevel {
  if (score < 30) return 'LOW';
  if (score < 55) return 'MEDIUM';
  if (score < 78) return 'HIGH';
  return 'CRITICAL';
}
