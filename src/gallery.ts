// Dev-only model viewer: /gallery.html?set=units|buildings|nature  (used for the README screenshots)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadAssets } from './render/assets';

const set = new URLSearchParams(location.search).get('set') ?? 'units';
const LAYOUT: Record<string, { rows: string[][]; gap: number; title: string; cam: [number, number, number]; look: [number, number, number] }> = {
  units: { title: 'Unit · Jawa (atas) dan Sunda (bawah): petani, prajurit, pemanah, kendaraan tempur, hero Punakawan', gap: 2.5, cam: [0, 5.4, 7.1], look: [0, 0.6, 0],
    rows: [['warga', 'prajurit', 'pemanah', 'siege', 'hero'].map((r) => r + '_jawa'), ['warga', 'prajurit', 'pemanah', 'siege', 'hero'].map((r) => r + '_sunda')] },
  buildings: { title: 'Bangunan · Jawa (atas) dan Sunda (bawah): markas, rumah, barak, reaktor nuklir', gap: 6.4, cam: [0, 15, 17], look: [0, 0.8, 0],
    rows: [['tc', 'house', 'barracks', 'reactor'].map((r) => r + '_jawa'), ['tc', 'house', 'barracks', 'reactor'].map((r) => r + '_sunda')] },
  nature: { title: 'Alam dan sumber daya: pohon, bambu, sawah, tambang emas, batu, candi, rudal atom', gap: 3.8, cam: [0, 7.5, 9], look: [0, 0.8, 0],
    rows: [['tree_jati', 'tree_palm', 'tree_pine', 'bamboo_clump', 'rice_patch'], ['goldmine', 'rock_big', 'candi', 'rudal_atom']] },
};
const L = LAYOUT[set];
document.getElementById('cap')!.textContent = L.title;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x182c3a);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.5;
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x6b5436, 1.1));
const sun = new THREE.DirectionalLight(0xfff0d0, 3.2); sun.position.set(-8, 14, 9); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 16, bottom: -16, near: 1, far: 60 }); sun.shadow.bias = -0.0004; scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), new THREE.MeshStandardMaterial({ color: 0x4d7a3a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const assets = await loadAssets(() => {}, 8);
L.rows.forEach((row, ri) => row.forEach((name, ci) => {
  const m = assets.models.get(name)!.clone(true);
  m.position.set((ci - (row.length - 1) / 2) * L.gap, 0, (ri - (L.rows.length - 1) / 2) * L.gap * (set === 'buildings' ? 1.05 : 1));
  if (name.startsWith('rudal')) { m.rotation.z = 0; m.scale.setScalar(1.1); }
  if (name === 'candi') m.scale.setScalar(0.8);
  scene.add(m);
}));
const cam = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 200);
cam.position.set(...L.cam); cam.lookAt(...L.look);
renderer.render(scene, cam);
(window as any).__ready = true;
