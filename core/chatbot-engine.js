import { LRUCache } from './cache.js';
import { SessionMemory } from './session.js';
import { composeV2, tokens, bowVec, compileAliasRegex } from './nlp.js';
import { pushMessage, setStatus, escapeHTML, md } from './ui.js';
import { loadPolicyRuntime, planAnswer, isPolicyLoaded } from '../policy/policy-runtime.js';
import { SignalLayer } from './signal-layer.js';

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
  let ready = false, busy = false;
  // Session memory: replaces single `lastTopic` with full turn-based tracking
  const session = new SessionMemory(CONFIG?.SESSION?.maxHistory || 20);
  const fragEmbCache = new LRUCache(CONFIG?.CACHE?.MAX_SIZE || 500);
  const signalLayer = new SignalLayer();
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
    _setLoadState('loading_transformer');

    // ---- Parallel initialization: start policy loading while transformer loads ----
    const policyPromise = (async () => {
      try {
        const policyBotProfile = botProfile || {
          id: 'default',
          allowedIntents: Object.keys(INTENTS),
          tone: 'neutral',
          maxTopics: 3,
          creativityCeiling: 0.35
        };
        await loadPolicyRuntime({
          wasmPath: '/assets/models/policy/policy.wasm',
          weightsPath: '/assets/models/policy/policy.weights.bin',
          manifestPath: '/assets/models/policy/policy.manifest.json',
          botProfile: policyBotProfile
        });
      } catch (policyErr) {
        console.error('[chatbot-engine] Policy load failed:', policyErr.message);
      }
    })();

    // ---- Deferred import: transformers.js only loaded when init() runs ----
    const { pipeline, env } = await import('/assets/transformers/transformers.js');
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = '/assets/models';
    env.backends.onnx.wasm.wasmPaths = '/assets/transformers/';
    env.useBrowserCache = true;

    // ---- Load transformer model while policy loads in background ----
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

      // ---- Pre-warm embeddings: start encoding as soon as transformer is ready ----
      // Don't wait for policy — this saves significant time on subsequent loads
      // since the KB embedding is the heaviest computation.
      _setLoadState('loading_embeddings');
      setStatus('encoding knowledge base…');
      bar.style.width = '0%';
      compileAliasRegex(KB);
      const BATCH = 8;
      for (let i = 0; i < KB.length; i += BATCH) {
        const batch = KB.slice(i, i + BATCH).map(e => embed(entryText(e)));
        entryEmb.push(...await Promise.all(batch));
        bar.style.width = (Math.min(i + BATCH, KB.length) / KB.length * 100) + '%';
      }
      // Initialize BM25 sparse retrieval via SignalLayer
      try { signalLayer.initBM25(KB); } catch (e) { console.warn('BM25 init failed:', e); }

      for (const k of Object.keys(INTENTS)) {
        intentEmb[k] = [];
        for (const p of INTENTS[k].prototypes) intentEmb[k].push(await embed(p));
      }

      // Pre-embed domain prototypes for domainMatch feature
      if (botProfile?.domainPrototypes && botProfile.domainPrototypes.length > 0) {
        for (const dp of botProfile.domainPrototypes) {
          domainPrototypeEmbs.push(await embed(dp));
        }
      }
    } catch (err) {
      console.error('Model load failed, using BOW fallback:', err);
      const voc = new Set();
      for (const e of KB) for (const t of tokens(entryText(e))) voc.add(t);
      for (const k of Object.keys(INTENTS)) for (const p of INTENTS[k].prototypes) for (const t of tokens(p)) voc.add(t);
      try { signalLayer.initBM25(KB); } catch (e) { console.warn('BM25 init failed in fallback:', e); }
      bowVocab = new Map();
      [...voc].forEach((w, i) => bowVocab.set(w, i));
      entryEmb = KB.map(e => bowVec(entryText(e), bowVocab));
      for (const k of Object.keys(INTENTS)) intentEmb[k] = INTENTS[k].prototypes.map(p => bowVec(p, bowVocab));
      setStatus('offline mode', true);
    }

    // ---- Wait for policy to finish ----
    // At this point, embeddings are already computed (saved time).
    // We just need policy for the planAnswer function.
    // Update state if policy is still loading (may already be done if it finished fast)
    if (!isPolicyLoaded()) {
      _setLoadState('loading_policy');
    }
    await policyPromise;

    // ---- Check readiness ----
    if (!isPolicyLoaded()) {
      _setLoadState('error');
      setStatus('policy error — please reload and clear browser cache', false);
      return; // block readiness — policy is mandatory
    }

    bar.style.width = '100%';
    setTimeout(() => bar.style.width = '0%', 500);
    setStatus('ready', true);
    ready = true;
    _setLoadState('ready');
    sendBtn.disabled = false;
    if (onReady) onReady();
  }

  async function handle(query) {
    if (!query.trim()) return;
    pushMessage('user', md(escapeHTML(query)));
    busy = true;
    sendBtn.disabled = true;

    const typingEl = pushMessage('bot', '<div class="typing"><span></span><span></span><span></span></div>');
    let text, meta;
    try {
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
      const result = await composeV2(query, qEmb, embedCached, entryEmb, intentEmb, session.lastTopic, KB, CONFIG, overrides, plan);

      text = result.text;
      meta = result.meta;

      typingEl.remove();
      pushMessage('bot', md(text), meta);

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

      session.addTurn(query, text, dp.entities, presentedTopics, fragmentsUsed);
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
