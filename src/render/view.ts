import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { World, DT, type Building, type GameEvent, type Resource, type Unit } from '../sim/world';
import { N } from '../sim/map';
import { NUKE } from '../data/game';
import type { Assets } from './assets';
import { Terrain } from './terrain';
import { FxHub } from '../fx/hub';
import { DangerZones, MissileFx, NukeFx, type GradeState } from '../fx/nuke';

// ------------------------------------------------------------------ instanced model pools
class InstGroup {
  parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = [];
  count = 0;
  private tmp = new THREE.Matrix4();
  constructor(model: THREE.Object3D, cap: number, parent: THREE.Object3D) {
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const im = new THREE.InstancedMesh(m.geometry, m.material, cap);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(im);
      this.parts.push({ mesh: im, local: m.matrixWorld.clone() });
    });
  }
  begin() { this.count = 0; }
  add(m: THREE.Matrix4) {
    for (const p of this.parts) {
      if (this.count >= p.mesh.instanceMatrix.count) return;
      this.tmp.multiplyMatrices(m, p.local); p.mesh.setMatrixAt(this.count, this.tmp);
    }
    this.count++;
  }
  end() { for (const p of this.parts) { p.mesh.count = this.count; p.mesh.instanceMatrix.needsUpdate = true; } }
}

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uFlash: { value: 0 }, uVig: { value: 0.32 }, uTint: { value: 0 }, uWarn: { value: 0 }, uSat: { value: 1.1 }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uFlash, uVig, uTint, uWarn, uSat, uTime; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col = mix(col, col * vec3(1.18, 0.82, 0.55) + vec3(0.03, 0.012, 0.0), uTint);
      float v = smoothstep(0.25, 0.85, length(c) * 1.25);
      col *= 1.0 - v * uVig;
      col += vec3(1.0, 0.1, 0.05) * uWarn * v * (0.55 + 0.45 * sin(uTime * 6.0));
      col += vec3(1.0, 0.95, 0.85) * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const hash = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
const BUILD_H: Record<string, number> = { tc: 4.4, house: 2.0, barracks: 2.9, reactor: 3.9 };
const UNIT_H: Record<string, number> = { warga: 1.5, prajurit: 1.65, pemanah: 1.5, siege: 1.6, hero: 1.8 };

export interface Projectile { mesh: THREE.Mesh; fx: number; fz: number; tx: number; tz: number; fy: number; ty: number; t: number; T: number; arc: number; kind: string }
interface Ghost { model: string; x: number; y: number; z: number; rot: number; scale: number; t: number; T: number; kind: 'unit' | 'building'; sx: number }

