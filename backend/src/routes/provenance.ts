import { Router } from 'express';

export const provenanceRouter = Router();

const RECORDS = [
  { id:'R-1042', kind:'Route', source:'severity-ceiling-astar v0.1.0', product:'Route plan · Prydz Bay', observedAt:'2026-09-01T00:00Z', ingestedAt:'2026-09-01T03:12Z', provenance:'DERIVED_FROM_OBSERVATION', lineage:['F-293','B-884','W-292','BATH-12'] },
  { id:'F-293', kind:'Forecast', source:'damped-trend v0.1.0', product:'SIC +48h', observedAt:'2026-09-01T00:00Z', provenance:'MODEL_FORECAST' },
  { id:'B-884', kind:'Iceberg', source:'USNIC + BYU/NIC v8', product:'Berg D23/D12', observedAt:'2026-08-27T12:00Z', provenance:'REAL_OBSERVATION' },
  { id:'W-292', kind:'Weather', source:'Open-Meteo', product:'Wind/temp', observedAt:'2026-09-02T05:00Z', provenance:'REAL_FORECAST' },
];

provenanceRouter.get('/', (_req, res) => {
  res.json({ records: RECORDS, invariant:'Every product has provenance. Every forecast has age and uncertainty. UNKNOWN ≠ GO.' });
});

provenanceRouter.get('/:id', (req, res) => {
  const r = RECORDS.find(x=>x.id===req.params.id);
  if(!r) { res.status(404).json({ detail:{ code:'NOT_FOUND', message:'No such provenance record.' }}); return; }
  res.json({ record: r, servedAt: new Date().toISOString() });
});
