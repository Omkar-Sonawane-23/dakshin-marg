import { useState } from 'react';
import { useEnv } from '../../state/envStore';
import { Details, SectionTitle, Toggle } from '../../components/ui';

const SEV_ICON: Record<string,string> = { LOW:'●', MEDIUM:'◆', HIGH:'▲', CRITICAL:'■' };
const SEV_COLOR: Record<string,string> = { LOW:'var(--color-risk-low)', MEDIUM:'var(--color-risk-med)', HIGH:'var(--color-risk-high)', CRITICAL:'var(--color-risk-crit)' };
const ICE_CLASSES = ['PC1','PC2','PC3','PC4','PC5','PC7','IA','IB','NONE'];

function SevChip({sev}:{sev:string}){ return <span className="font-data text-[10px] font-bold" style={{color: SEV_COLOR[sev]}}>{SEV_ICON[sev]} {sev}</span>; }

export default function RiskPanel(){
  const env = useEnv();
  const [showWhy,setShowWhy]=useState(true);
  const [viewMode,setViewMode]=useState<'spatial'|'route'>('spatial');
  const r = env.risk?.data;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <SectionTitle right={<span className="badge" style={{color:'var(--color-risk-med)',borderColor:'color-mix(in srgb, var(--color-risk-med) 40%, transparent)',background:'color-mix(in srgb, var(--color-risk-med) 10%, transparent)'}}>POLARIS</span>}>Risk & Navigability</SectionTitle>
      <div className="px-3 space-y-3">
        <div className="panel rounded-sm p-3 space-y-2">
          <div className="label-xs">Decision-support boundary</div>
          <p className="text-[10px] text-ink-dim leading-relaxed m-0">This is a <b>decision-support</b> assessment. The human operator remains responsible. System prefers <span className="text-risk-CRITICAL font-bold">NO SAFE ROUTE</span> over a false sense of safety, and <span className="font-bold">HIGH UNCERTAINTY</span> over false confidence.</p>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink">Show risk on map</span>
          <Toggle on={env.riskEnabled} onChange={()=>env.setRiskEnabled(!env.riskEnabled)} label="Toggle risk" />
        </div>

        <div>
          <div className="label-xs mb-1.5">Vessel ice class — drives POLARIS RIO</div>
          <div className="flex gap-1 flex-wrap">
            {ICE_CLASSES.map(c=>(
              <button key={c} onClick={()=>env.setRiskIceClass(c)} className={`btn !py-1 !px-2 !text-[9px] ${env.riskIceClass===c?'btn-accent':''}`}>{c}</button>
            ))}
          </div>
          <p className="text-[9px] text-ink-faint mt-1">Same corridor, different vessel → different feasible mask. Demonstrate with VESSEL panel comparison.</p>
        </div>

        {env.riskLoading && <div className="flex gap-2 text-[10px] text-accent items-center"><span className="pulse-dot">●</span> Assessing risk…</div>}
        {env.riskError && <div className="text-[9.5px] text-risk-HIGH border-l-2 border-l-risk-HIGH pl-2">{env.riskError.code}: {env.riskError.message}</div>}

        {r && !env.riskLoading && (
          <>
            <div className="flex gap-1" role="tablist">
              <button className={`btn !py-1 !px-3 !text-[9px] ${viewMode==='spatial'?'btn-accent':''}`} onClick={()=>setViewMode('spatial')}>Spatial map</button>
              <button className={`btn !py-1 !px-3 !text-[9px] ${viewMode==='route'?'btn-accent':''}`} onClick={()=>setViewMode('route')}>Per-route</button>
            </div>

            <div className="panel rounded-sm p-3 space-y-2">
              <div className="flex justify-between items-center"><span className="label-xs">Overall severity (worst cell)</span><SevChip sev={r.overall.severity} /></div>
              <div className="flex gap-1">
                {r.grid.severityScale.map(s=>(
                  <div key={s} className="flex-1 text-center">
                    <div className="h-2 rounded-full" style={{background: SEV_COLOR[s], opacity: r.overall.extentPct[s]>0?1:0.18}} />
                    <div className="font-data text-[8.5px] mt-1" style={{color: r.overall.extentPct[s]>0? SEV_COLOR[s]:'var(--color-ink-faint)'}}>{SEV_ICON[s]} {r.overall.extentPct[s]}%</div>
                    <div className="text-[8px] text-ink-faint">{s}</div>
                  </div>
                ))}
              </div>
              <div className="text-[9px] text-ink-faint">Valid cells: {r.overall.validCells.toLocaleString()} · Grid {r.grid.nLon}×{r.grid.nLat}</div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {(['seaIce','icebergs','icing'] as const).map(k=>{
                const label = k==='seaIce'?'Sea ice':k==='icebergs'?'Icebergs':'Icing';
                const sev = r.contributors[k as keyof typeof r.contributors] as {severity:string};
                return (
                  <div key={k} className="panel-inset rounded-sm p-2 text-center">
                    <div className="text-[9px] text-ink-faint">{label}</div>
                    <div className="mt-1"><SevChip sev={sev.severity} /></div>
                  </div>
                );
              })}
            </div>

            <div className="panel rounded-sm p-3 space-y-1.5">
              <div className="label-xs">Navigability classification</div>
              <div className="grid grid-cols-4 gap-1 text-[9px] font-bold text-center">
                <span className="py-1 rounded-sm bg-risk-LOW/15 text-risk-LOW border border-risk-LOW/30">GO</span>
                <span className="py-1 rounded-sm bg-risk-MEDIUM/15 text-risk-MEDIUM border border-risk-MEDIUM/30">CAUTION</span>
                <span className="py-1 rounded-sm bg-risk-HIGH/15 text-risk-HIGH border border-risk-HIGH/30">NO-GO</span>
                <span className="py-1 rounded-sm bg-ink-faint/10 text-ink-faint border border-line">UNKNOWN</span>
              </div>
              <p className="text-[9px] text-ink-faint m-0">UNKNOWN is never treated as GO. Hard constraints (land, shelves, shallow draft, POLARIS elevated risk) are applied <b>before</b> optimization.</p>
            </div>

            <button className="btn w-full !py-1 !text-[9px]" onClick={()=>setShowWhy(!showWhy)}>{showWhy?'▾ Hide detailed breakdown':'▸ Why this assessment?'}</button>
            {showWhy && (
              <div className="space-y-2 fade-in">
                <div className="panel-inset rounded-sm p-2.5 space-y-1">
                  <div className="label-xs">Explanations (generated from computed values)</div>
                  {r.explanations.map((e,i)=><p key={i} className="text-[9.5px] text-ink-dim leading-relaxed m-0">· {e}</p>)}
                </div>
                <div className="panel-inset rounded-sm p-2.5 space-y-1">
                  <div className="label-xs">Assumptions & limits (declared)</div>
                  {r.assumptions.map((a,i)=><p key={i} className="text-[9px] text-ink-faint leading-snug m-0">△ {a}</p>)}
                </div>
                <div className="panel-inset rounded-sm p-2.5 space-y-1">
                  <div className="label-xs">Per-contributor worst</div>
                  <div className="text-[9.5px] text-ink-dim font-data">Sea-ice RIO {(r.contributors.seaIce as {worstRio:number}).worstRio} · Icing PPR {(r.contributors.icing as {maxPpr:number}).maxPpr} · {(r.contributors.icebergs as {zoneCount:number}).zoneCount} berg zones</div>
                  <p className="text-[9px] text-ink-faint m-0">Combination: worst-of (max) across contributors — no weighted averaging. See docs/risk-methodology.md.</p>
                </div>
              </div>
            )}

            {viewMode==='route' && env.routePlan?.data && (
              <div className="space-y-2">
                <div className="label-xs">Route exposure breakdown</div>
                {env.routePlan.data.routes.filter(r=>r.status==='OK'&&r.risk).map(route=>(
                  <div key={route.profile} className="panel-inset rounded-sm p-2">
                    <div className="flex justify-between text-[10px]"><span className="font-bold text-ice">{route.profile}</span><SevChip sev={route.risk!.overallSeverity} /></div>
                    <div className="mt-1 space-y-0.5">
                      {(['seaIce','icebergs','icing'] as const).map(k=>{
                        const exp = route.risk!.exposureByContributor[k];
                        if(!exp) return null;
                        const high = (exp.HIGH??0)+(exp.CRITICAL??0);
                        return <div key={k} className="flex justify-between text-[9px]"><span className="text-ink-faint">{k}</span><span className={`font-data ${high>0?'text-risk-HIGH':'text-risk-LOW'}`}>{high.toFixed(1)}% high+</span></div>;
                      })}
                    </div>
                    {route.risk!.bergEncounters.length>0 && <div className="text-[9px] text-ink-faint mt-1">Berg encounters: {route.risk!.bergEncounters.map(b=>`${b.id} ${b.severity} @${b.closestKm}km`).join(', ')}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <Details label="Methodology — POLARIS + Overland + berg zones">
          <p className="text-[9.5px] text-ink-faint leading-snug m-0">POLARIS RIO per IMO MSC.1/Circ.1519 Table 1.1 × vessel class. Overland (1990) vessel-icing predictor (T_air, wind, sea-state). Berg zones from backtested drift-error quantiles (P50/P90). Worst-of combination.</p>
        </Details>
      </div>
    </div>
  );
}
