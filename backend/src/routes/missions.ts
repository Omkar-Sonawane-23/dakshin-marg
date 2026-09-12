/** Mission lifecycle API — create / review / generate routes / simulate /
 * re-plan / persist. Science stays in Python; this layer owns the mission
 * document, its state machine and its event log.
 */

import { Router } from 'express';
import { getBackend, newMissionId } from '../missionStore.js';
import type { MissionDoc, MissionEvent, MissionState } from '../missionStore.js';

export const missionsRouter = Router();

const PY = process.env.PY_SERVICES_URL ?? 'http://127.0.0.1:8100';

const STATES: MissionState[] = [
  'DRAFT', 'READY', 'ROUTES_GENERATED', 'IN_PROGRESS', 'ROUTE_REVIEW_REQUIRED',
  'RE_PLANNING', 'PAUSED', 'COMPLETED', 'CANCELLED',
];

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isPoint(p: unknown): p is { lat: number; lon: number } {
  return typeof p === 'object' && p !== null
    && typeof (p as { lat?: unknown }).lat === 'number'
    && typeof (p as { lon?: unknown }).lon === 'number';
}

function bad(res: import('express').Response, code: string, message: string, extra?: object) {
  res.status(422).json({ detail: { code, message, ...(extra ?? {}) } });
}

async function pyJson(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${PY}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(90_000),
  });
  return { status: res.status, body: await res.json() };
}

function pushEvent(m: MissionDoc, type: string, message: string,
                   simTime?: string | null, data?: unknown) {
  const ev: MissionEvent = { at: nowIso(), simTime: simTime ?? null, type, message };
  if (data !== undefined) ev.data = data;
  m.events.push(ev);
  m.updatedAt = nowIso();
}

function summary(m: MissionDoc) {
  return {
    id: m.id, name: m.name, state: m.state,
    createdAt: m.createdAt, updatedAt: m.updatedAt,
    vessel: { name: m.vessel.name, iceClass: m.vessel.iceClass },
    origin: m.origin, destination: m.destination,
    departureUtc: m.departureUtc,
    activeProfile: m.activeProfile ?? null,
    simTime: m.simulation?.simTime ?? null,
    eventCount: m.events.length,
  };
}

// ── list / create ───────────────────────────────────────────────────────

missionsRouter.get('/', async (_req, res, next) => {
  try {
    const be = await getBackend();
    const all = await be.list();
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    res.json({ missions: all.map(summary), persistence: be.kind });
  } catch (err) { next(err); }
});

