import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
import { KB, entryText } from './knowledge-base.js';
import { INTENTS, compose, softmax, weightedChoice, cosine, bowVec, tokens, pick, compileAliasRegex } from './nlp.js';
import { CONFIG } from './config.js';
import { $, escapeHTML, md, setStatus, pushMessage } from './ui.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

const messagesEl = $('#messages'), form = $('#form'), input = $('#input'), sendBtn = $('#send');
const bar = $('#bar');

let extractor = null, entryEmb = [], intentEmb = {}, lastTopic = null;
let ready = false, busy = false;

class LRUCache {
  constructor(max) { this.max = max; this.cache = new Map(); }
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const v = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, v);
    return v;
  }
  set(key, val) {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.max) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, val);
  }
}

const fragEmbCache = new LRUCache(CONFIG.CACHE.MAX_SIZE);

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

let bowVocab = null;

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
    compileAliasRegex();
    const BATCH = 4;
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
    compileAliasRegex();
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
}

async function handle(query) {
  if (!query.trim()) return;
  pushMessage('user', md(escapeHTML(query)));
  busy = true;
  sendBtn.disabled = true;
  const typingEl = pushMessage('bot', '<div class="typing"><span></span><span></span><span></span></div>');
  try {
    const qEmb = await embed(query);
    const { text, meta } = await compose(query, qEmb, embedCached, entryEmb, intentEmb, lastTopic);
    typingEl.remove();
    pushMessage('bot', md(text), meta);
    if (meta) {
      const topicEntries = meta.filter(m => m.type === '');
      if (topicEntries.length > 0) {
        lastTopic = KB.find(e => e.name === topicEntries[0].text)?.id || null;
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

const SUGGESTIONS = [
  "Who was Al-Khwarizmi?",
  "What was the House of Wisdom?",
  "How did Ibn al-Haytham discover optics?",
  "Explain the Tusi couple",
  "What is the Canon of Medicine?",
  "Tell me about the astrolabe",
  "How did paper spread to Europe?",
  "Who discovered pulmonary circulation?"
];
const suggestionsEl = $('#suggestions');
for (const s of SUGGESTIONS) {
  const b = document.createElement('button');
  b.className = 'suggestion';
  b.type = 'button';
  b.textContent = s;
  b.onclick = () => { if (!ready || busy) return; input.value = s; form.requestSubmit(); };
  suggestionsEl.appendChild(b);
}

pushMessage('bot',
  '<span style="font-size:1.125rem;font-weight:600;color:var(--text-primary);letter-spacing:-0.02em;">Golden Age Inquiry</span><br><br>Hi! I\'m an <strong>on-device</strong> assistant specialized in the <strong>scientific and philosophical discoveries</strong> of the Islamic Golden Age (8th–14th centuries). I understand your question with a transformer running entirely in your browser and compose responses from weighted concept fragments — nothing is sent to a server.<br><br>The first query will warm up the model (a one-time download). Try a suggestion below, or ask your own question.'
);

sendBtn.disabled = true;
init();
