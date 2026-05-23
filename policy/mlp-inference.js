/**
 * mlp-inference.js — ReLU.chat MLP Policy Inference Engine
 *
 * Pure-JavaScript MLP inference for the ReLU.chat policy model.
 * No external dependencies — direct array math on Float32.
 *
 * Architecture:  18 inputs → 64 hidden → 32 hidden → 6 action heads
 * Parameters:    4055 total (fc1: 1216, fc2: 2080, heads: 759)
 * Weights form:  PyTorch Linear convention — weight @ input.T + bias
 *
 * Design Version: 1.0.0 (mlp-inference)
 * Companion to:   policy-runtime.js, feature-extractor.js, action-schema.js
 */

// ---------------------------------------------------------------------------
// Label vocabularies — must match the training pipeline
// ---------------------------------------------------------------------------

const MODE_LABELS    = ['normal', 'off_topic', 'greeting', 'help', 'comparison'];
const INTENT_LABELS  = ['definition', 'example', 'formal', 'application', 'comparison'];
const TONE_LABELS    = ['neutral', 'formal', 'intuitive', 'playful'];
const COUNT_LABELS   = [1, 2, 3, 4];  // topic-count & frag-count both use [1,2,3,4]

// ---------------------------------------------------------------------------
// Intent → category-order mapping (mirrors nlp.js DEFAULT_INTENTS)
// ---------------------------------------------------------------------------

const INTENT_CAT_ORDERS = {
  definition:  ['def', 'int', 'ex'],
  example:     ['ex', 'int', 'def'],
  formal:      ['form', 'def', 'ex'],
  application: ['app', 'ex', 'int'],
  comparison:  ['def', 'int', 'ex'],
};

// ---------------------------------------------------------------------------
// Expected weight tensor shapes — validated at construction time
// ---------------------------------------------------------------------------

const WEIGHT_SHAPES = Object.freeze([
  ['fc1.weight',              [64, 18]],
  ['fc1.bias',                [64]],
  ['fc2.weight',              [32, 64]],
  ['fc2.bias',                [32]],
  ['mode_head.weight',        [5, 32]],
  ['mode_head.bias',          [5]],
  ['intent_head.weight',      [5, 32]],
  ['intent_head.bias',        [5]],
  ['topic_count_head.weight', [4, 32]],
  ['topic_count_head.bias',   [4]],
  ['frag_count_head.weight',  [4, 32]],
  ['frag_count_head.bias',    [4]],
  ['creativity_head.weight',  [1, 32]],
  ['creativity_head.bias',    [1]],
  ['tone_head.weight',        [4, 32]],
  ['tone_head.bias',          [4]],
]);

// ---------------------------------------------------------------------------
// Math helpers — simple loops, no allocations in hot path beyond result arrays
// ---------------------------------------------------------------------------

/**
 * Vector × weight-matrix multiply.
 *
 * Convention: vec ∈ R^{in}, wmat ∈ R^{out × in}
 * Returns:    Float32Array(out) where result[j] = Σ_i vec[i] * wmat[j][i]
 *
 * @param {Float32Array} vec  - input vector (length in_features)
 * @param {Array<Array<number>>} wmat - weight matrix [out_features][in_features]
 * @returns {Float32Array}    - output vector (length out_features)
 */
function matMul(vec, wmat) {
  const outF = wmat.length;
  const result = new Float32Array(outF);
  for (let j = 0; j < outF; j++) {
    const row = wmat[j];
    let sum = 0;
    // manual inner loop — JIT-friendly, no iterator overhead
    for (let i = 0; i < row.length; i++) {
      sum += vec[i] * row[i];
    }
    result[j] = sum;
  }
  return result;
}

/**
 * ReLU activation — element-wise max(0, x).
 *
 * @param {Float32Array} arr
 * @returns {Float32Array} new array (does not mutate input)
 */
function relu(arr) {
  const result = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    result[i] = arr[i] > 0 ? arr[i] : 0;
  }
  return result;
}

/**
 * Add bias vector in-place (mutates target).
 *
 * @param {Float32Array} target
 * @param {Array<number>} bias
 */
