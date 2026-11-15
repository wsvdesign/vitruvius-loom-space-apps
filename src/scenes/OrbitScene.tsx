import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TilesRenderer, Ellipsoid } from '3d-tiles-renderer';
import { CesiumIonAuthPlugin, GLTFExtensionsPlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { useLoom, type World } from '../state';

/* ------------------------------------------------------------------ */
/*  The "Prezi" flight: the telescope's zoom keeps going, onto real    */
/*  NASA terrain (Cesium Moon / Cesium Mars 3D tiles, NASA and USGS     */
/*  Astrogeology data), down to the actual landing site.                */
/*  The Cesium token stays on our server: the tiles plugin asks         */
/*  /api/tiles/<world> for a short-lived pass.                          */
/* ------------------------------------------------------------------ */

export interface Site {
  name: string;
  sub: string;
  lat: number; // degrees
  lon: number;
  radius: [number, number, number]; // ellipsoid radii in metres
  endAlt: number; // metres above the site where the flight ends
  next: 'surface' | 'hold';
}

/* Apollo 11 lunar module Eagle: 0.67408° N, 23.47297° E (Apollo Lunar Surface Journal).
   Perseverance landing site (Octavia E. Butler Landing), Jezero Crater: 18.4447° N, 77.4508° E (NASA/JPL). */
export const SITES: Record<World, Site> = {
  moon: { name: 'TRANQUILITY BASE', sub: 'APOLLO 11 · 20 JULY 1969', lat: 0.67408, lon: 23.47297, radius: [1737400, 1737400, 1737400], endAlt: 15000, next: 'surface' },
  mars: { name: 'JEZERO CRATER', sub: 'PERSEVERANCE & INGENUITY · 2021', lat: 18.4447, lon: 77.4508, radius: [3396190, 3396190, 3376200], endAlt: 9000, next: 'hold' },
};

const FLIGHT_SECONDS = 11;

/** shared with the DOM overlay, written every frame */
export const orbitView = {
  world: 'moon' as World,
  siteX: 0, // screen px relative to the canvas
  siteY: 0,
  siteVisible: false,
  altitude: 0, // metres above the site
  progress: 0, // 0…1
  done: false,
  attributions: [] as string[],
  status: 'loading' as 'loading' | 'flying' | 'error',
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

export default function OrbitScene({ world }: { world: World }) {
  const { camera, gl, scene, size } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const setPhase = useLoom((s) => s.setPhase);
  const setLeaving = useLoom((s) => s.setLeaving);
  const site = SITES[world];

  // the renderer is created per mount (React dev mounts twice; a disposed renderer must never be reused)
  const tilesRef = useRef<TilesRenderer | null>(null);

  // geometry of the flight, in the tileset's own frame (planet centre at the origin, +Z = north pole)
  const path = useMemo(() => {
    const lat = THREE.MathUtils.degToRad(site.lat);
    const lon = THREE.MathUtils.degToRad(site.lon);
    const P = new THREE.Vector3();
    new Ellipsoid(...site.radius).getCartographicToPosition(lat, lon, 0, P);
    const n = P.clone().normalize();
    const pole = new THREE.Vector3(0, 0, 1);
    const east = new THREE.Vector3().crossVectors(pole, n).normalize();
    const north = new THREE.Vector3().crossVectors(n, east).normalize();
    const R = site.radius[0];
    return { P, n, east, north, R, startAlt: R * 2.1 };
  }, [site]);

  const st = useRef<{ t: number; holdT: number; skipped: boolean; started: boolean; gone: boolean; waited?: number }>({ t: 0, holdT: 0, skipped: false, started: false, gone: false });

  useEffect(() => {
    const t = new TilesRenderer(`${window.location.origin}/api/tiles/${world}`);
    t.registerPlugin(new CesiumIonAuthPlugin({ apiToken: 'server', autoRefreshToken: true }));
    const draco = new DRACOLoader().setDecoderPath('./decoders/draco/');
    const ktx = new KTX2Loader().setTranscoderPath('./decoders/basis/').detectSupport(gl);
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, ktxLoader: ktx, meshoptDecoder: MeshoptDecoder }));
    t.ellipsoid.radius.set(...site.radius);
    t.errorTarget = 8;
    tilesRef.current = t;
    t.setCamera(cam);
    t.setResolutionFromRenderer(cam, gl);
    scene.add(t.group);
    orbitView.world = world;
    orbitView.done = false;
    orbitView.status = 'loading';
    orbitView.attributions = [];
    const onLoad = () => { orbitView.status = 'flying'; };
    const onError = () => { orbitView.status = 'error'; };
    t.addEventListener('load-root-tileset', onLoad);
    t.addEventListener('load-error', onError);

    const key = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); st.current.skipped = true; }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      t.removeEventListener('load-root-tileset', onLoad);
      t.removeEventListener('load-error', onError);
      scene.remove(t.group);
      t.dispose();
      tilesRef.current = null;
      // hand the camera back the way SurfaceScene expects it
      cam.near = 0.05;
      cam.far = 1200;
      cam.fov = 42;
      cam.up.set(0, 1, 0);
      cam.position.set(4.2, 3.4, 11.5);
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
    };
  }, [cam, gl, scene, world, site]);

  const pos = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const s = st.current;
    const { P, n, north, R, startAlt } = path;

    // the flight starts once the root tileset is in, so the planet is there to fly to (or after 6 s regardless)
    s.waited = (s.waited ?? 0) + dt;
    if (orbitView.status !== 'loading' || s.waited > 6) s.started = true;
    if (s.started) s.t = Math.min(FLIGHT_SECONDS, s.t + dt * (s.skipped ? 6 : 1));
    const u = easeInOut(s.t / FLIGHT_SECONDS);

    // altitude falls exponentially: every second covers the same zoom ratio, the Prezi feel
    const alt = Math.exp(THREE.MathUtils.lerp(Math.log(startAlt), Math.log(site.endAlt), u));
    // near the end the camera slides south of the site and tilts toward the horizon
    const slide = smooth(0.55, 1, u) * 1.35;
    pos.copy(n).multiplyScalar(R + alt).addScaledVector(north, -alt * slide);
    look.set(0, 0, 0).lerp(P, smooth(0.0, 0.4, u));
    up.set(0, 0, 1).lerp(n, smooth(0.45, 1, u)).normalize();

    cam.position.copy(pos);
    cam.up.copy(up);
    cam.lookAt(look);
    cam.near = Math.max(1, alt * 0.02);
    cam.far = (R + alt) * 3;
    if (cam.fov !== 42) cam.fov = 42;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    const t = tilesRef.current;
    if (!t) return;
    t.setResolutionFromRenderer(cam, gl);
    t.update();

    // site marker for the overlay
    tmp.copy(P).project(cam);
    const facing = tmp.z < 1 && tmp.z > -1 && pos.clone().sub(P).dot(n) > 0;
    orbitView.siteVisible = facing && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    orbitView.siteX = (tmp.x * 0.5 + 0.5) * size.width;
    orbitView.siteY = (-tmp.y * 0.5 + 0.5) * size.height;
    orbitView.altitude = alt;
    orbitView.progress = s.t / FLIGHT_SECONDS;
    if (orbitView.attributions.length === 0) {
      const a: { type: string; value: string }[] = [];
      t.getAttributions?.(a);
      if (a.length) orbitView.attributions = a.map((x) => String(x.value).replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    }

    // arrived: the Moon hands over to the surface; Mars holds over Jezero (its chapter comes next)
    if (s.t >= FLIGHT_SECONDS) {
      orbitView.done = true;
      s.holdT += dt;
      if (site.next === 'surface' && s.holdT > 1.4 && !s.gone) {
        s.gone = true;
        setLeaving(true);
        setTimeout(() => setPhase('surface'), 1100);
      }
    }
  });

  return (
    <>
      {/* the tiles are lit like daylight; ion terrain is usually unlit, these only help if it isn't */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[1e7, -4e6, 6e6]} intensity={2.2} />
    </>
  );
}
