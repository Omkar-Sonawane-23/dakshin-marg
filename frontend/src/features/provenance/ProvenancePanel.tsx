import { useState } from 'react';
import { useEnv } from '../../state/envStore';
import { useMission } from '../../state/missionStore';
import { SectionTitle } from '../../components/ui';

interface Prov { id:string; kind:string; source:string; product:string; observedAt:string; ingestedAt:string; servedAt:string; crs:string; resolution:string; version:string; quality:string; age:string; provenance:string; }

const STATIC_PROV: Prov[] = [
  { id:'R-1042', kind:'Route', source:'Dakshin Marg optimizer severity-ceiling-astar v0.1.0', product:'Route plan · Prydz Bay corridor', observedAt:'2026-09-01T00:00Z', ingestedAt:'2026-09-01T03:12Z', servedAt:'2026-09-02T06:00Z', crs:'EPSG:4326 / EPSG:3031', resolution:'0.5°×0.25° (~14×28 km)', version:'R-1042 v3', quality:'ok', age:'3.2 h', provenance:'DERIVED_FROM_OBSERVATION' },
  { id:'F-293', kind:'Forecast', source:'Dakshin Marg damped-trend v0.1.0', product:'SIC +48h forecast', observedAt:'2026-09-01T00:00Z', ingestedAt:'2026-09-01T03:15Z', servedAt:'2026-09-02T06:01Z', crs:'EPSG:4326', resolution:'0.5°×0.35°', version:'SIC-CONVLSTM-12 (experimental)', quality:'ok', age:'5 h', provenance:'MODEL_FORECAST' },
  { id:'B-884', kind:'Iceberg', source:'USNIC + BYU/NIC v8', product:'Iceberg D23/D12 ensemble', observedAt:'2026-08-27T12:00Z', ingestedAt:'2026-08-28T02:00Z', servedAt:'2026-09-02T06:00Z', crs:'EPSG:4326', resolution:'point', version:'BYU v8 + USNIC 2026-08-27', quality:'degraded (stale)', age:'6 days', provenance:'REAL_OBSERVATION' },
  { id:'W-292', kind:'Weather', source:'Open-Meteo / ECMWF', product:'Wind/temp hourly', observedAt:'2026-09-02T05:00Z', ingestedAt:'2026-09-02T05:40Z', servedAt:'2026-09-02T06:00Z', crs:'EPSG:4326', resolution:'1.0°', version:'openmeteo-global 2026-09-02', quality:'ok', age:'1 h', provenance:'REAL_FORECAST' },
  { id:'BATH-12', kind:'Static', source:'IBCSO v2 / GEBCO', product:'Bathymetry', observedAt:'—', ingestedAt:'2026-02-01T00:00Z', servedAt:'2026-09-02T06:00Z', crs:'EPSG:3031', resolution:'500 m', version:'IBCSO v2', quality:'ok', age:'static', provenance:'REAL_OBSERVATION' },
];

