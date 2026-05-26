/**
 * mlp-inference.js — ReLU.chat MLP Policy Inference Engine
 *
 * Pure-JavaScript MLP inference for the ReLU.chat policy model.
 * No external dependencies — direct array math on Float32.
 *
 * Architecture:  25 inputs → 128 hidden → 64 hidden → 6 action heads
 * Parameters:    ~4.5K total (fc1: 3.2K, fc2: 8.3K, heads: 1.6K)
 * Weights form:  PyTorch Linear convention — weight @ input.T + bias
 *
 * Design Version: 2.0.0 (mlp-inference) — adds quantized path, buffer reuse
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
  ['fc1.weight',              [128, 25]],
  ['fc1.bias',                [128]],
  ['fc2.weight',              [64, 128]],
  ['fc2.bias',                [64]],
  ['mode_head.weight',        [5, 64]],
  ['mode_head.bias',          [5]],
  ['intent_head.weight',      [5, 64]],
  ['intent_head.bias',        [5]],
  ['topic_count_head.weight', [4, 64]],
  ['topic_count_head.bias',   [4]],
  ['frag_count_head.weight',  [4, 64]],
  ['frag_count_head.bias',    [4]],
  ['creativity_head.weight',  [1, 64]],
  ['creativity_head.bias',    [1]],
  ['tone_head.weight',        [4, 64]],
  ['tone_head.bias',          [4]],
]);

// ---------------------------------------------------------------------------
// Math helpers — simple loops, no allocations in hot path beyond result arrays
// ---------------------------------------------------------------------------

/**
 * Vector × weight-matrix multiply.
 *
 * Convention: vec ∈ R^{in}, wmat ∈ R^{out × in}
 * If `target` is provided, writes into it (in-place) and returns it.
 * Otherwise allocates and returns a new Float32Array(out).
 *
 * @param {Float32Array} vec  - input vector (length in_features)
 * @param {Array<Array<number>>} wmat - weight matrix [out_features][in_features]
 * @param {Float32Array} [target] - optional pre-allocated output buffer
 * @returns {Float32Array}    - output vector (length out_features)
 */
function matMul(vec, wmat, target) {
  const outF = wmat.length;
  const result = target || new Float32Array(outF);
  for (let j = 0; j < outF; j++) {
    const row = wmat[j];
    let sum = 0;
    for (let i = 0; i < row.length; i++) {
      sum += vec[i] * row[i];
    }
    result[j] = sum;
  }
  return result;
}

/**
 * Int8 vector × weight-matrix multiply (quantized path).
 * Uses Int32Array for accumulation to avoid overflow.
 *
 * @param {Int8Array|Float32Array} vec - input vector (length in_features)
 * @param {Int8Array} wmat - quantized weight matrix [out_features][in_features] as flat Int8Array
 * @param {number} outF - number of output features
 * @param {number} inF  - number of input features
 * @param {Float32Array} [target] - optional pre-allocated output buffer
 * @returns {Float32Array} - output vector (length out_features)
 */
function matMulInt8(vec, wmat, outF, inF, target) {
  const result = target || new Float32Array(outF);
  let offset = 0;
  for (let j = 0; j < outF; j++) {
    let sum = 0;
    for (let i = 0; i < inF; i++) {
      sum += vec[i] * wmat[offset++];
    }
    result[j] = sum;
  }
  return result;
}

/**
 * ReLU activation — element-wise max(0, x).
 * If `target` is provided, writes into it (in-place) and returns it.
 * Otherwise allocates and returns a new Float32Array.
 *
 * @param {Float32Array} arr
 * @param {Float32Array} [target] - optional pre-allocated output buffer
 * @returns {Float32Array}
 */
