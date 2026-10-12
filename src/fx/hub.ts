import * as THREE from 'three';
import { ParticleSystem, type Emit } from './particles';
import { makeSpriteAtlas } from './textures';

/** Shared particle pools used by every effect. */
export class FxHub {
  group = new THREE.Group();
  smoke: ParticleSystem;      // normal blend, dynamic
  fire: ParticleSystem;       // additive, dynamic
  capSmoke: ParticleSystem;   // normal blend, analytic (mushroom cap)
  capGlow: ParticleSystem;    // additive, analytic
  atlas: THREE.Texture;
  constructor() {
    this.atlas = makeSpriteAtlas();
    this.smoke = new ParticleSystem(9000, this.atlas, false, 'smoke');
    this.fire = new ParticleSystem(7000, this.atlas, true, 'fire');
    this.capSmoke = new ParticleSystem(1600, this.atlas, false, 'capSmoke'); this.capSmoke.analytic = true;
    this.capGlow = new ParticleSystem(1600, this.atlas, true, 'capGlow'); this.capGlow.analytic = true;
    this.capSmoke.mesh.renderOrder = 12; this.capGlow.mesh.renderOrder = 13;
    this.group.add(this.smoke.mesh, this.capSmoke.mesh, this.fire.mesh, this.capGlow.mesh);
  }
  update(dt: number) { this.smoke.update(dt); this.fire.update(dt); this.capSmoke.update(dt); this.capGlow.update(dt); }

  // ---- small helpers ----
  puff(x: number, y: number, z: number, n: number, opts: Partial<Emit> & { spread?: number; speed?: number } = {}) {
    const sp = opts.spread ?? 0.4, v = opts.speed ?? 1.2;
    for (let i = 0; i < n; i++) {
      this.smoke.emit({
        x: x + (Math.random() - 0.5) * sp, y, z: z + (Math.random() - 0.5) * sp,
        vx: (Math.random() - 0.5) * v, vy: 0.4 + Math.random() * v, vz: (Math.random() - 0.5) * v,
        life: 0.9 + Math.random() * 0.8, size0: 0.4, size1: 1.3, drag: 1.5, rise: 0.4,
        c0: [0.55, 0.5, 0.42, 0.55], c1: [0.5, 0.48, 0.45, 0], ...opts,
      });
    }
  }
  sparks(x: number, y: number, z: number, n: number, color: [number, number, number] = [3, 2, 0.8], speed = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, up = 0.6 + Math.random() * 1.4;
      this.fire.emit({ x, y, z, vx: Math.cos(a) * speed * Math.random(), vy: up * speed * 0.7, vz: Math.sin(a) * speed * Math.random(), life: 0.25 + Math.random() * 0.35, size0: 0.22, size1: 0.02, grav: 9, drag: 0.5, c0: [color[0], color[1], color[2], 1], c1: [color[0], color[1] * 0.3, 0, 0], tile: 3 });
    }
  }
  flame(x: number, y: number, z: number, size = 1) {
    this.fire.emit({ x: x + (Math.random() - 0.5) * size * 0.5, y, z: z + (Math.random() - 0.5) * size * 0.5, vy: 1.5 + Math.random() * 1.5, vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 0.5 + Math.random() * 0.5, size0: 0.9 * size, size1: 0.2 * size, c0: [2.4, 1.1, 0.3, 0.9], c1: [0.6, 0.08, 0, 0], tile: Math.floor(Math.random() * 3) });
  }
  blackSmoke(x: number, y: number, z: number, size = 1) {
    this.smoke.emit({ x: x + (Math.random() - 0.5) * size * 0.4, y, z: z + (Math.random() - 0.5) * size * 0.4, vy: 1.4 + Math.random(), vx: 0.4 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 2.6 + Math.random() * 1.6, size0: 0.8 * size, size1: 3.2 * size, c0: [0.1, 0.1, 0.1, 0.7], c1: [0.2, 0.2, 0.2, 0], drag: 0.3 });
  }
  explosion(x: number, y: number, z: number, scale = 1) {
    for (let i = 0; i < 18 * scale; i++) {
      const a = Math.random() * 6.283, r = Math.random() * 0.8 * scale;
      this.fire.emit({ x: x + Math.cos(a) * r, y: y + Math.random() * 0.5, z: z + Math.sin(a) * r, vx: Math.cos(a) * 2.5 * scale, vy: 1.5 + Math.random() * 3, vz: Math.sin(a) * 2.5 * scale, life: 0.5 + Math.random() * 0.5, size0: 0.8 * scale, size1: 2.3 * scale, drag: 1.4, c0: [3, 1.9, 0.6, 1], c1: [0.7, 0.1, 0, 0] });
    }
    for (let i = 0; i < 12 * scale; i++) this.smoke.emit({ x: x + (Math.random() - 0.5), y, z: z + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 3, life: 1.6 + Math.random(), size0: 0.9 * scale, size1: 3.2 * scale, c0: [0.2, 0.17, 0.14, 0.8], c1: [0.3, 0.3, 0.3, 0], drag: 0.8 });
    this.sparks(x, y + 0.3, z, 14 * scale, [3, 1.8, 0.5], 7);
  }
}
