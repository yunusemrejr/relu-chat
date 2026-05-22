/**
 * feature-extractor.js — ReLU.chat WASM Policy Runtime
 *
 * Extracts a compact 18-feature vector from the current query context.
 * These features are the input to the WASM policy model.
 *
 * Design Version: 1.0.0 (wasm-policy-architecture.json §2)
 * Feature count:   18 (14 f32 + 4 discrete packed into Uint8Array)
 *
 * FEATURE LAYOUT (index → name → type):
 *   0:  qSimTop1         f32  [0,1]   cosine sim of query to top-1 KB entry
 *   1:  qSimTop2         f32  [0,1]   cosine sim of query to top-2 KB entry
 *   2:  entityCount      u8   [0,3]   number of entities extracted (capped)
 *   3:  entityBoostHit   bool [0,1]   any ranked entry also matched entity
 *   4:  intentDefScore   f32  [0,1]   raw cosine of best definition prototype
 *   5:  intentExScore    f32  [0,1]   raw cosine of best example prototype
 *   6:  intentFormScore  f32  [0,1]   raw cosine of best formal prototype
 *   7:  intentAppScore   f32  [0,1]   raw cosine of best application prototype
 *   8:  intentCompScore  f32  [0,1]   raw cosine of best comparison prototype
 *   9:  lastTopicSim     f32  [0,1]   cosine of query to lastTopic entry (0 if none)
 *  10:  lastTopicAge     u8   [0,8]   turns since lastTopic (capped)
 *  11:  kbCoverage       f32  [0,1]   fraction of KB entries with sim > 0.25
 *  12:  queryLenTokens   u8   [1,32]  token count after STOP-word filtering (capped)
 *  13:  hasComparisonCue bool [0,1]   query contains 'vs', 'versus', 'compare', 'difference'
 *  14:  hasFormalCue     bool [0,1]   query contains 'prove', 'theorem', 'formal', 'math'
 *  15:  hasExampleCue    bool [0,1]   query contains 'example', 'illustrate', 'case'
 *  16:  botCreativity    f32  [0,1]   botProfile.creativityCeiling
 *  17:  domainMatch      f32  [0,1]   max similarity to botProfile.domainPrototypes
 *
 * Serialization:
 *   packFeatures(features) → { float32: Float32Array(18), uint8: Uint8Array(4) }
 *   The float32 array stores all 18 features (u8/bool cast to f32);
 *   the uint8 array stores the 4 discrete features in compact form.
 */

import { cosine } from '../core/nlp.js';

// ---------------------------------------------------------------------------
// Cue-word detection — simple regex sets for lexical features
// ---------------------------------------------------------------------------

const COMPARISON_CUES = /\b(vs|versus|compare|comparison|difference|differ|distinguish|between)\b/i;
const FORMAL_CUES     = /\b(prove|proof|theorem|formal|math|mathematical|rigorous|derive|defini)\w*\b/i;
const EXAMPLE_CUES    = /\b(example|illustrate|illustration|case|concrete|instance|show me)\b/i;

// ---------------------------------------------------------------------------
// Feature cap constants
// ---------------------------------------------------------------------------

const MAX_ENTITY_COUNT   = 3;
const MAX_QUERY_TOKENS   = 32;
const MAX_LAST_TOPIC_AGE = 8;
const KB_COVERAGE_MIN_SIM = 0.25;

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract the 18-feature policy vector from query context.
 *
 * Call this inside nlp.js:compose() (or its replacement) right after
 * embedding, ranking, entity extraction, and intent classification.
 *
 * @param {string}   query        - raw user query string
 * @param {number[]} qEmb         - query embedding vector (from embedding model)
 * @param {Array<{i: number, s: number}>} ranked - ranked KB entries [{i, s}] sorted desc by s
 * @param {number[]} entities     - KB indices of extracted entities (from extractEntities)
 * @param {object}   intentScores - { [intentName]: rawCosine } from classifyIntent
 * @param {number|null} lastTopic - KB index of last topic (or null)
 * @param {number|null} lastTopicAge - turns since last topic change (or null)
 * @param {object[]} KB           - knowledge base array
 * @param {object}   config       - { EMBEDDING, botProfile } from chat config
 * @returns {object}              - features object (with getters for lazy evaluation)
 */
