import './ui/style.css';
import * as THREE from 'three';
import { loadAssets, type Assets } from './render/assets';
import { Menu, type StartConfig } from './ui/menu';
import { World, DT } from './sim/world';
import { AI } from './sim/ai';
import { GameView } from './render/view';
import { buildMinimapCanvas } from './render/terrain';
import { Controls } from './input/controls';
import { Hud } from './ui/hud';
import { AudioFx } from './audio/audio';

// test hook: ?timer drives frames with setTimeout (hidden tabs pause requestAnimationFrame)
if (new URLSearchParams(location.search).has('timer')) {
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  window.cancelAnimationFrame = (id) => clearTimeout(id);
}

const host = document.getElementById('gl')!;
const audio = new AudioFx();
let assets: Assets;
let menu: Menu | null = null;
let game: { stop: () => void } | null = null;

function showMenu() {
  game?.stop(); game = null;
  menu = new Menu(host, assets, (cfg) => { audio.init(); menu?.dispose(); menu = null; startGame(cfg); });
}

function startGame(cfg: StartConfig) {
  const world = new World({ tribes: [cfg.tribe, cfg.enemy], preset: cfg.preset, humans: [0] });
  if (cfg.demo) {
    for (const p of world.players) { p.epoch = 4; p.res = { pangan: 3000, kayu: 3000, emas: 3000 }; world.recomputeMods(p.id); }
    const s = world.map.spawns[0];
    for (const [dx, dy] of [[7, -9], [9, 6]] as const) { const fx = Math.round(s.x + dx), fy = Math.round(s.y + dy); if (world.canPlace(fx, fy, 3)) { world.spawnBuilding(0, 'reactor', fx, fy, true); break; } }
    for (let i = 0; i < 6; i++) world.spawnUnit(0, 'prajurit', s.x + 4 + i * 0.7, s.y + 6);
    world.recomputePop();
  }
  const ai = new AI(world, 1, cfg.difficulty);
  const view = new GameView(host, world, assets);
  const controls = new Controls(view, world, host);
  const hud = new Hud({
    world, view, controls, audio, human: 0, minimapBase: buildMinimapCanvas(world.map),
    onQuit: () => showMenu(), onRestart: () => { game?.stop(); game = null; startGame(cfg); },
  });
  const tc = world.tc(0)!;
  view.focus(tc.x + 3, tc.y + 3); view.rig.gdist = 36; view.rig.dist = 46;
  controls.select([tc.id]);
  audio.startMusic(cfg.tribe);
  // selection barks
  const origChange = controls.onChange;
  controls.onChange = () => { origChange(); const us = controls.selectedUnits(); if (us.length === 1) hud.bark(us[0]); };

  let acc = 0, last = performance.now(), raf = 0, stopped = false;
  const loop = () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!hud.paused) {
      acc += dt * hud.speed;
      let steps = 0;
      while (acc >= DT && steps++ < 8) {
        ai.update(); world.step(); acc -= DT;
        const evs = world.drainEvents();
        if (evs.length) { view.handleEvents(evs); hud.handleEvents(evs); }
        // drop dead entities from selection
        if (world.tick % 10 === 0) for (const id of [...view.selection]) if (!world.get(id)) { view.selection.delete(id); controls.onChange(); }
      }
      if (acc > DT * 4) acc = DT * 4;
    }
    controls.update(dt);
    view.frame(dt, hud.paused ? 0 : acc, world.time);
    hud.frame(dt);
  };
  loop();
  (window as any).__game = { world, view, controls, hud, ai, THREE };
  game = {
    stop: () => {
      stopped = true; cancelAnimationFrame(raf); audio.stopMusic(); audio.stopSiren();
      hud.destroy(); view.dispose(); document.querySelectorAll('.selbox,.float').forEach((e) => e.remove());
      delete (window as any).__game;
    },
  };
}

(async function boot() {
  const bar = document.getElementById('lbar')!, label = document.getElementById('llabel')!;
  const gl = document.createElement('canvas').getContext('webgl2');
  const aniso = gl ? (gl.getExtension('EXT_texture_filter_anisotropic') ? (gl.getParameter(0x84ff) as number) : 1) : 1;
  assets = await loadAssets((p, l) => { bar.style.width = Math.round(p * 100) + '%'; label.textContent = `Memuat ${l}…`; }, aniso);
  document.getElementById('loading')!.remove();
  showMenu();
})();
