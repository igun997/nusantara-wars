import * as THREE from 'three';
import type { FxHub } from './hub';
import { NUKE } from '../data/game';

export interface GradeState { flash: number; warn: number; tint: number; bloomBoost: number; shake: number }

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

interface Det {
  t: number; x: number; y: number; z: number;
  slot: number; th: Float32Array; ph: Float32Array; rr: Float32Array; ph2: Float32Array;
  ring: THREE.Mesh; dome: THREE.Mesh; light: THREE.PointLight;
  spots: { x: number; z: number; acc: number }[]; acc: { stem: number; glow: number; fall: number; ember: number; dust: number };
  burst: boolean; falloutT: number; tribe: string;
}
const CAP_N = 560;

/** The big one: flash, fireball, rolling mushroom cap, shockwave, dome, debris, fires, fallout. */
export class NukeFx {
  group = new THREE.Group();
  private dets: Det[] = [];
  private nextSlot = 0;
  private ringMat: THREE.ShaderMaterial;
  private domeMat: THREE.ShaderMaterial;
  constructor(private hub: FxHub, private heightAt: (x: number, z: number) => number, private grade: GradeState) {
    this.ringMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uA: { value: 1 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vP; uniform float uA;
        void main(){ float r = length(vP); float edge = smoothstep(0.80,0.97,r) * (1.0 - smoothstep(0.985,1.0,r));
          float inner = smoothstep(0.45,0.97,r) * 0.25;
          vec3 col = mix(vec3(1.7,0.9,0.35), vec3(2.4,2.2,1.9), smoothstep(0.88,0.98,r));
          gl_FragColor = vec4(col * (edge + inner) * uA, 1.0); }`,
    });
    this.domeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uA: { value: 1 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `varying vec3 vN; varying vec3 vV; uniform float uA;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(vec3(1.5,1.15,0.8) * f * uA, 1.0); }`,
    });
    this.group.name = 'nukefx';
  }

  detonate(x: number, z: number, tribe: string) {
    const y = this.heightAt(x, z);
    const slot = (this.nextSlot++ % 2) * CAP_N;
    const th = new Float32Array(CAP_N), ph = new Float32Array(CAP_N), rr = new Float32Array(CAP_N), ph2 = new Float32Array(CAP_N);
    for (let i = 0; i < CAP_N; i++) { th[i] = Math.random() * 6.283; ph[i] = Math.random() * 6.283; rr[i] = Math.sqrt(Math.random()); ph2[i] = Math.random() * 6.283; }
    const ring = new THREE.Mesh(new THREE.CircleGeometry(1, 80), this.ringMat.clone());
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.5, z); ring.renderOrder = 9; ring.frustumCulled = false;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), this.domeMat.clone());
    dome.position.set(x, y, z); dome.renderOrder = 9; dome.frustumCulled = false;
    const light = new THREE.PointLight(0xffa860, 0, 190, 1.3); light.position.set(x, y + 8, z);
    this.group.add(ring, dome, light);
    const spots = Array.from({ length: 14 }, () => { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * NUKE.radius * 0.8; return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, acc: Math.random() }; });
    this.dets.push({ t: 0, x, y, z, slot, th, ph, rr, ph2, ring, dome, light, spots, acc: { stem: 0, glow: 0, fall: 0, ember: 0, dust: 0 }, burst: false, falloutT: NUKE.falloutTime, tribe });
    this.grade.flash = 1.6;
    this.grade.bloomBoost = 1.0;
  }

  private stemH(t: number) { return 25 * (1 - Math.exp(-t / 1.75)); }

  update(dt: number, camPos: THREE.Vector3) {
    for (const d of this.dets) {
      d.t += dt;
      const t = d.t, { x, y, z } = d;
      const h = this.hub;
      const camD = Math.hypot(camPos.x - x, camPos.z - z);

      // ---- one-shot burst ----
      if (!d.burst) {
        d.burst = true;
        for (let i = 0; i < 300; i++) {
          const a = Math.random() * 6.283, e = Math.random() * 1.2 - 0.1, sp = rand(3, 18);
          h.fire.emit({ x: x + Math.cos(a) * rand(0, 1.5), y: y + rand(0.6, 2), z: z + Math.sin(a) * rand(0, 1.5), vx: Math.cos(a) * sp * Math.cos(e), vy: 3 + sp * Math.sin(Math.abs(e)) * 0.9, vz: Math.sin(a) * sp * Math.cos(e), life: rand(1.2, 3), size0: 2.2, size1: rand(5, 10), drag: 1.7, rise: 4, c0: [3.4, 2.6, 1.1, 1], c1: [0.9, 0.12, 0.02, 0] });
        }
        for (let i = 0; i < 180; i++) {
          const a = Math.random() * 6.283, sp = rand(2, 9);
          h.smoke.emit({ x: x + Math.cos(a) * rand(0, 2), y: y + rand(0.5, 3), z: z + Math.sin(a) * rand(0, 2), vx: Math.cos(a) * sp, vy: rand(2, 8), vz: Math.sin(a) * sp, life: rand(4, 8), size0: 3, size1: rand(8, 13), drag: 1.1, rise: 1.3, c0: [0.24, 0.16, 0.11, 0.9], c1: [0.34, 0.32, 0.3, 0] });
        }
        // debris + sparks
        for (let i = 0; i < 110; i++) {
          const a = Math.random() * 6.283, sp = rand(8, 26);
          h.smoke.emit({ x, y: y + 1, z, vx: Math.cos(a) * sp, vy: rand(12, 30), vz: Math.sin(a) * sp, life: rand(1.8, 3.2), size0: 0.45, size1: 0.3, grav: 16, drag: 0.1, c0: [0.12, 0.09, 0.07, 1], c1: [0.1, 0.08, 0.07, 0.8], tile: 1 });
        }
        for (let i = 0; i < 220; i++) {
          const a = Math.random() * 6.283, sp = rand(6, 30);
          h.fire.emit({ x, y: y + 1, z, vx: Math.cos(a) * sp, vy: rand(8, 28), vz: Math.sin(a) * sp, life: rand(0.9, 2.2), size0: 0.5, size1: 0.05, grav: 14, drag: 0.2, c0: [4, 2.6, 0.8, 1], c1: [1.2, 0.2, 0, 0], tile: 3 });
        }
      }
      // ---- dust ring (first 0.55 s) ----
      if (t < 0.55) {
        d.acc.dust += dt * 900;
        while (d.acc.dust >= 1) {
          d.acc.dust--;
          const a = Math.random() * 6.283, rs = 34 * t + rand(-0.6, 0.6);
          h.smoke.emit({ x: x + Math.cos(a) * rs, y: y + 0.4, z: z + Math.sin(a) * rs, vx: Math.cos(a) * 12, vy: rand(1, 4), vz: Math.sin(a) * 12, life: rand(2.2, 3.6), size0: 2.6, size1: rand(6, 9), drag: 2.4, c0: [0.6, 0.5, 0.38, 0.72], c1: [0.46, 0.43, 0.4, 0] });
        }
      }
      // ---- rising stem ----
      if (t > 0.15 && t < 6) {
        d.acc.stem += dt * 170; d.acc.glow += dt * 70;
        const H = this.stemH(t);
        while (d.acc.stem >= 1) {
          d.acc.stem--;
          const hh = Math.random() * H, a = Math.random() * 6.283, r = 0.6 + Math.random() * 1.5 + hh * 0.025;
          h.smoke.emit({ x: x + Math.cos(a) * r, y: y + hh, z: z + Math.sin(a) * r, vx: -Math.sin(a) * 1.6, vy: rand(2, 8), vz: Math.cos(a) * 1.6, life: rand(4, 8), size0: 2.2, size1: rand(4.5, 7.5), drag: 0.4, c0: [0.3, 0.21, 0.15, 0.85], c1: [0.4, 0.39, 0.38, 0] });
        }
        while (d.acc.glow >= 1) {
          d.acc.glow--;
          const hh = Math.random() * H * 0.55, a = Math.random() * 6.283, r = Math.random() * 1.4;
          h.fire.emit({ x: x + Math.cos(a) * r, y: y + hh, z: z + Math.sin(a) * r, vy: rand(3, 9), life: rand(0.8, 1.6), size0: 2, size1: 3.2, c0: [2.4, 1.0, 0.28, 0.8], c1: [0.4, 0.06, 0, 0] });
        }
      }
      // ---- rolling cap (analytic torus) ----
      {
        const u = Math.max(0, t - 0.45);
        const g = 1 - Math.exp(-u / 2.3);
        const C = this.stemH(t) * 0.97 + 1.5 + Math.max(0, t - 9) * 0.35;
        const R = 1.4 + 11 * g, r = 1.2 + 4.8 * g;
        const heat = Math.exp(-t / 4.2);
        const vis = smooth(0, 0.9, u) * (1 - smooth(20, 36, t));
        const ids = d.slot;
        for (let i = 0; i < CAP_N; i++) {
          const phi = d.ph[i] - 1.15 * u;
          const rho = R + r * d.rr[i] * Math.cos(phi) + Math.cos(d.ph2[i]) * 0.5;
          const yy = C + r * d.rr[i] * Math.sin(phi) * 0.85;
          const px = x + Math.cos(d.th[i]) * rho, pz = z + Math.sin(d.th[i]) * rho;
          const sz = 2.4 + 2.8 * g + Math.sin(d.ph2[i]) * 0.5;
          const hot = heat * (0.4 + 0.6 * (0.5 - 0.5 * Math.sin(phi)));
          const rC = 0.3 + (1.3 - 0.3) * hot, gC = 0.26 + (0.55 - 0.26) * hot, bC = 0.23 + (0.15 - 0.23) * hot;
          h.capSmoke.set(ids + i, px, yy, pz, sz * 1.15, rC, gC, bC, 0.8 * vis, d.ph2[i], i % 3);
          h.capGlow.set(ids + i, px, yy, pz, sz * 0.8, 2.2, 0.85, 0.22, 0.55 * hot * vis, d.ph2[i], (i + 1) % 3);
        }
      }
      // ---- shockwave ring + dome ----
      {
        const rs = Math.max(0.01, 40 * t);
        const a = Math.max(0, 1 - t / 1.9);
        d.ring.scale.setScalar(rs); (d.ring.material as THREE.ShaderMaterial).uniforms.uA.value = a * 1.6;
        d.ring.visible = a > 0.01;
        const rd = Math.max(0.01, 30 * t), ad = Math.max(0, 1 - t / 0.85);
        d.dome.scale.setScalar(rd); (d.dome.material as THREE.ShaderMaterial).uniforms.uA.value = ad * 1.1;
        d.dome.visible = ad > 0.01;
      }
      // ---- light + flash + shake ----
      d.light.intensity = 5200 * Math.exp(-t * 1.5) + (t < 7 ? 300 * (1 - t / 7) : 0);
      d.light.position.y = y + 8 + Math.min(14, t * 6);
      const near = 1 / (1 + camD / 70);
      this.grade.flash = Math.max(this.grade.flash, (0.55 + 0.7 * near) * Math.exp(-t * 2.0));
      this.grade.bloomBoost = Math.max(this.grade.bloomBoost, 1.1 * Math.exp(-t * 0.55));
      this.grade.shake = Math.max(this.grade.shake, (0.6 + 1.6 * near) * Math.exp(-t * 0.85) * (t < 9 ? 1 : 0));
      this.grade.tint = Math.max(this.grade.tint, 0.35 * smooth(0.5, 3, t) * (1 - smooth(14, 34, t)));

      // ---- lingering fires, embers, fallout ----
      if (t > 1.2 && t < d.falloutT + 4) {
        const fade = 1 - smooth(d.falloutT - 6, d.falloutT + 4, t);
        for (const s of d.spots) {
          s.acc += dt;
          if (s.acc > 0.18) {
            s.acc = 0;
            const yy = this.heightAt(s.x, s.z);
            if (Math.random() < 0.8 * fade) h.flame(s.x, yy + 0.2, s.z, rand(0.9, 1.8));
            if (Math.random() < 0.55 * fade) h.blackSmoke(s.x, yy + 1, s.z, rand(1.2, 2.4));
          }
        }
        d.acc.ember += dt * 18 * fade;
        while (d.acc.ember >= 1) {
          d.acc.ember--;
          const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * NUKE.radius * 0.9;
          const ex = x + Math.cos(a) * r, ez = z + Math.sin(a) * r;
          h.fire.emit({ x: ex, y: this.heightAt(ex, ez) + 0.2, z: ez, vx: rand(-0.4, 0.4), vy: rand(1.5, 4), vz: rand(-0.4, 0.4), life: rand(1, 2.2), size0: 0.28, size1: 0.04, c0: [3, 1.2, 0.3, 1], c1: [0.6, 0.05, 0, 0], tile: 3, drag: 0.2 });
        }
      }
      if (t > 3 && t < d.falloutT) {
        d.acc.fall += dt * 55;
        while (d.acc.fall >= 1) {
          d.acc.fall--;
          const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * NUKE.falloutRadius;
          const ex = x + Math.cos(a) * r, ez = z + Math.sin(a) * r;
          h.fire.emit({ x: ex, y: this.heightAt(ex, ez) + rand(0.2, 1.8), z: ez, vx: rand(-0.2, 0.2), vy: rand(0.3, 1), vz: rand(-0.2, 0.2), life: rand(1.6, 3), size0: 0.5, size1: 1.2, c0: [0.3, 1.8, 0.5, 0.5], c1: [0.1, 0.5, 0.2, 0], tile: 3 });
        }
      }
    }
    // cleanup
    for (let i = this.dets.length - 1; i >= 0; i--) {
      const d = this.dets[i];
      if (d.t > 40) {
        for (let k = 0; k < CAP_N; k++) { this.hub.capSmoke.set(d.slot + k, 0, -99, 0, 0, 0, 0, 0, 0); this.hub.capGlow.set(d.slot + k, 0, -99, 0, 0, 0, 0, 0, 0); }
        this.group.remove(d.ring, d.dome, d.light);
        d.ring.geometry.dispose(); d.dome.geometry.dispose(); d.light.dispose();
        this.dets.splice(i, 1);
      }
    }
  }
  get active() { return this.dets.length > 0; }
}

/** Missile in flight (model + exhaust trail). */
export class MissileFx {
  group = new THREE.Group();
  private missiles = new Map<number, { obj: THREE.Object3D; sx: number; sy: number; sz: number; tx: number; tz: number; ty: number; t0: number; T: number; prev: THREE.Vector3 }>();
  constructor(private hub: FxHub, private makeModel: () => THREE.Object3D, private heightAt: (x: number, z: number) => number) {}
  launch(id: number, sx: number, sz: number, tx: number, tz: number, t0: number, T: number) {
    const obj = this.makeModel(); obj.scale.setScalar(1.6);
    this.group.add(obj);
    const sy = this.heightAt(sx, sz) + 3.5, ty = this.heightAt(tx, tz);
    this.missiles.set(id, { obj, sx, sy, sz, tx, tz, ty, t0, T, prev: new THREE.Vector3(sx, sy, sz) });
    // launch plume
    for (let i = 0; i < 60; i++) this.hub.smoke.emit({ x: sx + rand(-1, 1), y: sy - 2.5, z: sz + rand(-1, 1), vx: rand(-4, 4), vy: rand(0.5, 3), vz: rand(-4, 4), life: rand(2, 4), size0: 1.6, size1: rand(5, 8), drag: 1.0, c0: [0.7, 0.68, 0.64, 0.8], c1: [0.6, 0.6, 0.6, 0] });
  }
  pos(id: number, now: number): THREE.Vector3 | null {
    const m = this.missiles.get(id); if (!m) return null;
    const u = Math.min(1, Math.max(0, (now - m.t0) / m.T));
    const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
    const x = m.sx + (m.tx - m.sx) * e, z = m.sz + (m.tz - m.sz) * e;
    const dist = Math.hypot(m.tx - m.sx, m.tz - m.sz);
    const apex = 28 + dist * 0.55;
    const y = m.sy + (m.ty - m.sy) * u + apex * 4 * u * (1 - u);
    return new THREE.Vector3(x, y, z);
  }
  update(now: number) {
    for (const [id, m] of this.missiles) {
      const p = this.pos(id, now)!;
      const u = (now - m.t0) / m.T;
      if (u >= 1.0) { this.group.remove(m.obj); this.missiles.delete(id); continue; }
      const dir = p.clone().sub(m.prev);
      if (dir.lengthSq() > 1e-8) { dir.normalize(); m.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); }
      m.obj.position.copy(p);
      // exhaust
      const back = dir.clone().multiplyScalar(-1);
      for (let i = 0; i < 6; i++) {
        const q = p.clone().addScaledVector(back, 1.6 + Math.random() * 0.8);
        this.hub.fire.emit({ x: q.x, y: q.y, z: q.z, vx: back.x * 5 + rand(-0.5, 0.5), vy: back.y * 5, vz: back.z * 5 + rand(-0.5, 0.5), life: rand(0.25, 0.5), size0: 1.3, size1: 0.3, c0: [3.2, 1.7, 0.4, 1], c1: [0.8, 0.1, 0, 0] });
        this.hub.smoke.emit({ x: q.x, y: q.y, z: q.z, vx: rand(-0.4, 0.4), vy: rand(-0.4, 0.4), vz: rand(-0.4, 0.4), life: rand(2.5, 4.5), size0: 0.9, size1: rand(3.5, 5.5), drag: 0.4, c0: [0.75, 0.75, 0.72, 0.6], c1: [0.6, 0.6, 0.6, 0] });
      }
      m.prev.copy(p);
    }
  }
}

/** Pulsing danger zone drawn on the ground where a missile will land. */
export class DangerZones {
  group = new THREE.Group();
  private zones = new Map<number, { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t0: number; T: number }>();
  constructor(private heightAt: (x: number, z: number) => number) {}
  add(id: number, x: number, z: number, t0: number, T: number) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uP: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vP; uniform float uT; uniform float uP;
        void main(){ float r = length(vP);
          float ang = atan(vP.y, vP.x);
          float edge = smoothstep(0.93,0.985,r) * (1.0 - smoothstep(0.99,1.0,r));
          float dash = step(0.0, sin(ang * 28.0 - uT * 2.5));
          float pulse = 0.5 + 0.5 * sin(uT * (3.0 + uP * 9.0));
          float fill = (1.0 - smoothstep(0.0, 1.0, r)) * (0.10 + 0.14 * pulse * (0.4 + uP));
          float rings = smoothstep(0.02, 0.0, abs(fract(r * 3.0 - uT * 0.25) - 0.5) - 0.47) * 0.16;
          float a = edge * (0.55 + 0.35 * dash) + fill + rings * (1.0 - r);
          gl_FragColor = vec4(vec3(1.0, 0.18 + 0.2 * pulse, 0.1), a); }`,
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(NUKE.radius, 96), mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, this.heightAt(x, z) + 0.6, z); mesh.renderOrder = 8; mesh.frustumCulled = false;
    mesh.scale.setScalar(1);
    // CircleGeometry(radius) has positions up to radius; normalise in shader via scale trick
    (mesh.geometry as THREE.CircleGeometry).scale(1 / NUKE.radius, 1 / NUKE.radius, 1);
    mesh.scale.setScalar(NUKE.radius);
    this.group.add(mesh);
    this.zones.set(id, { mesh, mat, t0, T });
  }
  remove(id: number) { const z = this.zones.get(id); if (!z) return; this.group.remove(z.mesh); z.mesh.geometry.dispose(); z.mat.dispose(); this.zones.delete(id); }
  update(now: number, clock: number) {
    for (const z of this.zones.values()) { z.mat.uniforms.uT.value = clock; z.mat.uniforms.uP.value = Math.min(1, Math.max(0, (now - z.t0) / z.T)); }
  }
}
