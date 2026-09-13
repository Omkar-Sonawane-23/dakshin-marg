import { useEffect, useMemo, useRef, useState } from 'react';

interface Cmd { id:string; label:string; hint:string; action:()=>void; }

export default function CommandPalette({ open, onClose, commands }: { open:boolean; onClose:()=>void; commands: Cmd[] }){
  const [q,setQ]=useState('');
  const inputRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{ if(open) { setQ(''); setTimeout(()=>inputRef.current?.focus(), 30); } }, [open]);
  useEffect(()=>{ if(!open) return; const h=(e:KeyboardEvent)=>{ if(e.key==='Escape') onClose(); }; document.addEventListener('keydown',h); return ()=>document.removeEventListener('keydown',h); }, [open,onClose]);
  const filtered = useMemo(()=>{
    if(!q) return commands.slice(0,8);
    const l=q.toLowerCase();
    return commands.filter(c=>c.label.toLowerCase().includes(l)||c.hint.toLowerCase().includes(l)).slice(0,8);
  }, [q,commands]);

  if(!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] px-4" role="dialog" aria-label="Command palette">
      <div className="absolute inset-0 bg-abyss/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[560px] panel rounded-sm overflow-hidden shadow-2xl border-accent/30">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
          <span className="text-ink-faint">⌘</span>
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search missions, bergs, layers…  e.g.  “Show Bharati route”  “Show stale data”" className="flex-1 bg-transparent outline-none font-data text-[12px] text-ice placeholder:text-ink-faint" />
          <span className="text-[9px] text-ink-faint border border-line rounded-sm px-1.5 py-0.5">ESC</span>
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1">
          {filtered.map(c=>(
            <button key={c.id} onClick={()=>{ c.action(); onClose(); }} className="w-full text-left px-3 py-2 hover:bg-panel-2 flex justify-between gap-3">
              <span className="text-[11px] text-ice">{c.label}</span>
              <span className="text-[10px] text-ink-faint">{c.hint}</span>
            </button>
          ))}
          {filtered.length===0 && <div className="px-3 py-6 text-center text-[11px] text-ink-faint">No matches</div>}
        </div>
        <div className="px-3 py-1.5 bg-panel-inset text-[9px] text-ink-faint">Try: “Show iceberg B22A” · “Compare PC7 vs PC3” · “Show routes with lowest risk” · “Show stale data”</div>
      </div>
    </div>
  );
}
