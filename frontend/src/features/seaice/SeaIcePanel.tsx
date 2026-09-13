import { useEnv, FORECAST_HORIZONS } from '../../state/envStore';
import { Details, SectionTitle, Skeleton, ProvBadge, Toggle } from '../../components/ui';

export default function SeaIcePanel() {
  const env = useEnv();
  if (env.loading) return <div className="p-3"><Skeleton className="h-40 w-full" /></div>;
  if (!env.seaIce) return <div className="p-3 text-[10px] text-ink-faint">No sea-ice data loaded. Switch to LIVE mode.</div>;
  const si = env.seaIce;
  const fc = env.forecast;
  const active = env.forecastHorizon;
  const latest = env.seaIceTimes[0];
  const stalenessH = latest ? (Date.now() - Date.parse(latest)) / 3600_000 : 0;
  const freshness = stalenessH < 36 ? 'FRESH' : stalenessH < 72 ? 'AGING' : stalenessH < 120 ? 'STALE' : 'UNUSABLE';

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <SectionTitle right={<ProvBadge prov={active!==null?'MODEL_FORECAST':si.meta.provenance} />}>Sea-Ice Analysis</SectionTitle>
      <div className="px-3 space-y-3">
        <div className="panel rounded-sm p-2.5 grid grid-cols-2 gap-2">
          <div><div className="label-xs">Analysis valid</div><div className="font-data text-[11px] text-ice">{si.meta.temporal.validTime?.slice(0,16).replace('T',' ')}Z</div></div>
          <div><div className="label-xs">Source</div><div className="text-[10px] text-ink-dim truncate">{si.meta.source.name ?? 'NSIDC SIC v4'}</div></div>
          <div><div className="label-xs">Mean concentration</div><div className="font-data text-[13px] text-ice">{si.data.stats.meanConcPct ?? '—'}<span className="text-[10px] text-ink-faint">%</span></div></div>
          <div><div className="label-xs">Max concentration</div><div className="font-data text-[13px] text-ice">{si.data.stats.maxConcPct ?? '—'}<span className="text-[10px] text-ink-faint">%</span></div></div>
          <div><div className="label-xs">Freshness</div><div className={`font-data text-[10px] font-bold ${freshness==='FRESH'?'text-risk-LOW':freshness==='AGING'?'text-risk-MEDIUM':freshness==='STALE'?'text-risk-HIGH':'text-risk-CRITICAL'}`}>{freshness} · {stalenessH.toFixed(0)}h ago</div></div>
          <div><div className="label-xs">Valid cells</div><div className="font-data text-[10px] text-ice">{si.data.stats.validCells.toLocaleString()}</div></div>
        </div>

        {freshness!=='FRESH' && (
          <div className={`panel-inset rounded-sm p-2 border-l-2 ${freshness==='STALE'||freshness==='UNUSABLE'?'border-l-risk-CRITICAL':'border-l-risk-MEDIUM'}`}>
            <div className="text-[10px] font-bold" style={{color: freshness==='STALE'||freshness==='UNUSABLE'?'var(--color-risk-crit)':'var(--color-risk-med)'}}>{freshness==='STALE'?'▲ DATA STALE':freshness==='UNUSABLE'?'■ DATA UNUSABLE':'◆ DATA AGING'}</div>
            <p className="text-[9.5px] text-ink-dim leading-snug mt-1">Latest observation {stalenessH.toFixed(1)}h old. Confidence reduced. Route confidence should be downgraded; re-check before committing.</p>
          </div>
        )}

        <div>
          <div className="label-xs mb-1.5">Observation history</div>
          <input type="range" className="timeline" min={0} max={Math.max(0, env.seaIceTimes.length-1)} value={env.seaIceTimes.length-1-env.seaIceIndex} style={{'--fill':`${((env.seaIceTimes.length-1-env.seaIceIndex)/Math.max(1,env.seaIceTimes.length-1))*100}%`} as React.CSSProperties} onChange={e=>env.setSeaIceIndex(env.seaIceTimes.length-1-Number(e.target.value))} aria-label="Sea-ice day" />
          <div className="flex justify-between font-data text-[8.5px] text-ink-faint mt-1">
            <span>{env.seaIceTimes[env.seaIceTimes.length-1]?.slice(5,10)}</span>
            <span className="text-accent font-bold">{env.seaIceTimes[env.seaIceIndex]?.slice(0,10)} (viewing)</span>
            <span>{env.seaIceTimes[0]?.slice(5,10)} latest</span>
          </div>
        </div>

        <div>
          <div className="label-xs mb-1.5">Forecast</div>
          <div className="flex gap-1">
            <button className={`btn !py-1 !px-2.5 !text-[9px] ${active===null?'btn-accent':''}`} onClick={()=>env.setForecastHorizon(null)}>Observations</button>
            {FORECAST_HORIZONS.map(h=>(
              <button key={h} className={`btn !py-1 !px-2.5 !text-[9px] ${active===h?'!bg-[color-mix(in srgb,var(--color-model)20%,transparent)] !border-[color-mix(in srgb,var(--color-model)60%,transparent)] !text-[var(--color-model)]':''}`} onClick={()=>env.setForecastHorizon(h)}>+{h}h</button>
            ))}
          </div>
          {env.forecastLoading && <div className="text-[10px] text-accent mt-2 flex items-center gap-1.5"><span className="pulse-dot">●</span> Computing forecast…</div>}
          {env.forecastError && <div className="mt-2 text-[9.5px] text-risk-HIGH border-l-2 border-l-risk-HIGH pl-2">{env.forecastError.code}: {env.forecastError.message}</div>}
          {fc && active!==null && !env.forecastLoading && (
            <div className="panel-inset rounded-sm p-2.5 mt-2 space-y-2 fade-in">
              <div className="flex justify-between text-[10px]"><span className="text-ink-dim">Valid</span><span className="font-data text-ice">{fc.meta.temporal.validTime.slice(0,16).replace('T',' ')}Z</span></div>
              <div className="flex justify-between text-[10px]"><span className="text-ink-dim">Mean conc.</span><span className="font-data text-ice">{fc.data.stats.meanConcPct}%</span></div>
              <div className="flex justify-between text-[10px]"><span className="text-ink-dim">Uncertainty (σ)</span><span className="font-data" style={{color:'var(--color-model)'}}>±{fc.data.uncertainty.meanSigmaPct}%</span></div>
              <div className="flex justify-between items-center"><span className="text-[10px] text-ink-dim">Show σ layer</span><Toggle on={env.showSigma} onChange={()=>env.setShowSigma(!env.showSigma)} label="Toggle uncertainty" /></div>
              <div className="h-1.5 bg-line rounded-full overflow-hidden"><div className="h-full" style={{width:`${Math.min(100,fc.data.uncertainty.meanSigmaPct*8)}%`, background:'var(--color-model)'}} /></div>
              <Details label="Model & validation">
                <p className="text-[9.5px] text-ink-faint leading-snug m-0">{fc.meta.model.name} v{fc.meta.model.version} · beats {fc.meta.model.baseline} by walk-forward backtest ({fc.meta.model.trainWindowDays}d). MAE +{active}h: {fc.data.uncertainty.backtestMaePct}% · RMSE {fc.data.uncertainty.backtestRmsePct}%.</p>
                <p className="text-[9px] text-ink-faint m-0">Method: damped trend + empirical per-cell volatility. Uncertainty is backtest MAE.</p>
                {fc.data.validation.notes.map((n,i)=><p key={i} className="text-[9px] text-ink-faint m-0">· {n}</p>)}
              </Details>
            </div>
          )}
        </div>

        <div className="panel-inset rounded-sm p-2.5 space-y-1.5">
          <div className="label-xs">Ice-edge uncertainty</div>
          <p className="text-[9.5px] text-ink-dim leading-snug m-0">Edge band ±{env.forecast?.data.uncertainty.meanSigmaPct ?? 4}% concentration. Uncertainty halo expands with horizon; treat marginal ice zone (15–80%) as elevated uncertainty.</p>
          <div className="flex gap-1 items-center">
            <span className="h-1.5 w-8 rounded-full" style={{background:'color-mix(in srgb, var(--color-ice) 60%, transparent)'}} />
            <span className="text-[9px] text-ink-faint">ice concentration ramp</span>
            <span className="h-1.5 w-8 rounded-full ml-2" style={{background:'var(--color-model)'}} />
            <span className="text-[9px] text-ink-faint">σ halo</span>
          </div>
        </div>

        <Details label="Provenance">
          <p className="text-[9.5px] text-ink-faint leading-snug m-0">Source: {si.meta.source.name} ({si.meta.source.provider}) · {si.meta.source.url}</p>
          <p className="text-[9.5px] text-ink-faint m-0">Served {new Date(si.meta.servedAt).toISOString().slice(0,19)}Z · Quality {si.meta.quality}</p>
          {si.meta.warnings.length>0 && si.meta.warnings.map((w,i)=><p key={i} className="text-[9.5px] text-risk-MEDIUM m-0">⚠ {w}</p>)}
        </Details>
      </div>
    </div>
  );
}
