/**
 * Collapsible map legend — bottom-center overlay.
 *
 * Every entry here corresponds to something actually drawn in the 3D scene and
 * to a real dataset behind it. Where no dataset exists the legend says so
 * rather than implying coverage we do not have (see the "not available" line).
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../state/store';
import { useEnv } from '../../state/envStore';

/** A dashed swatch, matching the dash density used for that route class. */
function dashSwatch(color: string, gap = '4px 7px') {
  return { background: `repeating-linear-gradient(90deg,${color} 0 4px,transparent ${gap})` };
}

function Item({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 min-w-0">{children}</div>;
}

export default function MapLegend() {
  const [open, setOpen] = useState(true);
  const [showProvenance, setShowProvenance] = useState(false);
  const { layers } = useStore();
  const env = useEnv();
  const { mode, error: envError } = env;
  const live = mode === 'LIVE';
  const zonesUp = env.drillStage !== null && env.drillStage >= 3;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 pointer-events-auto max-w-[min(92vw,760px)]">
      {open ? (
        <div className="panel rounded-sm px-3.5 py-2 flex flex-col gap-1.5 slide-up">
          <div className="flex items-center gap-5 flex-wrap">
            {/* ── terrain ── */}
            {layers.graticule && (
              <Item>
                <span className="label-xs">Terrain</span>
                <div
                  className="w-[72px] h-[7px] rounded-sm"
                  style={{ background: 'linear-gradient(90deg, var(--legend-shelf), var(--legend-coast), var(--legend-plateau))' }}
                />
                <span className="font-data text-[8.5px] text-ink-faint">shelf → plateau</span>
              </Item>
            )}

            {/* ── sea ice ── */}
            {layers.seaIce && !(live && env.riskEnabled) && (
              <Item>
                <span className="label-xs">
                  {live && env.forecastHorizon !== null ? `Sea ice +${env.forecastHorizon}h` : 'Sea ice'}
                </span>
                <div
                  className="w-[72px] h-[7px] rounded-sm"
                  style={{ background: 'linear-gradient(90deg, var(--legend-ice-0), var(--legend-ice-1), var(--legend-ice-2))' }}
                />
                <span className="font-data text-[8.5px] text-ink-faint">0–98% conc.</span>
              </Item>
            )}

            {/* ── risk severity (live) ── */}
            {live && env.riskEnabled && (
              <Item>
                <span className="label-xs">Risk severity</span>
                {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((s) => (
                  <span key={s} className="flex items-center gap-1">
                    <span className={`inline-block w-2.5 h-2.5 rounded-[2px] bg-risk-${s}`} style={{ opacity: 0.75 }} />
                    <span className="text-[8px] font-data text-ink-faint">{s.slice(0, 4)}</span>
                  </span>
                ))}
              </Item>
            )}

            {/* ── risk ramp (demo) ── */}
            {!live && layers.risk && (
              <Item>
                <span className="label-xs">Risk</span>
                <div
                  className="w-[72px] h-[7px] rounded-sm"
                  style={{
                    background:
                      'linear-gradient(90deg, color-mix(in srgb, var(--color-risk-low) 30%, transparent), color-mix(in srgb, var(--color-risk-med) 55%, transparent), color-mix(in srgb, var(--color-risk-high) 60%, transparent), color-mix(in srgb, var(--color-risk-crit) 65%, transparent))',
                  }}
                />
              </Item>
            )}

            {/* ── routes ── */}
            {layers.routes && (
              <Item>
                <span className="label-xs">Routes</span>
                {live ? (
                  <>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-4 h-[2px] bg-accent" />
                      <span className="text-[8.5px] text-ink-faint">direct</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-4 h-[2px] bg-risk-low" />
                      <span className="text-[8.5px] text-ink-faint">balanced</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-4 h-[2px]" style={{ background: 'var(--route-conservative)' }} />
                      <span className="text-[8.5px] text-ink-faint">conservative</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-4 h-[2px] bg-accent" />
                      <span className="text-[8.5px] text-ink-faint">active</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-4 h-[2px]" style={dashSwatch('var(--color-risk-low)')} />
                      <span className="text-[8.5px] text-ink-faint">recommended</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-4 h-[2px]" style={dashSwatch('var(--color-ink-faint)', '2px 5px')} />
                      <span className="text-[8.5px] text-ink-faint">alternative</span>
                    </span>
                  </>
                )}
              </Item>
            )}

            {/* ── icebergs ── */}
            {layers.icebergs && (
              live ? (
                <Item>
                  <svg width="12" height="12" aria-hidden="true">
                    <rect x="3" y="3" width="6" height="6" transform="rotate(45 6 6)" fill="none" stroke="var(--color-risk-low)" strokeWidth="1.3" />
                  </svg>
                  <span className="text-[8.5px] text-ink-faint">iceberg (observed)</span>
                  {envError && (
                    <span
                      className="badge"
                      style={{
                        color: 'var(--color-risk-high)',
                        borderColor: 'color-mix(in srgb, var(--color-risk-high) 50%, transparent)',
                        background: 'color-mix(in srgb, var(--color-risk-high) 8%, transparent)',
                        marginLeft: 6,
                      }}
                    >
                      FEED DOWN
                    </span>
                  )}
                </Item>
              ) : (
                <Item>
                  <svg width="11" height="10" aria-hidden="true">
                    <path d="M5.5 0 L11 9 L0 9 Z" fill="none" stroke="var(--map-berg)" strokeWidth="1.2" />
                  </svg>
                  <span className="text-[8.5px] text-ink-faint">iceberg</span>
                  <svg width="11" height="10" aria-hidden="true">
                    <path d="M5.5 0 L11 9 L0 9 Z" fill="none" stroke="var(--color-risk-high)" strokeWidth="1.2" />
                  </svg>
                  <span className="text-[8.5px] text-ink-faint">threat</span>
                </Item>
              )
            )}

            {/* ── wind ── */}
            {live && layers.weather && (
              <Item>
                <svg width="14" height="10" aria-hidden="true">
                  <path d="M1 5 H10" stroke="var(--color-accent)" strokeWidth="1.2" />
                  <path d="M10 5 L7 2.6 M10 5 L7 7.4" stroke="var(--color-accent)" strokeWidth="1.2" fill="none" />
                </svg>
                <span className="text-[8.5px] text-ink-faint">wind (barb → from)</span>
              </Item>
            )}

            {/* ── raised hazard volumes during the re-planning drill ── */}
            {zonesUp && (
              <Item>
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-risk-crit) 70%, transparent)' }} />
                <span className="text-[8.5px] text-ink-faint">encounter volume P90/P50</span>
              </Item>
            )}

            <button className="btn btn-ghost !p-1 !text-[9px]" onClick={() => setOpen(false)} aria-label="Collapse legend">
              ▾
            </button>
          </div>

          {/* ── provenance: what is measured, what is synthesised, what is missing ── */}
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost !p-0 !text-[8.5px] !border-0 !underline decoration-dotted underline-offset-2"
              onClick={() => setShowProvenance((v) => !v)}
              aria-expanded={showProvenance}
            >
              {showProvenance ? 'hide data notes' : 'data notes'}
            </button>
            {showProvenance && (
              <span className="font-data text-[8.5px] text-ink-faint leading-snug">
                Sea ice, icebergs, weather and risk are gridded/observed data. Terrain relief is
                <strong className="text-ink-dim font-semibold"> synthesised</strong> from the coastline — no DEM is bundled, so
                elevations are indicative, not surveyed. Protected / no-go areas are
                <strong className="text-ink-dim font-semibold"> not available</strong> and are therefore not drawn.
              </span>
            )}
          </div>
        </div>
      ) : (
        <button className="btn !text-[9px]" onClick={() => setOpen(true)} aria-label="Expand legend">
          LEGEND ▴
        </button>
      )}
    </div>
  );
}
