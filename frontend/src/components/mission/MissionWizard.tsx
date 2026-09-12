/** Mission creation wizard — endpoints (map pick / station list / manual),
 * departure time validated against REAL data availability, vessel config,
 * and a review screen with [Edit mission] / [Create & generate routes].
 */

import { useEffect, useState } from 'react';
import { useMission } from '../../state/missionStore';
import { resolveTime, MissionApiError } from '../../api/missionClient';
import type { TimeResolution } from '../../types/mission';
import { STATIONS, inRoutingDomain, ROUTING_DOMAIN } from '../../data/stations';
import { fmtPos } from '../../lib/format';

type EndKey = 'origin' | 'destination';

interface EndpointDraft { lat: string; lon: string; label: string }

const ICE_CLASSES = ['PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6', 'PC7', 'IA_SUPER', 'IA', 'IB', 'IC', 'NONE'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

function parseNum(s: string): number | null {
  const v = Number(s);
  return s.trim() !== '' && Number.isFinite(v) ? v : null;
}

/** datetime-local value + tz choice → UTC ISO. */
function toUtcIso(local: string, tz: 'UTC' | 'LOCAL'): string | null {
  if (!local) return null;
  if (tz === 'UTC') return `${local}:00Z`.replace(/:00:00Z$/, ':00Z');
  const d = new Date(local);            // parsed in browser-local time
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export default function MissionWizard() {
  const ms = useMission();
  const av = ms.availability;

  const [step, setStep] = useState<'FORM' | 'REVIEW'>('FORM');
  const [name, setName] = useState('');
  const [vesselName, setVesselName] = useState('');
  const [vesselType, setVesselType] = useState('Research / resupply');
  const [iceClass, setIceClass] = useState('PC5');
  const [cruise, setCruise] = useState('12');
  const [maxSpeed, setMaxSpeed] = useState('');
  const [maxSev, setMaxSev] = useState<(typeof SEVERITIES)[number]>('MEDIUM');
  const [ends, setEnds] = useState<Record<EndKey, EndpointDraft>>({
    origin: { lat: '', lon: '', label: '' },
    destination: { lat: '', lon: '', label: '' },
  });
  const [depLocal, setDepLocal] = useState('');
  const [tz, setTz] = useState<'UTC' | 'LOCAL'>('UTC');
  const [search, setSearch] = useState<Record<EndKey, string>>({ origin: '', destination: '' });
  const [timeCheck, setTimeCheck] = useState<TimeResolution | null>(null);
  const [timeCheckErr, setTimeCheckErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Map pick result arrives through the store.
  useEffect(() => {
    if (!ms.pickedPoint) return;
    const { target, lat, lon } = ms.pickedPoint;
    setEnds((e) => ({
      ...e,
      [target]: { lat: lat.toFixed(3), lon: lon.toFixed(3), label: 'Map point' },
    }));
    ms.clearPickedPoint();
  }, [ms, ms.pickedPoint]);

  // Departure validation against the real availability window (server rule).
  const depIso = toUtcIso(depLocal, tz);
  useEffect(() => {
    setTimeCheck(null);
    setTimeCheckErr(null);
    if (!depIso) return;
    const t = window.setTimeout(() => {
      resolveTime(depIso)
        .then(setTimeCheck)
        .catch((e: MissionApiError) => setTimeCheckErr(e.message));
    }, 350);
    return () => window.clearTimeout(t);
  }, [depIso]);

  const endPoint = (k: EndKey) => {
    const lat = parseNum(ends[k].lat);
    const lon = parseNum(ends[k].lon);
    return lat !== null && lon !== null ? { lat, lon } : null;
  };

  const endpointIssue = (k: EndKey): string | null => {
    const p = endPoint(k);
    if (!p) return null;
    if (!inRoutingDomain(p.lat, p.lon)) {
      return `Outside the routing domain (${ROUTING_DOMAIN.lonMin}–${ROUTING_DOMAIN.lonMax}°E, ` +
        `${Math.abs(ROUTING_DOMAIN.latMin)}–${Math.abs(ROUTING_DOMAIN.latMax)}°S) — the risk surface has no data here.`;
    }
    return null;
  };

  const formValid = Boolean(
    name.trim() && vesselName.trim()
    && endPoint('origin') && endPoint('destination')
    && !endpointIssue('origin') && !endpointIssue('destination')
    && depIso && timeCheck?.status === 'OK'
    && parseNum(cruise) !== null && parseNum(cruise)! >= 3 && parseNum(cruise)! <= 30,
  );

  const submit = async () => {
    if (!formValid || !depIso) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const m = await ms.createMission({
        name: name.trim(),
        origin: endPoint('origin')!,
        originLabel: ends.origin.label || undefined,
        destination: endPoint('destination')!,
        destinationLabel: ends.destination.label || undefined,
        departureUtc: depIso,
        vessel: {
          name: vesselName.trim(), type: vesselType, iceClass,
          cruiseSpeedKn: parseNum(cruise)!,
          maxSpeedKn: parseNum(maxSpeed),
          maxAcceptableSeverity: maxSev,
        },
      });
      ms.setWizardOpen(false);
      ms.openMission(m.id);
      // Kick off route generation once the mission loads.
      window.setTimeout(() => void ms.generateRoutes(), 600);
    } catch (e) {
      setSubmitError((e as MissionApiError).message);
      setStep('FORM');
    } finally {
      setSubmitting(false);
    }
  };

  const stationRows = (k: EndKey) => {
    const q = search[k].toLowerCase();
    return STATIONS.filter((s) => !q || s.name.toLowerCase().includes(q) || s.operator.toLowerCase().includes(q));
  };

  const windowText = av
    ? `${av.window.start.replace('T', ' ').replace(':00Z', 'Z')} → ${av.window.end.replace('T', ' ').replace(':00Z', 'Z')}`
    : 'loading…';

  // While picking on the map, the wizard collapses to a floating banner.
  if (ms.pickTarget) {
    return (
      <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 bg-panel border border-accent-dim rounded px-4 py-2.5 shadow-lg flex items-center gap-3 fade-in">
        <span className="pulse-dot text-accent">●</span>
        <span className="text-[12px] text-ink">
          Click the map to set the <b className="text-accent">{ms.pickTarget.toUpperCase()}</b>
        </span>
        <button className="btn !py-1 !text-[9px]" onClick={() => ms.setPickTarget(null)}>Cancel</button>
      </div>
    );
  }

  const inputCls = 'w-full bg-panel-2 border border-line rounded-sm px-2 py-1.5 text-[11px] text-ink font-data focus:border-accent-dim focus:outline-none';
  const lblCls = 'text-[9.5px] text-ink-dim uppercase tracking-wider mb-1 block';

  const endpointEditor = (k: EndKey, title: string) => {
    const issue = endpointIssue(k);
    return (
      <div className="panel-inset rounded-sm p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-semibold text-ice">{title}</span>
          <button className="btn !py-1 !px-2 !text-[9px]" onClick={() => ms.setPickTarget(k)}>
            ⌖ Pick on map
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <label className={lblCls}>Lat (°)</label>
            <input className={inputCls} value={ends[k].lat} placeholder="-69.407"
              onChange={(e) => setEnds({ ...ends, [k]: { ...ends[k], lat: e.target.value, label: ends[k].label === 'Map point' ? '' : ends[k].label } })} />
          </div>
          <div>
            <label className={lblCls}>Lon (°)</label>
            <input className={inputCls} value={ends[k].lon} placeholder="76.192"
              onChange={(e) => setEnds({ ...ends, [k]: { ...ends[k], lon: e.target.value } })} />
          </div>
          <div>
            <label className={lblCls}>Label</label>
            <input className={inputCls} value={ends[k].label} placeholder="optional"
              onChange={(e) => setEnds({ ...ends, [k]: { ...ends[k], label: e.target.value } })} />
          </div>
        </div>
        <div>
          <input className={inputCls} value={search[k]} placeholder="Search stations & approach points…"
            onChange={(e) => setSearch({ ...search, [k]: e.target.value })} />
          <div className="max-h-[104px] overflow-y-auto mt-1 space-y-0.5">
            {stationRows(k).map((s) => {
              const ok = inRoutingDomain(s.lat, s.lon);
              return (
                <button key={s.id} disabled={!ok}
                  className={`w-full text-left px-2 py-1 rounded-sm text-[10px] transition-colors ${ok ? 'hover:bg-panel-2 text-ink' : 'text-ink-faint cursor-not-allowed opacity-60'}`}
                  onClick={() => setEnds({ ...ends, [k]: { lat: s.lat.toFixed(3), lon: s.lon.toFixed(3), label: s.name } })}
                  title={ok ? undefined : 'Outside the current routing domain — no risk surface here'}
                >
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-ink-faint"> · {s.operator} · {fmtPos(s.lon, s.lat)}</span>
                  {!ok && <span className="text-risk-MEDIUM"> · outside routing domain</span>}
                </button>
              );
            })}
          </div>
        </div>
        {issue && <div className="text-[9.5px] text-risk-HIGH leading-snug" role="alert">⚠ {issue}</div>}
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-abyss/70 backdrop-blur-sm p-4" role="dialog" aria-label="Create mission">
      <div className="w-full max-w-[720px] max-h-full overflow-y-auto bg-panel border border-line rounded shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line sticky top-0 bg-panel z-10">
          <div>
            <div className="font-data text-[13px] font-bold text-ice tracking-wider">
              {step === 'FORM' ? 'CREATE NEW MISSION' : 'MISSION REVIEW'}
            </div>
            <div className="text-[9.5px] text-ink-faint mt-0.5">
              {step === 'FORM'
                ? 'All parameters are operator-defined — nothing is hardcoded into the route computation.'
                : 'Confirm the plan before generating routes.'}
            </div>
          </div>
          <button className="btn !py-1 !text-[9px]" onClick={() => ms.setWizardOpen(false)}>✕ Close</button>
        </div>

        {step === 'FORM' && (
          <div className="p-4 space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className={lblCls}>Mission name</label>
                <input className={inputCls} value={name} placeholder="Bharati resupply — leg 2"
                  onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className={lblCls}>Vessel name</label>
                <input className={inputCls} value={vesselName} placeholder="MV Vasiliy Golovnin"
                  onChange={(e) => setVesselName(e.target.value)} />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              {endpointEditor('origin', 'ORIGIN')}
              {endpointEditor('destination', 'DESTINATION')}
            </div>

            {/* departure time */}
            <div className="panel-inset rounded-sm p-2.5 space-y-2">
              <div className="text-[10.5px] font-semibold text-ice">DEPARTURE TIME</div>
              <div className="grid grid-cols-[1fr_auto] gap-1.5 items-end">
                <div>
                  <label className={lblCls}>Date & time</label>
                  <input type="datetime-local" className={inputCls} value={depLocal}
                    onChange={(e) => setDepLocal(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>Timezone</label>
                  <select className={inputCls} value={tz} onChange={(e) => setTz(e.target.value as 'UTC' | 'LOCAL')}>
                    <option value="UTC">UTC</option>
                    <option value="LOCAL">Local ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
                  </select>
                </div>
              </div>
              <div className="text-[9.5px] text-ink-faint">
                Environmental data available: <span className="font-data text-ink-dim">{windowText}</span> — historical
                observation days, the current analysis, and validated forecasts to +72 h. Dates outside this window are refused.
              </div>
              {timeCheckErr && <div className="text-[9.5px] text-risk-HIGH" role="alert">⚠ {timeCheckErr}</div>}
              {timeCheck && timeCheck.status !== 'OK' && (
                <div className="text-[9.5px] text-risk-HIGH" role="alert">⚠ {timeCheck.message}</div>
              )}
              {timeCheck?.status === 'OK' && (
                <div className="text-[9.5px] leading-snug space-y-0.5" style={{ color: 'var(--color-risk-low)' }}>
                  <div>✓ Data available — sea ice: {timeCheck.seaIceKind} valid {timeCheck.seaIceValidTime?.slice(0, 16)}Z · weather: {timeCheck.weatherKind} {timeCheck.weatherHour}Z</div>
                  {timeCheck.notes?.map((n, i) => (
                    <div key={i} className="text-ink-faint">· {n}</div>
                  ))}
                </div>
              )}
            </div>

            {/* vessel configuration */}
            <div className="panel-inset rounded-sm p-2.5 space-y-2">
              <div className="text-[10.5px] font-semibold text-ice">VESSEL CONFIGURATION</div>
              <div className="grid md:grid-cols-4 grid-cols-2 gap-1.5">
                <div>
                  <label className={lblCls}>Type</label>
                  <select className={inputCls} value={vesselType} onChange={(e) => setVesselType(e.target.value)}>
                    <option>Research / resupply</option>
                    <option>Icebreaker</option>
                    <option>Cargo</option>
                    <option>Tanker</option>
                  </select>
                </div>
                <div>
                  <label className={lblCls}>Ice class (POLARIS)</label>
                  <select className={inputCls} value={iceClass} onChange={(e) => setIceClass(e.target.value)}>
                    {ICE_CLASSES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lblCls}>Cruise speed (kn)</label>
                  <input className={inputCls} value={cruise} onChange={(e) => setCruise(e.target.value)} />
                </div>
                <div>
                  <label className={lblCls}>Max speed (kn, opt.)</label>
                  <input className={inputCls} value={maxSpeed} placeholder="—" onChange={(e) => setMaxSpeed(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={lblCls}>Max acceptable route severity</label>
                <div className="flex gap-1">
                  {SEVERITIES.map((s) => (
                    <button key={s} className={`btn !py-1 !px-3 !text-[9px] ${maxSev === s ? 'btn-accent' : ''}`}
                      onClick={() => setMaxSev(s)}>{s}</button>
                  ))}
                </div>
                <div className="text-[9px] text-ink-faint mt-1">
                  When the remaining route exceeds this severity during the voyage, a ROUTE REVIEW alert is raised.
                  Fuel: no validated consumption model exists — fuel is reported as “Not calculated”, never invented.
                </div>
              </div>
              {parseNum(cruise) !== null && (parseNum(cruise)! < 3 || parseNum(cruise)! > 30) && (
                <div className="text-[9.5px] text-risk-HIGH" role="alert">⚠ Cruise speed must be between 3 and 30 kn.</div>
              )}
            </div>

            {submitError && <div className="text-[10px] text-risk-HIGH" role="alert">⚠ {submitError}</div>}

            <div className="flex justify-end gap-2">
              <button className="btn !text-[10px]" onClick={() => ms.setWizardOpen(false)}>Cancel</button>
              <button className="btn btn-accent !text-[10px]" disabled={!formValid} onClick={() => setStep('REVIEW')}>
                Review mission ▸
              </button>
            </div>
          </div>
        )}

        {step === 'REVIEW' && (
          <div className="p-4 space-y-3">
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {[
                ['Mission', name],
                ['Vessel', `${vesselName} · ${vesselType}`],
                ['Ice class', iceClass],
                ['Cruise / max speed', `${cruise} kn${maxSpeed ? ` / ${maxSpeed} kn` : ''}`],
                ['Origin', `${ends.origin.label ? ends.origin.label + ' · ' : ''}${ends.origin.lat}°, ${ends.origin.lon}°`],
                ['Destination', `${ends.destination.label ? ends.destination.label + ' · ' : ''}${ends.destination.lat}°, ${ends.destination.lon}°`],
                ['Departure (UTC)', depIso ?? '—'],
                ['Max acceptable severity', maxSev],
                ['Fuel model', 'Not available — estimates will show “Not calculated”'],
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between gap-3 border-b border-line/50 pb-1">
                  <span className="text-ink-dim text-[10px]">{l}</span>
                  <span className="font-data text-ice text-right text-[10.5px]">{v}</span>
                </div>
              ))}
            </div>
            {timeCheck?.status === 'OK' && (
              <div className="panel-inset rounded-sm p-2 text-[9.5px] text-ink-dim leading-snug">
                <div className="font-semibold text-ink mb-0.5">Environmental data resolution for this departure</div>
                {timeCheck.notes?.map((n, i) => <div key={i}>· {n}</div>)}
              </div>
            )}
            {submitError && <div className="text-[10px] text-risk-HIGH" role="alert">⚠ {submitError}</div>}
            <div className="flex justify-end gap-2">
              <button className="btn !text-[10px]" onClick={() => setStep('FORM')} disabled={submitting}>◂ Edit mission</button>
              <button className="btn btn-accent !text-[10px]" onClick={() => void submit()} disabled={submitting}>
                {submitting ? 'Creating…' : 'Create mission & generate routes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
