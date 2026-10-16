import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Avatar } from './avatar.js?v=114010';
import { Voice, LiveTTS } from './voice.js?v=124511';

const Q = new URLSearchParams(location.search);
const RUST = Q.has('rust') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBIEL = () => innerWidth <= 760;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// ---------- renderer ----------
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(1.75, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;   // meer contrast en kleurdiepte dan AgX
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.42;
const camera = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, 0.05, 60);
const key = new THREE.DirectionalLight(0xfff0dd, 3.3); key.position.set(-2.2, 3.4, 3.2); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -1.2; key.shadow.camera.right = 1.2; key.shadow.camera.top = 2.2; key.shadow.camera.bottom = -0.2;
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4; scene.add(key);
const rim = new THREE.DirectionalLight(0xd8e2ff, 2.6); rim.position.set(2.6, 2.4, -2.4); scene.add(rim);
const fill = new THREE.DirectionalLight(0xf2f4ff, 0.32); fill.position.set(2.5, 1.2, 3); scene.add(fill);
// zachte contactschaduw (alleen schaduw, geen vloer)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.24 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

const avatar = new Avatar(); scene.add(avatar.root);
const voice = new Voice(avatar);
const live = new LiveTTS(voice);

// ---------- regie per sectie (camera-standen) ----------
const STANDEN = {
  hero:    { cx: -0.78, cy: 1.02, cz: 5.6, ly: 0.98, fov: 24 },
  kit:     { cx: -0.46, cy: 1.10, cz: 3.9, ly: 1.02, fov: 24 },
  talk:    { cx: -0.26, cy: 1.53, cz: 1.75, ly: 1.52, fov: 24 },   // medium shot tot de borst, zoals een avatar in een call
  formats: { cx: 0.82, cy: 1.02, cz: 5.6, ly: 0.98, fov: 24 },
  cast:    { cx: -1.32, cy: 1.05, cz: 6.4, ly: 0.98, fov: 24 },
  next:    { cx: -0.55, cy: 1.44, cz: 2.2, ly: 1.40, fov: 24 },
  app:     { cx: 0.0, cy: 1.50, cz: 2.0, ly: 1.47, fov: 30 },   // medium shot in het gsm-scherm (fov = schermhoogte)
};
const MOB = {   // mobiel: zij in de bovenste helft, tekst eronder
  hero: { cx: 0, cy: 0.85, cz: 7.2, ly: 0.18 }, kit: { cx: 0, cy: 0.95, cz: 5.6, ly: 0.55 }, talk: { cx: 0, cy: 1.48, cz: 2.6, ly: 1.24 },
  formats: { cx: 0, cy: 0.75, cz: 8.6, ly: 0.30 }, cast: { cx: 0, cy: 0.75, cz: 14, ly: -0.4 }, next: { cx: 0, cy: 1.48, cz: 2.6, ly: 1.24 }, app: { cx: 0, cy: 1.50, cz: 2.0, ly: 1.47 } };