function relu(arr, target) {
  const result = target || new Float32Array(arr.length);
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
 * Float32Array(25) that the MLP expects.
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
 *  18:  followUpType     u8→f32 [0,19]
 *  19:  wasAmbiguous     bool→f32 {0,1}
 *  20:  avgTruthConf     f32  [0,1]
 *  21:  avgSourceConf    f32  [0,1]
 *  22:  minDifficulty    u8→f32 [0,4]
 *  23:  fragDiversity    u8→f32 [0,5]
 *  24:  avoidWithCount   f32  [0,1]
 *
 * @param {object} features - from extractPolicyFeatures() (frozen object)
 * @returns {Float32Array} - 25-element array
 */
function featuresToF32(features, version = 2) {
  const f = new Float32Array(25);
  f[0]  = clamp01(features.qSimTop1);
  f[1]  = clamp01(features.qSimTop2);
  // Version >= 2 expects normalized discrete features
  if (version >= 2) {
    f[2]  = features.entityCount / 3;
    f[10] = features.lastTopicAge / 8;
    f[12] = features.queryLenTokens > 1 ? (features.queryLenTokens - 1) / 31 : 0;
  } else {
    f[2]  = features.entityCount;
    f[10] = features.lastTopicAge;
    f[12] = features.queryLenTokens;
  }
  f[3]  = features.entityBoostHit ? 1 : 0;
  f[4]  = clamp01(features.intentDefScore);
  f[5]  = clamp01(features.intentExScore);
  f[6]  = clamp01(features.intentFormScore);
  f[7]  = clamp01(features.intentAppScore);
  f[8]  = clamp01(features.intentCompScore);
  f[9]  = clamp01(features.lastTopicSim);
  f[11] = clamp01(features.kbCoverage);
  f[13] = features.hasComparisonCue ? 1 : 0;
  f[14] = features.hasFormalCue ? 1 : 0;
  f[15] = features.hasExampleCue ? 1 : 0;
  f[16] = clamp01(features.botCreativity);
  f[17] = clamp01(features.domainMatch);
  f[18] = features.followUpType;
  f[19] = features.wasAmbiguous ? 1 : 0;
  f[20] = clamp01(features.avgTruthConf);
  f[21] = clamp01(features.avgSourceConf);
  f[22] = features.minDifficulty / 4;  // normalize [0,4] -> [0,1]
  f[23] = features.fragDiversity / 5;  // normalize [0,5] -> [0,1]
  f[24] = clamp01(features.avoidWithCount);
  return f;
}

// ---------------------------------------------------------------------------
// MLPPolicy class
// ---------------------------------------------------------------------------

// Pre-defined buffer sizes (immutable)
const BUFFER_SIZES = Object.freeze({
  z1: 128,
  h1: 128,
  z2: 64,
  h2: 64,
  headMax: 5,   // mode & intent heads
  head4: 4,     // topic_count, frag_count, tone heads
  head1: 1,     // creativity head
});

// Pre-defined head buffer keys for iteration
const HEAD_BUFFER_KEYS = Object.freeze([
  'mode',        // 5
  'intent',      // 5
  'topic_count', // 4
  'frag_count',  // 4
  'creativity',  // 1
  'tone',        // 4
]);
const HEAD_SIZES = Object.freeze([5, 5, 4, 4, 1, 4]);

export class MLPPolicy {
  /**
   * Construct an MLP policy from a raw weights dictionary.
   * Validates all tensor shapes on construction.
   * Pre-allocates reusable Float32Arrays for the forward pass.
   *
   * @param {object} weights - raw weights dict with keys matching WEIGHT_SHAPES
   */
  constructor(weights) {
    this._validate(weights);
    this.weights = weights;
    this._version = weights._version || 2;

    // --- Pre-allocated buffers for buffer-reuse forward pass ---
    this._z1 = new Float32Array(BUFFER_SIZES.z1);
    this._h1 = new Float32Array(BUFFER_SIZES.h1);
    this._z2 = new Float32Array(BUFFER_SIZES.z2);
    this._h2 = new Float32Array(BUFFER_SIZES.h2);
    // Per-head logit buffers (indexed by HEAD_BUFFER_KEYS order)
    this._headBufs = {
      mode:        new Float32Array(5),
      intent:      new Float32Array(5),
      topic_count: new Float32Array(4),
      frag_count:  new Float32Array(4),
      creativity:  new Float32Array(1),
      tone:        new Float32Array(4),
    };

    // --- Quantized weights (populated by loadQuantized()) ---
    this._qWeights = null; // { scale, w1q: Int8Array, w2q: Int8Array, headQ: [...] }
    this._totalParams = this._countParams();
    this._quantizedBytes = 0;
  }

  /**
   * Count total float parameters across all weight tensors.
   * @returns {number}
   */
  _countParams() {
    let n = 0;
    for (const [key, shape] of WEIGHT_SHAPES) {
      const t = this.weights[key];
      n += t.length * (shape.length === 1 ? 1 : shape[1]);
    }
    return n;
  }

  /**
   * Approximate memory footprint of float32 weights in bytes.
   */
  _floatWeightBytes() {
    return this._totalParams * 4;
  }

  /**
   * Load quantized (int8) weight representation from the current float weights.
   * Each weight matrix is independently quantized per-layer using symmetric
   * int8 quantization: q = round(w / scale), clamped to [-127, 127].
   * Scale = max(abs(weight)) / 127.
   *
   * Call once after construction. Sets this._qWeights.
   */
  loadQuantized() {
    const w = this.weights;
    const qw = {};

    // fc1: [128, 25] → scale + Int8Array(128*25)
    qw.fc1 = this._quantizeMatrix(w['fc1.weight']);
    qw.fc2 = this._quantizeMatrix(w['fc2.weight']);
    // Heads
    qw.mode        = this._quantizeMatrix(w['mode_head.weight']);
    qw.intent      = this._quantizeMatrix(w['intent_head.weight']);
    qw.topic_count = this._quantizeMatrix(w['topic_count_head.weight']);
    qw.frag_count  = this._quantizeMatrix(w['frag_count_head.weight']);
    qw.creativity  = this._quantizeMatrix(w['creativity_head.weight']);
    qw.tone        = this._quantizeMatrix(w['tone_head.weight']);

    this._qWeights = qw;
    // Compute total quantized bytes: Int8Array byteLength + scale numbers
    let bytes = 0;
    for (const key of Object.keys(qw)) {
      bytes += qw[key].data.byteLength + 4; // Int8 + one float32 scale
    }
    this._quantizedBytes = bytes;
    return this;
  }

  /**
   * Quantize a 2-D float weight matrix (row-major) into { scale, data: Int8Array }.
   * @param {Array<Array<number>>} wmat
   * @returns {{ scale: number, data: Int8Array }}
   */
  _quantizeMatrix(wmat) {
    let maxAbs = 0;
    const rows = wmat.length;
    const cols = wmat[0].length;
    const total = rows * cols;
    for (let j = 0; j < rows; j++) {
      const row = wmat[j];
      for (let i = 0; i < cols; i++) {
        const v = Math.abs(row[i]);
        if (v > maxAbs) maxAbs = v;
      }
    }
    const scale = maxAbs > 0 ? maxAbs / 127 : 1;
    const data = new Int8Array(total);
    let idx = 0;
    for (let j = 0; j < rows; j++) {
      const row = wmat[j];
      for (let i = 0; i < cols; i++) {
        // Clamp to [-127, 127] before rounding
        const q = Math.round(row[i] / scale);
        data[idx++] = q < -127 ? -127 : (q > 127 ? 127 : q);
      }
    }
    return { scale, data };
  }

  // -----------------------------------------------------------------------
  // Forward pass — buffer-reusing (backward compatible)
  // -----------------------------------------------------------------------

  /**
   * Run the full MLP forward pass, reusing pre-allocated buffers.
   * Backward compatible: callers may pass an optional `features` override,
   * but the signature remains identical to the original forward().
   *
   * @param {Float32Array} features - 25-element feature vector
   * @returns {{
   *   modeProbs: Float32Array, intentProbs: Float32Array,
   *   topicCountProbs: Float32Array, fragCountProbs: Float32Array,
   *   creativity: number, toneProbs: Float32Array
   * }}
   */
  forward(features) {
    const w = this.weights;
    const b = this._headBufs;
    const z1 = this._z1, h1 = this._h1, z2 = this._z2, h2 = this._h2;

    // ---- Layer 1: fc1 (128, ReLU) ----
    matMul(features, w['fc1.weight'], z1);  // write into pre-allocated z1
    addBiasInPlace(z1, w['fc1.bias']);
    relu(z1, h1);                            // write into pre-allocated h1

    // ---- Layer 2: fc2 (64, ReLU) ----
    matMul(h1, w['fc2.weight'], z2);         // write into pre-allocated z2
    addBiasInPlace(z2, w['fc2.bias']);
    relu(z2, h2);                            // write into pre-allocated h2

    // ---- Action heads (all share h2 as input) ----
    matMul(h2, w['mode_head.weight'], b.mode);
    addBiasInPlace(b.mode, w['mode_head.bias']);

    matMul(h2, w['intent_head.weight'], b.intent);
    addBiasInPlace(b.intent, w['intent_head.bias']);

    matMul(h2, w['topic_count_head.weight'], b.topic_count);
    addBiasInPlace(b.topic_count, w['topic_count_head.bias']);

    matMul(h2, w['frag_count_head.weight'], b.frag_count);
    addBiasInPlace(b.frag_count, w['frag_count_head.bias']);

    matMul(h2, w['creativity_head.weight'], b.creativity);
    addBiasInPlace(b.creativity, w['creativity_head.bias']);

    matMul(h2, w['tone_head.weight'], b.tone);
    addBiasInPlace(b.tone, w['tone_head.bias']);

    return {
      modeProbs:        softmax(b.mode),
      intentProbs:      softmax(b.intent),
      topicCountProbs:  softmax(b.topic_count),
      fragCountProbs:   softmax(b.frag_count),
      creativity:       0.5,
      toneProbs:        softmax(b.tone),
    };
  }

  /**
   * Quantized forward pass — int8 weights with int32 accumulation.
   * Requires loadQuantized() to have been called first.
   *
   * @param {Float32Array} features - 25-element feature vector
   * @returns {{
   *   modeProbs: Float32Array, intentProbs: Float32Array,
   *   topicCountProbs: Float32Array, fragCountProbs: Float32Array,
   *   creativity: number, toneProbs: Float32Array
   * }}
   */
  forwardQuantized(features) {
    if (!this._qWeights) {
      throw new Error('MLPPolicy: call loadQuantized() before forwardQuantized()');
    }
    const qw = this._qWeights;
    const b = this._headBufs;
    const z1 = this._z1, h1 = this._h1, z2 = this._z2, h2 = this._h2;

    // fc1: features[25] × qw.fc1.data[128*25], scale = qw.fc1.scale
    // Accumulate in Float32 directly (no int32 intermediate needed at this size)
    matMulInt8(features, qw.fc1.data, 128, 25, z1);
    // Dequantize: z1 *= fc1_scale, then add bias
    const s1 = qw.fc1.scale;
    for (let i = 0; i < 128; i++) z1[i] *= s1;
    addBiasInPlace(z1, this.weights['fc1.bias']);
    relu(z1, h1);

    // fc2: h1[128] × qw.fc2.data[64*128], scale = qw.fc2.scale
    matMulInt8(h1, qw.fc2.data, 64, 128, z2);
    const s2 = qw.fc2.scale;
    for (let i = 0; i < 64; i++) z2[i] *= s2;
    addBiasInPlace(z2, this.weights['fc2.bias']);
    relu(z2, h2);

    // Heads — each has own scale factor
    const heads = [
      { buf: b.mode,        q: qw.mode,        w: this.weights['mode_head.bias'],        size: 5  },
      { buf: b.intent,      q: qw.intent,      w: this.weights['intent_head.bias'],      size: 5  },
      { buf: b.topic_count, q: qw.topic_count, w: this.weights['topic_count_head.bias'], size: 4  },
      { buf: b.frag_count,  q: qw.frag_count,  w: this.weights['frag_count_head.bias'],  size: 4  },
      { buf: b.creativity,  q: qw.creativity,  w: this.weights['creativity_head.bias'],  size: 1  },
      { buf: b.tone,        q: qw.tone,        w: this.weights['tone_head.bias'],        size: 4  },
    ];

    for (const h of heads) {
      matMulInt8(h2, h.q.data, h.size, 64, h.buf);
      const hs = h.q.scale;
      for (let i = 0; i < h.size; i++) h.buf[i] *= hs;
      addBiasInPlace(h.buf, h.w);
    }

    return {
      modeProbs:        softmax(b.mode),
      intentProbs:      softmax(b.intent),
      topicCountProbs:  softmax(b.topic_count),
      fragCountProbs:   softmax(b.frag_count),
      creativity:       0.5,
      toneProbs:        softmax(b.tone),
    };
  }

  // -----------------------------------------------------------------------
  // Performance & memory reporting
  // -----------------------------------------------------------------------

  /**
   * Static benchmark — compares float32 vs quantized forward pass speed.
   *
   * @param {MLPPolicy} policy - initialized MLPPolicy
   * @param {Float32Array} features - 25-element feature vector to use
   * @param {number} iterations - number of iterations (default 1000)
   * @returns {{ float32_us: number, quantized_us: number, speedup: number }}
   */
  static benchmark(policy, features, iterations = 1000) {
    const warmup = 100;
    // Warm up both paths
    for (let i = 0; i < warmup; i++) {
      policy.forward(features);
      if (policy._qWeights) policy.forwardQuantized(features);
    }

    // Benchmark float32
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) policy.forward(features);
    const t1 = process.hrtime.bigint();
    const float32_us = Number(t1 - t0) / iterations / 1000;

    // Benchmark quantized
    let quantized_us = 0;
    if (policy._qWeights) {
      const t2 = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) policy.forwardQuantized(features);
      const t3 = process.hrtime.bigint();
      quantized_us = Number(t3 - t2) / iterations / 1000;
    }

    return {
      float32_us:    parseFloat(float32_us.toFixed(2)),
      quantized_us:  quantized_us > 0 ? parseFloat(quantized_us.toFixed(2)) : null,
      speedup:       quantized_us > 0 ? parseFloat((float32_us / quantized_us).toFixed(2)) : null,
    };
  }

  /**
   * Return memory usage statistics.
   * @returns {{
   *   totalParams: number,
   *   floatBytes: number,
   *   quantizedBytes: number,
   *   memorySavedPct: number
   * }}
   */
  getStats() {
    const floatBytes = this._floatWeightBytes();
    const saved = this._quantizedBytes > 0
      ? ((floatBytes - this._quantizedBytes) / floatBytes * 100).toFixed(1)
      : 0;
    return {
      totalParams:    this._totalParams,
      floatBytes,
      quantizedBytes: this._quantizedBytes,
      memorySavedPct: parseFloat(saved),
    };
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
    const f32 = featuresToF32(features, this._version);
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

    // ---- Follow-up overrides: override MLP decisions when follow-up detected ----
    if (features.followUpType > 0) {
      decisionPath.push(`followUp:type=${features.followUpType}`);

      switch (features.followUpType) {
        case 1: // simplify
          fragsPerTopic = 1;
          topicCount = Math.min(topicCount, 2);
          tone = 'intuitive';
          creativity = Math.min(creativity, 0.2);
          decisionPath.push('followup:override-simplify');
          break;

        case 3: // example
          intent = 'example';
          fragsPerTopic = 1;
          decisionPath.push('followup:override-example');
          break;

        case 4: // elaborate — let MLP decision stand; features already biased
          decisionPath.push('followup:override-elaborate');
          break;

        case 6: // another_example
          intent = 'example';
          fragsPerTopic = 1;
          decisionPath.push('followup:override-another-example');
          break;

        case 5: // reference_index — focus on the referenced topic
          if (context.followUp && context.followUp.targetIndex != null) {
            decisionPath.push(`followup:override-ref-index-${context.followUp.targetIndex}`);
          } else {
            decisionPath.push('followup:ref-index-no-target');
          }
          break;

        // --- New follow-up type overrides (8+) ---

        case 8: // continue — user wants more content
          decisionPath.push('followup:override-continue');
          break;

        case 9:  // how
        case 10: // why
          // Causal/explanatory — may need more formal depth
          tone = tone === 'neutral' ? 'formal' : tone;
          fragsPerTopic = Math.min(fragsPerTopic + 1, 4);
          decisionPath.push(`followup:override-explanatory`);
          break;

        case 11: // challenge — user skeptical
          intent = 'formal';
          creativity = Math.min(creativity, 0.25);
          decisionPath.push('followup:override-challenge');
          break;

        case 12: // acknowledge — user confirmed understanding; continue naturally
          decisionPath.push('followup:override-acknowledge');
          break;

        case 13: // clarify — user didn't understand
          fragsPerTopic = 1;
          topicCount = Math.min(topicCount, 2);
          tone = 'intuitive';
          creativity = Math.min(creativity, 0.2);
          decisionPath.push('followup:override-clarify');
          break;

        case 14: // deep_dive — user wants thorough treatment
          fragsPerTopic = Math.min(fragsPerTopic + 1, 4);
          tone = tone === 'neutral' ? 'formal' : tone;
          decisionPath.push('followup:override-deep-dive');
          break;

        case 15: // relevance — "so what?"
          intent = 'application';
          decisionPath.push('followup:override-relevance');
          break;

        case 16: // evidence — "prove it"
          intent = 'formal';
          creativity = Math.min(creativity, 0.2);
          decisionPath.push('followup:override-evidence');
          break;

        case 17: // comparison
          intent = 'comparison';
          topicCount = Math.max(topicCount, 2);
          decisionPath.push('followup:override-comparison');
          break;

        case 18: // summarize
          fragsPerTopic = 1;
          tone = tone === 'formal' ? 'neutral' : tone;
          creativity = Math.min(creativity, 0.3);
          decisionPath.push('followup:override-summarize');
          break;

        case 19: // affirm_continue — user said "yes" / "go ahead"
          decisionPath.push('followup:override-affirm-continue');
          break;
      }
    }

    // ---- Build topics array from ranked KB entries ----
    const topics = [];
    const ranked = context.ranked || [];

    // For reference_index follow-up, prioritize the referenced KB entry
    let referencePriorityIndex = null;
    if (features.followUpType === 5 && context.followUp && context.followUp.targetIndex != null) {
      referencePriorityIndex = context.followUp.targetIndex;
      topicCount = 1; // focus on single referenced topic
      decisionPath.push(`followup:ref-focus-topic-${referencePriorityIndex}`);
    }

    if (topicCount > 0 && ranked.length > 0) {
      const seen = new Set();
      // If reference_index, add the target first
      if (referencePriorityIndex !== null) {
        topics.push(referencePriorityIndex);
        seen.add(referencePriorityIndex);
      }
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

    // Adjust fragment indices for "another_example" — use second fragment (index 1)
    // to avoid re-showing the same example the user saw last turn
    if (features.followUpType === 6) {
      decisionPath.push('followup:frag-indices-incremented');
      for (const fp of fragmentPlan) {
        fp.fragIndices = fp.cats.map(() => 1);
      }
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
