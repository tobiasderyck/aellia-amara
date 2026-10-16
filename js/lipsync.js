// Lipsync: IPA-fonemen (Kokoro/espeak) uitlijnen op het echte volumeverloop van de audio (DTW)
// en per moment een mondvorm (viseme) teruggeven. Werkt in de browser, de worker en Node.

const VOWELS = ['aɪ', 'aʊ', 'eɪ', 'oʊ', 'ɔɪ', 'ɑː', 'ɜː', 'iː', 'uː', 'ɔː', 'ɑ', 'a', 'æ', 'ʌ', 'ə', 'ɐ', 'ɜ', 'ɚ', 'ɝ', 'ɛ', 'e', 'ɪ', 'i', 'ɔ', 'o', 'ʊ', 'u', 'ᵻ', 'ɒ', 'y'];
const CONS = ['tʃ', 'dʒ', 'p', 'b', 'm', 'f', 'v', 'θ', 'ð', 't', 'd', 'n', 'l', 'ɾ', 'k', 'g', 'ɡ', 'ŋ', 'ʃ', 'ʒ', 's', 'z', 'ɹ', 'r', 'w', 'j', 'h', 'ʔ', 'x', 'ç'];
const SYMS = [...VOWELS, ...CONS].sort((a, b) => b.length - a.length);

// mondvorm per foneem: open, rond (getuit), breed, lippen op elkaar, onderlip tegen tanden
const V = (open, round = 0, wide = 0, press = 0, ff = 0) => ({ open, round, wide, press, ff });
const VIS = {
  PP: V(0, 0.05, 0, 1), FF: V(0.07, 0, 0.15, 0, 1), TH: V(0.16, 0, 0.25), DD: V(0.2, 0, 0.25), KK: V(0.26, 0, 0.1),
  CH: V(0.16, 0.55), SS: V(0.08, 0, 0.55), NN: V(0.14, 0, 0.15), RR: V(0.2, 0.45), WW: V(0.18, 0.95),
  AA: V(0.88, 0, 0.18), AE: V(0.7, 0, 0.45), E: V(0.52, 0, 0.55), I: V(0.3, 0, 0.85), O: V(0.62, 0.72), U: V(0.3, 1),
  ER: V(0.35, 0.4), SCHWA: V(0.38, 0, 0.12), H: V(0.35, 0, 0.1), SIL: V(0, 0, 0),
};
const P2V = {
  p: 'PP', b: 'PP', m: 'PP', f: 'FF', v: 'FF', 'θ': 'TH', 'ð': 'TH', t: 'DD', d: 'DD', 'ɾ': 'DD', n: 'NN', l: 'NN',
  k: 'KK', g: 'KK', 'ɡ': 'KK', 'ŋ': 'KK', x: 'KK', 'ʃ': 'CH', 'ʒ': 'CH', 'tʃ': 'CH', 'dʒ': 'CH', s: 'SS', z: 'SS', 'ç': 'SS',
  'ɹ': 'RR', r: 'RR', w: 'WW', j: 'I', h: 'H', 'ʔ': 'SIL',
  'ɑ': 'AA', 'ɑː': 'AA', a: 'AA', 'ɒ': 'O', 'æ': 'AE', 'ʌ': 'AA', 'ə': 'SCHWA', 'ɐ': 'SCHWA', 'ᵻ': 'I',
  'ɜ': 'ER', 'ɜː': 'ER', 'ɚ': 'ER', 'ɝ': 'ER', 'ɛ': 'E', e: 'E', 'ɪ': 'I', i: 'I', 'iː': 'I', y: 'U',
  'ɔ': 'O', 'ɔː': 'O', o: 'O', 'ʊ': 'U', u: 'U', 'uː': 'U',
  'aɪ': 'AA>I', 'aʊ': 'AA>U', 'eɪ': 'E>I', 'oʊ': 'O>U', 'ɔɪ': 'O>I',
};
// nominale duur (s) en verwachte luidheid (0..1) per klasse
function cls(p) {
  if (VOWELS.includes(p)) return p.length > 1 && !p.endsWith('ː') ? 'diph' : 'vowel';
  if ('pbtdkgɡʔɾ'.includes(p)) return 'stop';
  if ('fvθðszʃʒhçx'.includes(p) || p === 'tʃ' || p === 'dʒ') return 'fric';
  if ('mnŋl'.includes(p)) return 'nasal';
  return 'approx';
}
const DUR = { vowel: 0.085, diph: 0.13, stop: 0.055, fric: 0.075, nasal: 0.06, approx: 0.055 };
const LOUD = { vowel: 1, diph: 1, stop: 0.18, fric: 0.32, nasal: 0.5, approx: 0.6 };

