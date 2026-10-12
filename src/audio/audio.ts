// All sound is synthesised with WebAudio: no audio files needed.
export class AudioFx {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private sfxBus!: GainNode; private musicBus!: GainNode; private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  muted = false; musicOn = true;
  private musicTimer = 0; private musicTribe = 'jawa'; private step = 0; private sirenNode: { stop: () => void } | null = null;
  private lastPlay = new Map<string, number>();

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const ctx = new AudioContext(); this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.22; this.musicBus.connect(this.master);
    // noise + reverb impulse
    const len = ctx.sampleRate * 2; this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.reverb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2.8); }
    this.reverb.buffer = ir;
    const rg = ctx.createGain(); rg.gain.value = 0.35; this.reverb.connect(rg); rg.connect(this.master);
  }
  setMuted(m: boolean) { this.muted = m; if (this.ctx) this.master.gain.value = m ? 0 : 0.8; }
  private throttle(key: string, ms: number) { const n = performance.now(); if (n - (this.lastPlay.get(key) ?? 0) < ms) return false; this.lastPlay.set(key, n); return true; }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, bus: AudioNode = this.sfxBus, slide = 0, wet = 0) {
    const ctx = this.ctx!; const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); if (wet) g.connect(this.reverb);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private noise(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = 'lowpass', when = 0, bus: AudioNode = this.sfxBus, q = 0.7) {
    const ctx = this.ctx!; const t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus); g.connect(this.reverb);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  private bell(freq: number, vol: number, when = 0, dur = 1.6, bus: AudioNode = this.sfxBus) {
    for (const [r, v, d] of [[1, 1, 1], [2.76, 0.4, 0.6], [5.4, 0.18, 0.35], [8.9, 0.08, 0.2]]) this.tone(freq * r, dur * d, 'sine', vol * v, when, bus, 0, 0.4);
  }

  // ---------------------------------------------------------------- sfx
  click() { if (!this.ctx) return; this.tone(880, 0.06, 'triangle', 0.12); }
  select() { if (!this.ctx || !this.throttle('sel', 60)) return; this.tone(520 + Math.random() * 60, 0.08, 'triangle', 0.1); }
  ack(kind: 'move' | 'attack' | 'gather' | 'build' | 'error' | 'nuke') {
    if (!this.ctx || !this.throttle('ack', 80)) return;
    if (kind === 'move') { this.tone(400, 0.09, 'triangle', 0.1); this.tone(500, 0.1, 'triangle', 0.08, 0.06); }
    else if (kind === 'attack') { this.tone(300, 0.14, 'sawtooth', 0.09, 0, this.sfxBus, 0.7); this.tone(450, 0.1, 'square', 0.05, 0.05); }
    else if (kind === 'gather') { this.tone(620, 0.07, 'sine', 0.1); this.tone(780, 0.1, 'sine', 0.08, 0.06); }
    else if (kind === 'build') { this.noise(0.09, 0.2, 2200, 600, 'bandpass'); this.tone(240, 0.12, 'square', 0.06, 0.02); }
    else if (kind === 'error') { this.tone(160, 0.22, 'sawtooth', 0.12, 0, this.sfxBus, 0.7); }
    else this.tone(200, 0.4, 'sawtooth', 0.14, 0, this.sfxBus, 2.2);
  }
  hit(big: boolean) { if (!this.ctx || !this.throttle(big ? 'hitb' : 'hit', 70)) return; this.noise(big ? 0.22 : 0.1, big ? 0.35 : 0.2, big ? 1200 : 3000, 200); if (big) this.tone(90, 0.2, 'sine', 0.25, 0, this.sfxBus, 0.5); }
  arrow() { if (!this.ctx || !this.throttle('arr', 90)) return; this.noise(0.22, 0.12, 900, 4200, 'bandpass', 0, this.sfxBus, 2); }
  cannon() { if (!this.ctx || !this.throttle('can', 120)) return; this.noise(0.5, 0.5, 900, 80); this.tone(90, 0.4, 'sine', 0.45, 0, this.sfxBus, 0.3); }
  die() { if (!this.ctx || !this.throttle('die', 100)) return; this.tone(260, 0.3, 'triangle', 0.1, 0, this.sfxBus, 0.5); }
  collapse() { if (!this.ctx) return; this.noise(1.8, 0.7, 700, 50); this.tone(60, 1.4, 'sine', 0.5, 0, this.sfxBus, 0.4); }
  built() { if (!this.ctx) return; [0, 2, 4].forEach((n, i) => this.bell(440 * Math.pow(2, n * 240 / 1200), 0.14, i * 0.12, 1.1)); }
  trained() { if (!this.ctx || !this.throttle('trn', 150)) return; this.bell(660, 0.1, 0, 0.8); }
  deposit() { if (!this.ctx || !this.throttle('dep', 200)) return; this.tone(980, 0.07, 'sine', 0.06); }
  epoch(tribe: string) {
    if (!this.ctx) return;
    const sc = tribe === 'jawa' ? [0, 240, 480, 720, 960] : [0, 120, 270, 540, 670];
    [0, 1, 2, 3, 4, 3, 4, 2].forEach((n, i) => this.bell(330 * Math.pow(2, sc[n % 5] / 1200) * (n >= 5 ? 2 : 1), 0.2, i * 0.18, 2));
    this.bell(165, 0.3, 0, 3.2);
  }
  heal() { if (!this.ctx) return; [0, 4, 7, 12].forEach((n, i) => this.tone(520 * Math.pow(2, n / 12), 0.4, 'sine', 0.09, i * 0.07, this.sfxBus, 1, 1)); }
  laugh() { if (!this.ctx) return; for (let i = 0; i < 6; i++) this.tone(320 + (i % 2) * 90, 0.12, 'square', 0.05, i * 0.1); }
  nukeArm() { if (!this.ctx) return; this.tone(110, 1.2, 'sawtooth', 0.2, 0, this.sfxBus, 3); }
  startSiren() {
    if (!this.ctx || this.sirenNode) return;
    const ctx = this.ctx; const o = ctx.createOscillator(); o.type = 'sawtooth';
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.55; const lg = ctx.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(o.frequency); o.frequency.value = 620;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
    const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.11, ctx.currentTime + 0.6);
    o.connect(f); f.connect(g); g.connect(this.sfxBus); g.connect(this.reverb);
    o.start(); lfo.start();
    this.sirenNode = { stop: () => { g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6); o.stop(ctx.currentTime + 0.7); lfo.stop(ctx.currentTime + 0.7); this.sirenNode = null; } };
  }
  stopSiren() { this.sirenNode?.stop(); }
  nukeLaunch() { if (!this.ctx) return; this.noise(4.6, 0.6, 200, 2600, 'lowpass'); this.tone(70, 4.5, 'sawtooth', 0.2, 0, this.sfxBus, 3.5); }
  nukeBoom(near: number) {
    if (!this.ctx) return;
    const v = 0.35 + 0.65 * near;
    this.noise(0.25, 0.9 * v, 8000, 600, 'lowpass');            // crack
    this.tone(48, 4.0, 'sine', 0.9 * v, 0, this.sfxBus, 0.35);   // sub
    this.tone(95, 2.6, 'sine', 0.5 * v, 0.02, this.sfxBus, 0.3);
    this.noise(5.0, 0.8 * v, 900, 40, 'lowpass', 0.1);           // rumble
    this.noise(3.0, 0.35 * v, 5000, 300, 'highpass', 0.4);       // debris hiss
  }

  // ---------------------------------------------------------------- music
  startMusic(tribe: string) {
    if (!this.ctx) return; this.musicTribe = tribe; this.step = 0;
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = window.setInterval(() => this.musicStep(), 520);
  }
  stopMusic() { if (this.musicTimer) clearInterval(this.musicTimer); this.musicTimer = 0; }
  private musicStep() {
    if (!this.ctx || !this.musicOn || this.muted) return;
    const jawa = this.musicTribe === 'jawa';
    const cents = jawa ? [0, 240, 480, 720, 960] : [0, 120, 270, 540, 670, 785];
    const base = jawa ? 261.6 : 293.7;
    const note = (deg: number, oct = 0) => base * Math.pow(2, (cents[((deg % cents.length) + cents.length) % cents.length] + 1200 * (oct + Math.floor(deg / cents.length))) / 1200);
    const s = this.step++;
    const bus = this.musicBus;
    if (s % 8 === 0) this.bell(note(0, -1) / 2, 0.55, 0, 4, bus);                           // gong
    if (s % 4 === 2) this.bell(note(2, -1), 0.28, 0, 2.2, bus);                              // kenong
    const phrase = jawa ? [2, 3, 2, 1, 0, 1, 2, 4] : [0, 2, 3, 2, 4, 3, 2, 1];
    if (s % 2 === 0) this.bell(note(phrase[(s / 2) % 8], 0), 0.2, 0, 1.4, bus);             // saron
    if (Math.random() < 0.45) this.bell(note(phrase[Math.floor(Math.random() * 8)], 1), 0.1, 0.25, 1.0, bus);   // bonang
    if (!jawa && s % 4 === 0) { this.tone(note(2, 1), 0.18, 'triangle', 0.05, 0, bus, 1, 1); this.tone(note(4, 1), 0.18, 'triangle', 0.05, 0.13, bus, 1, 1); }   // angklung-ish shimmer
    if (s % 16 === 0) this.tone(note(0, -2), 8, 'sine', 0.07, 0, bus);                       // drone
  }
}
