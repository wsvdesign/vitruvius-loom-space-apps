/*
 * DustEjecta: the only "dust storm" the Moon can have, which is the one a landing rocket makes.
 *
 * The Moon has no air and no wind. Dust moves when a rocket's exhaust hits the ground under a
 * landing spacecraft. NASA's studies of the Apollo landings describe that dust like this:
 *   - It leaves in a nearly flat sheet, 1–3° above the local ground, on all sides of the lander.
 *     Apollo video photogrammetry measured A11 2.6°, A14 2.4°, A16 1.4°, A17 2.0°; A15 measured 8.1°
 *     because it landed on a slope. (Immer, Lane, Metzger & Clements, NASA KSC, NTRS 20130012063;
 *     NASA 2011 lunar-artifacts guidance, p.12)
 *   - Speeds are 300–2000 m/s, and smaller grains go faster. Gravel and rocks 1–10 cm across go only
 *     5–50 m/s. (NASA 2011 lunar-artifacts guidance, pp.12–13)
 *   - Nothing slows it down, because there is no air. Grains under 100 µm moving 100–2400 m/s are
 *     barely bent by gravity within 20–30 m, so the paths are almost straight lines.
 *     (Lane & Metzger, NASA KSC, NTRS 20100031187)
 *   - Lunar gravity is 1.62 m/s². (NASA Moon Fact Sheet, nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html)
 *
 * Each particle follows exact ballistic flight in vacuum: x = x0 + v0·t, y = y0 + v0y·t − ½·g·t².
 * There is no drag, no swirl and no wind. A particle that meets the ground stops there and fades.
 *
 * Real speeds would cross this ~50 m stage in tens of milliseconds, so the whole event runs
 * DUST_SLOWDOWN times slower than real time. Every motion uses that same factor, so the paths keep
 * their real shapes. The caption in content/dust.json tells the child the factor.
 *
 * What is illustrative and not measured:
 *   - Streak width. Single dust grains are microscopic, so each streak stands for many grains. Gravel
 *     dots use their real 1–10 cm size.
 *   - Streak length. It is motion blur of the slowed-down motion, like a camera exposure.
 *   - Where angles fall inside the 1–3° band. We give finer grains the flatter angles and coarser
 *     grains the steeper ones, as the owner asked. NASA reports only the band.
 *   - The gravel angles, 3–8°. NASA gives no measured angle for rocks. In Lane & Metzger's model
 *     fits, 1 mm grains leave at roughly 4–10°, which is steeper than fine dust.
 *   - The glow cone. A real descent-engine plume in vacuum is close to invisible. This one is a hint
 *     of where the exhaust is.
 *   - What happens past R_MAX_M. The sheet really carries on for kilometres, and some of it goes
 *     around the Moon. Here it fades out at the edge of the stage.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import dust from '../content/dust.json';

/** Everything on screen moves this many times slower than the real event. Kept equal to dust.json's slowdown, which the caption shows. */
export const DUST_SLOWDOWN: number = dust.slowdown;

/** The physical inputs, in real units (m, s, degrees), so reviewers can check them against the sources above. */
export const DUST_PHYSICS = {
  gravity: 1.62, // m/s², NASA Moon Fact Sheet
  /** dust to sand, as one size continuum. The finest grains are fastest and flattest. */
  grains: { speedFinest: 2000, speedCoarsest: 300, angleFinest: 1, angleCoarsest: 3 }, // NASA 2011: 300–2000 m/s, 1–3°
  /** gravel and rocks 1–10 cm across */
  gravel: { speedMin: 5, speedMax: 50, angleMin: 3, angleMax: 8, sizeMin: 0.01, sizeMax: 0.1 }, // NASA 2011: 5–50 m/s. Angle is illustrative.
} as const;

/* ---------- tuning (real metres, before `scale`) ---------- */

const N_GRAIN = 5040;
const N_GRAVEL = 160;
const N = N_GRAIN + N_GRAVEL; // ≤ 6000

