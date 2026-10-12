import * as THREE from 'three';

export interface Emit {
  x: number; y: number; z: number; vx?: number; vy?: number; vz?: number;
  life: number; size0: number; size1: number;
  c0: [number, number, number, number]; c1: [number, number, number, number];
  drag?: number; grav?: number; rise?: number; tile?: number; spin?: number;
}

/** GPU-billboarded particle pool (instanced quads, no point-size limit). */
export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private max: number;
  private geo: THREE.InstancedBufferGeometry;
  private pos: Float32Array; private col: Float32Array; private sz: Float32Array; private rot: Float32Array; private tile: Float32Array;
  private vel: Float32Array; private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private c0: Float32Array; private c1: Float32Array;
  private drag: Float32Array; private grav: Float32Array; private rise: Float32Array; private spin: Float32Array;
  private head = 0; alive = 0;
  analytic = false;
  constructor(max: number, atlas: THREE.Texture, additive: boolean, public name = '') {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index; geo.setAttribute('position', base.getAttribute('position')); geo.setAttribute('uv', base.getAttribute('uv'));
    const mk = (n: number) => new Float32Array(max * n);
    this.pos = mk(3); this.col = mk(4); this.sz = mk(1); this.rot = mk(1); this.tile = mk(1);
    this.vel = mk(3); this.age = mk(1); this.life = mk(1); this.s0 = mk(1); this.s1 = mk(1); this.c0 = mk(4); this.c1 = mk(4);
    this.drag = mk(1); this.grav = mk(1); this.rise = mk(1); this.spin = mk(1);
    this.age.fill(1e9); this.life.fill(1);
    const attr = (a: Float32Array, n: number, nm: string) => { const at = new THREE.InstancedBufferAttribute(a, n); at.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(nm, at); };
    attr(this.pos, 3, 'iPos'); attr(this.col, 4, 'iCol'); attr(this.sz, 1, 'iSize'); attr(this.rot, 1, 'iRot'); attr(this.tile, 1, 'iTile');
    geo.instanceCount = max;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uAtlas: { value: atlas } },
      vertexShader: `
        attribute vec3 iPos; attribute vec4 iCol; attribute float iSize; attribute float iRot; attribute float iTile;
        varying vec2 vUv; varying vec4 vCol; varying float vTile; varying vec3 vView;
        void main(){
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          float c = cos(iRot), s = sin(iRot);
          vec2 p = position.xy * iSize; p = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
          mv.xy += p;
          vUv = uv; vCol = iCol; vTile = iTile; vView = mv.xyz;
          vCol.a *= smoothstep(1.5, 11.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vCol; varying float vTile; varying vec3 vView;
        void main(){
          if (vCol.a < 0.002) discard;
          vec2 t = vec2(mod(vTile, 2.0), floor(vTile / 2.0));
          vec2 uv = (vUv + t) * 0.5;
          vec4 tx = texture2D(uAtlas, uv);
          float a = tx.a * vCol.a;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vCol.rgb * ${additive ? 'a' : '1.0'}, ${additive ? '1.0' : 'a'});
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 11 : 10;
  }
  emit(e: Emit) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    const p = i * 3, c = i * 4;
    this.pos[p] = e.x; this.pos[p + 1] = e.y; this.pos[p + 2] = e.z;
    this.vel[p] = e.vx ?? 0; this.vel[p + 1] = e.vy ?? 0; this.vel[p + 2] = e.vz ?? 0;
    this.age[i] = 0; this.life[i] = e.life; this.s0[i] = e.size0; this.s1[i] = e.size1;
    for (let k = 0; k < 4; k++) { this.c0[c + k] = e.c0[k]; this.c1[c + k] = e.c1[k]; }
    this.drag[i] = e.drag ?? 0; this.grav[i] = e.grav ?? 0; this.rise[i] = e.rise ?? 0;
    this.rot[i] = Math.random() * 6.283; this.spin[i] = e.spin ?? (Math.random() - 0.5) * 0.8; this.tile[i] = e.tile ?? Math.floor(Math.random() * 3);
  }
  /** Direct write for analytic particles. */
  set(i: number, x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number, rot = 0, tile = 0) {
    const p = i * 3, c = i * 4;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z; this.sz[i] = size;
    this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b; this.col[c + 3] = a; this.rot[i] = rot; this.tile[i] = tile;
  }
  clearAll() { this.age.fill(1e9); this.col.fill(0); this.head = 0; this.markDirty(); }
  private markDirty() {
    for (const n of ['iPos', 'iCol', 'iSize', 'iRot', 'iTile']) (this.geo.getAttribute(n) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
  update(dt: number) {
    if (!this.analytic) {
      let alive = 0;
      for (let i = 0; i < this.max; i++) {
        const age = this.age[i];
        if (age >= this.life[i]) { this.col[i * 4 + 3] = 0; continue; }
        alive++;
        const na = age + dt; this.age[i] = na;
        const t = na / this.life[i];
        const p = i * 3;
        const dr = Math.max(0, 1 - this.drag[i] * dt);
        this.vel[p] *= dr; this.vel[p + 1] = this.vel[p + 1] * dr - this.grav[i] * dt + this.rise[i] * dt; this.vel[p + 2] *= dr;
        this.pos[p] += this.vel[p] * dt; this.pos[p + 1] += this.vel[p + 1] * dt; this.pos[p + 2] += this.vel[p + 2] * dt;
        this.rot[i] += this.spin[i] * dt;
        this.sz[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
        const c = i * 4;
        for (let k = 0; k < 4; k++) this.col[c + k] = this.c0[c + k] + (this.c1[c + k] - this.c0[c + k]) * t;
      }
      this.alive = alive;
    }
    this.markDirty();
  }
}
