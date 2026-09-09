/** Shared policy: verified WASM or JavaScript MLP, with a built-in heuristic fallback. */

import { extractPolicyFeatures } from './feature-extractor.js';
import { validatePlan, DEFAULT_PLAN, INTENT_CAT_ORDERS } from './action-schema.js';
import { MLPPolicy } from './mlp-inference.js';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** @type {boolean} */
let ready = false;

/** @type {object|null} */
let cachedManifest = null;

/** @type {string|null} */
let loadError = null;

/** @type {MLPPolicy|null} */
let mlpInstance = null;

/** @type {Promise<object>|null} */
let loadPromise = null;

const EXPECTED_FEATURE_SCHEMA_VERSION = '0.5.0';

/**
 * Return the expected feature schema version for this runtime.
 * Training pipelines should produce manifests with a matching
 * featureSchemaVersion field.
 * @returns {string}
 */
export function getExpectedFeatureSchemaVersion() {
  return EXPECTED_FEATURE_SCHEMA_VERSION;
}

export function isPolicyLoaded() { return ready; }

export function getPolicyStatus() {
  return {
    ready,
    error: loadError,
    version: cachedManifest?.version || null,
    featureSchemaVersion: cachedManifest?.featureSchemaVersion || null,
    expectedFeatureSchemaVersion: EXPECTED_FEATURE_SCHEMA_VERSION,
    schemaMismatch: _schemaMismatch,
    engine: mlpInstance?._wasm ? 'wasm' : (mlpInstance ? 'mlp' : 'heuristic'),
  };
}

/** @type {boolean} */
let _schemaMismatch = false;

// ---------------------------------------------------------------------------
// Public API — loadPolicyRuntime
// ---------------------------------------------------------------------------

/**
 * Load and initialize the WASM policy runtime.
 *
 * This is called once during chatbot-engine.js:init(), after the embedding
 * model is ready.  It blocks until WASM is instantiated and weights are
 * loaded, or rejects after a configurable timeout (default 4s).
 *
 * @param {object} config
 * @param {string} [config.wasmPath]      - URL to policy.wasm (default: /assets/models/policy/policy.wasm)
 * @param {string} [config.weightsPath]   - URL to policy.weights.bin (default: /assets/models/policy/policy.weights.bin)
 * @param {string} [config.manifestPath]  - URL to policy.manifest.json (default: /assets/models/policy/policy.manifest.json)
 * @param {object} [config.botProfile]    - bot profile object (id, allowedIntents, tone, etc.)
 * @param {number} [config.timeoutMs]     - max wait time in ms (default: 4000)
 * @param {function} [config.onProgress]  - progress callback (stage: string) => void
 * @returns {Promise<{ ready: boolean, planAnswer: Function, manifest: object|null, error: string|null }>}
 */
export async function loadPolicyRuntime(config = {}) {
  // Deduplicate: if a load is already in progress, return the same promise
  if (loadPromise) return loadPromise;

  loadPromise = _doLoad(config);
  return loadPromise;
}

