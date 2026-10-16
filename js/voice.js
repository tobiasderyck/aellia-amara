// Stem: speelt audio (intro, hotspots, live TTS) af en stuurt de mond met een foneem-tijdlijn (lipsync.js).
import { sample, stresses } from './lipsync.js?v=065003';
import { loadFaceClip } from './faceanim.js?v=1';
export class Voice {
  constructor(avatar) {
    this.av = avatar; this.ctx = null; this.queue = []; this.playing = false; this.level = 0;
    this.onstate = () => {};
  }
  _ensure() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.an = this.ctx.createAnalyser(); this.an.fftSize = 1024; this.an.smoothingTimeConstant = 0.2;
    this.gain = this.ctx.createGain(); this.gain.gain.value = new URLSearchParams(location.search).has('stil') ? 0 : 1;   // ?stil = testen zonder geluid
    this.an.connect(this.gain).connect(this.ctx.destination);
    this.td = new Float32Array(this.an.fftSize); this.fd = new Uint8Array(this.an.frequencyBinCount);
  }
  async unlock() { this._ensure(); if (this.ctx.state === 'suspended') await this.ctx.resume(); }
  stop() {
    this.queue = []; if (this.src) { try { this.src.stop(); } catch (e) {} } this.src = null; this.playing = false;
    this.av._speakTarget = 0; this.av.faceClip = null; this.onstate('idle');
  }
  async playUrl(url) {
    await this.unlock(); this.stop();
    // MetaHuman Animator-gezicht (Unreal, RigLogic) als die er is; anders de foneem-tijdlijn
    const naam = url.split('/').pop().replace(/\.mp3$/, '');
    const [buf, tl, face] = await Promise.all([fetch(url).then(r => r.arrayBuffer()),
      fetch(url.replace(/\.mp3$/, '.lip.json')).then(r => r.ok ? r.json() : null).catch(() => null),
      loadFaceClip(`anim/face/${naam}.json`).catch(() => null)]);
    const ab = await this.ctx.decodeAudioData(buf);
    this._enqueue(ab, true, tl, face);
  }
  pushPCM(pcm, sr, last, tl) {
    this._ensure();
    const ab = this.ctx.createBuffer(1, pcm.length, sr); ab.copyToChannel(pcm, 0);
    this._enqueue(ab, last, tl);
  }
  _enqueue(ab, last, tl, face = null) { this.queue.push({ ab, last, tl, face }); if (!this.playing) this._next(); }
  _next() {
    const item = this.queue.shift();
    if (!item) { this.playing = false; this.av._speakTarget = 0; this.av.faceClip = null; this.onstate(this._waiting ? 'thinking' : 'idle'); return; }
    this.playing = true; this.av._speakTarget = 1; this.onstate('speaking');
    const s = this.ctx.createBufferSource(); s.buffer = item.ab; s.connect(this.an);
    s.onended = () => { if (this.src === s) this._next(); };
    this.src = s; const t0 = this.ctx.currentTime + 0.02; s.start(t0);
    this.cur = { tl: item.tl, t0, beats: stresses(item.tl), bi: 0, dur: item.ab.duration };
    this.av.faceClip = item.face; this.av.faceT = 0;
    this.av.onPhrase && this.av.onPhrase(item.ab.duration);
  }
  // per frame: foneem-tijdlijn -> mond (met 40 ms anticipatie), klemtonen -> beat-gebaren
  update() {
    const av = this.av, T = av.mouth;
    if (!this.ctx || !this.playing || !this.cur) {
      T.open = 0; T.round = 0; T.wide = 0; T.press = 0; T.ff = 0; if (!av.inIntro) T.smile = 0.62; av.energy *= 0.92; this.level *= 0.9; return 0;
    }
    const t = this.ctx.currentTime - this.cur.t0;
    av.faceT = t;
    let m;
    if (this.cur.tl) m = sample(this.cur.tl, t + 0.04);
    else { // terugval: alleen luidheid
      this.an.getFloatTimeDomainData(this.td); let s = 0; for (let i = 0; i < this.td.length; i++) s += this.td[i] * this.td[i];
      const l = Math.min(1, Math.sqrt(s / this.td.length) * 7); m = { open: l * 0.7, round: 0, wide: 0.2 * l, press: 0, ff: 0, level: l };
    }
    T.open = m.open; T.round = m.round; T.wide = m.wide; T.press = m.press; T.ff = m.ff;
    T.smile = 0.42 + 0.16 * (1 - (m.level || 0));
    this.level = m.level || 0;
    av.energy = av.energy * 0.85 + this.level * 0.15;
    const c = this.cur;
    while (c.bi < c.beats.length && c.beats[c.bi] <= t + 0.06) { av.onBeat && av.onBeat(); c.bi++; }
    return this.level;
  }
}

// live TTS (Kokoro in een worker)
export class LiveTTS {
  constructor(voice) {
    this.voice = voice; this.ready = false; this.loading = false; this.id = 0;
    this.onprogress = () => {}; this.onready = () => {}; this.onerror = () => {};
  }
  _worker() {
    if (this.w) return this.w;
    this.w = new Worker(new URL('./tts-worker.js?v=065003', import.meta.url), { type: 'module' });
    const files = {};
    this.w.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') { files[m.file] = [m.loaded, m.total]; let a = 0, b = 0; for (const [l, t] of Object.values(files)) { a += l; b += t; } this.onprogress(a / b, b); }
      if (m.type === 'ready') { this.ready = true; this.loading = false; this.onready(m.device); }
      // eerst de volledige tekst genereren, dan in één doorlopende opname afspelen (geen start-stop tussen zinnen)
      if (m.type === 'chunk' && m.id === this.id) { this.voice._waiting = true; (this.buf ||= []).push(m); this.onchunk && this.onchunk(this.buf.length); }
      if (m.type === 'done' && m.id === this.id) {
        const delen = this.buf || []; this.buf = [];
        this.voice._waiting = false;
        if (!delen.length) { if (!this.voice.playing) this.voice.onstate('idle'); return; }
        const sr = delen[0].sr, pauze = Math.round(sr * 0.12);      // korte ademruimte tussen zinnen
        const n = delen.reduce((a, d) => a + d.pcm.length, 0) + pauze * (delen.length - 1), pcm = new Float32Array(n);
        const tl = { items: [], env: [], hop: delen[0].tl ? delen[0].tl.hop : 0.01, offset: 0 };
        let o = 0;
        delen.forEach((d, i) => {
          const t0 = o / sr; pcm.set(d.pcm, o);
          if (d.tl) {
            for (const it of d.tl.items) tl.items.push({ ...it, t0: +(it.t0 + t0).toFixed(3), t1: +(it.t1 + t0).toFixed(3) });
            const doel = Math.round(t0 / tl.hop); while (tl.env.length < doel) tl.env.push(0);
            tl.env.push(...d.tl.env);
          }
          o += d.pcm.length + (i < delen.length - 1 ? pauze : 0);
        });
        this.voice.pushPCM(pcm, sr, true, tl);
      }
      if (m.type === 'error') { this.loading = false; this.onerror(m.message); }
    };
    return this.w;
  }
  preload() { if (this.ready || this.loading) return; this.loading = true; this._worker().postMessage({ type: 'load' }); }
  async speak(text) {
    await this.voice.unlock(); this.voice.stop();
    this.id++; this.buf = []; this.voice._waiting = true; this.voice.onstate('thinking');
    this._worker().postMessage({ type: 'speak', text, id: this.id, voice: 'af_heart', speed: 0.96 });
  }
}
