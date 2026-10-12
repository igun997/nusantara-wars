import type { GameView } from '../render/view';
import type { Controls } from '../input/controls';
import type { Building, GameEvent, Resource, Unit, World, Entity } from '../sim/world';
import { ADVISOR, NUKE, RES_ICON, RES_NAME, type BRole, type Cost, type Role } from '../data/game';
import type { AudioFx } from '../audio/audio';
import { N } from '../sim/map';

const ROLE_ICON: Record<Role, string> = { warga: '🧑‍🌾', prajurit: '⚔️', pemanah: '🏹', siege: '💥', hero: '🎭' };
const B_ICON: Record<BRole, string> = { tc: '🏯', house: '🏠', barracks: '🛡️', reactor: '☢️' };
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/"/g, '&quot;');

export interface HudOpts {
  world: World; view: GameView; controls: Controls; audio: AudioFx; minimapBase: HTMLCanvasElement; human: number;
  onQuit: () => void; onRestart: () => void;
}

export class Hud {
  paused = false; speed = 1; over = false;
  private w: World; private view: GameView; private ctl: Controls; private audio: AudioFx; private me: number;
  private el: Record<string, HTMLElement> = {};
  private mm!: HTMLCanvasElement; private mmg!: CanvasRenderingContext2D; private mmTimer = 0; private uiTimer = 0;
  private sig = ''; private lastSay = new Map<string, number>(); private tipEl: HTMLElement; private lastTip = 0;
  private lastDeposit = 0; private nukeAfterAt = 0;

  constructor(private o: HudOpts) {
    this.w = o.world; this.view = o.view; this.ctl = o.controls; this.audio = o.audio; this.me = o.human;
    const root = document.createElement('div'); root.id = 'hud';
    root.innerHTML = `
      <div id="topbar" class="panel">
        <div class="res" id="r-pangan">🌾 <span>0</span><small></small></div>
        <div class="res" id="r-kayu">🪵 <span>0</span><small></small></div>
        <div class="res" id="r-emas">🪙 <span>0</span><small></small></div>
        <div class="pop" id="pop">👥 0/0</div>
        <div class="epoch" id="epoch"></div>
        <div class="time" id="time">00:00</div>
        <button class="btn" id="sp1">1×</button><button class="btn" id="sp2">2×</button><button class="btn" id="sp3">3×</button>
        <button class="btn" id="snd">🔊</button><button class="btn" id="pause">⏸</button>
      </div>
      <div id="advisor"></div>
      <div id="toast" class="hidden"></div>
      <div id="nukewarn" class="hidden"><h3 id="nw-t"></h3><div class="cnt" id="nw-c">20</div><small id="nw-s"></small></div>
      <div id="hint" class="panel">
        <h4>Cara bermain</h4>
        <div><kbd>Klik kiri</kbd> pilih · <kbd>Drag</kbd> kotak seleksi · <kbd>Klik kanan</kbd> perintah (panen / serang / jalan)</div>
        <div><kbd>WASD</kbd>/tepi layar geser · <kbd>Scroll</kbd> zoom · <kbd>Q/E</kbd> putar · <kbd>Ctrl+1-9</kbd> grup · <kbd>H</kbd> markas · <kbd>A</kbd> serang-jalan · <kbd>.</kbd> petani menganggur · <kbd>R</kbd> kemampuan hero · <kbd>N</kbd> nuklir · <kbd>P</kbd> jeda</div>
        <div>Pilih <b>petani</b> untuk membangun. Naik zaman di <b>${this.w.tribe(this.me).buildings.tc.name}</b>, bangun reaktor di Era Atom, lalu luncurkan nuklir. 😈</div>
        <button class="btn" id="hint-ok">Mengerti</button>
      </div>
      <div id="minimapWrap" class="panel"><canvas id="minimap" width="256" height="256"></canvas></div>
      <div id="bottom"><div id="info" class="panel"></div><div id="cmd" class="panel"></div></div>`;
    document.getElementById('app')!.appendChild(root);
    for (const id of ['topbar', 'advisor', 'toast', 'nukewarn', 'nw-t', 'nw-c', 'nw-s', 'hint', 'info', 'cmd', 'pop', 'epoch', 'time', 'snd', 'pause', 'sp1', 'sp2', 'sp3', 'r-pangan', 'r-kayu', 'r-emas']) this.el[id] = root.querySelector('#' + id)!;
    this.tipEl = document.createElement('div'); this.tipEl.id = 'tip'; this.tipEl.className = 'hidden'; document.body.appendChild(this.tipEl);
    this.mm = root.querySelector('#minimap')!; this.mmg = this.mm.getContext('2d')!;
    (root.querySelector('#hint-ok') as HTMLElement).onclick = () => this.el.hint.classList.add('hidden');
    setTimeout(() => this.el.hint.classList.add('hidden'), 45000);

    for (const n of [1, 2, 3]) (this.el['sp' + n] as HTMLElement).onclick = () => { this.speed = n; this.syncSpeed(); };
    this.syncSpeed();
    this.el.snd.onclick = () => { this.audio.setMuted(!this.audio.muted); this.el.snd.textContent = this.audio.muted ? '🔇' : '🔊'; };
    this.el.pause.onclick = () => this.togglePause();

    // minimap interaction
    const mmMove = (e: PointerEvent, cmd: boolean) => {
      const r = this.mm.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * N, y = ((e.clientY - r.top) / r.height) * N;
      if (cmd) { const ids = this.ctl.selectedUnits().map((u) => u.id); if (ids.length) { this.ctl.issue({ t: 'move', ids, x, y }); this.view.ping(x, y); } }
      else this.view.focus(x, y);
    };
    let down = false;
    this.mm.addEventListener('pointerdown', (e) => { e.preventDefault(); if (e.button === 2) mmMove(e, true); else { down = true; mmMove(e, false); } });
    this.mm.addEventListener('pointermove', (e) => { if (down) mmMove(e, false); });
    addEventListener('pointerup', () => { down = false; });
    this.mm.addEventListener('contextmenu', (e) => e.preventDefault());

    // command card + info clicks (delegation)
    const onClick = (e: Event) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null; if (!t) return;
      this.audio.click(); this.doAct(t.dataset.act!);
    };
    this.el.cmd.addEventListener('click', onClick); this.el.info.addEventListener('click', onClick);
    for (const host of [this.el.cmd, this.el.info]) {
      host.addEventListener('mouseover', (e) => { const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null; if (t) this.showTip(t); else this.tipEl.classList.add('hidden'); });
      host.addEventListener('mouseleave', () => this.tipEl.classList.add('hidden'));
    }
    addEventListener('pointermove', (e) => { this.tipEl.style.left = Math.min(innerWidth - 300, e.clientX + 14) + 'px'; this.tipEl.style.top = Math.max(8, e.clientY - this.tipEl.offsetHeight - 14) + 'px'; });

