/** Iceberg routes — orchestrates the three separate Python capabilities
 * (detection, tracking, trajectory prediction) plus the USNIC current
 * product into UI-ready responses.
 */

import { Router } from 'express';
import { pyGetCached } from '../pythonClient.js';
import type {
  BergPrediction,
  BergSituation,
  Envelope,
  TrackSummary,
} from '../types.js';

export const icebergsRouter = Router();

// Pass-throughs: each capability stays independently addressable so the UI
// (and judges) can inspect every pipeline stage on its own.

icebergsRouter.get('/detections', async (_req, res, next) => {
  try {
    res.json(await pyGetCached<Envelope<unknown>>('/ml/icebergs/detections'));
  } catch (err) {
    next(err);
  }
});

icebergsRouter.get('/tracks', async (_req, res, next) => {
  try {
    res.json(
      await pyGetCached<Envelope<{ tracks: TrackSummary[] }>>('/ml/icebergs/tracks'),
    );
  } catch (err) {
    next(err);
  }
});

icebergsRouter.get('/tracks/validation', async (_req, res, next) => {
  try {
    res.json(await pyGetCached<unknown>('/ml/icebergs/tracks/validation', 300_000));
  } catch (err) {
    next(err);
  }
});

icebergsRouter.get('/trajectories', async (_req, res, next) => {
  try {
    res.json(
      await pyGetCached<Envelope<{ predictions: BergPrediction[] }>>(
        '/ml/icebergs/trajectories',
      ),
    );
  } catch (err) {
    next(err);
  }
});

/** JOIN endpoint: one situation record per berg — track + prediction +
 * latest USNIC position. This is Node-layer work (orchestration), the kind
 * of join the Python side shouldn't own. */
icebergsRouter.get('/situation', async (_req, res, next) => {
  try {
    const [tracksEnv, trajEnv, usnicEnv] = await Promise.all([
      pyGetCached<Envelope<{ tracks: TrackSummary[] }>>('/ml/icebergs/tracks'),
      pyGetCached<Envelope<{ predictions: BergPrediction[] }>>('/ml/icebergs/trajectories'),
      pyGetCached<Envelope<{ icebergs: { id: string; lat: number; lon: number; length_nm?: number; last_update?: string }[] }>>(
        '/env/icebergs',
      ),
    ]);

    const byId = new Map<string, BergSituation>();
    for (const t of tracksEnv.data.tracks) {
      byId.set(t.id, { id: t.id, track: t, prediction: null, usnicCurrent: null });
    }
    for (const p of trajEnv.data.predictions) {
      const s = byId.get(p.id) ?? { id: p.id, track: null, prediction: null, usnicCurrent: null };
      s.prediction = p;
      byId.set(p.id, s);
    }
    for (const b of usnicEnv.data.icebergs) {
      const id = b.id?.toUpperCase();
      if (!id) continue;
      const s = byId.get(id);
      if (s) s.usnicCurrent = { lat: b.lat, lon: b.lon, length_nm: b.length_nm };
    }

    const situations = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    res.json({
      data: {
        situations,
        count: situations.length,
        joinNote:
          'Track/prediction from BYU v8 database (may lag real time); ' +
          'usnicCurrent from the latest USNIC current-iceberg product. ' +
          'Discrepancy between the two is expected and shown, not hidden.',
      },
      meta: {
        provenance: 'MIXED',
        temporal: {
          tracksLatest: tracksEnv.meta.temporal['latestObs'] ?? null,
          usnic: usnicEnv.meta.temporal,
        },
        source: { tracks: tracksEnv.meta.source, usnic: usnicEnv.meta.source },
        quality: 'ok',
        warnings: [...tracksEnv.meta.warnings, ...trajEnv.meta.warnings],
        servedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});
