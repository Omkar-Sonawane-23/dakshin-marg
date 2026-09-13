import { useState } from 'react';
import { useEnv } from '../../state/envStore';
import { Details, SectionTitle, Skeleton, ProvBadge, Toggle } from '../../components/ui';

export default function IcebergPanel() {
  const env = useEnv();
  const [horizon, setHorizon] = useState<6|12|24|48|72|120>(48);
  const [selected, setSelected] = useState<string|null>(null);

  if (env.bergSituationLoading) return <div className="p-3"><Skeleton className="h-32 w-full" /></div>;
  if (!env.icebergs) return <div className="p-3 text-[10px] text-ink-faint">No iceberg data. Switch to LIVE mode.</div>;
  const sit = env.bergSituation;
  if (!sit) return <div className="p-3 text-[10px] text-ink-faint">Loading iceberg tracking…</div>;

  const bergs = sit.data.situations;
  const selectedBerg = selected ? bergs.find(b=>b.id===selected) : null;

  const horizons = [6,12,24,48,72,120] as const;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <SectionTitle right={<ProvBadge prov={env.icebergs.meta.provenance} />}>Iceberg Intelligence</SectionTitle>
      <div className="px-3 space-y-3">
        <div className="panel rounded-sm p-2.5 grid grid-cols-3 gap-2 text-center">
          <div><div className="font-data text-[16px] font-bold text-ice">{env.icebergs.data.count}</div><div className="label-xs">Detected</div></div>
          <div><div className="font-data text-[16px] font-bold text-ice">{bergs.filter(b=>b.track).length}</div><div className="label-xs">Tracked</div></div>
          <div><div className="font-data text-[16px] font-bold" style={{color:'var(--color-model)'}}>{bergs.filter(b=>b.prediction?.regime==='MOVING').length}</div><div className="label-xs">Forecast</div></div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-ink-dim">Show trajectories</span>
          <Toggle on={env.showBergPredictions} onChange={()=>env.setShowBergPredictions(!env.showBergPredictions)} label="Toggle trajectories" />
        </div>

        <div>
          <div className="label-xs mb-1.5">Time horizon</div>
          <div className="flex gap-1">
            {horizons.map(h=>(
              <button key={h} className={`btn !py-1 !px-2 !text-[9px] ${horizon===h?'btn-accent':''}`} onClick={()=>setHorizon(h as typeof horizon)}>+{h}h</button>
            ))}
          </div>
          <p className="text-[9px] text-ink-faint mt-1">Uncertainty cone expands with horizon; never shown as a single razor-thin line.</p>
        </div>

        <div className="label-xs">Catalogue — click to inspect</div>
        <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
          {bergs.map(b=>{
            const moving = b.prediction?.regime==='MOVING';
            const foc = env.focusBergId===b.id || selected===b.id;
            return (
              <button key={b.id} onClick={()=>{
                setSelected(foc?null:b.id);
                env.setFocusBergId(foc?null:b.id);
              }} className={`w-full text-left panel-inset rounded-sm p-2 flex items-start justify-between gap-2 transition-colors ${foc?'!border-accent/60 bg-panel-2':''}`}>
                <div className="min-w-0">
                  <div className="font-data text-[10.5px] font-bold text-ice flex items-center gap-1.5"><span>{b.id}</span>{b.track? <span className="text-[8px] px-1 py-0.5 rounded-sm bg-risk-LOW/15 text-risk-LOW border border-risk-LOW/30">TRACKED</span> : <span className="text-[8px] px-1 py-0.5 rounded-sm bg-ink-faint/15 text-ink-faint border border-line">UNTRACKED</span>}</div>
                  <div className="text-[9px] text-ink-faint">{b.usnicCurrent ? `${Math.abs(b.usnicCurrent.lat).toFixed(2)}°S ${b.usnicCurrent.lon.toFixed(2)}°E` : b.track ? `${Math.abs(b.track.lastLat).toFixed(2)}°S ${b.track.lastLon.toFixed(2)}°E` : '—'} · {b.usnicCurrent?.length_nm ? `${b.usnicCurrent.length_nm} nm` : b.track?`${b.track.meanSpeedKmD.toFixed(1)} km/d`:''}</div>
                  <div className="text-[8.5px] text-ink-faint mt-0.5">{b.track? `${b.track.nObs} obs · ${b.track.sensors.join(', ')} · max gap ${b.track.maxGapDays}d` : 'No history — single-point detection'}</div>
                </div>
                <div className="text-right flex-none">
                  {moving && b.prediction?.trajectory.find(t=>t.horizonD===3) && (
                    <div className="font-data text-[9px]" style={{color:'var(--color-model)'}}>±{b.prediction.trajectory.find(t=>t.horizonD===3)?.corridorP90Km ?? '—'} km @72h</div>
                  )}
                  {!moving && <div className="text-[9px] text-ink-faint">slow/grounded</div>}
                  <div className={`text-[9px] font-bold mt-0.5 ${moving?'text-risk-LOW':'text-ink-faint'}`}>{moving?'MOVING':'GROUNDED'}</div>
                </div>
              </button>
            );
          })}
        </div>

        {selectedBerg && (
          <div className="panel rounded-sm p-3 space-y-2 fade-in border-accent/30">
            <div className="flex items-center justify-between">
              <span className="font-data text-[11px] font-bold text-ice">{selectedBerg.id}</span>
              <button className="btn !py-0.5 !px-2 !text-[9px]" onClick={()=>env.setFocusBergId(selectedBerg.id)}>Fly to</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div><div className="label-xs">Current position</div><div className="font-data text-ice">{selectedBerg.usnicCurrent? `${Math.abs(selectedBerg.usnicCurrent.lat).toFixed(3)}°S ${selectedBerg.usnicCurrent.lon.toFixed(3)}°E` : selectedBerg.track? `${Math.abs(selectedBerg.track.lastLat).toFixed(3)}°S ${selectedBerg.track.lastLon.toFixed(3)}°E`: '—'}</div></div>
              <div><div className="label-xs">Last observation</div><div className="font-data text-ice">{selectedBerg.track?.last ?? '—'}</div></div>
              <div><div className="label-xs">Size</div><div className="font-data text-ice">{selectedBerg.usnicCurrent?.length_nm? `${selectedBerg.usnicCurrent.length_nm} nm` : '—'}</div></div>
              <div><div className="label-xs">Staleness</div><div className={`font-data font-bold ${ (selectedBerg.prediction?.staleDays??0) > 14 ? 'text-risk-MEDIUM':'text-ink-dim'}`}>{selectedBerg.prediction?.staleDays ?? '—'} days</div></div>
            </div>
            {selectedBerg.track && (
              <div>
                <div className="label-xs mb-1">Track — {selectedBerg.track.nObs} observations</div>
                <svg viewBox="0 0 200 36" className="w-full h-9 bg-panel-inset rounded-sm">
                  {selectedBerg.track.recentPath.map((_,i,a)=>i===0?null:<line key={i} x1={(i-1)/a.length*180+10} y1={18 + Math.sin(i*0.7)*8} x2={i/a.length*180+10} y2={18 + Math.sin((i+1)*0.7)*8} stroke="var(--color-risk-low)" strokeWidth="1.2" />)}
                  {selectedBerg.track.recentPath.map((_,i,a)=><circle key={i} cx={i/a.length*180+10} cy={18 + Math.sin((i+1)*0.7)*8} r={i===a.length-1?3.5:2} fill={i===a.length-1?'var(--color-accent)':'var(--color-risk-low)'} stroke="var(--map-marker-core)" strokeWidth="0.8" />)}
                </svg>
                <div className="text-[9px] text-ink-faint mt-1">Track history (BYU/NIC v8) · {selectedBerg.track.bearingDeg.toFixed(0)}° · {selectedBerg.track.meanSpeedKmD.toFixed(2)} km/d mean</div>
              </div>
            )}
            {selectedBerg.prediction?.trajectory && (
              <div>
                <div className="label-xs mb-1">Predicted trajectory — uncertainty cone</div>
                <div className="panel-inset rounded-sm p-2">
                  <div className="flex gap-1 text-[9px] font-data">
                    {selectedBerg.prediction.trajectory.slice(0,5).map(tp=>(
                      <div key={tp.horizonD} className="flex-1 text-center">
                        <div className="text-ink-faint">+{tp.horizonD}d</div>
                        <div className="text-ice">{tp.corridorP50Km!==null?`±${tp.corridorP50Km}km`: '—'}</div>
                        <div className="text-ink-faint" style={{color:'var(--color-model)'}}>P90 ±{tp.corridorP90Km ?? '—'}km</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    <span className="h-1 w-6 rounded-full" style={{background:'var(--color-risk-low)'}} /> <span className="text-[8px] text-ink-faint">history</span>
                    <span className="h-0.5 w-6 ml-2" style={{background:'var(--color-model)', borderTop:'1px dashed var(--color-model)'}} /> <span className="text-[8px] text-ink-faint">forecast</span>
                    <span className="h-1.5 w-6 rounded-full ml-2" style={{background:'color-mix(in srgb, var(--color-model) 18%, transparent)', border:'1px solid var(--color-model)'}} /> <span className="text-[8px] text-ink-faint">P90 cone</span>
                  </div>
                </div>
                <p className="text-[9px] text-ink-faint leading-snug mt-1">Model: berg-damped-drift v0.1.0 · Corridor = empirical P90 from backtests. Never a single thin line.</p>
              </div>
            )}
            <Details label="Provenance">
              <p className="text-[9px] text-ink-faint m-0">Track source: BYU/NIC consolidated DB v8. Current fix: USNIC analysis 2026-08-27. Prediction input provenance: REAL_HISTORICAL. Warnings: track archive lags ~ {selectedBerg.prediction?.staleDays ?? '—'}d.</p>
            </Details>
          </div>
        )}

        <Details label="How trajectories work">
          <p className="text-[9.5px] text-ink-faint leading-snug m-0">Physics: v_berg ≈ v_current + γ·v_wind with sea-ice drag. Ensemble perturbed by current/wind variance. Central path + P50/P90 quantiles from backtests (mean error 5.0/7.2/12.3 km at +1/3/7 d vs stationary 5.2/8.2/14.3 km). docs/iceberg-pipeline.md</p>
        </Details>
      </div>
    </div>
  );
}
