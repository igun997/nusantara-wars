import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_NAMES = [
  'warga_jawa', 'warga_sunda', 'prajurit_jawa', 'prajurit_sunda', 'pemanah_jawa', 'pemanah_sunda', 'siege_jawa', 'siege_sunda', 'hero_jawa', 'hero_sunda',
  'tc_jawa', 'tc_sunda', 'house_jawa', 'house_sunda', 'barracks_jawa', 'barracks_sunda', 'reactor_jawa', 'reactor_sunda',
  'tree_jati', 'tree_palm', 'tree_pine', 'bamboo_clump', 'rock_big', 'rice_patch', 'goldmine', 'rudal_atom', 'candi',
];
export const TERRAIN_TEX = ['grass', 'dirt', 'sand', 'rock', 'forest', 'paddy'];

export interface Assets {
  models: Map<string, THREE.Group>;
  tex: Map<string, THREE.Texture>;
  indonesia?: { scene: THREE.Group; animations: THREE.AnimationClip[] };
}

export async function loadAssets(onProgress: (p: number, label: string) => void, maxAniso = 8): Promise<Assets> {
  const gl = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  const models = new Map<string, THREE.Group>();
  const tex = new Map<string, THREE.Texture>();
  const total = MODEL_NAMES.length + TERRAIN_TEX.length + 1;
  let done = 0;
  const tick = (label: string) => { done++; onProgress(done / total, label); };
  const aniso = Math.min(8, maxAniso);
  await Promise.all([
    ...TERRAIN_TEX.map((n) => texLoader.loadAsync(`/assets/textures/${n}.png`).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.generateMipmaps = true;
      tex.set(n, t); tick(n);
    })),
    ...MODEL_NAMES.map((n) => gl.loadAsync(`/assets/models/${n}.glb`).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = m.receiveShadow = true;
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.map) mat.map.anisotropy = aniso;
          mat.envMapIntensity = 0.6;
        }
      });
      models.set(n, g.scene); tick(n);
    })),
  ]);
  const indonesia = await gl.loadAsync('/assets/models/indonesia-map.glb').then((g) => ({ scene: g.scene, animations: g.animations })).catch(() => undefined);
  tick('peta');
  return { models, tex, indonesia };
}
