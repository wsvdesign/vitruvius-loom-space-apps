import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useLoom, type View } from '../state';
import { look } from '../pointer';
import { quakeLevel } from '../audio';
import DustEjecta from './DustEjecta';
import Manny3D, { mannyWorld, mannyFocus } from './Manny3D';
import { DescentStage, IngenuityModel } from './NasaModels';
import { Suspense } from 'react';

/** camera heading in degrees (0 = the scene's north, −Z), read by the compass strip */
export const surfaceView = { heading: 0 };

/* ---------- constants ---------- */

const LANDER = new THREE.Vector3(8.5, 0, -4.5);
const SEISMO = new THREE.Vector3(-2.5, 0, -7.5);
const RETRO = new THREE.Vector3(3.2, 0, -8.8); // Laser Ranging Retroreflector
const LANDER_STOP = new THREE.Vector3(4.0, 0, -1.5); // just outside Eagle's footpads (legs span about 9 m)
const EARTH_POS = new THREE.Vector3(-120, 88, -170);
const ICE = new THREE.Vector3(-14, 0, -13);
const MANNY = new THREE.Vector3(-2.6, 0, 2.8);
const GINNY = new THREE.Vector3(2.2, 1.55, 3.6);

const VIEWS: Record<View, { pos: [number, number, number]; look: THREE.Vector3 }> = {
  wide: { pos: [3.4, 3.8, 13.5], look: new THREE.Vector3(2.4, 1.0, -1.6) },
  lander: { pos: [5.6, 2.1, 2.2], look: LANDER.clone().add(new THREE.Vector3(0, 1.4, 0)) },
  seismo: { pos: [0.8, 1.7, -3.8], look: SEISMO.clone().add(new THREE.Vector3(0, 0.7, 0)) },
  dust: { pos: [0.2, 2.2, 7.5], look: new THREE.Vector3(7.5, 0.4, -4) },
  ice: { pos: [-8.5, 3.2, -6.5], look: ICE.clone().add(new THREE.Vector3(0, 0.4, 0)) },
  laser: { pos: [5.6, 1.5, -5.6], look: new THREE.Vector3(3.2, 0.5, -8.8) },
};

/* ---------- terrain: procedural craters, honest label "illustration, not a site map" ---------- */

function terrainHeight(x: number, z: number): number {
  // deterministic pseudo-noise + crater rims/bowls
  let h = 0;
  h += Math.sin(x * 0.35 + 1.7) * Math.sin(z * 0.31 - 0.6) * 0.35;
  h += Math.sin(x * 1.3 - z * 0.9) * 0.07;
  h += Math.sin(x * 0.06 + z * 0.05) * 0.5;
  const craters: [number, number, number][] = [
    [4, -9, 4.4], [-9, -4, 3.2], [10, 6, 2.6], [-4, 9, 5.0], [13, -11, 3.0],
    [-14, -13, 6.5], [0.8, 0.35, 0.001], // tiny dimple at the dust patch
  ];
  for (const [cx, cz, cr] of craters) {
    const d = Math.hypot(x - cx, z - cz) / cr;
    if (d < 1.6) {
      const rim = Math.exp(-Math.pow((d - 0.96) / 0.16, 2)) * cr * 0.055;
      const bowl = d < 0.94 ? -Math.cos((d / 0.94) * Math.PI * 0.5) * cr * 0.11 : 0;
      h += rim + bowl;
    }
  }
  return h;
}

function Terrain() {
  const geo = useMemo(() => {
    const size = 220;
    const seg = 220;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, terrainHeight(x, z));
    }
    g.computeVertexNormals();
    return g;
  }, []);

  const iceRef = useRef<THREE.Mesh>(null);
  const { question } = useLoom.getState();
  void question;

  const { map, bump } = useRegolith();

  return (
    <>
      <mesh geometry={geo} receiveShadow castShadow>
        {/* lunar grey, not beige: the Apollo surface photos are neutral grey with a fine gritty texture */}
        <meshStandardMaterial color="#9a9996" map={map} bumpMap={bump} bumpScale={0.6} roughness={1} metalness={0} />
      </mesh>
      <Rocks />
      {/* ice hint in the polar crater — only visible when asked about water */}
      <IceGlint position={ICE} />
    </>
  );
}

