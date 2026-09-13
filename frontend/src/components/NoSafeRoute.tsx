export default function NoSafeRoute({ reason, onOptions }: { reason?: string; onOptions?: ()=>void }){
  return (
    <div className="panel rounded-sm p-4 text-center space-y-2 border-risk-CRITICAL/40">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-sm bg-risk-CRITICAL/15 border border-risk-CRITICAL/40">
        <span className="text-risk-CRITICAL font-bold text-[11px]">■ NO SAFE ROUTE FOUND</span>
      </div>
      <p className="text-[11px] text-ink-dim leading-relaxed m-0">Every candidate route violates hard constraints inside the current vessel limits and environmental conditions. The system prefers <b>no route</b> over a false sense of safety.</p>
      <div className="panel-inset rounded-sm p-2.5 text-left space-y-1">
        <div className="label-xs">Blocked by</div>
        <div className="text-[9.5px] text-ink-dim">· Pack ice &gt; vessel max concentration (70% vs 85% observed)<br/>· 2 iceberg P50 zones covering corridor<br/>· Restricted grounding-zone buffer</div>
        {reason && <div className="text-[9.5px] text-risk-MEDIUM">Reason: {reason}</div>}
      </div>
      <div className="text-[10px] text-ink-dim">What you can modify:</div>
      <div className="flex flex-wrap gap-1.5 justify-center">
        <button className="btn !py-1 !px-2 !text-[9px]">Wait for conditions</button>
        <button className="btn !py-1 !px-2 !text-[9px]">Change departure time</button>
        <button className="btn !py-1 !px-2 !text-[9px]">Change vessel (ice class)</button>
        <button className="btn !py-1 !px-2 !text-[9px]">Widen corridor</button>
        <button className="btn !py-1 !px-2 !text-[9px]" onClick={onOptions}>Request human review</button>
      </div>
      <div className="text-[9px] text-ink-faint">Not a failure — a feature. The operator decides.</div>
    </div>
  );
}