// On site: camera op ooghoogte (1,5 m, horizontaal) zodat ze in de plaat staat; plaat 2400x1340
const SCENES = [
  { cam: { cx: -0.45, cy: 1.5, cz: 6.6, ly: 1.5, fov: 33 }, mob: { cx: -0.1, cz: 7.4 }, rotY: -0.38, poi: [0.148, 0.705], label: 'Tag 4127 · 2,340 ppm CH₄ · repair planned' },
  { cam: { cx: -0.4, cy: 1.5, cz: 6.8, ly: 1.5, fov: 33 }, mob: { cx: -0.1, cz: 7.6 }, rotY: -0.45, poi: [0.243, 0.43], label: 'Leak found · pressure relief valve · 2,340 ppm CH₄', ogi: true },
  { cam: { cx: -0.5, cy: 1.5, cz: 7.0, ly: 1.5, fov: 33 }, mob: { cx: -0.1, cz: 7.8 }, rotY: -0.25, poi: [0.372, 0.6], label: 'Valve station · within limits' },
];
let scene_i = -1;
// Kit-tour: de camera glijdt van totaalbeeld naar een close-up van elk onderdeel (scroll-gestuurd)
const KIT = ['helmet', 'glasses', 'ears', 'coverall', 'logo', 'monitor', 'gloves', 'boots'];
const KIT_D = { helmet: 2.6, glasses: 2.4, ears: 2.5, coverall: 3.0, logo: 2.4, monitor: 2.6, gloves: 2.7, boots: 2.6 };   // licht inzoomen, niet te dicht
const vol = st => ({ ...st, lx: st.lx ?? st.cx, lz: st.lz ?? 0, sx: st.sx ?? 0 });
let focusH = null, telK = 0;
function kitDetail(h) {
  const a = avatar.anchor(h); if (!a) return vol(STANDEN.kit);
  const zij = THREE.MathUtils.clamp(a.x * 3, -0.45, 0.45), op = h === 'boots' ? 0.45 : h === 'monitor' || h === 'gloves' ? 0.15 : 0.08;
  const dir = new THREE.Vector3(zij, op, 1).normalize(), c = a.clone().addScaledVector(dir, KIT_D[h]);
  return { cx: c.x, cy: c.y, cz: c.z, lx: a.x, ly: a.y, lz: a.z, fov: 24, sx: 0.16 };
}
const stand = { ...STANDEN.hero, lx: STANDEN.hero.cx, lz: 0, sx: 0 };
let doel = { ...STANDEN.hero }, actief = 'hero';
function kiesStand() {
  const secs = $$('[data-stage]'); const mid = innerHeight * 0.5;
  let best = null, bd = 1e9;
  for (const s of secs) { const r = s.getBoundingClientRect(); if (r.top <= mid && r.bottom >= mid) { best = s; break; } }   // sectie onder het midden (ook lange secties)
  if (!best) for (const s of secs) { const r = s.getBoundingClientRect(); const d = Math.abs((r.top + r.bottom) / 2 - mid); if (d < bd) { bd = d; best = s; } }
  // vloeiend tussen twee secties: alleen in de laatste/eerste halve schermhoogte van een sectie
  const r = best.getBoundingClientRect(); const i = secs.indexOf(best), H = innerHeight;
  const dT = mid - r.top, dB = r.bottom - mid;
  const prog = dB < 0.5 * H ? clamp((0.5 * H - dB) / H, 0, 0.5) : dT < 0.5 * H ? -clamp((0.5 * H - dT) / H, 0, 0.5) : 0;
  const nb = secs[clamp(i + (prog > 0 ? 1 : -1), 0, secs.length - 1)];
  const camVan = el => { if (el.dataset.stage === 'site') { const sc = SCENES[+el.dataset.scene]; return MOBIEL() ? { ...sc.cam, ...sc.mob } : sc.cam; }
    if (el.dataset.stage === 'kit' && !MOBIEL() && avatar.mixer && focusH) return kitDetail(focusH);   // aangeklikt onderdeel: camera zoomt (licht) in
    return vol(MOBIEL() ? { ...STANDEN[el.dataset.stage], ...MOB[el.dataset.stage] } : STANDEN[el.dataset.stage]); };
  const A = camVan(best), B = camVan(nb);
  let t = Math.max(0, Math.abs(prog) - 0.25) / 0.25 * 0.5;
  if (best.dataset.stage === 'site') t = 0;   // binnen een decor geen tussenstand (de plaat springt niet mee)
  doel = {}; for (const k in A) doel[k] = lerp(A[k], B[k] ?? A[k], t);
  if (actief !== best.dataset.stage) { actief = best.dataset.stage; opSectie(actief); }
  const si = best.dataset.stage === 'site' ? +best.dataset.scene : -1;
  if (si !== scene_i) { scene_i = si; opScene(si); }
}

// ---------- cursor + blik ----------
const cursor = $('.cursor'); const muis = { x: innerWidth * 0.3, y: innerHeight * 0.4, sx: innerWidth * 0.3, sy: innerHeight * 0.4 };
addEventListener('pointermove', e => { muis.x = e.clientX; muis.y = e.clientY; });
document.addEventListener('pointerover', e => { cursor.classList.toggle('is-actief', !!e.target.closest('a,button,textarea,li[data-h]')); });
let kijkNaar = null;           // vaste blik (hotspot) of null = cursor
function blikDoel() {
  if (kijkNaar) return kijkNaar.clone();
  const nd = new THREE.Vector3((muis.sx / innerWidth) * 2 - 1, -(muis.sy / innerHeight) * 2 + 1, 0.5).unproject(camera);
  const dir = nd.sub(camera.position).normalize();
  const t = (0.9 - camera.position.z) / dir.z;        // vlak net voor haar
  return camera.position.clone().add(dir.multiplyScalar(t));
}