/* fine regolith: speckled grey grit and tiny pits, generated once (illustrative close-up, labelled in credits) */
function useRegolith() {
  return useMemo(() => {
    const N = 512;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    const img = g.createImageData(N, N);
    const b = document.createElement('canvas');
    b.width = b.height = N;
    const bg = b.getContext('2d')!;
    const bimg = bg.createImageData(N, N);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // value noise for soft mottling
    const grid = 32;
    const vals = Array.from({ length: (grid + 1) * (grid + 1) }, rnd);
    const vn = (x: number, y: number) => {
      const gx = (x / N) * grid, gy = (y / N) * grid;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0;
      const v = (i: number, j: number) => vals[((j % grid) * (grid + 1)) + (i % grid)];
      const a = v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx;
      const bb = v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx;
      return a * (1 - fy) + bb * fy;
    };
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        const grit = rnd();
        const mottle = vn(x, y);
        const l = 150 + mottle * 50 + (grit - 0.5) * 70;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(60, Math.min(235, l));
        img.data[i + 3] = 255;
        const h = 128 + (grit - 0.5) * 120 + (mottle - 0.5) * 60;
        bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = h;
        bimg.data[i + 3] = 255;
      }
    }
    // tiny pits
    for (let k = 0; k < 900; k++) {
      const px = rnd() * N, py = rnd() * N, r = 1 + rnd() * 4;
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        const ix = ((Math.floor(py + y) + N) % N) * N + ((Math.floor(px + x) + N) % N);
        bimg.data[ix * 4] = bimg.data[ix * 4 + 1] = bimg.data[ix * 4 + 2] = 60;
        img.data[ix * 4] = img.data[ix * 4 + 1] = img.data[ix * 4 + 2] = Math.max(70, img.data[ix * 4] - 35);
      }
    }
    g.putImageData(img, 0, 0);
    bg.putImageData(bimg, 0, 0);
    const map = new THREE.CanvasTexture(c);
    const bump = new THREE.CanvasTexture(b);
    for (const t of [map, bump]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(70, 70);
      t.anisotropy = 8;
    }
    map.colorSpace = THREE.SRGBColorSpace;
    return { map, bump };
  }, []);
}

/* scattered rocks and pebbles, as in the Apollo 11 surface photographs */
function Rocks() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = 420;
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const r = 3 + Math.pow(rnd(), 0.6) * 60;
      const a = rnd() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // keep the foreground clear: no boulders right under the viewpoint
      if (Math.hypot(x - 3.4, z - 13.5) < 8) { m.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); continue; }
      const s = 0.04 + Math.pow(rnd(), 4) * 0.55;
      o.position.set(x, terrainHeight(x, z) + s * 0.25, z);
      o.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      o.scale.set(s * (0.8 + rnd() * 0.6), s * (0.5 + rnd() * 0.4), s * (0.8 + rnd() * 0.6));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#8a8986" roughness={1} metalness={0} flatShading />
    </instancedMesh>
  );
}

function IceGlint({ position }: { position: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null);
  const { question } = useLoom();
  const target = question === 'water' ? 1 : 0;
  const cur = useRef(0);
  useFrame((_, dt) => {
    cur.current = THREE.MathUtils.lerp(cur.current, target, 1 - Math.pow(0.05, dt));
    if (ref.current) {
      (ref.current.material as THREE.MeshStandardMaterial).opacity = cur.current;
      ref.current.visible = cur.current > 0.02;
    }
  });
  return (
    <mesh ref={ref} position={[position.x, terrainHeight(position.x, position.z) + 0.06, position.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[3.4, 40]} />
      <meshStandardMaterial color="#d8f2fb" emissive="#9adcf0" emissiveIntensity={0.6} roughness={0.25} transparent opacity={0} />
    </mesh>
  );
}

/* ---------- the abandoned descent stage: gold foil ---------- */

function Lander() {
  const base = terrainHeight(LANDER.x, LANDER.z);
  return (
    <group position={[LANDER.x, base, LANDER.z]}>
      {/* descent stage body wrapped in gold foil */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[2.5, 1.05, 2.5]} />
        <meshStandardMaterial color="#c9a24a" metalness={0.85} roughness={0.28} />
      </mesh>
      {/* foil seams */}
      {[0.64, 0, -0.64].map((y) => (
        <mesh key={y} position={[0, 1.05 + y, 1.26]}>
          <boxGeometry args={[2.52, 0.06, 0.02]} />
          <meshStandardMaterial color="#8a6a2c" metalness={0.9} roughness={0.4} />
        </mesh>
      ))}
      {/* legs */}
      {[[1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]].map(([lx, lz], i) => (
        <group key={i}>
          <mesh position={[lx * 0.86, 0.5, lz * 0.86]} rotation={[0, 0, lx > 0 ? -0.42 : 0.42]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 1.6, 8]} />
            <meshStandardMaterial color="#b3ab9d" metalness={0.6} roughness={0.5} />
          </mesh>
          <mesh position={[lx * 1.05, 0.06, lz * 1.05]} castShadow>
            <cylinderGeometry args={[0.42, 0.5, 0.14, 12]} />
            <meshStandardMaterial color="#a29a8c" metalness={0.4} roughness={0.7} />
          </mesh>
        </group>
      ))}
      {/* engine bell */}
      <mesh position={[0, 0.28, 0]} castShadow>
        <cylinderGeometry args={[0.34, 0.62, 0.62, 16]} />
        <meshStandardMaterial color="#6d675f" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* antenna mast */}
      <mesh position={[0.7, 2.6, 0.7]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 1.5, 6]} />
        <meshStandardMaterial color="#cfc8ba" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0.7, 3.4, 0.7]} castShadow>
        <sphereGeometry args={[0.16, 12, 10]} />
        <meshStandardMaterial color="#cfc8ba" metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
}

