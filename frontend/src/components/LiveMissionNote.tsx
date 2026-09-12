/** Left rail in LIVE mode — mission area and data sources. */

import { useEffect, useState } from 'react';
import { fetchEnvSources } from '../api/envClient';
import type { EnvSourcesCatalog } from '../types/env';
import { useEnv } from '../state/envStore';
import { Details, SectionTitle, Skeleton } from './ui';

/** Short operator-facing names for catalog entries; falls back to provider. */
const SOURCE_SHORT: Record<string, { name: string; variable: string }> = {
  seaice_nsidc: { name: 'NSIDC Sea Ice', variable: 'Daily sea-ice concentration · 25 km' },
  icebergs_nic: { name: 'USNIC Icebergs', variable: 'Named iceberg positions' },
  weather_openmeteo: { name: 'Open-Meteo Wind', variable: '10 m wind · 2 m temperature' },
};

export default function LiveMissionNote() {
  const env = useEnv();
  const [catalog, setCatalog] = useState<EnvSourcesCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [openSource, setOpenSource] = useState<string | null>(null);

  useEffect(() => {
    fetchEnvSources().then(setCatalog).catch(() => setFailed(true));
  }, []);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <SectionTitle>Mission Area</SectionTitle>
      <div className="px-3">
        <div className="font-data text-[12px] text-ice">40°E–100°E · 55°S–72°S</div>
        <div className="text-[10px] text-ink-faint mt-0.5">East Antarctica · Prydz Bay</div>
      </div>

      <SectionTitle>Environmental Data</SectionTitle>
      <div className="px-3 space-y-0.5">
        <div className="text-[10.5px] text-ink-dim">Live observations and forecast products</div>
        {env.seaIce?.meta.temporal.validTime && (
          <div className="text-[10px] text-ink-faint">
            Sea ice {env.seaIce.meta.temporal.validTime.slice(0, 10)}
            {env.weather && <> · wind {env.weather.data.hour.slice(5, 13).replace('T', ' ')}Z</>}
          </div>
        )}
      </div>

      <SectionTitle>Data Sources</SectionTitle>
      <div className="px-3 pb-4 space-y-0.5">
        {failed && (
          <div className="text-[10px] text-risk-MEDIUM" role="alert">
            Source catalog unavailable
          </div>
        )}
        {!catalog && !failed && (
          <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </>
        )}
        {catalog?.sources.map((s) => {
          const short = SOURCE_SHORT[s.id] ?? { name: s.provider, variable: s.name };
          const open = openSource === s.id;
          return (
            <div key={s.id}>
              <button
                className={`w-full text-left py-1.5 px-2 -mx-2 rounded-sm transition-colors ${open ? 'bg-panel-2' : 'hover:bg-panel-2'}`}
                onClick={() => setOpenSource(open ? null : s.id)}
                aria-expanded={open}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-ink font-semibold">{short.name}</span>
                  <span className="text-[9px] font-data" style={{ color: 'var(--color-risk-low)' }}>● LIVE</span>
                </div>
                <div className="text-[9.5px] text-ink-faint mt-0.5">
                  {short.variable} · {s.cadence}
                </div>
              </button>
              {open && (
                <div className="px-2 pb-2 pt-1 text-[9.5px] text-ink-faint leading-snug space-y-1 fade-in">
                  <div>{s.name}</div>
                  <div>{s.notes}</div>
                  <div className="font-data text-[8.5px]">CRS {s.crs} · {s.provider}</div>
                </div>
              )}
            </div>
          );
        })}
        {env.error && catalog && (
          <div className="text-[9px] text-ink-faint pt-1">
            Data fetch failed ({env.error.code}) — catalog shown for reference.
          </div>
        )}
        <div className="pt-2">
          <Details label="Processing details">
            <p className="text-[9.5px] text-ink-faint leading-snug m-0">
              Feeds are ingested, validated and normalized by the environmental
              service before display. Requests are limited to the mission area.
              No simulated objects appear in live mode. See docs/data-pipeline.md.
            </p>
          </Details>
        </div>
      </div>
    </div>
  );
}
