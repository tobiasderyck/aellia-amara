// Gezichtsanimatie uit MetaHuman Animator (audio → animatie in Unreal 5.8, geëvalueerd door RigLogic)
// afspelen op de FACIAL_-botten van de web-avatar. Zelfstandige ES-module, geen three-import nodig.
//
// Data (pipeline/mha/build_face_json.py):
//   anim/face/basis.json  gedeelde PCA-basis over alle botkanalen (int16, base64)
//   anim/face/<lijn>.json fps, frames, K coëfficiënten per frame (int16, base64) + hoofdbeweging (graden)
// Per bot (GLB-lokaal, t.o.v. de rustpose): quaternion = rust * dq,  positie = rust + dp.
//
// Gebruik:
//   import { loadFaceClip, FaceAnimator } from './faceanim.js?v=1';
//   const face = new FaceAnimator(gltf.scene);          // meteen na het laden: legt de rustpose vast
//   const clip = await loadFaceClip('anim/face/intro.json');
//   // elk beeld, NA mixer.update() en vóór eigen procedurele gezichtsbewerkingen:
//   face.apply(clip, audio.currentTime);                // t in seconden sinds de start van de lijn
//   face.release();                                     // na de lijn: botten terug naar rust
//   clip.headAt(t)  -> { yaw, pitch, roll } in graden (MHA-hoofdcurves) of null; niet automatisch toegepast.

const _basisCache = new Map();

function b64ToInt16(s) {
  const bin = atob(s), n = bin.length >> 1, out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bin.charCodeAt(2 * i), hi = bin.charCodeAt(2 * i + 1);
    out[i] = (hi << 8) | lo;                              // little-endian, teken via Int16Array
  }
  return out;
}

async function loadBasis(url) {
  if (!_basisCache.has(url)) {
    _basisCache.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error(`faceanim: ${url} ${r.status}`);
      return r.json();
    }).then(j => {
      const K = j.K, raw = b64ToInt16(j.basis), C = raw.length / K, B = new Float32Array(raw.length);
      for (let k = 0; k < K; k++) {
        const s = j.basisScale[k];
        for (let c = 0; c < C; c++) B[k * C + c] = raw[k * C + c] * s;
      }
      return { K, C, B, mean: Float32Array.from(j.mean), bones: j.bones, q: j.q, p: j.p, qWeight: j.qWeight };
    }));
  }
  return _basisCache.get(url);
}

export class FaceClip {
  constructor(json, basis) {
    this.name = json.line; this.fps = json.fps; this.frames = json.frames; this.duration = json.duration;
    this.basis = basis; this.head = json.head || null;
    const K = json.K, raw = b64ToInt16(json.coef);
    this.coef = new Float32Array(raw.length);
    for (let f = 0; f < json.frames; f++) for (let k = 0; k < K; k++) this.coef[f * K + k] = raw[f * K + k] * json.coefScale[k];
    this._c = new Float32Array(K);
    this._ch = new Float32Array(basis.C);
  }

  // alle kanalen op tijd t (lineair tussen frames); geeft een gedeelde Float32Array terug
  channels(t) {
    const { K, C, B, mean } = this.basis, c = this._c, ch = this._ch;
    const u = Math.min(Math.max(t * this.fps, 0), this.frames - 1), f0 = Math.floor(u), f1 = Math.min(f0 + 1, this.frames - 1), a = u - f0;
    for (let k = 0; k < K; k++) c[k] = this.coef[f0 * K + k] * (1 - a) + this.coef[f1 * K + k] * a;
    ch.set(mean);
    for (let k = 0; k < K; k++) {
      const w = c[k]; if (w === 0) continue;
      const o = k * C;
      for (let j = 0; j < C; j++) ch[j] += w * B[o + j];
    }
    return ch;
  }

