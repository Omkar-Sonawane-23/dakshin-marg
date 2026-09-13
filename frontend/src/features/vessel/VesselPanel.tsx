import { useState } from 'react';
import { useVessels, iceClassRank } from '../../state/vesselStore';
import { useEnv } from '../../state/envStore';
import { Details, SectionTitle, Toggle } from '../../components/ui';

function CapabilityBar({ label, value, max, unit, goodWhenHigh = true }: { label: string; value: number; max: number; unit: string; goodWhenHigh?: boolean }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = goodWhenHigh
    ? pct > 66 ? 'var(--color-risk-low)' : pct > 33 ? 'var(--color-risk-med)' : 'var(--color-risk-crit)'
    : pct > 66 ? 'var(--color-risk-crit)' : pct > 33 ? 'var(--color-risk-med)' : 'var(--color-risk-low)';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-ink-dim">{label}</span>
        <span className="font-data text-ice">{value}{unit}</span>
      </div>
      <div className="h-1.5 bg-line rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function VesselPanel() {
  const { vessels, selected, selectedId, setSelectedId, compareIds, setCompareIds } = useVessels();
  const env = useEnv();
  const [showCompare, setShowCompare] = useState(false);
  const [showCurves, setShowCurves] = useState(false);

  const sorted = [...vessels].sort((a, b) => iceClassRank(a.iceClass) - iceClassRank(b.iceClass));

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <SectionTitle>Vessel Profile</SectionTitle>
      <div className="px-3 space-y-3">
        <div className="grid grid-cols-1 gap-1.5">
          {sorted.map(v => (
            <button
              key={v.id}
              onClick={() => setSelectedId(v.id)}
              className={`text-left panel-inset rounded-sm p-2.5 transition-colors ${selectedId === v.id ? '!border-accent/60 bg-panel-2' : 'hover:bg-panel-2'}`}
              aria-pressed={selectedId === v.id}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-data text-[11px] font-bold text-ice truncate">{v.name}</div>
                  <div className="text-[9px] text-ink-faint">{v.type} · {v.callsign}</div>
                </div>
                <span className={`font-data text-[9px] font-bold px-1.5 py-0.5 rounded-sm border ${selectedId === v.id ? 'bg-accent/15 text-accent border-accent/30' : 'bg-panel text-ink-faint border-line'}`}>{v.iceClass}</span>
              </div>
              <div className="text-[9.5px] text-ink-dim leading-snug mt-1">{v.description}</div>
              <div className="flex gap-3 mt-1.5 font-data text-[9px] text-ink-faint">
                <span>{v.lengthM}m · {v.draftM}m draft</span>
                <span>{v.cruiseSpeedKn}kn cruise</span>
              </div>
            </button>
          ))}
        </div>

        <div className="panel rounded-sm p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-data text-[11px] font-bold text-ice">{selected.name}</span>
            <span className="badge" style={{ color: selected.status === 'OPERATIONAL' ? 'var(--color-risk-low)' : 'var(--color-risk-med)', borderColor: 'currentColor', background: 'transparent' }}>{selected.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 font-data text-[10px]">
            <div><span className="text-ink-faint">ICE CLASS </span><span className="text-ice font-bold">{selected.iceClass}</span></div>
            <div><span className="text-ink-faint">CALLSIGN </span><span className="text-ice">{selected.callsign}</span></div>
            <div><span className="text-ink-faint">LENGTH </span><span className="text-ice">{selected.lengthM} m</span></div>
            <div><span className="text-ink-faint">BEAM </span><span className="text-ice">{selected.beamM} m</span></div>
            <div><span className="text-ink-faint">DRAFT </span><span className="text-ice">{selected.draftM} m</span></div>
            <div><span className="text-ink-faint">POWER </span><span className="text-ice">{(selected.installedPowerKw/1000).toFixed(1)} MW</span></div>
            <div><span className="text-ink-faint">MAX SPEED </span><span className="text-ice">{selected.maxSpeedKn} kn</span></div>
            <div><span className="text-ink-faint">TURN RADIUS </span><span className="text-ice">{selected.turningRadiusNm} nm</span></div>
          </div>
          <div className="hairline" />
          <CapabilityBar label="Ice capability" value={100 - iceClassRank(selected.iceClass)*10} max={100} unit="%" />
          <CapabilityBar label="Max ice concentration" value={selected.maxIceConcPct} max={100} unit="%" />
          <CapabilityBar label="Fuel capacity" value={selected.fuelCapacityT} max={2500} unit=" t" />
          <div className="flex justify-between text-[10px] pt-1">
            <span className="text-ink-dim">Reserve fuel</span>
            <span className="font-data text-ice">{selected.reserveFuelPct}%</span>
          </div>
        </div>

        <button className="btn w-full !py-1.5 !text-[10px]" onClick={() => setShowCurves(!showCurves)}>
          {showCurves ? '▾ Hide' : '▸'} Speed · Power · Ice-resistance curves
        </button>
        {showCurves && (
          <div className="panel-inset rounded-sm p-3 space-y-2 fade-in">
            <div className="label-xs">Speed–Power (illustrative)</div>
            <svg viewBox="0 0 300 80" className="w-full h-20">
              <path d="M10 70 C80 68, 140 45, 220 20 L220 70 Z" fill="color-mix(in srgb, var(--color-accent) 12%, transparent)" stroke="var(--color-accent)" strokeWidth="1.2" />
              <path d="M10 70 C90 60, 150 35, 220 15" fill="none" stroke="var(--color-risk-med)" strokeWidth="1" strokeDasharray="4 3" />
              <text x="12" y="14" fontSize="7" fill="var(--color-ink-faint)">— cruise  — max</text>
            </svg>
            <p className="text-[9px] text-ink-faint leading-snug m-0">Curves are vessel-class estimates, not measured trials. Labelled UNVALIDATED where used in routing. Provide validated power curves to enable fuel estimates.</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-ink-dim">Compare vessels</span>
          <Toggle on={showCompare} onChange={() => setShowCompare(!showCompare)} label="Toggle vessel comparison" />
        </div>
        {showCompare && (
          <div className="space-y-2 fade-in">
            <div className="text-[10px] text-ink-dim">Select two vessels to compare navigability:</div>
            <div className="flex gap-1 flex-wrap">
              {vessels.map(v => (
                <button key={v.id} onClick={() => {
                  const s = new Set(compareIds);
                  if (s.has(v.id)) s.delete(v.id);
                  else if (s.size < 2) s.add(v.id);
                  else { const arr=[...s]; arr[1]=v.id; s.clear(); arr.forEach(x=>s.add(x)); }
                  setCompareIds([...s]);
                }}
                className={`btn !py-1 !px-2 !text-[9px] ${compareIds.includes(v.id) ? 'btn-accent' : ''}`}>{v.iceClass} · {v.name.split(' ').pop()}</button>
              ))}
            </div>
            {compareIds.length===2 && (() => {
              const a = vessels.find(v=>v.id===compareIds[0])!;
              const b = vessels.find(v=>v.id===compareIds[1])!;
              const stronger = iceClassRank(a.iceClass) < iceClassRank(b.iceClass) ? a : b;
              const weaker = stronger===a ? b : a;
              return (
                <div className="panel-inset rounded-sm p-2.5 space-y-1.5">
                  <div className="font-data text-[10px] font-bold text-ice">Same corridor · Different capability</div>
                  <div className="grid grid-cols-2 gap-2 text-[9.5px]">
                    <div className="border-l-2 pl-2" style={{borderColor:'var(--color-risk-low)'}}>
                      <div className="font-bold text-ice">{stronger.name}</div>
                      <div className="text-ink-dim">{stronger.iceClass} — {stronger.maxIceConcPct}% max conc.</div>
                      <div className="text-risk-LOW">✓ Wider feasible mask</div>
                    </div>
                    <div className="border-l-2 pl-2 border-l-risk-HIGH">
                      <div className="font-bold text-ice">{weaker.name}</div>
                      <div className="text-ink-dim">{weaker.iceClass} — {weaker.maxIceConcPct}% max conc.</div>
                      <div className="text-risk-HIGH">⚠ Corridor narrows in pack ice</div>
                    </div>
                  </div>
                  <p className="text-[9px] text-ink-faint leading-snug m-0">Route safe for {stronger.name} is NOT automatically safe for {weaker.name}. Change vessel in the Route Planner to see the no-go mask recalculate.</p>
                  <button className="btn w-full !py-1 !text-[9px]" onClick={() => { setSelectedId(weaker.id); env.setRiskIceClass(weaker.iceClass); }}>Apply {weaker.iceClass} to risk surface</button>
                </div>
              );
            })()}
          </div>
        )}

        <Details label="Data provenance & limits">
          <p className="text-[9.5px] text-ink-faint leading-snug m-0">Profiles are sample data for demonstration. No validated speed–power or fuel curves are installed — fuel estimates show NOT COMPUTED. Provide vessel-specific trials to enable validated estimates.</p>
          <p className="text-[9.5px] text-ink-faint leading-snug m-0">Ice-class limits follow POLARIS RIO thresholds per docs/risk-methodology.md. Safety margins are hard constraints before optimization.</p>
        </Details>
      </div>
    </div>
  );
}
