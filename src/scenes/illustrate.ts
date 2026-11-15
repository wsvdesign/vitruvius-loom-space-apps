import * as THREE from 'three';

/* Manny should read as Natalie's illustration with a little depth, not a realistic 3D figure:
   - toon shading: 3 soft tones instead of smooth photographic light
   - a fine ink outline drawn around him (inverted hull that follows the skeleton)
   - slightly warm, desaturated colour, like pencil and wash on paper */

let gradient: THREE.DataTexture | null = null;
function toonRamp() {
  if (!gradient) {
    const tones = new Uint8Array([120, 120, 120, 255, 196, 196, 196, 255, 255, 255, 255, 255]);
    gradient = new THREE.DataTexture(tones, 3, 1, THREE.RGBAFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

function inkMaterial(thickness: number) {
  const m = new THREE.MeshBasicMaterial({ color: '#2b1f17', side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n#ifdef USE_SKINNING\n  transformed += normalize(objectNormal) * ${thickness.toFixed(4)};\n#endif`,
    );
  };
  return m;
}

/**
 * Apply the illustrated look to a (skinned) model in place. The ink line is `thicknessRatio` of the
 * figure's height (0.006 of 1.45 m ≈ 9 mm).
 */
export function illustrate(root: THREE.Object3D, thicknessRatio = 0.006) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.ink) meshes.push(o as THREE.Mesh); });
  for (const mesh of meshes) {
    const src = mesh.material as THREE.MeshStandardMaterial;
    const toon = new THREE.MeshToonMaterial({
      map: src.map ?? null,
      color: new THREE.Color('#f3e6d6'), // warm paper tint over the drawing's colours
      gradientMap: toonRamp(),
    });
    mesh.material = toon;
    mesh.castShadow = true;
    mesh.receiveShadow = false;

    const skinned = mesh as THREE.SkinnedMesh;
    const hasInk = mesh.parent?.children.some((c) => c.userData.ink && (c as THREE.Mesh).geometry === mesh.geometry);
    if (skinned.isSkinnedMesh && mesh.parent && !hasInk) {
      // outline thickness from the mesh's own size, so it is right whatever units the file uses
      skinned.geometry.computeBoundingBox();
      const gb = skinned.geometry.boundingBox!;
      const height = Math.max(gb.max.y - gb.min.y, gb.max.z - gb.min.z, 1e-6);
      const ink = new THREE.SkinnedMesh(skinned.geometry, inkMaterial(height * thicknessRatio));
      ink.bind(skinned.skeleton, skinned.bindMatrix);
      ink.bindMode = skinned.bindMode;
      ink.position.copy(skinned.position);
      ink.quaternion.copy(skinned.quaternion);
      ink.scale.copy(skinned.scale);
      ink.frustumCulled = false;
      ink.userData.ink = true;
      mesh.parent.add(ink);
    }
  }
  return root;
}
