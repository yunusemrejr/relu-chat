import { pipeline, env } from '/assets/transformers/transformers.js';
import { LRUCache } from './cache.js';
import { SessionMemory } from './session.js';
import { composeV2, tokens, bowVec, compileAliasRegex, extractEntities, classifyIntent, rankEntries } from './nlp.js';
import { pushMessage, setStatus, escapeHTML, md } from './ui.js';
import { loadPolicyRuntime, planAnswer, isPolicyLoaded } from '../policy/policy-runtime.js';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '/assets/models';
env.backends.onnx.wasm.wasmPaths = '/assets/transformers/';
env.useBrowserCache = true;

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
      bowVocab = new Map();
      [...voc].forEach((w, i) => bowVocab.set(w, i));
      entryEmb = KB.map(e => bowVec(entryText(e), bowVocab));
      for (const k of Object.keys(INTENTS)) intentEmb[k] = INTENTS[k].prototypes.map(p => bowVec(p, bowVocab));
      setStatus('offline mode', true);
    }

    // Load policy runtime (blocks readiness — mandatory)
    setStatus('loading policy…');
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
      console.error('Policy load failed:', policyErr.message);
      setStatus('policy error — please reload and clear browser cache', false);
      return; // block readiness — policy is mandatory
    }

    if (!isPolicyLoaded()) {
      setStatus('policy not ready — please reload', false);
      return;
    }

    bar.style.width = '100%';
    setTimeout(() => bar.style.width = '0%', 500);
    setStatus('ready', true);
    ready = true;
    sendBtn.disabled = false;
    if (onReady) onReady();
  }

  async function handle(query) {
    if (!query.trim()) return;
    pushMessage('user', md(escapeHTML(query)));
    busy = true;
    sendBtn.disabled = true;

    // ---- Session: detect follow-up before any pipeline work ----
    const followUpContext = session.getFollowUpContext(query);

    const typingEl = pushMessage('bot', '<div class="typing"><span></span><span></span><span></span></div>');
    let text, meta;
    try {
      const qEmb = await embed(query);

      // Pre-policy pipeline: extract entities and classify intent
      compileAliasRegex(KB);
      let entities = extractEntities(query, KB);

      // ---- Session: enrich entities with recent conversation context ----
      const recentEntities = session.getRecentEntities();
      if (recentEntities.length > 0) {
        const entitySet = new Set(entities);
        for (const re of recentEntities) {
          if (!entitySet.has(re)) {
            entities.push(re);
            entitySet.add(re);
          }
        }
      }

      const { intent, scores: intentScores } = await classifyIntent(qEmb, intentEmb, INTENTS, CONFIG.THRESHOLDS);
      const ranked = rankEntries(qEmb, entryEmb);

      // ---- Session: ambiguity detection ----
      // Ambiguous when: multiple entities with no clear best, very short
      // query with low similarity, or multiple unrelated high-sim topics
      const queryTokens = tokens(query);
      const isShortQuery = queryTokens.length < 3;
      const hasMultipleEntities = entities.length > 1;
      const lowConfidence = ranked.length === 0 || ranked[0].s < 0.25;
      // Check if top-2 scores are close (within 0.1) — multiple viable interpretations
      const scoresClose = ranked.length >= 2 && Math.abs(ranked[0].s - ranked[1].s) < 0.1;

      const isAmbiguous =
        (hasMultipleEntities && scoresClose) ||
        (isShortQuery && lowConfidence) ||
        (scoresClose && ranked[0].s > 0.15 && ranked[0].s < 0.35);

      if (isAmbiguous) {
        session.setAmbiguous(query);
      }

      // Policy-driven path (mandatory) — pass session-aware context
      const context = {
        entities,
        intent,
        intentScores,
        ranked,
        entryEmb,
        lastTopic: session.lastTopic,
        lastTopicAge: session.lastTopicAge,
        followUp: followUpContext,
        wasPreviousAmbiguous: session.wasPreviousQueryAmbiguous(),
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

      session.addTurn(query, text, entities, presentedTopics, fragmentsUsed);
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
