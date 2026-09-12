/** Right rail — alert center + layer controls. */

import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { LayerState } from '../state/store';
import { fmtScenarioTime } from '../lib/format';
import { EmptyState, SectionTitle, SevIcon, Toggle } from './ui';
import type { Alert } from '../types/domain';

const LAYERS: { key: keyof LayerState; label: string; hint: string }[] = [
  { key: 'seaIce', label: 'Sea-ice concentration', hint: 'Forecast field' },
  { key: 'icebergs', label: 'Icebergs', hint: 'Tracked objects' },
  { key: 'trajectories', label: 'Iceberg forecasts', hint: '48 h + uncertainty' },
  { key: 'risk', label: 'Navigation risk', hint: 'Combined hazards' },
  { key: 'weather', label: 'Wind field', hint: '10 m wind' },
  { key: 'routes', label: 'Routes', hint: 'Active / alternatives' },
  { key: 'graticule', label: 'Graticule', hint: 'Meridians & parallels' },
];

export default function AlertPanel() {
  const { snapshot, scenario, layers, toggleLayer, ackAlert, ackedAlerts, setComparisonOpen } = useStore();
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING'>('ALL');

  const alerts = useMemo(() => {
    if (!snapshot) return [];
    const list = [...snapshot.alerts].sort((a, b) => b.timeOffsetH - a.timeOffsetH);
    if (filter === 'ALL') return list;
    return list.filter((a) => a.severity === filter);
  }, [snapshot, filter]);

  if (!snapshot || !scenario) return null;

  const unacked = snapshot.alerts.filter((a) => !a.acknowledged && !ackedAlerts.has(a.id));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* layer controls */}
      <SectionTitle>Map Layers</SectionTitle>
      <div className="px-3 space-y-1">
        {LAYERS.map((l) => (
          <div key={l.key} className="flex items-center justify-between py-1 px-2 rounded-sm hover:bg-panel-2 transition-colors">
            <div className="leading-tight">
              <div className="text-[11px] text-ink">{l.label}</div>
              <div className="text-[9px] text-ink-faint">{l.hint}</div>
            </div>
            <Toggle on={layers[l.key]} onChange={() => toggleLayer(l.key)} label={`Toggle ${l.label}`} />
          </div>
        ))}
      </div>

      <div className="px-3 pt-2">
        <div className="hairline" />
      </div>

      {/* alert center */}
      <SectionTitle
        right={
          <div className="flex gap-1" role="tablist" aria-label="Alert filter">
            {(['ALL', 'CRITICAL', 'WARNING'] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                className={`text-[8.5px] font-bold tracking-wider px-1.5 py-0.5 rounded-sm transition-colors ${
                  filter === f ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink-dim'
                }`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        }
      >
        Alerts {unacked.length > 0 && <span className="risk-CRITICAL">({unacked.length} new)</span>}
      </SectionTitle>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2 min-h-0">
        {alerts.length === 0 ? (
          <EmptyState
            icon="✓"
            title={filter === 'ALL' ? 'No alerts at this time step' : `No ${filter.toLowerCase()} alerts`}
            hint="Alerts appear when environmental change affects the mission. Advance the timeline to see the scenario evolve."
          />
        ) : (
          alerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              depIso={scenario.mission.departureUtc}
              acked={a.acknowledged || ackedAlerts.has(a.id)}
              onAck={() => ackAlert(a.id)}
              onAction={a.recommendedAction.includes('ROUTE') ? () => setComparisonOpen(true) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AlertCard({ alert, depIso, acked, onAck, onAction }: {
  alert: Alert; depIso: string; acked: boolean; onAck: () => void; onAction?: () => void;
}) {
  const border =
    alert.severity === 'CRITICAL' ? 'border-l-risk-CRITICAL' :
    alert.severity === 'WARNING' ? 'border-l-risk-MEDIUM' : 'border-l-accent';
  return (
    <div
      className={`panel-inset rounded-sm border-l-2 ${border} p-2.5 slide-in-right ${!acked ? '' : 'opacity-75'}`}
      style={!acked && alert.severity === 'CRITICAL' ? { animation: 'alert-flash 2.4s ease-out 1, slide-in-right 220ms cubic-bezier(0.16,1,0.3,1)' } : undefined}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5"><SevIcon sev={alert.severity} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11.5px] font-bold text-ice leading-tight">{alert.title}</span>
            <span className="font-data text-[9px] text-ink-faint flex-none">T+{alert.timeOffsetH}h</span>
          </div>
          <div className="text-[9px] text-ink-faint font-data mt-0.5">{fmtScenarioTime(depIso, alert.timeOffsetH)} · {alert.kind}</div>
          <p className="text-[10.5px] text-ink-dim leading-relaxed mt-1.5 mb-0">{alert.reason}</p>
          <div className="mt-1.5 text-[9.5px]">
            <span className="text-ink-faint">AFFECTS </span>
            <span className="font-data text-ink-dim">{alert.affectedComponent}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className={`text-[9.5px] font-bold tracking-wide ${alert.severity === 'CRITICAL' ? 'risk-CRITICAL' : 'text-accent'}`}>
              ▸ {alert.recommendedAction}
            </span>
            <div className="flex gap-1 flex-none">
              {onAction && !acked && (
                <button className="btn btn-accent !py-0.5 !px-2 !text-[8.5px]" onClick={onAction}>Review</button>
              )}
              {!acked && (
                <button className="btn !py-0.5 !px-2 !text-[8.5px]" onClick={onAck}>Ack</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
