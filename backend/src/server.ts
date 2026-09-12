/** POLARIS-X application API (Node/Express/TS).
 *
 * Role per architecture: orchestration layer between the React UI and the
 * Python scientific services. It joins, caches and shapes responses; it
 * never performs scientific computation and never alters provenance labels.
 *
 * Run: npm run dev  (listens on :8200)
 */

import express from 'express';
import { icebergsRouter } from './routes/icebergs.js';
import { riskRouter } from './routes/risk.js';
import { routesOptRouter } from './routes/routesOpt.js';
import { missionsRouter } from './routes/missions.js';
import { pyGet, UpstreamError } from './pythonClient.js';

const app = express();
const PORT = Number(process.env.PORT ?? 8200);

app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.get('/api/health', async (_req, res) => {
  let python: 'up' | 'down' = 'down';
  try {
    await pyGet('/env/health');
    python = 'up';
  } catch {
    /* stays down */
  }
  res.json({
    service: 'polaris-x-backend',
    version: '0.1.0',
    status: 'ok',
    dependencies: { pythonServices: python },
    servedAt: new Date().toISOString(),
  });
});

app.use('/api/icebergs', icebergsRouter);
app.use('/api/risk', riskRouter);
app.use('/api/routes', routesOptRouter);
app.use('/api/missions', missionsRouter);

// JSON 404 so clients always get the uniform error envelope.
app.use('/api', (_req, res) => {
  res.status(404).json({ detail: { code: 'NOT_FOUND', message: 'Unknown application API route.' } });
});

// Uniform error envelope, matching the Python service's { detail: { code, message } }.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof UpstreamError) {
      res.status(err.status).json({ detail: { code: err.code, message: err.message } });
      return;
    }
    console.error(err);
    res.status(500).json({
      detail: { code: 'INTERNAL', message: 'Unexpected error in application API.' },
    });
  },
);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`polaris-x backend listening on :${PORT}`);
});
