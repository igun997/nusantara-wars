import * as THREE from 'three';

// Procedural sprite atlas: 3 turbulent puffs + 1 soft glow (2x2 tiles of 128px).
function hash(x: number, y: number, s: number) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number) { return vnoise(x, y, s) * 0.5 + vnoise(x * 2, y * 2, s + 1) * 0.25 + vnoise(x * 4, y * 4, s + 2) * 0.15 + vnoise(x * 8, y * 8, s + 3) * 0.1; }

export function makeSpriteAtlas(): THREE.Texture {
  const T = 128, S = T * 2;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * T, oy = Math.floor(tile / 2) * T;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const nx = (x / T) * 2 - 1, ny = (y / T) * 2 - 1;
      const r = Math.hypot(nx, ny);
      let a: number;
      if (tile === 3) a = Math.pow(Math.max(0, 1 - r), 1.8);
      else {
        const n = fbm(x / 22 + tile * 17, y / 22 + tile * 5, tile * 7);
        const edge = Math.max(0, 1 - r * r * 1.15);
        a = Math.max(0, Math.min(1, (edge * 1.35 - (1 - n) * 0.55)));
        a = a * a * (3 - 2 * a);
      }
      const i = ((oy + y) * S + (ox + x)) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  return tex;
}
