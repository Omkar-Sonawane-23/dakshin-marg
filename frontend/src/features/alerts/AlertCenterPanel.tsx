import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useEnv } from '../../state/envStore';
import { useMission } from '../../state/missionStore';
import { SectionTitle } from '../../components/ui';

type Sev = 'CRITICAL'|'WARNING'|'INFO';

interface UnifiedAlert { id:string; sev:Sev; title:string; body:string; time:string; source:string; ack:boolean; onAck?:()=>void; }

export default function AlertCenterPanel(){
  const demo = useStore();
  const env = useEnv();
  const ms = useMission();
  const [filter,setFilter]=useState<'ALL'|'CRITICAL'|'WARNING'|'INFO'>('ALL');
  const [acked,setAcked]=useState<Set<string>>(new Set());

  const alerts: UnifiedAlert[] = useMemo(()=>{
    const out: UnifiedAlert[] = [];
    if (demo.snapshot) {
      for (const a of demo.snapshot.alerts) out.push({ id:a.id, sev: a.severity==='CRITICAL'?'CRITICAL':a.severity==='WARNING'?'WARNING':'INFO', title:a.title, body:a.reason, time:`T+${a.timeOffsetH}h`, source:'DEMO', ack: demo.ackedAlerts.has(a.id) });
    }
    if (env.riskError) out.push({ id:'risk-err', sev:'WARNING', title:'Risk engine error', body: env.riskError.message, time:'now', source:'LIVE', ack:false });
    if (env.forecastError) out.push({ id:'fc-err', sev:'WARNING', title:'Forecast unavailable', body: env.forecastError.message, time:'now', source:'LIVE', ack:false });
    if (ms.reviewAlert) out.push({ id:'review', sev:'CRITICAL', title:'Route review required', body: ms.reviewAlert.primaryFactor + ' — ' + ms.reviewAlert.detail, time: ms.reviewAlert.simTime.slice(11,16), source:'MISSION', ack:false });
    if (ms.sim?.dataEdge) out.push({ id:'edge', sev:'WARNING', title:'End of data window', body: ms.sim.dataEdge, time:'sim', source:'MISSION', ack:false });
    if (env.drill && env.drillStage>=0 && !env.drillAccepted) {
      const st = env.drill.data.stages[env.drillStage];
      if (['CONFLICT_DETECTED','REPLAN','DECISION_PENDING'].includes(st.id)) out.push({ id:'drill', sev:'CRITICAL', title:'Re-planning: route conflict', body: st.narrative, time: st.simTime, source:'DRILL · SIMULATED', ack:false });
    }
    // dedup by title
    const seen = new Set<string>();
    return out.filter(a=>{ if(seen.has(a.title)) return false; seen.add(a.title); return true; });
  }, [demo.snapshot,demo.ackedAlerts, env.riskError, env.forecastError, env.drill, env.drillStage, env.drillAccepted, ms.reviewAlert, ms.sim]);

  const filtered = filter==='ALL'? alerts : alerts.filter(a=>a.sev===filter);
  const unacked = filtered.filter(a=>!a.ack && !acked.has(a.id)).length;

  const ack = (id:string) => {
    setAcked(s=>new Set(s).add(id));
    if(id.startsWith('demo-') || demo.snapshot?.alerts.find(a=>a.id===id)) demo.ackAlert(id);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <SectionTitle right={<span className={`badge ${unacked>0?'!border-risk-CRITICAL/40 !text-risk-CRITICAL':''}`}>{unacked>0? `${unacked} UNACKNOWLEDGED` : 'ALL ACKNOWLEDGED'}</span>}>Alert Center</SectionTitle>
      <div className="px-3 space-y-3">
        <div className="flex gap-1" role="tablist" aria-label="Severity filter">
          {(['ALL','CRITICAL','WARNING','INFO'] as const).map(f=>(
            <button key={f} role="tab" aria-selected={filter===f} onClick={()=>setFilter(f)} className={`btn !py-1 !px-2 !text-[9px] ${filter===f?'btn-accent':''}`}>{f}</button>
          ))}
          <span className="ml-auto text-[9px] text-ink-faint self-center">{filtered.length} alerts</span>
        </div>

        <div className="panel rounded-sm p-2 grid grid-cols-3 gap-2 text-center text-[10px]">
          <div><div className="font-bold text-risk-CRITICAL text-[14px]">{alerts.filter(a=>a.sev==='CRITICAL').length}</div><div className="label-xs">Critical</div></div>
          <div><div className="font-bold text-risk-MEDIUM text-[14px]">{alerts.filter(a=>a.sev==='WARNING').length}</div><div className="label-xs">Warning</div></div>
          <div><div className="font-bold text-accent text-[14px]">{alerts.filter(a=>a.sev==='INFO').length}</div><div className="label-xs">Info</div></div>
        </div>

        <div className="space-y-2">
          {filtered.length===0 && <div className="panel-inset rounded-sm p-6 text-center"><div className="text-[11px] text-ink-dim font-semibold">No {filter.toLowerCase()} alerts</div><div className="text-[10px] text-ink-faint mt-1">Alerts appear when environmental change affects the voyage. They require acknowledgement for CRITICAL severity.</div></div>}
          {filtered.map(a=>{
            const isAck = a.ack || acked.has(a.id);
            const border = a.sev==='CRITICAL'?'border-l-risk-CRITICAL':a.sev==='WARNING'?'border-l-risk-MEDIUM':'border-l-accent';
            return (
              <div key={a.id} className={`panel-inset rounded-sm border-l-2 ${border} p-3 space-y-1 ${isAck?'opacity-60':''} ${a.sev==='CRITICAL'&&!isAck?'animate-[alert-flash_2.4s_ease-out_1]':''}`}>
                <div className="flex justify-between gap-2">
                  <span className={`text-[10.5px] font-bold leading-tight ${a.sev==='CRITICAL'?'text-risk-CRITICAL':a.sev==='WARNING'?'text-risk-MEDIUM':'text-ice'}`}>{a.sev==='CRITICAL'?'■ ':a.sev==='WARNING'?'▲ ':'● '}{a.title}</span>
                  <span className="font-data text-[9px] text-ink-faint flex-none">{a.time}</span>
                </div>
                <p className="text-[10px] text-ink-dim leading-relaxed m-0">{a.body}</p>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-[9px] text-ink-faint font-data">{a.source}</span>
                  <div className="flex gap-1">
                    {a.sev==='CRITICAL' && !isAck && <span className="text-[8px] font-bold text-risk-CRITICAL border border-risk-CRITICAL/30 rounded-sm px-1 py-0.5">REQUIRES ACK</span>}
                    {!isAck ? <button className="btn !py-0.5 !px-2 !text-[8.5px]" onClick={()=>ack(a.id)}>Acknowledge</button> : <span className="text-[9px] text-risk-LOW">✓ Acknowledged</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="panel-inset rounded-sm p-2.5 space-y-1">
          <div className="label-xs">Delivery & suppression rules</div>
          <p className="text-[9px] text-ink-faint leading-snug m-0">CRITICAL alerts are never suppressed by INFO/WARNING filters. Deduplication collapses identical titles; escalation requires explicit acknowledgement. Offline queue holds alerts until sync.</p>
        </div>
      </div>
    </div>
  );
}