export function tokenize(ipa) {
  const out = []; let stress = 0, i = 0;
  const s = ipa.normalize('NFC');
  while (i < s.length) {
    const ch = s[i];
    if (ch === 'ˈ') { stress = 2; i++; continue; }
    if (ch === 'ˌ') { stress = 1; i++; continue; }
    if (ch === ' ') { out.push({ p: ' ', k: 'gap' }); i++; continue; }
    if ('.!?'.includes(ch)) { out.push({ p: ch, k: 'stop_long' }); i++; continue; }
    if (',;:—–'.includes(ch)) { out.push({ p: ch, k: 'pause' }); i++; continue; }
    const sym = SYMS.find(x => s.startsWith(x, i));
    if (!sym) { i++; continue; }
    const k = cls(sym);
    out.push({ p: sym, k, stress: VOWELS.includes(sym) ? stress : 0, vis: P2V[sym] || 'SCHWA' });
    if (VOWELS.includes(sym)) stress = 0;
    i += sym.length; if (s[i] === 'ː') i++;
  }
  return out;
}

// RMS-envelope per 10 ms (0..1, gecomprimeerd)
export function envelope(pcm, sr, hop = 0.01) {
  const H = Math.round(sr * hop), n = Math.floor(pcm.length / H), env = new Float32Array(n);
  let mx = 1e-6;
  for (let f = 0; f < n; f++) { let s = 0; for (let k = f * H; k < (f + 1) * H; k++) s += pcm[k] * pcm[k]; env[f] = Math.sqrt(s / H); if (env[f] > mx) mx = env[f]; }
  for (let f = 0; f < n; f++) env[f] = Math.sqrt(Math.min(1, env[f] / (mx * 0.8)));
  return env;
}

