import { NUKE, type BRole, type ResKind, type Role } from '../data/game';
import type { Building, Resource, Unit, World } from './world';

export type Difficulty = 'mudah' | 'sedang' | 'sulit';
const TIMES: Record<Difficulty, { epoch: number[]; wave: number; workers: number; think: number }> = {
  mudah: { epoch: [0, 200, 440, 760], wave: 10, workers: 11, think: 1.6 },
  sedang: { epoch: [0, 140, 320, 560], wave: 8, workers: 15, think: 1.0 },
  sulit: { epoch: [0, 105, 250, 430], wave: 7, workers: 19, think: 0.7 },
};

export class AI {
  private next = 2;
  private waveSize: number;
  private waves = 0;
  private lastWave = 0;
  private saving = false;
  private rnd: () => number;
  private cfg;
  constructor(private w: World, private p: number, diff: Difficulty = 'sedang') {
    this.cfg = TIMES[diff];
    this.waveSize = this.cfg.wave;
    this.rnd = w.rng;
  }
  get pl() { return this.w.players[this.p]; }

  update() {
    const w = this.w;
    if (w.time < this.next || w.winner >= 0) return;
    this.next = w.time + this.cfg.think;
    const tc = w.tc(this.p);
    if (!tc || !tc.built) return;
    const units = w.playerUnits(this.p);
    const workers = units.filter((u) => u.def.role === 'warga');
    const army = units.filter((u) => u.def.role !== 'warga');
    this.economy(tc, workers);
    this.build(tc, workers);
    this.research(tc, workers);
    this.train(tc, workers, army);
    this.nuke();
    this.military(tc, army);
  }

  // -------------------------------------------------------------- economy
  private economy(tc: Building, workers: Unit[]) {
    const w = this.w;
    const idle = workers.filter((u) => u.state === 'idle');
    // rebalance: if the next epoch/nuke needs gold we lack, pull a few surplus gatherers onto gold
    const needGold = (this.pl.epoch < 4 ? (this.pl.tribe.epochs[this.pl.epoch].cost.emas ?? 0) : NUKE.cost.emas ?? 0) + 60;
    if (this.pl.res.emas < needGold) {
      const onGold = workers.filter((u) => u.state === 'gather' && u.gKind === 'emas').length;
      if (onGold < 4) {
        const donors = workers.filter((u) => u.state === 'gather' && u.gKind && u.gKind !== 'emas' && this.pl.res[u.gKind] > 350).slice(0, 4 - onGold);
        for (const u of donors) { const r = this.nearestResource('emas', tc, u); if (r) w.orderGather(u, r); }
      }
    }
    if (!idle.length) return;
    const count: Record<ResKind, number> = { pangan: 0, kayu: 0, emas: 0 };
    for (const u of workers) if (u.state === 'gather' && u.gKind) count[u.gKind]++;
    const want: Record<ResKind, number> = this.pl.epoch >= 2 ? { pangan: 0.38, kayu: 0.37, emas: 0.25 } : { pangan: 0.5, kayu: 0.42, emas: 0.08 };
    const total = Math.max(1, workers.length);
    if (this.pl.res.emas < needGold) want.emas += 0.3;
    for (const k of ['pangan', 'kayu', 'emas'] as ResKind[]) want[k] *= 1 / (1 + this.pl.res[k] / 450);
    const sum = want.pangan + want.kayu + want.emas; for (const k of ['pangan', 'kayu', 'emas'] as ResKind[]) want[k] /= sum;
    for (const u of idle) {
      // try kinds from most to least under-served until one has a reachable node
      const kinds = (['pangan', 'kayu', 'emas'] as ResKind[]).sort((a, b) => (want[b] - count[b] / total) - (want[a] - count[a] / total));
      for (const kind of kinds) {
        const r = this.nearestResource(kind, tc, u);
        if (r) { w.orderGather(u, r); count[kind]++; break; }
      }
    }
  }
  private nearestResource(kind: ResKind, tc: Building, u: Unit): Resource | null {
    let best: Resource | null = null, bd = 1e9;
    for (const r of this.w.resources) {
      if (r.dead || r.res !== kind || r.gatherers >= (r.res === 'kayu' ? 4 : 8)) continue;
      const d = Math.hypot(r.x - tc.x, r.y - tc.y) * 1.2 + Math.hypot(r.x - u.x, r.y - u.y) * 0.3;
      if (d < bd && d < 60) { bd = d; best = r; }
    }
    return best;
  }

