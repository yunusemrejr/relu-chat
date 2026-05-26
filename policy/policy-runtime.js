/**
 * policy-runtime.js — ReLU.chat Policy Runtime (Multi-Engine)
 *
 * The main entry point for the policy decision engine.
 *
 * Responsibilities:
 *   1. Load and validate policy.manifest.json
 *   2. Try WASM (WebAssembly) instantiation and inference
 *   3. Try MLP (pure-JS MLP) via mlp-inference.js
 *   4. Expose planAnswer(query, features, KB, config) for nlp.js
 *   5. Fall back to planAnswerHeuristic() when neither engine is available
 *
 * Inference priority:  MLP (primary) → WASM (secondary) → Heuristic (last resort)
 *
 * Design Version:  2.0.0 (multi-engine)
 * Loading Sequence: init() → fetch manifest → try WASM → try MLP → ready=true
 * Fallback:         planAnswerHeuristic() if all engines fail
 */

import { extractPolicyFeatures, packFeatures } from './feature-extractor.js';
import { validatePlan, DEFAULT_PLAN } from './action-schema.js';
import { MLPPolicy } from './mlp-inference.js';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** @type {boolean} */
let ready = false;

/** @type {object|null} */
let cachedManifest = null;

/** @type {WebAssembly.Instance|null} */
let wasmInstance = null;

/** @type {ArrayBuffer|null} */
let wasmMemory = null;

/** @type {object|null} */
let activeConfig = null;

/** @type {string|null} */
let loadError = null;

/** @type {MLPPolicy|null} */
let mlpInstance = null;

/** @type {Promise<object>|null} */
let loadPromise = null;

// ---------------------------------------------------------------------------
// IndexedDB WASM module cache
// ---------------------------------------------------------------------------

const DB_NAME = 'relu-chat-models';
const DB_VERSION = 1;
const WASM_STORE = 'wasm-modules';

/**
 * Open the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
async function _openDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(WASM_STORE)) {
          db.createObjectStore(WASM_STORE, { keyPath: 'url' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Retrieve a cached WebAssembly.Module from IndexedDB.
 * @param {string} url - WASM file URL
 * @returns {Promise<WebAssembly.Module|null>}
 */
