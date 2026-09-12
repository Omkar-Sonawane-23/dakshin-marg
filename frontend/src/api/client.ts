/**
 * Typed API layer.
 *
 * Today this is backed by the deterministic mock scenario generator
 * (constitution §39 — UI-first with a typed mock-data layer). The function
 * signatures mirror docs/api-contracts.md so the implementation can be
 * swapped for real Node endpoints without touching components.
 *
 * Simulated network latency is applied so loading states are real UI states,
 * not dead code. Set VITE_MOCK_FAIL=sea-ice (etc.) to exercise error states.
 */

import type { Scenario } from '../types/domain';
import { buildScenario } from '../mock/scenario';

const LATENCY_MS = 900;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

let cache: Scenario | null = null;

/** GET /api/v1/simulation/state + timeline (mocked). */
export async function fetchScenario(): Promise<Scenario> {
  await delay(LATENCY_MS);
  const failFlag = (import.meta as { env?: Record<string, string> }).env?.VITE_MOCK_FAIL;
  if (failFlag === 'scenario') {
    throw new ApiError(
      'SCENARIO_UNAVAILABLE',
      'Demo scenario service unreachable. Last valid snapshot: none. Retry or restart the demo runtime.',
    );
  }
  if (!cache) cache = buildScenario();
  return cache;
}
