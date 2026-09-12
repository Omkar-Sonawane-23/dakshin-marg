/** Route-optimization routes — pass-through to the Python optimizer.
 * Node validates shape early; science stays in Python.
 */

import { Router } from 'express';
import { pyGetCached } from '../pythonClient.js';

export const routesOptRouter = Router();

routesOptRouter.get('/profiles', async (_req, res, next) => {
  try {
    res.json(await pyGetCached<unknown>('/ml/routes/profiles', 300_000));
  } catch (err) {
    next(err);
  }
});

// Deterministic re-planning drill: identical output every call, so a long
// cache is safe (the Python side caches the document too).
routesOptRouter.get('/replan-drill', async (_req, res, next) => {
  try {
    res.json(await pyGetCached<unknown>('/ml/routes/replan-drill', 300_000));
  } catch (err) {
    next(err);
  }
});

routesOptRouter.post('/optimize', async (req, res, next) => {
  try {
    const body = req.body as { origin?: { lat?: number }; destination?: { lat?: number } };
    const okPoint = (p: unknown) =>
      typeof p === 'object' && p !== null &&
      typeof (p as { lat?: unknown }).lat === 'number' &&
      typeof (p as { lon?: unknown }).lon === 'number';
    if (!okPoint(body?.origin) || !okPoint(body?.destination)) {
      res.status(422).json({
        detail: { code: 'BAD_ENDPOINT', message: 'origin and destination must be {lat, lon} objects' },
      });
      return;
    }
    const upstream = await fetch(
      `${process.env.PY_SERVICES_URL ?? 'http://127.0.0.1:8100'}/ml/routes/optimize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(60_000),
      },
    );
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    next(err);
  }
});