// ---------- dot-veld (Aellia Waves) dat meebeweegt met haar stem ----------
const dc = $('#dots'), dx = dc.getContext('2d');
let DW, DH, dpr = Math.min(2, devicePixelRatio);
function maatDots() { DW = innerWidth; DH = innerHeight; dc.width = DW * dpr; dc.height = DH * dpr; dx.setTransform(dpr, 0, 0, dpr, 0, 0); }
maatDots();
const golven = [];   // rimpels vanuit haar mond
let mondScherm = { x: innerWidth * 0.7, y: innerHeight * 0.3 };
function tekenDots(t, lvl) {
  dx.clearRect(0, 0, DW, DH);
  const G = MOBIEL() ? 20 : 24, R0 = 1.05;
  const mx = muis.sx, my = muis.sy;
  for (let y = G * 0.5; y < DH; y += G) {
    for (let x = G * 0.5; x < DW; x += G) {
      // traag golvend veld, zoals de Waves in het Aellia-logo
      const w = Math.sin(x * 0.006 + t * 0.35) * Math.cos(y * 0.008 - t * 0.27) + Math.sin((x + y) * 0.004 + t * 0.2) * 0.6;
      let r = R0 + w * 0.42;
      let a = 0.10 + w * 0.045;
      let mint = 0;
      const dm = Math.hypot(x - mx, y - my);
      if (dm < 150) { const k = 1 - dm / 150; r += k * 1.2; mint = Math.max(mint, k * 0.9); }
      for (const g of golven) {
        const d = Math.hypot(x - g.x, y - g.y), front = (t - g.t) * 340;
        const k = Math.exp(-((d - front) ** 2) / 1600) * g.a * Math.max(0, 1 - (t - g.t) / 1.8);
        if (k > 0.01) { r += k * 1.6; a += k * 0.18; mint = Math.max(mint, k); }
      }
      if (r < 0.3) continue;
      dx.fillStyle = mint > 0.05 ? `rgba(0,${Math.round(150 + 94 * mint)},${Math.round(130 + 75 * mint)},${Math.min(0.9, a + mint * 0.6)})` : `rgba(4,1,144,${a})`;
      dx.beginPath(); dx.arc(x, y, r, 0, 6.2832); dx.fill();
    }
  }
}
let laatsteGolf = 0;
// stof dat in het licht zweeft: klein en scherp vooraan, groot en zacht (bokeh) achteraan
const STOF = Array.from({ length: 64 }, (_, i) => ({ x: Math.random(), y: Math.random(), z: Math.random(), f: Math.random() * 6.28, m: i % 9 === 0 }));
const licht = $('#licht'); let lichtK = 1, halo = { x: 0.68, y: 0.34, fy: 0.92 };
function tekenStof(t, dt) {
  if (lichtK < 0.02) return;
  for (const p of STOF) {
    p.y -= dt * (0.004 + 0.01 * p.z); p.x += dt * 0.003 * Math.sin(t * 0.3 + p.f);
    if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
    // dichter bij haar lichtbad = zichtbaarder
    const px = p.x * DW, py = p.y * DH;
    const d = Math.hypot(p.x - halo.x, (p.y - halo.y) * 0.7);
    const a = Math.max(0, 1 - d * 1.9) * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.8 + p.f))) * lichtK;
    if (a < 0.02) continue;
    const r = 1.1 + p.z * p.z * 7;
    const g = dx.createRadialGradient(px, py, 0, px, py, r);
    const c = p.m ? '0,210,180' : '176,150,108';
    g.addColorStop(0, `rgba(${c},${(0.85 * a * (1 - p.z * 0.55)).toFixed(3)})`); g.addColorStop(1, `rgba(${c},0)`);
    dx.fillStyle = g; dx.beginPath(); dx.arc(px, py, r, 0, 6.2832); dx.fill();
  }
}

// ---------- hotspots ----------
const HS = $('#hotspots'), label = $('#label');
const NAMEN = { helmet: 'Hard hat · chin strap fastened', glasses: 'Safety glasses', ears: 'Hearing protection', coverall: 'FR coverall · reflective tape',
  monitor: '4-gas monitor', gloves: 'Gloves', boots: 'Safety boots', logo: 'Aellia print' };
function speelHotspot(h) {
  $$('.hotspots button, .kitlijst li').forEach(b => b.classList.toggle('is-actief', b.dataset.h === h));
  const p = avatar.anchor(h); kijkNaar = p ? p.clone().lerp(camera.position, 0.65) : null;
  voice.playUrl(`audio/${h}.mp3`);
  // ze doet het voor: hand naar het onderdeel, of kijkt ernaar
  const HAND = { helmet: 'R', coverall: 'R', monitor: 'L' };   // bril en oorkappen: geen hand (onnatuurlijke armhouding), de camera toont ze
  focusH = h;
  avatar.reik('R', null); avatar.reik('L', null);
  if (HAND[h]) avatar.reik(HAND[h], () => avatar.punt(h), 4.2);
  if (h === 'gloves') avatar._forceGebaar = 'beide';
  if (h === 'boots') kijkNaar = avatar.anchor('boots');
  if (h === 'monitor') kijkNaar = avatar.punt(h).tip;                       // ze kijkt naar haar meter
  if (h === 'logo') kijkNaar = avatar.anchor('logo');
  clearTimeout(speelHotspot.t); speelHotspot.t = setTimeout(() => { kijkNaar = null; }, 2600);
}
$$('.hotspots button').forEach(b => {
  b.addEventListener('click', () => speelHotspot(b.dataset.h));
  b.addEventListener('pointerenter', () => { label.textContent = NAMEN[b.dataset.h]; label.classList.add('is-aan'); label.dataset.h = b.dataset.h; });
  b.addEventListener('pointerleave', () => label.classList.remove('is-aan'));
});
$$('.kitlijst li').forEach(li => li.addEventListener('click', () => speelHotspot(li.dataset.h)));
const _p = new THREE.Vector3();
function plaatsHotspots() {
  const aan = actief === 'kit'; HS.classList.toggle('is-aan', aan); if (!aan) { label.classList.remove('is-aan'); return; }
  for (const b of HS.children) {
    const p = avatar.anchor(b.dataset.h); if (!p) continue;
    _p.copy(p).project(camera);
    const x = (_p.x * 0.5 + 0.5) * innerWidth, y = (-_p.y * 0.5 + 0.5) * innerHeight;
    b.style.transform = `translate3d(${x}px,${y}px,0)`;
    if (label.dataset.h === b.dataset.h) label.style.transform = `translate3d(${x + 18}px,${y - 14}px,0)`;
  }
}

