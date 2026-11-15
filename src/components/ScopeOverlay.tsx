import { useEffect, useRef, useState } from 'react';
import { useLoom, type World } from '../state';
import { MAX_MAG, LAND_MAG, apertureRadius, APERTURE_CY } from '../scenes/SpaceScene';
import { markers } from '../sky';
import MannyLanding from './MannyLanding';

const NAMES: Record<World, string> = { moon: 'THE MOON', mars: 'MARS' };

/* No buttons. You aim by dragging or with the arrow keys, zoom by pinching, scrolling or + / −,
   and the landing starts by itself when the Moon fills the eyepiece. */
export default function ScopeOverlay() {
  const mag = useLoom((s) => s.mag);
  const locked = useLoom((s) => s.locked);
  const near = useLoom((s) => s.near);
  const ra = useLoom((s) => s.ra);
  const dec = useLoom((s) => s.dec);
  const diving = useLoom((s) => s.diving);
  const sound = useLoom((s) => s.sound);
  const skyTime = useLoom((s) => s.skyTime);
  const skyClamped = useLoom((s) => s.skyClamped);
  const [moved, setMoved] = useState(false);
  const first = useRef<{ ra: number; dec: number } | null>(null);

  useEffect(() => {
    if (!first.current && skyTime) first.current = { ra, dec };
    else if (first.current && (mag > 1.1 || Math.abs(ra - first.current.ra) > 3 || Math.abs(dec - first.current.dec) > 3)) setMoved(true);
  }, [mag, ra, dec, skyTime]);

  const landAt = locked ? LAND_MAG[locked] : MAX_MAG;
  const focus = useLoom((s) => s.focus);

  const goTo = useLoom((s) => s.goTo);
  const hint = diving
    ? `FLYING TO ${NAMES[focus]}…`
    : goTo
      ? `ZOOMING IN ON ${NAMES[goTo]}…`
    : locked === 'moon'
      ? 'KEEP ZOOMING IN TO FLY DOWN TO THE MOON'
      : locked === 'mars'
        ? mag < 100
          ? 'MARS IS TINY, EVEN IN A TELESCOPE · KEEP ZOOMING IN'
          : 'KEEP ZOOMING IN TO FLY TO MARS'
          : near
            ? `CLICK ${NAMES[near]} TO FLY THERE`
            : moved
              ? 'CLICK AN ARROW AT THE EDGE TO TURN TOWARD THE MOON OR MARS'
              : 'CLICK THE MOON OR MARS TO FLY THERE';

  // progress toward landing: log scale, since every step of zoom multiplies
  const progress = locked ? Math.min(1, Math.log(mag) / Math.log(landAt)) : Math.min(1, Math.log(mag) / Math.log(MAX_MAG));

  return (
    <div className="scope-ui" aria-live="polite">
      <div className={`reticle ${locked ? 'lock' : near ? 'near' : ''}`} aria-hidden>
        <span className="h" /><span className="v" />
        <svg viewBox="0 0 100 100" className="magring">
          <circle cx="50" cy="50" r="47" pathLength={1} style={{ strokeDashoffset: 1 - progress }} />
        </svg>
      </div>

      <WorldMarks />

      <div className="scope-data">
        REAL SKY{skyTime ? ` · ${new Date(skyTime * 1000).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).toUpperCase()}` : ''}{skyClamped ? ' *' : ''} · NASA JPL · NASA HEASARC
      </div>

      <MannyLanding />
      <div className="scope-hint">{hint}</div>
    </div>
  );
}

/* Smart-glasses marks: a box around a world inside the eyepiece, an arrow on the rim pointing to one outside it.
   Positions come from the 3D rig every frame, so this writes styles directly instead of re-rendering. */
function WorldMarks() {
  const box = { moon: useRef<HTMLDivElement>(null), mars: useRef<HTMLDivElement>(null) };
  const label = { moon: useRef<HTMLDivElement>(null), mars: useRef<HTMLDivElement>(null) };
  const edge = { moon: useRef<HTMLDivElement>(null), mars: useRef<HTMLDivElement>(null) };
  const diving = useLoom((s) => s.diving);
  const setGoTo = useLoom((s) => s.setGoTo);
  const go = (k: 'moon' | 'mars') => { if (!diving) setGoTo(k); };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const R = apertureRadius(W, H);
      const cx = W / 2;
      const cy = H * APERTURE_CY;
      for (const k of ['moon', 'mars'] as const) {
        const m = markers[k];
        const b = box[k].current;
        const l = label[k].current;
        const e = edge[k].current;
        const show = m.inside && !diving && !!m.label;
        // the box hugs the world but never grows past the eyepiece
        const sz = Math.min(Math.max(30, m.discPx + 20), R * 1.7);
        if (b) {
          b.style.display = show ? 'block' : 'none';
          b.style.transform = `translate(${m.x - sz / 2}px, ${m.y - sz / 2}px)`;
          b.style.width = b.style.height = `${sz}px`;
        }
        if (l) {
          // label sits under the box, pulled back inside the eyepiece if it would spill onto the rim
          let lx = m.x;
          let ly = m.y + sz / 2 + 18;
          const dx = lx - cx;
          const dy = ly - cy;
          const lim = R - 30;
          const d = Math.hypot(dx, dy);
          if (d > lim) { lx = cx + (dx / d) * lim; ly = cy + (dy / d) * lim; }
          l.style.display = show ? 'block' : 'none';
          l.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -50%)`;
          if (l.textContent !== m.label) l.textContent = m.label;
        }
        if (e) {
          e.style.display = !m.inside && !diving && m.label ? 'flex' : 'none';
          e.style.transform = `translate(${m.edgeX}px, ${m.edgeY}px) translate(-50%, -50%)`;
          const arrow = e.firstElementChild as HTMLElement | null;
          if (arrow) arrow.style.transform = `rotate(${m.angle}rad)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diving]);

  return (
    <>
      {(['moon', 'mars'] as const).map((k) => (
        <div key={k}>
          <div ref={box[k]} className={`mark ${k}`} style={{ display: 'none' }} onClick={() => go(k)} role="link" aria-label={`Fly to ${NAMES[k]}`} />
          <div ref={label[k]} className="mark-label" style={{ display: 'none' }} onClick={() => go(k)} />
          <div ref={edge[k]} className={`edge ${k}`} style={{ display: 'none' }} onClick={() => go(k)} role="link" aria-label={`Turn toward ${NAMES[k]}`}>
            <span className="edge-arrow">→</span>
            <span className="edge-label">{NAMES[k]}</span>
          </div>
        </div>
      ))}
    </>
  );
}