  // MHA-hoofdcurves (HeadYaw/Pitch/Roll, graden) — optioneel te mengen in de eigen hoofdsturing
  headAt(t) {
    if (!this.head || !this.head.yaw) return null;
    const u = Math.min(Math.max(t * this.fps, 0), this.frames - 1), f0 = Math.floor(u), f1 = Math.min(f0 + 1, this.frames - 1), a = u - f0;
    const L = arr => arr ? arr[f0] * (1 - a) + arr[f1] * a : 0;
    return { yaw: L(this.head.yaw), pitch: L(this.head.pitch), roll: L(this.head.roll) };
  }
}

export async function loadFaceClip(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`faceanim: ${url} ${r.status}`);
  const json = await r.json();
  const basis = await loadBasis(new URL(json.basis || 'basis.json', new URL(url, location.href)).href);
  return new FaceClip(json, basis);
}

export class FaceAnimator {
  // bron: Object3D (wordt doorlopen) of map { naam: Object3D }. Roep aan terwijl het gezicht in rust staat.
  // opts.exclude: RegExp voor botten die je zelf stuurt (bv. /Eyelid/ als avatar.js de knipper doet)
  constructor(source, opts = {}) {
    this.bones = new Map();
    const add = (n, o) => { if (n && n.startsWith('FACIAL_') && o && !this.bones.has(n)) this.bones.set(n, o); };
    if (source && typeof source.traverse === 'function') source.traverse(o => add(o.name, o));
    else for (const [n, o] of Object.entries(source || {})) add(n, o);
    this.rest = new Map();
    for (const [n, o] of this.bones) this.rest.set(n, { p: o.position.clone(), q: o.quaternion.clone() });
    this.exclude = opts.exclude || null;
    this.fadeIn = opts.fadeIn ?? 0.12;                    // s, zacht in/uit zodat de mond niet verspringt
    this.fadeOut = opts.fadeOut ?? 0.18;
    this._map = new WeakMap();                            // basis -> botlijsten
    this._dq = null;
  }

  _bind(basis) {
    let m = this._map.get(basis);
    if (m) return m;
    const ok = i => { const n = basis.bones[i]; return this.bones.has(n) && !(this.exclude && this.exclude.test(n)); };
    m = {
      q: basis.q.map((bi, j) => [bi, j]).filter(([bi]) => ok(bi)).map(([bi, j]) => [this.bones.get(basis.bones[bi]), this.rest.get(basis.bones[bi]), j * 3]),
      p: basis.p.map((bi, j) => [bi, j]).filter(([bi]) => ok(bi)).map(([bi, j]) => [this.bones.get(basis.bones[bi]), this.rest.get(basis.bones[bi]), basis.q.length * 3 + j * 3]),
    };
    this._map.set(basis, m);
    return m;
  }

  // zet de botten op tijd t van de clip; weight 0..1 mengt met de rustpose
  apply(clip, t, weight = 1) {
    if (!clip) return;
    const fade = Math.min(1, Math.max(0, t / this.fadeIn), Math.max(0, (clip.duration - t) / this.fadeOut));
    const w = Math.max(0, Math.min(1, weight)) * fade;
    if (w <= 0) { this.release(); return; }
    const ch = clip.channels(t), m = this._bind(clip.basis), iq = 1 / clip.basis.qWeight;
    if (!this._dq) { const any = this.rest.values().next().value; this._dq = any.q.clone(); }
    const dq = this._dq;
    for (const [b, r, o] of m.q) {
      const x = ch[o] * iq * w, y = ch[o + 1] * iq * w, z = ch[o + 2] * iq * w;
      dq.set(x, y, z, Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z))).normalize();
      b.quaternion.copy(r.q).multiply(dq);
    }
    for (const [b, r, o] of m.p) b.position.set(r.p.x + ch[o] * w, r.p.y + ch[o + 1] * w, r.p.z + ch[o + 2] * w);
  }

  // alle gezichtsbotten terug naar de vastgelegde rustpose
  release() {
    for (const [n, b] of this.bones) { const r = this.rest.get(n); b.position.copy(r.p); b.quaternion.copy(r.q); }
  }
}
