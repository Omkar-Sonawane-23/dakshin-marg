/** Risk routes — pass-throughs to the Python risk engine.
 * The Node layer validates shape early (fail fast, friendlier errors) but
 * never re-implements the science or alters provenance.
 */

import { Router } from 'express';
import { pyGet, pyGetCached } from '../pythonClient.js';

export const riskRouter = Router();

riskRouter.get('/catalog', async (_req, res, next) => {
  try {
    res.json(await pyGetCached<unknown>('/ml/risk/catalog', 300_000));
  } catch (err) {
    next(err);
  }
});

riskRouter.get('/spatial', async (req, res, next) => {
  try {
    const iceClass = String(req.query.ice_class ?? 'PC5');
    const horizonH = String(req.query.horizon_h ?? '0');
    res.json(
      await pyGetCached<unknown>(
        `/ml/risk/spatial?ice_class=${encodeURIComponent(iceClass)}&horizon_h=${encodeURIComponent(horizonH)}`,
      ),
    );
  } catch (err) {
    next(err);
  }
});

riskRouter.post('/route', async (req, res, next) => {
  try {
    const body = req.body as { waypoints?: unknown };
    if (!Array.isArray(body?.waypoints) || body.waypoints.length < 2) {
      res.status(422).json({
        detail: { code: 'BAD_WAYPOINTS', message: 'waypoints must be an array of >= 2 {lat, lon} points' },
      });
      return;
    }
    // POST bodies are not cached — routes are ad hoc.
    const upstream = await fetch(
      `${process.env.PY_SERVICES_URL ?? 'http://127.0.0.1:8100'}/ml/risk/route`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(30_000),
      },
    );
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    next(err);
  }
});

// re-export pyGet so TS doesn't flag it unused if pruned later
void pyGet;
