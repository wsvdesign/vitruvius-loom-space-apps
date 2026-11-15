import { use, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture, Hud, OrthographicCamera, Environment, Lightformer, useGLTF } from '@react-three/drei';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mannyTalk } from '../components/MannyLanding';
import { illustrate } from './illustrate';
import * as THREE from 'three';
import { useLoom, type World } from '../state';
import { sfxWhoosh } from '../audio';
import {
  loadSky, bodyAt, dirFrom, dirFromRaDec, raToYaw, yawToRa, bvToRgb, markers, formatDistance,
  type Sky, type BodyState,
} from '../sky';

/* ------------------------------------------------------------------ */
/*  A telescope on Earth, pointed at tonight's real sky.               */
/*  The camera never moves; it turns (aim) and narrows its field of    */
/*  view (zoom) the way a real eyepiece does. Star positions, Moon and */
/*  Mars positions, sizes and phases all come from NASA data.          */
/* ------------------------------------------------------------------ */

export const BASE_FOV = 70; // degrees, vertical, at 1×
export const MAX_MAG = 600; // a large telescope on a steady night
export const LAND_MAG: Record<World, number> = { moon: 80, mars: MAX_MAG }; // the Moon fills the eyepiece at ~80×
const LOCK_MAG = 3;
const SURFACE_FOV = 42; // what SurfaceScene expects
const SKY_R = 900; // star sphere
const WORLD_D = 100; // Moon and Mars sit on this sphere at their real angular sizes

/** eyepiece size: fits between the title above and the hint below */
export function apertureRadius(w: number, h: number) {
  return Math.min(w * 0.36, h * 0.265);
}
export const APERTURE_CY = 0.525; // fraction of viewport height from the top (matches .reticle in styles.css)
export const reticleRadius = (w: number, h: number) => Math.min(Math.min(w, h) * 0.07, 60);

const skyPromise = loadSky();

/* ---------- shared point shader: round soft stars, pixel-sized regardless of zoom ---------- */

const pointVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vC;
  varying float vA;
  void main() {
    vC = aColor;
    vA = aAlpha;
    gl_PointSize = aSize * uScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const pointFrag = /* glsl */ `
  varying vec3 vC;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    float a = core * core * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vC, a);
  }
`;

/* ---------- 9,096 real stars ---------- */

function Stars({ sky }: { sky: Sky }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const geo = useMemo(() => {
    const src = sky.stars.stars;
    const n = src.length / 4;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const [ra, dec, vmag, bv] = [src[i * 4], src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3]];
      dirFromRaDec(ra, dec, v).multiplyScalar(SKY_R);
      pos.set([v.x, v.y, v.z], i * 3);
      col.set(bvToRgb(bv), i * 3);
      // brighter stars draw larger and more opaque; magnitude is logarithmic
      size[i] = THREE.MathUtils.clamp(5.2 - 0.72 * vmag, 1.3, 7.5);
      alpha[i] = THREE.MathUtils.clamp(1.15 - 0.13 * vmag, 0.22, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    return g;
  }, [sky]);
  const uniforms = useMemo(() => ({ uScale: { value: dpr } }), [dpr]);
  useFrame(() => {
    // a telescope gathers more light than an eye, so stars brighten a little as you zoom
    const gain = 1 + Math.min(0.6, Math.log10(useLoom.getState().mag) * 0.25);
    if (mat.current) mat.current.uniforms.uScale.value = dpr * gain;
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial ref={mat} vertexShader={pointVert} fragmentShader={pointFrag} uniforms={uniforms} transparent depthWrite={false} />
    </points>
  );
}

/* ---------- Moon and Mars at their real size, place and phase ---------- */

interface WorldNow {
  key: World;
  state: BodyState;
  pos: THREE.Vector3;
  radius: number;
}

function Planet({ w, texture, glowColor, glowSize }: { w: WorldNow; texture: string; glowColor: [number, number, number]; glowSize: number }) {
  const map = useTexture(texture);
  const dpr = useThree((s) => s.viewport.dpr);
  const mesh = useRef<THREE.Mesh>(null);
  const glowMat = useRef<THREE.ShaderMaterial>(null);
  const geom = useMemo(() => {
    const g = new THREE.SphereGeometry(w.radius, 128, 96);
    g.rotateY(-Math.PI / 2); // texture longitude 0 → +Z, so lookAt(Earth) shows the near side
    return g;
  }, [w.radius]);
  const glow = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([w.pos.x, w.pos.y, w.pos.z]), 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(glowColor), 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([glowSize]), 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array([1]), 1));
    return g;
  }, [w.pos, glowColor, glowSize]);
  const uniforms = useMemo(() => ({ uScale: { value: dpr } }), [dpr]);

  useEffect(() => {
    if (!mesh.current) return;
    mesh.current.position.copy(w.pos);
    mesh.current.lookAt(0, 0, 0); // the Moon keeps one face toward Earth; Mars is close enough for a demo
  }, [w.pos]);

  // the point of light fades out once the real disc is big enough to see
  useFrame(({ camera, size }) => {
    const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov);
    const discPx = (2 * Math.atan(w.radius / WORLD_D) / fov) * size.height;
    if (glowMat.current) glowMat.current.uniforms.uScale.value = dpr * THREE.MathUtils.clamp(1 - (discPx - glowSize * 0.6) / (glowSize * 1.2), 0, 1);
  });

  return (
    <>
      <mesh ref={mesh} geometry={geom}>
        <meshStandardMaterial map={map} roughness={1} metalness={0} />
      </mesh>
      <points geometry={glow} frustumCulled={false}>
        <shaderMaterial ref={glowMat} vertexShader={pointVert} fragmentShader={pointFrag} uniforms={uniforms} transparent depthWrite={false} />
      </points>
    </>
  );
}

