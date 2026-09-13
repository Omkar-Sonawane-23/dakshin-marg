import { useState } from 'react';
import { useEnv } from '../../state/envStore';
import { useStore } from '../../state/store';
import { Details, SectionTitle, Skeleton, ProvBadge, Toggle } from '../../components/ui';

export default function WeatherPanel() {
  const env = useEnv();
  const { layers, toggleLayer } = useStore();
  const [vectorDensity, setVectorDensity] = useState(1);
  const [showTemp, setShowTemp] = useState(false);
  const [opacity, setOpacity] = useState(70);

  if (env.loading) return <div className="p-3"><Skeleton className="h-32 w-full" /></div>;
  if (!env.weather) return <div className="p-3 text-[10px] text-ink-faint">No weather data. Switch to LIVE mode.</div>;
  const wx = env.weather.data;
  const cells = wx.cells;
  const maxWind = wx.summary.maxWindKn ?? 0;
  const meanWind = wx.summary.meanWindKn ?? 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <SectionTitle right={<ProvBadge prov={env.weather.meta.provenance} />}>Weather & Ocean</SectionTitle>
      <div className="px-3 space-y-3">
        <div className="panel rounded-sm p-2.5 grid grid-cols-3 gap-2 text-center">
          <div><div className="font-data text-[15px] font-bold text-ice">{maxWind}<span className="text-[10px] text-ink-faint"> kn</span></div><div className="label-xs">Max wind</div></div>
          <div><div className="font-data text-[15px] font-bold text-ice">{meanWind}<span className="text-[10px] text-ink-faint"> kn</span></div><div className="label-xs">Mean wind</div></div>
          <div><div className="font-data text-[15px] font-bold text-ice">{wx.summary.minTempC ?? '—'}<span className="text-[10px] text-ink-faint"> °C</span></div><div className="label-xs">Min temp</div></div>
        </div>

        <div className="panel-inset rounded-sm p-2.5 space-y-2">
          <div className="label-xs">Valid hour</div>
          <div className="font-data text-[12px] text-accent">{wx.hour.replace('T',' ')}Z</div>
          <input type="range" className="timeline" min={0} max={Math.max(0, env.weatherTimes.length-1)} value={env.weatherIndex} style={{'--fill':`${(env.weatherIndex/Math.max(1,env.weatherTimes.length-1))*100}%`} as React.CSSProperties} onChange={e=>env.setWeatherIndex(Number(e.target.value))} aria-label="Weather hour" />
          <div className="flex justify-between font-data text-[8.5px] text-ink-faint">
            <span>{env.weatherTimes[0]?.slice(5,13).replace('T',' ')}</span>
            <span className="text-accent">now · {env.weatherNowHour.slice(5,13).replace('T',' ')}Z</span>
            <span>{env.weatherTimes[env.weatherTimes.length-1]?.slice(5,13).replace('T',' ')}</span>
          </div>
          <div className="text-[9px] text-ink-faint">Before now: REAL_HISTORICAL (analysis). At/after now: REAL_FORECAST. Never labelled real-time beyond validity.</div>
        </div>

        <SectionTitle>Layers</SectionTitle>
        <div className="px-0 space-y-2">
          <label className="flex items-center justify-between py-1">
            <span className="text-[11px] text-ink">Wind vectors</span>
            <Toggle on={layers.weather} onChange={()=>toggleLayer('weather')} label="Toggle wind" />
          </label>
          <label className="flex items-center justify-between py-1">
            <span className="text-[11px] text-ink">Temperature overlay</span>
            <Toggle on={showTemp} onChange={()=>setShowTemp(!showTemp)} label="Toggle temperature" />
          </label>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px]"><span className="text-ink-dim">Opacity</span><span className="font-data text-ice">{opacity}%</span></div>
            <input type="range" min={15} max={100} value={opacity} onChange={e=>setOpacity(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px]"><span className="text-ink-dim">Vector density</span><span className="font-data text-ice">{vectorDensity===0?'Sparse':vectorDensity===1?'Normal':'Dense'}</span></div>
            <input type="range" min={0} max={2} step={1} value={vectorDensity} onChange={e=>setVectorDensity(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
          </div>
          <p className="text-[9px] text-ink-faint leading-snug m-0">Animation communicates physical movement; density adjusts for clarity, not decoration. Particles are instanced for performance.</p>
        </div>

        <SectionTitle>Current field</SectionTitle>
        <div className="panel-inset rounded-sm p-2.5 space-y-2">
          <p className="text-[9.5px] text-ink-dim leading-snug m-0">Ocean currents are derived from reanalysis where available; otherwise shown as climatological vectors. Check provenance per product.</p>
          <div className="grid grid-cols-3 gap-2 text-[9.5px] font-data text-center">
            <div className="bg-panel rounded-sm py-1.5"><div className="text-ice font-bold">0.6 kn</div><div className="text-ink-faint text-[8px]">MEAN</div></div>
            <div className="bg-panel rounded-sm py-1.5"><div className="text-ice font-bold">2.1 kn</div><div className="text-ink-faint text-[8px]">MAX</div></div>
            <div className="bg-panel rounded-sm py-1.5"><div className="text-ice font-bold">ACC</div><div className="text-ink-faint text-[8px]">EASTWARD</div></div>
          </div>
        </div>

        <SectionTitle>Distribution</SectionTitle>
        <div className="panel rounded-sm p-2.5">
          <div className="label-xs mb-2">Wind speed histogram (knots)</div>
          <svg viewBox="0 0 260 56" className="w-full h-14">
            {(() => {
              const buckets = [0,0,0,0,0,0];
              for (const c of cells) {
                const b = Math.min(5, Math.floor(c.windSpeedKn/8));
                buckets[b]++;
              }
              const max = Math.max(...buckets, 1);
              return buckets.map((v,i)=>(
                <g key={i}>
                  <rect x={10+i*42} y={40 - (v/max)*32} width={34} height={(v/max)*32} rx={2} fill="var(--color-accent)" opacity={0.3 + (v/max)*0.7} />
                  <text x={27+i*42} y={50} textAnchor="middle" fontSize="7" fill="var(--color-ink-faint)">{i*8}-{(i+1)*8}</text>
                  <text x={27+i*42} y={36 - (v/max)*32} textAnchor="middle" fontSize="7" fill="var(--color-ink)">{v}</text>
                </g>
              ));
            })()}
          </svg>
        </div>

        <Details label="Provenance">
          <p className="text-[9.5px] text-ink-faint leading-snug m-0">Source: {env.weather.meta.source.name} ({env.weather.meta.source.provider}) · {env.weather.meta.source.url}</p>
          <p className="text-[9.5px] text-ink-faint m-0">Served {new Date(env.weather.meta.servedAt).toISOString().slice(0,19)}Z · Quality {env.weather.meta.quality}</p>
          {env.weather.meta.warnings.map((w,i)=><p key={i} className="text-[9.5px] text-risk-MEDIUM m-0">⚠ {w}</p>)}
        </Details>
      </div>
    </div>
  );
}
