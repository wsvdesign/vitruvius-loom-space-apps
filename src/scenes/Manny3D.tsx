import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { useLoom } from '../state';
import { illustrate } from './illustrate';

/* Manny in 3D: built with Meshy from Natalie's own drawings (front, side, back, other side),
   rigged with a walking cycle. Nobody steers him — he walks a scripted route on his own:
   he listens to Ginny first, then follows the glowing path to the lander, visits the
   seismometer, and comes back. When a question is open he stops and turns to you. */

const URL = './models/manny/manny-multi-walking.glb';
useGLTF.preload(URL);

type V3 = [number, number, number];
export interface MannyStop { at: V3; face: V3; wait: number }

const SPEED = 0.85; // m/s, an easy walk for a 1.45 m kid

/** where Manny is right now, for the camera to follow */
export const mannyWorld = new THREE.Vector3(-2.6, 0, 2.8);
/** what Manny is heading for or looking at: the camera looks past him toward it */
export const mannyFocus = new THREE.Vector3(8.5, 0, -4.5);

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export default function Manny3D({ route, groundY, listenTo }: { route: MannyStop[]; groundY: (x: number, z: number) => number; listenTo: V3 }) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(URL);
  const { actions, names } = useAnimations(animations, group);
  const beat = useLoom((s) => s.beat);
  const busy = useLoom((s) => s.question !== null || s.quakeOpen);
  const st = useRef({
    pos: new THREE.Vector3(route[0].at[0], 0, route[0].at[2]),
    yaw: 0,
    targetYaw: 0,
    leg: 0, // heading for route[leg + 1]
    wait: 1.5,
    walking: false,
  });

  useEffect(() => {
    if (!scene.userData.illustrated) {
      illustrate(scene); // Natalie's illustration with a little depth, not a realistic figure
      scene.userData.illustrated = true;
    }
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.frustumCulled = false; // skinned bounds don't follow the walk
    });
  }, [scene]);

  const tmp = useRef(new THREE.Vector3());

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const s = st.current;
    const g = group.current;
    const walk = actions[names[0]];
    if (!g || !walk) return;
    let moving = false;
    const face = (p: V3 | THREE.Vector3) => {
      const x = Array.isArray(p) ? p[0] : p.x;
      const z = Array.isArray(p) ? p[2] : p.z;
      s.targetYaw = Math.atan2(x - s.pos.x, z - s.pos.z);
    };

    if (beat >= 0) {
      face(listenTo); // Ginny is talking: he listens
      mannyFocus.set(route[1].face[0], 0, route[1].face[2]); // the camera shows what she is talking about
    } else if (busy) {
      face(state.camera.position); // a question is open: he turns to you
    } else if (s.wait > 0) {
      s.wait -= dt;
      const here = route[s.leg % route.length];
      face(here.face);
      mannyFocus.set(here.face[0], 0, here.face[2]);
    } else {
      const next = route[(s.leg + 1) % route.length];
      mannyFocus.set(next.face[0], 0, next.face[2]);
      const d = tmp.current.set(next.at[0] - s.pos.x, 0, next.at[2] - s.pos.z);
      const dist = d.length();
      if (dist < 0.06) {
        s.leg = (s.leg + 1) % route.length;
        s.wait = next.wait;
      } else {
        d.normalize();
        s.pos.addScaledVector(d, Math.min(dist, SPEED * dt));
        s.targetYaw = Math.atan2(d.x, d.z);
        moving = true;
      }
    }

    if (moving !== s.walking) {
      s.walking = moving;
      if (moving) walk.reset().fadeIn(0.3).play();
      else walk.fadeOut(0.4);
    }
    s.yaw += wrap(s.targetYaw - s.yaw) * (1 - Math.pow(0.002, dt));
    g.position.set(s.pos.x, groundY(s.pos.x, s.pos.z), s.pos.z);
    g.rotation.y = s.yaw;
    mannyWorld.copy(g.position);
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}
