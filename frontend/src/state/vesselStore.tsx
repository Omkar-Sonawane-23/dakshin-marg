/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface VesselProfile {
  id: string;
  name: string;
  callsign: string;
  type: 'RESEARCH' | 'SUPPLY' | 'ICEBREAKER' | 'TANKER';
  iceClass: string; // PC1..PC7, IA, IB, IC, NONE
  draftM: number;
  beamM: number;
  lengthM: number;
  installedPowerKw: number;
  maxSpeedKn: number;
  cruiseSpeedKn: number;
  fuelCapacityT: number;
  turningRadiusNm: number;
  reserveFuelPct: number;
  maxIceConcPct: number; // operational limit
  polarisClass: string;
  status: 'OPERATIONAL' | 'MAINTENANCE' | 'RETIRED';
  description: string;
}

export const VESSELS: VesselProfile[] = [
  {
    id: 'VSL-01',
    name: 'RSV Dakshin Dhruv',
    callsign: 'ATVK',
    type: 'RESEARCH',
    iceClass: 'PC5',
    draftM: 8.2,
    beamM: 22.4,
    lengthM: 122,
    installedPowerKw: 8500,
    maxSpeedKn: 16.5,
    cruiseSpeedKn: 12.5,
    fuelCapacityT: 1200,
    turningRadiusNm: 0.8,
    reserveFuelPct: 20,
    maxIceConcPct: 70,
    polarisClass: 'PC5',
    status: 'OPERATIONAL',
    description: 'NCPOR flagship — moderate icebreaking, primary Bharati/Maitri supply.',
  },
  {
    id: 'VSL-02',
    name: 'IBV Himadri',
    callsign: 'ATVM',
    type: 'ICEBREAKER',
    iceClass: 'PC3',
    draftM: 9.1,
    beamM: 26.0,
    lengthM: 138,
    installedPowerKw: 18000,
    maxSpeedKn: 18.0,
    cruiseSpeedKn: 13.0,
    fuelCapacityT: 1800,
    turningRadiusNm: 1.1,
    reserveFuelPct: 25,
    maxIceConcPct: 90,
    polarisClass: 'PC3',
    status: 'OPERATIONAL',
    description: 'Heavy icebreaker — year-round Antarctic escort, deep-field access.',
  },
  {
    id: 'VSL-03',
    name: 'MV Priyadarshini',
    callsign: 'ATVP',
    type: 'SUPPLY',
    iceClass: 'PC7',
    draftM: 7.4,
    beamM: 20.1,
    lengthM: 105,
    installedPowerKw: 5200,
    maxSpeedKn: 14.2,
    cruiseSpeedKn: 11.0,
    fuelCapacityT: 900,
    turningRadiusNm: 0.6,
    reserveFuelPct: 15,
    maxIceConcPct: 50,
    polarisClass: 'PC7',
    status: 'OPERATIONAL',
    description: 'Light supply vessel — ice-strengthened, summer-only operations.',
  },
  {
    id: 'VSL-04',
    name: 'RV Sagarnidhi II',
    callsign: 'ATVS',
    type: 'RESEARCH',
    iceClass: 'IA',
    draftM: 6.8,
    beamM: 18.5,
    lengthM: 98,
    installedPowerKw: 4200,
    maxSpeedKn: 13.5,
    cruiseSpeedKn: 10.5,
    fuelCapacityT: 650,
    turningRadiusNm: 0.5,
    reserveFuelPct: 15,
    maxIceConcPct: 35,
    polarisClass: 'IA',
    status: 'OPERATIONAL',
    description: 'Ocean research — Baltic ice class, marginal ice zone only.',
  },
  {
    id: 'VSL-05',
    name: 'MT Varuna',
    callsign: 'ATVT',
    type: 'TANKER',
    iceClass: 'NONE',
    draftM: 8.0,
    beamM: 24.0,
    lengthM: 115,
    installedPowerKw: 6000,
    maxSpeedKn: 15.0,
    cruiseSpeedKn: 12.0,
    fuelCapacityT: 2200,
    turningRadiusNm: 0.9,
    reserveFuelPct: 15,
    maxIceConcPct: 10,
    polarisClass: 'NONE',
    status: 'OPERATIONAL',
    description: 'Unstrengthened tanker — open-water only, requires ice-free corridor.',
  },
];

export const ICE_CLASS_ORDER = ['PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC7', 'IA', 'IB', 'IC', 'NONE'] as const;

export function iceClassRank(c: string): number {
  const idx = ICE_CLASS_ORDER.indexOf(c as typeof ICE_CLASS_ORDER[number]);
  return idx === -1 ? 99 : idx;
}

interface VesselStoreShape {
  vessels: VesselProfile[];
  selectedId: string;
  selected: VesselProfile;
  setSelectedId: (id: string) => void;
  compareIds: string[];
  setCompareIds: (ids: string[]) => void;
}

const Ctx = createContext<VesselStoreShape | null>(null);

export function VesselProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string>('VSL-01');
  const [compareIds, setCompareIds] = useState<string[]>(['VSL-01', 'VSL-03']);
  const selected = useMemo(() => VESSELS.find(v => v.id === selectedId) ?? VESSELS[0], [selectedId]);
  const value = useMemo<VesselStoreShape>(() => ({
    vessels: VESSELS,
    selectedId, selected, setSelectedId, compareIds, setCompareIds,
  }), [selectedId, selected, compareIds]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVessels(): VesselStoreShape {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVessels outside provider');
  return v;
}