async function _getCachedWasmModule(url) {
  try {
    const db = await _openDB();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(WASM_STORE, 'readonly');
        const store = tx.objectStore(WASM_STORE);
        const req = store.get(url);
        req.onsuccess = (e) => {
          const entry = e.target.result;
          if (entry && entry.module instanceof WebAssembly.Module) {
            resolve(entry.module);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  } catch (e) {
    return null;
  }
}

/**
 * Cache a compiled WebAssembly.Module in IndexedDB.
 * @param {string} url  - WASM file URL
 * @param {WebAssembly.Module} module
 * @param {string} [hash] - optional integrity hash for verification
 * @returns {Promise<void>}
 */
async function _cacheWasmModule(url, module, hash) {
  try {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(WASM_STORE, 'readwrite');
        const store = tx.objectStore(WASM_STORE);
        store.put({ url, module, hash: hash || null, cachedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        reject(e);
      }
    });
  } catch (e) {
    // IDB caching is optional — silently skip on failure
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isPolicyLoaded() { return ready; }

export function getPolicyStatus() {
  return {
    ready,
    error: loadError,
    version: cachedManifest?.version || null,
    engine: mlpInstance ? 'mlp' : (wasmInstance ? 'wasm' : 'heuristic'),
  };
}

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
  activeConfig = config;

  const {
    wasmPath     = '/assets/models/policy/policy.wasm',
    weightsPath  = '/assets/models/policy/policy.weights.bin',
    manifestPath = '/assets/models/policy/policy.manifest.json',
    botProfile   = null,
    timeoutMs    = 4000,
    mlpWeightsPath = config.mlpWeightsPath || weightsPath.replace(/\.bin$/i, '.json'),
    onProgress   = null,
  } = config;

  const report = (stage) => { if (typeof onProgress === 'function') onProgress(stage); };

  // ---- Step 1: Start all fetches in parallel ----
  // Fetch manifest, WASM, weights, and MLP weights simultaneously.
  // Manifest is needed first for validation and hash verification,
  // but the actual downloads can overlap.
  report('manifest');

  const manifestPromise = fetchWithTimeout(manifestPath, timeoutMs).then(r => {
    if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
    return r.json();
  });

  // WASM and weights fetches start in parallel but their results are
  // consumed after manifest validation.
  const wasmResponsePromise = fetchWithTimeout(wasmPath, timeoutMs);
  const weightsResponsePromise = fetchWithTimeout(weightsPath, timeoutMs);

  // MLP weights fetch (small JSON) — no timeout needed.
  const mlpFetchPromise = fetch(mlpWeightsPath).then(r => {
    if (!r.ok) throw new Error(`MLP weights HTTP ${r.status}`);
    return r.json();
  }).catch(err => {
    // MLP fetch failure is non-fatal — will skip to heuristic
    console.warn('[policy-runtime] MLP weights fetch failed:', err.message);
    return null;
  });

  // ---- Step 2: Load and validate manifest (required) ----
  let manifest;
  try {
    manifest = await manifestPromise;
  } catch (err) {
    console.error('[policy-runtime] CRITICAL: Manifest load failed:', err.message);
    return _rejectResult(`Policy manifest load failed: ${err.message}. Please reload and clear browser cache.`);
  }

  const manifestErr = validateManifest(manifest);
  if (manifestErr) {
    console.error('[policy-runtime] CRITICAL: Manifest validation failed:', manifestErr);
    return _rejectResult(`Policy manifest invalid: ${manifestErr}. Please reload and clear browser cache.`);
  }
  cachedManifest = manifest;

  // ---- Step 3: Try WASM (non-fatal — controlled degradation) ----
  let wasmOk = false;
  const wasmLoadPromise = (async () => {
    if (typeof WebAssembly === 'undefined') {
      console.warn('[policy-runtime] WebAssembly not available — skipping WASM');
      return false;
    }
    try {
      report('wasm');

      // Check IndexedDB cache for pre-compiled module
      let module = null;
      try {
        module = await _getCachedWasmModule(wasmPath);
      } catch (e) { /* IDB unavailable */ }

      const importObject = _createImportObject();

      if (module) {
        // Fast path: instantiate from cached module (no fetch/compile)
        report('wasm-cache-hit');
        const result = await WebAssembly.instantiate(module, importObject);
        wasmInstance = result.instance;
      } else {
        // Normal path: fetch, verify hash, compile, instantiate
        report('wasm-fetch');
        const response = await wasmResponsePromise;
        if (!response.ok) throw new Error(`WASM fetch failed: HTTP ${response.status}`);

        // Verify WASM integrity against manifest hash before compiling
        if (manifest.wasmHash) {
          report('wasm-verify');
          const wasmBuffer = await response.clone().arrayBuffer();
          const hashParts = manifest.wasmHash.split('-');
          const expectedHash = hashParts[1];
          if (hashParts[0] === 'sha256' && expectedHash) {
            const actualHash = await _sha256Hex(wasmBuffer);
            if (actualHash !== expectedHash) {
              throw new Error(`WASM integrity mismatch: expected ${expectedHash.substring(0, 12)}..., got ${actualHash.substring(0, 12)}...`);
            }
            console.debug('[policy-runtime] WASM integrity verified');
          }

          report('wasm-compile');
          // Compile from buffer (already fetched for hash verification)
          const compiledModule = await WebAssembly.compile(wasmBuffer);
          const result = await WebAssembly.instantiate(compiledModule, importObject);
          wasmInstance = result.instance;

          // Cache the compiled module for faster subsequent loads (fire-and-forget)
          _cacheWasmModule(wasmPath, compiledModule, manifest.wasmHash).catch(() => {});
        } else {
          // No hash to verify — try streaming instantiation
          report('wasm-stream');

          // Check content type
          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('wasm') && !contentType.includes('octet-stream')) {
            console.warn(
              `[policy-runtime] unexpected Content-Type "${contentType}" for ${wasmPath} ` +
              `– attempting instantiation anyway`
            );
          }

          try {
            const result = await WebAssembly.instantiateStreaming(response, importObject);
            wasmInstance = result.instance;
            // Cache compiled module (fire-and-forget)
            if (result.module) {
              _cacheWasmModule(wasmPath, result.module, null).catch(() => {});
            }
          } catch (streamingErr) {
            console.debug('[policy-runtime] instantiateStreaming failed, trying buffered instantiation:', streamingErr.message);
            const buffer = await response.arrayBuffer();
            const result = await WebAssembly.instantiate(buffer, importObject);
            wasmInstance = result.instance;
            if (result.module) {
              _cacheWasmModule(wasmPath, result.module, null).catch(() => {});
            }
          }
        }
      }

      // Store memory reference
      if (wasmInstance.exports.memory) {
        wasmMemory = wasmInstance.exports.memory.buffer;
      } else if (importObject.env.memory) {
        wasmMemory = importObject.env.memory.buffer;
      }

      // ---- Load weights ----
      report('weights');
      const weightsResponse = await weightsResponsePromise;
      if (!weightsResponse.ok) throw new Error(`weights fetch failed: HTTP ${weightsResponse.status}`);

      const weightsBuffer = await weightsResponse.arrayBuffer();
      const expectedSize = manifest.weightsSize || weightsBuffer.byteLength;

      // Verify weights integrity against manifest hash
      if (manifest.weightsHash) {
        const actualHash = await _sha256Hex(weightsBuffer);
        const expectedHash = manifest.weightsHash;
        if (actualHash !== expectedHash) {
          throw new Error(`weights integrity mismatch: expected ${expectedHash.substring(0, 12)}..., got ${actualHash.substring(0, 12)}...`);
        }
        console.debug('[policy-runtime] weights integrity verified');
      }

      // Verify size matches manifest (fatal if smaller)
      if (weightsBuffer.byteLength < expectedSize) {
        throw new Error(
          `weights size mismatch: got ${weightsBuffer.byteLength}, ` +
          `expected >= ${expectedSize}`
        );
      }

      // Get the destination pointer from WASM
      let destPtr = 0;
      if (typeof wasmInstance.exports._getWeightsPtr === 'function') {
        destPtr = wasmInstance.exports._getWeightsPtr();
      }
      if (destPtr === 0 && typeof wasmInstance.exports.__heap_base !== 'undefined') {
        destPtr = wasmInstance.exports.__heap_base.value || 0;
      }

      // Copy weights into WASM linear memory
      const mem = (wasmInstance.exports.memory && wasmInstance.exports.memory.buffer) || wasmMemory;
      if (!mem) throw new Error('No WASM memory available for weights');

      const dest = new Uint8Array(mem, destPtr, weightsBuffer.byteLength);
      dest.set(new Uint8Array(weightsBuffer));
      console.debug(`[policy-runtime] Loaded ${weightsBuffer.byteLength} bytes of weights at offset ${destPtr}`);

      // ---- Call _initialize ----
      report('init');
      if (typeof wasmInstance.exports._initialize === 'function') {
        const botProfileJson = botProfile ? JSON.stringify(botProfile) : '{}';
        const { ptr, len } = _allocString(wasmInstance, botProfileJson);
        const manifestJson = JSON.stringify(manifest);
        const { ptr: mptr, len: mlen } = _allocString(wasmInstance, manifestJson);
        const result = wasmInstance.exports._initialize(ptr, len, mptr, mlen);
        if (result !== 0) {
          console.warn(`[policy-runtime] _initialize returned ${result} – may be degraded`);
        }
      } else {
        console.warn('[policy-runtime] _initialize export not found in WASM – module may be incomplete');
      }

      wasmOk = true;
      console.info(`[policy-runtime] WASM policy loaded. Version: ${manifest.version}`);
      return true;
    } catch (err) {
      console.warn('[policy-runtime] WASM failed, will try MLP:', err.message);
      wasmInstance = null;
      return false;
    }
  })();

  // ---- Step 4: Try MLP (parallel with WASM) ----
  report('mlp');

  const mlpLoadPromise = (async () => {
    try {
      const mlpWeights = await mlpFetchPromise;
      if (!mlpWeights) throw new Error('MLP weights not available');
      const weights = mlpWeights.weights || mlpWeights;
      mlpInstance = new MLPPolicy(weights);
      console.info(`[policy-runtime] MLP policy loaded (v${mlpInstance._version})`);
      return true;
    } catch (err) {
      console.warn('[policy-runtime] MLP failed:', err.message);
      mlpInstance = null;
      return false;
    }
  })();

  // ---- Step 5: Lazy initialization — don't block readiness on WASM if MLP is available ----
  // MLP is the primary engine (checked first in planAnswer) and loads fast
  // (just a JSON fetch). Return ready as soon as MLP succeeds; WASM continues
  // loading in background and is used as a secondary engine later.

  const mlpResult = await mlpLoadPromise;

  if (mlpResult) {
    console.info('[policy-runtime] MLP ready — returning early, WASM loading in background');
    // Fire-and-forget WASM completion (logs internally)
    wasmLoadPromise.then(wasmOk => {
      if (wasmOk) console.info('[policy-runtime] WASM also loaded (background)');
    }).catch(() => {});
    return _succeedResult();
  }

  // ---- MLP failed — wait for WASM ----
  wasmOk = await wasmLoadPromise;

  if (!wasmOk && !mlpInstance) {
    console.warn('[policy-runtime] Neither WASM nor MLP available — using heuristic fallback');
  }

  console.info(
    `[policy-runtime] Policy runtime ready. ` +
    `Engine: ${mlpInstance ? 'mlp' : (wasmOk ? 'wasm' : 'heuristic')}. ` +
    `Version: ${manifest.version}`
  );
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
        const hasStrongSignal =
          features.qSimTop1 > 0.3 ||
          features.entityCount > 0 ||
          features.qSimTop2 > 0.25;
        const hasReasonableIntent =
          features.intentDefScore > 0.2 ||
          features.intentExScore > 0.2 ||
          features.intentFormScore > 0.2 ||
          features.intentAppScore > 0.2 ||
          features.intentCompScore > 0.2;
        if (hasStrongSignal || hasReasonableIntent) {
          console.warn(
            '[policy-runtime] MLP mode-collapse suspected:',
            `mode=${plan.mode}, qSimTop1=${features.qSimTop1.toFixed(3)},`,
            `entityCount=${features.entityCount}, falling back to heuristic`
          );
          plan = null;
        }
      }
    } catch (err) {
      console.error('[policy-runtime] MLP inference failed:', err.message);
      plan = null;
    }
  }

  // ---- Tier 2: WASM (if loaded and MLP not available) ----
  if (!plan && wasmInstance) {
    try {
      plan = await _wasmPlanAnswer(wasmInstance, features, config);
      if (!plan.meta) plan.meta = {};
      plan.meta.policyVersion = cachedManifest?.version || 'unknown';
      plan.meta.policyHash = cachedManifest?.wasmHash || 'wasm';
    } catch (err) {
      console.error('[policy-runtime] WASM inference failed:', err.message);
      plan = null;
    }
  }

  // ---- Tier 3: Heuristic (last resort) ----
  if (!plan) {
    console.warn('[policy-runtime] Falling back to heuristic planAnswer');
    plan = planAnswerHeuristic(features, KB, config, context.overrides || {});
  }

  // ---- Post-processing: enrich topics when plan has no topics but ranked hits exist ----
  if (plan.topics.length === 0 && context.ranked && context.ranked.length > 0) {
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
    const INTENT_CAT_ORDERS = {
      definition: ['def', 'int', 'ex'],
      example: ['ex', 'int', 'def'],
      formal: ['form', 'def', 'ex'],
      application: ['app', 'ex', 'int'],
      comparison: ['def', 'int', 'ex'],
    };
    const catOrder = INTENT_CAT_ORDERS[plan.intent] || ['def', 'int', 'ex'];
    const fragsPerTopic = Math.min(2, catOrder.length);
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

  // 4. Validate before returning
  const { valid, errors, sanitized } = validatePlan(plan);
  if (!valid && errors.length > 0) {
    console.warn('[policy-runtime] Plan validation warnings:', errors);
  }

  // Log decision path for debugging
  if (sanitized.meta?.decisionPath?.length > 0) {
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
  const INTENT_ORDERS = {
    definition:  ['def', 'int', 'ex'],
    example:     ['ex', 'int', 'def'],
    formal:      ['form', 'def', 'ex'],
    application: ['app', 'ex', 'int'],
    comparison:  ['def', 'int', 'ex'],
  };
  const order = INTENT_ORDERS[intent] || ['def', 'int', 'ex'];

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

// ---------------------------------------------------------------------------
// WASM internals (private)
// ---------------------------------------------------------------------------

/**
 * Create the WASM import object.
 * Shared between cached and non-cached instantiation paths.
 * @returns {object} importObject for WebAssembly.instantiate
 */
function _createImportObject() {
  return {
    env: {
      memory: new WebAssembly.Memory({ initial: 16, maximum: 64 }),
      log: (ptr, len) => {
        if (wasmMemory) {
          const bytes = new Uint8Array(wasmMemory, ptr, len);
          const msg = new TextDecoder().decode(bytes);
          console.debug('[policy-wasm]', msg);
        }
      },
      readFeatureBuffer: (destPtr, srcPtr) => {
        // Implemented as a no-op in the stub; real WASM module manages this
        // via its own _planAnswer export that takes a Float32Array view.
      },
      abort: () => {
        console.error('[policy-wasm] abort() called – unrecoverable error');
      },
    },
  };
}

/**
 * WASM-based plan generation.
 *
 * Expects the WASM module to export _planAnswer(ptr, len) → ptr, len
 * where the input is the packed feature buffer and the output is a
 * JSON-encoded AnswerPlan string.
 *
 * @param {WebAssembly.Instance} instance
 * @param {object} features       - from extractPolicyFeatures()
 * @param {object} config
 * @returns {object}              - AnswerPlan
 */
async function _wasmPlanAnswer(instance, features, config) {
  const packed = packFeatures(features);

  // Copy the packed feature buffer into WASM memory
  const mem = instance.exports.memory?.buffer || wasmMemory;
  if (!mem) throw new Error('No WASM memory');

  const packedLen = packed.buffer.byteLength; // 76 bytes
  const inputPtr = _allocBuffer(instance, packedLen);
  const inputView = new Uint8Array(mem, inputPtr, packedLen);
  inputView.set(new Uint8Array(packed.buffer));

  // Call the WASM inference function
  if (typeof instance.exports._planAnswer !== 'function') {
    throw new Error('WASM module missing _planAnswer export');
  }

  // _planAnswer returns a pointer to the output JSON string + its length
  // We use a simple calling convention: return value encodes ptr in high 32,
  // len in low 32 (or we read from a known memory location).
  //
  // For the stub/heuristic phase, _planAnswer just returns 0, so we
  // catch that and fall back.
  const result = instance.exports._planAnswer(inputPtr, packedLen);

  if (result === 0) {
    throw new Error('_planAnswer returned 0 (no result)');
  }

  // Decode the output. Convention: result is a packed i64 where
  // high 32 bits = pointer, low 32 bits = length.
  // Since JS can't handle i64 natively, we use a helper.
  const { ptr, len } = _decodeReturnValue(result);

  const outputBytes = new Uint8Array(mem, ptr, len);
  const outputJson = new TextDecoder().decode(outputBytes);

  let parsed;
  try {
    parsed = JSON.parse(outputJson);
  } catch (parseErr) {
    console.error('[policy-runtime] WASM output is not valid JSON:', parseErr.message);
    throw new Error('WASM output parse failed');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('WASM output is not an object');
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Allocate a string in WASM memory and return its pointer + length.
 * Uses _malloc if available, otherwise a simple bump allocator.
 */
function _allocString(instance, str) {
  const encoded = new TextEncoder().encode(str);
  const ptr = _allocBuffer(instance, encoded.length);
  const mem = instance.exports.memory?.buffer || wasmMemory;
  if (mem) {
    new Uint8Array(mem, ptr, encoded.length).set(encoded);
  }
  return { ptr, len: encoded.length };
}

/**
 * Allocate a buffer in WASM memory.
 */
function _allocBuffer(instance, byteLength) {
  // Use _malloc export if available
  if (typeof instance.exports._malloc === 'function') {
    return instance.exports._malloc(byteLength);
  }
  // Otherwise, use a simple static offset (works for small, single-call buffers)
  // This is a best-effort fallback; real WASM modules export _malloc.
  return 1024; // start of heap in most emscripten builds
}

/**
 * Decode a return value that packs pointer (high 32) and length (low 32)
 * into a single number.  Works with JS numbers up to 2^53 safely.
 */
function _decodeReturnValue(result) {
  // If result fits in 32 bits, it's just a pointer (or 0)
  if (result <= 0xFFFFFFFF) {
    return { ptr: result, len: 0 };
  }
  // High 32 = ptr, low 32 = len
  const ptr = Math.floor(result / 0x100000000);
  const len = result & 0xFFFFFFFF;
  return { ptr, len };
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

/** Return the success result object. */
function _succeedResult() {
  ready = true;
  loadError = null;
  return {
    ready: true,
    planAnswer,
    manifest: cachedManifest,
    error: null,
  };
}

/** Return a rejection result (WASM mandatory but unavailable). */
function _rejectResult(errorMsg) {
  ready = false;
  wasmInstance = null;
  loadError = errorMsg;
  throw new Error(errorMsg);
}
