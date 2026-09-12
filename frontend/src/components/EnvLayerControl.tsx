/** Grouped environmental layer control (LIVE mode).
 *
 * Groups: BASE / SEA ICE / ICEBERGS / ATMOSPHERE / OCEAN / NAVIGATION.
 * Honesty rules:
 *  · every layer states its real source, resolution, valid time and cadence;
 *  · status chips: OBSERVATION / FORECAST / MODEL — never "LIVE" for
 *    delayed products (data age is shown instead);
 *  · only one PRIMARY RASTER at a time (sea-ice concentration or the risk
 *    severity surface) so colour scales never mix;
 *  · layers without a real data source are listed as PLANNED and disabled —
 *    they are never rendered from invented data;
 *  · the RISK CONTRIBUTION panel says which layers the risk engine actually
 *    uses — display-only layers are never claimed to affect route scores.
 */

import { useState } from 'react';
import { useEnv } from '../state/envStore';
import { useStore } from '../state/store';
import { Details, Toggle } from './ui';

function ageText(validIso: string | undefined | null): string | null {
  if (!validIso) return null;
  const ms = Date.now() - Date.parse(validIso);
  if (!Number.isFinite(ms)) return null;
  const h = Math.round(Math.abs(ms) / 3600_000);
  if (ms < 0) return `valid in +${h} h`;
  if (h < 1) return 'age < 1 h';
  if (h < 48) return `age ${h} h`;
  return `age ${Math.round(h / 24)} d`;
}

function StatusChip({ kind, age }: { kind: 'OBSERVATION' | 'FORECAST' | 'MODEL' | 'PLANNED'; age?: string | null }) {
  const color = kind === 'OBSERVATION' ? 'var(--color-risk-low)'
    : kind === 'PLANNED' ? 'var(--color-ink-faint)' : 'var(--color-model)';
  return (
    <span className="font-data text-[8px] font-bold whitespace-nowrap" style={{ color }}>
      {kind}{age ? ` · ${age}` : ''}
    </span>
  );
}

interface LayerRowProps {
  label: string;
  hint: string;
  on?: boolean;
  onToggle?: () => void;
  chip: React.ReactNode;
  details: { source: string; resolution: string; valid: string; cadence: string; note?: string };
  disabled?: boolean;
}

function LayerRow({ label, hint, on, onToggle, chip, details, disabled }: LayerRowProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={disabled ? 'opacity-55' : ''}>
      <div className="flex items-center justify-between gap-2 py-1">
        <button className="text-left flex-1 min-w-0" onClick={() => setOpen(!open)} aria-expanded={open}>
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] text-ink font-medium">{label}</span>
            {chip}
          </div>
          <div className="text-[9px] text-ink-faint">{hint}</div>
        </button>
        {onToggle && !disabled && <Toggle on={!!on} onChange={onToggle} label={`Toggle ${label}`} />}
        {disabled && <span className="text-[8px] font-data text-ink-faint">NO DATA SOURCE</span>}
      </div>
      {open && (
        <div className="px-2 pb-1.5 text-[9px] text-ink-faint leading-snug space-y-0.5 fade-in">
          <div><span className="text-ink-dim">Source</span> · {details.source}</div>
          <div><span className="text-ink-dim">Resolution</span> · {details.resolution}</div>
          <div><span className="text-ink-dim">Valid</span> · {details.valid}</div>
          <div><span className="text-ink-dim">Cadence</span> · {details.cadence}</div>
          {details.note && <div>{details.note}</div>}
        </div>
      )}
    </div>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[8.5px] font-data font-bold tracking-[0.18em] text-ink-faint mt-2 mb-0.5">
      {children}
    </div>
  );
}