/** @internal */
async function _doLoad(config) {
  const base = '/assets/models/policy/';
  const manifestPath = config.manifestPath || base + 'policy.manifest.json';
  const weightsPath = config.mlpWeightsPath || base + 'policy.weights.json';
  const timeout = config.timeoutMs || 4000;
  try {
    // Attach rejection handlers immediately to both independent requests.
    const [manifestResponse, weightsResponse] = await Promise.all([
      fetchWithTimeout(manifestPath, timeout), fetchWithTimeout(weightsPath, timeout),
    ]);
    if (!manifestResponse.ok || !weightsResponse.ok) throw new Error('Policy assets unavailable');
    const manifest = await manifestResponse.json();
    const invalid = validateManifest(manifest);
    if (invalid) throw new Error(invalid);
    if (manifest.featureSchemaVersion !== EXPECTED_FEATURE_SCHEMA_VERSION) {
      _schemaMismatch = true; cachedManifest = manifest;
      return _succeedResult();
    }
    const weightsBytes = await weightsResponse.arrayBuffer();
    if (weightsBytes.byteLength !== manifest.weightsSize) throw new Error('Policy weights size mismatch');
    if (manifest.weightsHash && await _sha256Hex(weightsBytes) !== manifest.weightsHash) throw new Error('Policy weights hash mismatch');
    const payload = JSON.parse(new TextDecoder().decode(weightsBytes));
    const model = new MLPPolicy(payload.weights || payload);
    cachedManifest = manifest; mlpInstance = model;
    // JS is immediately ready; verified WASM enhances the same model in background.
    if (manifest.wasmAbi === 'relu-mlp-v1' && typeof WebAssembly !== 'undefined') {
      (async () => {
        const response = await fetchWithTimeout(config.wasmPath || base + 'policy.wasm', timeout);
        if (!response.ok) throw new Error('WASM unavailable');
        const bytes = await response.arrayBuffer();
        if (await _sha256Hex(bytes) !== manifest.wasmHash) throw new Error('WASM hash mismatch');
        await model.attachWasm(bytes);
      })().catch(error => console.warn('[policy] Using JavaScript inference:', error.message));
    }
  } catch (error) {
    console.warn('[policy] Using built-in fallback:', error.message);
  }
  return _succeedResult();
}

// ---------------------------------------------------------------------------
// Public API — planAnswer (the policy function)
// ---------------------------------------------------------------------------

/**
 * Generate an AnswerPlan from the current query context.
 *
 * Tries engines in priority order:
 *   1. MLP (pure-JS neural network) — primary
 *   2. WASM (WebAssembly) — secondary
 *   3. Heuristic (rule-based) — last resort
 *
 * Expected to be called from nlp.js in place of the current compose() logic.
 *
 * @param {string}   query        - raw user query
 * @param {number[]} qEmb         - query embedding
 * @param {object[]} KB           - knowledge base
 * @param {object}   context      - { ranked, entities, intentScores, lastTopic, lastTopicAge, overrides }
 * @param {object}   config       - { EMBEDDING, botProfile, _domainPrototypeEmbs }
 * @returns {Promise<object>}     - validated AnswerPlan
 */
