import * as THREE from 'three';
import { Cell, N, type GameMap } from '../sim/map';

export const WATER_Y = -0.1;

export class Terrain {
  mesh: THREE.Mesh;
  water: THREE.Mesh;
  burnTex: THREE.DataTexture;
  private burnData = new Uint8Array(N * N);
  private waterMat: THREE.ShaderMaterial;
  private uniforms: { tBurn: { value: THREE.Texture }; uTime: { value: number } };

  constructor(private map: GameMap, tex: Map<string, THREE.Texture>, sunDir: THREE.Vector3) {
    const V = N + 1;
    const pos = new Float32Array(V * V * 3);
    const w0 = new Float32Array(V * V * 4);
    const w1 = new Float32Array(V * V * 2);
    const cellW = (x: number, y: number, out: number[]) => {
      if (x < 0 || y < 0 || x >= N || y >= N) { out[0] += 0; return; }
      switch (map.type[y * N + x] as Cell) {
        case Cell.Grass: out[0]++; break; case Cell.Dirt: out[1]++; break; case Cell.Sand: out[2]++; break;
        case Cell.Rock: out[3]++; break; case Cell.Forest: out[4]++; break; case Cell.Paddy: out[5]++; break;
        case Cell.Water: out[2]++; break;
      }
    };
    for (let y = 0; y < V; y++) for (let x = 0; x < V; x++) {
      const i = y * V + x;
      pos[i * 3] = x; pos[i * 3 + 1] = map.height[i]; pos[i * 3 + 2] = y;
      const acc = [0, 0, 0, 0, 0, 0];
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) cellW(x + dx, y + dy, acc);
      const sum = acc.reduce((a, b) => a + b, 0) || 1;
      // fade-in grass on forest/paddy so blends are smooth
      w0[i * 4] = acc[0] / sum; w0[i * 4 + 1] = acc[1] / sum; w0[i * 4 + 2] = acc[2] / sum; w0[i * 4 + 3] = acc[3] / sum;
      w1[i * 2] = acc[4] / sum; w1[i * 2 + 1] = acc[5] / sum;
    }
    const idx: number[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const a = y * V + x, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aW0', new THREE.BufferAttribute(w0, 4));
    g.setAttribute('aW1', new THREE.BufferAttribute(w1, 2));
    g.setIndex(idx);
    g.computeVertexNormals();

    this.burnTex = new THREE.DataTexture(this.burnData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    this.burnTex.minFilter = this.burnTex.magFilter = THREE.LinearFilter; this.burnTex.needsUpdate = true;
    this.uniforms = { tBurn: { value: this.burnTex }, uTime: { value: 0 } };

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      for (const n of ['grass', 'dirt', 'sand', 'rock', 'forest', 'paddy']) sh.uniforms['t' + n[0].toUpperCase() + n.slice(1)] = { value: tex.get(n)! };
      sh.uniforms.tBurn = this.uniforms.tBurn;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aW0; attribute vec2 aW1; varying vec4 vW0; varying vec2 vW1; varying vec3 vWPos; varying vec3 vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW0 = aW0; vW1 = aW1; vWPos = position; vWN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tGrass, tDirt, tSand, tRock, tForest, tPaddy, tBurn;
          varying vec4 vW0; varying vec2 vW1; varying vec3 vWPos; varying vec3 vWN;
          vec3 splat(sampler2D t, vec2 p){ return mix(texture2D(t, p / 6.0).rgb, texture2D(t, p / 17.3 + 0.37).rgb, 0.4); }`)
        .replace('#include <map_fragment>', `
          vec2 wp = vWPos.xz;
          float slope = 1.0 - normalize(vWN).y;
          float cliff = smoothstep(0.2, 0.5, slope);
          float wG = vW0.x * (1.0 - cliff), wD = vW0.y, wS = vW0.z * (1.0 - cliff * 0.5), wR = clamp(vW0.w + cliff, 0.0, 1.0), wF = vW1.x * (1.0 - cliff), wP = vW1.y * (1.0 - cliff);
          float ws = max(wG + wD + wS + wR + wF + wP, 0.001);
          vec3 col = (splat(tGrass, wp) * wG + splat(tDirt, wp) * wD + splat(tSand, wp) * wS + splat(tRock, wp * 0.7) * wR + splat(tForest, wp) * wF + splat(tPaddy, wp * 0.8) * wP) / ws;
          float bn = texture2D(tBurn, wp / ${N}.0 + vec2(0.0)).r;
          float nz = texture2D(tDirt, wp * 0.17).r;
          float burn = smoothstep(0.28, 0.62, bn + (nz - 0.5) * 0.55);
          float ember = smoothstep(0.55, 0.9, bn) * smoothstep(0.55, 0.8, nz) * 0.0;
          col = mix(col, vec3(0.045, 0.04, 0.036) * (0.5 + nz), burn * 0.93);
          diffuseColor.rgb *= col;
        `);
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;

    // ---- water ----
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSun: { value: sunDir.clone().normalize() } }]),
      vertexShader: `#include <fog_pars_vertex>
        varying vec3 vW;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `#include <fog_pars_fragment>
        uniform float uTime; uniform vec3 uSun; varying vec3 vW;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
        float wave(vec2 p){ return vn(p*0.55 + vec2(uTime*0.22, uTime*0.13))*0.6 + vn(p*1.3 - vec2(uTime*0.3, -uTime*0.2))*0.3 + vn(p*3.1 + uTime*0.4)*0.1; }
        void main(){
          vec2 p = vW.xz;
          float e = 0.08; float h0 = wave(p);
          vec3 n = normalize(vec3((h0 - wave(p+vec2(e,0.0)))*1.4, 1.0, (h0 - wave(p+vec2(0.0,e)))*1.4));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          vec3 deep = vec3(0.03, 0.2, 0.3), shallow = vec3(0.09, 0.45, 0.5), sky = vec3(0.55, 0.75, 0.9);
          vec3 col = mix(deep, shallow, h0 * 0.7 + 0.15);
          col = mix(col, sky, fres * 0.65);
          vec3 R = reflect(-uSun, n); float spec = pow(max(dot(R, V), 0.0), 90.0);
          col += vec3(1.0, 0.95, 0.8) * spec * 1.4;
          float sparkle = smoothstep(0.9, 1.0, vn(p * 5.0 + uTime * 0.9)) * 0.25;
          col += sparkle;
          gl_FragColor = vec4(col, 0.8 + fres * 0.15);
          #include <fog_fragment>
        }`,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(N + 120, N + 120, 1, 1), this.waterMat);
    this.water.rotation.x = -Math.PI / 2; this.water.position.set(N / 2, WATER_Y, N / 2); this.water.renderOrder = 2;
  }