// ---------- intro + praten ----------
const introBtn = $('#intro-btn');
introBtn.addEventListener('click', async () => {
  if (voice.playing) { voice.stop(); return; }
  kijkNaar = null; await voice.playUrl('audio/intro.mp3');
});
voice.onstate = s => {
  introBtn.classList.toggle('is-spreekt', s === 'speaking');
  $('#say').disabled = s === 'thinking'; $('#hero-say').disabled = s === 'thinking';
  if (s === 'thinking') status('Finding her words… she speaks when the whole line is ready.');
  else if (live.ready) status('Ready. Type and press “Say it”.', true);
};
const statusEl = $('#status'), heroStatus = $('#hero-status');
function status(t, ok) { for (const el of [statusEl, heroStatus]) { if (!el) continue; el.textContent = t; el.classList.toggle('is-klaar', !!ok); } }
live.onprogress = (f, total) => status(`Loading her voice · ${Math.round(f * 100)}% of ${Math.round(total / 1e6)} MB`);
live.onready = dev => status(`Ready${dev === 'webgpu' ? ' · WebGPU' : ''}. Type and press “Say it”.`, true);
live.onerror = m => status('Her voice could not load here. Try Chrome or Edge on desktop.');
// vooraf opgenomen zinnen (stem + MetaHuman Animator-gezicht): spelen meteen, zonder het stemmodel te laden
const VOORAF = {
  'Welcome to Aellia Academy. Before you enter the unit, check your gas monitor and fasten your chin strap.': 'talk-welcome',
  'Hi Sharon. Shall we pick the route for the rest of the cast?': 'talk-sharon',
  'Every shift starts with a toolbox talk. Five minutes that align the team on hazards, permits and the plan for the day.': 'talk-toolbox',
  'Great work today. Your leak survey is complete, and every point is logged.': 'talk-welldone',
};
const norm = t => t.replace(/\s+/g, ' ').trim();
$('#zin').addEventListener('focus', () => live.preload());
$$('.chips button').forEach(c => c.addEventListener('click', () => { $('#zin').value = c.dataset.zin; }));
function zeg(t) {
  t = (t || '').trim(); if (!t) return;
  kijkNaar = null;
  const v = VOORAF[norm(t)]; if (v) { voice.playUrl(`audio/${v}.mp3`); return; }
  if (!live.ready) status('Loading her voice once (about 90 MB), then she says it…');
  live.speak(t);
}
$('#talk-form').addEventListener('submit', e => { e.preventDefault(); zeg($('#zin').value); });
$('#hero-zin').addEventListener('focus', () => live.preload());
$('#hero-zeg').addEventListener('submit', e => { e.preventDefault(); zeg($('#hero-zin').value); });