const DEG = Math.PI / 180;
const RING_IN_M = 0.9; // where the plume scours the ground. Lane & Metzger start their particles 0.9–6.7 m from the nozzle axis
const RING_OUT_M = 4.0;
const LIFT_M = 0.03; // particles start just above the surface
const SLOPE_STEP_M = 0.4; // used to sample the local slope, because the 1–3° is measured above the *local* terrain
const R_MAX_M = 40; // edge of the stage. Particles fade out here; in reality they keep going for km
const NOZZLE_HEIGHT_M = 7; // height of the glow cone, which fades out going up
const STREAK_T = 0.06; // seconds of on-screen motion blur
const STREAK_MAX_M = 1.4;
const LAND_FADE = 1.4; // on-screen seconds for a landed particle to fade
const RAMP = 2.5; // on-screen seconds over which the sheet builds after the engine lights
const FADE_IN = 0.35; // time constants for the global fade, in seconds
const FADE_OUT = 0.9;

const REGOLITH = '#9a9a96';
const GLOW = '#ffe9c9';

/* particle states */
const DORMANT = 0;
const WAITING = 1;
const FLYING = 2;
const LANDED = 3;

type GroundY = (x: number, z: number) => number;

interface Props {
  active: boolean;
  /** where the exhaust meets the ground, under the engine. Its y is ignored, because the ground height comes from `groundY`. */
  origin: [number, number, number];
  /** height of the terrain at (x, z), in scene units */
  groundY: GroundY;
  /** scene units per real metre. Use 1 for life size. */
  scale?: number;
}

/* ---------- shaders ---------- */

const STREAK_VERT = /* glsl */ `
attribute vec3 iHead;
attribute vec3 iStreak;
attribute vec3 iMeta; // x: width (scene units), y: opacity, z: brightness
uniform float uViewportH;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
varying float vLw;
void main() {
  vec3 head = (modelViewMatrix * vec4(iHead, 1.0)).xyz;
  vec3 tail = (modelViewMatrix * vec4(iHead - iStreak, 1.0)).xyz;
  vec3 mid = 0.5 * (head + tail);
  vec3 axis = head - tail;
  float len = length(axis);
  vec3 dir = len > 1e-6 ? axis / len : vec3(0.0, 1.0, 0.0);

  // keep far streaks at least ~1.5 px wide (thinner, fainter), so the sheet does not alias away
  float worldPerPx = 2.0 * max(-mid.z, 1e-3) / (projectionMatrix[1][1] * uViewportH);
  float w = iMeta.x;
  float a = iMeta.y;
  float wMin = 1.5 * worldPerPx;
  if (w < wMin) { a *= max(w / wMin, 0.3); w = wMin; }

  // the streak is a capsule. Measure it in screen space so its ends stay round even when seen end-on.
  vec3 side = cross(dir, normalize(-mid));
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  vec4 hc = projectionMatrix * vec4(head, 1.0);
  vec4 tc = projectionMatrix * vec4(tail, 1.0);
  float lenPx = length(hc.xy / hc.w - tc.xy / tc.w) * 0.5 * uViewportH;
  float wPx = w / worldPerPx;
  float lw = max(lenPx / wPx, 0.0); // visible length in widths
  // pad both ends by half a width so the round caps fit
  vec3 pad = dir * (0.5 * w);
  vec3 p = mix(tail - pad, head + pad, position.y) + side * (position.x * w);

  vUv = vec2(position.x * 2.0, position.y * (lw + 1.0)); // x in half-widths (−1..1), y in widths (0..lw+1)
  vLw = lw;
  vAlpha = a;
  vShade = iMeta.z;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const STREAK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
varying float vLw;
void main() {
  // distance (in half-widths) to the centre segment that runs from 0.5 to 0.5 + lw widths
  float y = clamp(vUv.y, 0.5, 0.5 + vLw);
  float d = length(vec2(vUv.x, (vUv.y - y) * 2.0));
  float shape = 1.0 - smoothstep(0.45, 1.0, d);
  // faint tail, solid head, which shows the direction of travel. A dot is uniform.
  float t = vLw > 0.5 ? clamp((vUv.y - 0.5) / vLw, 0.0, 1.0) : 1.0;
  float along = mix(0.08, 1.0, t * t * (3.0 - 2.0 * t));
  float a = vAlpha * shape * along;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * vShade, a);
  #include <colorspace_fragment>
}
`;

const GLOW_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = mv.xyz;
  vN = normalize(normalMatrix * normal);
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}
`;

// open cone: uv.y is 1 at the top and 0 at the ground. It fades out going up, so it reads as exhaust coming down from an engine above.
const CONE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  float facing = abs(dot(normalize(vN), normalize(-vV)));
  float body = facing * facing;
  float h = vUv.y;
  float vert = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.25, 1.0, h));
  gl_FragColor = vec4(uColor, uOpacity * body * vert);
  #include <colorspace_fragment>
}
`;