export function extractPolicyFeatures(query, qEmb, ranked, entities, intentScores, lastTopic, lastTopicAge, KB, config) {
  // ---- Compute capped entity features ----
  const entityCount = Math.min(entities.length, MAX_ENTITY_COUNT);

  // Check if any top-5 ranked entry matches an extracted entity
  let entityBoostHit = false;
  if (entities.length > 0 && ranked.length > 0) {
    const entitySet = new Set(entities);
    for (let r = 0; r < Math.min(ranked.length, 5); r++) {
      if (entitySet.has(ranked[r].i)) {
        entityBoostHit = true;
        break;
      }
    }
  }

  // ---- Compute last-topic features ----
  let lastTopicSim = 0;
  if (lastTopic !== null && lastTopic >= 0 && lastTopic < KB.length && qEmb) {
    // We need the embedding of the last topic entry. Since we don't have
    // easy access to entryEmb here, we leave it to the caller to provide
    // lastTopicSim if possible. If not, it stays 0.
    // The caller (nlp.js) can set this after calling us.
    lastTopicSim = 0; // caller must set post-hoc or pass in
  }
  const lastTopicAgeVal = Math.min(
    lastTopicAge !== null && lastTopicAge !== undefined ? lastTopicAge : MAX_LAST_TOPIC_AGE,
    MAX_LAST_TOPIC_AGE
  );

  // ---- Compute KB coverage: fraction of entries with sim > threshold ----
  let kbCoverage = 0;
  if (ranked.length > 0) {
    const threshold = KB_COVERAGE_MIN_SIM;
    let covered = 0;
    for (const r of ranked) {
      if (r.s > threshold) covered++;
    }
    kbCoverage = covered / ranked.length;
  }

  // ---- Query length in tokens (after STOP-word filtering) ----
  const queryLenTokens = computeQueryLen(query);

  // ---- Lexical cue features ----
  const hasComparisonCue = COMPARISON_CUES.test(query);
  const hasFormalCue     = FORMAL_CUES.test(query);
  const hasExampleCue    = EXAMPLE_CUES.test(query);

  // ---- Bot profile injection ----
  const botProfile = config?.botProfile || {};
  const botCreativity = typeof botProfile.creativityCeiling === 'number'
    ? Math.min(Math.max(botProfile.creativityCeiling, 0), 1)
    : 0.5;

  // ---- Domain match: max similarity to botProfile.domainPrototypes ----
  let domainMatch = 0;
  const domainPrototypes = botProfile.domainPrototypes;
  if (domainPrototypes && domainPrototypes.length > 0 && qEmb) {
    // domainPrototypes are strings — the caller should pre-embed them
    // and pass as config._domainPrototypeEmbs (pre-computed at init time)
    const protoEmbs = config._domainPrototypeEmbs;
    if (protoEmbs && protoEmbs.length > 0) {
      for (const pe of protoEmbs) {
        const s = cosine(qEmb, pe);
        if (s > domainMatch) domainMatch = s;
      }
    }
  }

  // ---- Build final feature object ----
  const features = {
    // F32 features (indices 0-1)
    qSimTop1: (ranked.length > 0 ? ranked[0].s : 0),
    qSimTop2: (ranked.length > 1 ? ranked[1].s : 0),

    // U8 features (indices 2, 10, 12) — stored as numbers 0-255
    entityCount,
    lastTopicAge: lastTopicAgeVal,
    queryLenTokens,

    // Bool features (indices 3, 13, 14, 15)
    entityBoostHit,
    hasComparisonCue,
    hasFormalCue,
    hasExampleCue,

    // F32 intent scores (indices 4-8)
    intentDefScore:  (intentScores?.definition  ?? 0),
    intentExScore:   (intentScores?.example     ?? 0),
    intentFormScore: (intentScores?.formal      ?? 0),
    intentAppScore:  (intentScores?.application ?? 0),
    intentCompScore: (intentScores?.comparison  ?? 0),

    // F32 topic features (indices 9, 11)
    lastTopicSim,
    kbCoverage,

    // F32 profile features (indices 16, 17)
    botCreativity,
    domainMatch,
  };

  // Freeze to prevent accidental mutation downstream
  return Object.freeze(features);
}

// ---------------------------------------------------------------------------
// Packed serialization for WASM boundary
// ---------------------------------------------------------------------------

/**
 * Serialize features into the flat binary layout expected by WASM.
 *
 * The WASM module expects a single buffer with:
 *   - Float32Array(18) at offset 0  (all features as f32)
 *   - Uint8Array(4)   at offset 72 (discrete features in compact form)
 *
 * Total buffer size: 18 * 4 + 4 = 76 bytes.
 *
 * Uint8Array layout:
 *   [0] = entityCount        (u8, 0-3)
 *   [1] = packed booleans    (bit 0: entityBoostHit, bit 1: hasComparisonCue,
 *                              bit 2: hasFormalCue, bit 3: hasExampleCue)
 *   [2] = lastTopicAge       (u8, 0-8)
 *   [3] = queryLenTokens     (u8, 1-32)
 *
 * @param {object} features - the object returned by extractPolicyFeatures()
 * @returns {{ float32: Float32Array, uint8: Uint8Array, buffer: ArrayBuffer }}
 */
