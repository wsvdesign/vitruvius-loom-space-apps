import { create } from 'zustand';
import ginny from './content/ginny.json';

export type Phase = 'telescope' | 'orbit' | 'surface';
export type View = 'wide' | 'lander' | 'seismo' | 'dust' | 'ice' | 'laser';
export type QuestionId = 'gold' | 'temp' | 'dust' | 'water' | 'laser';
export type World = 'moon' | 'mars';

export interface LoomState {
  phase: Phase;
  focus: World;
  diving: boolean;
  leaving: boolean; // the orbit flight is handing over to the surface (white fade on)
  goTo: World | null; // clicked a world in the telescope: aim, zoom and fly there automatically
  view: View;
  beat: number; // Ginny dialogue index; -1 = conversation closed
  question: QuestionId | null;
  sound: boolean;
  creditsOpen: boolean;
  quakeOpen: boolean;
  toast: string | null;

  /* telescope readouts, published by the camera rig (rounded, so they only change when visible) */
  mag: number; // magnification, 1..MAX
  locked: World | null; // a world is under the crosshair and magnified enough to lock on
  near: World | null; // a world is inside the eyepiece
  ra: number; // degrees, where the telescope points
  dec: number;
  skyTime: number | null; // the moment the real sky is shown for (unix s)
  skyClamped: boolean; // "now" was outside the downloaded NASA range, so the nearest date is shown

  setPhase: (p: Phase) => void;
  setFocus: (f: World) => void;
  startDive: () => void;
  setLeaving: (v: boolean) => void;
  setGoTo: (w: World | null) => void;
  setView: (v: View) => void;
  nextBeat: () => void;
  closeDialogue: () => void;
  ask: (q: QuestionId | null) => void;
  toggleSound: () => void;
  openCredits: (open: boolean) => void;
  openQuake: (open: boolean) => void;
  showToast: (msg: string) => void;
  setScope: (s: Partial<Pick<LoomState, 'mag' | 'locked' | 'near' | 'ra' | 'dec' | 'skyTime' | 'skyClamped'>>) => void;
}

/* Ginny's lines live in a content file, not in code (PRD 5d), so they can be reviewed and voiced in one place */
export const GINNY_BEATS: string[] = ginny.beats;

export type Theme = 'light' | 'dark';

/* the app always opens on the landing page (the telescope) */
export const useLoom = create<LoomState>((set) => ({
  phase: 'telescope',
  focus: 'moon',
  diving: false,
  leaving: false,
  goTo: null,
  view: 'wide',
  beat: 0,
  question: null,
  sound: false,
  creditsOpen: false,
  quakeOpen: false,
  toast: null,

  mag: 1,
  locked: null,
  near: null,
  ra: 0,
  dec: 0,
  skyTime: null,
  skyClamped: false,

  setPhase: (phase) => set({ phase, diving: false, leaving: false, goTo: null }),
  setGoTo: (goTo) => set({ goTo }),
  setLeaving: (leaving) => set({ leaving }),
  setFocus: (focus) => set({ focus }),
  // a landing can only start from the telescope, and only once (a pinch that keeps going during the flight must not start another)
  startDive: () => set((s) => (s.phase === 'telescope' && !s.diving ? { diving: true } : {})),
  setView: (view) => set({ view }),
  nextBeat: () =>
    set((s) => ({ beat: s.beat + 1 < GINNY_BEATS.length ? s.beat + 1 : -1 })),
  closeDialogue: () => set({ beat: -1 }),
  ask: (question) => set({ question }),
  toggleSound: () => set((s) => ({ sound: !s.sound })),
  openCredits: (creditsOpen) => set({ creditsOpen }),
  openQuake: (quakeOpen) => set({ quakeOpen }),
  showToast: (msg) => set({ toast: msg }),
  setScope: (s) => set(s),
}));
