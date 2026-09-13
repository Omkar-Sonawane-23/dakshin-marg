import { useEffect, useState } from 'react';

export type ConnMode = 'CONNECTED'|'DEGRADED'|'OFFLINE';

export default function OfflineIndicator({ mode, lastSync }: { mode: ConnMode; lastSync?: string }){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{ const id=setInterval(()=>setNow(Date.now()), 30000); return ()=>clearInterval(id); }, []);
  if(mode==='CONNECTED') return null;
  const ageH = lastSync ? (now - Date.parse(lastSync))/3600_000 : 0;
  const color = mode==='OFFLINE'?'var(--color-risk-crit)':'var(--color-risk-med)';
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b" style={{background:`color-mix(in srgb, ${color} 12%, transparent)`, borderColor:`color-mix(in srgb, ${color} 30%, transparent)`}}>
      <span className="h-2 w-2 rounded-full animate-pulse" style={{background:color}} />
      <span className="font-data text-[10px] font-bold" style={{color}}>{mode==='OFFLINE'?'OFFLINE — no connection':'DEGRADED — limited connectivity'}</span>
      <span className="text-[10px] text-ink-dim">Using cached offline products.</span>
      {lastSync && <span className="font-data text-[9px] text-ink-faint ml-auto">Data as of {new Date(lastSync).toISOString().slice(0,16)}Z · {ageH.toFixed(1)}h ago</span>}
      <span className="text-[9px] text-ink-faint">Sync resumes when connection returns — conflicts flagged.</span>
    </div>
  );
}
