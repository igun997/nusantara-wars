// A* on a uniform grid with 8-neighbour moves, no corner cutting, and line-of-sight smoothing.
export interface V2 { x: number; y: number }

export class Pather {
  n: number;
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private cur = 0;
  private heap: number[] = [];
  private f: Float32Array;
  constructor(n: number) {
    this.n = n;
    this.g = new Float32Array(n * n);
    this.f = new Float32Array(n * n);
    this.parent = new Int32Array(n * n);
    this.stamp = new Uint32Array(n * n);
    this.closed = new Uint32Array(n * n);
  }
  private push(i: number) {
    const h = this.heap, f = this.f; h.push(i);
    let c = h.length - 1;
    while (c > 0) { const p = (c - 1) >> 1; if (f[h[p]] <= f[h[c]]) break; [h[p], h[c]] = [h[c], h[p]]; c = p; }
  }
  private pop(): number {
    const h = this.heap, f = this.f; const top = h[0]; const last = h.pop()!;
    if (h.length) {
      h[0] = last; let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1; let m = c;
        if (l < h.length && f[h[l]] < f[h[m]]) m = l;
        if (r < h.length && f[h[r]] < f[h[m]]) m = r;
        if (m === c) break; [h[m], h[c]] = [h[c], h[m]]; c = m;
      }
    }
    return top;
  }
  los(blocked: (x: number, y: number) => boolean, ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax, dy = by - ay;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2.5);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + dx * t, y = ay + dy * t;
      if (blocked(Math.floor(x), Math.floor(y))) return false;
      // keep a little clearance off diagonal corners
      if (blocked(Math.floor(x + 0.3), Math.floor(y + 0.3)) || blocked(Math.floor(x - 0.3), Math.floor(y - 0.3)) || blocked(Math.floor(x + 0.3), Math.floor(y - 0.3)) || blocked(Math.floor(x - 0.3), Math.floor(y + 0.3))) return false;
    }
    return true;
  }
  /** Returns waypoints (cell centres) from start to goal, or null. If goal cell is blocked, finds nearest free cell. */
  find(blockedFn: (x: number, y: number) => boolean, sx: number, sy: number, gx: number, gy: number): V2[] | null {
    const n = this.n;
    sx = Math.min(n - 1, Math.max(0, Math.floor(sx))); sy = Math.min(n - 1, Math.max(0, Math.floor(sy)));
    gx = Math.min(n - 1, Math.max(0, Math.floor(gx))); gy = Math.min(n - 1, Math.max(0, Math.floor(gy)));
    if (blockedFn(gx, gy)) {
      let best = -1, bd = 1e9;
      for (let r = 1; r < 12 && best < 0; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = gx + dx, y = gy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n || blockedFn(x, y)) continue;
          const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = y * n + x; }
        }
      }
      if (best < 0) return null;
      gx = best % n; gy = (best / n) | 0;
    }
    if (sx === gx && sy === gy) return [{ x: gx + 0.5, y: gy + 0.5 }];
    this.cur++;
    const cur = this.cur, si = sy * n + sx, gi = gy * n + gx;
    this.heap.length = 0;
    this.g[si] = 0; this.stamp[si] = cur; this.parent[si] = -1;
    const hf = (x: number, y: number) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy); };
    this.f[si] = hf(sx, sy) * 1.2; this.push(si);
    let found = false, iter = 0;
    while (this.heap.length && iter++ < 120000) {
      const c = this.pop();
      if (this.closed[c] === cur) continue;
      this.closed[c] = cur;
      if (c === gi) { found = true; break; }
      const cx = c % n, cy = (c / n) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n || blockedFn(nx, ny)) continue;
        if (dx && dy && (blockedFn(cx + dx, cy) || blockedFn(cx, cy + dy))) continue;
        const ni = ny * n + nx;
        if (this.closed[ni] === cur) continue;
        const ng = this.g[c] + (dx && dy ? Math.SQRT2 : 1);
        if (this.stamp[ni] !== cur || ng < this.g[ni]) {
          this.stamp[ni] = cur; this.g[ni] = ng; this.parent[ni] = c;
          this.f[ni] = ng + hf(nx, ny) * 1.2; this.push(ni);
        }
      }
    }
    if (!found) return null;
    const raw: V2[] = [];
    for (let c = gi; c !== -1; c = this.parent[c]) raw.push({ x: (c % n) + 0.5, y: ((c / n) | 0) + 0.5 });
    raw.reverse();
    // smooth via string pulling
    const out: V2[] = [raw[0]];
    let anchor = 0;
    for (let i = 2; i < raw.length; i++) {
      if (!this.los(blockedFn, raw[anchor].x, raw[anchor].y, raw[i].x, raw[i].y)) { out.push(raw[i - 1]); anchor = i - 1; }
    }
    out.push(raw[raw.length - 1]);
    return out;
  }
}