  update(time: number) { this.waterMat.uniforms.uTime.value = time; }

  /** Copy sim scorch map into the GPU texture (with a little blur for soft edges). */
  setBurnt(src: Uint8Array) {
    const d = this.burnData;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        s += src[yy * N + xx] * (dx === 0 && dy === 0 ? 3 : 1); c += dx === 0 && dy === 0 ? 3 : 1;
      }
      d[y * N + x] = Math.round((s / c) * 255);
    }
    this.burnTex.needsUpdate = true;
  }
}

/** 2D colour map for the minimap. */
export function buildMinimapCanvas(map: GameMap, px = 256): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d')!;
  const img = g.createImageData(px, px);
  const col: Record<number, [number, number, number]> = {
    [Cell.Grass]: [96, 150, 60], [Cell.Dirt]: [140, 104, 66], [Cell.Sand]: [214, 196, 140], [Cell.Rock]: [120, 118, 112],
    [Cell.Water]: [46, 112, 150], [Cell.Paddy]: [150, 196, 70], [Cell.Forest]: [50, 100, 46],
  };
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const cx = Math.floor((x / px) * N), cy = Math.floor((y / px) * N);
    const t = map.type[cy * N + cx];
    const hh = map.height[cy * (N + 1) + cx];
    const sh = 0.82 + Math.max(-0.2, Math.min(0.3, hh * 0.1));
    const [r, gg, b] = col[t];
    const i = (y * px + x) * 4;
    img.data[i] = r * sh; img.data[i + 1] = gg * sh; img.data[i + 2] = b * sh; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