missionsRouter.post('/', async (req, res, next) => {
  try {
    const b = req.body as Record<string, unknown>;
    const name = String(b.name ?? '').trim();
    if (!name) return bad(res, 'MISSING_NAME', 'Mission name is required.');
    if (!isPoint(b.origin)) return bad(res, 'BAD_ORIGIN', 'origin must be {lat, lon}.');
    if (!isPoint(b.destination)) return bad(res, 'BAD_DESTINATION', 'destination must be {lat, lon}.');
    const departureUtc = String(b.departureUtc ?? '');
    if (!departureUtc) return bad(res, 'MISSING_DEPARTURE', 'departureUtc (ISO) is required.');

    const v = (b.vessel ?? {}) as Record<string, unknown>;
    const iceClass = String(v.iceClass ?? '');
    const cruise = Number(v.cruiseSpeedKn);
    if (!iceClass) return bad(res, 'MISSING_ICE_CLASS', 'vessel.iceClass is required.');
    if (!Number.isFinite(cruise) || cruise < 3 || cruise > 30) {
      return bad(res, 'BAD_SPEED', 'vessel.cruiseSpeedKn must be between 3 and 30 kn.');
    }
    const maxSev = String(v.maxAcceptableSeverity ?? 'MEDIUM');
    if (!SEVERITIES.includes(maxSev as (typeof SEVERITIES)[number])) {
      return bad(res, 'BAD_MAX_SEVERITY',
        `vessel.maxAcceptableSeverity must be one of ${SEVERITIES.join(', ')}.`);
    }

    // Validate the departure time against REAL data availability — refuse,
    // never substitute. The resolver's message includes the actual range.
    const { status, body } = await pyJson(
      `/env/time/resolve?when=${encodeURIComponent(departureUtc)}`);
    if (status !== 200) {
      res.status(status).json(body);
      return;
    }
    const resolution = body as { status: string; message?: string; window?: unknown };
    if (resolution.status !== 'OK') {
      return bad(res, `TIME_${resolution.status}`,
        resolution.message ?? 'Departure time cannot be resolved.',
        { window: resolution.window });
    }

    const m: MissionDoc = {
      id: newMissionId(),
      name,
      state: 'DRAFT',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      vessel: {
        name: String(v.name ?? 'Unnamed vessel'),
        type: String(v.type ?? 'Research / resupply'),
        iceClass,
        cruiseSpeedKn: cruise,
        maxSpeedKn: Number.isFinite(Number(v.maxSpeedKn)) ? Number(v.maxSpeedKn) : null,
        maxAcceptableSeverity: maxSev as MissionDoc['vessel']['maxAcceptableSeverity'],
        fuelModel: 'NOT_AVAILABLE',
      },
      origin: { ...(b.origin as { lat: number; lon: number }), label: b.originLabel ? String(b.originLabel) : undefined },
      destination: { ...(b.destination as { lat: number; lon: number }), label: b.destinationLabel ? String(b.destinationLabel) : undefined },
      departureUtc,
      timeResolution: resolution,
      routePlan: undefined,
      activeProfile: null,
      simulation: null,
      events: [],
    };
    pushEvent(m, 'MISSION_CREATED',
      `Mission "${name}" created — ${m.vessel.name} (${iceClass}), departure ${departureUtc}.`);
    m.state = 'READY';
    pushEvent(m, 'STATE_CHANGE', 'Mission validated against data availability — state READY.');

    const be = await getBackend();
    await be.put(m);
    res.status(201).json({ mission: m, persistence: be.kind });
  } catch (err) { next(err); }
});

// ── single mission ──────────────────────────────────────────────────────

missionsRouter.get('/:id', async (req, res, next) => {
  try {
    const be = await getBackend();
    const m = await be.get(req.params.id);
    if (!m) { res.status(404).json({ detail: { code: 'NOT_FOUND', message: 'No such mission.' } }); return; }
    res.json({ mission: m, persistence: be.kind });
  } catch (err) { next(err); }
});

missionsRouter.delete('/:id', async (req, res, next) => {
  try {
    const be = await getBackend();
    const ok = await be.remove(req.params.id);
    if (!ok) { res.status(404).json({ detail: { code: 'NOT_FOUND', message: 'No such mission.' } }); return; }
    res.json({ deleted: req.params.id });
  } catch (err) { next(err); }
});

/** PATCH — rename, state transitions, sim-state checkpoints, accepted route.
 * The frontend owns the simulation clock; this endpoint persists it. */
missionsRouter.patch('/:id', async (req, res, next) => {
  try {
    const be = await getBackend();
    const m = await be.get(req.params.id);
    if (!m) { res.status(404).json({ detail: { code: 'NOT_FOUND', message: 'No such mission.' } }); return; }
    const b = req.body as Record<string, unknown>;

    if (typeof b.name === 'string' && b.name.trim()) {
      const old = m.name;
      m.name = b.name.trim();
      pushEvent(m, 'MISSION_RENAMED', `Mission renamed "${old}" → "${m.name}".`);
    }
    if (typeof b.state === 'string') {
      if (!STATES.includes(b.state as MissionState)) {
        return bad(res, 'BAD_STATE', `state must be one of ${STATES.join(', ')}.`);
      }
      if (b.state !== m.state) {
        const from = m.state;
        m.state = b.state as MissionState;
        pushEvent(m, 'STATE_CHANGE', `${from} → ${m.state}`,
          (b.simTime as string) ?? m.simulation?.simTime ?? null);
      }
    }
    if (typeof b.activeProfile === 'string' || b.activeProfile === null) {
      m.activeProfile = b.activeProfile as string | null;
    }
    // Operator accepted a replan candidate — the candidate envelope (stored
    // verbatim from Python) becomes the mission's active route plan.
    if (b.routePlan && typeof b.routePlan === 'object') {
      m.routePlan = b.routePlan;
      m.updatedAt = nowIso();
    }
    if (b.simulation && typeof b.simulation === 'object') {
      m.simulation = b.simulation as MissionDoc['simulation'];
      m.updatedAt = nowIso();
    }
    if (Array.isArray(b.appendEvents)) {
      for (const ev of b.appendEvents as MissionEvent[]) {
        if (ev && typeof ev.type === 'string' && typeof ev.message === 'string') {
          m.events.push({
            at: typeof ev.at === 'string' ? ev.at : nowIso(),
            simTime: ev.simTime ?? null,
            type: ev.type, message: ev.message,
            ...(ev.data !== undefined ? { data: ev.data } : {}),
          });
        }
      }
      m.updatedAt = nowIso();
    }
    await be.put(m);
    res.json({ mission: m });
  } catch (err) { next(err); }
});