  // -------------------------------------------------------------- buildings
  private findSpot(tc: Building, size: number, minR: number, maxR: number): { x: number; y: number } | null {
    const w = this.w;
    for (let r = minR; r <= maxR; r += 1.5) {
      const n = Math.max(8, Math.floor(r * 3));
      const off = this.rnd() * 6.28;
      for (let k = 0; k < n; k++) {
        const a = off + (k / n) * 6.28;
        const fx = Math.round(tc.x + Math.cos(a) * r - size / 2), fy = Math.round(tc.y + Math.sin(a) * r - size / 2);
        if (w.canPlace(fx - 1, fy - 1, size + 2)) return { x: fx + size / 2, y: fy + size / 2 };
      }
    }
    return null;
  }
  private building(role: BRole): Building[] { return this.w.playerBuildings(this.p, role); }
  private tryBuild(role: BRole, tc: Building, workers: Unit[], minR = 6, maxR = 22) {
    const w = this.w; const def = this.pl.tribe.buildings[role];
    if (!w.canAfford(this.p, def.cost) || def.epoch > this.pl.epoch) return false;
    const free = workers.filter((u) => u.state !== 'build');
    if (!free.length) return false;
    const spot = this.findSpot(tc, def.size, minR, maxR); if (!spot) return false;
    const builders = free.slice().sort((a, b) => Math.hypot(a.x - spot.x, a.y - spot.y) - Math.hypot(b.x - spot.x, b.y - spot.y)).slice(0, 2).map((u) => u.id);
    w.issue(this.p, { t: 'build', ids: builders, role, x: spot.x, y: spot.y });
    return true;
  }
  private build(tc: Building, workers: Unit[]) {
    const pl = this.pl;
    const houses = this.building('house'), barracks = this.building('barracks'), reactors = this.building('reactor');
    const pending = (r: BRole) => this.building(r).some((b) => !b.built);
    if (pl.pop + 5 >= pl.popCap && !pending('house') && pl.popCap < 90) this.tryBuild('house', tc, workers, 5, 16);
    const wantBarracks = (pl.epoch >= 3 ? 3 : pl.epoch >= 2 ? 2 : 1) + (pl.res.kayu > 800 && pl.res.pangan > 300 ? 1 : 0);
    if (workers.length >= 6 && barracks.length < wantBarracks && !pending('barracks')) this.tryBuild('barracks', tc, workers, 7, 20);
    if (pl.epoch >= 4 && reactors.length < 1 && !pending('reactor') && workers.length >= 8) this.tryBuild('reactor', tc, workers, 9, 22);
    void houses;
  }

  // -------------------------------------------------------------- research
  private research(tc: Building, workers: Unit[]) {
    const pl = this.pl, w = this.w;
    if (tc.queue.some((q) => q.kind !== 'unit')) return;
    this.saving = false;
    if (pl.epoch < 4 && w.time >= this.cfg.epoch[pl.epoch] && workers.length >= 8) {
      if (w.canAfford(this.p, pl.tribe.epochs[pl.epoch].cost)) { w.issue(this.p, { t: 'research', building: tc.id, kind: 'epoch' }); return; }
      this.saving = true;       // stop spending so the next epoch can be bought
    }
    for (const t of pl.tribe.techs) {
      if (!pl.techs.has(t.id) && t.epoch <= pl.epoch && w.canAfford(this.p, t.cost) && pl.res.pangan > 450) {
        w.issue(this.p, { t: 'research', building: tc.id, kind: 'tech', id: t.id });
        return;
      }
    }
  }

  // -------------------------------------------------------------- training
  private train(tc: Building, workers: Unit[], army: Unit[]) {
    const w = this.w, pl = this.pl;
    const queuedW = tc.queue.filter((q) => q.id === 'warga').length;
    if (workers.length + queuedW < this.cfg.workers + (pl.epoch - 1) * 3 && tc.queue.length < 2 && !(this.saving && workers.length >= 12)) w.issue(this.p, { t: 'train', building: tc.id, role: 'warga' });
    if (pl.epoch >= 2 && !army.some((u) => u.def.role === 'hero') && tc.queue.length < 2 && pl.res.emas >= 160) w.issue(this.p, { t: 'train', building: tc.id, role: 'hero' });
    for (const b of this.building('barracks')) {
      if (!b.built || b.queue.length >= 2 || (this.saving && army.length >= 3)) continue;
      const r = this.rnd();
      let role: Role = 'prajurit';
      if (pl.epoch >= 3 && r < 0.28) role = 'siege';
      else if (pl.epoch >= 2 && r < 0.6) role = 'pemanah';
      w.issue(this.p, { t: 'train', building: b.id, role });
      if (!b.rally) b.rally = { x: tc.x + (this.p === 1 ? -7 : 7), y: tc.y + (this.p === 1 ? -7 : 7), target: 0 };
    }
  }

  // -------------------------------------------------------------- nuke
  private nuke() {
    const w = this.w, pl = this.pl;
    if (pl.epoch < 4 || w.time < pl.nukeReadyAt) return;
    const silo = this.building('reactor').find((b) => b.built);
    if (!silo || !w.canAfford(this.p, NUKE.cost)) return;
    const foe = 1 - this.p;
    // aim for the densest cluster of enemy buildings/units; prefer their keraton
    const tc = w.tc(foe);
    let tx = tc ? tc.x : 0, ty = tc ? tc.y : 0;
    if (!tc) return;
    const ox = (this.rnd() - 0.5) * 5, oy = (this.rnd() - 0.5) * 5;
    w.issue(this.p, { t: 'nuke', silo: silo.id, x: tx + ox, y: ty + oy });
  }

  // -------------------------------------------------------------- military
  private military(tc: Building, army: Unit[]) {
    const w = this.w;
    const foeTc = w.tc(1 - this.p);
    // defend: enemies near my base
    let threat: Unit | null = null;
    for (const u of w.units) if (!u.dead && u.owner !== this.p && Math.hypot(u.x - tc.x, u.y - tc.y) < 16) { threat = u; break; }
    if (threat) {
      for (const u of army) if (u.state === 'idle' || u.state === 'move') { u.state = 'attack'; u.target = threat.id; }
      return;
    }
    const idleArmy = army.filter((u) => u.state === 'idle' && u.def.role !== 'hero');
    if (idleArmy.length >= this.waveSize && foeTc && w.time - this.lastWave > 40) {
      this.waves++; this.lastWave = w.time; this.waveSize += 3;
      const ids = army.filter((u) => u.state === 'idle').map((u) => u.id);
      w.issue(this.p, { t: 'move', ids, x: foeTc.x + (this.p === 1 ? 4 : -4), y: foeTc.y + (this.p === 1 ? 4 : -4), attack: true });
    }
  }
}
