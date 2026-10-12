import * as THREE from 'three';
import type { GameView } from '../render/view';
import type { Command, Entity, Unit, World } from '../sim/world';
import { N } from '../sim/map';
import { NUKE, type BRole } from '../data/game';

export type Mode = { k: 'normal' } | { k: 'place'; role: BRole } | { k: 'nuke'; silo: number } | { k: 'attackmove' } | { k: 'rally'; building: number };

export class Controls {
  mode: Mode = { k: 'normal' };
  groups = new Map<number, number[]>();
  onChange: () => void = () => {};
  onNotify: (msg: string) => void = () => {};
  onCommandSound: (kind: 'move' | 'attack' | 'gather' | 'build' | 'select' | 'error' | 'nuke') => void = () => {};
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, in: false };
  private drag: { x0: number; y0: number; on: boolean; shift: boolean } | null = null;
  private mid: { x: number; yaw: number } | null = null;
  private box: HTMLDivElement;
  private reticle: THREE.Mesh;
  private lastClick = { t: 0, id: 0 };
  private lastGroup = { n: 0, t: 0 };
  humanId = 0;
  disabled = false;

  constructor(private view: GameView, private world: World, private host: HTMLElement) {
    this.box = document.createElement('div'); this.box.className = 'selbox'; this.box.style.display = 'none'; document.body.appendChild(this.box);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vP; uniform float uT; void main(){ float r = length(vP); float e = smoothstep(0.92,0.98,r)*(1.0-smoothstep(0.99,1.0,r)); float cross = (step(abs(vP.x),0.012)+step(abs(vP.y),0.012)) * (1.0 - smoothstep(0.0,0.4,r)) ; float fill = (1.0 - r) * 0.12; gl_FragColor = vec4(1.0, 0.2 + 0.2*sin(uT*8.0), 0.1, e*0.9 + fill + cross*0.8); }`,
    });
    const g = new THREE.CircleGeometry(1, 64);
    this.reticle = new THREE.Mesh(g, mat); this.reticle.rotation.x = -Math.PI / 2; this.reticle.scale.setScalar(NUKE.radius); this.reticle.visible = false; this.reticle.renderOrder = 8; this.reticle.frustumCulled = false;
    view.scene.add(this.reticle);

    const el = view.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', this.onDown);
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('pointerleave', () => { this.mouse.in = false; });
    el.addEventListener('pointerenter', () => { this.mouse.in = true; });
  }

  get selectedIds() { return [...this.view.selection]; }
  selectedUnits(): Unit[] { return this.selectedIds.map((i) => this.world.get(i)).filter((e): e is Unit => !!e && e.kind === 'unit' && e.owner === this.humanId); }
  selectedEntities(): Entity[] { return this.selectedIds.map((i) => this.world.get(i)).filter((e): e is Entity => !!e); }
  select(ids: number[], add = false) {
    if (!add) this.view.selection.clear();
    for (const i of ids) this.view.selection.add(i);
    this.onChange();
  }
  issue(c: Command) { this.world.issue(this.humanId, c); }
  setMode(m: Mode) { this.mode = m; this.view.showPlacement(null, 0, 0, 0, true); this.reticle.visible = m.k === 'nuke'; if (m.k === 'nuke' || m.k === 'place') this.updateHover(); this.onChange(); }
  cancelMode() { if (this.mode.k !== 'normal') this.setMode({ k: 'normal' }); }

  private local(e: PointerEvent | MouseEvent) { const r = this.view.renderer.domElement.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  private onDown = (e: PointerEvent) => {
    if (this.disabled) return;
    if (this.view.cinematic) { this.view.stopCinematic(); return; }
    const p = this.local(e);
    if (e.button === 1) { this.mid = { x: e.clientX, yaw: this.view.rig.gyaw }; e.preventDefault(); return; }
    if (e.button === 0) {
      if (this.mode.k !== 'normal') { this.confirmMode(p.x, p.y, e.shiftKey); return; }
      this.drag = { x0: p.x, y0: p.y, on: false, shift: e.shiftKey };
    } else if (e.button === 2) {
      if (this.mode.k !== 'normal') { this.cancelMode(); return; }
      this.rightClick(p.x, p.y);
    }
  };
  private onMove = (e: PointerEvent) => {
    const p = this.local(e); this.mouse.x = p.x; this.mouse.y = p.y;
    if (this.mid) { this.view.rig.gyaw = this.mid.yaw + (e.clientX - this.mid.x) * 0.006; return; }
    if (this.drag) {
      if (!this.drag.on && Math.hypot(p.x - this.drag.x0, p.y - this.drag.y0) > 6) this.drag.on = true;
      if (this.drag.on) {
        const r = this.view.renderer.domElement.getBoundingClientRect();
        const x0 = Math.min(this.drag.x0, p.x) + r.left, x1 = Math.max(this.drag.x0, p.x) + r.left, y0 = Math.min(this.drag.y0, p.y) + r.top, y1 = Math.max(this.drag.y0, p.y) + r.top;
        Object.assign(this.box.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px' });
      }
    }
    this.updateHover();
  };
  private onUp = (e: PointerEvent) => {
    if (e.button === 1) { this.mid = null; return; }
    if (e.button !== 0 || !this.drag) return;
    const p = this.local(e);
    const d = this.drag; this.drag = null; this.box.style.display = 'none';
    if (d.on) this.boxSelect(d.x0, d.y0, p.x, p.y, d.shift);
    else this.clickSelect(p.x, p.y, d.shift);
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = this.view.rig;
    r.gdist = Math.min(80, Math.max(13, r.gdist * (1 + Math.sign(e.deltaY) * 0.12)));
  };

  private clickSelect(x: number, y: number, add: boolean) {
    const hit = this.view.pickEntity(x, y);
    if (!hit) { if (!add) this.select([]); return; }
    const ent = this.world.get(hit.id);
    if (!ent) return;
    const now = performance.now();
    if (hit.kind === 'unit' && ent.owner === this.humanId && this.lastClick.id === hit.id && now - this.lastClick.t < 350) {
      // double click: same kind on screen
      const model = (ent as Unit).def.model;
      const ids = this.world.units.filter((u) => !u.dead && u.owner === this.humanId && u.def.model === model && this.view.project(u.x, this.world.heightAt(u.x, u.y), u.y).on).map((u) => u.id);
      this.select(ids, add); this.lastClick = { t: 0, id: 0 }; return;
    }
    this.lastClick = { t: now, id: hit.id };
    if (this.mode.k === 'normal' && ent.owner !== this.humanId && add) return;
    this.select([hit.id], add && ent.owner === this.humanId);
    if (ent.owner === this.humanId) this.onCommandSound('select');
  }
  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean) {
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    const ids: number[] = [];
    for (const u of this.world.units) {
      if (u.dead || u.owner !== this.humanId) continue;
      const s = this.view.project(u.x, this.world.heightAt(u.x, u.y) + 0.8, u.y);
      if (s.on && s.x >= xa && s.x <= xb && s.y >= ya && s.y <= yb) ids.push(u.id);
    }
    if (ids.length) { this.select(ids, add); this.onCommandSound('select'); }
    else if (!add) this.select([]);
  }

  private confirmMode(px: number, py: number, shift: boolean) {
    const g = this.view.pickGround(px, py); if (!g) return;
    const m = this.mode;
    if (m.k === 'place') {
      const def = this.world.tribe(this.humanId).buildings[m.role];
      const ws = this.selectedUnits().filter((u) => u.def.role === 'warga').map((u) => u.id);
      const fx = Math.round(g.x - def.size / 2), fy = Math.round(g.z - def.size / 2);
      if (!this.world.canPlace(fx, fy, def.size) || !this.world.canAfford(this.humanId, def.cost)) { this.onCommandSound('error'); this.onNotify(!this.world.canAfford(this.humanId, def.cost) ? 'Sumber daya kurang!' : 'Tempat tidak cocok.'); return; }
      const before = this.world.buildings.length;
      this.issue({ t: 'build', ids: ws, role: m.role, x: fx + def.size / 2, y: fy + def.size / 2 });
      if (this.world.buildings.length > before) { this.onCommandSound('build'); this.view.ping(fx + def.size / 2, fy + def.size / 2, 0xfff0a0, def.size * 0.7); }
      if (!shift) this.setMode({ k: 'normal' }); else this.updateHover();
      this.onChange();
    } else if (m.k === 'nuke') {
      this.issue({ t: 'nuke', silo: m.silo, x: g.x, y: g.z });
      this.onCommandSound('nuke');
      this.setMode({ k: 'normal' });
    } else if (m.k === 'attackmove') {
      const ids = this.selectedUnits().map((u) => u.id);
      this.issue({ t: 'move', ids, x: g.x, y: g.z, attack: true }); this.view.ping(g.x, g.z, 0xff6a4a); this.onCommandSound('attack');
      this.setMode({ k: 'normal' });
    } else if (m.k === 'rally') {
      const hit = this.view.pickEntity(px, py);
      const tgt = hit && hit.kind === 'resource' ? hit.id : undefined;
      this.issue({ t: 'rally', building: m.building, x: g.x, y: g.z, target: tgt }); this.view.ping(g.x, g.z, 0xfff0a0);
      this.setMode({ k: 'normal' });
    }
  }

  private rightClick(px: number, py: number) {
    const units = this.selectedUnits();
    const ents = this.selectedEntities();
    const hit = this.view.pickEntity(px, py);
    const g = this.view.pickGround(px, py);
    const mineB = ents.filter((e) => e.kind === 'building' && e.owner === this.humanId);
    if (!units.length && mineB.length) {
      if (g) for (const b of mineB) { this.issue({ t: 'rally', building: b.id, x: g.x, y: g.z, target: hit && hit.kind === 'resource' ? hit.id : undefined }); }
      if (g) { this.view.ping(g.x, g.z, 0xfff0a0); this.onCommandSound('move'); }
      return;
    }
    if (!units.length) return;
    const ids = units.map((u) => u.id);
    if (hit) {
      const ent = this.world.get(hit.id);
      if (ent && ent.kind === 'resource' && units.some((u) => u.def.role === 'warga')) {
        this.issue({ t: 'gather', ids: units.filter((u) => u.def.role === 'warga').map((u) => u.id), target: ent.id });
        this.view.ping(ent.x, ent.y, 0x6dff8a, 1.2); this.onCommandSound('gather'); return;
      }
      if (ent && ent.kind !== 'resource' && ent.owner !== this.humanId) {
        this.issue({ t: 'attack', ids, target: ent.id });
        this.view.ping(ent.x, ent.y, 0xff4a4a, 1.4); this.onCommandSound('attack'); return;
      }
      if (ent && ent.kind === 'building' && ent.owner === this.humanId && !ent.built) {
        this.issue({ t: 'help', ids, target: ent.id }); this.view.ping(ent.x, ent.y, 0xfff0a0, ent.size * 0.6); this.onCommandSound('build'); return;
      }
    }
    if (g) { this.issue({ t: 'move', ids, x: g.x, y: g.z }); this.view.ping(g.x, g.z); this.onCommandSound('move'); }
  }

  private updateHover() {
    const g = this.view.pickGround(this.mouse.x, this.mouse.y);
    if (!g) return;
    const m = this.mode;
    if (m.k === 'place') {
      const def = this.world.tribe(this.humanId).buildings[m.role];
      const fx = Math.round(g.x - def.size / 2), fy = Math.round(g.z - def.size / 2);
      const ok = this.world.canPlace(fx, fy, def.size);
      this.view.showPlacement(def.model, fx + def.size / 2, fy + def.size / 2, def.size, ok);
    } else if (m.k === 'nuke') {
      this.reticle.position.set(g.x, this.world.heightAt(g.x, g.z) + 0.6, g.z); this.reticle.visible = true;
    }
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.disabled) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.keys.add(e.code);
    const c = e.code;
    if (this.view.cinematic) this.view.stopCinematic();
    if (c === 'Escape') { this.cancelMode(); return; }
    if (c.startsWith('Digit') && c !== 'Digit0') {
      const n = Number(c.slice(5));
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.groups.set(n, this.selectedUnits().map((u) => u.id)); this.onNotify(`Grup ${n} disimpan`); return; }
      const g = (this.groups.get(n) ?? []).filter((id) => this.world.get(id));
      if (g.length) {
        this.select(g);
        const now = performance.now();
        if (this.lastGroup.n === n && now - this.lastGroup.t < 400) { const u = this.world.get(g[0]); if (u) this.view.focus(u.x, u.y); }
        this.lastGroup = { n, t: now };
      }
      return;
    }
    switch (c) {
      case 'KeyH': { const tc = this.world.tc(this.humanId); if (tc) { this.view.focus(tc.x, tc.y); this.select([tc.id]); } break; }
      case 'KeyS': if (!e.ctrlKey) this.issue({ t: 'stop', ids: this.selectedUnits().map((u) => u.id) }); break;
      case 'KeyA': if (this.selectedUnits().some((u) => u.def.role !== 'warga')) { this.setMode({ k: 'attackmove' }); this.onNotify('Serang-sambil-jalan: klik tujuan'); } break;
      case 'KeyQ': this.view.rig.gyaw -= 0.4; break;
      case 'KeyE': this.view.rig.gyaw += 0.4; break;
      case 'Space': { e.preventDefault(); const s = this.selectedEntities()[0]; if (s) this.view.focus(s.x, s.y); break; }
      case 'Period': { const idle = this.world.units.find((u) => !u.dead && u.owner === this.humanId && u.def.role === 'warga' && u.state === 'idle'); if (idle) { this.view.focus(idle.x, idle.y); this.select([idle.id]); } break; }
    }
  };

  /** Per-frame: keyboard / edge camera panning. */
  update(dt: number) {
    if (this.disabled) return;
    const r = this.view.rig;
    let mx = 0, mz = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyS') && !k.has('ControlLeft') && false) mz -= 1;
    if (k.has('ArrowDown')) mz -= 1;
    if (k.has('KeyA') && false) mx -= 1;
    if (k.has('ArrowLeft')) mx -= 1;
    // WASD (A/S double as commands, so pan keys only act while held without selection modifiers)
    if (k.has('KeyS') && this.selectedUnits().length === 0) mz -= 1;
    if (k.has('KeyA') && this.selectedUnits().length === 0) mx -= 1;
    const W = this.view.width(), H = this.view.height();
    if (this.mouse.in && !this.mid && !this.drag?.on) {
      const edge = 8;
      if (this.mouse.x < edge) mx -= 1; if (this.mouse.x > W - edge) mx += 1;
      if (this.mouse.y < edge) mz += 1; if (this.mouse.y > H - edge) mz -= 1;
    }
    if (mx || mz) {
      const sp = (r.gdist * 0.9 + 8) * dt * (k.has('ShiftLeft') ? 2 : 1);
      const fx = -Math.sin(r.yaw), fz = -Math.cos(r.yaw);
      const rx = Math.cos(r.yaw), rz = -Math.sin(r.yaw);
      const l = Math.hypot(mx, mz);
      this.view.pan(((fx * mz + rx * mx) / l) * sp, ((fz * mz + rz * mx) / l) * sp);
    }
    (this.reticle.material as THREE.ShaderMaterial).uniforms.uT.value = this.view.time;
  }
  clampN() { return N; }
}