export default function EnvLayerControl() {
  const env = useEnv();
  const { layers, toggleLayer } = useStore();

  const seaIceValid = env.forecastHorizon !== null && env.forecast
    ? env.forecast.meta.temporal.validTime
    : env.seaIce?.meta.temporal.validTime;
  const seaIceKind: 'OBSERVATION' | 'FORECAST' = env.forecastHorizon !== null ? 'FORECAST' : 'OBSERVATION';
  const wxHour = env.weather?.data.hour;
  const wxIsForecast = Boolean(wxHour && env.weatherNowHour && wxHour > env.weatherNowHour);

  // ONE PRIMARY RASTER rule: sea-ice concentration vs risk severity.
  const primary: 'SEAICE' | 'RISK' | 'NONE' =
    env.riskEnabled ? 'RISK' : layers.seaIce ? 'SEAICE' : 'NONE';
  const setPrimary = (p: 'SEAICE' | 'RISK' | 'NONE') => {
    if (p === 'RISK') {
      if (layers.seaIce) toggleLayer('seaIce');
      if (!env.riskEnabled) env.setRiskEnabled(true);
    } else if (p === 'SEAICE') {
      if (env.riskEnabled) env.setRiskEnabled(false);
      if (!layers.seaIce) toggleLayer('seaIce');
    } else {
      if (env.riskEnabled) env.setRiskEnabled(false);
      if (layers.seaIce) toggleLayer('seaIce');
    }
  };

  return (
    <div className="px-3 space-y-0.5">
      {/* primary raster selector */}
      <div className="mb-1.5">
        <div className="text-[9px] text-ink-dim mb-1">Primary raster (one at a time — colour scales never mix)</div>
        <div className="flex gap-1" role="tablist" aria-label="Primary raster layer">
          {([['SEAICE', 'Sea ice'], ['RISK', 'Risk'], ['NONE', 'None']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={primary === k}
              className={`btn !py-1 !px-2.5 !text-[9px] ${primary === k ? 'btn-accent' : ''}`}
              onClick={() => setPrimary(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <GroupTitle>BASE</GroupTitle>
      <LayerRow
        label="Graticule" hint="Meridians & parallels"
        on={layers.graticule} onToggle={() => toggleLayer('graticule')}
        chip={<StatusChip kind="OBSERVATION" />}
        details={{
          source: 'Computed locally (WGS84 grid)',
          resolution: '2° parallels · 5° meridians',
          valid: 'static', cadence: 'static',
        }}
      />
      <LayerRow
        label="Coastline & ice shelves" hint="Natural Earth 1:50m — always shown"
        chip={<StatusChip kind="OBSERVATION" />}
        details={{
          source: 'Natural Earth ne_50m land + Antarctic ice shelves',
          resolution: '1:50 000 000', valid: 'static basemap', cadence: 'static',
          note: 'Base context layer — cannot be switched off.',
        }}
      />

      <GroupTitle>SEA ICE</GroupTitle>
      <LayerRow
        label="Concentration" hint={`NSIDC Sea Ice Index v4 · ${seaIceKind === 'FORECAST' ? `+${env.forecastHorizon}h model forecast` : 'daily observation'}`}
        on={primary === 'SEAICE'} onToggle={() => setPrimary(primary === 'SEAICE' ? 'NONE' : 'SEAICE')}
        chip={<StatusChip kind={seaIceKind} age={ageText(seaIceValid)} />}
        details={{
          source: seaIceKind === 'FORECAST'
            ? `${env.forecast?.meta.model.name ?? 'per-cell model'} on NSIDC observations`
            : 'NSIDC/NOAA Sea Ice Index v4 (G02135), passive microwave',
          resolution: '25 km (0.5°×0.25° normalized grid)',
          valid: seaIceValid ?? '—',
          cadence: 'daily (~1 day latency)',
          note: 'Units: % areal concentration, 0–100. Delayed observation — never labelled LIVE.',
        }}
      />
      <LayerRow
        label="Forecast uncertainty (±σ)" hint="Backtest MAE per horizon"
        on={env.showSigma} onToggle={() => env.setShowSigma(!env.showSigma)}
        chip={<StatusChip kind="MODEL" />}
        disabled={env.forecastHorizon === null}
        details={{
          source: 'Walk-forward backtest of the sea-ice forecast model',
          resolution: 'same grid as concentration',
          valid: env.forecast?.meta.temporal.validTime ?? 'requires a forecast horizon',
          cadence: 'per forecast run',
          note: env.forecastHorizon === null ? 'Enable a forecast horizon (+24/48/72 h) first.' : undefined,
        }}
      />

      <GroupTitle>ICEBERGS</GroupTitle>
      <LayerRow
        label="Charted positions" hint="USNIC named bergs ≥10 nm"
        on={layers.icebergs} onToggle={() => toggleLayer('icebergs')}
        chip={<StatusChip kind="OBSERVATION" age={ageText(env.icebergs?.meta.temporal.validTime as string | undefined)} />}
        details={{
          source: 'U.S. National Ice Center Antarctic iceberg analysis',
          resolution: 'point positions (analyst product)',
          valid: (env.icebergs?.meta.temporal.validTime as string | undefined) ?? 'per-berg last_update',
          cadence: 'weekly',
          note: 'Smaller bergs and growlers are NOT in any input dataset.',
        }}
      />
      <LayerRow
        label="Tracks & drift forecasts" hint="BYU/NIC history + validated predictor"
        on={layers.trajectories} onToggle={() => toggleLayer('trajectories')}
        chip={<StatusChip kind="MODEL" />}
        details={{
          source: 'BYU/NIC consolidated database v8.0 + drift model (backtested)',
          resolution: 'point tracks; P50/P90 error corridors',
          valid: 'corridors validated to +7 days',
          cadence: 'recomputed on data refresh',
        }}
      />

      <GroupTitle>ATMOSPHERE</GroupTitle>
      <LayerRow
        label="Wind field (10 m)" hint="Open-Meteo model wind vectors"
        on={layers.weather} onToggle={() => toggleLayer('weather')}
        chip={<StatusChip kind={wxIsForecast ? 'FORECAST' : 'OBSERVATION'} age={wxHour ? ageText(wxHour + ':00Z') : null} />}
        details={{
          source: 'Open-Meteo global model (archive hours + forecast)',
          resolution: '5°×2.5° sampling grid',
          valid: wxHour ? `${wxHour}Z` : '—',
          cadence: 'hourly',
          note: 'Units: knots. Past hours are model archive (OBSERVED_ARCHIVE), future hours forecast.',
        }}
      />
      <LayerRow
        label="Air temperature (2 m)" hint="Same Open-Meteo cells — shown in readouts, not mapped"
        chip={<StatusChip kind={wxIsForecast ? 'FORECAST' : 'OBSERVATION'} />}
        details={{
          source: 'Open-Meteo global model',
          resolution: '5°×2.5° sampling grid',
          valid: wxHour ? `${wxHour}Z` : '—',
          cadence: 'hourly',
          note: 'Displayed in hover/vessel readouts and used by the icing model; a dedicated raster is not rendered.',
        }}
      />

      <GroupTitle>OCEAN</GroupTitle>
      <LayerRow
        label="Waves / swell" hint="No data source connected"
        chip={<StatusChip kind="PLANNED" />} disabled
        details={{
          source: 'none — PLANNED', resolution: '—', valid: '—', cadence: '—',
          note: 'No wave product is ingested. This layer is listed for completeness and is never rendered from invented data. Waves do NOT contribute to the risk engine.',
        }}
      />
      <LayerRow
        label="Ocean currents" hint="No data source connected"
        chip={<StatusChip kind="PLANNED" />} disabled
        details={{
          source: 'none — PLANNED', resolution: '—', valid: '—', cadence: '—',
          note: 'No current product is ingested. Currents do NOT contribute to the risk engine.',
        }}
      />

      <GroupTitle>NAVIGATION</GroupTitle>
      <LayerRow
        label="Risk severity surface" hint={`POLARIS + icing + berg zones · ${env.riskIceClass}`}
        on={primary === 'RISK'} onToggle={() => setPrimary(primary === 'RISK' ? 'NONE' : 'RISK')}
        chip={<StatusChip kind={env.risk && (env.risk.meta.temporal as { horizonH?: number }).horizonH ? 'FORECAST' : 'MODEL'} />}
        details={{
          source: 'Risk engine: IMO POLARIS RIO + Overland (1990) icing + empirical berg hazard zones',
          resolution: '0.5°×0.25° (~14×28 km)',
          valid: (env.risk?.meta.temporal as { weatherHour?: string })?.weatherHour
            ? `wx ${(env.risk?.meta.temporal as { weatherHour?: string }).weatherHour}Z` : '—',
          cadence: 'on demand',
          note: 'Categories LOW/MEDIUM/HIGH/CRITICAL — worst-of combination, no weighted sums.',
        }}
      />

      <Details label="Route risk contribution — which layers matter">
        <div className="text-[9px] leading-snug space-y-1">
          <p className="m-0 text-ink-dim">The route optimizer scores routes on the risk surface. Contribution status per layer:</p>
          <p className="m-0"><span style={{ color: 'var(--color-risk-low)' }}>● USED IN RISK MODEL</span> — sea-ice concentration (POLARIS RIO), wind + air temperature (Overland icing predictor), iceberg positions & drift-error zones.</p>
          <p className="m-0"><span style={{ color: 'var(--color-accent)' }}>● ANALYSIS ONLY</span> — forecast uncertainty ±σ (flags category-sensitive cells; shown, not a score term), tracks/trajectory history (context for the berg zones).</p>
          <p className="m-0"><span style={{ color: 'var(--color-ink-faint)' }}>● NOT IN MODEL (planned)</span> — waves/swell, ocean currents: no data source, no contribution. The system never claims these affect route scores.</p>
        </div>
      </Details>
    </div>
  );
}
