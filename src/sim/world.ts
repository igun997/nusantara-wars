import { TRIBES, NUKE, START_RES, type BuildingDef, type BRole, type Cost, type ResKind, type Role, type TribeDef, type TribeId, type UnitDef, type MapPreset } from '../data/game';
import { generateMap, heightAt, N, Cell, type GameMap } from './map';
import { Pather, type V2 } from './path';
import { mulberry32, type Rng } from './rng';

export const DT = 0.05;                  // 20 ticks / second
export type UState = 'idle' | 'move' | 'attack' | 'gather' | 'build';

interface Base { id: number; owner: number; x: number; y: number; hp: number; maxHp: number; dead: boolean }
export interface Unit extends Base {
  kind: 'unit'; def: UnitDef; state: UState;
  path: V2[]; pi: number; want: V2 | null; pathAge: number;
  target: number; atkMove: V2 | null; homeX: number; homeY: number;
  carryKind: ResKind | null; carry: number; gPhase: 'goto' | 'work' | 'return'; gTimer: number; gRes: number; gKind: ResKind | null;
  cd: number; face: number; moving: boolean; stuck: number; lastX: number; lastY: number;
  laughUntil: number; poisonUntil: number; abilityCd: number; swing: number;
  prevX: number; prevY: number; lastHit: number;
}
export interface QItem { kind: 'unit' | 'epoch' | 'tech'; id: string; total: number; left: number; cost: Cost }
export interface Building extends Base {
  kind: 'building'; def: BuildingDef; fx: number; fy: number; size: number;
  progress: number; built: boolean; queue: QItem[]; rally: { x: number; y: number; target: number } | null;
  builders: number; flash: number;
}
export interface Resource extends Base { kind: 'resource'; res: ResKind; amount: number; max: number; model: string; size: number; fx: number; fy: number; gatherers: number; resKind: 'tree' | 'paddy' | 'gold' }
export type Entity = Unit | Building | Resource;

export interface Mods { dmg: number; rangedDmg: number; hp: number; gather: number; speed: number; buildSpeed: number; radResist: number }
export interface Player {
  id: number; tribe: TribeDef; res: Record<ResKind, number>; epoch: number; techs: Set<string>;
  pop: number; popCap: number; nukeReadyAt: number; mods: Mods; ai: boolean; alive: boolean;
  stats: { kills: number; lost: number; gathered: number; nukes: number };
}
export interface NukeShot { id: number; owner: number; silo: number; tx: number; ty: number; t0: number; launchAt: number; impactAt: number; launched: boolean; done: boolean; sx: number; sy: number }
export interface Blast { id: number; x: number; y: number; t0: number; hit: Set<number>; owner: number }
export interface Fallout { x: number; y: number; r: number; until: number }

export type Command =
  | { t: 'move'; ids: number[]; x: number; y: number; attack?: boolean }
  | { t: 'gather'; ids: number[]; target: number }
  | { t: 'attack'; ids: number[]; target: number }
  | { t: 'build'; ids: number[]; role: BRole; x: number; y: number }
  | { t: 'train'; building: number; role: Role }
  | { t: 'research'; building: number; kind: 'epoch' | 'tech'; id?: string }
  | { t: 'cancel'; building: number; index: number }
  | { t: 'rally'; building: number; x: number; y: number; target?: number }
  | { t: 'stop'; ids: number[] }
  | { t: 'help'; ids: number[]; target: number }
  | { t: 'ability'; id: number }
  | { t: 'nuke'; silo: number; x: number; y: number };

export type GameEvent =
  | { t: 'shot'; fx: number; fy: number; tx: number; ty: number; kind: 'arrow' | 'dart' | 'cannon'; owner: number }
  | { t: 'hit'; x: number; y: number; big: boolean }
  | { t: 'death'; id: number; x: number; y: number; unit: boolean; size: number; owner: number; model: string }
  | { t: 'built'; id: number; owner: number }
  | { t: 'trained'; id: number; owner: number }
  | { t: 'epoch'; owner: number; epoch: number }
  | { t: 'tech'; owner: number; id: string }
  | { t: 'attacked'; owner: number; x: number; y: number }
  | { t: 'nuke_arm'; shot: NukeShot }
  | { t: 'nuke_launch'; shot: NukeShot }
  | { t: 'nuke_hit'; shot: NukeShot }
  | { t: 'nuke_cancel'; shot: NukeShot }
  | { t: 'ability'; owner: number; kind: 'heal' | 'laugh'; x: number; y: number }
  | { t: 'popcap'; owner: number }
  | { t: 'gameover'; winner: number }
  | { t: 'deposit'; owner: number; x: number; y: number; kind: ResKind; amount: number };

