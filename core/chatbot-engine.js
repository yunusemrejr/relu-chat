import { interpretMessage, conversationalReply } from './conversation.js';
import { LRUCache } from './cache.js';
import { SessionMemory } from './session.js';
import { composeV2, setCompositionSeed, tokens, bowVec, compileAliasRegex } from './nlp.js';
import { pushMessage, pushMessageStream, setStatus, escapeHTML, md, renderDiagramElement } from './ui.js';
import { loadPolicyRuntime, planAnswer, isPolicyLoaded } from '../policy/policy-runtime.js';
import { SignalLayer } from './signal-layer.js';
import { readEmbeddings, writeEmbeddings, embeddingKey, validEmbeddings } from './embedding-store.js';

// ---------------------------------------------------------------------------
// Loading state machine
// ---------------------------------------------------------------------------

/**
 * @typedef {'idle'|'loading_transformer'|'loading_policy'|'loading_embeddings'|
 *            'partially_ready'|'ready'|'error'} LoadState
 */

/** @type {LoadState} */
let _loadState = 'idle';

/** @type {Array<function>} */
let _stateListeners = [];

/**
 * Get the current loading state.
 * @returns {LoadState}
 */
export function getLoadState() { return _loadState; }

/**
 * Subscribe to loading state changes.
 * @param {function} listener - called with (newState, oldState)
 * @returns {function} unsubscribe
 */
export function onLoadStateChange(listener) {
  _stateListeners.push(listener);
  return () => {
    _stateListeners = _stateListeners.filter(l => l !== listener);
  };
}

function _setLoadState(newState) {
  const old = _loadState;
  _loadState = newState;
  for (const fn of _stateListeners) {
    try { fn(newState, old); } catch (e) { console.warn('[state] listener error:', e); }
  }
}

/**
 * Simple 32-bit string hash (djb2 variant) for deterministic composition seeding.
 * @param {string} str
 * @returns {number}
 */
