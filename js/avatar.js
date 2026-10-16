// Realtime avatar: GLB laden, idle/praat-animaties, blik naar de cursor, knipperen,
// lipsync op gezichtsbotten (kaak, lippen, liphoeken, oogleden) en sprekende gebaren.
import * as THREE from 'three';
import { FaceAnimator } from './faceanim.js?v=1';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = V(), _v2 = V(), _m = new THREE.Matrix4();
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
// kritisch-gedempte veer (licht onderdempt): natuurlijke aanzet en uitloop, geen sinusbeweging
class Veer {
  constructor(k = 55, z = 0.78) { this.k = k; this.c = 2 * Math.sqrt(k) * z; this.x = 0; this.v = 0; this.doel = 0; }
  step(dt) { const n = Math.ceil(dt / 0.008), h = dt / n; for (let i = 0; i < n; i++) { this.v += (this.k * (this.doel - this.x) - this.c * this.v) * h; this.x += this.v * h; } return this.x; }
}
const GEBAAR = {   // per arm: schouder vooruit (uF), opzij (uA), elleboog (eF), handpalm omhoog (sup), pols (wE)
  rust:     { R: {}, L: { uA: 0.09 } },     // linkerarm vrij van de gasmeter
  uitleg:   { R: { uF: 0.28, uA: 0.18, uR: 0.9, eF: 1.1, sup: 1.0, wE: -0.15, fo: 0.65 }, L: { eF: 0.22, uR: 0.15 } },
  beide:    { R: { uF: 0.22, uA: 0.14, uR: 0.55, eF: 1.05, sup: 0.85, wE: -0.1, fo: 0.6 }, L: { uF: 0.2, uA: 0.13, uR: 0.55, eF: 1.0, sup: 0.85, wE: -0.1, fo: 0.6 } },
  links:    { R: { eF: 0.25, uR: 0.15 }, L: { uF: 0.26, uA: 0.16, uR: 0.9, eF: 1.08, sup: 0.95, wE: -0.12, fo: 0.65 } },
  zelf:     { R: { uF: 0.3, uA: -0.02, uR: 0.0, eF: 1.5, sup: 0.2, fo: 0.35 }, L: {} },
  klaar:    { R: { eF: 0.32, uF: 0.06, uR: 0.2, fo: 0.2 }, L: { eF: 0.28, uF: 0.05, uR: 0.2, fo: 0.2 } },
  zwaai:    { R: { uF: 0.2, uA: 0.55, uR: 0.2, eF: 0.9, sup: 0.3, wE: 0.1, fo: 1 }, L: { eF: 0.12 } },   // de hand zelf gaat via IK
};

// Maakt een animatielus naadloos: elk spoor wordt herbemonsterd op één raster (30 fps, periode P),
// ontbrekende begin-/eindsleutels worden periodiek aangevuld, en eind = begin. Optioneel een glijdend
// gemiddelde (w beelden aan elke kant, met wrap) tegen schokken.
function naadloos(clip, w0 = 0, wKop = 0, fps = 30) {
  const lang = clip.tracks.filter(t => t.times.length > 3);
  if (!lang.length) return;
  const T0 = Math.min(...lang.map(t => t.times[0])), T1 = Math.max(...lang.map(t => t.times[t.times.length - 1]));
  const N = Math.round((T1 - T0) * fps), P = N / fps;            // N intervallen; beeld N = beeld 0
  clip.tracks = clip.tracks.map(tr => {
    const s = tr.getValueSize(), quat = s === 4 && /quaternion/.test(tr.name);
    const w = wKop && /^(head|neck_0[12])\./.test(tr.name) ? wKop : w0;
    const it = tr.createInterpolant(), a0 = tr.times[0], a1 = tr.times[tr.times.length - 1];
    const times = new Float32Array(N + 1), vals = new Float32Array((N + 1) * s);
    for (let i = 0; i <= N; i++) {
      let t = T0 + i / fps;
      if (t < a0 - 1e-4 && t + P <= a1 + 1e-4) t += P;           // spoor mist het begin: neem het overeenkomstige eindbeeld
      if (t > a1 + 1e-4 && t - P >= a0 - 1e-4) t -= P;           // spoor mist het einde: neem het begin
      const r = it.evaluate(Math.min(a1, Math.max(a0, t)));
      times[i] = i / fps; for (let c = 0; c < s; c++) vals[i * s + c] = r[c];
    }
    if (quat) for (let i = 1; i <= N; i++) {                     // continue tekens
      let d = 0; for (let c = 0; c < 4; c++) d += vals[i * 4 + c] * vals[(i - 1) * 4 + c];
      if (d < 0) for (let c = 0; c < 4; c++) vals[i * 4 + c] *= -1;
    }
    if (w > 0 && N > 2 * w) {
      const src = vals.slice();
      for (let i = 0; i < N; i++) {
        const acc = new Float64Array(s); let tot = 0;
        for (let j = -w; j <= w; j++) {
          const k = ((i + j) % N + N) % N, wt = 1 - Math.abs(j) / (w + 1);
          let sg = 1; if (quat) { let d = 0; for (let c = 0; c < 4; c++) d += src[k * 4 + c] * src[i * 4 + c]; sg = d < 0 ? -1 : 1; }
          for (let c = 0; c < s; c++) acc[c] += src[k * s + c] * sg * wt; tot += wt;
        }
        let len = 1; if (quat) { len = 0; for (let c = 0; c < 4; c++) len += acc[c] * acc[c]; len = Math.sqrt(len) || 1; }
        for (let c = 0; c < s; c++) vals[i * s + c] = quat ? acc[c] / len : acc[c] / tot;
      }
    }
    // restverschil tussen eind en begin uitsmeren, eind = begin
    let sg = 1; if (quat) { let d = 0; for (let c = 0; c < 4; c++) d += vals[N * 4 + c] * vals[c]; sg = d < 0 ? -1 : 1; }
    const delta = []; for (let c = 0; c < s; c++) delta.push(vals[c] * sg - vals[N * s + c]);
    for (let i = 1; i <= N; i++) {
      const f = i / N; for (let c = 0; c < s; c++) vals[i * s + c] += delta[c] * f;
      if (quat) { let len = 0; for (let c = 0; c < 4; c++) len += vals[i * 4 + c] ** 2; len = Math.sqrt(len); for (let c = 0; c < 4; c++) vals[i * 4 + c] /= len; }
    }
    const T = tr.constructor; return new T(tr.name, times, vals);
  });
  clip.duration = P;
}