// ── route generation (initial + re-plan) ───────────────────────────────

/** POST /:id/routes — generate route options for the mission departure time
 * from the mission origin. Stores the full Python envelope verbatim. */
missionsRouter.post('/:id/routes', async (req, res, next) => {
  try {
    const be = await getBackend();
    const m = await be.get(req.params.id);
    if (!m) { res.status(404).json({ detail: { code: 'NOT_FOUND', message: 'No such mission.' } }); return; }

    const { status, body } = await pyJson('/ml/routes/optimize', {
      method: 'POST',
      body: JSON.stringify({
        origin: { lat: m.origin.lat, lon: m.origin.lon },
        destination: { lat: m.destination.lat, lon: m.destination.lon },
        iceClass: m.vessel.iceClass,
        cruiseSpeedKn: m.vessel.cruiseSpeedKn,
        missionTime: m.departureUtc,
      }),
    });
    if (status !== 200) { res.status(status).json(body); return; }

    m.routePlan = body;
    m.state = 'ROUTES_GENERATED';
    const data = (body as { data: { routes: { status: string }[]; recommendation?: { profile?: string } } }).data;
    const okCount = data.routes.filter((r) => r.status === 'OK').length;
    pushEvent(m, 'ROUTES_GENERATED',
      `${okCount} feasible route option(s) generated for departure ${m.departureUtc}` +
      (data.recommendation?.profile ? `; decision-support recommendation: ${data.recommendation.profile}.` : '.'),
      m.departureUtc);
    await be.put(m);
    res.json({ mission: m });
  } catch (err) { next(err); }
});

/** POST /:id/replan — re-optimize from the CURRENT vessel position at the
 * CURRENT sim time. Does NOT mutate the active route: returns a candidate
 * plan for operator review (decision support only). */
missionsRouter.post('/:id/replan', async (req, res, next) => {
  try {
    const be = await getBackend();
    const m = await be.get(req.params.id);
    if (!m) { res.status(404).json({ detail: { code: 'NOT_FOUND', message: 'No such mission.' } }); return; }
    const b = req.body as { position?: unknown; simTime?: unknown };
    if (!isPoint(b.position)) return bad(res, 'BAD_POSITION', 'position must be {lat, lon} (current vessel position).');
    const simTime = typeof b.simTime === 'string' ? b.simTime : null;
    if (!simTime) return bad(res, 'MISSING_SIM_TIME', 'simTime (ISO) is required — re-planning uses the mission clock.');

    const { status, body } = await pyJson('/ml/routes/optimize', {
      method: 'POST',
      body: JSON.stringify({
        origin: b.position,
        destination: { lat: m.destination.lat, lon: m.destination.lon },
        iceClass: m.vessel.iceClass,
        cruiseSpeedKn: m.vessel.cruiseSpeedKn,
        missionTime: simTime,
      }),
    });
    if (status !== 200) { res.status(status).json(body); return; }

    pushEvent(m, 'REPLAN_GENERATED',
      `Alternative routes generated from vessel position ` +
      `${(b.position as { lat: number }).lat.toFixed(2)}°, ` +
      `${(b.position as { lon: number }).lon.toFixed(2)}° at mission time ${simTime}. ` +
      `Operator review required — no route change applied automatically.`,
      simTime);
    await be.put(m);
    res.json({ mission: m, candidatePlan: body });
  } catch (err) { next(err); }
});
