/** Antarctic stations & named approach points for mission endpoint picking.
 *
 * Coordinates are the published station locations (COMNAP catalogue values,
 * rounded to ~100 m). The routing domain is the current risk-surface grid
 * (40.25–100.25°E, 71.875–54.875°S) — stations outside it are listed but
 * DISABLED with the reason shown, never silently dropped or snapped.
 */

export interface Station {
  id: string;
  name: string;
  operator: string;
  lat: number;
  lon: number;
  kind: 'STATION' | 'APPROACH';
  note?: string;
}

/** Routing domain = risk-surface grid bounds (must match the Python grid). */
export const ROUTING_DOMAIN = {
  latMin: -71.875, latMax: -54.875,
  lonMin: 40.25, lonMax: 100.25,
};

export function inRoutingDomain(lat: number, lon: number): boolean {
  return lat >= ROUTING_DOMAIN.latMin && lat <= ROUTING_DOMAIN.latMax
    && lon >= ROUTING_DOMAIN.lonMin && lon <= ROUTING_DOMAIN.lonMax;
}

export const STATIONS: Station[] = [
  { id: 'bharati', name: 'Bharati', operator: 'India (NCPOR)', lat: -69.407, lon: 76.192, kind: 'STATION', note: 'Larsemann Hills, Prydz Bay' },
  { id: 'zhongshan', name: 'Zhongshan', operator: 'China', lat: -69.373, lon: 76.377, kind: 'STATION', note: 'Larsemann Hills' },
  { id: 'progress', name: 'Progress', operator: 'Russia', lat: -69.383, lon: 76.383, kind: 'STATION', note: 'Larsemann Hills' },
  { id: 'davis', name: 'Davis', operator: 'Australia', lat: -68.576, lon: 77.969, kind: 'STATION', note: 'Vestfold Hills' },
  { id: 'mawson', name: 'Mawson', operator: 'Australia', lat: -67.602, lon: 62.873, kind: 'STATION', note: 'Holme Bay' },
  { id: 'mirny', name: 'Mirny', operator: 'Russia', lat: -66.552, lon: 93.010, kind: 'STATION', note: 'Queen Mary Land' },
  { id: 'prydz-approach', name: 'Prydz Bay approach', operator: '—', lat: -66.0, lon: 75.0, kind: 'APPROACH', note: 'Open-water staging point north of Prydz Bay' },
  { id: 'enderby-approach', name: 'Enderby Land approach', operator: '—', lat: -63.5, lon: 52.0, kind: 'APPROACH', note: 'Open-water staging point off Enderby Land' },
  { id: 'wilkes-approach', name: 'Davis Sea approach', operator: '—', lat: -63.0, lon: 92.0, kind: 'APPROACH', note: 'Open-water staging point in the Davis Sea' },
  // Outside the current routing domain — listed for honesty, disabled:
  { id: 'maitri', name: 'Maitri', operator: 'India (NCPOR)', lat: -70.767, lon: 11.730, kind: 'STATION', note: 'Schirmacher Oasis' },
  { id: 'syowa', name: 'Syowa', operator: 'Japan', lat: -69.004, lon: 39.582, kind: 'STATION', note: 'East Ongul Island' },
];
