// Kokoro TTS in de browser (Apache-2.0, onnx-community/Kokoro-82M-v1.0-ONNX). Laadt één keer, spreekt per zin.
import { KokoroTTS, TextSplitterStream } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
import { buildTimeline } from './lipsync.js?v=065003';
let tts = null;
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
async function load() {
  if (tts) return;
  const webgpu = !!(self.navigator && navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null));
  tts = await KokoroTTS.from_pretrained(MODEL, {
    dtype: 'q8', device: 'wasm',          // ~90 MB; fp32/WebGPU zou 326 MB laden
    progress_callback: p => { if (p.status === 'progress' && p.total) postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }); },
  });
  postMessage({ type: 'ready', device: 'wasm' });
}
function sentences(text) {
  // korte eerste brok (snel eerste klank), daarna zinnen/zinsdelen tot ~110 tekens
  const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?;:,]+[.!?;:,]*/g) || [text];
  const out = []; let cur = '';
  for (const p of parts) {
    const lim = out.length === 0 ? 48 : 110;
    if ((cur + p).length <= lim || !cur) cur += p; else { out.push(cur.trim()); cur = p; }
    if (/[.!?]$/.test(cur.trim()) && cur.length > 20) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'load') await load();
    if (m.type === 'speak') {
      await load();
      const st = new TextSplitterStream();
      for (const c of sentences(m.text)) st.push(c + ' ');
      st.close();
      let i = 0;
      for await (const r of tts.stream(st, { voice: m.voice || 'af_heart', speed: m.speed || 0.96 })) {
        const pcm = r.audio.audio instanceof Float32Array ? r.audio.audio : new Float32Array(r.audio.audio);
        const tl = buildTimeline(r.phonemes, pcm, r.audio.sampling_rate, 0);
        postMessage({ type: 'chunk', id: m.id, index: i++, last: false, pcm, sr: r.audio.sampling_rate, tl }, [pcm.buffer]);
      }
      postMessage({ type: 'done', id: m.id });
    }
  } catch (err) { postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
