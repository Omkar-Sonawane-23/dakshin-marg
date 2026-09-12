/** Left rail (LIVE mode) — mission list: create, resume, delete, export.
 * Replaces the static mission note when the mission system is in use;
 * data sources summary stays at the bottom.
 */

import { useState } from 'react';
import { useMission } from '../../state/missionStore';
import { patchMission } from '../../api/missionClient';
import type { MissionState } from '../../types/mission';
import { SectionTitle, Skeleton, EmptyState } from '../ui';

const STATE_COLOR: Record<MissionState, string> = {
  DRAFT: 'var(--color-ink-faint)',
  READY: 'var(--color-accent)',
  ROUTES_GENERATED: 'var(--color-accent)',
  IN_PROGRESS: 'var(--color-risk-low)',
  ROUTE_REVIEW_REQUIRED: 'var(--color-risk-high)',
  RE_PLANNING: 'var(--color-risk-med)',
  PAUSED: 'var(--color-ink-dim)',
  COMPLETED: 'var(--color-risk-low)',
  CANCELLED: 'var(--color-ink-faint)',
};

export default function MissionListPanel() {
  const ms = useMission();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const commitRename = async (id: string) => {
    const name = renameValue.trim();
    setRenaming(null);
    if (!name) return;
    try {
      await patchMission(id, { name });
      ms.refreshList();
      if (ms.mission?.id === id) ms.openMission(id);
    } catch { /* rename failure is non-fatal; list stays as-is */ }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <SectionTitle>Missions</SectionTitle>
      <div className="px-3 pb-2 space-y-2">
        <button
          className="btn btn-accent w-full !py-2 !text-[10.5px] font-bold tracking-wider"
          onClick={() => ms.setWizardOpen(true)}
        >
          ＋ CREATE NEW MISSION
        </button>
        <div className="text-[9px] text-ink-faint leading-snug">
          Plan a voyage with real environmental data: origin/destination, departure
          time (validated against data availability), vessel parameters, route
          options, then a time-based voyage simulation with dynamic re-planning.
        </div>
        {ms.persistence && (
          <div className="text-[8.5px] font-data text-ink-faint">
            PERSISTENCE: {ms.persistence === 'mongodb' ? 'MongoDB' : 'local store (MongoDB unavailable)'}
          </div>
        )}
      </div>

      <SectionTitle>Saved Missions</SectionTitle>
      <div className="px-3 pb-4 space-y-1">
        {ms.listLoading && (<><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></>)}
        {ms.listError && (
          <div className="text-[10px] text-risk-MEDIUM" role="alert">{ms.listError}</div>
        )}
        {!ms.listLoading && !ms.listError && ms.missions.length === 0 && (
          <EmptyState title="No missions yet" hint="Create one to begin voyage planning." />
        )}
        {ms.missions.map((m) => (
          <div key={m.id}
            className={`panel-inset rounded-sm p-2 ${ms.mission?.id === m.id ? '!border-accent/50' : ''}`}>
            <button className="w-full text-left" onClick={() => ms.openMission(m.id)}>
              <div className="flex items-center justify-between gap-2">
                {renaming === m.id ? (
                  <input
                    className="flex-1 bg-panel-2 border border-accent-dim rounded-sm px-1.5 py-0.5 text-[11px] text-ink font-semibold focus:outline-none"
                    value={renameValue} autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(m.id);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => void commitRename(m.id)}
                    aria-label="Rename mission"
                  />
                ) : (
                  <span className="text-[11px] font-semibold text-ink truncate">{m.name}</span>
                )}
                <span className="font-data text-[8px] font-bold whitespace-nowrap"
                  style={{ color: STATE_COLOR[m.state] }}>
                  ● {m.state.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="text-[9px] text-ink-faint font-data mt-0.5">
                {m.id} · {m.vessel.name} ({m.vessel.iceClass}) · dep {m.departureUtc.slice(0, 16)}Z
              </div>
              {m.simTime && (
                <div className="text-[9px] text-ink-faint font-data">sim {m.simTime.slice(0, 16)}Z · {m.eventCount} events</div>
              )}
            </button>
            <div className="flex gap-1 mt-1.5">
              <button className="btn flex-1 !py-0.5 !text-[8.5px]" onClick={() => ms.openMission(m.id)}>
                {ms.mission?.id === m.id ? 'Reload' : m.state === 'COMPLETED' ? 'Open' : 'Resume'}
              </button>
              <button className="btn !py-0.5 !text-[8.5px]"
                onClick={() => { setRenaming(m.id); setRenameValue(m.name); }} aria-label={`Rename ${m.name}`}>
                Rename
              </button>
              {confirmDelete === m.id ? (
                <>
                  <button className="btn !py-0.5 !text-[8.5px] !text-risk-HIGH"
                    onClick={() => { void ms.deleteMissionById(m.id); setConfirmDelete(null); if (ms.mission?.id === m.id) ms.closeMission(); }}>
                    Confirm
                  </button>
                  <button className="btn !py-0.5 !text-[8.5px]" onClick={() => setConfirmDelete(null)}>✕</button>
                </>
              ) : (
                <button className="btn !py-0.5 !text-[8.5px]" onClick={() => setConfirmDelete(m.id)} aria-label={`Delete ${m.name}`}>
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {ms.availability && (
        <>
          <SectionTitle>Data Window</SectionTitle>
          <div className="px-3 pb-4 text-[9.5px] text-ink-dim leading-snug space-y-1">
            <div className="font-data text-[9px] text-ice">
              {ms.availability.window.start.slice(0, 16)}Z → {ms.availability.window.end.slice(0, 16)}Z
            </div>
            <div className="text-ink-faint">
              {ms.availability.seaIce.observationDays.length} sea-ice observation days ·
              forecasts +24/48/72 h · hourly weather. Missions can be planned for any
              time in this window; outside it the system refuses rather than substituting data.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