function hash32(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

export async function createChatbot(config) {
  const {
    KB, entryText, CONFIG, INTENTS, overrides,
    suggestions, welcomeMessage,
    onReady,
    botProfile
  } = config;

  const bar = document.getElementById('bar');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const form = document.getElementById('form');
  let extractor = null, entryEmb = [], intentEmb = {}, domainPrototypeEmbs = [];
  let ready = false, busy = false, upgradePromise = null, pendingUpgrade = null;
  // Session memory: replaces single `lastTopic` with full turn-based tracking
  const session = new SessionMemory(CONFIG?.SESSION?.maxHistory || 30);
  const fragEmbCache = new LRUCache(CONFIG?.CACHE?.MAX_SIZE || 500);
  const signalLayer = new SignalLayer();
  let bowVocab = null;

  // Query embedding memoization (gap fix): identical/near follow-ups skip re-embed.
  const queryEmbCache = new LRUCache(CONFIG?.CACHE?.QUERY_EMB_MAX || 64);

  async function embed(text) {
    const key = (text || '').trim().toLowerCase();
    if (key && queryEmbCache.has(key)) return queryEmbCache.get(key);
    let v;
    if (extractor) {
      const out = await extractor(text, { pooling: 'mean', normalize: true });
      v = Array.from(out.data);
    } else {
      v = bowVec(text, bowVocab);
    }
    if (key) queryEmbCache.set(key, v);
    return v;
  }

  async function embedCached(text) {
    if (fragEmbCache.get(text)) return fragEmbCache.get(text);
    const v = await embed(text);
    fragEmbCache.set(text, v);
    return v;
  }

  function commitUpgrade(next) {
    if (busy) { pendingUpgrade = next; return; }
    extractor = next.extractor;
    entryEmb = next.entries;
    intentEmb = next.intents;
    domainPrototypeEmbs = next.domain;
    queryEmbCache.clear();
    fragEmbCache.clear();
    pendingUpgrade = null;
    bar.style.width = '100%';
    setStatus('Ready · enhanced matching', true);
    _setLoadState('ready');
    const enhance = document.getElementById('enhance');
    if (enhance) { enhance.textContent = 'Enhanced matching on'; enhance.disabled = true; }
  }

  async function enhanceMatching() {
    if (upgradePromise) return upgradePromise;
    const button = document.getElementById('enhance');
    if (button) { button.disabled = true; button.textContent = 'Preparing enhanced matching…'; }
    upgradePromise = (async () => {
      try {
        _setLoadState('loading_transformer');
        setStatus('Ready · enhancing matching', true);
        const { pipeline, env } = await import('/assets/transformers/transformers.js');
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = '/assets/models/';
        env.backends.onnx.wasm.wasmPaths = '/assets/transformers/';
        // A single WASM thread avoids blob worker imports blocked by the site's
        // CSP, keeps memory bounded, and leaves CPU capacity for the page.
        env.backends.onnx.wasm.numThreads = 1;
        env.useBrowserCache = true;
        const nextExtractor = await pipeline('feature-extraction', CONFIG.EMBEDDING.model, {
          quantized: CONFIG.EMBEDDING.quantized,
          progress_callback: p => { if (p.status === 'progress' && p.total) bar.style.width = `${p.loaded / p.total * 100}%`; }
        });
        const encode = async text => Array.from((await nextExtractor(text, { pooling: 'mean', normalize: true })).data);
        const key = await embeddingKey(KB, entryText, INTENTS, CONFIG.EMBEDDING.model);
        let vectors = await readEmbeddings(key);
        if (!validEmbeddings(vectors, KB.length, INTENTS)) {
          _setLoadState('loading_embeddings');
          const entries = [];
          for (const e of KB) entries.push(await encode(entryText(e)));
          const intents = {};
          for (const [name, intent] of Object.entries(INTENTS)) {
            intents[name] = [];
            for (const text of intent.prototypes) intents[name].push(await encode(text));
          }
          vectors = { entries, intents };
          await writeEmbeddings(key, vectors);
        }
        const domain = [];
        for (const text of botProfile?.domainPrototypes || []) domain.push(await encode(text));
        commitUpgrade({ extractor: nextExtractor, ...vectors, domain });
      } catch (error) {
        console.warn('[chat] Enhanced matching unavailable:', error.message);
        setStatus('Ready · keyword matching', true);
        _setLoadState('partially_ready');
        upgradePromise = null;
        if (button) { button.disabled = false; button.textContent = 'Retry enhanced matching'; }
      }
    })();
    return upgradePromise;
  }

  function init() {
    const vocabulary = new Set();
    for (const entry of KB) for (const token of tokens(entryText(entry))) vocabulary.add(token);
    for (const intent of Object.values(INTENTS)) for (const text of intent.prototypes) for (const token of tokens(text)) vocabulary.add(token);
    bowVocab = new Map([...vocabulary].map((word, index) => [word, index]));
    entryEmb = KB.map(entry => bowVec(entryText(entry), bowVocab));
    for (const [name, intent] of Object.entries(INTENTS)) intentEmb[name] = intent.prototypes.map(text => bowVec(text, bowVocab));
    compileAliasRegex(KB);
    signalLayer.initBM25(KB);
    ready = true;
    sendBtn.disabled = false;
    _setLoadState('partially_ready');
    setStatus('Ready · keyword matching', true);
    document.getElementById('enhance')?.addEventListener('click', enhanceMatching);
    loadPolicyRuntime({ botProfile }).catch(error => console.warn('[chat] Using built-in policy:', error.message));
    if (onReady) onReady();
  }

  function addSources(answerElement, topics) {
    const sources = [...new Map((topics || []).flatMap(i => KB[i]?.sources || []).map(source => [source.url, source])).values()];
    if (sources.length) {
      const references = document.createElement('div');
      references.className = 'answer-sources';
      references.append('Read more: ');
      for (const source of sources.slice(0, 3)) {
        if (!/^https:\/\//.test(source.url)) continue;
        const link = document.createElement('a');
        link.href = source.url; link.textContent = source.title; link.target = '_blank'; link.rel = 'noopener noreferrer';
        references.append(link, ' ');
      }
      answerElement.querySelector('.msg-body').append(references);
    }
  }

  async function handle(query) {
    query = query.trim().slice(0, 2000);
    if (!query) return;
    pushMessage('user', md(escapeHTML(query)));
    busy = true;
    sendBtn.disabled = true;

    const typingEl = pushMessage('bot', '<div class="typing"><span></span><span></span><span></span></div>');
    let text, meta;
    const originalQuery = query;
    try {
      const message = interpretMessage(query);
      const conversational = conversationalReply(message, session, KB, botProfile);
      if (conversational) {
        typingEl.remove();
        const answerElement = pushMessage('bot', md(conversational.text));
        addSources(answerElement, conversational.topics);
        session.addTurn(originalQuery, conversational.text, [], conversational.topics, []);
        suggestionsEl?.classList.toggle('has-conversation', !conversational.showSuggestions);
        return;
      }
      query = message.query;
      const qEmb = await embed(query);

      // ---- Lightweight frontend ML signal layer — bundles BM25, entity extraction,
      //      intent classification, dense/sparse ensemble ranking, neural reranking,
      //      confidence calibration, and policy features into a DecisionPacket ----
      const signalConfig = { INTENTS, THRESHOLDS: CONFIG.THRESHOLDS, botProfile, _domainPrototypeEmbs: domainPrototypeEmbs.length > 0 ? domainPrototypeEmbs : intentEmb };
      const dp = await signalLayer.process(query, qEmb, entryEmb, intentEmb, KB, signalConfig, session);

      if (dp.isAmbiguous) {
        session.setAmbiguous(query);
      }

      // Policy-driven path (mandatory) — pass session-aware context from DecisionPacket
      const context = {
        entities: dp.entities,
        intent: dp.intent.name,
        intentScores: dp.intent.rawScores,
        ranked: dp.rankings.reranked,
        entryEmb,
        lastTopic: session.lastTopic,
        lastTopicAge: session.lastTopicAge,
        followUp: dp.session.followUp,
        wasPreviousAmbiguous: dp.session.wasAmbiguous,
        recentFragments: session.getRecentlyUsedFragments(),
        overrides,
      };
      const plan = await planAnswer(query, qEmb, KB, context, { EMBEDDING: CONFIG.EMBEDDING, botProfile, _domainPrototypeEmbs: domainPrototypeEmbs.length > 0 ? domainPrototypeEmbs : intentEmb });
      plan._recentlyUsedFragments = session.getRecentlyUsedFragments();
      // Budget classifier context — injected before composeV2 for local budget detection
      plan._followUpDepth = dp.session.followUp?.conversationDepth || 0;
      plan._topSim = dp.rankings.reranked?.[0]?.s || 0;

      // I1/I2: Wire composition seed for deterministic output
      if (botProfile?.id) {
        const seedHash = hash32(
          (botProfile.id || 'default') +
          (KB.length || 0) +
          query +
          (Array.isArray(plan.topics) ? plan.topics.join(',') : '') +
          (session._turnCount || 0) +
          (plan.answerBudget || 'auto')
        );
        setCompositionSeed(seedHash);
      }

      const result = await composeV2(query, qEmb, embedCached, entryEmb, intentEmb, session.lastTopic, KB, CONFIG, overrides, plan);

      text = result.text;
      meta = result.meta?.filter(item => !item.type);

      typingEl.remove();

      // The answer is already complete locally. Render once: no artificial delay,
      // incomplete HTML, repeated layout, or repeated live-region announcements.
      const answerElement = pushMessage('bot', md(text), meta);
      addSources(answerElement, result.topics || plan.topics || []);
      suggestionsEl?.classList.add('has-conversation');
      // W1: Render diagram if available
      if (result.diagramAst) {
        await renderDiagramElement(result.diagramAst, { theme: 'dark' });
      }

      // ---- Session: record turn and track fragment usage ----
      const presentedTopics = (plan && Array.isArray(plan.topics)) ? plan.topics : [];
      const fragmentsUsed = [];

      if (plan && plan.fragmentPlan) {
        for (const fp of plan.fragmentPlan) {
          const topicIdx = presentedTopics[fp.topicIdx];
          if (topicIdx !== undefined && KB[topicIdx]) {
            const entry = KB[topicIdx];
            for (const cat of (fp.cats || [])) {
              const fragId = `${entry.id}:${cat}`;
              fragmentsUsed.push(fragId);
              session.markFragmentUsed(fragId);
            }
          }
        }
      }

      session.addTurn(originalQuery, text, dp.entities, presentedTopics, fragmentsUsed, qEmb);
    } catch (err) {
      console.error(err);
      typingEl.remove();
      pushMessage('bot', 'Sorry, something went wrong processing that. Try again?');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      if (pendingUpgrade) commitUpgrade(pendingUpgrade);
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
    input.style.overflowY = input.scrollHeight > 120 ? 'auto' : 'hidden';
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
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

  document.getElementById('clear-chat')?.addEventListener('click', () => {
    if (busy) return;
    session.reset();
    document.getElementById('messages').replaceChildren();
    suggestionsEl?.classList.remove('has-conversation');
    if (welcomeMessage) pushMessage('bot', welcomeMessage);
    input.focus();
  });
  document.getElementById('export-chat')?.addEventListener('click', () => {
    const messages = [...document.querySelectorAll('#messages .msg')].map(el => el.innerText).join('\n\n');
    const url = URL.createObjectURL(new Blob([messages], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${botProfile.id}-conversation.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  sendBtn.disabled = true;
  init();
  const initialQuestion = new URLSearchParams(location.search).get('q');
  if (initialQuestion) { input.value = initialQuestion.slice(0, 2000); input.focus(); }

}
