/** Bottom bar — scenario timeline: slider, playback, step buttons, event ticks. */

import { useStore } from '../state/store';
import { fmtOffset, fmtScenarioTime } from '../lib/format';

export default function TimeBar() {
  const { scenario, snapshot, timeIndex, setTimeIndex, playing, setPlaying } = useStore();
  if (!scenario || !snapshot) return null;

  const steps = scenario.timeStepsH;
  const maxI = steps.length - 1;
  const pct = (timeIndex / maxI) * 100;

  // event markers (alert times) on the track
  const eventTicks = new Set<number>();
  for (const s of scenario.snapshots) {
    for (const a of s.alerts) {
      if (a.severity !== 'INFO') {
        const idx = steps.indexOf(a.timeOffsetH);
        if (idx >= 0) eventTicks.add(idx);
      }
    }
  }

  const jump = (h: number) => {
    const target = Math.min(steps[maxI], snapshot.timeOffsetH + h);
    const idx = steps.findIndex((s) => s >= target);
    setTimeIndex(idx === -1 ? maxI : idx);
  };

  return (
    <div className="h-[76px] flex-none border-t border-line bg-deep/95 backdrop-blur px-4 flex items-center gap-4 z-20">
      {/* transport controls */}
      <div className="flex items-center gap-1.5 flex-none">
        <button
          className={`btn ${playing ? '' : 'btn-accent'} !px-3.5`}
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? 'Pause playback' : 'Play scenario'}
        >
          {playing ? '❚❚ PAUSE' : '▶ PLAY'}
        </button>
        <button className="btn" onClick={() => jump(6)} disabled={timeIndex >= maxI}>+6H</button>
        <button className="btn" onClick={() => jump(12)} disabled={timeIndex >= maxI}>+12H</button>
        <button className="btn" onClick={() => jump(24)} disabled={timeIndex >= maxI}>+24H</button>
        <button className="btn btn-ghost" onClick={() => { setPlaying(false); setTimeIndex(0); }} aria-label="Reset to start">
          ⟲ RESET
        </button>
      </div>

      {/* timeline */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-1">
          <span className="label-xs">Mission timeline</span>
          <span className="font-data text-[11px] text-accent">
            {fmtOffset(snapshot.timeOffsetH)} · {fmtScenarioTime(scenario.mission.departureUtc, snapshot.timeOffsetH)}
          </span>
        </div>
        <div className="relative">
          <input
            type="range"
            className="timeline"
            min={0}
            max={maxI}
            step={1}
            value={timeIndex}
            style={{ '--fill': `${pct}%` } as React.CSSProperties}
            onChange={(e) => { setPlaying(false); setTimeIndex(Number(e.target.value)); }}
            aria-label="Scenario time"
            aria-valuetext={`T plus ${snapshot.timeOffsetH} hours`}
          />
          {/* event ticks */}
          <div className="absolute inset-x-0 top-[14px] h-2 pointer-events-none">
            {[...eventTicks].map((i) => (
              <div
                key={i}
                className="absolute w-[5px] h-[5px] rotate-45 bg-risk-HIGH"
                style={{ left: `calc(${(i / maxI) * 100}% - 2px)` }}
                title={`Event at T+${steps[i]}h`}
              />
            ))}
          </div>
          {/* step labels */}
          <div className="flex justify-between mt-2.5">
            {steps.map((s, i) => (
              <button
                key={s}
                className={`font-data text-[8.5px] transition-colors ${
                  i === timeIndex ? 'text-accent font-bold' : 'text-ink-faint hover:text-ink-dim'
                }`}
                onClick={() => { setPlaying(false); setTimeIndex(i); }}
              >
                {s === 0 ? 'T0' : `+${s}`}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