function addBiasInPlace(target, bias) {
  for (let i = 0; i < target.length; i++) {
    target[i] += bias[i];
  }
}

/**
 * Stable softmax: exp(x_i - max) / Σ exp(x_j - max).
 *
 * @param {Float32Array} logits
 * @returns {Float32Array} probabilities (sums to 1)
 */
function softmax(logits) {
  // Find max for numerical stability
  let maxVal = logits[0];
  for (let i = 1; i < logits.length; i++) {
    if (logits[i] > maxVal) maxVal = logits[i];
  }
  const result = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i] - maxVal);
    result[i] = e;
    sum += e;
  }
  const invSum = 1 / sum;
  for (let i = 0; i < logits.length; i++) {
    result[i] *= invSum;
  }
  return result;
}

/**
 * Sigmoid activation: 1 / (1 + exp(-x)).
 *
 * @param {number} x
 * @returns {number} in [0, 1]
 */
function sigmoid(x) {
  if (x >= 0) {
    // Numerically stable for positive x: 1 / (1 + exp(-x))
    return 1 / (1 + Math.exp(-x));
  }
  // For negative x: exp(x) / (1 + exp(x))
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * Argmax — index of the maximum value.
 *
 * @param {Float32Array|Array<number>} arr
 * @returns {number} index
 */
function argmax(arr) {
  let best = 0;
  let bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > bestVal) {
      best = i;
      bestVal = arr[i];
    }
  }
  return best;
}

/**
 * Clamp float to [0, 1] (force NaN → 0).
 */
function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

// ---------------------------------------------------------------------------
// Feature serialization — matches the Float32Array layout from packFeatures()
// ---------------------------------------------------------------------------

/**
 * Convert the feature object from extractPolicyFeatures() into the
 * Float32Array(18) that the MLP expects.
 *
 * Index layout (must match packFeatures() in feature-extractor.js):
 *   0:  qSimTop1         f32  [0,1]
 *   1:  qSimTop2         f32  [0,1]
 *   2:  entityCount      u8→f32 [0,3]
 *   3:  entityBoostHit   bool→f32 {0,1}
 *   4:  intentDefScore   f32  [0,1]
 *   5:  intentExScore    f32  [0,1]
 *   6:  intentFormScore  f32  [0,1]
 *   7:  intentAppScore   f32  [0,1]
 *   8:  intentCompScore  f32  [0,1]
 *   9:  lastTopicSim     f32  [0,1]
 *  10:  lastTopicAge     u8→f32 [0,8]
 *  11:  kbCoverage       f32  [0,1]
 *  12:  queryLenTokens   u8→f32 [1,32]
 *  13:  hasComparisonCue bool→f32 {0,1}
 *  14:  hasFormalCue     bool→f32 {0,1}
 *  15:  hasExampleCue    bool→f32 {0,1}
 *  16:  botCreativity    f32  [0,1]
 *  17:  domainMatch      f32  [0,1]
 *
 * @param {object} features - from extractPolicyFeatures() (frozen object)
 * @returns {Float32Array} - 18-element array
 */
function featuresToF32(features) {
  const f = new Float32Array(18);
  f[0]  = clamp01(features.qSimTop1);
  f[1]  = clamp01(features.qSimTop2);
  f[2]  = features.entityCount;
  f[3]  = features.entityBoostHit ? 1 : 0;
  f[4]  = clamp01(features.intentDefScore);
  f[5]  = clamp01(features.intentExScore);
  f[6]  = clamp01(features.intentFormScore);
  f[7]  = clamp01(features.intentAppScore);
  f[8]  = clamp01(features.intentCompScore);
  f[9]  = clamp01(features.lastTopicSim);
  f[10] = features.lastTopicAge;
  f[11] = clamp01(features.kbCoverage);
  f[12] = features.queryLenTokens;
  f[13] = features.hasComparisonCue ? 1 : 0;
  f[14] = features.hasFormalCue ? 1 : 0;
  f[15] = features.hasExampleCue ? 1 : 0;
  f[16] = clamp01(features.botCreativity);
  f[17] = clamp01(features.domainMatch);
  return f;
}

