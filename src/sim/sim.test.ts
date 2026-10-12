import { describe, expect, it } from 'vitest';
import { World, DT } from './world';
import { AI } from './ai';
import { N } from './map';
import { NUKE, REGION_PRESET } from '../data/game';

const preset = { seed: 1234, ...REGION_PRESET['Jawa'] };
const mk = () => new World({ tribes: ['jawa', 'sunda'], preset });
const run = (w: World, sec: number, ai?: AI[]) => { for (let i = 0; i < sec / DT; i++) { ai?.forEach((a) => a.update()); w.step(); } };

describe('map', () => {
  it('connects both spawns', () => {
    for (const seed of [1, 2, 3, 77, 999, 31337]) {
      const w = new World({ tribes: ['jawa', 'sunda'], preset: { seed, ...REGION_PRESET['Kalimantan'] } });
      const a = w.map.spawns[0], b = w.map.spawns[1];
      const path = (w as any).pather.find(w.isBlocked, a.x, a.y + 4, b.x, b.y + 4);
      expect(path, `seed ${seed}`).not.toBeNull();
    }
  });
  it('places start resources near both bases', () => {
    const w = mk();
    for (const s of w.map.spawns) {
      const near = w.resources.filter((r) => Math.hypot(r.x - s.x, r.y - s.y) < 20);
      expect(near.filter((r) => r.res === 'pangan').length).toBeGreaterThan(1);
      expect(near.filter((r) => r.res === 'emas').length).toBeGreaterThan(0);
      expect(near.filter((r) => r.res === 'kayu').length).toBeGreaterThan(5);
    }
  });
});

describe('economy', () => {
  it('workers gather and deposit', () => {
    const w = mk();
    const before = w.players[0].res.pangan + w.players[0].res.kayu + w.players[0].res.emas;
    run(w, 60);
    const after = w.players[0].res.pangan + w.players[0].res.kayu + w.players[0].res.emas;
    expect(after).toBeGreaterThan(before + 20);
    expect(w.players[0].stats.gathered).toBeGreaterThan(20);
  });
  it('trains units and respects pop cap', () => {
    const w = mk();
    w.players[0].res.pangan = 5000;
    const tc = w.tc(0)!;
    for (let i = 0; i < 10; i++) w.issue(0, { t: 'train', building: tc.id, role: 'warga' });
    expect(tc.queue.length).toBeLessThanOrEqual(6);
    run(w, 80);
    expect(w.playerUnits(0).length).toBeGreaterThan(8);
    expect(w.players[0].pop).toBeLessThanOrEqual(w.players[0].popCap);
  });
  it('builds a house with workers and raises pop cap', () => {
    const w = mk();
    const tc = w.tc(0)!;
    const ids = w.playerUnits(0).map((u) => u.id);
    const cap = w.players[0].popCap;
    w.issue(0, { t: 'build', ids, role: 'house', x: tc.x + 7, y: tc.y - 6 });
    expect(w.playerBuildings(0, 'house').length).toBe(1);
    run(w, 60);
    expect(w.playerBuildings(0, 'house')[0].built).toBe(true);
    w.recomputePop();
    expect(w.players[0].popCap).toBe(cap + 6);
  });
  it('advances epochs and unlocks barracks units', () => {
    const w = mk();
    w.players[0].res = { pangan: 5000, kayu: 5000, emas: 5000 };
    const tc = w.tc(0)!;
    w.issue(0, { t: 'research', building: tc.id, kind: 'epoch' });
    run(w, 30);
    expect(w.players[0].epoch).toBe(2);
    expect(w.players[0].mods.dmg).toBeGreaterThan(1);
  });
});

describe('combat', () => {
  it('units fight and the stronger side wins', () => {
    const w = mk();
    const a = w.map.spawns[0];
    const mine = [0, 1, 2, 3, 4, 5].map((i) => w.spawnUnit(0, 'prajurit', a.x + 12 + i * 0.3, a.y - 12));
    const foes = [0, 1].map((i) => w.spawnUnit(1, 'prajurit', a.x + 14, a.y - 12 + i * 0.3));
    for (const f of foes) { f.state = 'idle'; }
    run(w, 25);
    expect(foes.every((f) => f.dead)).toBe(true);
    expect(mine.filter((m) => !m.dead).length).toBeGreaterThan(3);
  });
  it('kills a keraton -> game over', () => {
    const w = mk();
    const tc1 = w.tc(1)!;
    w.damage(tc1, 99999, null);
    w.step();
    expect(w.winner).toBe(0);
  });
});