/* ---------- the rig: aim, zoom, lock, land ---------- */

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function Rig({ worlds }: { worlds: WorldNow[] }) {
  const { camera, gl } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const diving = useLoom((s) => s.diving);
  const startDive = useLoom((s) => s.startDive);
  const setPhase = useLoom((s) => s.setPhase);
  const setFocus = useLoom((s) => s.setFocus);
  const setScope = useLoom((s) => s.setScope);

  // start a little to one side of the Moon: it's in view, small, off-centre; Mars is somewhere else entirely
  const moon = worlds.find((w) => w.key === 'moon')!;
  const st = useRef({
    yaw: raToYaw(moon.state.ra) + THREE.MathUtils.degToRad(13),
    pitch: THREE.MathUtils.degToRad(moon.state.dec + 6),
    vyaw: 0,
    vpitch: 0,
    fov: BASE_FOV,
    dragging: false,
    lastX: 0,
    lastY: 0,
    pointers: new Map<number, { x: number; y: number }>(),
    pinch: 0,
    keys: new Set<string>(),
    locked: null as World | null,
    diveT: 0,
    diveFov: BASE_FOV,
  });

  // the eyepiece sits below screen centre, so shift the lens's optical centre down to match it
  useEffect(() => {
    cam.setViewOffset(size.width, size.height, 0, -(APERTURE_CY - 0.5) * size.height, size.width, size.height);
    cam.updateProjectionMatrix();
    return () => { cam.clearViewOffset(); cam.updateProjectionMatrix(); };
  }, [cam, size.width, size.height]);

  useEffect(() => {
    const s = st.current;
    const el = gl.domElement;
    const minFov = () => BASE_FOV / (s.locked ? LAND_MAG[s.locked] : MAX_MAG);
    const zoomBy = (factor: number) => { s.fov = THREE.MathUtils.clamp(s.fov * factor, minFov(), BASE_FOV); };
    const tryLand = () => {
      if (s.locked && !useLoom.getState().diving) { sfxWhoosh(); startDive(); }
    };

    const down = (e: PointerEvent) => {
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (s.pointers.size === 1) { s.dragging = true; s.lastX = e.clientX; s.lastY = e.clientY; s.vyaw = 0; s.vpitch = 0; }
      if (s.pointers.size === 2) { const [a, b] = [...s.pointers.values()]; s.pinch = Math.hypot(a.x - b.x, a.y - b.y); s.dragging = false; }
    };
    const up = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId);
      if (s.pointers.size < 2) s.pinch = 0;
      if (s.pointers.size === 0) s.dragging = false;
    };
    const move = (e: PointerEvent) => {
      if (!s.pointers.has(e.pointerId)) return;
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (s.pinch > 0 && d > 0) zoomBy(s.pinch / d);
        s.pinch = d;
        return;
      }
      if (!s.dragging) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      s.lastX = e.clientX; s.lastY = e.clientY;
      // grab-the-sky: the sky follows your finger; finer the more you zoom
      const k = THREE.MathUtils.degToRad(s.fov) / el.clientHeight;
      s.vyaw = -dx * k; s.vpitch = dy * k;
      s.yaw += s.vyaw; s.pitch = THREE.MathUtils.clamp(s.pitch + s.vpitch, -1.5, 1.5);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); // a trackpad pinch arrives as ctrl+wheel; stop the browser zooming the page instead
      const lines = e.deltaMode === 1 ? 33 : 1;
      const k = e.ctrlKey ? 0.02 : 0.004;
      zoomBy(Math.exp(e.deltaY * lines * k));
      if (e.deltaY < 0 && s.locked && s.fov <= minFov() * 1.001) tryLand();
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(e.key)) {
        s.keys.add(e.key);
        e.preventDefault();
      } else if (e.key === 'Enter') {
        tryLand();
      }
    };
    const keyup = (e: KeyboardEvent) => s.keys.delete(e.key);
    const blur = () => s.keys.clear();
    // Safari sends a trackpad pinch as gesture events with a running scale (Chrome sends ctrl+wheel instead)
    let gestureFov = 0;
    const gestureStart = (e: Event) => { e.preventDefault(); gestureFov = s.fov; };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as unknown as { scale?: number }).scale ?? 1;
      if (!gestureFov) gestureFov = s.fov;
      s.fov = THREE.MathUtils.clamp(gestureFov / Math.max(scale, 0.01), minFov(), BASE_FOV);
      if (scale > 1 && s.locked && s.fov <= minFov() * 1.001) tryLand();
    };
    const gestureEnd = (e: Event) => { e.preventDefault(); gestureFov = 0; };

    el.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('pointermove', move);
    window.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    window.addEventListener('gesturestart', gestureStart);
    window.addEventListener('gesturechange', gestureChange);
    window.addEventListener('gestureend', gestureEnd);
    el.style.touchAction = 'none';
    (s as unknown as { zoomBy: typeof zoomBy }).zoomBy = zoomBy;
    (s as unknown as { tryLand: typeof tryLand }).tryLand = tryLand;
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('gesturestart', gestureStart);
      window.removeEventListener('gesturechange', gestureChange);
      window.removeEventListener('gestureend', gestureEnd);
      el.style.touchAction = '';
      // hand the camera back the way SurfaceScene expects it
      cam.fov = SURFACE_FOV;
      cam.position.set(4.2, 3.4, 11.5);
      cam.updateProjectionMatrix();
    };
  }, [gl, cam, startDive]);

  const fwd = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const camSpace = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const s = st.current;
    const ext = s as unknown as { zoomBy: (f: number) => void; tryLand: () => void };

    if (diving && s.locked) {
      // fly down the line of sight; the white fade (App) covers the handoff
      const w = worlds.find((x) => x.key === s.locked)!;
      if (s.diveT === 0) s.diveFov = s.fov;
      s.diveT += dt;
      const t = Math.min(1, s.diveT / 2.0);
      const e = t * t * (3 - 2 * t);
      tmp.copy(w.pos).normalize();
      cam.position.copy(tmp).multiplyScalar((WORLD_D - w.radius * 1.4) * e);
      cam.fov = THREE.MathUtils.lerp(s.diveFov, SURFACE_FOV, e);
      cam.updateProjectionMatrix();
      cam.lookAt(w.pos);
      if (s.diveT > 2.1) setPhase('orbit'); // the zoom keeps going, onto the real terrain
      return;
    }

    // clicked a world: swing to it, then zoom in all the way and fly down (dragging or keys cancel)
    const goTo = useLoom.getState().goTo;
    if (goTo && (s.dragging || s.keys.size > 0)) useLoom.getState().setGoTo(null);
    else if (goTo) {
      const w = worlds.find((x) => x.key === goTo)!;
      const dyaw = wrap(raToYaw(w.state.ra) - s.yaw);
      const dp = THREE.MathUtils.degToRad(w.state.dec) - s.pitch;
      const k = 1 - Math.pow(0.03, dt);
      s.yaw += dyaw * k;
      s.pitch += dp * k;
      s.vyaw = 0; s.vpitch = 0;
      const centred = Math.hypot(dyaw, dp) < THREE.MathUtils.degToRad(s.fov) * 0.02;
      if (centred) {
        const landFov = BASE_FOV / LAND_MAG[goTo];
        s.fov = Math.max(landFov, s.fov * Math.exp(-1.25 * dt));
        if (s.fov <= landFov * 1.01 && !useLoom.getState().diving) {
          s.locked = goTo;
          useLoom.getState().setGoTo(null);
          sfxWhoosh();
          startDive();
        }
      }
    }

    // held keys: smooth aim and zoom
    const aimRate = THREE.MathUtils.degToRad(s.fov) * 0.55; // half a field per second
    if (s.keys.has('ArrowLeft')) s.yaw -= aimRate * dt;
    if (s.keys.has('ArrowRight')) s.yaw += aimRate * dt;
    if (s.keys.has('ArrowUp')) s.pitch = Math.min(1.5, s.pitch + aimRate * dt);
    if (s.keys.has('ArrowDown')) s.pitch = Math.max(-1.5, s.pitch - aimRate * dt);
    if (s.keys.has('+') || s.keys.has('=')) { ext.zoomBy(Math.exp(-1.5 * dt)); if (s.locked && s.fov <= BASE_FOV / LAND_MAG[s.locked] * 1.001) ext.tryLand(); }
    if (s.keys.has('-') || s.keys.has('_')) ext.zoomBy(Math.exp(1.5 * dt));

    // inertia after a flick
    if (!s.dragging) {
      s.yaw += s.vyaw; s.pitch = THREE.MathUtils.clamp(s.pitch + s.vpitch, -1.5, 1.5);
      const damp = Math.pow(0.004, dt);
      s.vyaw *= damp; s.vpitch *= damp;
    }

    const fovRad = THREE.MathUtils.degToRad(s.fov);
    const mag = BASE_FOV / s.fov;
    const R = apertureRadius(size.width, size.height);
    const cx = size.width / 2;
    const cy = size.height * APERTURE_CY;
    const halfTan = Math.tan(fovRad / 2);
    const pxPerTan = (size.height / 2) / halfTan;
    const apertureAng = Math.atan(R / pxPerTan);
    const reticleAng = Math.atan(reticleRadius(size.width, size.height) / pxPerTan);
    dirFrom(s.yaw, s.pitch, fwd);

    // which world is inside the eyepiece / under the crosshair
    let near: World | null = null;
    let nearAng = Infinity;
    let locked: World | null = null;
    for (const w of worlds) {
      tmp.copy(w.pos).normalize();
      const ang = fwd.angleTo(tmp);
      const angR = Math.atan(w.radius / WORLD_D);
      if (ang < apertureAng + angR && ang < nearAng) { near = w.key; nearAng = ang; }
      if (ang < reticleAng + angR && mag >= LOCK_MAG) locked = w.key;
    }
    if (locked && locked !== s.locked) setFocus(locked);
    s.locked = locked;

    // once locked, the mount follows the world gently so it stays centred while you zoom; dragging always wins
    if (locked && !s.dragging && s.keys.size === 0) {
      const w = worlds.find((x) => x.key === locked)!;
      const k = 1 - Math.pow(0.3, dt);
      s.yaw += wrap(raToYaw(w.state.ra) - s.yaw) * k;
      s.pitch += (THREE.MathUtils.degToRad(w.state.dec) - s.pitch) * k;
      dirFrom(s.yaw, s.pitch, fwd);
    }

    cam.position.set(0, 0, 0);
    cam.up.set(0, 1, 0);
    cam.lookAt(fwd);
    if (Math.abs(cam.fov - s.fov) > 1e-6) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();

    // screen markers for the overlay: a box when a world is in the eyepiece, an arrow at the rim when it isn't
    for (const w of worlds) {
      const m = markers[w.key];
      camSpace.copy(w.pos).applyMatrix4(cam.matrixWorldInverse);
      const inFront = camSpace.z < 0;
      const sx = cx + (camSpace.x / -camSpace.z) * pxPerTan;
      const sy = cy - (camSpace.y / -camSpace.z) * pxPerTan;
      m.discPx = (2 * Math.atan(w.radius / WORLD_D) / fovRad) * size.height;
      m.inside = inFront && Math.hypot(sx - cx, sy - cy) < R - 8;
      m.x = sx;
      m.y = sy;
      m.angle = Math.atan2(-camSpace.y, camSpace.x);
      const rr = R * 1.1615 + 64; // just outside the flange, on the telescope body
      m.edgeX = cx + Math.cos(m.angle) * rr;
      m.edgeY = cy + Math.sin(m.angle) * rr;
      m.label = `${w.key === 'moon' ? 'THE MOON' : 'MARS'} · ${formatDistance(w.state.au)}`;
    }

    // publish rounded readouts; the store only re-renders when a visible digit changes
    const st0 = useLoom.getState();
    const magR = mag < 10 ? Math.round(mag * 10) / 10 : Math.round(mag);
    const raR = Math.round(yawToRa(s.yaw) * 4) / 4;
    const decR = Math.round(THREE.MathUtils.radToDeg(s.pitch));
    if (st0.mag !== magR || st0.locked !== locked || st0.near !== near || st0.ra !== raR || st0.dec !== decR) {
      setScope({ mag: magR, locked, near, ra: raR, dec: decR });
    }
  });

  return null;
}