// ---------------------------------------------------------------------------
// MLPPolicy class
// ---------------------------------------------------------------------------

export class MLPPolicy {
  /**
   * Construct an MLP policy from a raw weights dictionary.
   * Validates all tensor shapes on construction.
   *
   * @param {object} weights - raw weights dict with keys matching WEIGHT_SHAPES
   */
  constructor(weights) {
    this._validate(weights);
    this.weights = weights;
    this._version = weights._version || 2;
  }

  /**
   * Load weights from a JSON endpoint and return a ready MLPPolicy.
   *
   * @param {string} weightsPath - URL to policy.weights.json
   * @returns {Promise<MLPPolicy>}
   */
  static async load(weightsPath) {
    const response = await fetch(weightsPath);
    if (!response.ok) {
      throw new Error(`MLPPolicy: HTTP ${response.status} fetching ${weightsPath}`);
    }
    const json = await response.json();
    const weights = json.weights || json;
    return new MLPPolicy(weights);
  }

  // -----------------------------------------------------------------------
  // Forward pass
  // -----------------------------------------------------------------------

  /**
   * Run the full MLP forward pass.
   *
   * Input:  Float32Array(18) — raw feature vector
   * Output: probability distributions over all action heads
   *
   * Graph:
   *   features [18]
   *     → fc1 (64, ReLU)
   *       → fc2 (32, ReLU)
   *         → mode_head       (5-softmax)   → modeProbs
   *         → intent_head     (5-softmax)   → intentProbs
   *         → topic_count_head (4-softmax)  → topicCountProbs
   *         → frag_count_head  (4-softmax)  → fragCountProbs
   *         → creativity_head  (1-sigmoid)  → creativity
   *         → tone_head        (4-softmax)  → toneProbs
   *
   * @param {Float32Array} features - 18-element feature vector
   * @returns {{
   *   modeProbs: Float32Array,       // [5] → ['normal','off_topic','greeting','help','comparison']
   *   intentProbs: Float32Array,     // [5] → ['definition','example','formal','application','comparison']
   *   topicCountProbs: Float32Array, // [4] → [1,2,3,4]
   *   fragCountProbs: Float32Array,  // [4] → [1,2,3,4]
   *   creativity: number,            // [0,1]
   *   toneProbs: Float32Array,       // [4] → ['neutral','formal','intuitive','playful']
   * }}
   */
  forward(features) {
    const w = this.weights;

    // ---- Layer 1: fc1 (64, ReLU) ----
    const z1 = matMul(features, w['fc1.weight']);
    addBiasInPlace(z1, w['fc1.bias']);
    const h1 = relu(z1);                                // [64]

    // ---- Layer 2: fc2 (32, ReLU) ----
    const z2 = matMul(h1, w['fc2.weight']);
    addBiasInPlace(z2, w['fc2.bias']);
    const h2 = relu(z2);                                // [32]

    // ---- Action heads (all share h2 as input) ----

    // Mode: 5-way classification
    const modeLogits = matMul(h2, w['mode_head.weight']);
    addBiasInPlace(modeLogits, w['mode_head.bias']);

    // Intent: 5-way classification
    const intentLogits = matMul(h2, w['intent_head.weight']);
    addBiasInPlace(intentLogits, w['intent_head.bias']);

    // Topic count: 4-way (1–4)
    const tcLogits = matMul(h2, w['topic_count_head.weight']);
    addBiasInPlace(tcLogits, w['topic_count_head.bias']);

    // Fragment count: 4-way (1–4)
    const fcLogits = matMul(h2, w['frag_count_head.weight']);
    addBiasInPlace(fcLogits, w['frag_count_head.bias']);

    // Creativity: scalar sigmoid
    const crLogits = matMul(h2, w['creativity_head.weight']);
    addBiasInPlace(crLogits, w['creativity_head.bias']);

    // Tone: 4-way classification
    const toneLogits = matMul(h2, w['tone_head.weight']);
    addBiasInPlace(toneLogits, w['tone_head.bias']);

    return {
      modeProbs:        softmax(modeLogits),
      intentProbs:      softmax(intentLogits),
      topicCountProbs:  softmax(tcLogits),
      fragCountProbs:   softmax(fcLogits),
      creativity:       sigmoid(crLogits[0]),
      toneProbs:        softmax(toneLogits),
    };
  }