const POOL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float f = 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(uColor, uOpacity * f * f);
  #include <colorspace_fragment>
}
`;

/* ---------- the simulation: exact vacuum ballistics, sampled in slowed-down time ---------- */

class EjectaSim {
  readonly p0 = new Float32Array(N * 3); // launch point (scene units)
  readonly v0 = new Float32Array(N * 3); // launch velocity (real m/s)
  readonly center = new Float32Array(N * 2); // where the ring was centred at launch
  readonly tLaunch = new Float64Array(N); // on-screen seconds
  readonly tLand = new Float64Array(N);
  readonly landPos = new Float32Array(N * 3);
  readonly state = new Uint8Array(N);
  readonly width = new Float32Array(N); // real metres (multiplied by scale when drawn)
  readonly alpha = new Float32Array(N);
  readonly shade = new Float32Array(N);

  /** launch particle i from the scoured ring around (ox, oz) */
  launch(i: number, now: number, ox: number, oz: number, groundY: GroundY, scale: number) {
    const gravel = i >= N_GRAIN;
    // uniform over the ring's area
    const r = Math.sqrt(RING_IN_M * RING_IN_M + Math.random() * (RING_OUT_M * RING_OUT_M - RING_IN_M * RING_IN_M)) * scale;
    const phi = Math.random() * Math.PI * 2;
    const ux = Math.cos(phi);
    const uz = Math.sin(phi);
    const x = ox + ux * r;
    const z = oz + uz * r;
    const gy = groundY(x, z);

    // the 1–3° is measured above the local ground, so add the slope of the terrain along the outward direction
    const hs = SLOPE_STEP_M * scale;
    const slope = (groundY(x + ux * hs, z + uz * hs) - groundY(x - ux * hs, z - uz * hs)) / (2 * hs);

    let speed: number;
    let angleDeg: number;
    if (gravel) {
      const g = DUST_PHYSICS.gravel;
      speed = g.speedMin + Math.random() * (g.speedMax - g.speedMin);
      angleDeg = g.angleMin + Math.random() * (g.angleMax - g.angleMin);
      const size = g.sizeMin + (g.sizeMax - g.sizeMin) * Math.random() * Math.random(); // mostly small pebbles
      this.width[i] = size;
      this.alpha[i] = 0.95;
      this.shade[i] = 0.72 + Math.random() * 0.2;
    } else {
      // s = 0 is the finest dust, s = 1 the coarsest sand. Speed is interpolated in log space, ±10% jitter.
      const g = DUST_PHYSICS.grains;
      const s = Math.random();
      speed = g.speedFinest * Math.pow(g.speedCoarsest / g.speedFinest, s) * (0.9 + Math.random() * 0.2);
      angleDeg = Math.min(g.angleCoarsest, Math.max(g.angleFinest, g.angleFinest + (g.angleCoarsest - g.angleFinest) * s + (Math.random() - 0.5) * 0.3));
      this.width[i] = (0.016 + 0.026 * s) * (0.8 + Math.random() * 0.4);
      this.alpha[i] = 0.32 + 0.38 * s + Math.random() * 0.1; // fine dust as a thin haze, sand a little more solid
      this.shade[i] = 1.12 - 0.2 * s + Math.random() * 0.06;
    }

    const elev = angleDeg * DEG + Math.atan(slope);
    const az = phi + (Math.random() - 0.5) * 2 * DEG; // radially outward, ±1°
    const ch = Math.cos(elev) * speed;
    const j3 = i * 3;
    this.p0[j3] = x;
    this.p0[j3 + 1] = gy + LIFT_M * scale;
    this.p0[j3 + 2] = z;
    this.v0[j3] = Math.cos(az) * ch;
    this.v0[j3 + 1] = Math.sin(elev) * speed;
    this.v0[j3 + 2] = Math.sin(az) * ch;
    this.center[i * 2] = ox;
    this.center[i * 2 + 1] = oz;
    this.tLaunch[i] = now;
    this.state[i] = FLYING;
  }
}

/* ---------- component ---------- */

export default function DustEjecta({ active, origin, groundY, scale = 1 }: Props) {
  const props = useRef({ active, origin, groundY, scale });
  props.current = { active, origin, groundY, scale };

  const sim = useMemo(() => new EjectaSim(), []);
  const run = useRef({ now: 0, fade: 0, wasActive: false, live: 0 });

  const { geo, mat, head, streak, meta } = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    // unit quad: x across the streak (−0.5..0.5), y along it (0 = tail, 1 = head)
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const head = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const streak = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const meta = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iHead', head);
    g.setAttribute('iStreak', streak);
    g.setAttribute('iMeta', meta);
    g.instanceCount = N;
    const m = new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      uniforms: { uColor: { value: new THREE.Color(REGOLITH) }, uViewportH: { value: 1000 } },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    return { geo: g, mat: m, head, streak, meta };
  }, []);

  const glow = useMemo(() => {
    const coneGeo = new THREE.CylinderGeometry(0.5, 2.8, NOZZLE_HEIGHT_M, 40, 1, true);
    const poolGeo = new THREE.CircleGeometry(3.2, 48);
    poolGeo.rotateX(-Math.PI / 2);
    const common = {
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    };
    const coneMat = new THREE.ShaderMaterial({
      ...common,
      vertexShader: GLOW_VERT,
      fragmentShader: CONE_FRAG,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(GLOW) }, uOpacity: { value: 0 } },
    });
    const poolMat = new THREE.ShaderMaterial({
      ...common,
      vertexShader: GLOW_VERT,
      fragmentShader: POOL_FRAG,
      uniforms: { uColor: { value: new THREE.Color(GLOW) }, uOpacity: { value: 0 } },
    });
    return { coneGeo, poolGeo, coneMat, poolMat };
  }, []);

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
      glow.coneGeo.dispose();
      glow.poolGeo.dispose();
      glow.coneMat.dispose();
      glow.poolMat.dispose();
    },
    [geo, mat, glow],
  );

  const mesh = useRef<THREE.Mesh>(null);
  const glowGroup = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    const { active: on, origin: o, groundY: gY, scale: sc } = props.current;
    const r = run.current;
    const dt = Math.min(delta, 0.1); // no jump after a hidden tab
    r.now += dt;
    const now = r.now;

    // smooth global fade
    const tau = on ? FADE_IN : FADE_OUT;
    r.fade += ((on ? 1 : 0) - r.fade) * (1 - Math.exp(-dt / tau));

    // the engine lights: wake the dormant pool, staggered so the sheet grows out of the ring
    if (on && !r.wasActive) {
      for (let i = 0; i < N; i++) {
        if (sim.state[i] === DORMANT) {
          sim.state[i] = WAITING;
          sim.tLaunch[i] = now + Math.random() * RAMP;
        }
      }
    }
    // the engine stops: cancel launches that have not happened. Grains already in flight keep flying.
    if (!on && r.wasActive) {
      for (let i = 0; i < N; i++) if (sim.state[i] === WAITING) sim.state[i] = DORMANT;
    }
    r.wasActive = on;

    const m = mesh.current;
    const gg = glowGroup.current;
    const ox = o[0];
    const oz = o[2];
    const baseY = gY(ox, oz);

    // glow cone over the impingement point
    if (gg) {
      gg.position.set(ox, baseY, oz);
      gg.scale.setScalar(sc);
      const g = on ? r.fade : r.fade * 0.6; // the cone goes out before the dust settles
      glow.coneMat.uniforms.uOpacity.value = 0.26 * g;
      glow.poolMat.uniforms.uOpacity.value = 0.16 * g;
      gg.visible = g > 0.003;
    }

    if (!m) return;
    if (!on && r.fade < 0.003) {
      // fully faded: put everything to sleep
      if (r.live > 0) {
        sim.state.fill(DORMANT);
        r.live = 0;
      }
      m.visible = false;
      return;
    }
    m.visible = true;
    mat.uniforms.uViewportH.value = state.size.height * state.viewport.dpr;

    const g = DUST_PHYSICS.gravity;
    const k = DUST_SLOWDOWN;
    const rMax = R_MAX_M * sc;
    const rFade = rMax * 0.7;
    const streakMax = STREAK_MAX_M * sc;
    const H = head.array as Float32Array;
    const S = streak.array as Float32Array;
    const M = meta.array as Float32Array;
    let live = 0;

    for (let i = 0; i < N; i++) {
      const j3 = i * 3;
      let st = sim.state[i];

      if (st === WAITING && now >= sim.tLaunch[i]) {
        sim.launch(i, now, ox, oz, gY, sc);
        st = FLYING;
      }

      if (st === FLYING) {
        const tw = now - sim.tLaunch[i]; // on-screen seconds since launch
        const t = tw / k; // real seconds since launch
        const vx = sim.v0[j3];
        const vy0 = sim.v0[j3 + 1];
        const vz = sim.v0[j3 + 2];
        const x = sim.p0[j3] + vx * t * sc;
        const y = sim.p0[j3 + 1] + (vy0 * t - 0.5 * g * t * t) * sc;
        const z = sim.p0[j3 + 2] + vz * t * sc;
        const dx = x - sim.center[i * 2];
        const dz = z - sim.center[i * 2 + 1];
        const rh = Math.sqrt(dx * dx + dz * dz);
        const gyHere = gY(x, z);

        if (y <= gyHere) {
          // it hit the ground, so it stops here
          sim.state[i] = LANDED;
          sim.tLand[i] = now;
          sim.landPos[j3] = x;
          sim.landPos[j3 + 1] = gyHere + 0.01 * sc;
          sim.landPos[j3 + 2] = z;
          st = LANDED;
        } else if (rh > rMax) {
          // it left the stage (in reality it is still flying, kilometres further on)
          if (on) {
            sim.launch(i, now, ox, oz, gY, sc);
          } else {
            sim.state[i] = DORMANT;
          }
          M[j3 + 1] = 0;
          live++;
          continue;
        } else {
          // the velocity on screen gives a motion-blur streak, never longer than the distance travelled
          const vsx = (vx * sc) / k;
          const vsy = ((vy0 - g * t) * sc) / k;
          const vsz = (vz * sc) / k;
          const vlen = Math.sqrt(vsx * vsx + vsy * vsy + vsz * vsz) + 1e-9;
          const travelled = Math.hypot(x - sim.p0[j3], y - sim.p0[j3 + 1], z - sim.p0[j3 + 2]);
          const len = Math.min(vlen * STREAK_T, streakMax, travelled);
          H[j3] = x;
          H[j3 + 1] = y;
          H[j3 + 2] = z;
          S[j3] = (vsx / vlen) * len;
          S[j3 + 1] = (vsy / vlen) * len;
          S[j3 + 2] = (vsz / vlen) * len;
          const birth = Math.min(1, tw / 0.12);
          const edge = rh > rFade ? 1 - (rh - rFade) / (rMax - rFade) : 1;
          M[j3] = sim.width[i] * sc;
          M[j3 + 1] = sim.alpha[i] * birth * edge * r.fade;
          M[j3 + 2] = sim.shade[i];
          live++;
          continue;
        }
      }

      if (st === LANDED) {
        const age = now - sim.tLand[i];
        const a = 1 - age / LAND_FADE;
        if (a <= 0) {
          if (on) {
            sim.launch(i, now, ox, oz, gY, sc);
          } else {
            sim.state[i] = DORMANT;
          }
          M[j3 + 1] = 0;
          live++;
          continue;
        }
        H[j3] = sim.landPos[j3];
        H[j3 + 1] = sim.landPos[j3 + 1];
        H[j3 + 2] = sim.landPos[j3 + 2];
        S[j3] = 0;
        S[j3 + 1] = 0;
        S[j3 + 2] = 0;
        M[j3] = sim.width[i] * sc;
        M[j3 + 1] = sim.alpha[i] * a * 0.7 * r.fade;
        M[j3 + 2] = sim.shade[i];
        live++;
        continue;
      }

      // dormant or still waiting: invisible
      M[j3 + 1] = 0;
    }

    r.live = live;
    head.needsUpdate = true;
    streak.needsUpdate = true;
    meta.needsUpdate = true;
  });

  return (
    <>
      <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={3} visible={false} />
      <group ref={glowGroup} visible={false}>
        <mesh geometry={glow.coneGeo} material={glow.coneMat} position={[0, NOZZLE_HEIGHT_M / 2, 0]} renderOrder={2} />
        <mesh geometry={glow.poolGeo} material={glow.poolMat} position={[0, 0.05, 0]} renderOrder={2} />
      </group>
    </>
  );
}
