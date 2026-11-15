import { useEffect, useRef, useState } from 'react';
import { useLoom } from '../state';
import { orbitView, SITES } from '../scenes/OrbitScene';
import { stopSpeech } from '../audio';

/* Glasses overlay for the flight: a pin on the landing site, altitude, and the terrain credit.
   Space skips ahead; T goes back to the telescope. No buttons. */
export default function OrbitOverlay() {
  const focus = useLoom((s) => s.focus);
  const setPhase = useLoom((s) => s.setPhase);
  const site = SITES[focus];
  const pin = useRef<HTMLDivElement>(null);
  const alt = useRef<HTMLElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ done: boolean; status: string; credit: string }>({ done: false, status: 'loading', credit: '' });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const canvas = document.querySelector('.canvas-holder canvas') as HTMLCanvasElement | null;
      const r = canvas?.getBoundingClientRect();
      if (pin.current && r) {
        const on = orbitView.siteVisible && orbitView.status !== 'error';
        pin.current.style.display = on ? 'block' : 'none';
        pin.current.style.transform = `translate(${r.left + orbitView.siteX}px, ${r.top + orbitView.siteY}px)`;
      }
      if (alt.current) alt.current.textContent = formatAltitude(orbitView.altitude);
      if (bar.current) bar.current.style.transform = `scaleX(${orbitView.progress.toFixed(3)})`;
      const credit = orbitView.attributions.join(' · ');
      setState((p) => (p.done !== orbitView.done || p.status !== orbitView.status || p.credit !== credit ? { done: orbitView.done, status: orbitView.status, credit } : p));
      raf = requestAnimationFrame(tick);
    };
    tick();
    const key = (e: KeyboardEvent) => {
      if ((e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey) { stopSpeech(); setPhase('telescope'); }
    };
    window.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); };
  }, [setPhase]);

  const hint =
    state.status === 'error'
      ? focus === 'moon' ? 'THE NASA TERRAIN DIDN’T LOAD · SPACE · GO STRAIGHT TO THE SURFACE' : 'THE NASA TERRAIN DIDN’T LOAD · T · BACK TO THE TELESCOPE'
      : state.status === 'loading'
        ? 'LOADING REAL NASA TERRAIN…'
        : !state.done
          ? `FLYING DOWN TO ${site.name} · SPACE · FASTER`
          : focus === 'moon'
            ? 'LANDING…'
            : 'INGENUITY — THE REAL GINNY — IS STILL DOWN THERE · THE MARS CHAPTER COMES NEXT · T · TELESCOPE';

  return (
    <div className="orbit-ui" aria-live="polite">
      <div ref={pin} className="site-pin" style={{ display: 'none' }}>
        <span className="site-ring" />
        <span className="site-text">
          <b>{site.name}</b>
          <em>{site.sub}</em>
          <em>{Math.abs(site.lat).toFixed(3)}°{site.lat >= 0 ? 'N' : 'S'} · {Math.abs(site.lon).toFixed(3)}°{site.lon >= 0 ? 'E' : 'W'}</em>
        </span>
      </div>

      <div className="orbit-readout">
        <div>ALTITUDE <b ref={alt}>—</b></div>
        <div>WORLD <b>{focus === 'moon' ? 'THE MOON' : 'MARS'}</b></div>
        <div className="orbit-bar"><div ref={bar} /></div>
      </div>

      <div className="orbit-credit">
        REAL TERRAIN <b>{state.credit || (focus === 'moon' ? 'NASA and the USGS Astrogeology Science Center' : 'NASA, ESA, and the USGS Astrogeology Science Center')}</b> · VIA CESIUM ION
      </div>

      <div className="orbit-hint">{hint}</div>
    </div>
  );
}

function formatAltitude(m: number) {
  if (!m) return '—';
  if (m >= 10000) return `${Math.round(m / 1000).toLocaleString('en-US')} KM`;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} KM`;
  return `${Math.round(m)} M`;
}