  // -----------------------------------------------------------------------
  // AnswerPlan generation — converts probabilities into a full AnswerPlan
  // -----------------------------------------------------------------------

  /**
   * Generate an AnswerPlan from feature context, bot profile, and KB ranking.
   *
   * This is the primary entry point called from policy-runtime.js:planAnswer().
   *
   * @param {object} features   - from extractPolicyFeatures() (frozen object)
   * @param {object} context    - { ranked: Array<{i,s}>, entities: number[], ... }
   * @param {object} botProfile - bot profile config ({ id, allowedIntents, tone, creativityCeiling, maxTopics, ... })
   * @param {object} overrides  - bot-specific overrides (openers, closers, etc.) — unused by MLP but kept for API parity
   * @returns {object}          - AnswerPlan ready for validatePlan()
   */
  planAnswer(features, context = {}, botProfile = {}, overrides = {}) {
    const f32 = featuresToF32(features);
    const probs = this.forward(f32);
    const decisionPath = ['mlp'];

    // ---- Mode ----
    const modeIdx = argmax(probs.modeProbs);
    let mode = MODE_LABELS[modeIdx] || 'normal';
    decisionPath.push(`mode:${mode}(${probs.modeProbs[modeIdx].toFixed(3)})`);

    // ---- Intent ----
    const intentIdx = argmax(probs.intentProbs);
    let intent = INTENT_LABELS[intentIdx] || 'definition';
    decisionPath.push(`intent:${intent}(${probs.intentProbs[intentIdx].toFixed(3)})`);

    // Apply botProfile.allowedIntents constraint
    if (Array.isArray(botProfile.allowedIntents) && botProfile.allowedIntents.length > 0) {
      if (!botProfile.allowedIntents.includes(intent)) {
        // Pick the highest-probability intent that IS allowed
        let bestAllowed = botProfile.allowedIntents[0];
        let bestProb = -1;
        for (let i = 0; i < INTENT_LABELS.length; i++) {
          if (botProfile.allowedIntents.includes(INTENT_LABELS[i]) && probs.intentProbs[i] > bestProb) {
            bestProb = probs.intentProbs[i];
            bestAllowed = INTENT_LABELS[i];
          }
        }
        intent = bestAllowed;
        decisionPath.push(`intent:${intent}(constrained-by-profile)`);
      }
    }

    // ---- Topic count ----
    const tcIdx = argmax(probs.topicCountProbs);
    let topicCount = COUNT_LABELS[tcIdx] || 1;
    // Cap by botProfile.maxTopics
    const maxTopics = typeof botProfile.maxTopics === 'number' ? botProfile.maxTopics : 3;
    topicCount = Math.min(topicCount, maxTopics);
    // Special modes → no topics
    if (mode === 'greeting' || mode === 'help' || mode === 'off_topic') {
      topicCount = 0;
    }
    decisionPath.push(`topics:${topicCount}`);

    // ---- Fragment count per topic ----
    const fcIdx = argmax(probs.fragCountProbs);
    let fragsPerTopic = COUNT_LABELS[fcIdx] || 1;
    decisionPath.push(`frags:${fragsPerTopic}`);

    // ---- Tone ----
    let toneIdx = argmax(probs.toneProbs);
    let tone = TONE_LABELS[toneIdx] || 'neutral';
    // Bot profile can force tone
    if (botProfile.tone && TONE_LABELS.includes(botProfile.tone)) {
      tone = botProfile.tone;
      decisionPath.push('tone:forced-by-profile');
    }
    decisionPath.push(`tone:${tone}`);

    // ---- Creativity ----
    let creativity = probs.creativity;
    const ceiling = botProfile.creativityCeiling;
    if (typeof ceiling === 'number') {
      creativity = Math.min(creativity, ceiling);
    }
    creativity = clamp01(creativity);
    decisionPath.push(`creativity:${creativity.toFixed(3)}`);

    // ---- Build topics array from ranked KB entries ----
    const topics = [];
    const ranked = context.ranked || [];
    if (topicCount > 0 && ranked.length > 0) {
      const seen = new Set();
      for (let i = 0; i < ranked.length && topics.length < topicCount; i++) {
        const idx = ranked[i].i;
        if (!seen.has(idx)) {
          topics.push(idx);
          seen.add(idx);
        }
      }
    }

    // ---- Build fragment plan ----
    const catOrder = INTENT_CAT_ORDERS[intent] || ['def', 'int', 'ex'];
    const catsPerTopic = Math.min(fragsPerTopic, catOrder.length);
    const fragmentPlan = [];

    for (let ti = 0; ti < topics.length; ti++) {
      // Comparison mode: first topic gets full order, rest get first category only
      const cats = (intent === 'comparison' && ti > 0)
        ? [catOrder[0]]
        : catOrder.slice(0, catsPerTopic);
      fragmentPlan.push({
        topicIdx: ti,
        cats: [...cats],
        fragIndices: cats.map(() => 0), // default to first fragment; renderer can refine
      });
    }

    // ---- Build template ----
    const connectorKeys = [];
    for (const fp of fragmentPlan) {
      let prev = null;
      for (const cat of fp.cats) {
        if (prev) connectorKeys.push(`${prev}_to_${cat}`);
        prev = cat;
      }
    }

    // Stochastic comparison opener (seeded by creativity — deterministic argmax, no Math.random)
    // For non-comparison modes, 'none' is always correct.
    const comparisonOpenerKey = (mode === 'comparison' && topics.length >= 2)
      ? 'both'   // default; renderer can override
      : 'none';

    const template = {
      openerIdx: 0,
      closerIdx: 0,
      comparisonOpenerKey,
      connectorKeys: [...new Set(connectorKeys)],
    };

    // ---- Build guardrails ----
    const guardrails = {
      maxTopics: topicCount > 0 ? maxTopics : 0,
      requireEntity: false,
      minSim: 0.15,
      allowOffTopic: mode === 'off_topic',
    };

    // ---- Assemble final plan ----
    return {
      mode,
      topics,
      intent,
      fragmentPlan,
      template,
      tone,
      creativity,
      guardrails,
      clarification: null,
      meta: {
        policyVersion: `mlp-v${this._version}`,
        policyHash: 'mlp-js',
        decisionPath,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  /**
   * Validate all weight tensors have the expected shapes.
   * Throws on first mismatch — fail-fast at construction time.
   *
   * @param {object} w - raw weights dictionary
   */
  _validate(w) {
    for (const [key, shape] of WEIGHT_SHAPES) {
      const tensor = w[key];
      if (!tensor) {
        throw new Error(`MLPPolicy: missing weight key "${key}"`);
      }
      if (!Array.isArray(tensor)) {
        throw new Error(`MLPPolicy: "${key}" must be an array, got ${typeof tensor}`);
      }

      if (shape.length === 1) {
        // Bias vector
        if (tensor.length !== shape[0]) {
          throw new Error(
            `MLPPolicy: "${key}" expected length ${shape[0]}, got ${tensor.length}`
          );
        }
      } else {
        // Weight matrix: shape = [out_features, in_features]
        if (tensor.length !== shape[0]) {
          throw new Error(
            `MLPPolicy: "${key}" expected ${shape[0]} rows, got ${tensor.length}`
          );
        }
        for (let i = 0; i < tensor.length; i++) {
          const row = tensor[i];
          if (!Array.isArray(row) || row.length !== shape[1]) {
            throw new Error(
              `MLPPolicy: "${key}" row ${i} expected length ${shape[1]}, ` +
              `got ${Array.isArray(row) ? row.length : typeof row}`
            );
          }
        }
      }
    }
  }
}