export class Avatar {
  constructor() {
    this.root = new THREE.Group();
    this.mouth = { open: 0, smile: 0.62, round: 0, wide: 0, press: 0, ff: 0 };   // doelwaarden (0..1)
    this._m = { open: 0, smile: 0.5, round: 0, wide: 0, press: 0, ff: 0 };      // gedempte waarden
    this.arm = {}; for (const z of ['R', 'L']) for (const k of ['uF', 'uA', 'uR', 'eF', 'sup', 'wE', 'fo']) this.arm[z + k] = new Veer(48, 0.8);
    this.intro = null;   // { fase, t } — binnenwandelen, omdraaien, zwaaien
    this.ik = { R: { doel: null, w: new Veer(30, 0.95) }, L: { doel: null, w: new Veer(30, 0.95) } };   // hand naar een punt
    this.knik = new Veer(90, 0.55); this.kanteling = new Veer(20, 0.9); this.leun = new Veer(12, 1);
    this._gebaar = 'rust'; this._gebaarTot = 0; this._vorig = '';
    this.look = V(0, 1.55, 3);          // wereldpunt waar ze naar kijkt
    this.speaking = 0;                  // 0..1, gedempt
    this.energy = 0;                    // stemenergie voor knikjes/gebaren
    this.blink = 0; this._nextBlink = 1.5;
    this.t = 0;
    this.hotspots = {};
  }