export async function planAnswer(query, qEmb, KB, context = {}, config = {}) {
  // 1. Extract features
  const features = extractPolicyFeatures(
    query, qEmb,
    context.ranked || [],
    context.entities || [],
    context.intentScores || {},
    context.lastTopic ?? null,
    context.lastTopicAge ?? null,
    KB,
    config,
    context.entryEmb || null,
    context.followUp || null,
    context.wasPreviousAmbiguous || false
  );

  let plan = null;

  // ---- Tier 1: MLP (primary JS engine) ----
  if (mlpInstance) {
    try {
      plan = mlpInstance.planAnswer(
        features,
        context,
        config.botProfile || {},
        config.overrides || {}
      );
      if (!plan.meta) plan.meta = {};
      plan.meta.policyVersion = `mlp-v${mlpInstance._version}`;
      plan.meta.policyHash = 'mlp-js';

      // ---- Mode-collapse detection: if MLP returns greeting/off_topic
      //      despite strong matching signals, assume collapsed and fall back ----
      if (plan.mode === 'greeting' || plan.mode === 'off_topic') {
        if (features.entityCount > 0 && features.qSimTop1 > .25) {
          console.warn(
            '[policy-runtime] MLP mode-collapse suspected:',
            `mode=${plan.mode}, qSimTop1=${features.qSimTop1.toFixed(3)},`,
            `entityCount=${features.entityCount}, falling back to heuristic`
          );
          plan = null;
        }
      }

      // ---- Shadow compare (local-only, gap fix): detect silent heuristic vs MLP drift ----
      // Helps spot weight-load regressions or policy skew without any network.
      if (config.debug && plan && typeof planAnswerHeuristic === 'function') {
        try {
          const h = planAnswerHeuristic(features, /*KB*/ null, config, /*overrides*/ {});
          if (h && (h.mode !== plan.mode || JSON.stringify(h.topics || []) !== JSON.stringify(plan.topics || []))) {
            console.debug('[shadow] mlp vs heuristic differ', {
              mlp: { mode: plan.mode, topics: plan.topics },
              heur: { mode: h.mode, topics: h.topics }
            });
          }
        } catch (_) { /* non-fatal */ }
      }
    } catch (err) {
      console.error('[policy-runtime] MLP inference failed:', err.message);
      plan = null;
    }
  }

  // ---- Tier 3: Heuristic (last resort) ----
  if (!plan) {
    console.warn('[policy-runtime] Falling back to heuristic planAnswer');
    plan = planAnswerHeuristic(features, KB, config, context.overrides || {});
  }

  // ---- Post-processing: enrich topics when plan has no topics but ranked hits exist ----
  if (['normal', 'comparison'].includes(plan.mode) && plan.topics.length === 0 && context.ranked && context.ranked.length > 0) {
    const maxTopics = plan.guardrails?.maxTopics || 3;
    const minSim = plan.guardrails?.minSim || 0.15;
    const seen = new Set();
    for (const r of context.ranked) {
      if (seen.has(r.i)) continue;
      if (r.s < minSim) break;
      plan.topics.push(r.i);
      seen.add(r.i);
      if (plan.topics.length >= maxTopics) break;
    }
    if (plan.topics.length > 0) {
      plan.mode = 'normal';
      plan.intent = 'definition';
      if (plan.meta?.decisionPath) {
        plan.meta.decisionPath.push('mode:normal(enriched-from-ranked)');
      }
    }
    // Rebuild fragmentPlan to match the new topics
    const catOrder = INTENT_CAT_ORDERS[plan.intent] || ['def', 'int', 'ex'];
    const fragsPerTopic = Math.min(3, catOrder.length);  // Round 7: safe +1 fragment surfacing (was 2); still capped by policy+catOrder+botProfile
    plan.fragmentPlan = [];
    for (let ti = 0; ti < plan.topics.length; ti++) {
      const cats = (plan.intent === 'comparison' && ti > 0)
        ? [catOrder[0]]
        : catOrder.slice(0, fragsPerTopic);
      plan.fragmentPlan.push({ topicIdx: ti, cats: [...cats], fragIndices: cats.map(() => 0) });
    }
    // Rebuild template connectorKeys
    const connectorKeys = new Set();
    for (const fp of plan.fragmentPlan) {
      let prev = null;
      for (const cat of fp.cats) {
        if (prev) connectorKeys.add(`${prev}_to_${cat}`);
        prev = cat;
      }
    }
    plan.template.connectorKeys = [...connectorKeys];
    plan.guardrails.maxTopics = maxTopics;
  }

  // Explicit social commands have no knowledge topics. Never enrich them.
  if (context.intent === 'greeting' || context.intent === 'help') {
    plan.mode = context.intent;
    plan.topics = [];
    plan.fragmentPlan = [];
  }

  // 4. Validate before returning
  const { valid, errors, sanitized } = validatePlan(plan);
  if (!valid && errors.length > 0) {
    console.warn('[policy-runtime] Plan validation warnings:', errors);
  }

  // Log decision path for debugging
  if (config.debug && sanitized.meta?.decisionPath?.length > 0) {
    console.debug('[policy-runtime] decision:', sanitized.meta.decisionPath.join(' → '));
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// Heuristic fallback — mirrors current compose() decisions
// ---------------------------------------------------------------------------

/**
 * Pure-JS heuristic that translates the current hard-coded compose() logic
 * into an AnswerPlan.  Used when WASM is unavailable.
 *
 * This preserves existing behavior exactly, so the transition to WASM is
 * invisible to users.
 *
 * @param {object} features  - from extractPolicyFeatures()
 * @param {object[]} KB      - knowledge base
 * @param {object} config    - { botProfile, EMBEDDING, ... }
 * @param {object} overrides - bot-specific overrides (openers, connectors, etc.)
 * @returns {object}         - AnswerPlan
 */
export function planAnswerHeuristic(features, KB, config, overrides) {
  const decisionPath = ['heuristic'];

  // ---- Determine mode ----
  let mode = 'normal';

  // Greeting / help detection: very low sim + no entities
  if (features.entityCount === 0 && features.qSimTop1 < 0.25) {
    // Note: we don't have access to the raw query here for regex matching.
    // Greeting detection relies on feature signals: short query + no intent scores.
    // Caller can override mode by passing context.mode explicitly.
    if (features.entityCount === 0 && features.qSimTop1 < 0.15) {
      if (features.hasExampleCue || features.hasFormalCue) {
        // Has content cues but very low sim → off-topic, not greeting
        mode = 'off_topic';
        decisionPath.push('mode:off_topic(low-sim+content-cues)');
      }
      // Otherwise check if the intent scores are universally low
      const maxIntent = Math.max(
        features.intentDefScore, features.intentExScore,
        features.intentFormScore, features.intentAppScore, features.intentCompScore
      );
      if (maxIntent < 0.2 && features.queryLenTokens <= 4) {
        mode = 'greeting';
        decisionPath.push('mode:greeting(low-sim+short+no-intent)');
      } else if (maxIntent < 0.2) {
        mode = 'off_topic';
        decisionPath.push('mode:off_topic(low-sim+no-intent)');
      }
    }
  }

  // Help detection
  if (mode === 'normal' && features.entityCount === 0 && features.qSimTop1 < 0.25) {
    const helpPattern = /\b(help|menu|what can you|list|topics|commands)\b/i;
    // We use queryLenTokens as a weak signal; caller should set mode explicitly
    // for robust detection. Here we conservatively only switch to help if
    // ALL similarity signals are very weak.
    const allWeak = features.qSimTop1 < 0.12 && features.qSimTop2 < 0.10;
    if (allWeak && features.entityCount === 0) {
      mode = 'help';
      decisionPath.push('mode:help(all-weak+no-entity)');
    }
  }

  // ---- Determine intent ----
  let intent = 'definition';
  const intentScores = {
    definition:  features.intentDefScore,
    example:     features.intentExScore,
    formal:      features.intentFormScore,
    application: features.intentAppScore,
    comparison:  features.intentCompScore,
  };
  let bestScore = -1;
  for (const [k, v] of Object.entries(intentScores)) {
    if (v > bestScore) {
      bestScore = v;
      intent = k;
    }
  }
  decisionPath.push(`intent:${intent}(${bestScore.toFixed(3)})`);

  // Comparison intent requires ≥2 topics with decent sim
  if (intent === 'comparison' && features.qSimTop2 < 0.25) {
    // Not enough signal for a real comparison — fall back to definition
    const altIntents = ['definition', 'example', 'application', 'formal'];
    intent = altIntents.find(k => intentScores[k] > 0.2) || 'definition';
    decisionPath.push(`intent-fallback:${intent}(low-second-sim)`);
  }

  // ---- Determine topics ----
  const topics = [];
  const guardrails = {
    maxTopics: config?.botProfile?.maxTopics || 3,
    requireEntity: false,
    minSim: 0.15,
    allowOffTopic: mode === 'off_topic',
  };

  if (mode === 'greeting' || mode === 'help' || mode === 'off_topic') {
    // No topics for these modes
  } else {
    // Entity-boosted topic selection (mirrors compose() logic)
    // We don't have the actual ranked array here — the caller should
    // pass context.ranked in the features path. For the heuristic case,
    // we rely on features.qSimTop1/2 and entityCount.
    //
    // In practice, the wrapper planAnswer() passes context.ranked, and we
    // access it here via a closure-like pattern. For the standalone heuristic,
    // we use the feature scores as proxies.

    if (features.entityCount > 0) {
      decisionPath.push(`topics:entity-boosted(${features.entityCount} entities)`);
    } else if (features.qSimTop1 >= guardrails.minSim) {
      decisionPath.push(`topics:sim-ranked(${features.qSimTop1.toFixed(3)})`);
    }
  }

  // ---- Determine fragment plan ----
  const fragmentPlan = [];

  // Intent order (defaults from DEFAULT_INTENTS in nlp.js)
  const order = INTENT_CAT_ORDERS[intent] || ['def', 'int', 'ex'];

  // For comparison mode, first topic gets full order, second gets only first cat
  const numTopics = Math.max(topics.length, (mode === 'comparison' ? 2 : 0));
  for (let ti = 0; ti < numTopics; ti++) {
    const cats = (intent === 'comparison' && ti > 0) ? [order[0]] : order;
    fragmentPlan.push({
      topicIdx: ti,
      cats: [...cats],
      fragIndices: cats.map(() => 0), // default to fragment 0 (caller can refine)
    });
  }

  // ---- Determine template ----
  const template = {
    openerIdx: 0,
    closerIdx: 0,
    comparisonOpenerKey: 'none',
    connectorKeys: [],
  };

  if (intent === 'comparison' && numTopics >= 2) {
    // Randomly choose comparison opener (mirrors current behavior)
    const r = Math.random();
    template.comparisonOpenerKey = r < 0.33 ? 'similarity' : (r < 0.5 ? 'contrast' : 'both');
    decisionPath.push(`comparison-opener:${template.comparisonOpenerKey}`);
  }

  // Generate connector keys based on the fragment order
  for (let ti = 0; ti < fragmentPlan.length; ti++) {
    const cats = fragmentPlan[ti].cats;
    let prev = null;
    for (let ci = 0; ci < cats.length; ci++) {
      if (prev) {
        template.connectorKeys.push(`${prev}_to_${cats[ci]}`);
      }
      prev = cats[ci];
    }
  }
  // Deduplicate connector keys
  template.connectorKeys = [...new Set(template.connectorKeys)];

  // ---- Determine tone ----
  let tone = config?.botProfile?.tone || 'neutral';
  // Formal cues in query can override tone
  if (features.hasFormalCue && tone !== 'formal') {
    tone = 'formal';
    decisionPath.push('tone:formal(from-query-cues)');
  }

  // ---- Determine creativity ----
  const creativity = Math.min(
    config?.botProfile?.creativityCeiling || 0.5,
    features.botCreativity
  );

  // ---- Build the plan ----
  const plan = {
    ...DEFAULT_PLAN,
    mode,
    topics: [],          // caller fills in real KB indices
    intent,
    fragmentPlan,
    template,
    tone,
    creativity,
    guardrails,
    meta: {
      policyVersion: '0.1.0',
      policyHash: 'heuristic',
      decisionPath,
    },
  };

  return plan;
}

function _succeedResult() {
  ready = true;
  loadError = null;
  return {
    ready: true,
    planAnswer,
    manifest: cachedManifest,
    error: null,
    schemaMismatch: _schemaMismatch || false,
    schemaMismatchMessage: _schemaMismatch
      ? `Feature schema version mismatch: manifest says "${cachedManifest?.featureSchemaVersion || 'unknown'}", runtime expects "${EXPECTED_FEATURE_SCHEMA_VERSION}". Falling back to heuristic inference.`
      : null,
  };
}

/** Compute SHA-256 hex digest of an ArrayBuffer. */
async function _sha256Hex(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Fetch with timeout. */
async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Validate manifest has required fields. */
function validateManifest(m) {
  if (!m || typeof m !== 'object') return 'manifest is not an object';
  if (typeof m.version !== 'string') return 'manifest.version must be a string';
  if (typeof m.inputFeatures !== 'number' || m.inputFeatures !== 25) return 'manifest.inputFeatures must be 25';
  if (typeof m.weightsSize !== 'number') return 'manifest.weightsSize must be a number';
  if (!Array.isArray(m.botProfiles)) return 'manifest.botProfiles must be an array';
  return null;
}
