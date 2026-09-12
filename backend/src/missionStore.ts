/** Mission persistence — MongoDB when available, automatic in-memory +
 * JSON-file fallback otherwise (constitution decision: real DB preferred,
 * never a hard dependency for the demo).
 *
 * The store is domain-data only: mission documents. No scientific results
 * are recomputed here; route/risk payloads are stored exactly as returned
 * by the Python services (provenance intact).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── types ───────────────────────────────────────────────────────────────

export type MissionState =
  | 'DRAFT' | 'READY' | 'ROUTES_GENERATED' | 'IN_PROGRESS'
  | 'ROUTE_REVIEW_REQUIRED' | 'RE_PLANNING' | 'PAUSED'
  | 'COMPLETED' | 'CANCELLED';

export interface MissionEvent {
  at: string;              // wall-clock UTC ISO when the event was recorded
  simTime?: string | null; // mission sim time ISO, when applicable
  type: string;            // MISSION_CREATED | ROUTES_GENERATED | ...
  message: string;
  data?: unknown;
}

export interface MissionDoc {
  id: string;
  name: string;
  state: MissionState;
  createdAt: string;
  updatedAt: string;
  vessel: {
    name: string;
    type: string;
    iceClass: string;
    cruiseSpeedKn: number;
    maxSpeedKn: number | null;
    maxAcceptableSeverity: 'LOW' | 'MEDIUM' | 'HIGH';
    fuelModel: 'NOT_AVAILABLE';   // honesty: no validated fuel model exists
  };
  origin: { lat: number; lon: number; label?: string };
  destination: { lat: number; lon: number; label?: string };
  departureUtc: string;           // resolved mission departure time (UTC ISO)
  timeResolution?: unknown;       // resolver output at planning time
  routePlan?: unknown;            // full Python optimize envelope (verbatim)
  activeProfile?: string | null;  // operator-accepted profile id
  simulation?: {
    simTime: string;              // current sim clock (UTC ISO)
    elapsedH: number;
    distanceCoveredNm: number;
    vesselPos: { lat: number; lon: number } | null;
    completed: boolean;
  } | null;
  events: MissionEvent[];
}

// ── storage backends ────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const FALLBACK_FILE = join(HERE, '..', '..', 'data', 'missions', 'missions.json');

interface Backend {
  kind: 'mongodb' | 'memory-file';
  list(): Promise<MissionDoc[]>;
  get(id: string): Promise<MissionDoc | null>;
  put(doc: MissionDoc): Promise<void>;
  remove(id: string): Promise<boolean>;
}

function fileBackend(): Backend {
  const mem = new Map<string, MissionDoc>();
  try {
    if (existsSync(FALLBACK_FILE)) {
      const arr = JSON.parse(readFileSync(FALLBACK_FILE, 'utf8')) as MissionDoc[];
      for (const m of arr) mem.set(m.id, m);
    }
  } catch { /* corrupt file — start empty, will be rewritten */ }
  const flush = () => {
    try {
      mkdirSync(dirname(FALLBACK_FILE), { recursive: true });
      writeFileSync(FALLBACK_FILE, JSON.stringify([...mem.values()], null, 1));
    } catch { /* disk failure: memory copy still serves the session */ }
  };
  return {
    kind: 'memory-file',
    async list() { return [...mem.values()]; },
    async get(id) { return mem.get(id) ?? null; },
    async put(doc) { mem.set(doc.id, doc); flush(); },
    async remove(id) { const ok = mem.delete(id); flush(); return ok; },
  };
}

async function tryMongo(): Promise<Backend | null> {
  const url = process.env.MONGODB_URL ?? 'mongodb://127.0.0.1:27017';
  try {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(url, {
      serverSelectionTimeoutMS: 1500,
      connectTimeoutMS: 1500,
    });
    await client.connect();
    await client.db('polaris_x').command({ ping: 1 });
    const col = client.db('polaris_x').collection<MissionDoc>('missions');
    return {
      kind: 'mongodb',
      async list() { return col.find({}, { projection: { _id: 0 } }).toArray(); },
      async get(id) { return col.findOne({ id }, { projection: { _id: 0 } }); },
      async put(doc) { await col.replaceOne({ id: doc.id }, doc, { upsert: true }); },
      async remove(id) { return (await col.deleteOne({ id })).deletedCount > 0; },
    };
  } catch {
    return null;
  }
}

let backend: Backend | null = null;

export async function getBackend(): Promise<Backend> {
  if (backend) return backend;
  backend = (await tryMongo()) ?? fileBackend();
  console.log(`[missions] persistence backend: ${backend.kind}`);
  return backend;
}

export function newMissionId(): string {
  return `M-${randomUUID().slice(0, 8).toUpperCase()}`;
}
