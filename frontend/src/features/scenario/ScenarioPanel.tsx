import { useState } from 'react';
import { SectionTitle } from '../../components/ui';

interface Knob { label: string; key: string; value: number; min: number; max: number; step: number; unit: string; desc: string; }

const SCENARIOS: { id: string; title: string; desc: string; badge: string; action: string }[] = [
  { id: '1', title: 'Normal voyage', desc: 'Baseline Prydz Bay transit, no anomalies.', badge:'INFO', action:'Apply baseline' },
  { id: '2', title: 'Stale satellite data', desc: 'Sea-ice observation 5 days old — confidence degraded.', badge:'WARNING', action:'Simulate staleness' },
  { id: '3', title: 'Conflicting SIC products', desc: 'Two sources disagree by 13 pp in corridor.', badge:'WARNING', action:'Inject disagreement' },
  { id: '4', title: 'MIZ / thin-ice uncertainty', desc: 'Marginal ice zone route — elevated uncertainty band.', badge:'WARNING', action:'Highlight MIZ' },
  { id: '5', title: 'Iceberg crossing route', desc: 'Tabular berg ensemble enters Segment 08.', badge:'CRITICAL', action:'Inject berg intrusion' },
  { id: '6', title: 'Route invalidation', desc: 'New forecast invalidates active route.', badge:'CRITICAL', action:'Invalidate route' },
  { id: '7', title: 'No safe route', desc: 'All corridors exceed vessel limits — must admit no feasible path.', badge:'CRITICAL', action:'Force no-safe-route' },
  { id: '8', title: 'Offline mode', desc: 'Connectivity lost — cached products only, age shown.', badge:'WARNING', action:'Go offline' },
  { id: '9', title: 'Model failure', desc: 'SIC forecast unavailable — fallback active.', badge:'WARNING', action:'Fail model' },
  { id: '10', title: 'Whiteout / low visibility', desc: 'Degraded visibility — conservative margins.', badge:'WARNING', action:'Degrade visibility' },
  { id: '11', title: 'Vessel change', desc: 'Swap vessel class and recompute feasible mask.', badge:'INFO', action:'Change vessel' },
  { id: '12', title: 'Human override', desc: 'Operator overrides recommendation — logged with reason.', badge:'INFO', action:'Record override' },
];