describe('hero abilities', () => {
  it('Semar heals nearby allies', () => {
    const w = mk(); const s = w.map.spawns[0];
    const semar = w.spawnUnit(0, 'hero', s.x + 10, s.y - 12);
    const hurt = w.spawnUnit(0, 'prajurit', s.x + 11, s.y - 12); hurt.hp = 10;
    w.issue(0, { t: 'ability', id: semar.id });
    expect(hurt.hp).toBeGreaterThan(80);
    expect(semar.abilityCd).toBeGreaterThan(0);
    w.issue(0, { t: 'ability', id: semar.id });       // on cooldown: no second cast
    expect(w.drainEvents().filter((e) => e.t === 'ability').length).toBe(1);
  });
  it('Cepot makes enemies laugh and freeze', () => {
    const w = new World({ tribes: ['sunda', 'jawa'], preset });
    const s = w.map.spawns[0];
    const cepot = w.spawnUnit(0, 'hero', s.x + 10, s.y - 12);
    const foe = w.spawnUnit(1, 'prajurit', s.x + 12, s.y - 12);
    foe.state = 'attack'; foe.target = cepot.id;
    w.issue(0, { t: 'ability', id: cepot.id });
    expect(foe.laughUntil).toBeGreaterThan(w.time);
    const hp = cepot.hp; run(w, 3);
    expect(cepot.hp).toBe(hp);
  });
});

describe('nuke', () => {
  it('counts down, launches, detonates and wipes the blast zone', () => {
    const w = mk();
    w.players[0].epoch = 4; w.players[0].res = { pangan: 5000, kayu: 5000, emas: 5000 };
    const s = w.map.spawns[0];
    const silo = w.spawnBuilding(0, 'reactor', s.x + 8, s.y - 12, true)!;
    const t = w.map.spawns[1];
    const victim = w.spawnUnit(1, 'prajurit', t.x, t.y + 6);
    const far = w.spawnUnit(1, 'prajurit', t.x + 30, t.y - 30);
    const tc = w.tc(1)!;
    w.issue(0, { t: 'nuke', silo: silo.id, x: t.x, y: t.y });
    expect(w.nukes.length).toBe(1);
    const types: string[] = [];
    for (let i = 0; i < (NUKE.countdown + 3) / DT; i++) { w.step(); for (const e of w.drainEvents()) if (e.t.startsWith('nuke')) types.push(e.t); }
    expect(types).toEqual(['nuke_arm', 'nuke_launch', 'nuke_hit']);
    expect(tc.hp).toBeLessThan(tc.maxHp * 0.6);
    expect(victim.dead).toBe(true);
    expect(far.dead).toBe(false);
    expect(w.burnt.some((v) => v === 1)).toBe(true);
  });
  it('is cancelled if the silo dies before launch', () => {
    const w = mk();
    w.players[0].epoch = 4; w.players[0].res = { pangan: 5000, kayu: 5000, emas: 5000 };
    const s = w.map.spawns[0];
    const silo = w.spawnBuilding(0, 'reactor', s.x + 8, s.y - 12, true)!;
    w.issue(0, { t: 'nuke', silo: silo.id, x: 100, y: 100 });
    run(w, 5);
    w.damage(silo, 99999, null);
    const types: string[] = [];
    for (let i = 0; i < 25 / DT; i++) { w.step(); for (const e of w.drainEvents()) types.push(e.t); }
    expect(types).toContain('nuke_cancel');
    expect(types).not.toContain('nuke_hit');
  });
});

describe('ai', () => {
  it('builds an economy, advances, and attacks (AI vs AI, 12 min sim)', () => {
    const w = new World({ tribes: ['jawa', 'sunda'], preset, humans: [] });
    const ais = [new AI(w, 0, 'sulit'), new AI(w, 1, 'sulit')];
    run(w, 720, ais);
    const lines = w.players.map((p) => `P${p.id} ep${p.epoch} pop${p.pop}/${p.popCap} res${Math.round(p.res.pangan)}/${Math.round(p.res.kayu)}/${Math.round(p.res.emas)} kills${p.stats.kills} nukes${p.stats.nukes}`);
    console.log(lines.join(' | '), 'winner', w.winner);
    expect(Math.max(w.players[0].epoch, w.players[1].epoch)).toBeGreaterThanOrEqual(3);
    expect(w.players[0].stats.gathered + w.players[1].stats.gathered).toBeGreaterThan(1000);
  });
});

describe('perf', () => {
  it('300 units tick under 8ms avg', () => {
    const w = mk();
    const a = w.map.spawns[0];
    for (let i = 0; i < 150; i++) { w.spawnUnit(0, 'prajurit', a.x + 5 + (i % 15) * 0.8, a.y - 10 + Math.floor(i / 15) * 0.8); w.spawnUnit(1, 'pemanah' as any, a.x + 8 + (i % 15) * 0.8, a.y - 10 + Math.floor(i / 15) * 0.8); }
    const ids = w.playerUnits(0).map((u) => u.id);
    w.issue(0, { t: 'move', ids, x: N - 30, y: N - 30, attack: true });
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) w.step();
    const avg = (performance.now() - t0) / 200;
    console.log('avg tick ms', avg.toFixed(2));
    expect(avg).toBeLessThan(8);
  });
});
