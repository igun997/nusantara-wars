import { mulberry32, type Rng } from './rng';
import type { MapPreset } from '../data/game';
import { Pather } from './path';

export const N = 128;
export const enum Cell { Grass = 0, Dirt = 1, Sand = 2, Rock = 3, Water = 4, Paddy = 5, Forest = 6 }

export interface ResSpawn { kind: 'tree' | 'paddy' | 'gold'; x: number; y: number; model: string }
export interface Decor { model: string; x: number; y: number; rot: number; scale: number }
export interface GameMap {
  n: number;
  type: Uint8Array;            // n*n cell types
  blocked: Uint8Array;         // terrain-blocked (rock, water)
  height: Float32Array;        // (n+1)*(n+1) vertex heights
  spawns: [{ x: number; y: number }, { x: number; y: number }];
  resources: ResSpawn[];
  decor: Decor[];
  candiCells: { x: number; y: number }[];
}

// ---- value noise ----
function makeNoise(rng: Rng) {
  const P = new Uint8Array(512);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  const val = (x: number, y: number) => P[(P[x & 255] + y) & 255] / 255;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm(x - xi), yf = sm(y - yi);
    const a = val(xi, yi), b = val(xi + 1, yi), c = val(xi, yi + 1), d = val(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x: number, y: number, oct = 4) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  };
}