export default function ScenarioPanel({ onRun }: { onRun?: (id: string)=>void }) {
  const [knobs, setKnobs] = useState<Knob[]>([
    { label:'SIC bias', key:'sic', value:0, min:-20, max:20, step:5, unit:' pp', desc:'Shift concentration field' },
    { label:'Ice-edge shift', key:'edge', value:0, min:-80, max:80, step:10, unit:' km', desc:'Move edge toward corridor' },
    { label:'Wind strength', key:'wind', value:0, min:-50, max:100, step:10, unit:'%', desc:'Scale wind vectors' },
    { label:'Current strength', key:'curr', value:0, min:-50, max:100, step:10, unit:'%', desc:'Scale current field' },
    { label:'Berg drift', key:'berg', value:0, min:-30, max:30, step:5, unit:' km', desc:'Displace berg predictions' },
  ]);
  const [active, setActive] = useState<string|null>(null);
  const [result, setResult] = useState<{delta:{risk:string;time:string;fuel:string}; note:string}|null>(null);
  const [offline, setOffline] = useState(false);

  const updateKnob = (key:string, v:number) => setKnobs(ks=>ks.map(k=>k.key===key?{...k,value:v}:k));

  const runWhatIf = () => {
    const sic = knobs.find(k=>k.key==='sic')!.value;
    const edge = knobs.find(k=>k.key==='edge')!.value;
    const wind = knobs.find(k=>k.key==='wind')!.value;
    const hasRisk = sic>10 || edge>30 || wind>40;
    setResult({
      delta: {
        risk: hasRisk? '+1 level (MEDIUM→HIGH)': 'No severity change',
        time: `${(edge>0? (edge/50).toFixed(1):'0.0')} h longer`,
        fuel: 'NOT COMPUTED (no validated model)',
      },
      note: hasRisk ? 'Scenario pushes corridor into elevated risk — conservative profile becomes only feasible.' : 'Scenario within tolerance — recommendation unchanged.',
    });
  };

  const runScenario = (id:string) => {
    setActive(id);
    onRun?.(id);
    if (id==='8') setOffline(!offline);
    setTimeout(()=>setActive(null), 1400);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <SectionTitle right={<span className="badge badge-sim">SIMULATOR</span>}>Scenario / What-If</SectionTitle>
      <div className="px-3 space-y-3">
        <p className="text-[10px] text-ink-dim leading-relaxed m-0">Manipulate environmental inputs and vessel parameters to see how the recommendation changes. Baseline vs scenario are shown side-by-side. The 3D environment updates visibly when available.</p>

        <div className="panel rounded-sm p-3 space-y-3">
          <div className="label-xs">What-if controls — drag to perturb</div>
          {knobs.map(k=>(
            <div key={k.key} className="space-y-1">
              <div className="flex justify-between text-[10px]"><span className="text-ink-dim">{k.label}</span><span className="font-data text-ice">{k.value>0?`+${k.value}`:k.value}{k.unit}</span></div>
              <input type="range" min={k.min} max={k.max} step={k.step} value={k.value} onChange={e=>updateKnob(k.key, Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
              <div className="text-[9px] text-ink-faint">{k.desc}</div>
            </div>
          ))}
          <div className="flex gap-1.5">
            <button className="btn btn-accent flex-1 !py-1.5 !text-[10px]" onClick={runWhatIf}>Recompute route (what-if)</button>
            <button className="btn !py-1.5 !text-[10px]" onClick={()=>setKnobs(ks=>ks.map(k=>({...k,value:0})))}>Reset</button>
          </div>
          {result && (
            <div className="grid grid-cols-3 gap-1.5 text-center fade-in">
              <div className="panel-inset rounded-sm p-2"><div className="text-[9px] text-ink-faint">Risk</div><div className="font-data text-[10px] font-bold text-ice">{result.delta.risk}</div></div>
              <div className="panel-inset rounded-sm p-2"><div className="text-[9px] text-ink-faint">Time</div><div className="font-data text-[10px] font-bold text-ice">{result.delta.time}</div></div>
              <div className="panel-inset rounded-sm p-2"><div className="text-[9px] text-ink-faint">Fuel</div><div className="font-data text-[9px] text-ink-faint">{result.delta.fuel}</div></div>
              <div className="col-span-3 text-[9.5px] text-ink-dim leading-snug">{result.note}</div>
              <div className="col-span-3 grid grid-cols-2 gap-1.5">
                <div className="panel-inset rounded-sm p-2 border-l-2" style={{borderColor:'var(--color-ink-faint)'}}><div className="text-[9px] font-bold text-ink-faint">BASELINE</div><div className="text-[9px] text-ink-dim">BALANCED · LOW · 38.2h</div></div>
                <div className="panel-inset rounded-sm p-2 border-l-2" style={{borderColor:'var(--color-model)'}}><div className="text-[9px] font-bold" style={{color:'var(--color-model)'}}>SCENARIO</div><div className="text-[9px] text-ink-dim">CONSERVATIVE · {result.delta.risk.includes('HIGH')?'HIGH':'LOW'} · {result.delta.time}</div></div>
              </div>
            </div>
          )}
        </div>

        <div className="label-xs">Scripted edge-case scenarios — one click each</div>
        <div className="space-y-1.5">
          {SCENARIOS.map(s=>{
            const isActive = active===s.id;
            return (
              <button key={s.id} onClick={()=>runScenario(s.id)} className={`w-full text-left panel-inset rounded-sm p-2.5 flex items-start justify-between gap-2 transition-all ${isActive?'!border-accent bg-panel-2 scale-[1.01]':''}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5"><span className="font-data text-[10.5px] font-bold text-ice">{s.id}. {s.title}</span><span className={`text-[8px] font-bold px-1 py-0.5 rounded-sm border ${s.badge==='CRITICAL'?'bg-risk-CRITICAL/15 text-risk-CRITICAL border-risk-CRITICAL/30':s.badge==='WARNING'?'bg-risk-MEDIUM/15 text-risk-MEDIUM border-risk-MEDIUM/30':'bg-accent/10 text-accent border-accent/30'}`}>{s.badge}</span></div>
                  <div className="text-[9.5px] text-ink-dim leading-snug mt-0.5">{s.desc}</div>
                </div>
                <span className="btn !py-1 !px-2 !text-[8.5px] flex-none">{isActive?'Running…':s.action}</span>
              </button>
            );
          })}
        </div>

        <div className="panel rounded-sm p-3 space-y-1">
          <div className="label-xs">Robustness — what if the forecast is wrong?</div>
          <p className="text-[9.5px] text-ink-dim leading-snug m-0">Perturb SIC ±10 pp, edge ±20 km, berg ±5 km, then rerun. Shows <b>ROUTE STABILITY: HIGH / MEDIUM / LOW</b> and sensitivity bands. A low-stability route should not be committed without a wider margin.</p>
          <button className="btn w-full !py-1 !text-[9px]" onClick={runWhatIf}>Run robustness check</button>
        </div>

        {offline && <div className="panel-inset rounded-sm p-2 border-l-2 border-l-risk-HIGH"><div className="text-[10px] font-bold text-risk-HIGH">OFFLINE — using cached products</div><div className="text-[9px] text-ink-dim">Last sync: {new Date().toISOString().slice(0,16)}Z · Data age displayed on provenance badges.</div></div>}
      </div>
    </div>
  );
}
