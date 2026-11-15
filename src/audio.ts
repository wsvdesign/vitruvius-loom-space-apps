/* Audio: ambient, SFX, Ginny's voice, moonquake — no external files, no keys. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambientNodes: { stop: () => void } | null = null;
let soundOn = false;

export function audioCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function out(): GainNode | null {
  audioCtx();
  return master;
}

/* ---------- ambient: quiet space drone + air shimmer ---------- */

export function startAmbient() {
  if (ambientNodes || !soundOn) return;
  const c = audioCtx();
  if (!c || !master) return;
  const g = c.createGain();
  g.gain.value = 0;
  g.connect(master);
  g.gain.linearRampToValueAtTime(0.05, c.currentTime + 4);

  const o1 = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = 54;
  const o2 = c.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = 54.6;
  const og = c.createGain();
  og.gain.value = 0.5;
  o1.connect(og); o2.connect(og); og.connect(g);

  const lfo = c.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.02;
  lfo.connect(lfoG); lfoG.connect(g.gain);

  o1.start(); o2.start(); lfo.start();
  ambientNodes = {
    stop: () => {
      try {
        g.gain.linearRampToValueAtTime(0, c.currentTime + 1.2);
        setTimeout(() => { o1.stop(); o2.stop(); lfo.stop(); g.disconnect(); }, 1400);
      } catch { /* already stopped */ }
    },
  };
}

export function stopAmbient() {
  ambientNodes?.stop();
  ambientNodes = null;
}

export function setSound(on: boolean) {
  soundOn = on;
  if (on) startAmbient();
  else { stopAmbient(); stopSpeech(); }
}

/* ---------- SFX ---------- */

export function sfxClick() {
  const c = audioCtx();
  if (!c || !master || !soundOn) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.value = 660;
  g.gain.setValueAtTime(0.12, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
  o.connect(g); g.connect(master);
  o.start(); o.stop(c.currentTime + 0.2);
}

export function sfxWhoosh() {
  const c = audioCtx();
  if (!c || !master) return; // play the dive sound even if toggled off? no — respect toggle
  if (!soundOn) return;
  const len = c.sampleRate * 2.2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * t) * 0.5;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(200, c.currentTime);
  f.frequency.exponentialRampToValueAtTime(2400, c.currentTime + 1.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0.001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.35, c.currentTime + 1.2);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 2.2);
  src.connect(f); f.connect(g); g.connect(master);
  src.start();
}

export function sfxChime() {
  const c = audioCtx();
  if (!c || !master || !soundOn) return;
  [523.25, 784.99].forEach((freq, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    const t0 = c.currentTime + i * 0.12;
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.4);
    o.connect(g); g.connect(master!);
    o.start(t0); o.stop(t0 + 1.5);
  });
}

/* ---------- moonquake: procedural, illustrative (Apollo seismic data is the planned next step) ---------- */

let quakeBuf: AudioBuffer | null = null;
let quakeSrc: AudioContext | AudioBufferSourceNode | null = null;

export function makeQuakeBuffer(): AudioBuffer | null {
  const c = audioCtx();
  if (!c) return null;
  if (quakeBuf) return quakeBuf;
  const dur = 10;
  const len = c.sampleRate * dur;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let brown = 0, smooth = 0;
  for (let i = 0; i < len; i++) {
    const t = i / c.sampleRate;
    brown += (Math.random() * 2 - 1 - brown) * 0.012;
    smooth += (brown - smooth) * 0.03;
    const env = t < 1.2 ? Math.pow(t / 1.2, 2) : Math.exp(-(t - 1.2) / 3.2);
    d[i] = smooth * env * 60;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] /= peak * 1.1;
  quakeBuf = buf;
  return buf;
}

export function playQuake(speed = 1): AudioBuffer | null {
  const c = audioCtx();
  const buf = makeQuakeBuffer();
  if (!c || !buf || !soundOn) return buf;
  stopQuake();
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = speed;
  const g = c.createGain();
  g.gain.value = 0.9;
  src.connect(g); g.connect(master!);
  src.onended = () => { quakeSrc = null; };
  quakeSrc = src;
  src.start();
  return buf;
}

let quakeAnalyser: AnalyserNode | null = null;
const quakeTap = new Float32Array(512);
/** 0…1: how hard the recording is shaking right now (RMS of the playing seismic audio), 0 when silent */
export function quakeLevel(): number {
  if (!quakeAnalyser || !quakeSrc) return 0;
  quakeAnalyser.getFloatTimeDomainData(quakeTap);
  let sum = 0;
  for (let i = 0; i < quakeTap.length; i++) sum += quakeTap[i] * quakeTap[i];
  return Math.min(1, Math.sqrt(sum / quakeTap.length) * 3.2);
}

/** Play a prepared buffer (the real Apollo recording) through the master output. Returns false if audio is unavailable. */
export function playSeismic(buf: AudioBuffer): boolean {
  const c = audioCtx();
  if (!c || !master) return false;
  stopQuake();
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = 0.85; // interpolation can overshoot ~1.09 between samples; stay under clipping
  // an analyser taps the signal so the seismometer in the scene can move with the real recording
  quakeAnalyser = c.createAnalyser();
  quakeAnalyser.fftSize = 512;
  src.connect(g); g.connect(quakeAnalyser); quakeAnalyser.connect(master);
  src.onended = () => { if (quakeSrc === src) quakeSrc = null; };
  quakeSrc = src;
  src.start();
  return true;
}

export function stopQuake() {
  try {
    (quakeSrc as AudioBufferSourceNode | null)?.stop();
  } catch { /* already stopped */ }
  quakeSrc = null;
}

/* ---------- spoken lines ----------
   Never the browser's built-in robot voice. Lines play only from recorded audio files in public/voice/,
   listed in public/voice/lines.json as { "<exact line text>": "voice/<file>.mp3" }.
   A line with no recording is shown as text only. */

let voiceLines: Record<string, string> = {};
let current: HTMLAudioElement | null = null;

fetch('./voice/lines.json')
  .then((r) => (r.ok ? r.json() : {}))
  .then((m) => { voiceLines = m || {}; })
  .catch(() => { /* no recordings yet */ });

export function speak(text: string) {
  if (!soundOn) return;
  const src = voiceLines[text];
  if (!src) return;
  stopSpeech();
  try {
    current = new Audio(src);
    void current.play().catch(() => { /* autoplay blocked until the visitor interacts */ });
  } catch { /* audio unavailable */ }
}

/** Ginny speaking a live answer: audio made on our server for that one answer. */
export function speakUrl(url: string) {
  if (!soundOn || !/^\/api\/speech\/[0-9a-f-]{36}$/.test(url)) return;
  stopSpeech();
  try {
    current = new Audio(url);
    void current.play().catch(() => { /* autoplay blocked until the visitor interacts */ });
  } catch { /* audio unavailable */ }
}

export function stopSpeech() {
  try { current?.pause(); } catch { /* ignore */ }
  current = null;
}
