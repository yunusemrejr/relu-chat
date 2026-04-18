import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
import { KB, entryText } from './knowledge-base.js';
import { INTENTS, compose, softmax, weightedChoice, cosine, bowVec, tokens, pick } from './nlp.js';
import { $, escapeHTML, md, setStatus, pushMessage } from './ui.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

const messagesEl = $('#messages'), form = $('#form'), input = $('#input'), sendBtn = $('#send');
const bar = $('#bar');

let extractor = null, entryEmb = [], intentEmb = {}, fragEmbCache = new Map();
let ready = false, busy = false;

async function embed(text) {
  if (extractor) {
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }
  return bowVec(text, bowVocab);
}

async function embedCached(text) {
  if (fragEmbCache.has(text)) return fragEmbCache.get(text);
  const v = await embed(text);
  if (fragEmbCache.size < 1000) fragEmbCache.set(text, v);
  return v;
}

let bowVocab = null;

async function init() {
  try {
    setStatus('loading transformer…');
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
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
    for (let i = 0; i < KB.length; i++) {
      entryEmb.push(await embed(entryText(KB[i])));
      bar.style.width = ((i + 1) / KB.length * 100) + '%';
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
    const { text, meta } = await compose(query, qEmb, embedCached, entryEmb, intentEmb);
    typingEl.remove();
    pushMessage('bot', md(text), meta);
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
  "What is Nash equilibrium?",
  "Example of a zero-sum game",
  "Formal definition of Shapley value",
  "Explain evolutionarily stable strategies",
  "Applications of mechanism design",
  "Prisoner's dilemma explained",
  "Minimax theorem",
  "Rubinstein bargaining"
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
  '<span style="font-size:1.125rem;font-weight:600;color:var(--text-primary);letter-spacing:-0.02em;">Game Theory Chat</span><br><br>Hi! I\'m an <strong>on-device</strong> assistant specialized in <strong>mathematical game theory</strong>. I understand your question with a transformer running entirely in your browser and compose responses from weighted concept fragments — nothing is sent to a server.<br><br>The first query will warm up the model (a one-time download). Try a suggestion below, or ask your own question.'
);

document.querySelectorAll('.suggestions-inline .suggestion').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!ready || busy) return;
    input.value = btn.dataset.q;
    form.requestSubmit();
  });
});

sendBtn.disabled = true;
init();
