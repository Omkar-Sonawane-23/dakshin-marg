import { useMemo } from 'react';
import type { OptRoute } from '../types/env';

export default function ParetoView({ routes, selected, onSelect }: { routes: OptRoute[]; selected: string | null; onSelect: (p: string | null)=>void }) {
  const pts = useMemo(()=> routes.filter(r=>r.status==='OK'&&r.risk&&r.distanceNm&&r.estTimeH).map(r=>({
    profile:r.profile,
    riskScore: (r.risk!.exposurePct.HIGH??0)+(r.risk!.exposurePct.CRITICAL??0),
    timeH: r.estTimeH!,
    fuel: r.fuelNote || 'N/A',
    dist: r.distanceNm!,
    sev: r.risk!.overallSeverity,
  })), [routes]);

  if (pts.length===0) return null;

  const maxRisk = Math.max(...pts.map(p=>p.riskScore), 1);
  const maxTime = Math.max(...pts.map(p=>p.timeH), 1);
  const minTime = Math.min(...pts.map(p=>p.timeH));
  const timeRange = maxTime - minTime || 1;

  const toXY = (p: typeof pts[number]) => ({
    x: 24 + (p.riskScore/maxRisk)*220,
    y: 80 - ((p.timeH - minTime)/timeRange)*64,
  });

  return (
    <div className="panel rounded-sm p-3 space-y-2">
      <div className="label-xs">Pareto — Risk vs Time</div>
      <svg viewBox="0 0 260 100" className="w-full h-28 bg-panel-inset rounded-sm border border-line">
        {/* axes */}
        <line x1={24} y1={80} x2={252} y2={80} stroke="var(--color-line)" strokeWidth={0.7} />
        <line x1={24} y1={8} x2={24} y2={80} stroke="var(--color-line)" strokeWidth={0.7} />
        <text x={138} y={96} textAnchor="middle" fontSize={7} fill="var(--color-ink-faint)">HIGH+CRITICAL exposure %</text>
        <text x={10} y={44} textAnchor="middle" fontSize={7} fill="var(--color-ink-faint)" transform="rotate(-90 10 44)">time (h)</text>
        {/* pareto frontier approx = lower-left envelope */}
        <path d={`M ${pts.map(p=>toXY(p)).sort((a,b)=>a.x-b.x).map((pt,i)=>`${i===0?'M':'L'} ${pt.x} ${pt.y}`).join(' ')}`} fill="none" stroke="var(--color-accent)" strokeWidth={0.8} strokeDasharray="3 3" opacity={0.6} />
        {pts.map(p=>{
          const {x,y}=toXY(p);
          const isSel = selected===p.profile;
          const color = p.sev==='LOW'?'var(--color-risk-low)':p.sev==='MEDIUM'?'var(--color-risk-med)':'var(--color-risk-crit)';
          return (
            <g key={p.profile} onClick={()=>onSelect(isSel?null:p.profile)} style={{cursor:'pointer'}}>
              <circle cx={x} cy={y} r={isSel?6:4.5} fill={color} stroke="white" strokeOpacity={isSel?0.9:0.5} strokeWidth={isSel?1.4:0.8} />
              <text x={x} y={y-9} textAnchor="middle" fontSize={7} fontWeight={700} fill="var(--color-ink)">{p.profile}</text>
            </g>
          );
        })}
      </svg>
      <div className="grid grid-cols-3 gap-1.5">
        {pts.map(p=>(
          <button key={p.profile} onClick={()=>onSelect(selected===p.profile?null:p.profile)} className={`panel-inset rounded-sm p-1.5 text-center ${selected===p.profile?'!border-accent/60 bg-panel-2':''}`}>
            <div className="font-data text-[9px] font-bold text-ice">{p.profile}</div>
            <div className="font-data text-[9px] text-ink-dim">{p.dist.toFixed(0)} nm · {p.timeH.toFixed(1)}h</div>
            <div className="text-[8px] text-ink-faint">{p.fuel}</div>
          </button>
        ))}
      </div>
      <p className="text-[9px] text-ink-faint leading-snug m-0">Click a point to highlight the route in 3D. Axes are fuel/time/risk candidates — each point is a feasible severity-ceiling path. Fuel is NOT COMPUTED until a validated model exists.</p>
    </div>
  );
}