// DTW tussen verwachte luidheid (uit fonemen) en echte envelope -> start/einde per foneem (s)
export function align(tokens, env, hop = 0.01) {
  const exp = [], owner = [];
  tokens.forEach((t, idx) => {
    let d, l;
    if (t.k === 'gap') { d = 0.015; l = 0.25; }
    else if (t.k === 'pause') { d = 0.18; l = 0; }
    else if (t.k === 'stop_long') { d = 0.28; l = 0; }
    else { d = DUR[t.k] * (t.stress === 2 ? 1.3 : 1); l = LOUD[t.k] * (t.stress ? 1 : 0.85); }
    const nf = Math.max(1, Math.round(d / hop));
    for (let f = 0; f < nf; f++) { exp.push(l); owner.push(idx); }
  });
  // voor- en nastilte
  const N = exp.length, M = env.length;
  if (!N || !M) return tokens.map(() => [0, 0]);
  const INF = 1e9, cost = new Float32Array((N + 1) * (M + 1)).fill(INF), from = new Uint8Array((N + 1) * (M + 1));
  const at = (i, j) => i * (M + 1) + j;
  cost[at(0, 0)] = 0;
  for (let j = 1; j <= M; j++) { if (env[j - 1] < 0.12) { cost[at(0, j)] = cost[at(0, j - 1)] + env[j - 1]; from[at(0, j)] = 2; } else break; }
  const band = Math.max(60, Math.abs(M - N) + 80);
  for (let i = 1; i <= N; i++) {
    const jc = Math.round(i * M / N), j0 = Math.max(1, jc - band), j1 = Math.min(M, jc + band);
    for (let j = j0; j <= j1; j++) {
      const c = Math.abs(exp[i - 1] - env[j - 1]);
      const d = cost[at(i - 1, j - 1)], u = cost[at(i - 1, j)] + 0.04, l = cost[at(i, j - 1)] + 0.04;
      let m = d, w = 0; if (u < m) { m = u; w = 1; } if (l < m) { m = l; w = 2; }
      cost[at(i, j)] = m + c; from[at(i, j)] = w;
    }
  }
  // einde mag in nastilte vallen
  let bj = M, best = cost[at(N, M)];
  for (let j = M; j > Math.max(1, M - 80); j--) if (cost[at(N, j)] < best) { best = cost[at(N, j)]; bj = j; }
  const map = new Int32Array(N).fill(-1);
  let i = N, j = bj;
  while (i > 0 && j > 0) { map[i - 1] = j - 1; const w = from[at(i, j)]; if (w === 0) { i--; j--; } else if (w === 1) i--; else j--; }
  for (let k = 1; k < N; k++) if (map[k] < 0) map[k] = map[k - 1];
  const span = tokens.map(() => [Infinity, -Infinity]);
  for (let k = 0; k < N; k++) { const o = owner[k], t = map[k] * hop; if (t < span[o][0]) span[o][0] = t; if (t + hop > span[o][1]) span[o][1] = t + hop; }
  return span;
}

// tijdlijn: [{t0, t1, vis, stress}] -> mondvorm op tijd t (met overloop tussen klanken)
export function buildTimeline(ipa, pcm, sr, offset = 0) {
  const tokens = tokenize(ipa), env = envelope(pcm, sr), span = align(tokens, env);
  const items = [];
  tokens.forEach((t, k) => {
    if (!t.vis) return;
    const [a, b] = span[k]; if (!isFinite(a)) return;
    items.push({ t0: +(a + offset).toFixed(3), t1: +(b + offset).toFixed(3), v: t.vis, s: t.stress || 0 });
  });
  return { items, env: Array.from(env, x => +x.toFixed(3)), hop: 0.01, offset };
}

const ZERO = V(0);
export function sample(tl, t) {
  const out = { open: 0, round: 0, wide: 0, press: 0, ff: 0 }; let wsum = 0;
  if (!tl) return out;
  for (const it of tl.items) {
    if (it.t1 < t - 0.12 || it.t0 > t + 0.12) continue;
    const mid = (it.t0 + it.t1) / 2, half = Math.max(0.035, (it.t1 - it.t0) / 2) + 0.045;
    const x = (t - mid) / half; if (Math.abs(x) >= 1) continue;
    const w = 0.5 + 0.5 * Math.cos(Math.PI * x);
    let vis;
    if (it.v.includes('>')) { const [a, b] = it.v.split('>'); const f = Math.min(1, Math.max(0, (t - it.t0) / Math.max(0.01, it.t1 - it.t0))); vis = mix(VIS[a], VIS[b], f); }
    else vis = VIS[it.v] || ZERO;
    const ww = w * (vis.press || vis.ff ? 1.6 : 1);    // lipsluiting wint van naburige klinkers
    for (const k in out) out[k] += vis[k] * ww; wsum += ww;
  }
  if (wsum > 0) for (const k in out) out[k] /= Math.max(1, wsum);
  // luidheid moduleert de opening (een fluisterende klinker gaat minder ver open)
  const f = Math.floor((t - tl.offset) / tl.hop), e = tl.env[f] ?? 0;
  out.open *= 0.55 + 0.6 * e;
  out.level = e;
  return out;
}
function mix(a, b, f) { const o = {}; for (const k in a) o[k] = a[k] * (1 - f) + b[k] * f; return o; }
export function stresses(tl) { return tl ? tl.items.filter(i => i.s === 2).map(i => i.t0) : []; }
