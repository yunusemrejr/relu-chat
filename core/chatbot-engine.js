import { pipeline, env } from '/assets/transformers/transformers.js';
import { LRUCache } from './cache.js';
import { compose, tokens, bowVec, compileAliasRegex } from './nlp.js';
import { pushMessage, setStatus, escapeHTML, md } from './ui.js';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '/assets/models';
env.backends.onnx.wasm.wasmPaths = '/assets/transformers/';
env.useBrowserCache = true;

export async function createChatbot(config) {
  const {
    KB, entryText, CONFIG, INTENTS, overrides,
    suggestions, welcomeMessage,
    onReady
  } = config;

  const bar = document.getElementById('bar');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const form = document.getElementById('form');
  let extractor = null, entryEmb = [], intentEmb = {};
  let ready = false, busy = false;
  let lastTopic = null;
  const fragEmbCache = new LRUCache(CONFIG?.CACHE?.MAX_SIZE || 500);
  let bowVocab = null;

  async function embed(text) {
    if (extractor) {
      const out = await extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(out.data);
    }
    return bowVec(text, bowVocab);
  }

  async function embedCached(text) {
    if (fragEmbCache.get(text)) return fragEmbCache.get(text);
    const v = await embed(text);
    fragEmbCache.set(text, v);
    return v;
  }

  async function init() {
    try {
      setStatus('loading transformer…');
      extractor = await pipeline('feature-extraction', CONFIG.EMBEDDING.model, {
        quantized: CONFIG.EMBEDDING.quantized,
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            const pct = (p.loaded / p.total) * 100;
            bar.style.width = pct + '%';
            setStatus(`loading ${p.file || 'model'} ${pct.toFixed(0)}%`);
          }
        }
      });
      setStatus('encoding knowledge base…');
      bar.style.width = '0%';
      compileAliasRegex(KB);
      const BATCH = 8;
      for (let i = 0; i < KB.length; i += BATCH) {
        const batch = KB.slice(i, i + BATCH).map(e => embed(entryText(e)));
        entryEmb.push(...await Promise.all(batch));
        bar.style.width = (Math.min(i + BATCH, KB.length) / KB.length * 100) + '%';
      }
      for (const k of Object.keys(INTENTS)) {
        intentEmb[k] = [];
        for (const p of INTENTS[k].prototypes) intentEmb[k].push(await embed(p));
      }
      bar.style.width = '100%';
      setTimeout(() => bar.style.width = '0%', 500);
      setStatus('ready', true);
    } catch (err) {
      console.error('Model load failed, using BOW fallback:', err);
      const voc = new Set();
      compileAliasRegex(KB);
      for (const e of KB) for (const t of tokens(entryText(e))) voc.add(t);
      for (const k of Object.keys(INTENTS)) for (const p of INTENTS[k].prototypes) for (const t of tokens(p)) voc.add(t);
      bowVocab = new Map();
      [...voc].forEach((w, i) => bowVocab.set(w, i));
      entryEmb = KB.map(e => bowVec(entryText(e), bowVocab));
      for (const k of Object.keys(INTENTS)) intentEmb[k] = INTENTS[k].prototypes.map(p => bowVec(p, bowVocab));
      setStatus('offline mode', true);
    }
    ready = true;
    sendBtn.disabled = false;
    if (onReady) onReady();
  }

  async function handle(query) {
    if (!query.trim()) return;
    pushMessage('user', md(escapeHTML(query)));
    busy = true;
    sendBtn.disabled = true;
    const typingEl = pushMessage('bot', '<div class="typing"><span></span><span></span><span></span></div>');
    try {
      const qEmb = await embed(query);
      const { text, meta } = await compose(query, qEmb, embedCached, entryEmb, intentEmb, lastTopic, KB, CONFIG, overrides);
      typingEl.remove();
      pushMessage('bot', md(text), meta);
      if (meta) {
        const topicEntries = meta.filter(m => m.type === '');
        if (topicEntries.length > 0) {
          lastTopic = KB.findIndex(e => e.name === topicEntries[0].text);
        }
      }
    } catch (err) {
      console.error(err);
      typingEl.remove();
      pushMessage('bot', 'Sorry, something went wrong processing that. Try again?');
    } finally {
      busy = false;
      sendBtn.disabled = false;
    }
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (busy || !ready) return;
    const q = input.value;
    input.value = '';
    input.style.height = 'auto';
    handle(q);
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  const suggestionsEl = document.getElementById('suggestions');
  if (suggestionsEl && suggestions) {
    for (const s of suggestions) {
      const b = document.createElement('button');
      b.className = 'suggestion';
      b.type = 'button';
      b.textContent = s;
      b.onclick = () => { if (!ready || busy) return; input.value = s; form.requestSubmit(); };
      suggestionsEl.appendChild(b);
    }
  }

  if (welcomeMessage) {
    pushMessage('bot', welcomeMessage);
  }

  sendBtn.disabled = true;
  init();
}
