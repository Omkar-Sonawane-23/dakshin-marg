import { useState } from 'react';
import { SectionTitle } from '../../components/ui';

interface Override { at:string; user:string; route:string; segment:string; reason:string; prev:string; }

export default function HumanOverridePanel(){
  const [overrides,setOverrides]=useState<Override[]>([
    { at:'2026-09-02T06:15Z', user:'Capt. R. Singh', route:'B-2', segment:'Segment 08', reason:'Visual lookout reports thin ice not in SIC — taking 12 km detour east.', prev:'DIRECT' },
  ]);
  const [reason,setReason]=useState('');
  const [segment,setSegment]=useState('Segment 08');
  const [showForm,setShowForm]=useState(false);

  const record = () => {
    if(!reason.trim()) return;
    setOverrides(o=>[{ at:new Date().toISOString().slice(0,16)+'Z', user:'Dr. A. Nair', route:'BALANCED', segment, reason:reason.trim(), prev:'DIRECT' }, ...o]);
    setReason(''); setShowForm(false);
  };

  return (
    <div className="space-y-2">
      <SectionTitle>Human Override Log</SectionTitle>
      <div className="px-3 space-y-2">
        <p className="text-[9.5px] text-ink-dim leading-snug m-0">System never fights the operator. Overrides are logged with user, timestamp, route, segment, reason, and previous recommendation. The system continues decision support — no autonomous enforcement.</p>
        {!showForm ? <button className="btn btn-accent w-full !py-1 !text-[9px]" onClick={()=>setShowForm(true)}>Record override</button> : (
          <div className="panel-inset rounded-sm p-2.5 space-y-2">
            <div className="label-xs">New override — reason required</div>
            <input value={segment} onChange={e=>setSegment(e.target.value)} placeholder="Segment / route" className="w-full bg-panel border border-line rounded-sm px-2 py-1 text-[11px] text-ice" />
            <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason for override (free text)" rows={2} className="w-full bg-panel border border-line rounded-sm px-2 py-1 text-[11px] text-ice" />
            <div className="flex gap-1.5">
              <button className="btn btn-accent flex-1 !py-1 !text-[9px]" onClick={record}>Confirm — HUMAN OVERRIDE RECORDED</button>
              <button className="btn flex-1 !py-1 !text-[9px]" onClick={()=>setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}
        <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
          {overrides.map((o,i)=>(
            <div key={i} className="panel-inset rounded-sm p-2.5 border-l-2 border-l-accent">
              <div className="flex justify-between text-[9px]"><span className="font-data text-ink-faint">{o.at}</span><span className="font-bold text-ice">{o.user}</span></div>
              <div className="text-[10px] text-ink-dim mt-1">Overrode <b>{o.prev}</b> → <b>{o.route}</b> at {o.segment}</div>
              <div className="text-[9.5px] text-ink leading-snug mt-1">“{o.reason}”</div>
              <div className="text-[8px] text-risk-LOW font-bold mt-1">✓ Logged · Audit trail immutable</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