export class GameView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  gradePass: ShaderPass;
  grade: GradeState = { flash: 0, warn: 0, tint: 0, bloomBoost: 0, shake: 0 };
  terrain: Terrain;
  hub = new FxHub();
  nukeFx: NukeFx; missileFx: MissileFx; zones: DangerZones;
  // camera rig
  rig = { x: 22, z: 22, yaw: -2.356, dist: 34, gx: 22, gz: 22, gyaw: -2.356, gdist: 34 };
  private cine: { t: number; x: number; z: number; back: { gx: number; gz: number; gdist: number; gyaw: number }; blend: number } | null = null;
  private sun: THREE.DirectionalLight;
  private sunOff = new THREE.Vector3(-34, 58, 26);
  private pools = new Map<string, InstGroup>();
  private staticRoot = new THREE.Group();
  private dynRoot = new THREE.Group();
  private resDirty = true; private resTimer = 0;
  private ghosts: Ghost[] = [];
  private projectiles: Projectile[] = [];
  private projPool: THREE.Mesh[] = [];
  private unitView = new Map<number, { face: number; phase: number }>();
  private rings: THREE.InstancedMesh; private selRings: THREE.InstancedMesh; private hpBg: THREE.InstancedMesh; private hpFg: THREE.InstancedMesh;
  private pings: { mesh: THREE.Mesh; t: number }[] = [];
  private ghostBuild: { group: THREE.Group; foot: THREE.Mesh; model: string } | null = null;
  selection = new Set<number>();
  cinematicEnabled = true;
  private cullR2 = 1e9; private cullX = 0; private cullZ = 0;
  quality: 'auto' | 'low' | 'high' = 'auto';
  private resScale = 1; private ema = 1 / 60; private qTimer = 0; private qLevel = 0;
  private near(x: number, z: number, pad = 0) { const dx = x - this.cullX, dz = z - this.cullZ; return dx * dx + dz * dz < this.cullR2 + pad; }
  time = 0; private accum = 0;
  private tmpM = new THREE.Matrix4(); private tmpO = new THREE.Object3D(); private tmpC = new THREE.Color();
  private tmpQ = new THREE.Quaternion(); private tmpV = new THREE.Vector3(); private tmpV2 = new THREE.Vector3();
  private buildingBurn = new Map<number, number>();
  decorLive: { model: string; x: number; y: number; rot: number; scale: number }[];
  readonly width: () => number; readonly height: () => number;
  onResizeHooks: (() => void)[] = [];

  constructor(public canvasHost: HTMLElement, public world: World, public assets: Assets, renderer?: THREE.WebGLRenderer) {
    this.renderer = renderer ?? new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    r.setSize(canvasHost.clientWidth, canvasHost.clientHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    canvasHost.appendChild(r.domElement);
    this.width = () => canvasHost.clientWidth; this.height = () => canvasHost.clientHeight;

    this.camera = new THREE.PerspectiveCamera(42, this.width() / this.height(), 0.5, 600);
    // ---- environment / lights / sky ----
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environmentIntensity = 0.38;
    this.scene.fog = new THREE.Fog(0xb9d2e6, 80, 250);
    this.scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x5b4a36, 0.85));
    this.sun = new THREE.DirectionalLight(0xfff0d2, 3.1);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 5; sc.far = 220;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.makeSky());

    // ---- terrain ----
    this.terrain = new Terrain(world.map, assets.tex, this.sunOff);
    this.terrain.setBurnt(world.burnt);
    this.scene.add(this.terrain.mesh, this.terrain.water, this.staticRoot, this.dynRoot, this.hub.group);

    // ---- model pools ----
    const cap = (n: string) => (n.startsWith('tree') ? 2600 : n.startsWith('rock') || n.startsWith('bamboo') ? 500 : n.startsWith('warga') ? 260 : n.startsWith('tc') || n.startsWith('reactor') || n.startsWith('barracks') || n.startsWith('house') ? 60 : 300);
    for (const [name, model] of assets.models) { if (name === 'rudal_atom') continue; this.pools.set(name, new InstGroup(model, cap(name), this.dynRoot)); }
    this.decorLive = world.map.decor.map((d) => ({ ...d, y: 0 }));

    // ---- helper instanced meshes ----
    const ringGeo = new THREE.RingGeometry(0.82, 1, 28); ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.rings = new THREE.InstancedMesh(ringGeo, ringMat, 900); this.rings.frustumCulled = false; this.rings.count = 0; this.rings.renderOrder = 5;
    const selMat = new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.selRings = new THREE.InstancedMesh(ringGeo, selMat, 400); this.selRings.frustumCulled = false; this.selRings.count = 0; this.selRings.renderOrder = 6;
    const bar = new THREE.PlaneGeometry(1, 1);
    this.hpBg = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: 0x120c08, transparent: true, opacity: 0.82, depthWrite: false, toneMapped: false }), 700);
    this.hpFg = new THREE.InstancedMesh(bar, new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, toneMapped: false }), 700);
    for (const m of [this.hpBg, this.hpFg]) { m.frustumCulled = false; m.count = 0; m.renderOrder = 20; (m.material as THREE.Material).depthTest = false; }
    this.hpFg.renderOrder = 21;
    this.hpFg.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(700 * 3), 3);
    this.scene.add(this.rings, this.selRings, this.hpBg, this.hpFg);

    // ---- nuke fx ----
    const mkMissile = () => (assets.models.get('rudal_atom')!).clone(true);
    this.nukeFx = new NukeFx(this.hub, (x, z) => world.heightAt(x, z), this.grade);
    this.missileFx = new MissileFx(this.hub, mkMissile, (x, z) => world.heightAt(x, z));
    this.zones = new DangerZones((x, z) => world.heightAt(x, z));
    this.scene.add(this.nukeFx.group, this.missileFx.group, this.zones.group);

    // ---- post ----
    const rt = new THREE.WebGLRenderTarget(this.width(), this.height(), { type: THREE.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width() >> 1, this.height() >> 1), 0.28, 0.55, 0.9);
    { const orig = this.bloom.setSize.bind(this.bloom); this.bloom.setSize = (w: number, h: number) => orig(Math.max(1, w >> 1), Math.max(1, h >> 1)); }
    this.composer.addPass(this.bloom);
    this.gradePass = new ShaderPass(GRADE);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());
    addEventListener('resize', this.resize);
    this.buildStatic();
  }

  dispose() {
    removeEventListener('resize', this.resize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
  resize = () => {
    const w = this.width(), h = this.height();
    this.renderer.setSize(w, h); this.composer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.onResizeHooks.forEach((f) => f());
  };

  private makeSky() {
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: this.sunOff.clone().normalize() } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vD; uniform vec3 uSun;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 9371.7); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec3 d = normalize(vD);
          float t = clamp(d.y, 0.0, 1.0);
          vec3 hor = vec3(0.73, 0.84, 0.93), top = vec3(0.16, 0.38, 0.74);
          vec3 col = mix(hor, top, pow(t, 0.55));
          float s = max(dot(d, normalize(uSun)), 0.0);
          col += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 3.0 + pow(s, 14.0) * 0.28);
          vec2 cp = d.xz / (d.y + 0.25) * 1.6;
          float cl = smoothstep(0.55, 0.85, vn(cp * 1.7) * 0.6 + vn(cp * 4.0) * 0.3 + vn(cp * 9.0) * 0.1) * smoothstep(0.02, 0.25, d.y);
          col = mix(col, vec3(1.0), cl * 0.75);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), m);
    sky.renderOrder = -10; sky.frustumCulled = false;
    return sky;
  }

  // ------------------------------------------------------------------ static scenery (resources + decor)
  private buildStatic() { this.resDirty = true; }
  private rebuildStatic() {
    const w = this.world, dummy = this.tmpO;
    for (const p of this.pools.values()) p.begin();
    for (const r of w.resources) {
      if (r.dead) continue;
      const p = this.pools.get(r.model); if (!p) continue;
      const h = w.heightAt(r.x, r.y);
      dummy.position.set(r.x, h - 0.02, r.y);
      dummy.rotation.set(0, hash(r.id) * 6.28, 0);
      let s = r.resKind === 'tree' ? 0.85 + hash(r.id + 7) * 0.5 : r.resKind === 'gold' ? 0.75 + 0.35 * (r.amount / r.max) : 0.9;
      if (r.resKind === 'paddy') { dummy.rotation.y = 0; }
      dummy.scale.setScalar(s); dummy.updateMatrix();
      p.add(dummy.matrix);
    }
    for (const d of this.decorLive) {
      const p = this.pools.get(d.model); if (!p) continue;
      dummy.position.set(d.x, w.heightAt(d.x, d.y) - 0.05, d.y);
      dummy.rotation.set(0, d.rot, 0); dummy.scale.setScalar(d.scale); dummy.updateMatrix(); p.add(dummy.matrix);
    }
    this.staticCounts = new Map(); for (const [n, p] of this.pools) this.staticCounts.set(n, p.count);
  }
  private staticCounts = new Map<string, number>();

  // ------------------------------------------------------------------ camera
  focus(x: number, z: number) { this.rig.gx = this.rig.x = x; this.rig.gz = this.rig.z = z; }
  pan(dx: number, dz: number) { this.rig.gx = Math.min(N - 4, Math.max(4, this.rig.gx + dx)); this.rig.gz = Math.min(N - 4, Math.max(4, this.rig.gz + dz)); }
  private updateCamera(dt: number) {
    const r = this.rig, k = 1 - Math.pow(0.0015, dt);
    r.x += (r.gx - r.x) * k; r.z += (r.gz - r.z) * k; r.yaw += (r.gyaw - r.yaw) * k; r.dist += (r.gdist - r.dist) * k;
    const zt = (r.dist - 14) / 66;
    let pitch = 0.82 + zt * 0.38;
    if (this.cine) {
      const c = this.cine; c.t += dt;
      const target = c.t < 11 ? 1 : 0;
      c.blend += (target - c.blend) * Math.min(1, dt * 1.6);
      if (c.t < 11) { r.gx = c.x; r.gz = c.z; r.gdist = 98; r.gyaw += dt * 0.05; }
      else if (c.blend < 0.02) { Object.assign(r, c.back); this.cine = null; }
      else { r.gx = c.back.gx; r.gz = c.back.gz; r.gdist = c.back.gdist; r.gyaw = c.back.gyaw; }
      pitch = pitch + (0.34 - pitch) * c.blend;
    }
    const cp = Math.cos(pitch);
    const ty = this.world.heightAt(r.x, r.z);
    const lift = this.cine ? this.cine.blend * 13 : 0;
    this.camera.position.set(r.x + Math.sin(r.yaw) * cp * r.dist, ty + Math.sin(pitch) * r.dist + lift * 0.6, r.z + Math.cos(r.yaw) * cp * r.dist);
    this.camera.lookAt(r.x, ty + lift, r.z);
    if (this.grade.shake > 0.001) {
      const s = this.grade.shake;
      this.camera.position.x += (Math.random() - 0.5) * s * 0.9; this.camera.position.y += (Math.random() - 0.5) * s * 0.9; this.camera.position.z += (Math.random() - 0.5) * s * 0.9;
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.012;
    }
    this.camera.updateMatrixWorld();
    // sun follows view (snapped to avoid shadow shimmer)
    const sx = Math.round(r.x / 2) * 2, sz = Math.round(r.z / 2) * 2;
    this.sun.target.position.set(sx, 0, sz); this.sun.position.set(sx + this.sunOff.x, this.sunOff.y, sz + this.sunOff.z);
  }
  /** Pull the camera back and low to show a detonation; cancels on any input. */
  startCinematic(x: number, z: number) {
    if (this.cine) { this.cine.x = x; this.cine.z = z; this.cine.t = 0; return; }
    const r = this.rig;
    this.cine = { t: 0, x, z, back: { gx: r.gx, gz: r.gz, gdist: r.gdist, gyaw: r.gyaw }, blend: 0 };
  }
  stopCinematic() { if (this.cine) this.cine.t = Math.max(this.cine.t, 11); }
  get cinematic() { return !!this.cine && this.cine.t < 11; }

  /** Ground point under screen position (pixels relative to canvas). */
  pickGround(px: number, py: number): THREE.Vector3 | null {
    const ndc = new THREE.Vector2((px / this.width()) * 2 - 1, -(py / this.height()) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    let y = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      const t = (y - ray.ray.origin.y) / ray.ray.direction.y;
      if (t < 0 || !isFinite(t)) return null;
      ray.ray.at(t, p); y = this.world.heightAt(p.x, p.z);
    }
    return p;
  }
  project(x: number, y: number, z: number): { x: number; y: number; on: boolean } {
    this.tmpV.set(x, y, z).project(this.camera);
    return { x: (this.tmpV.x * 0.5 + 0.5) * this.width(), y: (-this.tmpV.y * 0.5 + 0.5) * this.height(), on: this.tmpV.z < 1 && Math.abs(this.tmpV.x) < 1.1 && Math.abs(this.tmpV.y) < 1.1 };
  }
  /** Corners of the visible ground quad (for the minimap). */
  viewQuad(): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (const [fx, fy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const p = this.pickGround(fx * this.width(), fy * this.height());
      pts.push(p ? { x: p.x, y: p.z } : { x: this.rig.x, y: this.rig.z });
    }
    return pts;
  }

  // ------------------------------------------------------------------ events
  ping(x: number, z: number, color = 0x6dff8a, size = 0.9) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 24), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, this.world.heightAt(x, z) + 0.15, z); m.renderOrder = 7;
    this.scene.add(m); this.pings.push({ mesh: m, t: 0 }); (m as any).sz = size;
  }
  private projMesh(kind: string) {
    let m = this.projPool.pop();
    if (!m) m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.55), new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 }));
    if (kind === 'cannon') { m.geometry = new THREE.SphereGeometry(0.2, 10, 8); (m.material as THREE.MeshStandardMaterial).color.set(0x1a1a1a); }
    else { m.geometry = new THREE.BoxGeometry(0.05, 0.05, kind === 'dart' ? 0.35 : 0.6); (m.material as THREE.MeshStandardMaterial).color.set(kind === 'dart' ? 0x7aa84a : 0x6b4a2b); }
    m.castShadow = true;
    return m;
  }
  handleEvents(evs: GameEvent[]) {
    const w = this.world;
    for (const e of evs) {
      switch (e.t) {
        case 'shot': {
          const m = this.projMesh(e.kind); this.scene.add(m);
          const fy = w.heightAt(e.fx, e.fy) + 1.1, ty = w.heightAt(e.tx, e.ty) + 0.8;
          const d = Math.hypot(e.tx - e.fx, e.ty - e.fy);
          const speed = e.kind === 'cannon' ? 16 : 24;
          this.projectiles.push({ mesh: m, fx: e.fx, fz: e.fy, tx: e.tx, tz: e.ty, fy, ty, t: 0, T: Math.max(0.15, d / speed), arc: d * (e.kind === 'cannon' ? 0.22 : 0.12), kind: e.kind });
          if (e.kind === 'cannon') { this.hub.sparks(e.fx, fy + 0.3, e.fy, 10, [3, 2, 0.6], 3); this.hub.puff(e.fx, fy, e.fy, 5, { size0: 0.6, size1: 2 }); }
          break;
        }
        case 'hit': { const y = w.heightAt(e.x, e.y) + (e.big ? 2 : 1); this.hub.sparks(e.x, y, e.y, e.big ? 6 : 3, [3, 1.8, 0.6], 3); if (e.big) this.hub.puff(e.x, y, e.y, 2, { size0: 0.8, size1: 2.2 }); break; }
        case 'death': {
          if (e.owner === -1) { this.resDirty = true; if (e.model.startsWith('tree')) this.hub.puff(e.x, w.heightAt(e.x, e.y) + 0.5, e.y, 4, { c0: [0.3, 0.45, 0.2, 0.6], c1: [0.3, 0.4, 0.2, 0] }); break; }
          const y = w.heightAt(e.x, e.y);
          if (e.unit) {
            const uv = this.unitView.get(e.id);
            this.ghosts.push({ model: e.model, x: e.x, y, z: e.y, rot: Math.PI / 2 - (uv?.face ?? 0), scale: 1, t: 0, T: 0.9, kind: 'unit', sx: 1 });
            this.hub.puff(e.x, y + 0.3, e.y, 5, { size0: 0.5, size1: 1.8 }); this.unitView.delete(e.id);
          } else {
            this.ghosts.push({ model: e.model, x: e.x, y, z: e.y, rot: 0, scale: 1, t: 0, T: 3.2, kind: 'building', sx: e.size });
            for (let k = 0; k < 4; k++) this.hub.explosion(e.x + (Math.random() - 0.5) * e.size * 0.7, y + 1 + Math.random() * 2, e.y + (Math.random() - 0.5) * e.size * 0.7, 1.6);
            for (let k = 0; k < 40; k++) this.hub.smoke.emit({ x: e.x, y: y + 1, z: e.y, vx: (Math.random() - 0.5) * 9, vy: 4 + Math.random() * 9, vz: (Math.random() - 0.5) * 9, life: 1.8 + Math.random(), size0: 0.4, size1: 0.3, grav: 14, drag: 0.2, c0: [0.18, 0.12, 0.08, 1], c1: [0.15, 0.1, 0.07, 0.8], tile: 1 });
            this.buildingBurn.set(e.id, 6);
          }
          break;
        }
        case 'built': { const b = w.get(e.id) as Building | undefined; if (b) { this.hub.puff(b.x, w.heightAt(b.x, b.y) + 0.5, b.y, 16, { spread: b.size, size1: 3 }); this.ping(b.x, b.y, 0xfff0a0, b.size * 0.7); } break; }
        case 'ability': {
          const y = w.heightAt(e.x, e.y);
          this.ping(e.x, e.y, e.kind === 'heal' ? 0x66ff99 : 0xffd84a, 5);
          for (let k = 0; k < 40; k++) { const a = Math.random() * 6.28, r = Math.random() * 5; this.hub.fire.emit({ x: e.x + Math.cos(a) * r, y: y + 0.3, z: e.y + Math.sin(a) * r, vy: 1.5 + Math.random() * 2, life: 1.1, size0: 0.35, size1: 0.1, c0: e.kind === 'heal' ? [0.4, 2.2, 0.8, 1] : [2.4, 1.9, 0.4, 1], c1: [0.2, 0.6, 0.3, 0], tile: 3 }); }
          break;
        }
        case 'epoch': {
          const tc = w.tc(e.owner); if (!tc) break;
          const y = w.heightAt(tc.x, tc.y);
          this.ping(tc.x, tc.y, 0xffd86a, 9); this.ping(tc.x, tc.y, 0xfff2b0, 5);
          for (let k = 0; k < 90; k++) { const a = Math.random() * 6.283, r = Math.random() * 2.4; this.hub.fire.emit({ x: tc.x + Math.cos(a) * r, y: y + 0.5, z: tc.y + Math.sin(a) * r, vy: 4 + Math.random() * 7, vx: Math.cos(a) * 0.6, vz: Math.sin(a) * 0.6, life: 1.6 + Math.random(), size0: 0.5, size1: 0.1, c0: [2.8, 2.0, 0.6, 1], c1: [1.0, 0.5, 0.1, 0], tile: 3, grav: -1 }); }
          break;
        }
        case 'nuke_arm': this.zones.add(e.shot.id, e.shot.tx, e.shot.ty, e.shot.t0, e.shot.impactAt - e.shot.t0); break;
        case 'nuke_launch': this.missileFx.launch(e.shot.id, e.shot.sx, e.shot.sy, e.shot.tx, e.shot.ty, e.shot.launchAt, NUKE.flight); break;
        case 'nuke_cancel': this.zones.remove(e.shot.id); break;
        case 'nuke_hit': {
          this.zones.remove(e.shot.id);
          this.nukeFx.detonate(e.shot.tx, e.shot.ty, w.players[e.shot.owner].tribe.id);
          this.terrain.setBurnt(w.burnt);
          this.decorLive = this.decorLive.filter((d) => Math.hypot(d.x - e.shot.tx, d.y - e.shot.ty) > NUKE.radius * 0.85);
          this.resDirty = true;
          if (this.cinematicEnabled) this.startCinematic(e.shot.tx, e.shot.ty);
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ frame
  frame(dtReal: number, accumulator: number, serverTime: number) {
    this.time += dtReal;
    const w = this.world;
    const alpha = Math.min(1, accumulator / DT);
    this.updateCamera(dtReal);
    this.terrain.update(this.time);
    this.adaptQuality(dtReal);
    { const R = Math.min(125, 30 + this.rig.dist * 0.85); this.cullR2 = R * R; this.cullX = this.rig.x; this.cullZ = this.rig.z; }

    // static scenery
    this.resTimer += dtReal;
    if (this.resDirty || this.resTimer > 1.2) { this.resDirty = false; this.resTimer = 0; this.needStatic = true; }

    // dynamic entities share pools with static ones: rebuild everything in a single pass
    for (const p of this.pools.values()) p.begin();
    this.rebuildStaticInto();
    const o = this.tmpO;
    const camQ = this.camera.quaternion;
    let ringN = 0, selN = 0, hpN = 0;
    const ringM = this.tmpM;

    const addRing = (x: number, z: number, r: number, color: number, sel = false) => {
      const y = w.heightAt(x, z) + 0.07;
      o.position.set(x, y, z); o.rotation.set(0, 0, 0); o.scale.setScalar(r); o.updateMatrix();
      if (sel) { if (selN < 400) this.selRings.setMatrixAt(selN++, o.matrix); }
      else if (ringN < 900) { this.rings.setMatrixAt(ringN, o.matrix); this.rings.setColorAt(ringN, this.tmpC.set(color)); ringN++; }
    };
    const right = this.tmpV2.set(1, 0, 0).applyQuaternion(camQ);
    const addBar = (x: number, y: number, z: number, wd: number, frac: number, col: number, bg = true) => {
      if (hpN >= 700) return;
      o.position.set(x, y, z); o.quaternion.copy(camQ); o.scale.set(wd, 0.14, 1); o.updateMatrix();
      this.hpBg.setMatrixAt(hpN, o.matrix);
      const fw = Math.max(0.001, wd * frac);
      o.position.set(x + right.x * (-(wd - fw) / 2), y + right.y * (-(wd - fw) / 2), z + right.z * (-(wd - fw) / 2));
      o.scale.set(fw * 0.96, 0.1, 1); o.updateMatrix();
      this.hpFg.setMatrixAt(hpN, o.matrix); this.hpFg.setColorAt(hpN, this.tmpC.set(col)); hpN++;
      void bg;
    };
    const hpColor = (f: number) => (f > 0.6 ? 0x56e07a : f > 0.3 ? 0xf2c230 : 0xe5483a);

    // ---- units ----
    for (const u of w.units) {
      if (u.dead || !this.near(u.x, u.y, 200)) continue;
      const pool = this.pools.get(u.def.model); if (!pool) continue;
      const ix = u.prevX + (u.x - u.prevX) * alpha, iy = u.prevY + (u.y - u.prevY) * alpha;
      let uv = this.unitView.get(u.id);
      if (!uv) { uv = { face: u.face, phase: Math.random() * 6 }; this.unitView.set(u.id, uv); }
      let df = u.face - uv.face; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI;
      uv.face += df * Math.min(1, dtReal * 12);
      const moving = u.moving && u.laughUntil <= w.time;
      if (moving) uv.phase += dtReal * u.def.speed * 4.2;
      const h = w.heightAt(ix, iy);
      const bob = moving ? Math.abs(Math.sin(uv.phase)) * (u.def.role === 'siege' ? 0.03 : 0.09) : 0;
      let pitch = moving ? 0.08 : 0, roll = moving ? Math.sin(uv.phase) * 0.06 : 0, fwd = 0, sy = 1;
      if (u.state === 'attack' && u.cd > 0 && !moving) { fwd = u.def.range > 3 ? 0 : Math.sin(Math.min(1, u.swing) * 3.14) * 0.28; pitch = Math.min(1, u.swing) * 0.2; }
      if ((u.state === 'gather' && u.gPhase === 'work') || u.state === 'build') { pitch = 0.35 * Math.sin(this.time * 9 + u.id); sy = 1 + 0.02 * Math.sin(this.time * 9); }
      if (u.laughUntil > w.time) { roll = Math.sin(this.time * 28) * 0.18; sy = 1 + Math.abs(Math.sin(this.time * 14)) * 0.08; }
      if (!moving && u.state === 'idle') sy = 1 + 0.012 * Math.sin(this.time * 2 + u.id);
      o.position.set(ix + Math.sin(Math.PI / 2 - uv.face) * fwd, h + bob, iy + Math.cos(Math.PI / 2 - uv.face) * fwd);
      o.rotation.set(pitch, Math.PI / 2 - uv.face, roll, 'YXZ'); o.scale.set(1, sy, 1); o.updateMatrix();
      pool.add(o.matrix);
      // team ring
      addRing(ix, iy, u.def.radius * 1.35 + 0.1, u.owner === 0 ? 0x2bd9ff : 0xff4a4a);
      const sel = this.selection.has(u.id);
      if (sel) addRing(ix, iy, u.def.radius * 1.9 + 0.2, 0, true);
      if ((sel || u.hp < u.maxHp - 0.5) && u.owner >= 0) addBar(ix, h + (UNIT_H[u.def.role] ?? 1.5) + 0.25, iy, 0.95, u.hp / u.maxHp, hpColor(u.hp / u.maxHp));
      if (u.carry >= 5 && u.carryKind) { /* carried loads shown by HUD */ }
      if (u.poisonUntil > w.time && Math.random() < 0.2) this.hub.fire.emit({ x: ix, y: h + 1.4, z: iy, vy: 0.8, life: 0.7, size0: 0.3, size1: 0.1, c0: [0.3, 1.6, 0.4, 0.8], c1: [0.1, 0.5, 0.2, 0], tile: 3 });
    }
    // ---- buildings ----
    for (const b of w.buildings) {
      if (b.dead) continue;
      const pool = this.pools.get(b.def.model); if (!pool) continue;
      const s = b.size / 2;
      const h = Math.max(w.heightAt(b.fx, b.fy), w.heightAt(b.fx + b.size, b.fy), w.heightAt(b.fx, b.fy + b.size), w.heightAt(b.fx + b.size, b.fy + b.size), w.heightAt(b.x, b.y)) - 0.06;
      const grow = b.built ? 1 : 0.1 + 0.9 * Math.pow(b.progress, 0.8);
      o.position.set(b.x, h, b.y); o.rotation.set(0, 0, 0); o.scale.set(1, grow, 1); o.updateMatrix();
      if (b.flash > 0) { o.position.x += (Math.random() - 0.5) * 0.04; o.updateMatrix(); }
      pool.add(o.matrix);
      addRing(b.x, b.y, s * 1.12 + 0.2, b.owner === 0 ? 0x2bd9ff : 0xff4a4a);
      const sel = this.selection.has(b.id);
      if (sel) addRing(b.x, b.y, s * 1.3 + 0.35, 0, true);
      const bh = (BUILD_H[b.def.role] ?? 3) * grow;
      if (!b.built) { addBar(b.x, h + bh + 0.4, b.y, 2.2, b.progress, 0x4ab8ff); if (Math.random() < 0.25) this.hub.puff(b.x + (Math.random() - 0.5) * b.size, h + 0.4, b.y + (Math.random() - 0.5) * b.size, 1, { size0: 0.5, size1: 1.6 }); }
      else if (sel || b.hp < b.maxHp - 1) addBar(b.x, h + bh + 0.4, b.y, 2.6, b.hp / b.maxHp, hpColor(b.hp / b.maxHp));
      // damaged buildings burn
      const hf = b.hp / b.maxHp;
      if (b.built && hf < 0.45 && Math.random() < 0.45) {
        const fx = b.x + (Math.random() - 0.5) * b.size * 0.7, fz = b.y + (Math.random() - 0.5) * b.size * 0.7;
        if (Math.random() < 0.6) this.hub.flame(fx, h + bh * 0.6, fz, 1.1 + (0.45 - hf) * 2); else this.hub.blackSmoke(fx, h + bh * 0.7, fz, 1.2);
      }
      // production glow for reactors
      if (b.built && b.def.role === 'reactor') {
        const armed = w.nukes.some((n) => n.silo === b.id && !n.done);
        if (Math.random() < (armed ? 0.8 : 0.12)) this.hub.fire.emit({ x: b.x + (Math.random() - 0.5) * 0.8, y: h + bh, z: b.y + (Math.random() - 0.5) * 0.8, vy: 2 + Math.random() * 2, life: 1.2, size0: armed ? 1.4 : 0.6, size1: armed ? 0.2 : 0.1, c0: b.def.model.includes('sunda') ? [0.4, 1.8, 2.4, 0.7] : [0.5, 2.4, 0.7, 0.7], c1: [0.1, 0.5, 0.3, 0], tile: 2 });
        if (armed && Math.random() < 0.5) this.hub.puff(b.x + (Math.random() - 0.5) * 2, h + 1.2, b.y + (Math.random() - 0.5) * 2, 1, { size0: 0.9, size1: 2.8, c0: [0.9, 0.9, 0.9, 0.5], c1: [0.8, 0.8, 0.8, 0], speed: 3 });
      }
    }
    // ---- resource selection rings ----
    for (const id of this.selection) {
      const r = w.get(id) as Resource | undefined;
      if (r && r.kind === 'resource') addRing(r.x, r.y, r.size * 0.8, 0, true);
    }
    // ---- ghosts (dying things) ----
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i]; g.t += dtReal;
      const pool = this.pools.get(g.model);
      const u = g.t / g.T;
      if (u >= 1) { this.ghosts.splice(i, 1); continue; }
      if (!pool) continue;
      if (g.kind === 'unit') {
        o.position.set(g.x, g.y - u * 0.25, g.z); o.rotation.set(-u * 1.45, g.rot, 0, 'YXZ'); o.scale.setScalar(1 - u * 0.2); o.updateMatrix();
      } else {
        const sink = u * u * 3.2;
        o.position.set(g.x + (Math.random() - 0.5) * 0.12 * (1 - u), g.y - sink, g.z + (Math.random() - 0.5) * 0.12 * (1 - u));
        o.rotation.set((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.03); o.scale.set(1, 1 - u * 0.5, 1); o.updateMatrix();
        if (Math.random() < 0.7) this.hub.flame(g.x + (Math.random() - 0.5) * g.sx, g.y + 0.5 + Math.random() * 1.5 * (1 - u), g.z + (Math.random() - 0.5) * g.sx, 1.8);
        if (Math.random() < 0.8) this.hub.blackSmoke(g.x + (Math.random() - 0.5) * g.sx, g.y + 1.5, g.z + (Math.random() - 0.5) * g.sx, 2.2);
      }
      pool.add(o.matrix);
    }
    for (const p of this.pools.values()) p.end();
    this.rings.count = ringN; this.rings.instanceMatrix.needsUpdate = true; if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    this.selRings.count = selN; this.selRings.instanceMatrix.needsUpdate = true;
    this.hpBg.count = hpN; this.hpFg.count = hpN;
    this.hpBg.instanceMatrix.needsUpdate = true; this.hpFg.instanceMatrix.needsUpdate = true; if (this.hpFg.instanceColor) this.hpFg.instanceColor.needsUpdate = true;
    (this.selRings.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * Math.sin(this.time * 6);
    void ringM; void serverTime;

    // ---- projectiles ----
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]; p.t += dtReal; const u = Math.min(1, p.t / p.T);
      const x = p.fx + (p.tx - p.fx) * u, z = p.fz + (p.tz - p.fz) * u, y = p.fy + (p.ty - p.fy) * u + p.arc * 4 * u * (1 - u);
      const prev = p.mesh.position.clone(); p.mesh.position.set(x, y, z);
      const dir = p.mesh.position.clone().sub(prev);
      if (dir.lengthSq() > 1e-8) p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
      if (p.kind === 'cannon' && Math.random() < 0.8) this.hub.smoke.emit({ x, y, z, life: 0.6, size0: 0.25, size1: 0.9, c0: [0.5, 0.5, 0.5, 0.5], c1: [0.4, 0.4, 0.4, 0] });
      if (u >= 1) {
        if (p.kind === 'cannon') this.hub.explosion(p.tx, p.ty, p.tz, 1.1);
        else this.hub.puff(p.tx, p.ty, p.tz, 2, { size1: 0.9 });
        this.scene.remove(p.mesh); this.projPool.push(p.mesh); this.projectiles.splice(i, 1);
      }
    }
    // ---- pings ----
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i]; p.t += dtReal; const u = p.t / 0.9; const sz = (p.mesh as any).sz as number;
      if (u >= 1) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose(); this.pings.splice(i, 1); continue; }
      p.mesh.scale.setScalar(0.4 + u * sz); (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - u;
    }
    // ---- burning ruins ----
    for (const [id, t] of this.buildingBurn) { if (t <= 0) this.buildingBurn.delete(id); else this.buildingBurn.set(id, t - dtReal); }

    // ---- fx systems ----
    const wt = w.time + alpha * DT;
    this.missileFx.update(wt);
    this.zones.update(wt, this.time);
    this.nukeFx.update(dtReal, this.camera.position);
    this.hub.update(dtReal);

    // ---- grade / post ----
    const G = this.grade;
    // decay
    G.flash *= Math.exp(-dtReal * 3.2); G.bloomBoost *= Math.exp(-dtReal * 0.8); G.shake *= Math.exp(-dtReal * 2.2);
    G.tint = Math.max(0, G.tint - dtReal * 0.09);
    const incoming = w.nukes.some((n) => !n.done);
    G.warn += ((incoming ? 0.5 : 0) - G.warn) * Math.min(1, dtReal * 3);
    const gu = this.gradePass.uniforms as any;
    gu.uFlash.value = Math.min(2.5, G.flash); gu.uTint.value = Math.min(1, G.tint); gu.uWarn.value = G.warn; gu.uTime.value = this.time;
    this.bloom.strength = 0.28 + G.bloomBoost * 0.9;
    // nuclear dimming
    this.sun.intensity = 3.1 * (1 - 0.35 * Math.min(1, G.tint * 2));
    this.composer.render();
  }

  private needStatic = true;
  private rebuildStaticInto() {
    // static scenery is re-added every frame (cheap: shared InstancedMesh matrices)
    const w = this.world, d = this.tmpO;
    for (const r of w.resources) {
      if (r.dead || !this.near(r.x, r.y)) continue;
      const p = this.pools.get(r.model); if (!p) continue;
      const h = w.heightAt(r.x, r.y);
      d.position.set(r.x, h - 0.02, r.y);
      d.rotation.set(0, r.resKind === 'paddy' ? 0 : hash(r.id) * 6.28, 0);
      const s = r.resKind === 'tree' ? 0.85 + hash(r.id + 7) * 0.5 : r.resKind === 'gold' ? 0.7 + 0.35 * (r.amount / r.max) : 0.6 + 0.4 * (r.amount / r.max);
      d.scale.set(s, r.resKind === 'paddy' ? 0.6 + 0.4 * (r.amount / r.max) : s, s); d.updateMatrix();
      p.add(d.matrix);
    }
    for (const dc of this.decorLive) {
      if (!this.near(dc.x, dc.y)) continue;
      const p = this.pools.get(dc.model); if (!p) continue;
      let covered = false;
      for (const b of w.buildings) if (!b.dead && dc.x > b.fx - 1 && dc.x < b.fx + b.size + 1 && dc.y > b.fy - 1 && dc.y < b.fy + b.size + 1) { covered = true; break; }
      if (covered) continue;
      d.position.set(dc.x, w.heightAt(dc.x, dc.y) - 0.05, dc.y); d.rotation.set(0, dc.rot, 0); d.scale.setScalar(dc.scale); d.updateMatrix(); p.add(d.matrix);
    }
  }

  // ------------------------------------------------------------------ quality
  setQuality(q: 'auto' | 'low' | 'high') {
    this.quality = q; this.qLevel = q === 'low' ? 2 : 0; this.resScale = q === 'low' ? 0.7 : 1;
    this.applyQuality();
  }
  private setSamples(n: number) {
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) if (rt.samples !== n) { rt.samples = n; rt.dispose(); }
  }
  private applyQuality() {
    const r = this.renderer;
    const hi = this.quality === 'high';
    const lvl = this.qLevel;
    const shadowOn = lvl < 2;
    const size = hi ? 3072 : lvl >= 1 ? 1024 : 2048;
    if (r.shadowMap.enabled !== shadowOn) this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && !Array.isArray(m)) m.needsUpdate = true; });
    r.shadowMap.enabled = shadowOn; this.sun.castShadow = shadowOn;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null; }
    r.shadowMap.type = hi ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.setSamples(hi ? 4 : lvl >= 1 ? 0 : 2);
    this.bloom.enabled = lvl < 3;
    const pr = Math.min(devicePixelRatio, 1.75) * this.resScale;
    r.setPixelRatio(pr); this.composer.setPixelRatio(pr); this.composer.setSize(this.width(), this.height());
  }
  private adaptQuality(dt: number) {
    this.ema += (dt - this.ema) * 0.08;
    if (this.quality !== 'auto') return;
    this.qTimer += dt; if (this.qTimer < 2) return; this.qTimer = 0;
    if (this.ema > 1 / 38) {
      if (this.resScale > 0.8) { this.resScale = Math.max(0.78, this.resScale * 0.9); this.applyQuality(); }
      else if (this.qLevel < 3) { this.qLevel++; this.resScale = Math.max(this.resScale, 0.85); this.applyQuality(); }
      else if (this.resScale > 0.6) { this.resScale = Math.max(0.6, this.resScale * 0.9); this.applyQuality(); }
    } else if (this.ema < 1 / 58 && (this.resScale < 1 || this.qLevel > 0)) {
      if (this.qLevel > 0 && this.resScale >= 0.95) { this.qLevel--; this.applyQuality(); } else { this.resScale = Math.min(1, this.resScale * 1.08); this.applyQuality(); }
    }
  }
  get qualityInfo() { return `${this.quality} · res ${(this.resScale * 100).toFixed(0)}% · lvl ${this.qLevel} · ${(1 / this.ema).toFixed(0)} fps`; }

  // ------------------------------------------------------------------ placement ghost
  showPlacement(model: string | null, x: number, z: number, size: number, valid: boolean) {
    if (!model) { if (this.ghostBuild) { this.scene.remove(this.ghostBuild.group); this.ghostBuild = null; } return; }
    if (!this.ghostBuild || this.ghostBuild.model !== model) {
      if (this.ghostBuild) this.scene.remove(this.ghostBuild.group);
      const group = new THREE.Group();
      const src = this.assets.models.get(model)!.clone(true);
      src.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.material = (m.material as THREE.MeshStandardMaterial).clone(); const mm = m.material as THREE.MeshStandardMaterial; mm.transparent = true; mm.opacity = 0.62; mm.depthWrite = false; m.castShadow = false; } });
      const foot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x3cff78, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
      foot.rotation.x = -Math.PI / 2; foot.renderOrder = 6;
      group.add(src, foot); this.scene.add(group);
      this.ghostBuild = { group, foot, model };
    }
    const gb = this.ghostBuild;
    const h = this.world.heightAt(x, z);
    gb.group.position.set(x, h, z);
    gb.foot.scale.set(size, size, 1); gb.foot.position.y = 0.2;
    (gb.foot.material as THREE.MeshBasicMaterial).color.set(valid ? 0x3cff78 : 0xff4040);
    gb.group.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && m !== gb.foot) { const mm = m.material as THREE.MeshStandardMaterial; mm.emissive.set(valid ? 0x103018 : 0x501010); } });
  }

  /** Nearest entity under a screen position (units first, then buildings, then resources). */
  pickEntity(px: number, py: number): { kind: 'unit' | 'building' | 'resource'; id: number } | null {
    const w = this.world;
    let best: { kind: 'unit' | 'building' | 'resource'; id: number } | null = null, bd = 1e9;
    const test = (kind: 'unit' | 'building' | 'resource', id: number, x: number, z: number, yOff: number, rad: number) => {
      const s = this.project(x, w.heightAt(x, z) + yOff, z);
      if (!s.on) return;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < rad && d < bd) { bd = d; best = { kind, id }; }
    };
    const scale = (14 / this.rig.dist);
    for (const u of w.units) if (!u.dead) test('unit', u.id, u.x, u.y, 0.8, Math.max(14, 30 * scale));
    if (best) return best;
    for (const b of w.buildings) if (!b.dead) test('building', b.id, b.x, b.y, 1.2, Math.max(30, b.size * 22 * scale + 20));
    if (best) return best;
    for (const r of w.resources) if (!r.dead) test('resource', r.id, r.x, r.y, 0.5, Math.max(14, r.size * 16 * scale + 8));
    return best;
  }
}

export type { Unit };