export function packFeatures(features) {
  const buffer = new ArrayBuffer(18 * 4 + 4); // 76 bytes
  const f32 = new Float32Array(buffer, 0, 18);
  const u8  = new Uint8Array(buffer, 72, 4);

  // Fill Float32Array in index order
  f32[0]  = clampf(features.qSimTop1);
  f32[1]  = clampf(features.qSimTop2);
  f32[2]  = features.entityCount;             // cast to f32
  f32[3]  = features.entityBoostHit ? 1.0 : 0.0;
  f32[4]  = clampf(features.intentDefScore);
  f32[5]  = clampf(features.intentExScore);
  f32[6]  = clampf(features.intentFormScore);
  f32[7]  = clampf(features.intentAppScore);
  f32[8]  = clampf(features.intentCompScore);
  f32[9]  = clampf(features.lastTopicSim);
  f32[10] = features.lastTopicAge;             // cast to f32
  f32[11] = clampf(features.kbCoverage);
  f32[12] = features.queryLenTokens;           // cast to f32
  f32[13] = features.hasComparisonCue ? 1.0 : 0.0;
  f32[14] = features.hasFormalCue ? 1.0 : 0.0;
  f32[15] = features.hasExampleCue ? 1.0 : 0.0;
  f32[16] = clampf(features.botCreativity);
  f32[17] = clampf(features.domainMatch);

  // Fill Uint8Array with compact discrete values
  u8[0] = clampu(features.entityCount, 0, 3);
  u8[1] = packBools(
    features.entityBoostHit,
    features.hasComparisonCue,
    features.hasFormalCue,
    features.hasExampleCue
  );
  u8[2] = clampu(features.lastTopicAge, 0, 8);
  u8[3] = clampu(features.queryLenTokens, 1, 32);

  return { float32: f32, uint8: u8, buffer };
}

/**
 * Unpack the WASM-bound buffer back into a feature object.
 * Used for debugging and verification.
 *
 * @param {{ float32: Float32Array, uint8: Uint8Array }} packed
 * @returns {object} features object
 */
export function unpackFeatures({ float32, uint8 }) {
  const bools = unpackBools(uint8[1]);
  return Object.freeze({
    qSimTop1:         float32[0],
    qSimTop2:         float32[1],
    entityCount:      uint8[0],
    entityBoostHit:   bools[0],
    intentDefScore:   float32[4],
    intentExScore:    float32[5],
    intentFormScore:  float32[6],
    intentAppScore:   float32[7],
    intentCompScore:  float32[8],
    lastTopicSim:     float32[9],
    lastTopicAge:     uint8[2],
    kbCoverage:       float32[11],
    queryLenTokens:   uint8[3],
    hasComparisonCue: bools[1],
    hasFormalCue:     bools[2],
    hasExampleCue:    bools[3],
    botCreativity:    float32[16],
    domainMatch:      float32[17],
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Count tokens after STOP-word filtering (mirrors nlp.js:tokens logic but
 * operates on the raw string without exposing the full token list).
 */
function computeQueryLen(query) {
  const STOP = new Set(
    'a an the of in on at for to with and or is are was were be been being ' +
    'what which who whom whose this that these those i you he she it we they ' +
    'them us my your his her its our their me do does did can could should ' +
    'would will might may has have had'.split(' ')
  );
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOP.has(w));
  return Math.max(1, Math.min(tokens.length, MAX_QUERY_TOKENS));
}

/** Clamp float to [0, 1] (and force NaN → 0). */
function clampf(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(Math.max(v, 0), 1);
}

/** Clamp integer to [lo, hi]. */
function clampu(v, lo, hi) {
  const x = Math.round(v);
  if (!Number.isFinite(x)) return lo;
  return Math.min(Math.max(x, lo), hi);
}

/** Pack 4 booleans into a single u8 (little-endian bit order). */
function packBools(b0, b1, b2, b3) {
  return (b0 ? 1 : 0) | (b1 ? 2 : 0) | (b2 ? 4 : 0) | (b3 ? 8 : 0);
}

/** Unpack a single u8 into 4 booleans. */
function unpackBools(byte) {
  return [
    !!(byte & 1),
    !!(byte & 2),
    !!(byte & 4),
    !!(byte & 8),
  ];
}
