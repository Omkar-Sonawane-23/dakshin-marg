/** Full-screen loading & error states for the command center. */

import { Skeleton } from './ui';

export function LoadingScreen() {
  return (
    <div className="h-full w-full flex flex-col bg-abyss" aria-busy="true" aria-label="Loading mission data">
      {/* top bar skeleton */}
      <div className="h-12 border-b border-line flex items-center gap-4 px-4">
        <Skeleton className="w-[150px] h-6" />
        <div className="flex-1" />
        <Skeleton className="w-[280px] h-6" />
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="w-[300px] border-r border-line p-3 space-y-3 hidden lg:block">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="flex-1 relative flex items-center justify-center">
          {/* radar-style loader */}
          <div className="relative w-[120px] h-[120px]">
            <div className="absolute inset-0 rounded-full border border-line" />
            <div className="absolute inset-[18px] rounded-full border border-line" />
            <div className="absolute inset-[38px] rounded-full border border-line" />
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'conic-gradient(from 0deg, color-mix(in srgb, var(--color-accent) 50%, transparent), transparent 60deg)',
                animation: 'sweep 1.6s linear infinite',
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-data text-[8px] tracking-[0.18em] text-accent">DAKSHIN MARG</span>
            </div>
          </div>
          <div className="absolute mt-[150px] text-center">
            <div className="font-data text-[11px] text-ink-dim tracking-widest">LOADING</div>
            <div className="text-[9.5px] text-ink-faint mt-1">Preparing mission scenario</div>
          </div>
        </div>
        <div className="w-[300px] border-l border-line p-3 space-y-3 hidden xl:block">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
      <div className="h-[76px] border-t border-line flex items-center px-4 gap-4">
        <Skeleton className="w-[260px] h-8" />
        <Skeleton className="flex-1 h-4" />
      </div>
    </div>
  );
}

export function ErrorScreen({ code, message, onRetry }: { code: string; message: string; onRetry: () => void }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-abyss p-6">
      <div className="panel rounded-sm max-w-[440px] w-full p-5 text-center slide-up" role="alert">
        <div className="text-[26px] risk-HIGH mb-2" aria-hidden="true">▲</div>
        <div className="font-data font-bold text-[13px] text-ice tracking-wider mb-1">MISSION DATA UNAVAILABLE</div>
        <div className="font-data text-[9.5px] text-ink-faint mb-3">ERROR {code}</div>
        <p className="text-[11.5px] text-ink-dim leading-relaxed mb-4">{message}</p>
        <button className="btn btn-accent" onClick={onRetry}>⟲ Retry Connection</button>
        <div className="text-[9px] text-ink-faint mt-3">
          If the failure persists, verify the demo runtime and see docs/limitations.md.
        </div>
      </div>
    </div>
  );
}
