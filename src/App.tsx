import React, { Suspense, useEffect, useState, type ReactNode } from 'react';

import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import { useLoom } from './state';
import { setSound } from './audio';
import SpaceScene from './scenes/SpaceScene';
import SurfaceScene from './scenes/SurfaceScene';
import ScopeOverlay from './components/ScopeOverlay';
import Hud from './components/Hud';
import OrbitScene from './scenes/OrbitScene';
import OrbitOverlay from './components/OrbitOverlay';
import { startParallax } from './pointer';

/* if WebGL is unavailable, keep the page (text UI) alive instead of crashing the tree */
class CanvasBoundary extends React.Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('3D scene unavailable:', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function Typewriter({ text, speed = 26, className }: { text: string; speed?: number; className?: string }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    setShown('');
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(t);
    }, speed);
    return () => clearInterval(t);
  }, [text, speed]);
  return <span className={className}>{shown}</span>;
}

/* Settings, as symbols kids already know: ☀ light page / ☾ dark page, and A A A for smaller / original / bigger text.
   White by default whatever the computer is set to; choices are remembered on this device. */
const THEME_KEY = 'loom-theme';
const TEXT_KEY = 'loom-text';
const TEXT_SIZES = [
  { id: 'small', scale: 0.85, label: 'Smaller text' },
  { id: 'normal', scale: 1, label: 'Original text size' },
  { id: 'large', scale: 1.25, label: 'Bigger text' },
] as const;
type TextSize = (typeof TEXT_SIZES)[number]['id'];

function readSetting<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try { const v = localStorage.getItem(key) as T | null; return v && allowed.includes(v) ? v : fallback; } catch { return fallback; }
}

function Settings({ phase }: { phase: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => readSetting(THEME_KEY, ['light', 'dark'] as const, 'light'));
  const [text, setText] = useState<TextSize>(() => readSetting(TEXT_KEY, ['small', 'normal', 'large'] as const, 'normal'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  }, [theme]);
  useEffect(() => {
    const scale = TEXT_SIZES.find((t) => t.id === text)!.scale;
    document.documentElement.style.setProperty('--ts', String(scale));
    try { localStorage.setItem(TEXT_KEY, text); } catch { /* private mode */ }
  }, [text]);

  const choice = (on: boolean, label: string, act: () => void, children: ReactNode, cls = '') => (
    <span key={label} role="radio" aria-checked={on} aria-label={label} title={label} tabIndex={0}
          className={`${on ? 'on' : ''} ${cls}`}
          onClick={act}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } }}>
      {children}
    </span>
  );

  return (
    <div className={`settings ${phase}`}>
      {/* one symbol: tap to switch. Sun on a light page, moon on a dark page */}
      <span role="switch" aria-checked={theme === 'dark'} aria-label={theme === 'dark' ? 'Dark page, tap for light' : 'Light page, tap for dark'}
            title={theme === 'dark' ? 'Tap for a light page' : 'Tap for a dark page'} tabIndex={0} className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTheme(theme === 'dark' ? 'light' : 'dark'); } }}>
        {theme === 'dark' ? '☾︎' : '☀︎'}
      </span>
      <div className="set-group" role="radiogroup" aria-label="Text size">
        {TEXT_SIZES.map((t) => choice(text === t.id, t.label, () => setText(t.id), 'A', `a a-${t.id}`))}
      </div>
    </div>
  );
}

export default function App() {
  const phase = useLoom((s) => s.phase);
  const diving = useLoom((s) => s.diving);
  const leaving = useLoom((s) => s.leaving);
  const focus = useLoom((s) => s.focus);
  const sound = useLoom((s) => s.sound);
  const toggleSound = useLoom((s) => s.toggleSound);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setSound(sound);
  }, [sound]);

  // clean address: the app always starts on the landing page
  useEffect(() => {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }, []);

  // depth: the pointer (or a tilted phone) shifts the glass layers a little, each by a different amount
  useEffect(() => startParallax(), []);

  // M toggles sound everywhere; there is no button for it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) toggleSound();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSound]);

  // hold the white fade through each handoff: telescope → flight → surface
  useEffect(() => {
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 140);
    return () => clearTimeout(t);
  }, [phase]);

  const fadeOn = (phase === 'telescope' && diving) || (phase !== 'telescope' && !revealed) || (phase === 'orbit' && leaving);
  // the surface and the flight share the framed glasses window
  const framed = phase === 'surface' || phase === 'orbit';

  return (
    <>
      <CanvasBoundary>
        <div className={`canvas-holder ${phase} ${framed ? 'framed' : ''}`}>
          <Canvas
            shadows
            dpr={[1, 2]}
            camera={{ fov: 42, position: [0, 1.6, 7], near: 0.05, far: 1200 }}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
          >
            <Suspense fallback={null}>
              <color attach="background" args={['#030304']} />
              {phase === 'telescope' ? <SpaceScene /> : phase === 'orbit' ? <OrbitScene world={focus} /> : <SurfaceScene />}
            </Suspense>
            <AdaptiveDpr pixelated={false} />
          </Canvas>
        </div>
      </CanvasBoundary>

      {/* the name always sits at the top of the page, centred, with the kicker beneath */}
      <header className={`page-title ${framed ? 'surface' : phase}`}>
        <h1>VITRUVIUS LOOM</h1>
        <div className="kicker">Abandoned, but not forgotten</div>
      </header>
      {framed && <div className="frame-marks" aria-hidden />}
      <Settings phase={framed ? 'surface' : phase} />

      {phase === 'telescope' ? <ScopeOverlay /> : phase === 'orbit' ? <OrbitOverlay /> : <Hud Typewriter={Typewriter} />}
      <div className={`fade-white ${fadeOn ? 'on' : ''}`} />
    </>
  );
}
