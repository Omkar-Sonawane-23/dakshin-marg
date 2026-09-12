/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Scenario, ScenarioSnapshot } from '../types/domain';
import { fetchScenario, ApiError } from '../api/client';

export interface LayerState {
  seaIce: boolean;
  icebergs: boolean;
  trajectories: boolean;
  risk: boolean;
  weather: boolean;
  routes: boolean;
  graticule: boolean;
}

export type SelectionType =
  | { kind: 'none' }
  | { kind: 'iceberg'; id: string }
  | { kind: 'route'; id: string }
  | { kind: 'vessel' };

interface Store {
  loading: boolean;
  error: { code: string; message: string } | null;
  scenario: Scenario | null;
  snapshot: ScenarioSnapshot | null;
  timeIndex: number;
  setTimeIndex: (i: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  layers: LayerState;
  toggleLayer: (k: keyof LayerState) => void;
  selection: SelectionType;
  setSelection: (s: SelectionType) => void;
  comparisonOpen: boolean;
  setComparisonOpen: (v: boolean) => void;
  retry: () => void;
  ackAlert: (id: string) => void;
  ackedAlerts: Set<string>;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Store['error']>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [timeIndex, setTimeIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [layers, setLayers] = useState<LayerState>({
    seaIce: true, icebergs: true, trajectories: true, risk: false,
    weather: false, routes: true, graticule: true,
  });
  const [selection, setSelection] = useState<SelectionType>({ kind: 'none' });
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [ackedAlerts, setAcked] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchScenario()
      .then((s) => setScenario(s))
      .catch((e: unknown) => {
        if (e instanceof ApiError) setError({ code: e.code, message: e.message });
        else setError({ code: 'UNKNOWN', message: 'Unexpected failure loading scenario data.' });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Playback: advance one step / 2.2 s
  const playRef = useRef(playing);
  playRef.current = playing;
  useEffect(() => {
    if (!playing || !scenario) return;
    const id = setInterval(() => {
      setTimeIndex((i) => {
        if (i >= scenario.timeStepsH.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 2200);
    return () => clearInterval(id);
  }, [playing, scenario]);

  const snapshot = scenario ? scenario.snapshots[timeIndex] : null;

  const toggleLayer = useCallback((k: keyof LayerState) => {
    setLayers((l) => ({ ...l, [k]: !l[k] }));
  }, []);

  const ackAlert = useCallback((id: string) => {
    setAcked((s) => new Set(s).add(id));
  }, []);

  const value = useMemo<Store>(() => ({
    loading, error, scenario, snapshot, timeIndex, setTimeIndex,
    playing, setPlaying, layers, toggleLayer, selection, setSelection,
    comparisonOpen, setComparisonOpen, retry: load, ackAlert, ackedAlerts,
  }), [loading, error, scenario, snapshot, timeIndex, playing, layers, toggleLayer, selection, comparisonOpen, load, ackAlert, ackedAlerts]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}
