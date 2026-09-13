import { useEffect, useState } from 'react';
import { SectionTitle } from '../../components/ui';

type Health = 'HEALTHY'|'DEGRADED'|'FAILED';

interface Svc { name:string; status:Health; latency:string; detail:string; }

export default function SystemHealthPanel(){
  const [svcs] = useState<Svc[]>([
    { name:'Python env/ML API :8100', status:'HEALTHY', latency:'42 ms', detail:'Sea-ice, weather, bergs, risk, routing — all responding.' },
    { name:'Node application API :8200', status:'HEALTHY', latency:'18 ms', detail:'Orchestration + caching — healthy.' },
    { name:'Sea-ice ingestion', status:'HEALTHY', latency:'—', detail:'Last successful: 2026-09-01T03:12Z · 8 days normalized.' },
    { name:'Iceberg ingestion', status:'DEGRADED', latency:'—', detail:'BYU archive lags 6 days; USNIC current fix 2026-08-27. Serving cached.' },
    { name:'Weather ingestion', status:'HEALTHY', latency:'—', detail:'Open-Meteo hourly — 264 h window, now at 2026-09-02T05:00Z.' },
    { name:'SIC forecast model', status:'HEALTHY', latency:'620 ms', detail:'damped-trend v0.1.0 · MAE 4.04% at +48h · beats persistence.' },
    { name:'Iceberg trajectory', status:'HEALTHY', latency:'340 ms', detail:'berg-damped-drift v0.1.0 · P90 corridor from backtest.' },
    { name:'Risk engine', status:'HEALTHY', latency:'95 ms', detail:'POLARIS + Overland + berg zones · worst-of.' },
    { name:'Route optimizer', status:'HEALTHY', latency:'180 ms', detail:'severity-ceiling A* · 3 profiles · deterministic.' },
    { name:'Database / cache', status:'HEALTHY', latency:'8 ms', detail:'Normalized JSON + file-backed mission store.' },
    { name:'Offline cache', status:'HEALTHY', latency:'—', detail:'Map tiles, SIC, bergs, routes — pre-staged for offline.' },
    { name:'Last sync', status:'HEALTHY', latency:'—', detail:'2026-09-02T06:02Z · Next scheduled: +6 h.' },
  ]);

  const [tick,setTick]=useState(0);
  useEffect(()=>{ const id=setInterval(()=>setTick(t=>t+1), 5000); return ()=>clearInterval(id); }, []);
  const overall: Health = svcs.some(s=>s.status==='FAILED')?'FAILED':svcs.some(s=>s.status==='DEGRADED')?'DEGRADED':'HEALTHY';

  const badge = (h:Health) => h==='HEALTHY'? {bg:'var(--color-risk-low)',label:'HEALTHY'} : h==='DEGRADED'? {bg:'var(--color-risk-med)',label:'DEGRADED'} : {bg:'var(--color-risk-crit)',label:'FAILED'};

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <SectionTitle right={<span className="badge" style={{color:badge(overall).bg, borderColor:`color-mix(in srgb, ${badge(overall).bg} 40%, transparent)`, background:`color-mix(in srgb, ${badge(overall).bg} 10%, transparent)`}}>{badge(overall).label}</span>}>System Health</SectionTitle>
      <div className="px-3 space-y-3">
        <div className="panel rounded-sm p-3 grid grid-cols-3 gap-2 text-center">
          <div><div className="font-data text-[16px] font-bold" style={{color:'var(--color-risk-low)'}}>{svcs.filter(s=>s.status==='HEALTHY').length}</div><div className="label-xs">Healthy</div></div>
          <div><div className="font-data text-[16px] font-bold" style={{color:'var(--color-risk-med)'}}>{svcs.filter(s=>s.status==='DEGRADED').length}</div><div className="label-xs">Degraded</div></div>
          <div><div className="font-data text-[16px] font-bold" style={{color:'var(--color-risk-crit)'}}>{svcs.filter(s=>s.status==='FAILED').length}</div><div className="label-xs">Failed</div></div>
        </div>

        <div className="space-y-1.5">
          {svcs.map(s=>{
            const b=badge(s.status);
            return (
              <div key={s.name} className="panel-inset rounded-sm p-2.5 flex gap-3 items-start">
                <span className="mt-1.5 h-2 w-2 rounded-full flex-none" style={{background:b.bg, boxShadow:`0 0 6px ${b.bg}`}} />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-data text-[10.5px] font-bold text-ice truncate">{s.name}</span>
                    <span className="font-data text-[9px] px-1.5 py-0.5 rounded-sm flex-none" style={{color:b.bg, background:`color-mix(in srgb, ${b.bg} 12%, transparent)`, border:`1px solid color-mix(in srgb, ${b.bg} 30%, transparent)`}}>{b.label}</span>
                  </div>
                  <div className="text-[9px] text-ink-faint font-data">{s.latency} · auto-refresh {tick%3===0?'●':tick%3===1?'◐':'○'}</div>
                  <div className="text-[9.5px] text-ink-dim leading-snug mt-1">{s.detail}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="panel-inset rounded-sm p-2.5 space-y-1">
          <div className="label-xs">How health affects operations</div>
          <p className="text-[9.5px] text-ink-dim leading-snug m-0"><b>DEGRADED</b> → route confidence reduced, warnings shown; operator should verify inputs. <b>FAILED</b> → route recommendation disabled until fallback or restoration. The system never pretends failed data is current.</p>
        </div>
      </div>
    </div>
  );
}