/* ---------- the eyepiece: a real metal rim drawn in its own screen-space scene ---------- */

const shadeVert = /* glsl */ `
  varying vec2 vP;
  void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const shadeFrag = /* glsl */ `
  uniform float inner; uniform float outer; varying vec2 vP;
  void main() {
    float a = smoothstep(inner, outer, length(vP));
    gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * 0.92);
  }
`;

function useBarrelColor() {
  const [c, setC] = useState('#ececef');
  useEffect(() => {
    const read = () => setC(getComputedStyle(document.documentElement).getPropertyValue('--barrel').trim() || '#ececef');
    read();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', read); obs.disconnect(); };
  }, []);
  return c;
}

function Eyepiece() {
  const size = useThree((s) => s.size);
  const barrel = useBarrelColor();
  const R = apertureRadius(size.width, size.height);
  const tube = R * 0.085;
  const outside = Math.hypot(size.width, size.height);
  const cy = -(APERTURE_CY - 0.5) * size.height; // ortho y is up
  const shade = useMemo(() => ({ inner: { value: R * 0.84 }, outer: { value: R } }), [R]);

  return (
    <Hud renderPriority={1}>
      <OrthographicCamera makeDefault position={[0, 0, 400]} near={0.1} far={1000} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[-0.5, 1, 1.2]} intensity={2.2} />
      <directionalLight position={[0.8, -0.9, 0.6]} intensity={0.6} color="#e4ebff" />
      {/* a bright studio for the metal to reflect, so it reads as polished silver */}
      <Environment resolution={128} frames={Infinity}>
        <Lightformer form="rect" intensity={1.1} color="#f2f4f7" position={[0, 0, -10]} scale={[40, 40, 1]} />
        <Lightformer form="rect" intensity={4} position={[0, 7, -4]} scale={[16, 5, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#c9d4e2" position={[0, -7, -4]} rotation-x={Math.PI} scale={[16, 4, 1]} />
        <Lightformer form="rect" intensity={2} position={[-8, 0, -2]} rotation-y={Math.PI / 2} scale={[10, 10, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#20242a" position={[8, 0, -2]} rotation-y={-Math.PI / 2} scale={[10, 10, 1]} />
      </Environment>

      <group position={[0, cy, 0]}>
        {/* telescope body outside the eyepiece: white in light mode, black in dark */}
        <mesh>
          <ringGeometry args={[R + tube * 1.85, outside, 160]} />
          <meshBasicMaterial color={barrel} toneMapped={false} />
        </mesh>
        {/* brushed flange */}
        <mesh position-z={1}>
          <ringGeometry args={[R + tube * 1.0, R + tube * 1.9, 160]} />
          <meshStandardMaterial color="#cfd4da" metalness={0.75} roughness={0.38} envMapIntensity={1.4} />
        </mesh>
        {/* the rounded silver bevel */}
        <mesh position-z={2}>
          <torusGeometry args={[R + tube * 0.55, tube * 0.55, 48, 240]} />
          <meshStandardMaterial color="#e9ecf0" metalness={0.85} roughness={0.2} envMapIntensity={1.5} />
        </mesh>
        {/* inner lip in shadow */}
        <mesh position-z={1.5}>
          <ringGeometry args={[R, R + tube * 0.1, 160]} />
          <meshBasicMaterial color="#0b0b0d" toneMapped={false} />
        </mesh>
        {/* glass falloff just inside the rim */}
        <mesh position-z={0.5}>
          <ringGeometry args={[R * 0.8, R + 1, 160]} />
          <shaderMaterial transparent depthWrite={false} uniforms={shade} vertexShader={shadeVert} fragmentShader={shadeFrag} />
        </mesh>
      </group>
      <Suspense fallback={null}>
        <MannyFigure R={R} cy={cy} />
      </Suspense>
    </Hud>
  );
}

/* ---------- Manny on the landing page: the 3D model (Meshy, from Natalie's drawings) beside the telescope ---------- */

const MANNY_URL = './models/manny/manny-multi-walking.glb';

function MannyFigure({ R, cy }: { R: number; cy: number }) {
  const size = useThree((s) => s.size);
  const { scene } = useGLTF(MANNY_URL);
  const model = useMemo(() => illustrate(cloneSkinned(scene)), [scene]);
  const head = useMemo(() => {
    let h: THREE.Object3D | null = null;
    model.traverse((o) => { if (!h && /head/i.test(o.name) && (o as THREE.Bone).isBone) h = o; });
    return h as THREE.Object3D | null;
  }, [model]);
  const baseHead = useMemo(() => (head ? head.rotation.clone() : null), [head]);
  const group = useRef<THREE.Group>(null);

  const H = Math.min(R * 1.55, size.height * 0.5);
  const scale = H / 1.45; // the model is 1.45 m tall
  const x = -(R * 1.16 + 60 + H * 0.18);
  const feet = cy - R * 1.08;
  const visible = size.width >= 900;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group.current) group.current.scale.set(scale, scale * (1 + Math.sin(t * 1.6) * 0.004), scale); // breathing
    if (head && baseHead) {
      // he looks over at the eyepiece, and nods while he talks
      const nod = mannyTalk.talking ? Math.sin(t * 7) * 0.06 : 0;
      head.rotation.set(baseHead.x + 0.08 + nod, baseHead.y + 0.25, baseHead.z);
    }
  });

  if (!visible) return null;
  return (
    <group ref={group} position={[x, feet, 150]} rotation={[0.04, 0.75, 0]}>
      <primitive object={model} />
    </group>
  );
}

/* ---------- scene ---------- */

export default function SpaceScene() {
  const sky = use(skyPromise);
  const setScope = useLoom((s) => s.setScope);

  // tonight's sky: positions for the moment the page opened (held steady while you look)
  const { worlds, sunDir } = useMemo(() => {
    const now = Date.now() / 1000;
    const make = (key: World): WorldNow => {
      const state = bodyAt(sky.eph, key, now);
      const angR = THREE.MathUtils.degToRad(state.diamArcsec / 3600 / 2);
      return { key, state, pos: dirFromRaDec(state.ra, state.dec).multiplyScalar(WORLD_D), radius: Math.tan(angR) * WORLD_D };
    };
    const sun = bodyAt(sky.eph, 'sun', now);
    return { worlds: [make('moon'), make('mars')], sunDir: dirFromRaDec(sun.ra, sun.dec).multiplyScalar(1000) };
  }, [sky]);

  useEffect(() => {
    setScope({ skyTime: worlds[0].state.t, skyClamped: worlds[0].state.clamped });
  }, [worlds, setScope]);

  return (
    <>
      <ambientLight intensity={0.035} />
      {/* the Sun, from NASA's position for it: this is what gives the Moon its real phase */}
      <directionalLight position={sunDir} intensity={3.4} color="#fff7e8" />
      <Stars sky={sky} />
      <Planet w={worlds[0]} texture="./textures/moon.jpg" glowColor={[1, 0.97, 0.9]} glowSize={9} />
      <Planet w={worlds[1]} texture="./textures/mars.jpg" glowColor={[1, 0.62, 0.42]} glowSize={6.5} />
      <Rig worlds={worlds} />
      <Eyepiece />
    </>
  );
}