/* ---------- Passive Seismic Experiment: drum, two solar-panel wings, sensor that moves with the real recording ---------- */

function Seismometer() {
  const base = terrainHeight(SEISMO.x, SEISMO.z);
  const sensor = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state) => {
    const lvl = quakeLevel(); // 0 unless the Apollo 12 recording is playing
    const t = state.clock.elapsedTime;
    if (sensor.current) {
      sensor.current.position.x = Math.sin(t * 61) * lvl * 0.035;
      sensor.current.position.z = Math.cos(t * 47) * lvl * 0.035;
      sensor.current.rotation.z = Math.sin(t * 39) * lvl * 0.08;
    }
    if (lamp.current) lamp.current.color.setRGB(0.15 + lvl * 0.85, 0.9, 0.95 * (0.4 + lvl * 0.6));
  });
  return (
    <group position={[SEISMO.x, base, SEISMO.z]}>
      {/* main drum in gold multilayer insulation */}
      <mesh position={[0, 0.28, 0]} castShadow>
        <cylinderGeometry args={[0.38, 0.44, 0.5, 20]} />
        <meshStandardMaterial color="#c9a24a" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* sensor head */}
      <group ref={sensor}>
        <mesh position={[0, 0.6, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.14, 0.16, 12]} />
          <meshStandardMaterial color="#d8d2c4" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.7, 0]}>
          <sphereGeometry args={[0.035, 10, 8]} />
          <meshBasicMaterial ref={lamp} color="#22d3ee" toneMapped={false} />
        </mesh>
      </group>
      {/* two solar-panel wings */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.72, 0.42, 0]} rotation={[0.22, 0, side * -0.05]}>
          <mesh castShadow>
            <boxGeometry args={[0.85, 0.025, 0.55]} />
            <meshStandardMaterial color="#1b2b44" metalness={0.5} roughness={0.3} emissive="#0d1d33" emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[-side * 0.36, -0.12, 0]}>
            <boxGeometry args={[0.03, 0.22, 0.03]} />
            <meshStandardMaterial color="#9b9488" metalness={0.6} roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ---------- Laser Ranging Retroreflector: still in use. Laser pulses from Earth hit it and come back. ---------- */

function Retroreflector() {
  const base = terrainHeight(RETRO.x, RETRO.z);
  const cubes = useMemo(() => {
    const out: [number, number][] = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) out.push([(i - 4.5) * 0.042, (j - 4.5) * 0.042]);
    return out;
  }, []);
  const flash = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (flash.current) flash.current.opacity = laser.hit * 0.9;
  });
  return (
    <group position={[RETRO.x, base, RETRO.z]} rotation={[0, -0.6, 0]}>
      {/* legs */}
      {[[-0.22, -0.18], [0.22, -0.18], [-0.22, 0.18], [0.22, 0.18]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.16, z]} castShadow>
          <cylinderGeometry args={[0.012, 0.012, 0.32, 6]} />
          <meshStandardMaterial color="#b8b0a2" metalness={0.7} roughness={0.4} />
        </mesh>
      ))}
      {/* the 46 × 46 cm panel, tilted up toward Earth */}
      <group position={[0, 0.36, 0]} rotation={[-0.75, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.46, 0.46, 0.04]} />
          <meshStandardMaterial color="#d6d0c4" metalness={0.75} roughness={0.35} />
        </mesh>
        {/* 100 reflectors */}
        {cubes.map(([x, y], i) => (
          <mesh key={i} position={[x, y, 0.021]}>
            <circleGeometry args={[0.017, 12]} />
            <meshStandardMaterial color="#20262e" metalness={1} roughness={0.08} />
          </mesh>
        ))}
        <mesh position={[0, 0, 0.024]}>
          <planeGeometry args={[0.46, 0.46]} />
          <meshBasicMaterial ref={flash} color="#4ade80" transparent opacity={0} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/* shared pulse state: 0…1 brightness of the hit, read by the reflector */
