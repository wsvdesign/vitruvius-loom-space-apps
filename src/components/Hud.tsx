import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLoom, GINNY_BEATS, type QuestionId } from '../state';
import { sfxClick, sfxChime, speak, stopSpeech, stopQuake, playSeismic, audioCtx } from '../audio';
import { loadSeismic, makeAudioBuffer, audioDuration, originalTimeAt, describeTransform, type SeismicData } from '../seismic';
import ginny from '../content/ginny.json';
import AskBox from './AskBox';
import dust from '../content/dust.json';
import { surfaceView } from '../scenes/SurfaceScene';

/* Compass strip across the top of the glasses: heading slides as the view turns */
const PX_PER_DEG = 4;
const COMPASS_NAMES: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
function Compass() {
  const strip = useRef<HTMLDivElement>(null);
  const deg = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const h = surfaceView.heading;
      if (strip.current) strip.current.style.transform = `translateX(${-h * PX_PER_DEG}px)`;
      if (deg.current) deg.current.textContent = `${String(Math.round(h)).padStart(3, '0')}°`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  const marks: number[] = [];
  for (let d = -360; d <= 720; d += 15) marks.push(d);
  return (
    <div className="compass" aria-hidden>
      <div className="compass-window">
        <div ref={strip} className="compass-strip">
          {marks.map((d) => {
            const n = ((d % 360) + 360) % 360;
            const name = COMPASS_NAMES[n];
            const label = name ?? (n % 30 === 0 ? String(n) : '');
            return (
              <span key={d} className={`tick ${name ? 'cardinal' : label ? 'num' : 'minor'}`} style={{ left: d * PX_PER_DEG }}>
                <i />{label && <em>{label}</em>}
              </span>
            );
          })}
        </div>
      </div>
      <span className="compass-needle" />
      <span ref={deg} className="compass-deg" />
    </div>
  );
}

const QUESTIONS: { id: QuestionId; label: string }[] = [
  { id: 'laser', label: 'Is anything here still working?' },
  { id: 'gold', label: 'Why is the descent stage wrapped in gold?' },
  { id: 'temp', label: 'How hot and cold does it get?' },
  { id: 'dust', label: 'What is lunar dust like?' },
  { id: 'water', label: 'Is there water on the Moon?' },
];

const ANSWERS = ginny.answers as Record<QuestionId, { title: string; body: string; src: string; url?: string }>;

/* Surface HUD. No chrome buttons: dialogue advances on click or Space, panels close on Esc or by clicking the scene,
   C opens credits, T returns to the telescope, M toggles sound (handled in App). */