export interface WorldOptions { tribes: [TribeId, TribeId]; preset: MapPreset; humans?: number[] }

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export class World {
  map: GameMap;
  time = 0;
  tick = 0;
  ents = new Map<number, Entity>();
  units: Unit[] = [];
  buildings: Building[] = [];
  resources: Resource[] = [];
  players: Player[];
  nukes: NukeShot[] = [];
  blasts: Blast[] = [];
  fallouts: Fallout[] = [];
  occ = new Int32Array(N * N);               // entity id occupying cell (buildings/resources)
  events: GameEvent[] = [];
  winner = -1;
  rng: Rng;
  private nextId = 1;
  private pather = new Pather(N);
  private pathQueue: Unit[] = [];
  private pathCache = new Map<string, { path: V2[]; t: number }>();
  private occVersion = 0;
  private cacheVersion = 0;
  private hash = new Map<number, Unit[]>();
  private lastAttackedEvt = -99;
  burnt = new Uint8Array(N * N);             // cells scorched by nukes (render)

  constructor(opts: WorldOptions) {
    this.map = generateMap(opts.preset);
    this.rng = mulberry32(opts.preset.seed ^ 0x9e3779b9);
    this.players = opts.tribes.map((tid, i) => ({
      id: i, tribe: TRIBES[tid], res: { pangan: START_RES.pangan!, kayu: START_RES.kayu!, emas: START_RES.emas! },
      epoch: 1, techs: new Set<string>(), pop: 0, popCap: 0, nukeReadyAt: 0, ai: !(opts.humans ?? [0]).includes(i), alive: true,
      mods: { dmg: 1, rangedDmg: 1, hp: 1, gather: 1, speed: 1, buildSpeed: 1, radResist: 0 },
      stats: { kills: 0, lost: 0, gathered: 0, nukes: 0 },
    }));
    for (const r of this.map.resources) this.spawnResource(r.kind, r.x, r.y, r.model);
    for (const c of this.map.candiCells) this.occ[c.y * N + c.x] = -1;
    for (let i = 0; i < 2; i++) {
      const s = this.map.spawns[i];
      const tc = this.spawnBuilding(i, 'tc', s.x - 2, s.y - 2, true)!;
      const around: [number, number][] = [[-3.2, 3.5], [-1.4, 3.8], [0.6, 3.8], [2.4, 3.5], [-4.0, 2.0]];
      const dir = i === 0 ? 1 : -1;
      for (let k = 0; k < 5; k++) this.spawnUnit(i, 'warga', s.x + (around[k][0] * dir), s.y + (around[k][1] * dir));
      tc.rally = null;
    }
    this.recomputePop();
    for (const u of this.units) this.autoGatherNear(u);
  }

  // ------------------------------------------------------------------ helpers
  isBlocked = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= N || y >= N) return true;
    const i = y * N + x;
    return this.map.blocked[i] !== 0 || this.occ[i] !== 0;
  };
  heightAt(x: number, y: number) { return heightAt(this.map, x, y); }
  get(id: number) { const e = this.ents.get(id); return e && !e.dead ? e : undefined; }
  tribe(p: number) { return this.players[p].tribe; }
  playerBuildings(p: number, role?: BRole) { return this.buildings.filter((b) => b.owner === p && !b.dead && (!role || b.def.role === role)); }
  playerUnits(p: number) { return this.units.filter((u) => u.owner === p && !u.dead); }
  tc(p: number) { return this.buildings.find((b) => b.owner === p && b.def.role === 'tc' && !b.dead); }
  emit(e: GameEvent) { this.events.push(e); }

  canAfford(p: number, c: Cost) { const r = this.players[p].res; return (c.pangan ?? 0) <= r.pangan && (c.kayu ?? 0) <= r.kayu && (c.emas ?? 0) <= r.emas; }
  pay(p: number, c: Cost, sign = -1) { const r = this.players[p].res; r.pangan += sign * (c.pangan ?? 0); r.kayu += sign * (c.kayu ?? 0); r.emas += sign * (c.emas ?? 0); }

  recomputeMods(p: number) {
    const pl = this.players[p];
    const m: Mods = { dmg: 1, rangedDmg: 1, hp: 1, gather: 1, speed: 1, buildSpeed: 1, radResist: 0 };
    const ep = pl.epoch - 1;
    m.dmg += 0.1 * ep; m.hp += 0.1 * ep;
    for (const t of pl.tribe.techs) {
      if (!pl.techs.has(t.id)) continue;
      const e = t.effect;
      m.buildSpeed += e.buildSpeed ?? 0; m.dmg += e.dmg ?? 0; m.hp += e.hp ?? 0; m.gather += e.gather ?? 0;
      m.speed += e.speed ?? 0; m.rangedDmg += e.rangedDmg ?? 0; m.radResist = Math.max(m.radResist, e.radResist ?? 0);
    }
    pl.mods = m;
    for (const u of this.units) {
      if (u.owner !== p || u.dead || u.def.role === 'warga') continue;
      const nm = this.unitMaxHp(p, u.def);
      u.hp = Math.min(nm, u.hp * (nm / u.maxHp)); u.maxHp = nm;
    }
  }
  unitMaxHp(p: number, d: UnitDef) {
    const pl = this.players[p];
    let hp = d.hp;
    if (d.role !== 'warga') hp *= pl.mods.hp;
    if (d.role === 'prajurit') hp *= pl.tribe.passive.infHp;
    return Math.round(hp);
  }
  recomputePop() {
    for (const pl of this.players) { pl.pop = 0; pl.popCap = 0; }
    for (const u of this.units) if (!u.dead) this.players[u.owner].pop += u.def.pop;
    for (const b of this.buildings) {
      if (b.dead) continue;
      const pl = this.players[b.owner];
      if (b.built) pl.popCap += b.def.popCap;
      for (const q of b.queue) if (q.kind === 'unit') pl.pop += pl.tribe.units[q.id as Role].pop;
    }
  }

  // ------------------------------------------------------------------ spawning
  spawnResource(kind: 'tree' | 'paddy' | 'gold', x: number, y: number, model: string) {
    const size = kind === 'tree' ? 1 : 2;
    const amount = kind === 'tree' ? 100 : kind === 'paddy' ? 600 : 1300;
    const r: Resource = { kind: 'resource', id: this.nextId++, owner: -1, x: x + size / 2, y: y + size / 2, hp: 1, maxHp: 1, dead: false, res: kind === 'tree' ? 'kayu' : kind === 'paddy' ? 'pangan' : 'emas', amount, max: amount, model, size, fx: x, fy: y, gatherers: 0, resKind: kind };
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) this.occ[(y + dy) * N + x + dx] = r.id;
    this.ents.set(r.id, r); this.resources.push(r);
    return r;
  }
  spawnUnit(owner: number, role: Role, x: number, y: number): Unit {
    const def = this.players[owner].tribe.units[role];
    const maxHp = this.unitMaxHp(owner, def);
    const u: Unit = {
      kind: 'unit', id: this.nextId++, owner, x, y, hp: maxHp, maxHp, dead: false, def, state: 'idle',
      path: [], pi: 0, want: null, pathAge: 0, target: 0, atkMove: null, homeX: x, homeY: y,
      carryKind: null, carry: 0, gPhase: 'goto', gTimer: 0, gRes: 0, gKind: null,
      cd: 0, face: owner === 0 ? 0.8 : 3.9, moving: false, stuck: 0, lastX: x, lastY: y,
      laughUntil: 0, poisonUntil: 0, abilityCd: 0, swing: 0, prevX: x, prevY: y, lastHit: -99,
    };
    this.ents.set(u.id, u); this.units.push(u);
    return u;
  }
  spawnBuilding(owner: number, role: BRole, fx: number, fy: number, built = false): Building | null {
    const def = this.players[owner].tribe.buildings[role];
    const b: Building = {
      kind: 'building', id: this.nextId++, owner, x: fx + def.size / 2, y: fy + def.size / 2, hp: built ? def.hp : def.hp * 0.1, maxHp: def.hp, dead: false,
      def, fx, fy, size: def.size, progress: built ? 1 : 0, built, queue: [], rally: null, builders: 0, flash: 0,
    };
    for (let dy = 0; dy < def.size; dy++) for (let dx = 0; dx < def.size; dx++) this.occ[(fy + dy) * N + fx + dx] = b.id;
    this.occVersion++;
    this.ents.set(b.id, b); this.buildings.push(b);
    this.ejectUnits(b);
    if (built) this.recomputePop();
    return b;
  }
  /** Can a building of `size` be placed with top-left (fx, fy)? */
  canPlace(fx: number, fy: number, size: number): boolean {
    if (fx < 3 || fy < 3 || fx + size > N - 3 || fy + size > N - 3) return false;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const i = (fy + dy) * N + fx + dx;
      if (this.map.blocked[i] || this.occ[i]) return false;
    }
    return true;
  }
  private ejectUnits(b: Building) {
    for (const u of this.units) {
      if (u.dead) continue;
      if (u.x > b.fx - 0.3 && u.x < b.fx + b.size + 0.3 && u.y > b.fy - 0.3 && u.y < b.fy + b.size + 0.3) {
        const c = this.standCell(b, u.x, u.y, 1.2);
        if (c) { u.x = c.x; u.y = c.y; u.path = []; u.pi = 0; if (u.state === 'move') u.state = 'idle'; }
      }
    }
  }
  /** Free cell adjacent to a footprint, nearest to (ox, oy). */
  standCell(e: { fx: number; fy: number; size: number }, ox: number, oy: number, gap = 1): V2 | null {
    let best: V2 | null = null, bd = 1e9;
    const x0 = e.fx - gap, x1 = e.fx + e.size - 1 + gap, y0 = e.fy - gap, y1 = e.fy + e.size - 1 + gap;
    for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) {
      if (x >= e.fx && x < e.fx + e.size && y >= e.fy && y < e.fy + e.size) continue;
      if (this.isBlocked(x, y)) continue;
      const d = (x + 0.5 - ox) ** 2 + (y + 0.5 - oy) ** 2;
      if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
    }
    return best;
  }
  /** Distance from a unit to the edge of target. */
  distTo(u: { x: number; y: number }, t: Entity): number {
    if (t.kind === 'unit') return dist(u.x, u.y, t.x, t.y) - t.def.radius;
    const cx = Math.max(t.fx, Math.min(u.x, t.fx + t.size)), cy = Math.max(t.fy, Math.min(u.y, t.fy + t.size));
    return dist(u.x, u.y, cx, cy);
  }

  // ------------------------------------------------------------------ commands
  issue(p: number, c: Command) {
    const pl = this.players[p];
    if (!pl.alive || this.winner >= 0) return;
    const mine = (ids: number[]) => ids.map((i) => this.get(i)).filter((e): e is Unit => !!e && e.kind === 'unit' && e.owner === p);
    switch (c.t) {
      case 'move': {
        const us = mine(c.ids); if (!us.length) return;
        const spots = this.formation(c.x, c.y, us.length);
        const order = [...us].sort((a, b) => dist(a.x, a.y, c.x, c.y) - dist(b.x, b.y, c.x, c.y));
        order.forEach((u, i) => this.orderMove(u, spots[i].x, spots[i].y, c.attack ? { x: spots[i].x, y: spots[i].y } : null));
        break;
      }
      case 'gather': {
        const r = this.get(c.target); if (!r || r.kind !== 'resource') return;
        for (const u of mine(c.ids)) if (u.def.role === 'warga') this.orderGather(u, r);
        break;
      }
      case 'attack': {
        const t = this.get(c.target); if (!t || t.owner === p || t.kind === 'resource') return;
        for (const u of mine(c.ids)) if (u.def.role !== 'warga' || true) { u.state = 'attack'; u.target = t.id; u.atkMove = null; u.path = []; u.want = null; this.clearGather(u); }
        break;
      }
      case 'stop': for (const u of mine(c.ids)) { this.clearGather(u); u.state = 'idle'; u.path = []; u.want = null; u.target = 0; u.atkMove = null; } break;
      case 'help': {
        const b = this.get(c.target); if (!b || b.kind !== 'building' || b.owner !== p || b.built) return;
        for (const u of mine(c.ids)) if (u.def.role === 'warga') this.orderConstruct(u, b);
        break;
      }
      case 'build': this.orderBuild(p, c); break;
      case 'train': this.orderTrain(p, c.building, c.role); break;
      case 'research': this.orderResearch(p, c); break;
      case 'cancel': {
        const b = this.get(c.building); if (!b || b.kind !== 'building' || b.owner !== p) return;
        const q = b.queue[c.index]; if (!q) return;
        b.queue.splice(c.index, 1); this.pay(p, q.cost, +1); this.recomputePop();
        break;
      }
      case 'rally': {
        const b = this.get(c.building); if (!b || b.kind !== 'building' || b.owner !== p) return;
        b.rally = { x: c.x, y: c.y, target: c.target ?? 0 };
        break;
      }
      case 'ability': this.orderAbility(p, c.id); break;
      case 'nuke': this.orderNuke(p, c); break;
    }
  }

  formation(cx: number, cy: number, n: number): V2[] {
    const spots: V2[] = [];
    const sp = 1.05;
    for (let r = 0; spots.length < n && r < 14; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx * sp, y = cy + dy * sp;
        if (this.isBlocked(Math.floor(x), Math.floor(y))) continue;
        spots.push({ x, y });
      }
    }
    while (spots.length < n) spots.push({ x: cx, y: cy });
    return spots;
  }
  clearGather(u: Unit) {
    if (u.gRes) { const r = this.ents.get(u.gRes); if (r && r.kind === 'resource') r.gatherers = Math.max(0, r.gatherers - 1); }
    u.gRes = 0;
  }
  orderMove(u: Unit, x: number, y: number, atk: V2 | null) {
    this.clearGather(u);
    u.state = 'move'; u.target = 0; u.atkMove = atk; u.want = { x, y }; u.path = []; u.pi = 0;
    this.queuePath(u);
  }
  queuePath(u: Unit) { if (!this.pathQueue.includes(u)) this.pathQueue.push(u); }
  orderGather(u: Unit, r: Resource) {
    this.clearGather(u);
    if (u.carryKind && u.carryKind !== r.res) { u.carry = 0; u.carryKind = null; }
    u.state = 'gather'; u.gRes = r.id; u.gKind = r.res; u.gPhase = u.carry >= 10 ? 'return' : 'goto'; u.target = 0; u.atkMove = null; r.gatherers++;
    this.gatherGoto(u);
  }
  private gatherGoto(u: Unit) {
    const r = this.ents.get(u.gRes) as Resource | undefined;
    if (!r || r.dead) return;
    if (u.gPhase === 'return') {
      const tc = this.tc(u.owner); if (!tc) { u.state = 'idle'; return; }
      const sc = this.standCell(tc, u.x, u.y, 1); if (!sc) return;
      u.want = sc;
    } else {
      const sc = this.standCell(r, u.x, u.y, 1); if (!sc) { u.state = 'idle'; return; }
      u.want = sc;
    }
    u.path = []; u.pi = 0; this.queuePath(u);
  }
  orderBuild(p: number, c: Extract<Command, { t: 'build' }>) {
    const pl = this.players[p]; const def = pl.tribe.buildings[c.role];
    if (def.role === 'tc' || def.epoch > pl.epoch) return;
    if (!this.canAfford(p, def.cost)) return;
    const fx = Math.round(c.x - def.size / 2), fy = Math.round(c.y - def.size / 2);
    if (!this.canPlace(fx, fy, def.size)) return;
    if (def.role === 'reactor' && this.playerBuildings(p, 'reactor').length >= 2) return;
    const ws = c.ids.map((i) => this.get(i)).filter((e): e is Unit => !!e && e.kind === 'unit' && e.owner === p && e.def.role === 'warga');
    if (!ws.length) return;
    this.pay(p, def.cost);
    const b = this.spawnBuilding(p, c.role, fx, fy, false)!;
    for (const u of ws) this.orderConstruct(u, b);
  }
  orderConstruct(u: Unit, b: Building) {
    this.clearGather(u);
    u.state = 'build'; u.target = b.id; u.atkMove = null;
    const sc = this.standCell(b, u.x, u.y, 1);
    u.want = sc; u.path = []; u.pi = 0; this.queuePath(u);
  }
  orderTrain(p: number, bid: number, role: Role) {
    const b = this.get(bid); if (!b || b.kind !== 'building' || b.owner !== p || !b.built) return;
    const pl = this.players[p]; const def = pl.tribe.units[role];
    if (!b.def.produces.includes(role) || def.epoch > pl.epoch) return;
    if (b.queue.length >= 6 || !this.canAfford(p, def.cost)) return;
    if (pl.pop + def.pop > pl.popCap) { this.emit({ t: 'popcap', owner: p }); return; }
    if (role === 'hero' && (this.units.some((u) => u.owner === p && !u.dead && u.def.role === 'hero') || this.buildings.some((bb) => bb.owner === p && bb.queue.some((q) => q.id === 'hero')))) return;
    this.pay(p, def.cost);
    b.queue.push({ kind: 'unit', id: role, total: def.time, left: def.time, cost: def.cost });
    this.recomputePop();
  }
  orderResearch(p: number, c: Extract<Command, { t: 'research' }>) {
    const b = this.get(c.building); if (!b || b.kind !== 'building' || b.owner !== p || !b.built || b.def.role !== 'tc') return;
    const pl = this.players[p];
    if (b.queue.some((q) => q.kind !== 'unit')) return;                     // one research at a time
    if (c.kind === 'epoch') {
      if (pl.epoch >= 4) return;
      const ep = pl.tribe.epochs[pl.epoch];
      if (!this.canAfford(p, ep.cost)) return;
      this.pay(p, ep.cost);
      b.queue.push({ kind: 'epoch', id: String(pl.epoch + 1), total: ep.time, left: ep.time, cost: ep.cost });
    } else {
      const t = pl.tribe.techs.find((x) => x.id === c.id);
      if (!t || pl.techs.has(t.id) || t.epoch > pl.epoch || !this.canAfford(p, t.cost)) return;
      this.pay(p, t.cost);
      b.queue.push({ kind: 'tech', id: t.id, total: t.time, left: t.time, cost: t.cost });
    }
  }
  orderAbility(p: number, id: number) {
    const h = this.get(id); if (!h || h.kind !== 'unit' || h.owner !== p || h.def.role !== 'hero' || h.abilityCd > 0) return;
    const tribe = this.players[p].tribe;
    h.abilityCd = tribe.hero.cooldown;
    if (tribe.id === 'jawa') {
      for (const u of this.units) if (!u.dead && u.owner === p && dist(u.x, u.y, h.x, h.y) < 5.5) u.hp = Math.min(u.maxHp, u.hp + 90);
      this.emit({ t: 'ability', owner: p, kind: 'heal', x: h.x, y: h.y });
    } else {
      for (const u of this.units) if (!u.dead && u.owner !== p && dist(u.x, u.y, h.x, h.y) < 5.5) { u.laughUntil = this.time + 4; u.state = 'idle'; u.path = []; u.target = 0; }
      this.emit({ t: 'ability', owner: p, kind: 'laugh', x: h.x, y: h.y });
    }
  }
  orderNuke(p: number, c: Extract<Command, { t: 'nuke' }>) {
    const pl = this.players[p];
    const silo = this.get(c.silo);
    if (!silo || silo.kind !== 'building' || silo.owner !== p || silo.def.role !== 'reactor' || !silo.built) return;
    if (this.time < pl.nukeReadyAt || !this.canAfford(p, NUKE.cost)) return;
    if (this.nukes.some((n) => !n.done && n.owner === p && n.silo === silo.id)) return;
    this.pay(p, NUKE.cost);
    pl.nukeReadyAt = this.time + NUKE.countdown + NUKE.cooldown;
    pl.stats.nukes++;
    const shot: NukeShot = {
      id: this.nextId++, owner: p, silo: silo.id, tx: Math.min(N - 4, Math.max(4, c.x)), ty: Math.min(N - 4, Math.max(4, c.y)),
      t0: this.time, launchAt: this.time + NUKE.countdown - NUKE.flight, impactAt: this.time + NUKE.countdown, launched: false, done: false, sx: silo.x, sy: silo.y,
    };
    this.nukes.push(shot);
    this.emit({ t: 'nuke_arm', shot });
  }

  // ------------------------------------------------------------------ simulation
  step() {
    this.tick++; this.time += DT;
    this.rebuildHash();
    this.runPathQueue();
    for (const u of this.units) if (!u.dead) this.updateUnit(u);
    this.separate();
    for (const b of this.buildings) if (!b.dead) this.updateBuilding(b);
    for (const r of this.resources) if (r.resKind === 'paddy' && !r.dead && r.amount < r.max) r.amount = Math.min(r.max, r.amount + 0.9 * DT);   // sawah tumbuh lagi
    this.updateNukes();
    this.updateFallout();
    this.cleanup();
    if (this.tick % 20 === 0) this.recomputePop();
  }

  private rebuildHash() {
    this.hash.clear();
    for (const u of this.units) {
      if (u.dead) continue;
      u.prevX = u.x; u.prevY = u.y;
      const k = (Math.floor(u.x / 4) << 10) | Math.floor(u.y / 4);
      let a = this.hash.get(k); if (!a) { a = []; this.hash.set(k, a); } a.push(u);
    }
  }
  nearbyUnits(x: number, y: number, r: number, fn: (u: Unit) => void) {
    const cx0 = Math.floor((x - r) / 4), cx1 = Math.floor((x + r) / 4), cy0 = Math.floor((y - r) / 4), cy1 = Math.floor((y + r) / 4);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const a = this.hash.get((cx << 10) | cy); if (!a) continue;
      for (const u of a) if (!u.dead) fn(u);
    }
  }

  private runPathQueue() {
    if (this.cacheVersion !== this.occVersion) { this.pathCache.clear(); this.cacheVersion = this.occVersion; }
    let budget = 10;
    while (this.pathQueue.length && budget > 0) {
      const u = this.pathQueue.shift()!;
      if (u.dead || !u.want) continue;
      const key = `${Math.floor(u.x / 3)},${Math.floor(u.y / 3)},${Math.floor(u.want.x / 3)},${Math.floor(u.want.y / 3)}`;
      const hit = this.pathCache.get(key);
      if (hit && this.time - hit.t < 4 && hit.path.length > 2) {
        const first = hit.path[1];
        if (this.pather.los(this.isBlocked, u.x, u.y, first.x, first.y)) {
          const p = hit.path.slice(1, -1); p.push({ x: u.want.x, y: u.want.y });
          u.path = p; u.pi = 0; u.stuck = 0; u.pathAge = 0;
          continue;
        }
      }
      budget--;
      const p = this.pather.find(this.isBlocked, u.x, u.y, u.want.x, u.want.y);
      if (p && p.length) {
        u.path = p; u.pi = p.length > 1 ? 1 : 0; u.stuck = 0; u.pathAge = 0;
        if (p.length > 2) this.pathCache.set(key, { path: p, t: this.time });
      } else { u.path = []; u.want = null; if (u.state === 'move' || u.state === 'build') u.state = 'idle'; else if (u.state === 'gather') { this.clearGather(u); u.state = 'idle'; } }
    }
  }

  private speedOf(u: Unit) {
    let s = u.def.speed * this.players[u.owner].mods.speed;
    const t = this.map.type[Math.floor(u.y) * N + Math.floor(u.x)];
    if (t === Cell.Forest) s *= u.def.role === 'warga' ? 0.9 : 0.85 * (this.players[u.owner].tribe.id === 'sunda' ? 1.25 : 1);
    if (t === Cell.Paddy) s *= 0.9;
    return s;
  }
  /** Move along u.path. Returns true when path finished. */
  private follow(u: Unit, dt: number): boolean {
    if (u.laughUntil > this.time) { u.moving = false; return false; }
    if (!u.path.length || u.pi >= u.path.length) { u.moving = false; return true; }
    const wp = u.path[u.pi];
    const dx = wp.x - u.x, dy = wp.y - u.y, d = Math.hypot(dx, dy);
    const step = this.speedOf(u) * dt;
    if (d <= step + 0.02) { u.x = wp.x; u.y = wp.y; u.pi++; u.moving = true; if (u.pi >= u.path.length) { u.moving = false; return true; } return false; }
    const nx = u.x + (dx / d) * step, ny = u.y + (dy / d) * step;
    if (!this.isBlocked(Math.floor(nx), Math.floor(ny))) { u.x = nx; u.y = ny; }
    else {
      // slide along axes
      if (!this.isBlocked(Math.floor(nx), Math.floor(u.y))) u.x = nx;
      else if (!this.isBlocked(Math.floor(u.x), Math.floor(ny))) u.y = ny;
    }
    u.face = Math.atan2(dy, dx); u.moving = true;
    return false;
  }
  private checkStuck(u: Unit) {
    if (this.tick % 10 !== 0) return;
    if (u.moving && dist(u.x, u.y, u.lastX, u.lastY) < 0.25) {
      u.stuck++;
      if (u.stuck >= 2 && u.want) { u.stuck = 0; u.path = []; this.queuePath(u); }
    } else u.stuck = 0;
    u.lastX = u.x; u.lastY = u.y;
  }

  private acquire(u: Unit, range: number): Entity | null {
    let best: Entity | null = null, bd = 1e9;
    this.nearbyUnits(u.x, u.y, range, (o) => {
      if (o.owner === u.owner || o.laughUntil > this.time && false) return;
      const d = dist(u.x, u.y, o.x, o.y);
      if (d < range && d < bd) { bd = d; best = o; }
    });
    if (best) return best;
    for (const b of this.buildings) {
      if (b.dead || b.owner === u.owner || !b.built && b.progress < 0.01 && false) continue;
      const d = this.distTo(u, b);
      if (d < range * 0.8 && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  private updateUnit(u: Unit) {
    const dt = DT;
    u.cd = Math.max(0, u.cd - dt); u.abilityCd = Math.max(0, u.abilityCd - dt); u.swing = Math.max(0, u.swing - dt * 3);
    if (u.poisonUntil > this.time) this.damage(u, 2 * dt, null);
    if (u.dead) return;
    if (u.laughUntil > this.time) { u.moving = false; return; }
    switch (u.state) {
      case 'idle': {
        u.moving = false;
        if (u.def.role !== 'warga' && this.tick % 6 === ((u.id) % 6)) {
          const t = this.acquire(u, u.def.sight);
          if (t) { u.state = 'attack'; u.target = t.id; u.atkMove = null; u.homeX = u.x; u.homeY = u.y; }
        }
        break;
      }
      case 'move': {
        if (u.want && !u.path.length) { u.moving = false; if (this.tick % 20 === 0) this.queuePath(u); break; }
        if (u.atkMove && u.def.role !== 'warga' && this.tick % 6 === (u.id % 6)) {
          const t = this.acquire(u, u.def.sight * 0.9);
          if (t) { u.state = 'attack'; u.target = t.id; break; }
        }
        if (this.follow(u, dt)) { u.state = 'idle'; u.want = null; u.atkMove = null; }
        this.checkStuck(u);
        break;
      }
      case 'attack': this.updateAttack(u); break;
      case 'gather': this.updateGather(u); break;
      case 'build': this.updateBuild(u); break;
    }
  }

  private updateAttack(u: Unit) {
    const t = this.get(u.target) as Entity | undefined;
    if (!t || t.kind === 'resource' || t.owner === u.owner) {
      u.target = 0; u.moving = false;
      if (u.atkMove) { u.state = 'move'; u.want = u.atkMove; u.path = []; this.queuePath(u); }
      else u.state = 'idle';
      return;
    }
    const d = this.distTo(u, t);
    const range = u.def.range;
    if (d > range + 0.1) {
      // chase (give up if enemy far beyond sight and we're auto-acquired)
      if (d > u.def.sight * 2.4 && !u.atkMove && u.def.role !== 'warga') { u.state = 'idle'; u.target = 0; return; }
      u.pathAge += DT;
      const tgt = t.kind === 'unit' ? { x: t.x, y: t.y } : (this.standCell(t, u.x, u.y, 1) ?? { x: t.x, y: t.y });
      if (!u.want || dist(u.want.x, u.want.y, tgt.x, tgt.y) > 1.5 || (!u.path.length && u.pathAge > 0.5)) { u.want = tgt; u.path = []; u.pathAge = 0; this.queuePath(u); }
      this.follow(u, DT); this.checkStuck(u);
      return;
    }
    u.moving = false; u.path = [];
    u.face = Math.atan2(t.y - u.y, t.x - u.x);
    if (u.cd <= 0) {
      u.cd = u.def.cd; u.swing = 1;
      const pl = this.players[u.owner];
      let dmg = u.def.dmg * pl.mods.dmg * (u.def.range > 3 && u.def.role !== 'siege' ? pl.mods.rangedDmg : 1);
      if (t.kind === 'building') dmg *= u.def.buildingMult ?? 0.45;
      if (u.def.role === 'siege') this.emit({ t: 'shot', fx: u.x, fy: u.y, tx: t.x, ty: t.y, kind: 'cannon', owner: u.owner });
      else if (u.def.range > 3) this.emit({ t: 'shot', fx: u.x, fy: u.y, tx: t.x, ty: t.y, kind: u.def.poison ? 'dart' : 'arrow', owner: u.owner });
      if (u.def.poison && t.kind === 'unit') t.poisonUntil = this.time + 4;
      this.damage(t, dmg, u);
      if (u.def.role === 'siege' && t.kind === 'unit') {
        this.nearbyUnits(t.x, t.y, 1.6, (o) => { if (o.owner !== u.owner && o !== t) this.damage(o, dmg * 0.5, u); });
      }
    }
  }

  damage(t: Entity, amount: number, src: Unit | null) {
    if (t.dead || t.kind === 'resource') return;
    t.hp -= amount;
    if (t.kind === 'unit') {
      t.lastHit = this.time;
      if (src && amount >= 1) {
        this.emit({ t: 'hit', x: t.x, y: t.y, big: false });
        // retaliate if idle
        if (t.state === 'idle' && t.def.role !== 'warga') { t.state = 'attack'; t.target = src.id; }
        if (t.owner === 0 && this.time - this.lastAttackedEvt > 20) { this.lastAttackedEvt = this.time; this.emit({ t: 'attacked', owner: t.owner, x: t.x, y: t.y }); }
      }
    } else {
      t.flash = 0.2;
      if (src && amount >= 1) {
        this.emit({ t: 'hit', x: t.x, y: t.y, big: true });
        if (t.owner === 0 && this.time - this.lastAttackedEvt > 20) { this.lastAttackedEvt = this.time; this.emit({ t: 'attacked', owner: t.owner, x: t.x, y: t.y }); }
      }
    }
    if (t.hp <= 0) this.kill(t, src);
  }
  private kill(t: Unit | Building, src: Unit | null) {
    if (t.dead) return;
    t.dead = true;
    if (src) this.players[src.owner].stats.kills++;
    this.players[t.owner].stats.lost++;
    if (t.kind === 'unit') {
      this.clearGather(t);
      this.emit({ t: 'death', id: t.id, x: t.x, y: t.y, unit: true, size: t.def.radius, owner: t.owner, model: t.def.model });
    } else {
      this.occVersion++;
      for (let dy = 0; dy < t.size; dy++) for (let dx = 0; dx < t.size; dx++) this.occ[(t.fy + dy) * N + t.fx + dx] = 0;
      this.emit({ t: 'death', id: t.id, x: t.x, y: t.y, unit: false, size: t.size, owner: t.owner, model: t.def.model });
      if (t.def.role === 'tc') this.checkWin();
      for (const q of t.queue) if (q.kind === 'unit') { /* pop freed by recompute */ }
    }
  }
  private checkWin() {
    for (const pl of this.players) {
      if (!pl.alive) continue;
      if (!this.tc(pl.id)) {
        pl.alive = false;
        this.winner = pl.id === 0 ? 1 : 0;
        this.emit({ t: 'gameover', winner: this.winner });
      }
    }
  }

  private updateGather(u: Unit) {
    const r = this.ents.get(u.gRes) as Resource | undefined;
    if (!r || r.dead) {
      // find another of same kind nearby
      this.clearGather(u);
      if (u.carry >= 10 || (u.carry > 0 && u.gPhase === 'return')) { u.gPhase = 'return'; }
      let best: Resource | null = null, bd = 18;
      if (u.gKind) for (const o of this.resources) { if (o.dead || o.res !== u.gKind) continue; const d = dist(u.x, u.y, o.x, o.y); if (d < bd) { bd = d; best = o; } }
      if (best) { this.orderGather(u, best); } else if (u.carry > 0) { u.gRes = 0; u.gPhase = 'return'; this.gatherReturnNoRes(u); } else u.state = 'idle';
      return;
    }
    const pl = this.players[u.owner];
    if (u.gPhase === 'goto') {
      if (this.distTo(u, r) <= 1.15) { u.gPhase = 'work'; u.gTimer = 0; u.path = []; u.moving = false; u.face = Math.atan2(r.y - u.y, r.x - u.x); return; }
      if (!u.path.length) { if (this.tick % 10 === 0) this.gatherGoto(u); u.moving = false; return; }
      this.follow(u, DT); this.checkStuck(u);
    } else if (u.gPhase === 'work') {
      u.moving = false;
      u.gTimer += DT; u.swing = 0.5 + 0.5 * Math.sin(u.gTimer * 8);
      let rate = 1.0 * pl.mods.gather;
      if (r.res === 'pangan') rate *= pl.tribe.passive.gatherPangan;
      if (r.res === 'kayu') rate *= pl.tribe.passive.gatherKayu;
      if (r.res === 'emas') rate *= 0.85;
      const gain = rate * DT;
      const take = Math.min(gain, r.amount);
      r.amount -= take; u.carry += take; u.carryKind = r.res;
      if (r.amount <= 0.001) { r.dead = true; this.removeResource(r); }
      if (u.carry >= 10) { u.gPhase = 'return'; this.gatherGoto(u); }
    } else {
      const tc = this.tc(u.owner);
      if (!tc) { u.state = 'idle'; return; }
      if (this.distTo(u, tc) <= 1.3) { this.depositCarry(u); u.gPhase = 'goto'; this.gatherGoto(u); return; }
      if (!u.path.length) { if (this.tick % 10 === 0) this.gatherGoto(u); u.moving = false; return; }
      this.follow(u, DT); this.checkStuck(u);
    }
  }
  private gatherReturnNoRes(u: Unit) {
    const tc = this.tc(u.owner); if (!tc) { u.state = 'idle'; return; }
    const sc = this.standCell(tc, u.x, u.y, 1); if (!sc) { u.state = 'idle'; return; }
    u.state = 'move'; u.want = sc; u.path = []; this.queuePath(u);
  }
  private depositCarry(u: Unit) {
    if (u.carryKind && u.carry > 0) {
      const amt = Math.floor(u.carry);
      this.players[u.owner].res[u.carryKind] += amt; this.players[u.owner].stats.gathered += amt;
      this.emit({ t: 'deposit', owner: u.owner, x: u.x, y: u.y, kind: u.carryKind, amount: amt });
    }
    u.carry = 0; u.carryKind = null;
  }
  private removeResource(r: Resource) {
    this.occVersion++;
    for (let dy = 0; dy < r.size; dy++) for (let dx = 0; dx < r.size; dx++) this.occ[(r.fy + dy) * N + r.fx + dx] = 0;
    r.dead = true;
    this.emit({ t: 'death', id: r.id, x: r.x, y: r.y, unit: false, size: r.size, owner: -1, model: r.model });
  }

  private updateBuild(u: Unit) {
    const b = this.get(u.target) as Building | undefined;
    if (!b || b.kind !== 'building' || b.built) { u.state = 'idle'; u.target = 0; return; }
    if (this.distTo(u, b) <= 1.35) {
      u.moving = false; u.path = []; u.swing = 0.5 + 0.5 * Math.sin(this.time * 9);
      u.face = Math.atan2(b.y - u.y, b.x - u.x);
      const pl = this.players[u.owner];
      // more builders = faster (diminishing returns): handled per-builder with 0.9 exponent trick
      const rate = (1 / b.def.time) * pl.mods.buildSpeed * 0.85;
      b.progress = Math.min(1, b.progress + rate * DT);
      b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * 0.9 * rate * DT));
      if (b.progress >= 1) {
        b.built = true; b.hp = b.maxHp;
        this.emit({ t: 'built', id: b.id, owner: b.owner });
        this.recomputePop();
        // builders go gather the nearest resource if one is close
        for (const w of this.units) if (!w.dead && w.state === 'build' && w.target === b.id) { w.state = 'idle'; w.target = 0; this.autoGatherNear(w); }
      }
      return;
    }
    if (!u.path.length) { if (this.tick % 10 === 0) { const sc = this.standCell(b, u.x, u.y, 1); u.want = sc; this.queuePath(u); } u.moving = false; return; }
    this.follow(u, DT); this.checkStuck(u);
  }
  autoGatherNear(u: Unit) {
    let best: Resource | null = null, bd = 14;
    for (const r of this.resources) { if (r.dead) continue; const d = dist(u.x, u.y, r.x, r.y) + (r.res === 'emas' ? 4 : 0); if (d < bd) { bd = d; best = r; } }
    if (best) this.orderGather(u, best);
  }

  private updateBuilding(b: Building) {
    b.flash = Math.max(0, b.flash - DT);
    if (!b.built) return;
    const q = b.queue[0]; if (!q) return;
    const pl = this.players[b.owner];
    q.left -= DT;
    if (q.left > 0) return;
    if (q.kind === 'unit') {
      const role = q.id as Role;
      const sc = this.standCell(b, b.x, b.y + b.size, 1) ?? { x: b.x, y: b.fy + b.size + 0.6 };
      b.queue.shift();
      const u = this.spawnUnit(b.owner, role, sc.x, sc.y);
      this.emit({ t: 'trained', id: u.id, owner: b.owner });
      if (b.rally) {
        const tgt = b.rally.target ? this.get(b.rally.target) : undefined;
        if (tgt && tgt.kind === 'resource' && role === 'warga') this.orderGather(u, tgt);
        else this.orderMove(u, b.rally.x, b.rally.y, null);
      } else if (role === 'warga') this.autoGatherNear(u);
    } else if (q.kind === 'epoch') {
      b.queue.shift(); pl.epoch = Number(q.id); this.recomputeMods(b.owner);
      this.emit({ t: 'epoch', owner: b.owner, epoch: pl.epoch });
    } else {
      b.queue.shift(); pl.techs.add(q.id); this.recomputeMods(b.owner);
      this.emit({ t: 'tech', owner: b.owner, id: q.id });
    }
    this.recomputePop();
  }

  /** Soft collision: push overlapping units apart. */
  private separate() {
    for (const u of this.units) {
      if (u.dead) continue;
      this.nearbyUnits(u.x, u.y, 1.2, (o) => {
        if (o === u || o.id < u.id) return;
        const dx = u.x - o.x, dy = u.y - o.y; const d = Math.hypot(dx, dy) || 0.001;
        const min = (u.def.radius + o.def.radius) * 0.95;
        if (d >= min) return;
        const push = (min - d) * 0.5 * 0.35;
        const px = (dx / d) * push, py = (dy / d) * push;
        const uMoving = u.moving || u.state === 'attack', oMoving = o.moving || o.state === 'attack';
        const wu = uMoving && !oMoving ? 0.3 : 1, wo = oMoving && !uMoving ? 0.3 : 1;
        const ux = u.x + px * wu, uy = u.y + py * wu, ox = o.x - px * wo, oy = o.y - py * wo;
        if (!this.isBlocked(Math.floor(ux), Math.floor(uy))) { u.x = ux; u.y = uy; }
        if (!this.isBlocked(Math.floor(ox), Math.floor(oy))) { o.x = ox; o.y = oy; }
      });
    }
  }

  // ------------------------------------------------------------------ nukes
  private updateNukes() {
    for (const n of this.nukes) {
      if (n.done) continue;
      const silo = this.ents.get(n.silo);
      if (!n.launched) {
        if (!silo || silo.dead) { n.done = true; this.emit({ t: 'nuke_cancel', shot: n }); continue; }
        if (this.time >= n.launchAt) { n.launched = true; this.emit({ t: 'nuke_launch', shot: n }); }
      }
      if (this.time >= n.impactAt) {
        n.done = true;
        this.blasts.push({ id: n.id, x: n.tx, y: n.ty, t0: this.time, hit: new Set(), owner: n.owner });
        this.fallouts.push({ x: n.tx, y: n.ty, r: NUKE.falloutRadius, until: this.time + NUKE.falloutTime });
        this.emit({ t: 'nuke_hit', shot: n });
        // scorch cells
        for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
          const d = Math.hypot(dx, dy); const x = Math.floor(n.tx) + dx, y = Math.floor(n.ty) + dy;
          if (d <= NUKE.radius * 1.05 && x >= 0 && y >= 0 && x < N && y < N) this.burnt[y * N + x] = 1;
        }
      }
    }
    for (const bl of this.blasts) {
      const R = Math.min(NUKE.radius, (this.time - bl.t0) * NUKE.waveSpeed);
      const apply = (e: Entity) => {
        if (e.dead || bl.hit.has(e.id)) return;
        const d = dist(e.x, e.y, bl.x, bl.y);
        if (d > R) return;
        bl.hit.add(e.id);
        const f = Math.max(0, 1 - d / NUKE.radius);
        if (e.kind === 'unit') this.damage(e, d < NUKE.radius * 0.5 ? 9999 : e.maxHp * 1.6 * f ** 0.7 + 20, null);
        else if (e.kind === 'building') this.damage(e, 3200 * f ** 0.7, null);
        else if (e.kind === 'resource' && d < NUKE.radius * 0.85) this.removeResource(e);
      };
      for (const u of this.units) apply(u);
      for (const b of this.buildings) apply(b);
      for (const r of this.resources) apply(r);
    }
    this.blasts = this.blasts.filter((b) => this.time - b.t0 < NUKE.radius / NUKE.waveSpeed + 0.5);
  }
  private updateFallout() {
    this.fallouts = this.fallouts.filter((f) => f.until > this.time);
    if (this.tick % 10 !== 0) return;
    for (const f of this.fallouts) for (const u of this.units) {
      if (u.dead) continue;
      if (dist(u.x, u.y, f.x, f.y) < f.r) this.damage(u, NUKE.falloutDps * 0.5 * (1 - this.players[u.owner].mods.radResist), null);
    }
  }

  private cleanup() {
    if (this.units.some((u) => u.dead)) { for (const u of this.units) if (u.dead) this.ents.delete(u.id); this.units = this.units.filter((u) => !u.dead); }
    if (this.buildings.some((b) => b.dead)) { for (const b of this.buildings) if (b.dead) this.ents.delete(b.id); this.buildings = this.buildings.filter((b) => !b.dead); this.recomputePop(); }
    if (this.resources.some((r) => r.dead)) { for (const r of this.resources) if (r.dead) this.ents.delete(r.id); this.resources = this.resources.filter((r) => !r.dead); }
    this.nukes = this.nukes.filter((n) => !n.done || this.time - n.impactAt < 8);
  }

  drainEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }
}