const laser = { hit: 0 };

function LaserLink({ from }: { from: THREE.Vector3 }) {
  const to = useMemo(() => RETRO.clone().setY(terrainHeight(RETRO.x, RETRO.z) + 0.36), []);
  const beam = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    return g;
  }, [from, to]);
  const pulse = useRef<THREE.Mesh>(null);
  const beamMat = useRef<THREE.LineBasicMaterial>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const PERIOD = 3.2; // one pulse down and back (shown slowed: the real round trip takes about 2.5 seconds)
  useFrame((state) => {
    const t = (state.clock.elapsedTime % PERIOD) / PERIOD;
    // 0 → 0.45 travelling down, 0.45 → 0.55 at the reflector, 0.55 → 1 travelling back up
    const down = t < 0.45 ? t / 0.45 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
    tmp.copy(from).lerp(to, down);
    if (pulse.current) {
      pulse.current.position.copy(tmp);
      const s = 0.12 + 0.35 * (1 - down) * 0.2;
      pulse.current.scale.setScalar(s);
    }
    laser.hit = t > 0.43 && t < 0.6 ? 1 - Math.abs(t - 0.5) / 0.1 : 0;
    if (beamMat.current) beamMat.current.opacity = 0.18 + laser.hit * 0.5;
  });
  return (
    <>
      <lineSegments geometry={beam}>
        <lineBasicMaterial ref={beamMat} color="#4ade80" transparent opacity={0.2} toneMapped={false} />
      </lineSegments>
      <mesh ref={pulse}>
        <sphereGeometry args={[1, 12, 10]} />
        <meshBasicMaterial color="#86efac" toneMapped={false} />
      </mesh>
    </>
  );
}

/* ---------- Manny: hologram projection of the ink-and-chalk drawing ---------- */

const holoVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const holoFrag = /* glsl */ `
  uniform sampler2D map;
  uniform float time;
  uniform float appear; // 0..1
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    // scanlines drifting upward
    float scan = 0.88 + 0.12 * sin(uv.y * 90.0 - time * 3.0);
    // chromatic split like anaglyph glasses
    float split = 0.004 + 0.002 * sin(time * 1.7);
    vec4 c;
    c.r = texture2D(map, uv + vec2(split, 0.0)).r;
    c.g = texture2D(map, uv).g;
    c.b = texture2D(map, uv - vec2(split, 0.0)).b;
    c.a = texture2D(map, uv).a;
    // slight cyan cast — hologram, not paper
    vec3 col = vec3(c.r * 0.55, c.g * 0.95, c.b * 1.12) * scan;
    // appear glitch: horizontal band cut
    float band = step(0.5, fract(uv.y * 2.0 + time * 1.5));
    float glitch = mix(band, 1.0, appear);
    // cyan rim just inside the edges
    float edge = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x)
               * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
    col += vec3(0.08, 0.5, 0.62) * (1.0 - edge) * 0.3;
    float alpha = c.a * (0.55 + 0.45 * appear) * glitch;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha * 0.94);
  }
`;

