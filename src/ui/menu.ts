import * as THREE from 'three';
import type { Assets } from '../render/assets';
import { REGION_PRESET, TRIBES, type MapPreset, type TribeId } from '../data/game';
import type { Difficulty } from '../sim/ai';
import { hashString } from '../sim/rng';

export interface StartConfig { tribe: TribeId; enemy: TribeId; province: string; region: string; preset: MapPreset; difficulty: Difficulty; demo: boolean }

function thumb(assets: Assets, names: string[], size = 220): string {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(size, size); r.setPixelRatio(1); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x6b5436, 1.4));
  const d = new THREE.DirectionalLight(0xfff0d0, 3); d.position.set(-3, 6, 5); scene.add(d);
  const group = new THREE.Group(); scene.add(group);
  let x = 0;
  for (const n of names) {
    const m = assets.models.get(n)!.clone(true);
    const box = new THREE.Box3().setFromObject(m); const s = box.getSize(new THREE.Vector3());
    const k = 2.4 / Math.max(s.x, s.y, s.z);
    m.scale.setScalar(k); m.position.x = x; x += s.x * k + 0.3; group.add(m);
  }
  group.position.x = -(x - 0.3) / 2;
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50); cam.position.set(0, 2.1, 5.2 + names.length * 0.9); cam.lookAt(0, 1.0, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  r.dispose(); r.forceContextLoss();
  return url;
}

export class Menu {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root: HTMLElement;
  private mixer?: THREE.AnimationMixer;
  private provinces: THREE.Mesh[] = [];
  private hover: THREE.Mesh | null = null; private selected: THREE.Mesh | null = null;
  private raf = 0; private clock = new THREE.Clock(); private t = 0;
  private tribe: TribeId = 'jawa'; private difficulty: Difficulty = 'sedang'; private demo = false;
  private mouse = new THREE.Vector2(9, 9); private ray = new THREE.Raycaster();
  private lift = new Map<THREE.Object3D, number>();
  private infoEl!: HTMLElement; private startBtn!: HTMLButtonElement;

  constructor(private host: HTMLElement, private assets: Assets, private onStart: (c: StartConfig) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 200);
    this.camera.position.set(0.5, 12.5, 9.5); this.camera.lookAt(0.3, 0, 0.2); this.applyOffset();

