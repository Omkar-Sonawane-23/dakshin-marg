/** Thin client for the Python scientific services (FastAPI :8100).
 *
 * The Node layer never re-implements science — it orchestrates, joins and
 * caches. All provenance metadata from Python is passed through untouched.
 */

const PY_BASE = process.env.PY_SERVICES_URL ?? 'http://127.0.0.1:8100';

export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function pyGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PY_BASE}${path}`, {
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new UpstreamError(
      503,
      'PY_SERVICE_UNREACHABLE',
      `Python services unreachable at ${PY_BASE}: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    let code = 'PY_SERVICE_ERROR';
    let message = `Python service returned ${res.status} for ${path}`;
    try {
      const body = (await res.json()) as { detail?: { code?: string; message?: string } };
      if (body.detail?.code) code = body.detail.code;
      if (body.detail?.message) message = body.detail.message;
    } catch {
      /* non-JSON error body — keep defaults */
    }
    throw new UpstreamError(res.status, code, message);
  }
  return (await res.json()) as T;
}

/** Tiny TTL cache so berg endpoints don't hammer Python on every UI poll. */
const cache = new Map<string, { at: number; value: unknown }>();

export async function pyGetCached<T>(path: string, ttlMs = 60_000): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await pyGet<T>(path);
  cache.set(path, { at: Date.now(), value });
  return value;
}