function MannyHologram() {
  const map = useTexture('./characters/cutouts/02_manny_front_view.png');
  const mat = useRef<THREE.ShaderMaterial>(null);
  const grp = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const appear = useRef(0);
  const born = useRef(-1);

  const uniforms = useMemo(
    () => ({
      map: { value: map },
      time: { value: 0 },
      appear: { value: 0 },
    }),
    [map],
  );

  useFrame((state) => {
    // R3F may clone the uniforms object — always drive the material's own copy
    const u = mat.current ? mat.current.uniforms : uniforms;
    u.time.value = state.clock.elapsedTime;
    if (born.current < 0) born.current = state.clock.elapsedTime;
    // deterministic fade-in: glitch bands resolve over the first ~2s
    const age = state.clock.elapsedTime - born.current;
    appear.current = THREE.MathUtils.smoothstep(age, 0.5, 2.0);
    u.appear.value = appear.current;
    if (mat.current) mat.current.uniformsNeedUpdate = true;
    if (grp.current) {
      // gentle float + billboard toward camera
      grp.current.position.y = holoY + Math.sin(state.clock.elapsedTime * 1.1) * 0.05;
      grp.current.rotation.y = Math.atan2(camera.position.x - grp.current.position.x, camera.position.z - grp.current.position.z);
    }
  });

  const base = terrainHeight(MANNY.x, MANNY.z);
  // clear the hologram above any ground bumps around him
  const around = Math.max(
    base,
    ...Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return terrainHeight(MANNY.x + Math.cos(a) * 1.5, MANNY.z + Math.sin(a) * 1.5);
    }),
  );
  // plane center: bottom of the 2.15-tall plane sits just above the cleared ground
  const holoY = Math.max(0, around - base) + 0.92;

  return (
    <group position={[MANNY.x, base, MANNY.z]}>
      {/* projection beam origin point */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.72, 48]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 40]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>
      <group ref={grp} position={[0, holoY, 0]}>
        <mesh>
          <planeGeometry args={[1.75 * 561 / 1437, 1.75]} />
          <shaderMaterial
            ref={mat}
            vertexShader={holoVert}
            fragmentShader={holoFrag}
            uniforms={uniforms}
            transparent
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      <pointLight position={[0, 1.6, 0.4]} color="#22d3ee" intensity={2.2} distance={6} />
    </group>
  );
}

/* ---------- Ginny: the Ingenuity-style drone guide ---------- */

function Ginny() {
  const grp = useRef<THREE.Group>(null);
  const r1 = useRef<THREE.Group>(null);
  const r2 = useRef<THREE.Group>(null);
  const [excite, setExcite] = useState(0);
  const question = useLoom((s) => s.question);
  const sound = useLoom((s) => s.sound);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const target = question ? 1 : 0;
    setExcite((e) => e + (target - e) * (1 - Math.pow(0.02, dt)));
    if (grp.current) {
      const base = terrainHeight(GINNY.x, GINNY.z);
      grp.current.position.set(
        GINNY.x + Math.sin(t * 0.5) * 0.25,
        base + 1.55 + Math.sin(t * 1.6) * 0.07 + excite * 0.18,
        GINNY.z + Math.cos(t * 0.4) * 0.2,
      );
      grp.current.rotation.y = Math.sin(t * 0.35) * 0.5;
      grp.current.rotation.z = Math.sin(t * 0.9) * 0.04;
    }
    if (r1.current) r1.current.rotation.y += dt * (28 + excite * 30);
    if (r2.current) r2.current.rotation.y -= dt * (28 + excite * 30);
  });

  return (
    <group ref={grp}>
      {/* NASA's Ingenuity model (real size), rotors spinning */}
      <Suspense fallback={null}>
        <IngenuityModel />
      </Suspense>
      {/* nav light */}
      <mesh position={[0, -0.1, 0.1]}>
        <sphereGeometry args={[0.022, 8, 8]} />
        <meshBasicMaterial color="#22d3ee" />
      </mesh>
      <pointLight color="#22d3ee" intensity={0.8} distance={3.5} />
      {sound && <GinnyLightPulse />}
    </group>
  );
}

function GinnyLightPulse() {
  return null; // placeholder for future nav-light blink sync
}

/* ---------- Earth in the sky ---------- */

function EarthSky() {
  const map = useTexture('./textures/earth.jpg');
  return (
    <group position={EARTH_POS}>
      <mesh>
        <sphereGeometry args={[7, 48, 32]} />
        <meshBasicMaterial map={map} />
      </mesh>
      <mesh>
        <sphereGeometry args={[7.35, 32, 24]} />
        <meshBasicMaterial color="#8fb8ff" transparent opacity={0.16} />
      </mesh>
    </group>
  );
}

/* ---------- camera rig for surface views + sun swing for the temperature question ---------- */