  async load(url, onProgress) {
    const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
      .loadAsync(url, e => onProgress && e.total && onProgress(e.loaded / e.total));
    this.gltf = g;
    const scene = g.scene;
    const arm = scene.getObjectByName('Aellia');
    if (arm) arm.scale.setScalar(0.01);                         // armatuur staat in cm
    scene.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false; o.castShadow = true;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) this._material(o, m);
    });
    for (const [mesh, mat] of this._zacht || []) {        // zachte haarrand: zelfde skelet, getekend na de harde pas
      const z = mesh.clone(); z.material = mat; z.renderOrder = 3; z.castShadow = false; mesh.parent.add(z);
    }
    this.root.add(scene);
    this.B = n => scene.getObjectByName(n);
    const need = ['head', 'neck_01', 'neck_02', 'spine_05', 'FACIAL_C_Jaw', 'FACIAL_C_MouthLower', 'FACIAL_C_MouthUpper',
      'FACIAL_C_LowerLipRotation', 'FACIAL_L_LipCorner', 'FACIAL_R_LipCorner', 'FACIAL_L_Eye', 'FACIAL_R_Eye',
      'FACIAL_L_EyelidUpperA', 'FACIAL_L_EyelidUpperB', 'FACIAL_R_EyelidUpperA', 'FACIAL_R_EyelidUpperB',
      'FACIAL_L_EyelidLowerA', 'FACIAL_R_EyelidLowerA', 'FACIAL_C_LipUpper', 'FACIAL_C_LipLower',
      'FACIAL_L_CheekOuter', 'FACIAL_R_CheekOuter', 'FACIAL_L_CheekInner', 'FACIAL_R_CheekInner',
      'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l', 'spine_03'];
    this.bones = {};
    for (const n of need) this.bones[n] = this.B(n);
    this.groep = { corner: [], cheek: [] };
    scene.traverse(o => {
      if (!o.isBone) return;
      const side = /_L_/.test(o.name) ? 1 : /_R_/.test(o.name) ? -1 : 0; if (!side) return;
      if (/12IPV_LipCorner/.test(o.name)) { this.groep.corner.push([o, side]); this.bones[o.name] = o; }
      if (/Cheek(Outer|Inner)\d?$|12IPV_Cheek/.test(o.name)) { this.groep.cheek.push([o, side]); this.bones[o.name] = o; }
      const fm = /^FACIAL_[LR]_Forehead(In|Mid|Out)$/.exec(o.name);
      if (fm) { (this.groep.brow = this.groep.brow || []).push([o, side, fm[1]]); this.bones[o.name] = o; }
      if (/^FACIAL_[LR]_NasolabialBulge$/.test(o.name)) { (this.groep.naso = this.groep.naso || []).push([o, side]); this.bones[o.name] = o; }
      if (/^FACIAL_[LR]_EyelidLowerB$/.test(o.name)) this.bones[o.name] = o;
    });
    // animaties: wortel-objecttracks eruit (schaal 0,0001 van de FBX-import)
    for (const a of g.animations) a.tracks = a.tracks.filter(t => !t.name.startsWith('Aellia.'));
    // lussen naadloos maken en schokken eruit filteren (de MetaHuman-idle heeft o.a. een hoofdruk van >100°/s)
    for (const a of g.animations) naadloos(a, /fmn_b_idle/.test(a.name) ? 6 : /Stand_Idle|happy/.test(a.name) ? 4 : 0, /fmn_b_idle/.test(a.name) ? 40 : 0);   // idle: hoofd/nek alleen nog traag drijven
    this.mixer = new THREE.AnimationMixer(scene);
    const clip = k => g.animations.find(a => a.name.includes(k));
    this.actions = {};
    for (const [k, n] of [['idle', 'fmn_b_idle'], ['stand', 'Stand_Idle'], ['talk', 'happy_m'], ['walk', 'Walk_Loop']]) {
      const c = clip(n); if (!c) continue;
      const a = this.mixer.clipAction(c); a.enabled = true; a.setEffectiveWeight(0); a.play(); this.actions[k] = a;
    }
    this.weights = { idle: 1, stand: 0, talk: 0, walk: 0 }; if (this._mode) this.weights = { idle: 0, stand: 0, talk: 0, walk: 0, [this._mode]: 1 };
    this._w = { ...this.weights };
    this.mixer.update(0); scene.updateMatrixWorld(true);
    this._headRest = this.bones.head.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.vingers = { r: [], l: [] };
    scene.traverse(o => { const m = o.isBone && /^(thumb|index|middle|ring|pinky)_0[123]_(r|l)$/.exec(o.name); if (m) this.vingers[m[2]].push([o, o.quaternion.clone()]); });
    this._rest = {};
    for (const [n, b] of Object.entries(this.bones)) if (b) this._rest[n] = { p: b.position.clone(), q: b.quaternion.clone() };
    this.face = new FaceAnimator(scene);          // MetaHuman Animator-gezicht voor vooraf opgenomen zinnen
    scene.traverse(o => { if (o.isSkinnedMesh && o.material && o.material.name === 'Coverall') this._banden(o); });
    return this;
  }

  // reflecterende banden per pixel op de bindpose (strak, geen naden/scherven van de gebakken textuur)
  _banden(mesh) {
    // rustvorm uitrekenen: skelet in bindpose, posities via skinning (de positiedata is gekwantiseerd)
    const sk = mesh.skeleton;
    const bwW = nm => sk.bones.find(x => x.name === nm).getWorldPosition(V());
    const echteCm = bwW('spine_04').distanceTo(bwW('neck_01')) * 100;          // in de normale pose gemeten
    const bewaar = sk.bones.map(b => [b, b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
    sk.pose(); this.gltf.scene.updateMatrixWorld(true);
    const inv = mesh.matrixWorld.clone().invert(), n = mesh.geometry.attributes.position.count, rest = new Float32Array(n * 3), v = V();
    for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v); rest[i * 3] = v.x; rest[i * 3 + 1] = v.y; rest[i * 3 + 2] = v.z; }
    mesh.geometry.setAttribute('aRest', new THREE.BufferAttribute(rest, 3));
    const bw = nm => { const b = sk.bones.find(x => x.name === nm); return b ? b.getWorldPosition(V()).applyMatrix4(inv) : null; };
    const s4 = bw('spine_04'), nk = bw('neck_01'), ua = bw('upperarm_l'), ur = bw('upperarm_r'), pl = bw('pelvis');
    if (!s4 || !nk || !ua) { for (const [b, p, q, sc] of bewaar) { b.position.copy(p); b.quaternion.copy(q); b.scale.copy(sc); } return; }
    const ledemaat = (a, b) => { const h = bw(a), t = bw(b); return { h, ax: t.clone().sub(h) }; };
    const L = [ledemaat('lowerarm_l', 'hand_l'), ledemaat('lowerarm_r', 'hand_r'), ledemaat('calf_l', 'foot_l'), ledemaat('calf_r', 'foot_r')];
    const cmL = s4.distanceTo(nk) / echteCm;   // lokale eenheden per cm
    for (const [b, p, q, sc] of bewaar) { b.position.copy(p); b.quaternion.copy(q); b.scale.copy(sc); }   // pose terug
    this.gltf.scene.updateMatrixWorld(true);
    const up = nk.clone().sub(pl).normalize(), side = ua.clone().sub(ur).normalize();
    const H = p => p.dot(up), X = p => p.clone().sub(s4).dot(side);
    const U = {};
    U.uCm = { value: cmL }; U.uUp = { value: up }; U.uSide = { value: side }; U.uS4 = { value: s4 };
    U.uChest = { value: H(s4) + 9.5 * cmL }; U.uNeck = { value: H(nk) }; U.uShX = { value: Math.abs(X(ua)) * 0.8 };
    U.uLimbH = { value: L.map(l => l.h) }; U.uLimbA = { value: L.map(l => l.ax) };
    U.uTape = { value: new THREE.Color(0.40, 0.40, 0.415) }; U.uStof = { value: new THREE.Color(0.034, 0.031, 0.0717) };   // gemeten gemiddelde stofkleur
    const m = mesh.material;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRest; varying vec3 vRest;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRest; uniform float uChest, uNeck, uShX, uCm; uniform vec3 uUp, uSide, uS4; uniform vec3 uLimbH[4]; uniform vec3 uLimbA[4]; uniform vec3 uTape, uStof;
float bandF(float d, float h) { return clamp((h - abs(d)) / (0.35 * uCm) + 0.5, 0.0, 1.0); }
float lum3(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float oudBand = 0.0, nieuwBand = 0.0;
{
  vec3 P = vRest; float hy = dot(P, uUp), hx = dot(P - uS4, uSide);
  float refl = bandF(hy - uChest, 2.5 * uCm);
  refl = max(refl, bandF(abs(hx) - uShX, 1.25 * uCm) * step(uChest - 0.5 * uCm, hy) * step(hy, uNeck - 4.0 * uCm));
  for (int i = 0; i < 4; i++) {
    vec3 ax = uLimbA[i]; float Ln = length(ax); vec3 rel = P - uLimbH[i];
    float t = dot(rel, ax) / (Ln * Ln); float rad = length(rel - t * ax);
    float c = i < 2 ? 0.58 : 0.56; float rmax = (i < 2 ? 11.0 : 15.0) * uCm;
    refl = max(refl, bandF(t * Ln - c * Ln, 2.5 * uCm) * step(rad, rmax));
  }
  vec3 tc = sampledDiffuseColor.rgb;
  float sat = max(tc.r, max(tc.g, tc.b)) - min(tc.r, min(tc.g, tc.b));
  vec2 tx = 6.0 / vec2(textureSize(map, 0));
  float buur = (lum3(texture2D(map, vMapUv + vec2(tx.x, 0.0)).rgb) + lum3(texture2D(map, vMapUv - vec2(tx.x, 0.0)).rgb)
              + lum3(texture2D(map, vMapUv + vec2(0.0, tx.y)).rgb) + lum3(texture2D(map, vMapUv - vec2(0.0, tx.y)).rgb)) * 0.25;
  vec3 col = tc;
  if (lum3(tc) > 0.12 && sat < 0.12 && buur > 0.1) oudBand = 1.0;
  nieuwBand = refl;
  if (oudBand > 0.5) col = uStof * (0.9 + 0.2 * fract(sin(dot(floor(vMapUv * 2048.0), vec2(12.9898, 78.233))) * 43758.5453));   // oude, gebakken band weg
  col = mix(col, uTape, refl);
  diffuseColor.rgb = diffuse * col;
}`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.93, oudBand * (1.0 - nieuwBand));   // oude band: weer stof (geen glans)
roughnessFactor = mix(roughnessFactor, 0.6, nieuwBand);`);
    };
    m.needsUpdate = true;
  }

  _material(mesh, m) {
    const n = (m.name || '') + ' ' + mesh.name;
    if (/Lens/i.test(n)) {
      mesh.material = new THREE.MeshPhysicalMaterial({ color: 0xeef4f6, roughness: 0.04, metalness: 0, transmission: 0, transparent: true,
        opacity: 0.16, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6, side: THREE.DoubleSide });
      mesh.renderOrder = 5; return;
    }
    if (/Skin/i.test(n)) { m.roughness = 0.46; m.envMapIntensity = 0.45; if (m.normalScale) m.normalScale.set(0.9, 0.9); }
    if (/Coverall|Collar/i.test(n)) { m.envMapIntensity = 0.35; m.roughness = 0.95; m.color?.setRGB(0.86, 0.86, 0.9); }
    if (/Boots|Sole|Lace/i.test(n)) { m.envMapIntensity = 0.6; }
    if (/LogoPrint/.test(n)) { m.transparent = false; m.depthWrite = true; m.alphaTest = 0.45; m.roughness = 0.75; m.envMapIntensity = 0.3; m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -16; mesh.castShadow = false; }
    if (/BootScanSole/.test(n)) { m.roughness = 0.85; m.envMapIntensity = 0.4; }
    if (/BootScan/.test(n)) { m.roughness = 0.5; m.envMapIntensity = 0.75; if (m.map) m.map.anisotropy = 8; }
    if (/Gloves|Cup|Headband|Strap|Harness|Frame|Detector|DetRubber/i.test(n)) { m.envMapIntensity = 0.55; }
    if (/Eye/i.test(n)) { m.roughness = 0.06; m.envMapIntensity = 1.2; }
    if (/Helmet/i.test(n)) { m.roughness = 0.32; m.envMapIntensity = 1.0; }
    if (/Lashes/i.test(n)) { m.color?.set(0x1a1410); m.transparent = true; m.opacity = 0.62; m.depthWrite = false; mesh.renderOrder = 2; }   // wimpers: zachter, geen zwarte vlekken
    if (/^(Hair|Brows)/.test(m.name || '')) {            // haarkaarten: harde uitsnede + zachte rand in een tweede pas
      m.transparent = false; m.alphaTest = 0.4; m.side = THREE.DoubleSide; m.depthWrite = true;
      m.roughness = 0.52; m.metalness = 0; m.envMapIntensity = 0.5; m.color?.setRGB(1, 1, 1);
      const zacht = m.clone(); zacht.alphaTest = 0.04; zacht.transparent = true; zacht.depthWrite = false; zacht.opacity = 0.85;
      this._zacht = this._zacht || []; this._zacht.push([mesh, zacht]);
    }
    if (m.map) m.map.anisotropy = 4;
  }

  setMode(mode) {                     // 'idle' | 'talk' | 'walk' | 'stand'
    this._mode = mode; if (!this.weights) return;
    for (const k in this.weights) this.weights[k] = 0;
    this.weights[mode] = 1;
  }

  _headDelta() {                      // rotatie van het hoofd t.o.v. rust (wereld)
    const h = this.bones.head; h.getWorldQuaternion(_q);
    return _q.multiply(this._headRest);
  }

  // draai een bot rond een wereldpivot met een wereld-as (na de mixer, voor de render)
  _rotAbout(bone, pivot, axis, ang) {
    if (!bone || !ang) return;
    const R = _q2.setFromAxisAngle(axis, ang);
    bone.getWorldPosition(_v); _v.sub(pivot).applyQuaternion(R).add(pivot);
    bone.parent.updateWorldMatrix(true, false);
    _m.copy(bone.parent.matrixWorld).invert(); const lp = _v.clone().applyMatrix4(_m);
    bone.position.copy(lp);
    bone.getWorldQuaternion(_q); _q.premultiply(R);
    bone.parent.getWorldQuaternion(_q2).invert(); bone.quaternion.copy(_q2.multiply(_q));
    bone.updateMatrixWorld(true);
  }
  _moveWorld(bone, off) {
    if (!bone) return;
    bone.getWorldPosition(_v).add(off);
    bone.parent.updateWorldMatrix(true, false);
    bone.position.copy(_v.applyMatrix4(_m.copy(bone.parent.matrixWorld).invert()));
    bone.updateMatrixWorld(true);
  }

  update(dt) {
    if (!this.mixer) return;
    this.t += dt;
    if (this.intro) this._introStap(dt);
    // animatiegewichten
    for (const k in this.actions) {
      this._w[k] = damp(this._w[k], this.weights[k], 2.2, dt);
      this.actions[k].setEffectiveWeight(this._w[k]);
    }
    // procedureel bewerkte lichaamsbotten eerst terug naar de animatiepose van vorig beeld:
    // schrijft de mixer een bot een beeld niet opnieuw, dan stapelt onze bewerking zich anders op (= verspringen)
    if (this._anim) for (const [b, q, p] of this._anim) { b.quaternion.copy(q); b.position.copy(p); }
    this.mixer.update(dt);
    if (!this._anim) {
      const L = ['neck_01', 'neck_02', 'head', 'spine_03', 'spine_05', 'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l']
        .map(n => this.bones[n] || this.gltf.scene.getObjectByName(n)).filter(Boolean);
      for (const z of ['r', 'l']) for (const [b] of this.vingers[z]) L.push(b);
      this._anim = L.map(b => [b, b.quaternion.clone(), b.position.clone()]);
    } else for (const e of this._anim) { e[1].copy(e[0].quaternion); e[2].copy(e[0].position); }
    // gezichtsbotten terug naar rust (mixer animeert ze niet)
    for (const [n, r] of Object.entries(this._rest)) {
      if (!n.startsWith('FACIAL_')) continue;
      const b = this.bones[n]; if (b) { b.position.copy(r.p); b.quaternion.copy(r.q); }
    }
    const mha = this.faceClip && this.face ? this.faceClip : null;
    if (mha) this.face.apply(mha, this.faceT || 0);
    else if (this._mhaWas) this.face.release();
    this._mhaWas = !!mha;
    const scene = this.gltf.scene; scene.updateMatrixWorld(true);
    const B = this.bones;
    const hq = this._headDelta();
    const right = V(1, 0, 0).applyQuaternion(hq), up = V(0, 1, 0).applyQuaternion(hq), fwd = V(0, 0, 1).applyQuaternion(hq);
    // ---- blik: nek/hoofd + ogen naar het doel ----
    const headPos = B.head.getWorldPosition(V());
    const dir = this.look.clone().sub(headPos).normalize();
    const dl = dir.clone().applyAxisAngle(V(0, 1, 0), -this.root.rotation.y);     // t.o.v. haar lichaam: geen klap als het doel achter haar ligt
    const yaw = THREE.MathUtils.clamp(Math.atan2(dl.x, Math.max(dl.z, 0.35)), -0.55, 0.55);
    const pitch = THREE.MathUtils.clamp(Math.asin(-dir.y), -0.3, 0.35);
    const hd = mha ? mha.headAt(this.faceT || 0) : null, D = Math.PI / 180;    // hoofdcurves uit MHA, gedempt bijgemengd
    this._yaw = damp(this._yaw || 0, yaw + (hd ? hd.yaw * D * 0.45 : 0), 4, dt); this._pitch = damp(this._pitch || 0, pitch + (hd ? -hd.pitch * D * 0.45 : 0), 4, dt);
    const nod = this.knik.step(dt), tilt = this.kanteling.step(dt) + (hd ? hd.roll * D * 0.4 : 0);
    for (const [bn, k] of [['neck_02', 0.4], ['head', 0.6]]) {
      const b = B[bn]; if (!b) continue;
      const qy = _q2.setFromAxisAngle(V(0, 1, 0), this._yaw * k);
      b.getWorldQuaternion(_q); _q.premultiply(qy);
      const qx = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0).applyQuaternion(_q2.setFromAxisAngle(V(0, 1, 0), this._yaw * k)), (this._pitch + nod) * k);
      _q.premultiply(qx);
      _q.premultiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), tilt * k));
      b.parent.getWorldQuaternion(_q2).invert(); b.quaternion.copy(_q2.multiply(_q)); b.updateMatrixWorld(true);
    }
    const hq2 = this._headDelta();
    right.set(1, 0, 0).applyQuaternion(hq2); up.set(0, 1, 0).applyQuaternion(hq2); fwd.set(0, 0, 1).applyQuaternion(hq2);
    for (const e of ['FACIAL_L_Eye', 'FACIAL_R_Eye']) {
      const b = B[e]; if (!b) continue;
      const ep = b.getWorldPosition(V()); const d = this.look.clone().sub(ep).normalize();
      const ly = d.dot(right), lp = d.dot(up);
      this._rotAbout(b, ep, up, THREE.MathUtils.clamp(Math.asin(ly) * 0.6, -0.35, 0.35));
      this._rotAbout(b, ep, right, THREE.MathUtils.clamp(-Math.asin(lp) * 0.5, -0.25, 0.25));
    }
    if (!mha) {   // procedurele oogleden, wenkbrauwen en mond (alleen als er geen MHA-gezicht speelt)
    // ---- knipperen ----
    this._nextBlink -= dt;
    if (this._nextBlink <= 0) { this._blinkT = 0; this._nextBlink = 2.2 + Math.random() * 3.6; }
    if (this._blinkT !== undefined) {
      this._blinkT += dt; const x = this._blinkT / 0.16;
      this.blink = x < 1 ? Math.sin(Math.min(1, x) * Math.PI) : 0; if (x >= 1) this._blinkT = undefined;
    }
    for (const s of ['L', 'R']) {
      const eye = B[`FACIAL_${s}_Eye`]; if (!eye) continue;
      const piv = eye.getWorldPosition(V());
      for (const n of [`FACIAL_${s}_EyelidUpperA`, `FACIAL_${s}_EyelidUpperB`]) this._rotAbout(B[n], piv, right, this.blink * 0.55);
      const sq = -this.blink * 0.08 - 0.075 * (this._m.smile || 0);          // lachende ogen: onderlid iets omhoog
      this._rotAbout(B[`FACIAL_${s}_EyelidLowerA`], piv, right, sq);
      this._rotAbout(B[`FACIAL_${s}_EyelidLowerB`], piv, right, sq * 0.8);
      for (const n of [`FACIAL_${s}_EyelidUpperA`, `FACIAL_${s}_EyelidUpperB`]) this._rotAbout(B[n], piv, right, -0.035);  // ogen iets opener
    }
    // ---- wenkbrauwen: zacht open (geïnteresseerd), korte lift op klemtonen ----
    this._browKick = damp(this._browKick || 0, 0, 3.2, dt);
    const brow = 0.55 + 0.25 * this.speaking + this._browKick;
    for (const [b, sx, deel] of this.groep.brow || []) {
      const k = deel === 'In' ? 1 : deel === 'Mid' ? 0.85 : 0.55;
      this._moveWorld(b, up.clone().multiplyScalar(0.0026 * brow * k).add(fwd.clone().multiplyScalar(0.0004 * brow * k)));
    }
    // ---- mond ----
    const M = this._m, T = this.mouth;
    M.open = damp(M.open, T.open, 26, dt); M.round = damp(M.round, T.round, 18, dt);
    M.wide = damp(M.wide, T.wide, 18, dt); M.smile = damp(M.smile, T.smile, 5, dt);
    const SM = Math.min(2.1, M.smile * (this.lach ?? 3.1));              // glimlach-sterkte (botverplaatsing)
    M.press = damp(M.press, T.press || 0, 34, dt); M.ff = damp(M.ff, T.ff || 0, 30, dt);
    const jaw = B.FACIAL_C_Jaw;
    if (jaw) {
      const piv = jaw.getWorldPosition(V());
      const ang = M.open * 0.30 - M.press * 0.03;
      for (const n of ['FACIAL_C_Jaw', 'FACIAL_C_MouthLower', 'FACIAL_C_LowerLipRotation']) this._rotAbout(B[n], piv, right, ang);
      for (const [n, sx] of [['FACIAL_L_LipCorner', 1], ['FACIAL_R_LipCorner', -1]]) {
        const b = B[n]; if (!b) continue;
        this._rotAbout(b, piv, right, ang * 0.45);
        const off = right.clone().multiplyScalar(sx * (0.0036 * SM + 0.0035 * M.wide - 0.0045 * M.round))
          .add(up.clone().multiplyScalar(0.0062 * SM - 0.0006 * M.round))
          .add(fwd.clone().multiplyScalar(-0.0022 * SM + 0.0032 * M.round));
        this._moveWorld(b, off);
      }
      for (const [b, sx] of this.groep.cheek)
        this._moveWorld(b, up.clone().multiplyScalar(0.0024 * SM).add(right.clone().multiplyScalar(sx * 0.0010 * SM)));
      for (const [b, sx] of this.groep.naso || [])
        this._moveWorld(b, up.clone().multiplyScalar(0.0016 * SM).add(right.clone().multiplyScalar(sx * 0.0012 * SM)).add(fwd.clone().multiplyScalar(0.0008 * SM)));
      for (const [b, sx] of this.groep.corner)
        this._moveWorld(b, right.clone().multiplyScalar(sx * (0.0030 * SM - 0.0038 * M.round)).add(up.clone().multiplyScalar(0.0052 * SM)));
      // bovenlip: iets op bij brede klanken, omlaag bij p/b/m; onderlip: op bij p/b/m, omhoog-achter tegen de tanden bij f/v
      this._moveWorld(B.FACIAL_C_LipUpper, up.clone().multiplyScalar(0.0012 * M.wide + 0.0008 * M.open - 0.0012 * M.press).add(fwd.clone().multiplyScalar(0.0024 * M.round)));
      this._moveWorld(B.FACIAL_C_LipLower, up.clone().multiplyScalar(0.0022 * M.press + 0.0032 * M.ff).add(fwd.clone().multiplyScalar(0.0024 * M.round - 0.0030 * M.ff)));
    }
    }
    // ---- lichaamstaal: veren naar een gebaar per zin, klemtonen geven een beat ----
    this.speaking = damp(this.speaking, this._speakTarget || 0, 2.5, dt);
    if (!this.intro && !this._speakTarget && this._gebaar !== 'rust' && this.t > this._gebaarTot && !this.ik.R.doel && !this.ik.L.doel) this._zet('rust');
    if (this._speakTarget && this.t > this._gebaarTot && this._gebaar !== 'klaar') this._zet('klaar');
    for (const k in this.arm) this.arm[k].step(dt);
    this.leun.doel = 0.035 * this.speaking; const leun = this.leun.step(dt);
    const BX = V(1, 0, 0), BY = V(0, 1, 0), BZ = V(0, 0, 1);
    this._rotLocalWorld(B.spine_03, BX, leun);
    for (const z of ['R', 'L']) {
      const sg = z === 'R' ? -1 : 1, lo = z.toLowerCase();
      const ua = B['upperarm_' + lo], la = B['lowerarm_' + lo], ha = B['hand_' + lo]; if (!ua || !la) continue;
      const A = k => this.arm[z + k].x;
      this._rotLocalWorld(ua, BX, -A('uF'));                 // schouder vooruit
      this._rotLocalWorld(ua, BZ, sg * A('uA'));             // arm iets opzij
      const ud = la.getWorldPosition(V()).sub(ua.getWorldPosition(V())).normalize();
      this._rotLocalWorld(ua, ud, -sg * A('uR'));            // bovenarm naar buiten draaien: onderarm wijst naar voren-buiten
      const sh = ua.getWorldPosition(V()), el = la.getWorldPosition(V()), wr = ha.getWorldPosition(V());
      const hinge = V().crossVectors(el.clone().sub(sh).normalize(), BZ).normalize();
      if (hinge.lengthSq() > 0.5) this._rotLocalWorld(la, hinge, A('eF'));   // elleboog buigt de onderarm naar voren/omhoog
      const fa = ha.getWorldPosition(V()).sub(la.getWorldPosition(V())).normalize();
      this._rotLocalWorld(la, fa, -sg * A('sup') * 0.6);      // onderarm draait: handpalm omhoog
      this._rotLocalWorld(ha, fa, -sg * A('sup') * 0.4);
      const h2 = V().crossVectors(fa, BY).normalize(); if (h2.lengthSq() > 0.5) this._rotLocalWorld(ha, h2, A('wE'));
      const fo = Math.min(1, Math.max(0, A('fo')));                 // vingers ontspannen open
      if (fo > 0.01) for (const [b, q0] of this.vingers[lo]) b.quaternion.slerp(q0, fo);
    }
    for (const z of ['R', 'L']) {
      const I = this.ik[z], w = I.w.step(dt);
      if (w > 0.01 && I.doel) {
        let d = typeof I.doel === 'function' ? I.doel() : I.doel, richt = null;
        if (d && d.tip) {                           // aanraken: vingertoppen op het punt, pols een handlengte ervoor
          this.ik[z].pole = d.pole || null; this.ik[z].palm = d.palm || null;
          richt = d.a.clone().normalize();
          d = d.tip.clone().addScaledVector(richt, -(d.hand ?? 0.15));
          if (I.start) {                            // boog naar buiten-voren, nooit dwars door het lichaam
            const k = Math.min(1, (this.t - I.t0) / 0.95), e = k * k * (3 - 2 * k);
            const r = this.root.rotation.y, uit = V(z === 'R' ? -1 : 1, 0, 0).applyAxisAngle(V(0, 1, 0), r);
            const voor = V(0, 0, 1).applyAxisAngle(V(0, 1, 0), r);
            const c = I.start.clone().lerp(d, 0.5).addScaledVector(uit, 0.16).addScaledVector(voor, 0.2);
            const a1 = I.start.clone().lerp(c, e), a2 = c.clone().lerp(d, e); d = a1.lerp(a2, e);
          }
        }
        if (richt) this._reikVrij(z, d, Math.min(1, w), richt);    // aanraken: nooit in helm, hoofd, oorkap of romp
        else this._reik(z, d, Math.min(1, w), richt);
      }
    }
  }
  // botsingsvormen (wereld): ellipsoïden rond helm, hoofd, oorkappen, nek en romp
  _vormen() {
    const g = this.gltf.scene, P = n => g.getObjectByName(n).getWorldPosition(V()), hq = this._headDelta().clone();
    const r = this.root.rotation.y, rotQ = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), r);
    const H = (x, y, z) => P('head').add(V(x, y, z).applyQuaternion(hq));
    const nk = P('neck_01'), lijf = q => V(...q).applyQuaternion(rotQ);
    return [
      { c: H(0, 0.152, -0.008), r: V(0.146, 0.086, 0.16), q: hq, naam: 'helm' },
      { c: P('pelvis').add(lijf([0.211, 0.06, 0.033])), r: V(0.03, 0.085, 0.042), q: rotQ, naam: 'gasmeter' },
      { c: H(0, 0.06, 0.02), r: V(0.085, 0.115, 0.11), q: hq, naam: 'hoofd' },
      { c: nk.clone().add(lijf([-0.1, 0.0, 0.065])), r: V(0.045, 0.05, 0.05), q: rotQ, naam: 'oorkap R' },
      { c: nk.clone().add(lijf([0.1, 0.0, 0.065])), r: V(0.045, 0.05, 0.05), q: rotQ, naam: 'oorkap L' },
      { c: nk.clone().add(lijf([0, -0.02, 0.0])), r: V(0.065, 0.08, 0.07), q: rotQ, naam: 'nek' },
      { c: P('spine_04').add(lijf([0, 0.04, 0.0])), r: V(0.16, 0.22, 0.12), q: rotQ, naam: 'romp' },
    ];
  }
  // hoe diep zit punt p in vorm v (null = erbuiten), plus de duwrichting naar buiten
  _diepte(v, p) {
    const iq = v.q.clone().invert(), l = p.clone().sub(v.c).applyQuaternion(iq);
    const k = V(l.x / v.r.x, l.y / v.r.y, l.z / v.r.z).length();
    if (k >= 1) return null;
    const uit = V(l.x / (v.r.x * v.r.x), l.y / (v.r.y * v.r.y), l.z / (v.r.z * v.r.z)).applyQuaternion(v.q).normalize();
    return { d: (1 - k) * Math.min(v.r.x, v.r.y, v.r.z) + 0.006, uit };
  }
  _handPunten(lo) {
    const g = this.gltf.scene, out = [this.bones['hand_' + lo]];
    for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) for (const k of ['01', '02', '03']) { const b = g.getObjectByName(`${f}_${k}_${lo}`); if (b) out.push(b); }
    out.push(this.bones['lowerarm_' + lo]);
    return out;
  }
  // IK met botsingsvrije correctie: pols naar buiten schuiven tot geen kootje meer in een vorm zit
  _reikVrij(z, d, w, richt) {
    const lo = z.toLowerCase(), vormen = this._vormen(), T = d.clone();
    const L = ['upperarm_' + lo, 'lowerarm_' + lo, 'hand_' + lo].map(n => this.bones[n]);
    const bewaar = L.map(b => b.quaternion.clone()), vingers = this.vingers[lo].map(([b]) => b.quaternion.clone());
    let worst = 0, wie = '';
    for (let it = 0; it < 7; it++) {
      L.forEach((b, i) => b.quaternion.copy(bewaar[i])); this.vingers[lo].forEach(([b], i) => b.quaternion.copy(vingers[i]));
      L[0].updateMatrixWorld(true);
      this._reik(z, T, w, richt);
      const duw = V(); let n = 0; worst = 0; wie = '';
      for (const b of this._handPunten(lo)) {
        const p = b.getWorldPosition(V());
        for (const v of vormen) { const h = this._diepte(v, p); if (h) { duw.addScaledVector(h.uit, h.d); n++; if (h.d > worst) { worst = h.d; wie = v.naam + ' / ' + b.name; } } }
      }
      if (!n) break;
      T.addScaledVector(duw.normalize(), Math.min(0.05, worst + 0.004));
    }
    // vloeiend: het gecorrigeerde doel glijdt (geen sprongen van beeld tot beeld)
    const I = this.ik[z];
    if (I.vrijT && I.vrijT.distanceTo(T) < 0.25) {
      I.vrijT.lerp(T, 0.18);
      L.forEach((b, i) => b.quaternion.copy(bewaar[i])); this.vingers[lo].forEach(([b], i) => b.quaternion.copy(vingers[i]));
      L[0].updateMatrixWorld(true); this._reik(z, I.vrijT, w, richt);
    } else I.vrijT = T.clone();
    this._laatsteDiepte = { d: worst, wie };
  }
  // two-bone IK: schouder-elleboog-pols naar doel (wereld), elleboog naar onder-buiten-achter
  _reik(z, T, w, richt = null) {
    if (!T) return;
    const lo = z.toLowerCase(), ua = this.bones['upperarm_' + lo], la = this.bones['lowerarm_' + lo], ha = this.bones['hand_' + lo];
    const S = ua.getWorldPosition(V()), E = la.getWorldPosition(V()), W = ha.getWorldPosition(V());
    const a = E.distanceTo(S), b = W.distanceTo(E), ST = T.clone().sub(S);
    const dMin = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(THREE.MathUtils.degToRad(35)));   // elleboog buigt hoogstens 145° (menselijke limiet)
    const d = Math.min(Math.max(ST.length(), dMin), a + b - 1e-3);
    const dir = ST.normalize();
    const pole = (this.ik[z].pole ? this.ik[z].pole.clone().applyAxisAngle(V(0, 1, 0), this.root.rotation.y) : V(z === 'R' ? -0.35 : 0.35, -1, -0.45)).normalize(); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const ca = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d))), sa = Math.sqrt(1 - ca * ca);
    const E2 = S.clone().add(dir.clone().multiplyScalar(a * ca)).add(pole.clone().multiplyScalar(a * sa));
    const q1 = new THREE.Quaternion().setFromUnitVectors(E.clone().sub(S).normalize(), E2.clone().sub(S).normalize());
    if (w < 1) q1.slerp(new THREE.Quaternion(), 1 - w);
    ua.getWorldQuaternion(_q); _q.premultiply(q1); ua.parent.getWorldQuaternion(_q2).invert(); ua.quaternion.copy(_q2.multiply(_q)); ua.updateMatrixWorld(true);
    const E3 = la.getWorldPosition(V()), W3 = ha.getWorldPosition(V());
    const T2 = S.clone().add(dir.clone().multiplyScalar(d));
    const q2 = new THREE.Quaternion().setFromUnitVectors(W3.clone().sub(E3).normalize(), T2.clone().sub(E3).normalize());
    if (w < 1) q2.slerp(new THREE.Quaternion(), 1 - w);
    la.getWorldQuaternion(_q); _q.premultiply(q2); la.parent.getWorldQuaternion(_q2).invert(); la.quaternion.copy(_q2.multiply(_q)); la.updateMatrixWorld(true);
    if (richt) {                                   // hand (pols -> middelvinger) in de aanraakrichting draaien
      const mid = this.gltf.scene.getObjectByName('middle_01_' + lo);
      if (mid) {
        const hp = ha.getWorldPosition(V()), f = mid.getWorldPosition(V()).sub(hp).normalize();
        const q3 = new THREE.Quaternion().setFromUnitVectors(f, richt);
        const pa = 2 * Math.acos(Math.min(1, Math.abs(q3.w))), pmax = THREE.MathUtils.degToRad(55);   // pols hoogstens 55° buigen
        q3.slerp(new THREE.Quaternion(), 1 - 0.85 * w * (pa > pmax ? pmax / pa : 1));
        ha.getWorldQuaternion(_q); _q.premultiply(q3); ha.parent.getWorldQuaternion(_q2).invert(); ha.quaternion.copy(_q2.multiply(_q)); ha.updateMatrixWorld(true);
        // handpalm naar het object draaien (rol rond de vingerrichting)
        const palm = this.ik[z].palm, g = this.gltf.scene, i1 = g.getObjectByName('index_01_' + lo), p1 = g.getObjectByName('pinky_01_' + lo);
        if (palm && i1 && p1) {
          const h0 = ha.getWorldPosition(V()), as = mid.getWorldPosition(V()).sub(h0).normalize();
          const pn = V().crossVectors(i1.getWorldPosition(V()).sub(h0), p1.getWorldPosition(V()).sub(h0)).normalize().multiplyScalar(lo === 'r' ? 1 : -1);
          const a1 = pn.clone().sub(as.clone().multiplyScalar(pn.dot(as))).normalize(), want = palm.clone().normalize();
          const a2 = want.sub(as.clone().multiplyScalar(want.dot(as))).normalize();
          let ang = Math.acos(THREE.MathUtils.clamp(a1.dot(a2), -1, 1)); if (V().crossVectors(a1, a2).dot(as) < 0) ang = -ang;
          ang = THREE.MathUtils.clamp(ang, -THREE.MathUtils.degToRad(70), THREE.MathUtils.degToRad(70));   // pro-/supinatie binnen menselijke grenzen
          const q4 = new THREE.Quaternion().setFromAxisAngle(as, ang * 0.9 * w);
          ha.getWorldQuaternion(_q); _q.premultiply(q4); ha.parent.getWorldQuaternion(_q2).invert(); ha.quaternion.copy(_q2.multiply(_q)); ha.updateMatrixWorld(true);
        }
      }
    }
    for (const [bb, q0] of this.vingers[lo]) bb.quaternion.slerp(q0, 0.5 * w);
  }
  // hand naar iets brengen (fn of Vector3), duur in s; null = loslaten
  reik(z, doel, duur = 0) {
    const I = this.ik[z]; I.doel = doel; I.w.doel = doel ? 1 : 0;
    I.t0 = this.t; I.start = doel ? this.bones['hand_' + z.toLowerCase()].getWorldPosition(V()) : null;
    if (!doel && I.pole && !this.intro) I.pole = null;
    I.vrijT = null;
    clearTimeout(I.t); if (doel && duur) I.t = setTimeout(() => { I.w.doel = 0; }, duur * 1000);
  }
  // punt op het lichaam (wereld) voor aanraakacties
  // aanraakpunt (wereld): tip = waar de vingertoppen komen, a = richting pols -> vingers
  punt(naam) {
    const g = this.gltf.scene, P = n => g.getObjectByName(n).getWorldPosition(V()), hq = this._headDelta();
    const H = (x, y, zz) => P('head').add(V(x, y, zz).applyQuaternion(hq)), Hd = (x, y, zz) => V(x, y, zz).applyQuaternion(hq);
    const r = this.root.rotation.y, rot = v => v.applyAxisAngle(V(0, 1, 0), r);
    switch (naam) {
      case 'helmet': return { tip: H(-0.14, 0.118, 0.02), a: Hd(0.45, 0.85, 0.1), hand: 0.12, pole: V(-0.6, -1, 0.35), palm: Hd(1, 0, 0) };   // vingertoppen op de schaal boven de rand, palm naar de helm      // vingers aan de buitenrand, hand naast het oor
      case 'glasses': return { tip: H(-0.084, 0.046, 0.05), a: Hd(0.15, 0.85, -0.45), hand: 0.12, pole: V(-0.35, -1, 0.45) };   // bril rechtzetten: elleboog laag, vingers bij het scharnier   // pootje achter de slaap, hand naast het gezicht
      case 'ears': return { tip: P('neck_01').add(rot(V(-0.135, 0.035, 0.06))), a: rot(V(0.5, 0.85, 0.1)), hand: 0.14, pole: V(-0.7, -1, 0.2), palm: rot(V(1, 0, 0)) };   // hand plat tegen de buitenkant van de kap   // buitenkant oorkap
      case 'coverall': return { tip: P('spine_04').add(rot(V(-0.05, 0.07, 0.17))), a: rot(V(0.45, 1, 0.05)), hand: 0.16 };  // hand plat op de borst
      case 'logo': return { tip: P('spine_05').add(rot(V(0.035, -0.06, 0.18))), a: rot(V(1, 0.2, -0.2)), hand: 0.16 };      // wijst naar het logo op de borstzak
      case 'monitor': return { tip: P('pelvis').add(rot(V(0.215, 0.07, 0.075))), a: rot(V(-0.05, -1, -0.35)), hand: 0.13, pole: V(0.9, -0.4, -0.7), palm: rot(V(-0.3, 0, -1)) };   // hand op de meter, arm iets opgeheven  // tikt bovenop de meter
    }
    return null;
  }
  startIntro(opts = {}) {
    this.intro = { fase: 'loop', t: 0, zwaai: opts.zwaai !== false, handen: !!opts.handen }; this._zwaai = 0;
    this.vouw(false);
    this.root.position.x = opts.x ?? 2.8; this.root.rotation.y = -Math.PI / 2;
    this.setMode('walk'); for (const k in this.actions) { this._w[k] = this.weights[k]; this.actions[k].setEffectiveWeight(this._w[k]); }
    if (this.actions.walk) this.actions.walk.time = 0;
  }
  _introStap(dt) {
    const I = this.intro; I.t += dt;
    if (I.fase === 'loop') {                      // ~1,15 m/s naar haar plek
      // snelheid = wat de stapcyclus doet (anders schuiven de zolen): animatie loopt ~2,08 m/s, wij 1,3 m/s
      const x = this.root.position.x, rem = Math.min(1, x / 0.7), v = 1.3 * (0.35 + 0.65 * rem);
      this.root.position.x = Math.max(0, x - v * dt);
      if (this.actions.walk) this.actions.walk.timeScale = v / 2.08;
      if (this.root.position.x <= 0.01) { I.fase = 'draai'; I.t = 0; this.setMode('idle'); if (this.actions.walk) this.actions.walk.timeScale = 1; }
    } else if (I.fase === 'draai') {              // in 0,7 s naar de camera draaien
      const k = Math.min(1, I.t / 0.7), e = k * k * (3 - 2 * k);
      this.root.rotation.y = -Math.PI / 2 * (1 - e);
      if (k >= 1 && !I.zwaai) { I.fase = 'klaar'; I.t = 2.0; if (I.handen) this.vouw(true); }
      else if (k >= 1) {
        I.fase = 'zwaai'; I.t = 0; this._zet('zwaai'); this.mouth.smile = 0.85;
        this.ik.R.pole = V(-1, -0.7, -0.15);       // elleboog omlaag-opzij
        this.reik('R', () => this._zwaaiDoel());
      }
    } else if (I.fase === 'zwaai') {              // kort, casual: twee, drie slagen
      this._zwaai = Math.min(1, I.t / 0.35) * Math.max(0, Math.min(1, (1.75 - I.t) / 0.35));
      if (I.t > 1.6 && this.ik.R.doel) this.ik.R.w.doel = 0;           // hand laten zakken
      if (I.t > 1.9) { I.fase = 'klaar'; this._zet('rust'); this._zwaai = 0; this.ik.R.doel = null; this.ik.R.pole = null; }
    } else if (I.fase === 'klaar') { if (I.t > 2.6) { this.intro = null; this.mouth.smile = 0.62; } }
  }
  // handpositie tijdens het zwaaien: naast het hoofd, onderarm zwiept vanuit de elleboog
  _zwaaiDoel() {
    const S = this.bones.upperarm_r.getWorldPosition(V()), r = this.root.rotation.y;
    const sw = Math.sin(this.t * 2 * Math.PI * 1.9) * this._zwaai;
    return S.add(V(-0.20 - 0.065 * sw, 0.27 - 0.02 * Math.abs(sw), 0.13).applyAxisAngle(V(0, 1, 0), r));
  }
  get inIntro() { return !!this.intro; }
  // handen voor zich gevouwen (rechter over linker), botsingsvrij via de aanraak-IK
  vouw(aan) {
    if (!aan) { if (this._gevouwen) { this.reik('R', null); this.reik('L', null); } this._gevouwen = false; return; }
    this._gevouwen = true;
    const g = () => this.gltf.scene, P = n => g().getObjectByName(n).getWorldPosition(V()), rot = v => v.applyAxisAngle(V(0, 1, 0), this.root.rotation.y);
    this.reik('L', () => ({ tip: P('pelvis').add(rot(V(-0.045, 0.035, 0.165))), a: rot(V(-1, -0.25, 0.05)), hand: 0.15, pole: V(0.6, -1, -0.25), palm: rot(V(0, 0.3, -1)) }));
    this.reik('R', () => ({ tip: P('pelvis').add(rot(V(0.06, 0.05, 0.19))), a: rot(V(1, -0.2, 0.05)), hand: 0.15, pole: V(-0.6, -1, -0.25), palm: rot(V(0, 0.2, -1)) }));
  }
  _zet(naam, schaal = 1) {
    this._gebaar = naam; const G = GEBAAR[naam];
    for (const z of ['R', 'L']) for (const k of ['uF', 'uA', 'uR', 'eF', 'sup', 'wE', 'fo']) this.arm[z + k].doel = ((G[z] || {})[k] || 0) * (k === 'fo' ? 1 : schaal);
  }
  // nieuwe zin: kies een gebaar (nooit twee keer hetzelfde na elkaar), houd het tot net voor het einde
  onPhrase(duur) {
    const opties = ['uitleg', 'beide', 'links', 'uitleg', 'beide'].filter(g => g !== this._vorig);
    let g = duur < 1.4 ? 'klaar' : opties[Math.floor(Math.random() * opties.length)];
    if (this._forceGebaar) { g = this._forceGebaar; this._forceGebaar = null; }
    this._vorig = g; this._zet(g, 0.85 + Math.random() * 0.25);
    this._gebaarTot = this.t + Math.max(0.6, duur - 0.35);
    this.kanteling.doel = (Math.random() - 0.5) * 0.09;
  }
  // beklemtoonde lettergreep: korte neerwaartse slag van de actieve hand + knikje
  onBeat() {
    const G = GEBAAR[this._gebaar] || {};
    for (const z of ['R', 'L']) if ((G[z] || {}).eF > 0.5) { this.arm[z + 'eF'].v -= 2.0; this.arm[z + 'wE'].v += 1.4; }
    this.knik.v += 0.75 + Math.random() * 0.4;
    if (Math.random() < 0.55) this._browKick = Math.min(0.9, (this._browKick || 0) + 0.55);
  }
  _rotLocalWorld(bone, axis, ang) {
    if (!bone || !ang) return;
    bone.getWorldQuaternion(_q); _q.premultiply(_q2.setFromAxisAngle(axis, ang));
    bone.parent.getWorldQuaternion(_q2).invert(); bone.quaternion.copy(_q2.multiply(_q)); bone.updateMatrixWorld(true);
  }

  // wereldposities voor hotspots (in meters)
  anchor(name) {
    const B = this.bones, g = this.gltf.scene; if (!g) return null;
    const p = n => (g.getObjectByName(n) || B.head).getWorldPosition(V());
    const head = p('head'), hq = this._headDelta();
    const H = (x, y, z) => head.clone().add(V(x, y, z).applyQuaternion(hq));
    switch (name) {
      case 'helmet': return H(0, 0.17, 0.02);
      case 'glasses': return H(0.035, 0.065, 0.11);
      case 'ears': return p('neck_01').add(V(0.085, 0.01, 0.06));
      case 'logo': return p('spine_05').add(V(0.075, -0.1, 0.13));
      case 'coverall': return p('spine_03').add(V(-0.09, 0.06, 0.12));
      case 'monitor': return p('pelvis').add(V(0.19, 0.06, 0.04));
      case 'gloves': return p('hand_r').add(V(0, -0.04, 0.02));
      case 'boots': return p('ball_l').add(V(0.02, 0.03, 0.04));
    }
    return null;
  }
}