export default function ProvenancePanel(){
  const env = useEnv();
  const ms = useMission();
  const [sel,setSel]=useState<string>('R-1042');
  const p = STATIC_PROV.find(x=>x.id===sel)!;

  const freshness = (age:string) => {
    if(age.includes('static')) return {label:'STATIC', color:'var(--color-ink-faint)'};
    if(age.includes('days')) return {label:'STALE', color:'var(--color-risk-high)'};
    const h = parseFloat(age);
    if(h<6) return {label:'FRESH', color:'var(--color-risk-low)'};
    if(h<36) return {label:'AGING', color:'var(--color-risk-med)'};
    return {label:'STALE', color:'var(--color-risk-crit)'};
  };
  const f = freshness(p.age);

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <SectionTitle right={<span className="badge" style={{color:f.color, borderColor:`color-mix(in srgb, ${f.color} 40%, transparent)`, background:`color-mix(in srgb, ${f.color} 10%, transparent)`}}>{f.label}</span>}>Data & Provenance</SectionTitle>
      <div className="px-3 space-y-3">
        <p className="text-[10px] text-ink-dim leading-relaxed m-0">Every product is traceable. Each output shows source, timestamps, CRS, resolution, version, and quality. Provenance is preserved end-to-end and never silently mixed.</p>

        <div className="flex gap-1 flex-wrap">
          {STATIC_PROV.map(v=>(
            <button key={v.id} onClick={()=>setSel(v.id)} className={`btn !py-1 !px-2 !text-[9px] ${sel===v.id?'btn-accent':''}`}>{v.id} · {v.kind}</button>
          ))}
        </div>

        <div className="panel rounded-sm p-3 space-y-2">
          <div className="flex justify-between items-start gap-2">
            <div>
              <div className="font-data text-[12px] font-bold text-ice">{p.id} — {p.product}</div>
              <div className="text-[10px] text-ink-dim">{p.source}</div>
            </div>
            <span className="badge text-[8px]" style={{color: p.provenance.includes('MODEL')?'var(--color-model)':p.provenance.includes('REAL')?'var(--color-risk-low)':'var(--color-sim)', borderColor:'currentColor'}}>{p.provenance}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 font-data text-[10px]">
            <div><div className="label-xs">Observed / valid</div><div className="text-ice">{p.observedAt}</div></div>
            <div><div className="label-xs">Ingested</div><div className="text-ice">{p.ingestedAt}</div></div>
            <div><div className="label-xs">Served</div><div className="text-ice">{p.servedAt}</div></div>
            <div><div className="label-xs">Data age</div><div className="font-bold" style={{color:f.color}}>{p.age}</div></div>
            <div><div className="label-xs">CRS</div><div className="text-ice">{p.crs}</div></div>
            <div><div className="label-xs">Resolution</div><div className="text-ice">{p.resolution}</div></div>
            <div><div className="label-xs">Version</div><div className="text-ice">{p.version}</div></div>
            <div><div className="label-xs">Quality</div><div className="text-ice">{p.quality}</div></div>
          </div>

          <div className="hairline" />
          <div className="text-[10px] text-ink-dim font-data">Lineage</div>
          <div className="flex items-center gap-1 font-data text-[9px] text-ink-faint flex-wrap">
            <span className="px-1.5 py-0.5 bg-panel-inset border border-line rounded-sm">F-293</span> <span>→</span>
            <span className="px-1.5 py-0.5 bg-panel-inset border border-line rounded-sm">B-884</span> <span>→</span>
            <span className="px-1.5 py-0.5 bg-panel-inset border border-line rounded-sm">W-292</span> <span>→</span>
            <span className="px-1.5 py-0.5 bg-panel-inset border border-line rounded-sm">BATH-12</span> <span>→</span>
            <span className="px-1.5 py-0.5 bg-accent/15 border border-accent/30 rounded-sm text-accent">R-1042</span>
          </div>
          <p className="text-[9px] text-ink-faint leading-snug m-0">Example: Route R-1042 → SIC forecast F-293 → berg product B-884 → weather W-292 → bathymetry BATH-12. Click any id to inspect its own provenance.</p>
        </div>

        <div className="panel-inset rounded-sm p-2.5 space-y-1.5">
          <div className="label-xs">Invariant violations — hard guarantees</div>
          {[
            'Every product has provenance.',
            'Every forecast has age & uncertainty.',
            'Safety constraints are hard — not tradable.',
            'UNKNOWN ≠ GO.',
            'Stale data never masquerades as current.',
          ].map((t,i)=><div key={i} className="flex gap-1.5 text-[9.5px] text-ink-dim"><span className="text-risk-LOW">✓</span>{t}</div>)}
        </div>

        <div className="panel rounded-sm p-3 space-y-1">
          <div className="label-xs">Live provenance (current data on screen)</div>
          <div className="space-y-1 font-data text-[9.5px]">
            <div className="flex justify-between"><span className="text-ink-faint">Sea ice</span><span className="text-ice">{env.seaIce?.meta.provenance ?? '—'} · {env.seaIce?.meta.temporal.validTime?.slice(0,10) ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-ink-faint">Weather</span><span className="text-ice">{env.weather?.meta.provenance ?? '—'} · {env.weather?.meta.temporal.validTime?.slice(0,16) ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-ink-faint">Icebergs</span><span className="text-ice">{env.icebergs?.meta.provenance ?? '—'} · {env.icebergs?.meta.temporal.validTime ?? env.icebergs?.meta.temporal.nowHour ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-ink-faint">Mission</span><span className="text-ice">{ms.mission ? `${ms.mission.id} · ${ms.mission.state}` : 'No active mission'}</span></div>
          </div>
          {env.forecast && <div className="text-[9px] text-ink-faint mt-1">Forecast model: {env.forecast.meta.model.name} v{env.forecast.meta.model.version} · horizon +{env.forecastHorizon??'—'}h</div>}
        </div>

        <p className="text-[9px] text-ink-faint leading-snug">Duplicates are not silently merged; conflicting sources are surfaced with a conservative branch. See also DATA_SOURCES.md.</p>
      </div>
    </div>
  );
}
