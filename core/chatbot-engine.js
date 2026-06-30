import { LRUCache } from './cache.js';
import { SessionMemory } from './session.js';
import { composeV2, setCompositionSeed, tokens, bowVec, compileAliasRegex } from './nlp.js';
import { pushMessage, pushMessageStream, setStatus, escapeHTML, md, renderDiagramElement } from './ui.js';
import { loadPolicyRuntime, planAnswer, isPolicyLoaded } from '../policy/policy-runtime.js';
import { SignalLayer } from './signal-layer.js';
import { BotPackLoader } from './bot-pack-loader.js';

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
  let ready = false, busy = false;
  // Session memory: replaces single `lastTopic` with full turn-based tracking
  const session = new SessionMemory(CONFIG?.SESSION?.maxHistory || 30);
  const fragEmbCache = new LRUCache(CONFIG?.CACHE?.MAX_SIZE || 500);
  const signalLayer = new SignalLayer();
  let bowVocab = null;

  // Query embedding memoization (gap fix): identical/near follow-ups skip re-embed.
  const queryEmbCache = new LRUCache(CONFIG?.CACHE?.QUERY_EMB_MAX || 64);

  async function embed(text) {
    const key = (text || '').trim().toLowerCase().slice(0, 240);
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

  async function init() {
    _setLoadState('loading_transformer');

    // ── Attempt bot-pack fast-path (Track B P1) ───────────────────────────
    let botPack = null;
    let botPackLoader = null;
    try {
      const botId = botProfile?.id || 'default';
      botPackLoader = new BotPackLoader(botId, '/data/bot-packs/');
      const available = await botPackLoader.probe();
      if (available) {
        console.log('[chatbot-engine] Bot-pack found, using fast-path loading');
        await botPackLoader.stage1_basic();
        await botPackLoader.stage2_sparse();
        botPack = botPackLoader.getData();
      }
    } catch (packErr) {
      console.warn('[chatbot-engine] Bot-pack probe failed, falling back:', packErr.message);
    }

    // ── Fast bootstrap: BOW + heuristic so first turns are usable immediately ──
    // Addresses "No lazy/progressive model loading — MiniLM blocks first interaction".
    // Heuristic + BOW (already built) handle queries while full transformer streams in
    // (aided by SW model pre-cache). Hot-swap to dense vectors when ready.
    const voc = new Set();
    for (const e of KB) for (const t of tokens(entryText(e))) voc.add(t);
    for (const k of Object.keys(INTENTS)) for (const p of INTENTS[k].prototypes) for (const t of tokens(p)) voc.add(t);
    bowVocab = new Map();
    [...voc].forEach((w, i) => bowVocab.set(w, i));
    entryEmb = KB.map(e => bowVec(entryText(e), bowVocab));
    for (const k of Object.keys(INTENTS)) intentEmb[k] = INTENTS[k].prototypes.map(p => bowVec(p, bowVocab));

    // Use precomputed BM25 from bot-pack if available, else build client-side
    if (botPack?.bm25) {
      try {
        signalLayer.initBM25FromIndex(botPack.bm25);
        console.log('[chatbot-engine] Using precomputed BM25 index from bot-pack');
      } catch (e) { console.warn('BM25 init (bot-pack) failed:', e); }
    } else {
      try { signalLayer.initBM25(KB); } catch (e) { console.warn('BM25 init (bootstrap) failed:', e); }
    }

    // Partial ready: enable UI + heuristic path right away (first turns use fast BOW+policy heuristic)
    _setLoadState('partially_ready');
    setStatus('basic (enhancing…)', true);
    sendBtn.disabled = false;
    ready = true; // allow handle(); embed() will use bow until extractor present
    if (onReady) onReady();

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
        const policyResult = await loadPolicyRuntime({
          wasmPath: '/assets/models/policy/policy.wasm',
          weightsPath: '/assets/models/policy/policy.weights.bin',
          manifestPath: '/assets/models/policy/policy.manifest.json',
          botProfile: policyBotProfile
        });
        // W8: Surface schema-mismatch to UI
        if (policyResult && policyResult.schemaMismatch) {
          console.warn('[chatbot-engine] Schema mismatch detected:', policyResult.schemaMismatchMessage);
          setStatus('schema mismatch — using heuristic', false);
        }
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
    let usedFallback = false;
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

      // ---- Hot-swap: re-encode KB with real dense embeddings (progressive upgrade) ----
      // Previous BOW entryEmb/intentEmb allow instant first turns; now replace in place.
      _setLoadState('loading_embeddings');
      setStatus('encoding knowledge base…');
      bar.style.width = '0%';
      compileAliasRegex(KB);

      // ── Bot-pack vector fast-path: use precomputed vectors if available ──
      let usedBotPackVectors = false;
      if (botPackLoader) {
        try {
          const vecData = await botPackLoader.stage3_vectors();
          const ev = vecData.entryVectors;
          const fv = vecData.fragmentVectors;
          // Check if vectors are real (not placeholder)
          if (ev && !ev._note && Array.isArray(ev.data || ev)) {
            entryEmb = ev.data || ev;
            usedBotPackVectors = true;
            console.log('[chatbot-engine] Using precomputed entry vectors from bot-pack');
          }
          if (fv && !fv._note) {
            // Fragment vectors loaded; store for potential use in signal layer
            botPackLoader._fragmentVectors = fv.data || fv;
          }
        } catch (vecErr) {
          console.warn('[chatbot-engine] Bot-pack vectors failed, encoding at runtime:', vecErr.message);
        }
      }

      if (!usedBotPackVectors) {
        const BATCH = 8;
        const newEntryEmb = [];
        for (let i = 0; i < KB.length; i += BATCH) {
          const batch = KB.slice(i, i + BATCH).map(e => embed(entryText(e)));
          newEntryEmb.push(...await Promise.all(batch));
          bar.style.width = (Math.min(i + BATCH, KB.length) / KB.length * 100) + '%';
        }
        entryEmb = newEntryEmb; // hot-swap
      } else {
        bar.style.width = '100%';
      }

      // Initialize (or re-init) BM25 sparse retrieval via SignalLayer (now with better text)
      if (!botPack?.bm25) {
        try { signalLayer.initBM25(KB); } catch (e) { console.warn('BM25 init failed:', e); }
      }

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
      usedFallback = true;
      // BOW already bootstrapped above; ensure signal
      if (!botPack?.bm25) {
        try { signalLayer.initBM25(KB); } catch (e) { console.warn('BM25 init failed in fallback:', e); }
      }
      setStatus('offline mode', true);
    }

    // ---- Wait for policy to finish ----
    if (!isPolicyLoaded()) {
      _setLoadState('loading_policy');
    }
    await policyPromise;

    // ---- Check readiness ----
    if (!isPolicyLoaded()) {
      _setLoadState('error');
      setStatus('policy error — please reload and clear browser cache', false);
      return; // block further — policy is mandatory
    }

    bar.style.width = '100%';
    setTimeout(() => bar.style.width = '0%', 500);
    if (!usedFallback) setStatus('ready', true);
    ready = true;
    _setLoadState('ready');
    // sendBtn already enabled from partial bootstrap
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
      meta = result.meta;

      typingEl.remove();

      // Stream-render: reveal response in progressive chunks for native chat feel
      // Respect prefers-reduced-motion: show full response instantly when set
      const stream = pushMessageStream('bot', meta);
      const rendered = md(text);
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) {
        stream.update(rendered);
        stream.done();
      } else {
        const CHUNK = 40;
        let pos = 0;
        const reveal = () => {
          if (pos < rendered.length) {
            pos = Math.min(pos + CHUNK, rendered.length);
            stream.update(rendered.slice(0, pos));
            if (pos < rendered.length) {
              requestAnimationFrame(reveal);
            } else {
              stream.done();
            }
          } else {
            stream.done();
          }
        };
        requestAnimationFrame(reveal);
      }

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

      session.addTurn(query, text, dp.entities, presentedTopics, fragmentsUsed, qEmb);
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