    // ---- scene ----
    this.scene.background = new THREE.Color(0x082033); this.scene.fog = new THREE.Fog(0x082033, 18, 40);
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x1a3a50, 1.0));
    const sun = new THREE.DirectionalLight(0xfff0d0, 3.0); sun.position.set(-6, 12, 6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 6, bottom: -6, near: 1, far: 40 }); sun.shadow.bias = -0.0005; this.scene.add(sun);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vP; uniform float uT;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          float r = length(vP) / 30.0;
          vec3 deep = vec3(0.02, 0.1, 0.18), mid = vec3(0.04, 0.3, 0.42);
          vec3 c = mix(mid, deep, smoothstep(0.1, 1.0, r));
          float w = n(vP * 0.6 + vec2(uT * 0.1, uT * 0.07)) * 0.6 + n(vP * 1.7 - uT * 0.12) * 0.4;
          c += vec3(0.05, 0.14, 0.18) * smoothstep(0.55, 0.9, w);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.12; sea.receiveShadow = true; this.scene.add(sea); (this as any).sea = sea;

    if (assets.indonesia) {
      const map = assets.indonesia.scene.clone(true);
      map.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = m.receiveShadow = true;
          m.material = (m.material as THREE.MeshStandardMaterial).clone();
          const mat = m.material as THREE.MeshStandardMaterial; mat.emissive = new THREE.Color(0x000000);
          m.userData = { ...(m.parent?.userData ?? {}), ...m.userData };
          this.provinces.push(m);
        }
      });
      // province extras live on the node (mesh itself in glTF with one primitive)
      this.scene.add(map);
      this.mixer = new THREE.AnimationMixer(map);
      const intro = assets.indonesia.animations.find((a) => a.name === 'Intro');
      const wave = assets.indonesia.animations.find((a) => a.name === 'Wave');
      if (intro) {
        const ai = this.mixer.clipAction(intro); ai.setLoop(THREE.LoopOnce, 1); ai.clampWhenFinished = false; ai.play();
        this.mixer.addEventListener('finished', () => { ai.stop(); if (wave) { const aw = this.mixer!.clipAction(wave); aw.timeScale = 0.55; aw.play(); } for (const p of this.provinces) p.scale.set(1, 1, 1); });
      }
    }
    this.root = document.createElement('div'); this.root.id = 'menu'; this.buildUI(); host.appendChild(this.root);
    addEventListener('resize', this.resize);
    this.renderer.domElement.addEventListener('pointermove', this.onMove);
    this.renderer.domElement.addEventListener('pointerdown', this.onDown);
    // default province: Jawa Tengah
    const def = this.provinces.find((p) => p.userData.province === 'Jawa Tengah') ?? this.provinces[0];
    if (def) this.selectProvince(def);
    (window as any).__menu = this;
    this.loop();
  }

  private buildUI() {
    const jawa = TRIBES.jawa, sunda = TRIBES.sunda;
    const tj = thumb(this.assets, ['tc_jawa', 'hero_jawa']), ts = thumb(this.assets, ['tc_sunda', 'hero_sunda']);
    this.root.innerHTML = `
      <div class="title"><h1>NUSANTARA WARS</h1><p>Strategi tanah air · kearifan lokal · dan sedikit… nuklir ☢️</p></div>
      <div class="side panel">
        <h3>1. Pilih suku</h3>
        <div class="cards">
          <button class="tribe sel" data-tribe="jawa"><div class="th" style="background-image:url(${tj})"></div><b>${jawa.icon} ${jawa.name}</b><small>${jawa.tagline}</small><ul>${jawa.bonuses.slice(0, 3).map((b) => `<li>${b}</li>`).join('')}</ul></button>
          <button class="tribe" data-tribe="sunda"><div class="th" style="background-image:url(${ts})"></div><b>${sunda.icon} ${sunda.name}</b><small>${sunda.tagline}</small><ul>${sunda.bonuses.slice(0, 3).map((b) => `<li>${b}</li>`).join('')}</ul></button>
        </div>
        <h3>2. Lawan AI</h3>
        <div class="seg" id="diff"><button class="btn" data-d="mudah">Mudah</button><button class="btn sel" data-d="sedang">Sedang</button><button class="btn" data-d="sulit">Sulit</button></div>
        <label class="chk"><input type="checkbox" id="demo"> Demo nuklir: langsung mulai di Era Atom dengan banyak sumber daya</label>
        <div class="info" id="tinfo"></div>
        <div class="info">Lawan Anda adalah suku <b id="foe"></b>. Hancurkan markasnya sebelum markas Anda dihancurkan. Hati-hati, dia juga akan meluncurkan nuklir.</div>
      </div>
      <div class="prov panel"><h3 id="pname">-</h3><p id="pinfo">Klik provinsi di peta untuk memilih medan tempur.</p><button class="btn big primary start" id="start">⚔ Mulai Pertempuran</button></div>`;
    this.infoEl = this.root.querySelector('#pinfo')!; this.startBtn = this.root.querySelector('#start')!;
    const refresh = () => {
      this.root.querySelectorAll('.tribe').forEach((b) => b.classList.toggle('sel', (b as HTMLElement).dataset.tribe === this.tribe));
      (this.root.querySelector('#foe') as HTMLElement).textContent = TRIBES[this.tribe === 'jawa' ? 'sunda' : 'jawa'].name;
      const t = TRIBES[this.tribe];
      (this.root.querySelector('#tinfo') as HTMLElement).innerHTML = `<b>${t.hero.ability}</b> (${t.advisor.name}): ${t.hero.abilityDesc}<br><b>Nuklir:</b> ${t.nuke.name}. ${t.nuke.blurb}`;
    };
    this.root.querySelectorAll('.tribe').forEach((b) => b.addEventListener('click', () => { this.tribe = (b as HTMLElement).dataset.tribe as TribeId; refresh(); }));
    this.root.querySelectorAll('#diff button').forEach((b) => b.addEventListener('click', () => { this.difficulty = (b as HTMLElement).dataset.d as Difficulty; this.root.querySelectorAll('#diff button').forEach((x) => x.classList.toggle('sel', x === b)); }));
    (this.root.querySelector('#demo') as HTMLInputElement).onchange = (e) => { this.demo = (e.target as HTMLInputElement).checked; };
    this.startBtn.onclick = () => this.start();
    refresh();
  }

  private selectProvince(m: THREE.Mesh) {
    if (this.selected) (this.selected.material as THREE.MeshStandardMaterial).emissive.setHex(0);
    this.selected = m;
    (this.root.querySelector('#pname') as HTMLElement).textContent = m.userData.province ?? m.name;
    const region = m.userData.region ?? 'Jawa'; const p = REGION_PRESET[region] ?? REGION_PRESET['Jawa'];
    this.infoEl.innerHTML = `<b>${region}</b>: ${p.blurb}<br>Hutan ${'▮'.repeat(Math.round(p.forest * 5))}${'▯'.repeat(5 - Math.round(p.forest * 5))} · Air ${'▮'.repeat(Math.round(p.water * 5))}${'▯'.repeat(5 - Math.round(p.water * 5))} · Gunung ${'▮'.repeat(Math.round(p.mountain * 5))}${'▯'.repeat(5 - Math.round(p.mountain * 5))}`;
  }

  private start() {
    if (!this.selected) return;
    const province = this.selected.userData.province ?? this.selected.name; const region = this.selected.userData.region ?? 'Jawa';
    const base = REGION_PRESET[region] ?? REGION_PRESET['Jawa'];
    const cfg: StartConfig = { tribe: this.tribe, enemy: this.tribe === 'jawa' ? 'sunda' : 'jawa', province, region, preset: { seed: hashString(province), ...base }, difficulty: this.difficulty, demo: this.demo };
    this.onStart(cfg);
  }

  private onMove = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  private onDown = () => { if (this.hover) this.selectProvince(this.hover); };
  private camDist = 15;
  private applyOffset() {
    const W = this.host.clientWidth, H = this.host.clientHeight;
    const panel = Math.min(400, W * 0.4) + 30;
    const avail = Math.max(300, W - panel);
    const visH = 12.8 / Math.max(0.4, avail / H);                     // world height that must fit so the whole archipelago is visible
    this.camDist = THREE.MathUtils.clamp(visH / (2 * Math.tan(THREE.MathUtils.degToRad(19))) * 0.9, 12.5, 36);
    this.camera.setViewOffset(W, H, -panel * 0.5, 0, W, H);
  }
  private resize = () => { this.renderer.setSize(this.host.clientWidth, this.host.clientHeight); this.camera.aspect = this.host.clientWidth / this.host.clientHeight; this.applyOffset(); this.camera.updateProjectionMatrix(); };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta()); this.t += dt;
    this.mixer?.update(dt);
    ((this as any).sea.material as THREE.ShaderMaterial).uniforms.uT.value = this.t;
    // hover
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObjects(this.provinces, false)[0]?.object as THREE.Mesh | undefined;
    const h = hit ?? null;
    if (h !== this.hover) {
      if (this.hover && this.hover !== this.selected) (this.hover.material as THREE.MeshStandardMaterial).emissive.setHex(0);
      this.hover = h; this.renderer.domElement.style.cursor = h ? 'pointer' : 'default';
    }
    for (const p of this.provinces) {
      const target = p === this.selected ? 2.2 : p === this.hover ? 1.7 : 1;
      const cur = this.lift.get(p) ?? 1; const nv = cur + (target - cur) * Math.min(1, dt * 9);
      this.lift.set(p, nv);
      if (this.mixer && p.scale.x === 1) p.scale.y = nv;
      const em = (p.material as THREE.MeshStandardMaterial).emissive;
      if (p === this.selected) em.setRGB(0.32 + 0.1 * Math.sin(this.t * 4), 0.24, 0.05); else if (p === this.hover) em.setRGB(0.16, 0.16, 0.12);
    }
    this.camera.position.set(0.5 + Math.sin(this.t * 0.18) * 0.7, this.camDist * 0.82 + Math.sin(this.t * 0.13) * 0.4, this.camDist * 0.62); this.camera.lookAt(0.3, 0, 0.2);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    this.root.remove(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