export default function Hud({ Typewriter }: { Typewriter: (p: { text: string; speed?: number; className?: string }) => ReactNode }) {
  const beat = useLoom((s) => s.beat);
  const nextBeat = useLoom((s) => s.nextBeat);
  const question = useLoom((s) => s.question);
  const ask = useLoom((s) => s.ask);
  const setView = useLoom((s) => s.setView);
  const sound = useLoom((s) => s.sound);
  const openCredits = useLoom((s) => s.openCredits);
  const creditsOpen = useLoom((s) => s.creditsOpen);
  const setPhase = useLoom((s) => s.setPhase);
  const quakeOpen = useLoom((s) => s.quakeOpen);
  const openQuake = useLoom((s) => s.openQuake);

  const dialogueText = beat >= 0 && beat < GINNY_BEATS.length ? GINNY_BEATS[beat] : '';

  useEffect(() => {
    if (beat >= 0 && beat < GINNY_BEATS.length) speak(GINNY_BEATS[beat]);
    return () => stopSpeech();
  }, [beat]);

  function closeAny(): boolean {
    if (quakeOpen) { stopQuake(); openQuake(false); setView('wide'); return true; }
    if (question !== null) { ask(null); setView('wide'); return true; }
    if (creditsOpen) { openCredits(false); return true; }
    return false;
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      if ((e.key === ' ' || e.key === 'Enter') && beat >= 0) { e.preventDefault(); nextBeat(); sfxClick(); }
      else if (e.key === 'Escape') { if (closeAny()) sfxClick(); }
      else if (e.key === 'c' || e.key === 'C') { openCredits(!creditsOpen); sfxClick(); }
      else if (e.key === 't' || e.key === 'T') { stopSpeech(); stopQuake(); setPhase('telescope'); sfxClick(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, question, quakeOpen, creditsOpen]);

  function handleAsk(q: QuestionId) {
    sfxChime();
    ask(q);
    speak(ANSWERS[q].body);
    if (q === 'temp' || q === 'water') setView(q === 'temp' ? 'wide' : 'ice');
    if (q === 'gold') setView('lander');
    if (q === 'dust') setView('dust');
    if (q === 'laser') setView('laser');
  }

  const somethingOpen = question !== null || quakeOpen || creditsOpen;

  return (
    <>
      {/* while Ginny talks, a tap anywhere continues; while a panel is open, a tap on the scene closes it */}
      {beat >= 0 && <div className="advance" onPointerDown={() => { nextBeat(); sfxClick(); }} aria-hidden />}
      {beat < 0 && somethingOpen && <div className="advance" onPointerDown={() => { if (closeAny()) sfxClick(); }} aria-hidden />}

      <div className="hud">
        <Compass />
        <div className="hud-keys">
          {beat >= 0 ? <><b>SPACE</b> CONTINUE</> : somethingOpen ? <><b>ESC</b> CLOSE</> : <><b>T</b> TELESCOPE</>}
          {' · '}<b>C</b> CREDITS{' · '}<b>M</b> SOUND {sound ? 'ON' : 'OFF'}
        </div>

        {beat >= 0 && (
          <div className="dialogue card">
            <div className="who">
              <span className="dot" />
              <b>Ginny</b>
            </div>
            <p>
              <Typewriter text={dialogueText} speed={22} />
            </p>
            <div className="next">{beat < GINNY_BEATS.length - 1 ? 'tap or press space to continue' : 'tap or press space to start exploring'}</div>
          </div>
        )}

        {question === null && beat < 0 && !quakeOpen && (
          <div className="ask card">
            <h3>Ask Ginny</h3>
            <ul className="qlist">
              {QUESTIONS.map((q) => (
                <li key={q.id} className="q" tabIndex={0} role="link"
                    onClick={() => handleAsk(q.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAsk(q.id); }}>
                  {q.label}
                </li>
              ))}
              <li className="q" tabIndex={0} role="link"
                  onClick={() => { openQuake(true); sfxChime(); setView('seismo'); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { openQuake(true); setView('seismo'); } }}>
                What did the seismometers record?
              </li>
            </ul>
            {/* or ask your own: Gemini answers only from checked NASA facts (backend) */}
            <AskBox world="moon" />
          </div>
        )}
      </div>

      {question !== null && <AnswerPanel id={question} />}
      {quakeOpen && <QuakePanel />}
      {creditsOpen && <CreditsDrawer />}
    </>
  );
}

/* ---------- answer panels with visible events ---------- */

function AnswerPanel({ id }: { id: QuestionId }) {
  const a = ANSWERS[id];
  return (
    <div className="answer card">
      <h3>{a.title}</h3>
      <p>{a.body}</p>
      {id === 'temp' && <Thermometer />}
      {id === 'dust' && (
        <>
          <p className="src">{dust.caption}</p>
          <p className="src">{dust.label} · {dust.facts[0]?.source_title}</p>
          <GrainsSvg />
        </>
      )}
      <div className="close-row">
        <span className="src">{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="src-link">{a.src}</a> : a.src}</span>
        <span className="src">esc · close</span>
      </div>
    </div>
  );
}

function Thermometer() {
  const [shadow, setShadow] = useState(false);
  return (
    <div>
      <div className="thermo-row">
        <span className={`pick ${shadow ? 'dim' : 'on'}`} onClick={() => setShadow(false)} role="radio" aria-checked={!shadow} tabIndex={0}>Daytime</span>
        <b>{shadow ? '−208°F' : '+250°F'}</b>
        <span className={`pick ${shadow ? 'on' : 'dim'}`} onClick={() => setShadow(true)} role="radio" aria-checked={shadow} tabIndex={0}>After nightfall</span>
      </div>
      <div className="tbar" onClick={() => setShadow((v) => !v)}>
        <div className="now" style={{ left: shadow ? '2%' : '98%' }} />
      </div>
      <p className="src" style={{ textAlign: 'center' }}>near the equator · tap daytime or after nightfall</p>
    </div>
  );
}

/** magnified grains — jagged, glassy shards drifting (illustrative) */
function GrainsSvg() {
  const shards = Array.from({ length: 14 }, (_, i) => {
    const x = 20 + ((i * 53) % 340);
    const y = 18 + ((i * 37) % 104);
    const r = i * 24;
    const s = 6 + ((i * 7) % 9);
    const pts = [
      `${x},${y - s}`, `${x + s * 0.9},${y + s * 0.5}`, `${x - s * 0.4},${y + s * 0.9}`,
    ].join(' ');
    return { x, y, r, s, pts, delay: (i % 5) * 0.6 };
  });
  return (
    <div>
      <svg className="grains" viewBox="0 0 380 140" role="img" aria-label="Magnified lunar dust grains — jagged shards">
        <rect width="380" height="140" fill="#0d0d0f" rx="8" />
        {shards.map((s, i) => (
          <g key={i} style={{ transformOrigin: `${s.x}px ${s.y}px`, animation: `gdrift 4s ease-in-out ${s.delay}s infinite alternate` }}>
            <polygon points={s.pts} fill="none" stroke="#22d3ee" strokeWidth="1" opacity="0.85" />
            <polygon points={s.pts} fill="rgba(34,211,238,0.12)" />
          </g>
        ))}
        <text x="12" y="130" fill="#6b7280" fontFamily="IBM Plex Mono, monospace" fontSize="9" letterSpacing="2">
          MAGNIFIED VIEW · ILLUSTRATIVE — GRAINS ARE JAGGED BECAUSE NO WIND EVER WORE THEM SMOOTH
        </text>
      </svg>
      <style>{`
        @keyframes gdrift { from { transform: translate(0,0) rotate(0deg); } to { transform: translate(6px,-4px) rotate(24deg); } }
      `}</style>
    </div>
  );
}

/* ---------- moonquake panel: the REAL Apollo 12 seismometer recording (audified). Tap the wave to play. ---------- */

function QuakePanel() {
  const [data, setData] = useState<SeismicData | null>(null);
  const [failed, setFailed] = useState(false);
  const [speed, setSpeed] = useState(200);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    loadSeismic().then(setData).catch(() => setFailed(true));
    speak(ginny.quake);
    return () => { cancelAnimationFrame(rafRef.current); stopQuake(); stopSpeech(); };
  }, []);

  useEffect(() => {
    draw();
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, speed, playing]);

  function toggle() {
    if (!data) return;
    if (playing) { stopQuake(); setPlaying(false); return; }
    const c = audioCtx();
    if (!c) return;
    // tapping play is a clear wish to hear it, so sound comes on
    if (!useLoom.getState().sound) useLoom.getState().toggleSound();
    if (playSeismic(makeAudioBuffer(c, data.samples, speed))) {
      startedAt.current = performance.now();
      setPlaying(true);
    }
  }

  function draw() {
    cancelAnimationFrame(rafRef.current);
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = data.samples;
    const meta = data.meta;
    const dur = audioDuration(meta, speed);
    const impactAt = (meta.provenance as unknown as { impact?: { sampleIndex?: number } }).impact?.sampleIndex;
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#0a0a0a';

    // min/max envelope per pixel column, computed once per draw
    const lo = new Float32Array(w);
    const hi = new Float32Array(w);
    const per = s.length / w;
    for (let x = 0; x < w; x++) {
      let a = 1, b = -1;
      const i0 = Math.floor(x * per), i1 = Math.min(s.length, Math.floor((x + 1) * per) + 1);
      for (let i = i0; i < i1; i++) { const v = s[i]; if (v < a) a = v; if (v > b) b = v; }
      lo[x] = a; hi[x] = b;
    }

    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        ctx.moveTo(x + 0.5, h / 2 + lo[x] * h * 0.46);
        ctx.lineTo(x + 0.5, h / 2 + hi[x] * h * 0.46);
      }
      ctx.stroke();
      if (impactAt != null) {
        const ix = (impactAt / s.length) * w;
        ctx.fillStyle = '#e0603a';
        ctx.fillRect(ix - dpr / 2, 0, dpr, h);
        ctx.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
        ctx.fillText('IMPACT', ix + 4 * dpr, 12 * dpr);
      }
      if (playing) {
        const t = (performance.now() - startedAt.current) / 1000;
        const p = Math.min(1, t / dur);
        ctx.fillStyle = ink;
        ctx.fillRect(p * w - dpr, 0, 2 * dpr, h);
        if (clockRef.current) clockRef.current.textContent = `${originalTimeAt(meta, t, speed).toISOString().slice(11, 19)} UTC · 20 NOV 1969`;
        if (p >= 1) setPlaying(false);
      } else {
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(w / 2 - 8 * dpr, h / 2 - 10 * dpr);
        ctx.lineTo(w / 2 + 10 * dpr, h / 2);
        ctx.lineTo(w / 2 - 8 * dpr, h / 2 + 10 * dpr);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    frame();
  }

  const speeds = (data?.meta.transform as unknown as { speedupOptions?: number[] })?.speedupOptions ?? [100, 200, 400];

  return (
    <div className="answer card">
      <h3>Moonquake · a real recording from 1969</h3>
      <p>{ginny.quake}</p>
      {failed ? (
        <p className="src">The recording didn’t load. Check the connection and open this again.</p>
      ) : (
        <canvas ref={canvasRef} className="quake-wave" onClick={toggle} role="switch" aria-checked={playing} aria-label="Play or stop the real Apollo 12 moonquake recording" />
      )}
      <div className="quake-controls" role="radiogroup" aria-label="How much faster to play it">
        <span className="src">SPEED</span>
        {speeds.map((x) => (
          <span key={x} role="radio" aria-checked={speed === x} tabIndex={0}
                className={`speed ${speed === x ? 'on' : ''}`}
                onClick={() => { if (!playing) setSpeed(x); }}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !playing) { e.preventDefault(); setSpeed(x); } }}>
            {x}×
          </span>
        ))}
        <span className="src" ref={clockRef} style={{ marginLeft: 'auto' }}>{playing ? '' : data ? 'tap the wave · play' : 'loading…'}</span>
      </div>
      <p className="src" style={{ marginTop: 10 }}>
        {data ? describeTransform(data.meta, speed) : 'Real recording · Apollo 12 seismometer'} · the shaking is too slow to hear, so it is sped up · gaps play as silence
      </p>
      <div className="close-row">
        <span className="src">NASA NSSDCA · Apollo Passive Seismic Experiment (XA.S12, via EarthScope)</span>
        <span className="src">esc · close</span>
      </div>
    </div>
  );
}