// ---------- decors ----------
const decor = $('#decor'), poi = $('#poi'), poiLabel = $('#poi-label'), ogi = $('#ogi'), pluimC = $('#pluim'), px2 = pluimC.getContext('2d');
let rotDoel = 0;
function plaatNaarScherm(u, v) {           // object-fit: cover, plaat 2400x1340
  const iw = 2400, ih = 1340, sc = Math.max(innerWidth / iw, innerHeight / ih);
  return { x: (innerWidth - iw * sc) / 2 + u * iw * sc, y: (innerHeight - ih * sc) / 2 + v * ih * sc };
}
function opScene(i) {
  decor.classList.toggle('is-aan', i >= 0);
  dc.style.opacity = i >= 0 ? '0' : '1';
  $$('.decor__plaat').forEach(p => p.classList.toggle('is-aan', +p.dataset.scene === i));
  rotDoel = i >= 0 ? SCENES[i].rotY : 0;
  floor.material.opacity = i >= 0 ? 0.32 : 0.24;
  ogi.classList.toggle('is-aan', i === 1);
  poi.classList.toggle('is-aan', i >= 0 && (i !== 1 || jacht.gevonden)); poiLabel.textContent = i >= 0 ? SCENES[i].label : '';
  if (i === 2) telOp();
  kijkNaar = null;
}
function telOp() {
  $$('[data-tel]').forEach(b => { const doelN = +b.dataset.tel, t0 = performance.now();
    (function f() { const k = Math.min(1, (performance.now() - t0) / 1800), e = 1 - Math.pow(1 - k, 3); b.textContent = Math.round(doelN * e).toLocaleString('en'); if (k < 1) requestAnimationFrame(f); })(); });
}
function poiWereld() {                     // punt in de wereld achter het meetpunt (voor haar blik)
  const sc = SCENES[scene_i]; if (!sc) return null; const p = plaatNaarScherm(...sc.poi);
  const nd = new THREE.Vector3(p.x / innerWidth * 2 - 1, -(p.y / innerHeight) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
  return camera.position.clone().add(nd.multiplyScalar(camera.position.z + 0.5));
}
$$('[data-zeg]').forEach(b => b.addEventListener('click', async () => {
  if (voice.playing) { voice.stop(); return; }
  await voice.playUrl(`audio/${b.dataset.zeg}.mp3`);
  kijkNaar = poiWereld();
  if (scene_i === 0 || scene_i === 1) {        // ze wijst naar het lek / de pluim
    const doel = kijkNaar.clone();
    avatar.reik('R', () => { const sh = avatar.bones.upperarm_r.getWorldPosition(new THREE.Vector3()); return sh.add(doel.clone().sub(sh).normalize().multiplyScalar(0.62)); }, 2.6);
  } clearTimeout(opScene.t); opScene.t = setTimeout(() => { kijkNaar = null; }, 2800);
}));
// Academy-app: toolbox talk met checks die meelopen met haar zinnen
const telScherm = $('#telscherm'), telChecks = $$('#tel-checks li'), telBalk = $('#tel-voortgang');
const CHECK_T = [4.2, 7.0, 9.6], APP_DUUR = 11.6; let appT = null;
$$('[data-app]').forEach(b => b.addEventListener('click', async () => {
  if (voice.playing) { voice.stop(); return; }
  kijkNaar = null; telChecks.forEach(li => li.classList.remove('is-af'));
  await voice.playUrl('audio/app-toolbox.mp3'); appT = performance.now();
}));
function telStap() {
  if (appT == null) return;
  const s = (performance.now() - appT) / 1000;
  telChecks.forEach((li, i) => li.classList.toggle('is-af', s > CHECK_T[i]));
  telBalk.style.width = Math.min(100, s / APP_DUUR * 100) + '%';
  if (s > APP_DUUR + 1) appT = null;
}
// OGI-lens volgt de cursor; pluim uit de overdrukklep
const deeltjes = [];
function tekenPluim(t, dt) {
  if (scene_i !== 1) return;
  const W = pluimC.clientWidth, H = pluimC.clientHeight;
  if (pluimC.width !== W) { pluimC.width = W; pluimC.height = H; }
  const bron = plaatNaarScherm(...SCENES[1].poi);
  for (let k = 0; k < 3; k++) deeltjes.push({ x: bron.x, y: bron.y, vx: 14 + Math.random() * 20, vy: -30 - Math.random() * 20, r: 5, a: 0.7, t: 0 });
  px2.clearRect(0, 0, W, H);
  { const g0 = px2.createRadialGradient(bron.x, bron.y, 0, bron.x, bron.y, 34);      // wit-hete kern bij de flens
    g0.addColorStop(0, `rgba(255,255,255,${0.75 + 0.25 * Math.sin(t * 7)})`); g0.addColorStop(1, 'rgba(255,255,255,0)');
    px2.fillStyle = g0; px2.beginPath(); px2.arc(bron.x, bron.y, 34, 0, 6.283); px2.fill(); }
  for (let i = deeltjes.length - 1; i >= 0; i--) {
    const d = deeltjes[i]; d.t += dt; d.x += (d.vx + Math.sin(t * 2 + i) * 14) * dt; d.y += d.vy * dt; d.r += 22 * dt; d.a *= 0.985;
    if (d.t > 4.5) { deeltjes.splice(i, 1); continue; }
    const g = px2.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
    g.addColorStop(0, `rgba(255,255,255,${d.a * 0.55})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    px2.fillStyle = g; px2.beginPath(); px2.arc(d.x, d.y, d.r, 0, 6.283); px2.fill();
  }
}
addEventListener('pointermove', e => { ogi.style.setProperty('--lx', e.clientX + 'px'); ogi.style.setProperty('--ly', e.clientY + 'px'); });

// ---------- lekzoeker: lens over het lek houden ----------
const jacht = { gevonden: false, geluid: false, vast: 0, tik: 0, ctx: null };
const zoeker = $('#zoeker'), jachtEl = $('#jacht'), jachtStatus = $('#jacht-status');
const STIL = new URLSearchParams(location.search).has('stil');
if (STIL) { const b = document.createElement('div'); b.className = 'stil-badge'; b.textContent = 'Muted test mode · remove ?stil from the URL for sound'; document.body.appendChild(b); }
function blip(f, d = 0.014, v = 0.06) {
  if (!jacht.ctx || STIL) return;
  const c = jacht.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; o.type = 'square';
  g.gain.setValueAtTime(v, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
  o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + d + 0.01);
}
$('#jacht-start').addEventListener('click', () => {
  if (!jacht.ctx) { try { jacht.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  jacht.ctx && jacht.ctx.resume();
  jacht.geluid = true; jacht.gevonden = false; jacht.vast = 0; jachtEl.classList.remove('is-gevonden');
  poi.classList.remove('is-aan'); jachtStatus.textContent = 'Listen. Faster ticking means warmer.';
  $('#jacht-start span:last-child').textContent = 'Searching…';
});
function lekGevonden() {
  jacht.gevonden = true; jacht.geluid = false; zoeker.classList.remove('is-aan');
  jachtEl.classList.add('is-gevonden'); jachtStatus.textContent = 'Found it. The pressure relief valve is leaking.';
  $('#jacht-start span:last-child').textContent = 'Hunt again';
  poi.classList.add('is-aan'); blip(1320, 0.12, 0.08); setTimeout(() => blip(1760, 0.16, 0.08), 120);
  voice.playUrl('audio/leak-found.mp3');
  kijkNaar = poiWereld();
  const doel = kijkNaar.clone();
  avatar.reik('R', () => { const sh = avatar.bones.upperarm_r.getWorldPosition(new THREE.Vector3()); return sh.add(doel.clone().sub(sh).normalize().multiplyScalar(0.62)); }, 3.2);
  clearTimeout(lekGevonden.t); lekGevonden.t = setTimeout(() => { kijkNaar = null; }, 4000);
}
function jachtStap(dt) {
  if (scene_i !== 1 || jacht.gevonden) { zoeker.classList.remove('is-aan'); return; }
  const bron = plaatNaarScherm(...SCENES[1].poi), d = Math.hypot(muis.x - bron.x, muis.y - bron.y);
  const dicht = d < 75;
  jacht.vast = dicht ? jacht.vast + dt : Math.max(0, jacht.vast - dt * 2);
  zoeker.classList.toggle('is-aan', jacht.vast > 0.05);
  zoeker.style.transform = `translate3d(${muis.x}px,${muis.y}px,0)`; zoeker.style.setProperty('--k', Math.min(1, jacht.vast).toFixed(3));
  if (jacht.vast >= 1) { lekGevonden(); return; }
  if (jacht.geluid) {                             // tikker: sneller naarmate de lens dichterbij komt
    const prox = clamp(1 - d / 650, 0, 1), iv = lerp(0.95, 0.06, Math.pow(prox, 1.6));
    jacht.tik -= dt; if (jacht.tik <= 0) { blip(900 + 900 * prox); jacht.tik = iv; }
  }
}
// tabs: één scherm, drie scènes
const siteStap = $('.onsite__stap');
$$('.tabs button').forEach(b => b.addEventListener('click', () => {
  const i = +b.dataset.tab; siteStap.dataset.scene = String(i);
  $$('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  $$('.paneel').forEach(p => p.classList.toggle('is-aan', +p.dataset.paneel === i));
}));

// ---------- cast: verschijnen + hover-diepte ----------
const castRij = $('.cast__rij');
{
  const rij = castRij;
  if (rij) {
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { rij.classList.add('is-zichtbaar'); io.disconnect(); } }, { threshold: 0.25 });
    io.observe(rij);
    $$('.cast figure').forEach(f => {
      f.addEventListener('pointermove', e => {
        const r = f.querySelector('.kader').getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        f.classList.add('is-hover');
        f.style.setProperty('--ry', (x * 9).toFixed(2) + 'deg'); f.style.setProperty('--rx', (-y * 7).toFixed(2) + 'deg');
        f.style.setProperty('--px', (-x * 14).toFixed(1) + 'px'); f.style.setProperty('--py', (-y * 12).toFixed(1) + 'px');
        f.style.setProperty('--gx', ((x + 0.5) * 100).toFixed(1) + '%'); f.style.setProperty('--gy', ((y + 0.5) * 100).toFixed(1) + '%'); f.style.setProperty('--g', '1');
      });
      f.addEventListener('pointerleave', () => {
        f.classList.remove('is-hover');
        for (const [k, v] of [['--ry', '0deg'], ['--rx', '0deg'], ['--px', '0px'], ['--py', '0px'], ['--g', '0']]) f.style.setProperty(k, v);
      });
    });
  }
}

// ---------- formaten: haar ronddraaien met de muis (alleen rond de verticale as) ----------
const draai = { y: 0, sleept: false, x0: 0, y0: 0 };
addEventListener('pointerdown', e => {
  if (actief !== 'formats' || e.button !== 0 || e.target.closest('a,button,textarea,input,.modi')) return;
  draai.sleept = true; draai.x0 = e.clientX; draai.y0 = draai.y; document.body.classList.add('draait');
});
addEventListener('pointermove', e => { if (draai.sleept) draai.y = draai.y0 + (e.clientX - draai.x0) * 0.008; });
addEventListener('pointerup', () => { draai.sleept = false; document.body.classList.remove('draait'); });

// ---------- formaten ----------
let modus = 'motion';
const still = $('#still'), spec = $('#spec');
function zetModus(m) {
  modus = m;
  $$('.modi button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  still.classList.toggle('is-aan', m === 'slide' && actief === 'formats');
  renderer.domElement.style.opacity = (m === 'slide' && actief === 'formats') ? '0' : '';   // zacht uitfaden, niet weg-knippen
  avatar.setMode(m === 'motion' && actief === 'formats' ? 'walk' : 'idle');
  setWire(m === 'vr' && actief === 'formats');
  spec.textContent = m === 'vr' ? specTekst : m === 'slide' ? 'Unreal Engine 5 · MetaHuman · cinematic stills in any pose, angle or crop.' : 'Same rig · body animation, eyes that follow you, live lip movement.';
}
$$('.modi button').forEach(b => b.addEventListener('click', () => zetModus(b.dataset.mode)));
let specTekst = '';
const wireMat = new THREE.MeshBasicMaterial({ color: 0x040190, wireframe: true, transparent: true, opacity: 0.35 });
let wireOn = false;
function setWire(on) {
  if (on === wireOn) return; wireOn = on;
  avatar.root.traverse(o => { if (!o.isMesh) return; if (on) { o.userData.mat = o.material; o.material = wireMat; } else if (o.userData.mat) o.material = o.userData.mat; });
}
function opSectie(s) {
  if (s !== 'formats') draai.y = 0;
  if (s !== 'formats') { still.classList.remove('is-aan'); setWire(false); avatar.setMode('idle'); avatar.root.visible = true; floor.visible = true; renderer.domElement.style.opacity = ''; } else zetModus(modus);
  // pas daarna de inloop (anders zet de regel hierboven haar terug op 'idle' en schuift ze binnen)
  if (s === 'cast' && !RUST && avatar.mixer) avatar.startIntro({ x: 1.9, zwaai: false, handen: true });   // wandelt binnen, vouwt haar handen
  else if (s !== 'cast' && avatar._gevouwen) avatar.vouw(false);
}

// ---------- smooth scroll ----------
let lenis = null;
if (!RUST && window.Lenis) { lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 }); }
$$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href'); if (id.length < 2) return; e.preventDefault();
  const el = $(id); if (lenis) lenis.scrollTo(el, { offset: 0, duration: 1.4 }); else el.scrollIntoView();
}));

// ---------- maat ----------
function maat() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); maatDots(); }
addEventListener('resize', maat); maat();

// ---------- lus ----------
const klok = new THREE.Clock();
function lus(ms) {
  requestAnimationFrame(lus);
  if (window.STOPLUS) { klok.getDelta(); return; }        // debug: lus gepauzeerd (handmatig stappen)
  const dt = Math.min(0.05, klok.getDelta()), t = klok.elapsedTime;
  if (lenis) lenis.raf(ms);
  kiesStand();
  for (const k of ['cx', 'cy', 'cz', 'ly', 'fov', 'lx', 'lz', 'sx']) stand[k] = damp(stand[k] ?? doel[k], doel[k] ?? stand[k], RUST ? 50 : 2.6, dt);
  muis.sx = damp(muis.sx, muis.x, 10, dt); muis.sy = damp(muis.sy, muis.y, 10, dt);
  cursor.style.transform = `translate3d(${muis.x}px,${muis.y}px,0)`;
  const px = (muis.sx / innerWidth - 0.5), py = (muis.sy / innerHeight - 0.5);
  // trage, ademende camera (alsof hij uit de hand op een slider staat)
  const drift = RUST ? 0 : 1;
  camera.position.set(stand.cx + px * 0.06 + drift * 0.035 * Math.sin(t * 0.21), stand.cy - py * 0.04 + drift * 0.012 * Math.sin(t * 0.33 + 1), stand.cz + drift * 0.05 * Math.sin(t * 0.13));
  camera.fov = stand.fov; camera.updateProjectionMatrix();
  camera.lookAt(stand.lx, stand.ly, stand.lz);
  // Academy-app: de avatar verschijnt alleen in het gsm-scherm (geknipt canvas + verschoven projectie)
  telK = damp(telK, actief === 'app' ? 1 : 0, 4.5, dt);
  if (telK > 0.002 && telScherm) {
    // overgang naar het gsm-scherm: kader krimpt en het beeld zoomt mee (geen sprong)
    const r = telScherm.getBoundingClientRect(), k = telK * telK * (3 - 2 * telK), W = innerWidth, H = innerHeight;
    const rad = (parseFloat(getComputedStyle(telScherm).borderTopLeftRadius) || 36) * k;
    renderer.domElement.style.clipPath = `inset(${r.top * k}px ${(W - r.right) * k}px ${(H - r.bottom) * k}px ${r.left * k}px round ${rad}px)`;
    renderer.domElement.classList.toggle('in-tel', k > 0.96);
    const fw = lerp(W, r.width, k), fh = lerp(H, r.height, k);
    camera.aspect = fw / fh; camera.setViewOffset(fw, fh, -r.left * k, -r.top * k, W, H);
  } else {
    if (renderer.domElement.style.clipPath) { renderer.domElement.style.clipPath = ''; renderer.domElement.classList.remove('in-tel'); }
    camera.aspect = innerWidth / innerHeight;
    if (Math.abs(stand.sx) > 0.002) camera.setViewOffset(innerWidth, innerHeight, -stand.sx * innerWidth, 0, innerWidth, innerHeight);   // beeld naar rechts: close-up naast de tekst
    else if (camera.view && camera.view.enabled) camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  if (actief !== 'kit' && focusH) focusH = null;                      // sectie verlaten: focus los
  document.body.classList.toggle('kit-close', actief === 'kit' && !!focusH);
  if (avatar.mixer) {
    const lvl = voice.update();
    const bd = blikDoel(); if (voice.playing && !kijkNaar) bd.lerp(camera.position, 0.85);   // tijdens het spreken kijkt ze jou aan
    avatar.look.lerp(bd, 1 - Math.exp(-6 * dt));
    avatar.update(dt);
    // mond op het scherm voor de stemrimpels in het dot-veld
    const hp = avatar.bones.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.02, 0.09)).project(camera);
    mondScherm = { x: (hp.x * 0.5 + 0.5) * innerWidth, y: (-hp.y * 0.5 + 0.5) * innerHeight };
    if (lvl > 0.35 && t - laatsteGolf > 0.32) { golven.push({ x: mondScherm.x, y: mondScherm.y, t, a: Math.min(1, lvl) }); laatsteGolf = t; }
    while (golven.length && t - golven[0].t > 1.9) golven.shift();
    plaatsHotspots();
    { // lichtbad achter haar borst, poel onder haar voeten
      const bp = avatar.bones.spine_05 ? avatar.bones.spine_05.getWorldPosition(new THREE.Vector3()).project(camera) : hp;
      const fp = avatar.root.getWorldPosition(new THREE.Vector3()).project(camera);
      halo.x = damp(halo.x, bp.x * 0.5 + 0.5, 4, dt); halo.y = damp(halo.y, -bp.y * 0.5 + 0.5, 4, dt); halo.fy = damp(halo.fy, -fp.y * 0.5 + 0.5, 4, dt);
      lichtK = damp(lichtK, scene_i >= 0 ? 0 : 1, 3, dt);
      licht.style.setProperty('--hx', (halo.x * 100).toFixed(2) + '%'); licht.style.setProperty('--hy', (halo.y * 100).toFixed(2) + '%');
      licht.style.setProperty('--fy', (halo.fy * 100).toFixed(2) + '%'); licht.style.setProperty('--lk', lichtK.toFixed(3));
    }
    if (!avatar.inIntro) avatar.root.rotation.y = damp(avatar.root.rotation.y, actief === 'formats' ? draai.y : rotDoel, draai.sleept ? 14 : 3, dt);
    if (scene_i >= 0) { const p = plaatNaarScherm(...SCENES[scene_i].poi); poi.style.transform = `translate3d(${p.x}px,${p.y}px,0)`; }
    tekenPluim(t, dt); jachtStap(dt);
  }
  tekenDots(t, voice.level); tekenStof(t, dt); telStap();
  if (castRij && !castRij.classList.contains('is-zichtbaar') && castRij.getBoundingClientRect().top < innerHeight * 0.82) castRij.classList.add('is-zichtbaar');   // vangnet naast de IntersectionObserver
  renderer.render(scene, camera);
}

// ---------- laden ----------
// ---------- trailer: eerst de film (met geluid), dan opent de meetstip de site ----------
const trailer = $('#trailer'), tv = $('#trailer-video');
let trailerAan = !!trailer && !RUST, siteGestart = false;
function siteStart() {
  if (siteGestart) return; siteGestart = true;
  document.body.classList.add('is-geladen');
  if (!RUST && actief === 'hero' && scrollY < innerHeight * 0.3) { avatar.startIntro(); avatar.update(0); }   // ze wandelt binnen en zwaait
}
function trailerToon() {
  trailerAan = true; trailer.hidden = false; trailer.className = 'trailer'; document.body.classList.add('trailer-aan');
  if (lenis) lenis.stop();
}
function trailerOpen() {                 // meetstip verschijnt, daarna gaat de iris open
  if (!trailerAan || trailer.classList.contains('is-punt')) return;
  trailer.classList.add('is-punt');
  const wacht = () => {
    if (!window.READY) { setTimeout(wacht, 200); return; }   // model nog niet klaar: de stip blijft pulseren
    window.scrollTo(0, 0);
    trailer.classList.add('is-open'); siteStart();
    document.body.classList.remove('trailer-aan'); if (lenis) lenis.start();
    setTimeout(() => { tv.pause(); trailer.hidden = true; trailerAan = false; }, 1450);
  };
  setTimeout(wacht, 650);
}
if (trailer) {
  if (!trailerAan) trailer.hidden = true; else trailerToon();
  tv.muted = STIL; tv.volume = 1;
  $('#trailer-play').addEventListener('click', () => {
    trailer.classList.add('speelt'); tv.currentTime = 0;
    const p = tv.play(); if (p && p.catch) p.catch(() => { tv.muted = true; tv.play(); });
  });
  $('#trailer-skip').addEventListener('click', () => trailerOpen());
  $('#trailer-verder').addEventListener('click', () => trailerOpen());
  tv.addEventListener('timeupdate', () => { if (tv.duration && tv.currentTime > tv.duration - 0.7) trailerOpen(); });
  tv.addEventListener('ended', () => trailerOpen());
  const weer = $('#trailer-weer');
  if (weer) weer.addEventListener('click', () => { voice.stop(); trailerToon(); trailer.classList.add('speelt'); tv.currentTime = 0; tv.play(); });
}

const pct = $('#laden-pct');
avatar.load('models/aellia.glb?v=111846', f => { pct.textContent = Math.round(f * 100) + '%'; }).then(async () => {
  document.querySelector('.laden__in p').textContent = 'Fastening her chin strap'; pct.textContent = '';
  try { await Promise.race([renderer.compileAsync(scene, camera), new Promise(r => setTimeout(r, 4000))]); } catch (e) {}
  let v = 0, j = 0; avatar.root.traverse(o => { if (o.isMesh) v += o.geometry.attributes.position.count; if (o.isBone) j++; });
  specTekst = `${Math.round(v / 1000)}k vertices · ${j.toLocaleString('en')} joints · one skeleton for Unreal, Unity and WebXR.`;
  zetModus('motion'); opSectie(actief);
  $('#laden').classList.add('is-klaar');
  window.READY = true;
  if (!trailerAan) siteStart();          // anders start de site pas als de trailer de iris opent
}).catch(e => { pct.textContent = 'error'; console.error(e); });
requestAnimationFrame(lus);
window.__dbg = { avatar, camera, voice, live, scene, renderer, kitDetail, opSectie };
