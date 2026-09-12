/**
 * Screen-space callouts anchored to 3D objects.
 *
 * Text stays in the DOM (crisp, accessible, themeable) while its position is
 * resolved from the scene every frame. Positions are written straight to the
 * DOM — no React state, so a moving vessel never re-renders the panel tree.
 */
import { useEffect, useRef } from 'react';
import type { PolarScene } from '../../map3d/PolarScene';
import type { MapLabelSpec } from './sceneData';

export default function MapLabels({
  scene, labels, ready,
}: {
  scene: PolarScene | null;
  labels: MapLabelSpec[];
  ready: boolean;
}) {
  const refs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    // Plain object, not a Vector3: projectToScreen only needs x/y/z, so this
    // module stays free of three.js and out of the lazily-loaded 3D chunk.
    const tmp = { x: 0, y: 0, z: 0 };
    const loop = () => {
      const s = scene;
      if (s) {
        for (const l of labels) {
          const el = refs.current.get(l.id);
          if (!el) continue;
          let v: { x: number; y: number; z: number } | null = null;
          if (l.kind === 'vessel') v = s.vesselAnchor();
          else if (l.kind === 'route' && l.routeId) {
            const a = s.routeAnchor(l.routeId);
            if (a) { tmp.x = a.x; tmp.y = a.y + l.liftKm; tmp.z = a.z; v = tmp; }
          } else if (l.lon != null && l.lat != null) {
            v = s.worldAnchor(l.lon, l.lat, l.liftKm);
          }
          const p = v ? s.projectToScreen(v) : null;
          if (!p || p.x < -300 || p.y < -200) {
            el.style.opacity = '0';
            continue;
          }
          el.style.opacity = '1';
          el.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [scene, labels, ready]);

  return (
    <div className="absolute inset-0 pointer-events-none z-[6]" aria-hidden="true">
      {labels.map((l) => (
        <div
          key={l.id}
          ref={(el) => {
            if (el) refs.current.set(l.id, el);
            else refs.current.delete(l.id);
          }}
          className={`nav-label ${l.strong ? 'nav-label-strong' : ''}`}
          style={{ color: l.color, opacity: 0 }}
        >
          <span className="nav-label-text">{l.text}</span>
          {l.sub && <span className="nav-label-sub">{l.sub}</span>}
        </div>
      ))}
    </div>
  );
}