/* ---------- credits drawer: C or Esc closes, so does a tap outside ---------- */

function CreditsDrawer() {
  return (
    <aside className="drawer open">
      <div className="fine" style={{ textAlign: 'right' }}>esc · close</div>
      <h2>Data & Credits</h2>
      <p className="fine">NASA Space Apps Challenge 2026 · Abandoned but not Forgotten<br />Written and designed by Natalie Walker<br />Independent student project; not made, reviewed or endorsed by NASA.</p>

      <h3>Real data</h3>
      <ul>
        <li>Tonight's sky: Moon, Mars and Sun positions, sizes and phase from NASA JPL Horizons</li>
        <li>Stars: Yale Bright Star Catalogue, 5th revised edition, via NASA HEASARC</li>
        <li>Moon and Mars terrain: Cesium Moon (NASA and the USGS Astrogeology Science Center) and Cesium Mars (NASA, ESA and the USGS Astrogeology Science Center), via Cesium ion</li>
        <li>Moonquake: Apollo 12 Passive Seismic Experiment, station S12, 20 November 1969 (network XA, via EarthScope), audified</li>
        <li>Ginny's answers: 73 facts checked against NASA and Smithsonian pages, each with its source</li>
        <li>Spacecraft models: Apollo Lunar Module (NASA/Michael D. Carbajal) and Ingenuity Mars Helicopter (NASA/Brian E. Kumanchik), NASA 3D Resources</li>
      </ul>

      <h3>What is shown, honestly</h3>
      <ul>
        <li>Close-up ground at Tranquility Base: an illustration; the terrain seen from orbit is real</li>
        <li>Only Eagle's descent stage is shown, because the ascent stage lifted off on 21 July 1969</li>
        <li>Dust: a simulation of a landing blast using physics from NASA studies; the Moon has no wind</li>
        <li>Laser pulses: shown slowed down; the real round trip takes about 2.5 seconds</li>
        <li>Ginny: a fictional guide shown with NASA's Ingenuity model; Ingenuity itself flew on Mars</li>
        <li>Typed questions: answered by Google Gemini on Vertex AI, only from the checked facts</li>
      </ul>

      <h3>Manny</h3>
      <p>Manny (Emanuel) is drawn by Natalie Walker. His 3D figure was built with Meshy from her drawings. His Lakota lines are drafts in review with a Lakota reader.</p>

      <h3>Voices and tools</h3>
      <p className="fine">Ginny's voice: Kokoro "Heart" (open source, Apache-2.0). Built with React, Vite, React Three Fiber, three.js and 3D Tiles Renderer (NASA-AMMOS). No NASA logos are used.</p>
    </aside>
  );
}
