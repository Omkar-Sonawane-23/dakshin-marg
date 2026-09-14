import { useEffect, useState, type CSSProperties } from 'react';
import Icon from './Icon';
import { DataTag, StatusPill } from './ShowcasePrimitives';

const mapReadouts = [
  { label: 'ICE EDGE', value: '62.8° S', tone: 'violet' },
  { label: 'BERG TRACKS', value: '13 TRACKED', tone: 'cyan' },
  { label: 'ROUTE STATE', value: 'REVIEWABLE', tone: 'green' },
];

export default function HeroMap() {
  const [sweep, setSweep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setSweep((value) => (value + 1) % 4), 2600);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="hero-map-shell" aria-label="Illustrated Antarctic route intelligence view">
      <div className="hero-map-topline">
        <span><i className="live-dot" /> OPERATIONAL UI PREVIEW</span>
        <span className="mono">AOI / 40–100°E · 55–72°S</span>
      </div>
      <div className="hero-map-canvas">
        <div className="map-scanline" style={{ '--scan-position': `${sweep * 28 + 8}%` } as CSSProperties} />
        <svg className="hero-map-svg" viewBox="0 0 720 520" role="img" aria-label="Polar chart showing sea-ice edge, iceberg uncertainty zones and a balanced vessel route">
          <defs>
            <radialGradient id="hero-ocean" cx="52%" cy="48%" r="72%">
              <stop offset="0" stopColor="#12384b" stopOpacity=".58" />
              <stop offset=".55" stopColor="#071a2b" stopOpacity=".6" />
              <stop offset="1" stopColor="#030a13" stopOpacity=".98" />
            </radialGradient>
            <linearGradient id="hero-ice" x1="0" x2="1">
              <stop offset="0" stopColor="#a7f3ff" stopOpacity=".08" />
              <stop offset=".5" stopColor="#eafcff" stopOpacity=".82" />
              <stop offset="1" stopColor="#8a9cff" stopOpacity=".1" />
            </linearGradient>
            <linearGradient id="hero-route" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#7bf4c4" />
              <stop offset=".48" stopColor="#58e7ee" />
              <stop offset="1" stopColor="#b5a7ff" />
            </linearGradient>
            <filter id="hero-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <pattern id="hero-grid" width="46" height="46" patternUnits="userSpaceOnUse">
              <path d="M46 0H0V46" fill="none" stroke="#8addec" strokeOpacity=".08" strokeWidth="1" />
              <circle cx="0" cy="0" r="1" fill="#9ceffc" fillOpacity=".15" />
            </pattern>
            <clipPath id="hero-circle"><circle cx="360" cy="260" r="252" /></clipPath>
          </defs>
          <rect width="720" height="520" fill="url(#hero-ocean)" />
          <circle cx="360" cy="260" r="252" fill="url(#hero-grid)" stroke="#72e6ef" strokeOpacity=".16" />
          <g clipPath="url(#hero-circle)" fill="none">
            <ellipse cx="360" cy="260" rx="212" ry="180" stroke="#a9eaf4" strokeOpacity=".13" />
            <ellipse cx="360" cy="260" rx="155" ry="130" stroke="#a9eaf4" strokeOpacity=".12" />
            <ellipse cx="360" cy="260" rx="92" ry="76" stroke="#a9eaf4" strokeOpacity=".1" />
            <path d="M110 266C182 194 228 181 286 210s74 50 127 28 108-13 190 47" stroke="#5bd8eb" strokeOpacity=".26" strokeDasharray="2 8" />
            <path d="M120 329C188 265 246 289 298 326s97 45 150 8 92-53 161-22" stroke="#a3c8ff" strokeOpacity=".2" strokeDasharray="1 7" />
            <path d="M360 0V520M0 260H720M105 78 615 442M615 78 105 442" stroke="#84deef" strokeOpacity=".08" />
            <path d="M72 344C144 315 178 330 222 354c38 21 64 40 107 37 71-5 97-50 147-55 47-5 83 26 163 6" stroke="url(#hero-ice)" strokeWidth="15" strokeLinecap="round" opacity=".82" filter="url(#hero-glow)" />
            <path d="M72 344C144 315 178 330 222 354c38 21 64 40 107 37 71-5 97-50 147-55 47-5 83 26 163 6" stroke="#eaffff" strokeOpacity=".7" strokeWidth="1.5" strokeDasharray="2 5" />
            <path d="M74 367C151 337 181 350 226 379c40 25 75 42 117 31 62-16 91-48 137-51 51-4 91 27 156 6" stroke="#b98dff" strokeOpacity=".22" strokeWidth="24" filter="url(#hero-glow)" />

            <path d="M157 388C207 369 226 338 276 322c48-15 73-14 106-49 28-30 59-54 93-68 31-13 56-10 82-1" stroke="#59e6c0" strokeOpacity=".18" strokeWidth="12" filter="url(#hero-glow)" />
            <path d="M157 388C207 369 226 338 276 322c48-15 73-14 106-49 28-30 59-54 93-68 31-13 56-10 82-1" stroke="url(#hero-route)" strokeWidth="2.5" strokeDasharray="8 7" className="hero-route-line" />
            <path d="M157 388C207 369 226 338 276 322c48-15 73-14 106-49 28-30 59-54 93-68 31-13 56-10 82-1" stroke="#d2fff3" strokeOpacity=".48" strokeWidth="1" strokeDasharray="2 11" />

            <circle cx="157" cy="388" r="8" fill="#07121d" stroke="#7bf4c4" strokeWidth="2" />
            <circle cx="157" cy="388" r="3" fill="#7bf4c4" />
            <circle cx="520" cy="202" r="12" fill="#081725" stroke="#58e7ee" strokeWidth="2" filter="url(#hero-glow)" />
            <path d="m520 191 5 13-5 7-5-7z" fill="#f3ffff" />
            <circle cx="520" cy="202" r="21" fill="none" stroke="#58e7ee" strokeOpacity=".34" className="vessel-ping" />

            <g className="berg-marker" transform="translate(354 274)">
              <path d="m0-10 9 16H-9z" fill="#d9f8ff" fillOpacity=".9" />
              <circle r="18" fill="none" stroke="#b5a7ff" strokeOpacity=".32" strokeDasharray="3 4" />
              <circle r="30" fill="none" stroke="#b5a7ff" strokeOpacity=".13" />
            </g>
            <g transform="translate(443 245)">
              <path d="m0-7 6 11H-6z" fill="#d9f8ff" fillOpacity=".68" />
              <circle r="13" fill="none" stroke="#9aa6ff" strokeOpacity=".2" strokeDasharray="2 4" />
            </g>
          </g>

          <g className="map-label map-label-ice" transform="translate(116 346)">
            <path d="M0 0h42" stroke="#b3f8ff" strokeOpacity=".55" />
            <text x="50" y="4">ICE EDGE / 25 KM GRID</text>
          </g>
          <g className="map-label map-label-origin" transform="translate(130 421)">
            <text x="0" y="0">ORIGIN</text><text x="0" y="15" className="map-label-value">BHARATI · 69.4°S</text>
          </g>
          <g className="map-label map-label-vessel" transform="translate(536 187)">
            <text x="0" y="0">RSV DAKSHIN DHRUV</text><text x="0" y="15" className="map-label-value">ROUTE / BALANCED</text>
          </g>
          <text x="360" y="264" textAnchor="middle" className="map-center-label">ANTARCTIC POLAR STEREOGRAPHIC VIEW</text>
        </svg>
        <div className="hero-map-coordinates mono">64° 12′ S<br />76° 04′ E</div>
        <div className="hero-map-scale mono"><span>0</span><i /><span>250 NM</span></div>
      </div>
      <div className="hero-map-readouts">
        {mapReadouts.map((readout) => (
          <div className="hero-readout" key={readout.label}>
            <span>{readout.label}</span>
            <strong className={`readout-${readout.tone}`}>{readout.value}</strong>
          </div>
        ))}
      </div>
      <div className="hero-map-footer">
        <StatusPill tone="green" icon="target">HUMAN DECISION REQUIRED</StatusPill>
        <DataTag tone="forecast">MODEL / +48H</DataTag>
        <span className="hero-map-footer-copy"><Icon name="layers" size={13} /> 04 intelligence layers aligned</span>
      </div>
    </div>
  );
}