function SurfaceRig() {
  const { camera } = useThree();
  const view = useLoom((s) => s.view);
  const question = useLoom((s) => s.question);
  const sun = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const cur = useRef({ set: false });

  const want = useMemo(() => new THREE.Vector3(), []);
  const wantLook = useMemo(() => new THREE.Vector3(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const v = VIEWS[view];
    const k = 1 - Math.pow(0.015, dt);
    // the world shifts a little against the glass as you move: you are standing here, not watching a picture
    if (view === 'wide') {
      // follow Manny: a few steps behind and to the side, looking past him toward where he is going
      // stand behind Manny and a little to the side, looking past him at what he is heading for
      fwd.set(mannyFocus.x - mannyWorld.x, 0, mannyFocus.z - mannyWorld.z);
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      want.set(mannyWorld.x - fwd.x * 5.4 - fwd.z * 1.8 + look.x * 0.8, mannyWorld.y + 2.4 - look.y * 0.35, mannyWorld.z - fwd.z * 5.4 + fwd.x * 1.8);
      wantLook.set(mannyWorld.x + fwd.x * 3.2 + look.x * 0.25, mannyWorld.y + 1.1 - look.y * 0.12, mannyWorld.z + fwd.z * 3.2);
    } else {
      want.set(v.pos[0] + look.x * 0.8, v.pos[1] - look.y * 0.35, v.pos[2]);
      wantLook.copy(v.look).add(fwd.set(look.x * 0.25, -look.y * 0.12, 0));
    }
    camera.position.lerp(want, k);
    target.lerp(wantLook, k);
    camera.lookAt(target);
    camera.getWorldDirection(fwd);
    surfaceView.heading = ((THREE.MathUtils.radToDeg(Math.atan2(fwd.x, -fwd.z)) % 360) + 360) % 360;

    // temperature question: swing the sun between harsh light and shadow
    if (sun.current) {
      const wantShadow = question === 'temp' ? 1 : 0;
      const t = state_sunT.value = THREE.MathUtils.lerp(state_sunT.value, wantShadow, 1 - Math.pow(0.05, dt));
      const elev = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(34, 4, t));
      const az = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(40, 130, t));
      const r = 60;
      sun.current.position.set(
        Math.cos(elev) * Math.cos(az) * r,
        Math.sin(elev) * r,
        Math.cos(elev) * Math.sin(az) * r,
      );
      sun.current.intensity = THREE.MathUtils.lerp(3.2, 0.35, t);
    }
  });

  return (
    <>
      <directionalLight
        ref={sun}
        position={[40, 34, 50]}
        intensity={3.2}
        color="#fff3df"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-far={220}
      />
      <ambientLight intensity={0.16} color="#39404d" />
      <hemisphereLight intensity={0.12} color="#cdd6e0" groundColor="#141210" />
    </>
  );
}

const state_sunT = { value: 0 };

/* ---------- AR path: glowing chevrons the glasses draw on the ground, from Manny toward the next machine ---------- */

function GroundPath({ from, to, hidden }: { from: THREE.Vector3; to: THREE.Vector3; hidden: boolean }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-0.22, 0.34); s.lineTo(0.12, 0); s.lineTo(-0.22, -0.34);
    s.lineTo(-0.06, -0.34); s.lineTo(0.28, 0); s.lineTo(-0.06, 0.34); s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2); // lie flat, pointing +X
    return g;
  }, []);
  const steps = useMemo(() => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const out: { p: [number, number, number]; yaw: number }[] = [];
    for (let d = 1.6; d < len - 2.4; d += 0.95) {
      const x = from.x + (dx / len) * d;
      const z = from.z + (dz / len) * d;
      out.push({ p: [x, terrainHeight(x, z) + 0.04, z], yaw });
    }
    return out;
  }, [from, to]);
  const mats = useMemo(() => steps.map(() => new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0, toneMapped: false, depthWrite: false })), [steps]);
  const fade = useRef(0);

  useFrame((state, dt) => {
    fade.current += ((hidden ? 0 : 1) - fade.current) * (1 - Math.pow(0.02, dt));
    const t = state.clock.elapsedTime;
    mats.forEach((m, i) => {
      // a pulse runs along the path toward the machine
      const wave = Math.pow(Math.max(0, Math.sin(t * 2.6 - i * 0.55)), 3);
      m.opacity = fade.current * (0.22 + 0.78 * wave);
    });
  });

  return (
    <group>
      {steps.map((s, i) => (
        <mesh key={i} geometry={geo} material={mats[i]} position={s.p} rotation-y={s.yaw} />
      ))}
    </group>
  );
}

