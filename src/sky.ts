/* The real sky: NASA JPL Horizons positions for the Moon, Mars and Sun, and the Yale Bright Star
   Catalogue from NASA HEASARC. Data is produced by scripts/fetch-nasa-data.mjs into public/data/. */
import * as THREE from 'three';

export type BodyName = 'moon' | 'mars' | 'sun';
type Row = [number, number, number, number, number, number]; // unix s, ra°, dec°, illum %, diam ″, distance AU

export interface Ephemeris {
  provenance: Record<string, string>;
  bodies: Record<BodyName, { horizonsId: string; query: string; rows: Row[] }>;
}
export interface StarCatalog {
  provenance: Record<string, string>;
  count: number;
  stars: number[]; // flat: ra°, dec°, vmag, B−V
}
export interface Sky {
  eph: Ephemeris;
  stars: StarCatalog;
}
export interface BodyState {
  ra: number;
  dec: number;
  illum: number;
  diamArcsec: number;
  au: number;
  t: number; // the moment these values describe (unix s)
  clamped: boolean; // true when "now" is outside the downloaded range
}

const D2R = Math.PI / 180;
export const AU_KM = 149_597_870.7;

let skyPromise: Promise<Sky> | null = null;
export function loadSky(): Promise<Sky> {
  skyPromise ??= Promise.all([
    fetch('./data/ephemeris.json').then((r) => r.json()),
    fetch('./data/stars.json').then((r) => r.json()),
  ]).then(([eph, stars]) => ({ eph, stars }));
  return skyPromise;
}

/** linear interpolation between hourly Horizons rows (RA wraps at 360°) */
export function bodyAt(eph: Ephemeris, name: BodyName, tSec: number): BodyState {
  const rows = eph.bodies[name].rows;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const clamped = tSec < first[0] || tSec > last[0];
  const t = Math.min(Math.max(tSec, first[0]), last[0]);
  let i = Math.min(rows.length - 2, Math.max(0, Math.floor((t - first[0]) / (rows[1][0] - first[0]))));
  while (i > 0 && rows[i][0] > t) i--;
  while (i < rows.length - 2 && rows[i + 1][0] < t) i++;
  const a = rows[i];
  const b = rows[i + 1];
  const k = (t - a[0]) / (b[0] - a[0] || 1);
  let dra = b[1] - a[1];
  if (dra > 180) dra -= 360;
  if (dra < -180) dra += 360;
  return {
    ra: (a[1] + dra * k + 360) % 360,
    dec: a[2] + (b[2] - a[2]) * k,
    illum: a[3] + (b[3] - a[3]) * k,
    diamArcsec: a[4] + (b[4] - a[4]) * k,
    au: a[5] + (b[5] - a[5]) * k,
    t,
    clamped,
  };
}

/** aim angles → unit direction. yaw 0 / pitch 0 looks down −Z, +Y is celestial north. */
export function dirFrom(yaw: number, pitch: number, out = new THREE.Vector3()) {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

/** RA increases to the left when you look at the sky with north up, so yaw = −RA. */
export const raToYaw = (raDeg: number) => -raDeg * D2R;
export const yawToRa = (yaw: number) => ((((-yaw / D2R) % 360) + 360) % 360);

export function dirFromRaDec(raDeg: number, decDeg: number, out = new THREE.Vector3()) {
  return dirFrom(raToYaw(raDeg), decDeg * D2R, out);
}

/** B−V colour index → an approximate star colour */
export function bvToRgb(bv: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [-0.4, [0.62, 0.72, 1.0]],
    [0.0, [0.8, 0.86, 1.0]],
    [0.4, [0.98, 0.97, 1.0]],
    [0.8, [1.0, 0.93, 0.82]],
    [1.2, [1.0, 0.82, 0.62]],
    [2.0, [1.0, 0.68, 0.45]],
  ];
  if (bv <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [x0, c0] = stops[i];
    const [x1, c1] = stops[i + 1];
    if (bv <= x1) {
      const k = (bv - x0) / (x1 - x0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

export function formatRa(raDeg: number) {
  const h = raDeg / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh}h ${String(mm).padStart(2, '0')}m`;
}
export function formatDec(decDeg: number) {
  const d = Math.round(decDeg);
  return `${d < 0 ? '−' : '+'}${Math.abs(d)}°`;
}
export function formatSkyTime(tSec: number) {
  const d = new Date(tSec * 1000);
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mon} ${d.getUTCDate()} ${d.getUTCFullYear()} · ${hh}:${mm} UT`;
}
export function formatDistance(au: number) {
  const km = au * AU_KM;
  if (km < 2_000_000) return `${(Math.round(km / 1000) * 1000).toLocaleString('en-US')} KM`;
  return `${Math.round(km / 1_000_000)} MILLION KM`;
}

/* ---------- screen-space markers, written by the telescope rig every frame and read by the overlay ---------- */

export interface Marker {
  inside: boolean; // inside the eyepiece
  x: number; // screen px (when inside)
  y: number;
  discPx: number; // apparent diameter on screen
  edgeX: number; // where to put the edge arrow (when outside)
  edgeY: number;
  angle: number; // radians, screen direction from eyepiece centre toward the world
  label: string;
}
export const markers: Record<'moon' | 'mars', Marker> = {
  moon: { inside: false, x: 0, y: 0, discPx: 0, edgeX: 0, edgeY: 0, angle: 0, label: '' },
  mars: { inside: false, x: 0, y: 0, discPx: 0, edgeX: 0, edgeY: 0, angle: 0, label: '' },
};