    addEventListener('keydown', (e) => {
      if (this.over || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'KeyR') this.doAct('ability');
      else if (e.code === 'KeyN') this.doAct('nuke');
      else if (e.code === 'KeyP') this.togglePause();
    });
    this.ctl.onChange = () => { this.sig = ''; this.refreshPanels(); };
    this.ctl.onNotify = (m) => this.toast(m);
    this.ctl.onCommandSound = (k) => { if (k === 'select') this.audio.select(); else this.audio.ack(k); };
    this.say(pick(ADVISOR.start[this.w.tribe(this.me).id]));
  }

  destroy() { document.getElementById('hud')?.remove(); this.tipEl.remove(); document.getElementById('overlay')?.remove(); }
  private syncSpeed() { for (const n of [1, 2, 3]) this.el['sp' + n].classList.toggle('on', this.speed === n); }
  togglePause() {
    this.paused = !this.paused; this.el.pause.classList.toggle('on', this.paused);
    if (this.paused) this.showModal('Jeda', '<p>Permainan dijeda. Strategi dulu, kopi kemudian.</p>', [['Lanjut', () => this.togglePause(), true], ['Grafis: ' + this.view.quality, () => { const n = ({ auto: 'low', low: 'high', high: 'auto' } as const)[this.view.quality]; this.view.setQuality(n); this.togglePause(); this.togglePause(); }], ['Mulai ulang', () => this.o.onRestart()], ['Menu utama', () => this.o.onQuit()]]);
    else document.getElementById('overlay')?.remove();
  }

  // ------------------------------------------------------------------ small UI helpers
  toast(msg: string) {
    const t = this.el.toast; t.textContent = msg; t.classList.remove('hidden'); t.style.opacity = '1';
    clearTimeout((t as any)._h); (t as any)._h = setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.classList.add('hidden'), 300); }, 1800);
  }
  say(text: string, who?: string) {
    const tribe = this.w.tribe(this.me);
    const m = document.createElement('div'); m.className = 'msg panel';
    m.innerHTML = `<div class="av">🎭</div><div class="tx"><b>${who ?? tribe.advisor.name}</b>${text}</div>`;
    this.el.advisor.appendChild(m);
    while (this.el.advisor.children.length > 3) this.el.advisor.firstElementChild!.remove();
    setTimeout(() => m.classList.add('out'), 7500); setTimeout(() => m.remove(), 8200);
  }
  private sayLimited(key: string, gap: number, text: string) {
    const n = this.w.time; if (n - (this.lastSay.get(key) ?? -999) < gap) return; this.lastSay.set(key, n); this.say(text);
  }
  floatText(text: string, x: number, z: number, color = '#fff', yOff = 1.6) {
    const s = this.view.project(x, this.w.heightAt(x, z) + yOff, z); if (!s.on) return;
    const d = document.createElement('div'); d.className = 'float'; d.textContent = text; d.style.color = color;
    const r = this.view.renderer.domElement.getBoundingClientRect();
    d.style.left = r.left + s.x + 'px'; d.style.top = r.top + s.y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 1300);
  }
  bark(u: Unit) { this.floatText(pick(this.w.tribe(u.owner).barks[u.def.role]), u.x, u.y, '#ffe9a8', 2.3); }
  private showModal(title: string, body: string, buttons: [string, () => void, boolean?][]) {
    document.getElementById('overlay')?.remove();
    const o = document.createElement('div'); o.id = 'overlay';
    o.innerHTML = `<div class="modal panel"><h2>${title}</h2>${body}<div class="row"></div></div>`;
    const row = o.querySelector('.row')!;
    for (const [label, fn, primary] of buttons) { const b = document.createElement('button'); b.className = 'btn big' + (primary ? ' primary' : ''); b.textContent = label; b.onclick = () => fn(); row.appendChild(b); }
    document.body.appendChild(o);
  }

  // ------------------------------------------------------------------ events from sim
  handleEvents(evs: GameEvent[]) {
    const w = this.w, tribe = w.tribe(this.me);
    for (const e of evs) {
      switch (e.t) {
        case 'epoch': {
          if (e.owner === this.me) { this.say(`<i>${tribe.epochs[e.epoch - 1].name}</i>: ${pick(ADVISOR.epoch[tribe.id])}<br>“${tribe.epochs[e.epoch - 1].quote}”`); this.audio.epoch(tribe.id); }
          else this.say(`Musuh memasuki <b>${w.players[e.owner].tribe.epochs[e.epoch - 1].name}</b>. Bersiaplah!`, 'Intel');
          this.sig = ''; break;
        }
        case 'tech': if (e.owner === this.me) { const t = tribe.techs.find((x) => x.id === e.id)!; this.say(`<b>${t.name}</b> selesai. ${t.wisdom}`); } break;
        case 'built': if (e.owner === this.me) { this.audio.built(); this.sayLimited('built', 60, pick(ADVISOR.built[tribe.id])); this.sig = ''; } break;
        case 'trained': if (e.owner === this.me) { this.audio.trained(); this.sig = ''; } break;
        case 'attacked': if (e.owner === this.me) this.sayLimited('att', 20, pick(ADVISOR.attacked[tribe.id])); break;
        case 'popcap': if (e.owner === this.me) { this.toast('Populasi penuh. Bangun rumah!'); this.sayLimited('pop', 25, pick(ADVISOR.houseNeeded[tribe.id])); this.audio.ack('error'); } break;
        case 'deposit': if (e.owner === this.me && w.time - this.lastDeposit > 0.35) { this.lastDeposit = w.time; this.floatText(`+${e.amount} ${RES_ICON[e.kind]}`, e.x, e.y, '#c8ffb0'); this.audio.deposit(); } break;
        case 'ability': this.floatText(e.kind === 'heal' ? '+90 ♥ Wejangan!' : 'HAHAHA!! 🤣', e.x, e.y, e.kind === 'heal' ? '#7dffa8' : '#ffd84a', 2.8); e.kind === 'heal' ? this.audio.heal() : this.audio.laugh(); break;
        case 'nuke_arm': {
          this.audio.nukeArm(); this.audio.startSiren();
          if (e.shot.owner === this.me) this.say(pick(ADVISOR.nukeSelf[tribe.id]));
          else this.say(pick(ADVISOR.nukeEnemy[tribe.id]));
          break;
        }
        case 'nuke_launch': this.audio.nukeLaunch(); break;
        case 'nuke_cancel': this.say(pick(ADVISOR.nukeCancel[tribe.id])); if (!w.nukes.some((n) => !n.done)) this.audio.stopSiren(); break;
        case 'nuke_hit': {
          if (!w.nukes.some((n) => !n.done && n.id !== e.shot.id)) this.audio.stopSiren();
          const d = Math.hypot(this.view.rig.x - e.shot.tx, this.view.rig.z - e.shot.ty);
          this.audio.nukeBoom(1 / (1 + d / 45)); this.nukeAfterAt = w.time + 5; break;
        }
        case 'death': if (e.owner >= 0 && !e.unit) { this.audio.collapse(); if (e.owner === this.me) this.toast('Bangunan runtuh!'); } else if (e.owner >= 0) this.audio.die(); break;
        case 'shot': e.kind === 'cannon' ? this.audio.cannon() : this.audio.arrow(); break;
        case 'hit': this.audio.hit(e.big); break;
        case 'gameover': this.onGameOver(e.winner); break;
      }
    }
  }
  private onGameOver(winner: number) {
    if (this.over) return; this.over = true;
    const tribe = this.w.tribe(this.me); const won = winner === this.me;
    this.say(pick((won ? ADVISOR.win : ADVISOR.lose)[tribe.id]));
    const byNuke = this.w.nukes.some((n) => n.done && this.w.time - n.impactAt < 15);
    setTimeout(() => {
      const st = this.w.players[this.me].stats;
      this.showModal(won ? 'MENANG! 🏆' : 'KALAH 💀',
        `<p>${won ? 'Keraton lawan runtuh. Slametan kambing guling diumumkan.' : 'Markas Anda runtuh. Tapi besok bisa balas dendam.'}</p>
         <table><tr><td>Waktu</td><td>${fmtTime(this.w.time)}</td></tr><tr><td>Musuh dikalahkan</td><td>${st.kills}</td></tr><tr><td>Kehilangan</td><td>${st.lost}</td></tr>
         <tr><td>Hasil panen</td><td>${Math.round(st.gathered)}</td></tr><tr><td>Nuklir diluncurkan</td><td>${st.nukes} ☢️</td></tr></table>`,
        [['Main lagi', () => this.o.onRestart(), true], ['Menu utama', () => this.o.onQuit()]]);
    }, byNuke ? 13000 : won ? 2500 : 4500);
  }

  // ------------------------------------------------------------------ per-frame
  frame(dt: number) {
    const w = this.w, pl = w.players[this.me];
    this.uiTimer += dt; this.mmTimer += dt;
    this.updateNukeWarn();
    if (this.nukeAfterAt && w.time > this.nukeAfterAt) { this.nukeAfterAt = 0; this.say(pick(ADVISOR.nukeAfter[w.tribe(this.me).id])); }
    if (this.mmTimer > 0.1) { this.mmTimer = 0; this.drawMinimap(); }
    if (this.uiTimer < 0.15) return;
    this.uiTimer = 0;
    // top bar
    for (const k of ['pangan', 'kayu', 'emas'] as const) (this.el['r-' + k].querySelector('span') as HTMLElement).textContent = String(Math.floor(pl.res[k]));
    this.el.pop.textContent = `👥 ${pl.pop}/${pl.popCap}`; this.el.pop.classList.toggle('full', pl.pop >= pl.popCap);
    this.el.epoch.textContent = `${w.tribe(this.me).icon} ${w.tribe(this.me).epochs[pl.epoch - 1].name}`;
    this.el.time.textContent = fmtTime(w.time);
    // idle tips
    if (w.time > 100 && Math.floor(w.time) % 120 === 0 && this.lastSay.get('tip') !== Math.floor(w.time)) { this.lastSay.set('tip', Math.floor(w.time)); this.say(pick(ADVISOR.tips), 'Tips'); }
    this.refreshPanels();
  }

  private updateNukeWarn() {
    const w = this.w;
    const active = w.nukes.filter((n) => !n.done).sort((a, b) => a.impactAt - b.impactAt)[0];
    const el = this.el.nukewarn;
    if (!active) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const mine = active.owner === this.me;
    const left = Math.max(0, active.impactAt - w.time);
    const tc = w.tc(this.me);
    const nearBase = tc && Math.hypot(tc.x - active.tx, tc.y - active.ty) < NUKE.radius + 4;
    this.el['nw-t'].textContent = mine ? `☢ ${w.tribe(this.me).nuke.name.toUpperCase()} DILUNCURKAN` : '⚠ PERINGATAN: ROKET ATOM MUSUH';
    this.el['nw-c'].textContent = left.toFixed(1);
    this.el['nw-s'].textContent = active.launched ? 'Roket di udara. Tak bisa dicegat!' : mine ? 'Lindungi reaktor Anda sampai peluncuran.' : nearBase ? 'MENUJU MARKAS ANDA! Evakuasi pasukan dan hancurkan silo lawan!' : 'Hancurkan silo lawan sebelum peluncuran, atau jauhi zona merah.';
  }

  private drawMinimap() {
    const g = this.mmg, w = this.w, S = 256, k = S / N;
    g.drawImage(this.o.minimapBase, 0, 0, S, S);
    for (const r of w.resources) { if (r.dead || r.resKind === 'tree') continue; g.fillStyle = r.resKind === 'gold' ? '#ffd23a' : '#d8f070'; g.fillRect(r.fx * k, r.fy * k, 3, 3); }
    for (let i = 0; i < w.burnt.length; i += 1) if (w.burnt[i]) { g.fillStyle = 'rgba(20,10,5,0.55)'; g.fillRect((i % N) * k, Math.floor(i / N) * k, k + 0.5, k + 0.5); }
    for (const b of w.buildings) { if (b.dead) continue; g.fillStyle = b.owner === this.me ? '#2bd9ff' : '#ff4a4a'; g.fillRect(b.fx * k, b.fy * k, b.size * k, b.size * k); }
    for (const u of w.units) { if (u.dead) continue; g.fillStyle = u.owner === this.me ? '#9be9ff' : '#ff8a7a'; g.fillRect(u.x * k - 1, u.y * k - 1, 2.5, 2.5); }
    for (const n of w.nukes) {
      if (n.done) continue;
      const p = 0.5 + 0.5 * Math.sin(w.time * 8);
      g.strokeStyle = `rgba(255,${60 + 90 * p},40,0.95)`; g.lineWidth = 2; g.beginPath(); g.arc(n.tx * k, n.ty * k, NUKE.radius * k, 0, 6.283); g.stroke();
      g.fillStyle = `rgba(255,60,30,${0.15 + 0.2 * p})`; g.fill();
    }
    const q = this.view.viewQuad();
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5; g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p.x * k, p.y * k) : g.moveTo(p.x * k, p.y * k))); g.closePath(); g.stroke();
  }

  // ------------------------------------------------------------------ info + command panels
  private refreshPanels() {
    const w = this.w, pl = w.players[this.me];
    const sel = this.ctl.selectedEntities();
    const sig = [sel.map((e) => e.id + ':' + (e.kind === 'building' ? (e as Building).queue.length + ':' + (e as Building).built : '')).join(','), pl.epoch, pl.techs.size, this.ctl.mode.k, pl.pop >= pl.popCap, w.units.length > 0 ? sel.reduce((a, e) => a + (e.kind === 'unit' ? 1 : 0), 0) : 0].join('|');
    if (sig !== this.sig) { this.sig = sig; this.buildInfo(sel); this.buildCmd(sel); }
    this.updateDynamic(sel);
  }
  private nameOf(e: Entity): string {
    if (e.kind === 'unit') return e.def.name;
    if (e.kind === 'building') return e.def.name;
    return e.resKind === 'tree' ? 'Pohon' : e.resKind === 'paddy' ? 'Sawah' : 'Tambang Emas';
  }
  private buildInfo(sel: Entity[]) {
    const w = this.w, info = this.el.info;
    if (!sel.length) {
      const t = w.tribe(this.me);
      info.innerHTML = `<h2>${t.icon} ${t.name} <small>${t.epochs[w.players[this.me].epoch - 1].name}</small></h2><div class="desc">${t.tagline}</div><div class="desc"><b>Bonus:</b> ${t.bonuses.join(' · ')}</div><div class="desc" style="margin-top:auto">“${pick(t.wisdom)}”</div>`;
      return;
    }
    if (sel.length > 1) {
      info.innerHTML = `<h2>${sel.length} dipilih</h2><div class="multi">${sel.slice(0, 40).map((e) => `<div class="chip" data-act="only:${e.id}">${e.kind === 'unit' ? ROLE_ICON[e.def.role] : e.kind === 'building' ? B_ICON[e.def.role] : '🌳'}<i style="width:${Math.max(0, Math.min(100, (e.hp / e.maxHp) * 100)) * 0.9}%"></i></div>`).join('')}</div>`;
      return;
    }
    const e = sel[0]; const mine = e.owner === this.me;
    const who = e.owner === -1 ? 'Netral' : mine ? 'Anda' : 'Musuh';
    let html = `<h2>${this.nameOf(e)} <small>${who}${e.kind !== 'resource' ? ' · ' + w.players[e.owner].tribe.name : ''}</small></h2>`;
    if (e.kind === 'unit') {
      const d = e.def;
      html += `<div class="hpbar"><i id="i-hp"></i></div><div class="stats"><span id="i-hpt">♥</span><span>⚔ ${Math.round(d.dmg * w.players[e.owner].mods.dmg)}</span><span>🎯 ${d.range}</span><span>👟 ${d.speed}</span></div><div class="desc">${d.desc}</div>`;
      html += `<div class="desc" id="i-state"></div>`;
    } else if (e.kind === 'building') {
      html += `<div class="hpbar"><i id="i-hp"></i></div><div class="stats"><span id="i-hpt">♥</span><span id="i-prog"></span></div><div class="desc">${e.def.desc}</div>`;
      if (mine && e.queue.length) {
        html += `<div class="queue">${e.queue.map((q, i) => `<div class="qi" data-act="cancel:${e.id}:${i}" data-qi="${i}">${q.kind === 'unit' ? ROLE_ICON[q.id as Role] : q.kind === 'epoch' ? '📜' : '✨'}<b></b></div>`).join('')}</div>`;
      }
    } else {
      html += `<div class="stats"><span id="i-res"></span></div><div class="desc">${e.resKind === 'paddy' ? 'Sawah subur: tumbuh lagi seiring waktu.' : e.resKind === 'tree' ? 'Kayu untuk bangunan dan pasukan.' : 'Emas untuk teknologi dan senjata pamungkas.'}</div>`;
    }
    info.innerHTML = html;
  }
  private updateDynamic(sel: Entity[]) {
    const w = this.w;
    if (sel.length === 1) {
      const e = sel[0];
      const hp = this.el.info.querySelector('#i-hp') as HTMLElement | null;
      if (hp && e.kind !== 'resource') { const f = e.hp / e.maxHp; hp.style.width = f * 100 + '%'; hp.style.background = f > 0.6 ? '#56e07a' : f > 0.3 ? '#f2c230' : '#e5483a'; const t = this.el.info.querySelector('#i-hpt'); if (t) t.textContent = `♥ ${Math.ceil(e.hp)}/${e.maxHp}`; }
      const st = this.el.info.querySelector('#i-state'); if (st && e.kind === 'unit') st.textContent = ({ idle: 'Diam', move: 'Bergerak', attack: 'Bertempur', gather: e.gPhase === 'return' ? 'Mengantar hasil' : 'Memanen', build: 'Membangun' } as any)[e.state] + (e.carry > 0 ? ` · bawa ${Math.floor(e.carry)} ${RES_ICON[e.carryKind!]}` : '') + (e.laughUntil > w.time ? ' · TERTAWA 🤣' : '');
      const pr = this.el.info.querySelector('#i-prog'); if (pr && e.kind === 'building') pr.textContent = e.built ? '' : `Dibangun ${Math.floor(e.progress * 100)}%`;
      const rs = this.el.info.querySelector('#i-res'); if (rs && e.kind === 'resource') rs.textContent = `${RES_ICON[e.res]} ${Math.ceil(e.amount)} ${RES_NAME[e.res]}`;
      if (e.kind === 'building') this.el.info.querySelectorAll<HTMLElement>('.qi').forEach((q) => { const it = e.queue[Number(q.dataset.qi)]; if (it) (q.querySelector('b') as HTMLElement).style.width = (1 - it.left / it.total) * 100 + '%'; });
    } else if (sel.length > 1) {
      const chips = this.el.info.querySelectorAll<HTMLElement>('.chip');
      chips.forEach((c, i) => { const e = sel[i]; if (e && e.kind !== 'resource') (c.querySelector('i') as HTMLElement).style.width = Math.max(0, (e.hp / e.maxHp) * 90) + '%'; });
    }
    // affordability + cooldown
    for (const b of this.el.cmd.querySelectorAll<HTMLElement>('.cbtn')) {
      const ok = this.canDo(b.dataset.act!);
      b.classList.toggle('dis', !ok);
      const cd = b.querySelector('.cd') as HTMLElement | null;
      if (cd) { const f = this.cooldownFrac(b.dataset.act!); cd.style.height = f * 100 + '%'; }
    }
  }
  private cooldownFrac(act: string): number {
    const w = this.w;
    if (act === 'nuke') { const pl = w.players[this.me]; return Math.max(0, Math.min(1, (pl.nukeReadyAt - w.time) / (NUKE.cooldown + NUKE.countdown))); }
    if (act === 'ability') { const h = this.ctl.selectedUnits().find((u) => u.def.role === 'hero'); return h ? Math.min(1, h.abilityCd / w.tribe(this.me).hero.cooldown) : 0; }
    return 0;
  }

  private btn(act: string, icon: string, label: string, extra = '', key = '') {
    return `<button class="cbtn ${extra}" data-act="${act}">${icon}<small>${label}</small>${key ? `<span class="key">${key}</span>` : ''}<div class="cd"></div></button>`;
  }
  private buildCmd(sel: Entity[]) {
    const w = this.w, pl = w.players[this.me], t = w.tribe(this.me);
    const mine = sel.filter((e) => e.owner === this.me);
    const units = mine.filter((e): e is Unit => e.kind === 'unit');
    const blds = mine.filter((e): e is Building => e.kind === 'building');
    let h = '';
    if (this.ctl.mode.k !== 'normal') h += this.btn('cancelmode', '✖', 'Batal', 'hot', 'Esc');
    if (units.some((u) => u.def.role === 'warga')) {
      for (const role of ['house', 'barracks', 'reactor'] as BRole[]) {
        const d = t.buildings[role]; if (d.epoch > pl.epoch) continue;
        h += this.btn('build:' + role, B_ICON[role], d.name.split(' ').slice(0, 2).join(' '), role === 'reactor' ? 'nuke' : '');
      }
    }
    if (units.length) {
      h += this.btn('stop', '✋', 'Henti', '', 'S');
      if (units.some((u) => u.def.role !== 'warga')) h += this.btn('amove', '🗡️', 'Serang-jalan', '', 'A');
      if (units.some((u) => u.def.role === 'hero')) h += this.btn('ability', '✨', t.hero.ability, 'hot', 'R');
    }
    if (blds.length === 1 && blds[0].built) {
      const b = blds[0];
      for (const r of b.def.produces) {
        const d = t.units[r]; if (d.epoch > pl.epoch) continue;
        h += this.btn('train:' + r, r === 'siege' ? (t.id === 'jawa' ? '🛺' : '🚐') : ROLE_ICON[r], d.name.split(' ').slice(0, 2).join(' '));
      }
      if (b.def.role === 'tc') {
        if (pl.epoch < 4) h += this.btn('epoch', '📜', 'Naik Zaman', 'hot');
        for (const tech of t.techs) { if (pl.techs.has(tech.id) || tech.epoch > pl.epoch) continue; h += this.btn('tech:' + tech.id, '✨', tech.name.split(' ').slice(0, 2).join(' ')); }
      }
      if (b.def.role === 'reactor') h += this.btn('nuke', '☢️', t.nuke.name.split(' ')[0], 'nuke', 'N');
      if (b.def.role !== 'reactor') h += this.btn('rally', '🚩', 'Titik kumpul');
    }
    this.el.cmd.innerHTML = h;
  }
  private canDo(act: string): boolean {
    const w = this.w, pl = w.players[this.me], t = w.tribe(this.me);
    const [k, arg] = act.split(':');
    switch (k) {
      case 'build': return w.canAfford(this.me, t.buildings[arg as BRole].cost) && !(arg === 'reactor' && w.playerBuildings(this.me, 'reactor').length >= 2);
      case 'train': { const d = t.units[arg as Role]; return w.canAfford(this.me, d.cost) && pl.pop + d.pop <= pl.popCap && !(arg === 'hero' && (w.units.some((u) => u.owner === this.me && !u.dead && u.def.role === 'hero') || w.buildings.some((b) => b.owner === this.me && b.queue.some((q) => q.id === 'hero')))); }
      case 'epoch': { const tc = w.tc(this.me); return pl.epoch < 4 && w.canAfford(this.me, t.epochs[pl.epoch].cost) && !!tc && !tc.queue.some((q) => q.kind !== 'unit'); }
      case 'tech': { const tech = t.techs.find((x) => x.id === arg)!; const tc = w.tc(this.me); return w.canAfford(this.me, tech.cost) && !!tc && !tc.queue.some((q) => q.kind !== 'unit'); }
      case 'nuke': return w.time >= pl.nukeReadyAt && w.canAfford(this.me, NUKE.cost);
      case 'ability': { const h = this.ctl.selectedUnits().find((u) => u.def.role === 'hero'); return !!h && h.abilityCd <= 0; }
    }
    return true;
  }
  private costHtml(c: Cost) {
    const r = this.w.players[this.me].res;
    return (['pangan', 'kayu', 'emas'] as const).filter((k) => c[k]).map((k) => `<span class="${(c[k] ?? 0) > r[k] ? 'bad' : ''}">${RES_ICON[k]} ${c[k]}</span>`).join(' &nbsp;') || 'Gratis';
  }
  private showTip(el: HTMLElement) {
    const act = el.dataset.act!; const [k, arg] = act.split(':');
    const w = this.w, t = w.tribe(this.me), pl = w.players[this.me];
    let html = '';
    if (k === 'build') { const d = t.buildings[arg as BRole]; html = `<b>${d.name}</b><div class="cost">${this.costHtml(d.cost)} · ⏱ ${d.time}d</div>${d.desc}`; }
    else if (k === 'train') { const d = t.units[arg as Role]; html = `<b>${d.name}</b><div class="cost">${this.costHtml(d.cost)} · ⏱ ${d.time}d · 👥 ${d.pop}</div>${d.desc}<br>♥ ${Math.round(d.hp)} ⚔ ${d.dmg} 🎯 ${d.range}`; }
    else if (k === 'epoch') { const ep = t.epochs[pl.epoch]; html = `<b>Naik ke ${ep.name}</b><div class="cost">${this.costHtml(ep.cost)} · ⏱ ${ep.time}d</div>${ep.blurb}<br>+10% HP & serangan pasukan.<div class="wis">“${ep.quote}”</div>`; }
    else if (k === 'tech') { const d = t.techs.find((x) => x.id === arg)!; html = `<b>${d.name}</b><div class="cost">${this.costHtml(d.cost)} · ⏱ ${d.time}d</div>${d.desc}<div class="wis">${d.wisdom}</div>`; }
    else if (k === 'nuke') html = `<b>${t.nuke.name}</b><div class="cost">${this.costHtml(NUKE.cost)}</div>${t.nuke.blurb}<br>Hitung mundur ${NUKE.countdown}d, radius ${NUKE.radius}. Musuh bisa membatalkannya dengan menghancurkan silo ini.`;
    else if (k === 'ability') html = `<b>${t.hero.ability}</b>${t.hero.abilityDesc}`;
    else if (k === 'amove') html = '<b>Serang sambil jalan</b>Pasukan menyerang apa pun yang ditemui di jalan. (A)';
    else if (k === 'stop') html = '<b>Henti</b>Batalkan semua perintah. (S)';
    else if (k === 'rally') html = '<b>Titik kumpul</b>Unit baru akan menuju titik ini. Klik sawah/pohon agar petani langsung memanen.';
    else if (k === 'cancel') html = '<b>Batalkan</b>Sumber daya dikembalikan.';
    else return;
    this.tipEl.innerHTML = html; this.tipEl.classList.remove('hidden'); this.lastTip = performance.now();
  }

  doAct(act: string) {
    const w = this.w; const [k, a1, a2] = act.split(':');
    const sel = this.ctl.selectedEntities();
    const blds = sel.filter((e): e is Building => e.kind === 'building' && e.owner === this.me);
    const sound = (ok: boolean, msg?: string) => { if (!ok) { this.audio.ack('error'); if (msg) this.toast(msg); } };
    switch (k) {
      case 'only': this.ctl.select([Number(a1)]); break;
      case 'cancelmode': this.ctl.cancelMode(); break;
      case 'build': {
        if (!this.canDo(act)) return sound(false, 'Sumber daya kurang!');
        this.ctl.setMode({ k: 'place', role: a1 as BRole }); this.toast('Klik untuk menaruh bangunan · Shift = beruntun · Esc batal'); break;
      }
      case 'train': {
        const cands = blds.filter((b) => b.built && b.def.produces.includes(a1 as Role)); if (!cands.length) return;
        const b = cands.sort((x, y) => x.queue.length - y.queue.length)[0];
        const pl = w.players[this.me]; const d = w.tribe(this.me).units[a1 as Role];
        const before = b.queue.length; w.issue(this.me, { t: 'train', building: b.id, role: a1 as Role });
        if (b.queue.length === before) sound(false, !w.canAfford(this.me, d.cost) ? 'Sumber daya kurang!' : pl.pop + d.pop > pl.popCap ? 'Populasi penuh. Bangun rumah!' : b.queue.length >= 6 ? 'Antrean penuh.' : 'Tidak bisa dilatih.');
        else { this.sig = ''; }
        break;
      }
      case 'epoch': { const tc = blds.find((b) => b.def.role === 'tc'); if (!tc) return; const before = tc.queue.length; w.issue(this.me, { t: 'research', building: tc.id, kind: 'epoch' }); sound(tc.queue.length > before, 'Belum bisa naik zaman.'); this.sig = ''; break; }
      case 'tech': { const tc = blds.find((b) => b.def.role === 'tc'); if (!tc) return; const before = tc.queue.length; w.issue(this.me, { t: 'research', building: tc.id, kind: 'tech', id: a1 }); sound(tc.queue.length > before, 'Belum bisa meneliti.'); this.sig = ''; break; }
      case 'cancel': w.issue(this.me, { t: 'cancel', building: Number(a1), index: Number(a2) }); this.sig = ''; break;
      case 'rally': { const b = blds[0]; if (b) { this.ctl.setMode({ k: 'rally', building: b.id }); this.toast('Klik titik kumpul (sawah/pohon untuk petani)'); } break; }
      case 'stop': this.ctl.issue({ t: 'stop', ids: this.ctl.selectedUnits().map((u) => u.id) }); break;
      case 'amove': this.ctl.setMode({ k: 'attackmove' }); this.toast('Serang-sambil-jalan: klik tujuan'); break;
      case 'ability': { const h = this.ctl.selectedUnits().find((u) => u.def.role === 'hero'); if (h) { w.issue(this.me, { t: 'ability', id: h.id }); sound(h.abilityCd > 0, 'Belum siap.'); } break; }
      case 'nuke': {
        const silo = blds.find((b) => b.def.role === 'reactor'); if (!silo) return;
        if (!this.canDo('nuke')) return sound(false, w.time < w.players[this.me].nukeReadyAt ? 'Reaktor masih mendingin.' : 'Emas/pangan kurang untuk nuklir.');
        this.ctl.setMode({ k: 'nuke', silo: silo.id }); this.toast('Pilih sasaran. Zona merah = radius ledakan.'); break;
      }
    }
  }
  /** Used by main to show the name of an unused helper (keeps lint quiet). */
  get nowTip() { return this.lastTip; }
  resourceInfo(_: Resource) { return ''; }
}
