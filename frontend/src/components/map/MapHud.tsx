/**
 * Camera instruments — the bridge-style control cluster that floats over the
 * 3D environment.
 *
 * Every control does something a navigator actually asks for: change
 * projection, zoom, tilt, spin, re-centre on the ship or the route, reset,
 * go fullscreen. The compass is a live readout of camera azimuth, not a
 * sticker. Nothing here is decorative.
 */
import { useEffect, useState } from 'react';
import type { CameraState } from '../../map3d/PolarScene';

export interface CameraApi {
  setTopDown: (on: boolean) => void;
  zoomBy: (f: number) => void;
  rotateBy: (deg: number) => void;
  setTilt: (deg: number) => void;
  reset: () => void;
  centerVessel: () => void;
  centerRoute: () => void;
  fullscreen: () => void;
}

function IconBtn({
  label, onClick, children, disabled, active,
}: {
  label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      className={`nav-ctl ${active ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export default function MapHud({
  cam, viewMode, onViewMode, api, hasVessel, hasRoute,
}: {
  cam: CameraState | null;
  viewMode: '3D' | '2D';
  onViewMode: (m: '3D' | '2D') => void;
  api: CameraApi;
  hasVessel: boolean;
  hasRoute: boolean;
}) {
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const h = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const tilt = cam ? Math.round(cam.tiltDeg) : 0;
  const az = cam ? Math.round(cam.azimuthDeg) : 0;

  return (
    <>
      {/* top-right: projection + orientation cluster */}
      <div className="nav-instrument-bar absolute top-3 right-3 z-10 flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
        <button
          className={`nav-mode-btn ${viewMode === '3D' ? 'active' : ''}`}
          onClick={() => onViewMode('3D')}
          aria-pressed={viewMode === '3D'}
          title="Tilted 3D perspective"
        >
          3D PERSPECTIVE
        </button>
        <button
          className={`nav-mode-btn ${viewMode === '2D' ? 'active' : ''}`}
          onClick={() => onViewMode('2D')}
          aria-pressed={viewMode === '2D'}
          title="Clean top-down polar chart"
        >
          2D POLAR
        </button>
        <span className="nav-divider" />
        <div className="nav-compass" aria-label={`Camera azimuth ${az} degrees`}>
          <span
            className="nav-compass-needle"
            style={{ transform: `rotate(${-az}deg)` }}
            aria-hidden="true"
          />
        </div>
        <span className="nav-readout">
          HDG {String(az).padStart(3, '0')}° · TILT {String(tilt).padStart(2, '0')}°
        </span>
      </div>

      {/* right: zoom / orientation / centring stack */}
      <div className="absolute right-3 bottom-3 z-10 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()}>
        <div className="nav-pod">
          <IconBtn label="Rotate view left" onClick={() => api.rotateBy(-20)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 9a9 9 0 1 1 1.6 8" strokeLinecap="round" />
              <path d="M3 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconBtn>
          <IconBtn label="Rotate view right" onClick={() => api.rotateBy(20)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M20 9a9 9 0 1 0-1.6 8" strokeLinecap="round" />
              <path d="M21 4v5h-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconBtn>
        </div>
        <div className="nav-pod">
          <label className="nav-tilt" title="Camera tilt">
            <span className="nav-tilt-label">TILT</span>
            <input
              type="range" min={0} max={85} step={1}
              value={tilt}
              onChange={(e) => api.setTilt(Number(e.target.value))}
              aria-label="Camera tilt in degrees"
            />
          </label>
        </div>
        <div className="nav-pod">
          <IconBtn label="Zoom in" onClick={() => api.zoomBy(1.45)}>
            <span className="font-data text-[14px] leading-none">+</span>
          </IconBtn>
          <IconBtn label="Zoom out" onClick={() => api.zoomBy(1 / 1.45)}>
            <span className="font-data text-[14px] leading-none">−</span>
          </IconBtn>
        </div>
        <div className="nav-pod">
          <IconBtn label="Centre on vessel" onClick={api.centerVessel} disabled={!hasVessel}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
              <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" strokeLinecap="round" />
            </svg>
          </IconBtn>
          <IconBtn label="Frame route" onClick={api.centerRoute} disabled={!hasRoute}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M6 19c4-1 3-6 6-7s4-5 6-6" strokeLinecap="round" />
              <circle cx="6" cy="19" r="2" /><circle cx="18" cy="6" r="2" />
            </svg>
          </IconBtn>
          <IconBtn label="Reset camera to mission corridor" onClick={api.reset}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" strokeLinecap="round" /><path d="M3 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconBtn>
          <IconBtn label={isFull ? 'Exit fullscreen' : 'Fullscreen'} onClick={api.fullscreen}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              {isFull
                ? <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" strokeLinecap="round" strokeLinejoin="round" />
                : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />}
            </svg>
          </IconBtn>
        </div>
      </div>
    </>
  );
}