export function generateMap(preset: MapPreset): GameMap {
  const rng = mulberry32(preset.seed);
  const fbm = makeNoise(rng);
  const fbm2 = makeNoise(rng);
  const fbm3 = makeNoise(rng);
  const type = new Uint8Array(N * N);
  const blocked = new Uint8Array(N * N);
  const spawns: GameMap['spawns'] = [{ x: 22, y: 22 }, { x: N - 22, y: N - 22 }];
  const idx = (x: number, y: number) => y * N + x;
  const distSpawn = (x: number, y: number) => Math.min(Math.hypot(x - spawns[0].x, y - spawns[0].y), Math.hypot(x - spawns[1].x, y - spawns[1].y));

  // base terrain classification
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = fbm(x * 0.035, y * 0.035);
    const m = fbm2(x * 0.045 + 40, y * 0.045 + 40);
    const river = Math.abs(fbm3(x * 0.022 + 7, y * 0.022 + 7) - 0.5);
    let t: Cell = Cell.Grass;
    const dd = distSpawn(x, y);
    if (dd > 17) {
      if (river < 0.018 + preset.water * 0.05) t = Cell.Water;
      else if (m < 0.2 + preset.water * 0.35 * 0.3 && h < 0.5) t = Cell.Water;
      else if (h > 0.66 - preset.mountain * 0.18 && m > 0.46) t = Cell.Rock;
      else if (fbm3(x * 0.07 + 90, y * 0.07) > 0.62 - preset.forest * 0.12) t = Cell.Forest;
      else if (fbm2(x * 0.05 + 200, y * 0.05) > 0.62 - preset.paddy * 0.2 && h < 0.55) t = Cell.Paddy;
      else if (fbm(x * 0.12 + 300, y * 0.12) > 0.64) t = Cell.Dirt;
    } else if (dd > 11 && fbm(x * 0.2, y * 0.2) > 0.55) t = Cell.Dirt;
    type[idx(x, y)] = t;
  }
  // sand shores
  const t2 = type.slice();
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    if (type[idx(x, y)] === Cell.Water || type[idx(x, y)] === Cell.Rock) continue;
    let near = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (type[idx(x + dx, y + dy)] === Cell.Water) near++;
    if (near > 0 && rng() < 0.4 + preset.sand) t2[idx(x, y)] = Cell.Sand;
  }
  type.set(t2);
  // map border = water/rock ring (keeps units in)
  for (let i = 0; i < N; i++) for (let b = 0; b < 2; b++) {
    for (const [x, y] of [[i, b], [i, N - 1 - b], [b, i], [N - 1 - b, i]]) type[idx(x, y)] = Cell.Water;
  }

  const recompute = () => { for (let i = 0; i < N * N; i++) blocked[i] = type[i] === Cell.Water || type[i] === Cell.Rock ? 1 : 0; };
  recompute();

  // guarantee connectivity between spawns (carve a wiggly corridor if needed)
  const reach = (sx: number, sy: number) => {
    const seen = new Uint8Array(N * N); const q = [idx(sx, sy)]; seen[q[0]] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi]; const cx = c % N, cy = (c / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = idx(nx, ny);
        if (!seen[ni] && !blocked[ni]) { seen[ni] = 1; q.push(ni); }
      }
    }
    return seen;
  };
  const r0 = reach(spawns[0].x, spawns[0].y);
  if (!r0[idx(spawns[1].x, spawns[1].y)]) {
    let x = spawns[0].x, y = spawns[0].y;
    const gx = spawns[1].x, gy = spawns[1].y;
    while (Math.abs(x - gx) + Math.abs(y - gy) > 2) {
      if (rng() < Math.abs(gx - x) / (Math.abs(gx - x) + Math.abs(gy - y) + 1e-6)) x += Math.sign(gx - x); else y += Math.sign(gy - y);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 2 || yy < 2 || xx >= N - 2 || yy >= N - 2) continue;
        const k = idx(xx, yy);
        if (type[k] === Cell.Water || type[k] === Cell.Rock) type[k] = Cell.Sand;
      }
    }
    recompute();
  }
  // tiny blocked pockets are fine; remove isolated 1-cell lakes inside bases already handled by dd>17

  // ---- resources ----
  const resources: ResSpawn[] = [];
  const decor: Decor[] = [];
  const taken = new Uint8Array(N * N);
  const free = (x: number, y: number, s = 1) => {
    if (x < 3 || y < 3 || x + s >= N - 3 || y + s >= N - 3) return false;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) if (blocked[idx(x + dx, y + dy)] || taken[idx(x + dx, y + dy)]) return false;
    return true;
  };
  const take = (x: number, y: number, s = 1) => { for (let dy = -1; dy <= s; dy++) for (let dx = -1; dx <= s; dx++) { const k = idx(x + dx, y + dy); if (k >= 0 && k < N * N) taken[k] = 1; } };
  // reserve building zones
  for (const s of spawns) for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) taken[idx(s.x + dx, s.y + dy)] = 1;

  const treeModel = (x: number, y: number) => {
    const alt = fbm(x * 0.035, y * 0.035);
    const nearSand = type[idx(x, y)] === Cell.Sand;
    if (nearSand || rng() < 0.12) return 'tree_palm';
    return alt > 0.55 ? 'tree_pine' : 'tree_jati';
  };
  const placeTree = (x: number, y: number) => { if (free(x, y)) { resources.push({ kind: 'tree', x, y, model: treeModel(x, y) }); taken[idx(x, y)] = 1; return true; } return false; };

  for (let si = 0; si < 2; si++) {
    const s = spawns[si];
    const sgn = si === 0 ? 1 : -1;
    // rice (sawah) 2x2 in an arc
    const rice: [number, number][] = [[-9, 5], [-9, 8], [-6, 10], [-3, 10], [-12, 2], [-1, 11]];
    for (const [dx, dy] of rice) {
      const x = s.x + dx * sgn, y = s.y + dy * sgn;
      for (let tries = 0; tries < 20; tries++) {
        const ox = x + ((tries * 3) % 5) - 2, oy = y + ((tries * 7) % 5) - 2;
        const px = Math.round(ox), py = Math.round(oy);
        const ok = (() => { for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) if (blocked[idx(px + a, py + b)]) return false; return true; })();
        if (ok) { resources.push({ kind: 'paddy', x: px, y: py, model: 'rice_patch' }); for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { type[idx(px + a, py + b)] = Cell.Paddy; taken[idx(px + a, py + b)] = 1; } break; }
      }
    }
    // gold 2x2
    const gold: [number, number][] = [[9, -6], [10, -2]];
    for (const [dx, dy] of gold) {
      const px = s.x + dx * sgn, py = s.y + dy * sgn;
      resources.push({ kind: 'gold', x: Math.round(px), y: Math.round(py), model: 'goldmine' }); take(Math.round(px), Math.round(py), 2);
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) taken[idx(Math.round(px) + a, Math.round(py) + b)] = 1;
    }
    // tree clump
    for (let k = 0; k < 34; k++) {
      const a = rng() * Math.PI * 2, r = 9 + rng() * 5;
      const tx = Math.round(s.x + Math.cos(a) * r + 6 * sgn * -1 + (si === 0 ? 8 : -8) * 0), ty = Math.round(s.y + Math.sin(a) * r);
      placeTree(tx, ty);
    }
  }
  // neutral resources across the map
  for (let k = 0; k < 14; k++) {
    for (let tries = 0; tries < 40; tries++) {
      const x = 8 + Math.floor(rng() * (N - 18)), y = 8 + Math.floor(rng() * (N - 18));
      if (!free(x, y, 2) || distSpawn(x, y) < 24) continue;
      const kind = k < 5 ? 'gold' : 'paddy';
      resources.push({ kind, x, y, model: kind === 'gold' ? 'goldmine' : 'rice_patch' });
      take(x, y, 2); for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { taken[idx(x + a, y + b)] = 1; if (kind === 'paddy') type[idx(x + a, y + b)] = Cell.Paddy; }
      break;
    }
  }
  // forests
  for (let y = 4; y < N - 4; y++) for (let x = 4; x < N - 4; x++) {
    const f = fbm3(x * 0.07 + 90, y * 0.07);
    const isF = type[idx(x, y)] === Cell.Forest;
    const dens = isF ? 0.55 + preset.forest * 0.3 : (f > 0.5 - preset.forest * 0.1 ? 0.06 + preset.forest * 0.08 : 0.012);
    if (distSpawn(x, y) < 14) continue;
    if (rng() < dens * (isF ? 1 : 0.6)) placeTree(x, y);
  }
  // make sure trees never seal the two bases off from each other: carve a corridor through them
  {
    const pather = new Pather(N);
    const solid = new Uint8Array(N * N);
    const rebuild = (withTrees: boolean) => {
      solid.set(blocked);
      for (const r of resources) {
        if (r.kind === 'tree' && !withTrees) continue;
        const sz = r.kind === 'tree' ? 1 : 2;
        for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) solid[idx(r.x + dx, r.y + dy)] = 1;
      }
    };
    const blk = (x: number, y: number) => x < 0 || y < 0 || x >= N || y >= N || solid[idx(x, y)] !== 0;
    for (let round = 0; round < 4; round++) {
      rebuild(true);
      const a = spawns[0], b = spawns[1];
      if (pather.find(blk, a.x, a.y + 4, b.x, b.y + 4)) break;
      rebuild(false);
      const route = pather.find(blk, a.x, a.y + 4, b.x, b.y + 4);
      if (!route) break;
      const cut = new Set<number>();
      for (let i = 0; i < route.length - 1; i++) {
        const p0 = route[i], p1 = route[i + 1];
        const steps = Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 2);
        for (let k = 0; k <= steps; k++) {
          const x = Math.floor(p0.x + (p1.x - p0.x) * (k / steps)), y = Math.floor(p0.y + (p1.y - p0.y) * (k / steps));
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) cut.add(idx(x + dx, y + dy));
        }
      }
      for (let i = resources.length - 1; i >= 0; i--) if (resources[i].kind === 'tree' && cut.has(idx(resources[i].x, resources[i].y))) resources.splice(i, 1);
    }
  }
  // landmarks + decor
  const candiCells: { x: number; y: number }[] = [];
  for (let k = 0; k < 2; k++) {
    for (let tries = 0; tries < 60; tries++) {
      const x = 28 + Math.floor(rng() * (N - 60)), y = 28 + Math.floor(rng() * (N - 60));
      if (!free(x, y, 3) || distSpawn(x, y) < 28) continue;
      decor.push({ model: 'candi', x: x + 1.5, y: y + 1.5, rot: 0, scale: 1.15 });
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { candiCells.push({ x: x + a, y: y + b }); }
      take(x, y, 3);
      break;
    }
  }
  for (let k = 0; k < 90; k++) {
    const x = 4 + rng() * (N - 8), y = 4 + rng() * (N - 8);
    const c = type[idx(Math.floor(x), Math.floor(y))];
    if (blocked[idx(Math.floor(x), Math.floor(y))] && c !== Cell.Rock) continue;
    if (c === Cell.Rock) decor.push({ model: 'rock_big', x, y, rot: rng() * 6.28, scale: 0.9 + rng() * 1.3 });
    else if (rng() < 0.4 && c !== Cell.Water) {
      let nearWater = false;
      for (let dy = -3; dy <= 3 && !nearWater; dy++) for (let dx = -3; dx <= 3; dx++) { const k2 = idx(Math.floor(x) + dx, Math.floor(y) + dy); if (k2 >= 0 && k2 < N * N && type[k2] === Cell.Water) { nearWater = true; break; } }
      if (nearWater && distSpawn(x, y) > 12) decor.push({ model: 'bamboo_clump', x, y, rot: rng() * 6.28, scale: 0.9 + rng() * 0.5 });
    }
  }
  // rock ridges: add rock decor on rock cells
  for (let y = 2; y < N - 2; y += 2) for (let x = 2; x < N - 2; x += 2) {
    if (type[idx(x, y)] === Cell.Rock && rng() < 0.55) decor.push({ model: 'rock_big', x: x + rng(), y: y + rng(), rot: rng() * 6.28, scale: 1.2 + rng() * 1.2 });
  }

  // ---- heights (vertex grid) ----
  const V = N + 1;
  const height = new Float32Array(V * V);
  const cellAt = (x: number, y: number) => type[idx(Math.min(N - 1, Math.max(0, x)), Math.min(N - 1, Math.max(0, y)))];
  for (let y = 0; y < V; y++) for (let x = 0; x < V; x++) {
    let hv = (fbm(x * 0.05 + 11, y * 0.05 + 11, 3) - 0.5) * 1.6;
    let rockN = 0, waterN = 0;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) { const c = cellAt(x + dx, y + dy); if (c === Cell.Rock) rockN++; if (c === Cell.Water) waterN++; }
    hv += rockN * 1.1 * (0.7 + fbm2(x * 0.15, y * 0.15, 2));
    hv -= waterN * 0.42;
    const d = distSpawn(x, y);
    if (d < 20) hv = hv * Math.min(1, Math.max(0, (d - 11) / 9));
    height[y * V + x] = hv;
  }
  // smooth
  for (let pass = 0; pass < 2; pass++) {
    const src = height.slice();
    for (let y = 1; y < V - 1; y++) for (let x = 1; x < V - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[(y + dy) * V + (x + dx)];
      height[y * V + x] = s / 9 * 0.7 + src[y * V + x] * 0.3;
    }
  }
  return { n: N, type, blocked, height, spawns, resources, decor, candiCells };
}

export function heightAt(map: GameMap, x: number, y: number): number {
  const V = map.n + 1;
  const cx = Math.min(map.n - 0.001, Math.max(0, x)), cy = Math.min(map.n - 0.001, Math.max(0, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const fx = cx - x0, fy = cy - y0;
  const h = map.height;
  const a = h[y0 * V + x0], b = h[y0 * V + x0 + 1], c = h[(y0 + 1) * V + x0], d = h[(y0 + 1) * V + x0 + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
