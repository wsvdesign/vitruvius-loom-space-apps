import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

/* Official NASA 3D models (NASA 3D Resources, free to use under the NASA media usage guidelines):
   - Apollo Lunar Module — NASA/Michael D. Carbajal
   - Ingenuity Mars Helicopter — NASA/Brian E. Kumanchik
   Both are Draco-compressed; the decoder is served locally from /decoders/draco/. */

const DRACO = './decoders/draco/';
const LM_URL = './models/nasa/apollo-lunar-module.glb';
const ING_URL = './models/nasa/ingenuity.glb';
useGLTF.preload(LM_URL, DRACO);
useGLTF.preload(ING_URL, DRACO);

/** Apply each node's pose from the file's animation at t = 0 (this model keeps transforms in its clips). */
function applyFirstFrame(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
  if (!clips.length) return;
  const mixer = new THREE.AnimationMixer(root);
  for (const c of clips) mixer.clipAction(c).play();
  mixer.setTime(0);
  mixer.stopAllAction();
}

/**
 * The descent stage of the Lunar Module Eagle — the part that stayed at Tranquility Base.
 * The NASA model is the full LM; the ascent stage (everything above the descent stage) is hidden,
 * because it lifted off on July 21, 1969. Scaled to the real LM height (about 7 m with the ascent stage).
 */
export function DescentStage({ position, rotationY = 0 }: { position: [number, number, number]; rotationY?: number }) {
  const { scene, animations } = useGLTF(LM_URL, DRACO);
  const model = useMemo(() => {
    const m = scene.clone(true);
    applyFirstFrame(m, animations);
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    const s = 7.0 / Math.max(size.y, 1e-6);
    m.scale.setScalar(s);
    m.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(m);
    // sit the footpads on the ground, centred
    const c = b2.getCenter(new THREE.Vector3());
    m.position.set(-c.x, -b2.min.y, -c.z);
    m.updateMatrixWorld(true);
    // hide the ascent stage: meshes whose centre sits above the top of the descent stage (~3.3 m)
    const groundY = b2.min.y;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mb = new THREE.Box3().setFromObject(mesh);
      const centreY = (mb.min.y + mb.max.y) / 2 - groundY;
      if (centreY > 3.3) mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return m;
  }, [scene, animations]);
  return (
    <group position={position} rotation-y={rotationY}>
      <primitive object={model} />
    </group>
  );
}

/** Ginny: NASA's Ingenuity model (real size, ~1.2 m rotors), counter-rotating rotors, hovering. */
export function IngenuityModel() {
  const { scene } = useGLTF(ING_URL, DRACO);
  const model = useMemo(() => {
    const m = scene.clone(true);
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    // Ingenuity is short (0.49 m) and wide (1.2 m rotors): its shortest side is "up", whatever the file says
    const up = size.x <= size.y && size.x <= size.z ? 'x' : size.z <= size.y ? 'z' : 'y';
    if (up === 'z') m.rotation.x = -Math.PI / 2;
    if (up === 'x') m.rotation.z = Math.PI / 2;
    m.userData.spinAxis = up;
    const span = Math.max(...(['x', 'y', 'z'] as const).filter((a) => a !== up).map((a) => size[a]));
    m.scale.setScalar(1.2 / Math.max(span, 1e-6)); // rotor diameter about 1.2 m
    m.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(m);
    const c = b2.getCenter(new THREE.Vector3());
    m.position.set(-c.x, -b2.min.y, -c.z);
    m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
    return m;
  }, [scene]);
  const rotors = useRef<THREE.Object3D[]>([]);
  useEffect(() => {
    const r: THREE.Object3D[] = [];
    model.traverse((o) => { if (/^rotors_0[12]$/i.test(o.name)) r.push(o); });
    rotors.current = r;
  }, [model]);
  useFrame((_, dt) => {
    const axis = (model.userData.spinAxis as 'x' | 'y' | 'z') || 'y';
    rotors.current.forEach((r, i) => { r.rotation[axis] += (i === 0 ? 1 : -1) * dt * 42; });
  });
  return <primitive object={model} />;
}