/* ---------- hotspots ---------- */

/* Smart-glasses mark on a real object: corner brackets around it and its name beneath. Tap the object itself. No buttons. */
function Hotspot({ position, label, onClick, hidden, size = 3.2, lift = 1.2 }: { position: THREE.Vector3; label: string; onClick: () => void; hidden?: boolean; size?: number; lift?: number }) {
  if (hidden) return null;
  return (
    <Html position={[position.x, position.y + lift, position.z]} center distanceFactor={10} zIndexRange={[20, 0]}>
      <div
        className="obj-mark"
        role="link"
        tabIndex={0}
        aria-label={label}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
        style={{ width: `${size * 40}px`, height: `${size * 40}px` }}
      >
        <span className="obj-mark-label">{label}</span>
      </div>
    </Html>
  );
}

/* ---------- scene ---------- */

export default function SurfaceScene() {
  const setView = useLoom((s) => s.setView);
  const view = useLoom((s) => s.view);
  const question = useLoom((s) => s.question);
  const hideHotspots = useLoom((s) => s.question !== null || s.quakeOpen);

  return (
    <>
      <SurfaceRig />
      <StarsFar />
      <Terrain />
      <Suspense fallback={<Lander />}>
        <DescentStage position={[LANDER.x, terrainHeight(LANDER.x, LANDER.z), LANDER.z]} rotationY={-0.5} />
      </Suspense>
      <Seismometer />
      <Retroreflector />
      <LaserLink from={EARTH_POS} />
      {/* Manny in 3D (Meshy, from Natalie's drawings), walking his own route */}
      <Suspense fallback={null}>
        <Manny3D
          groundY={terrainHeight}
          listenTo={[GINNY.x, GINNY.y, GINNY.z]}
          route={[
            { at: [MANNY.x, 0, MANNY.z], face: [GINNY.x, 0, GINNY.z], wait: 2.5 },
            { at: [LANDER_STOP.x, 0, LANDER_STOP.z], face: [LANDER.x, 0, LANDER.z], wait: 5 },
            { at: [RETRO.x + 0.9, 0, RETRO.z + 1.1], face: [RETRO.x, 0, RETRO.z], wait: 4 },
            { at: [SEISMO.x + 1.2, 0, SEISMO.z + 1.3], face: [SEISMO.x, 0, SEISMO.z], wait: 4 },
          ]}
        />
      </Suspense>
      <Ginny />
      <EarthSky />
      {/* NASA physics: a landing blast throws dust out flat, fast and straight (no wind on the Moon) */}
      <DustEjecta active={question === 'dust'} origin={[LANDER.x, terrainHeight(LANDER.x, LANDER.z), LANDER.z]} groundY={terrainHeight} />
      <GroundPath from={MANNY} to={LANDER_STOP.clone().add(new THREE.Vector3(-0.8, 0, 0.6))} hidden={hideHotspots || view !== 'wide'} />
      <Hotspot
        position={LANDER.clone().setY(terrainHeight(LANDER.x, LANDER.z))}
        label="Eagle descent stage · still here"
        hidden={hideHotspots}
        size={6.5}
        lift={3.2}
        onClick={() => { setView('lander'); useLoom.getState().ask('gold'); }}
      />
      <Hotspot
        position={SEISMO.clone().setY(terrainHeight(SEISMO.x, SEISMO.z))}
        label="Passive Seismic Experiment · left behind"
        hidden={hideHotspots}
        size={1.9}
        lift={0.45}
        onClick={() => { setView('seismo'); useLoom.getState().openQuake(true); }}
      />
      <Hotspot
        position={RETRO.clone().setY(terrainHeight(RETRO.x, RETRO.z))}
        label="Laser Ranging Retroreflector · still working"
        hidden={hideHotspots}
        size={1.4}
        lift={0.4}
        onClick={() => { setView('laser'); useLoom.getState().ask('laser'); }}
      />
      {view === 'ice' && null}
    </>
  );
}

function StarsFar() {
  const geo = useMemo(() => {
    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.9 + 0.05;
      v.multiplyScalar(340);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  return (
    <points geometry={geo}>
      <pointsMaterial size={1.1} sizeAttenuation color="#fff" transparent opacity={0.75} depthWrite={false} />
    </points>
  );
}
