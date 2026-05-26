/**
 * feature-extractor.js — ReLU.chat WASM Policy Runtime
 *
 * Extracts a compact 25-feature vector from the current query context.
 * These features are the input to the WASM/MLP policy model.
 *
 * Design Version: 1.0.0 (wasm-policy-architecture.json §2)
 * Feature count:   25 (21 f32 + 4 discrete packed into Uint8Array)
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
 *  18:  followUpType     u8   [0,19]  0=none, 1=simplify, 2=compare_previous, 3=example, 4=elaborate, 5=reference_index, 6=another_example, 7=specific, 8=continue, 9=how, 10=why, 11=challenge, 12=acknowledge, 13=clarify, 14=deep_dive, 15=relevance, 16=evidence, 17=comparison, 18=summarize, 19=affirm_continue
 *  19:  wasAmbiguous     bool [0,1]   previous turn was flagged as ambiguous
 *  20:  avgTruthConf     f32  [0,1]   average truth_confidence of available fragments (0 if unknown)
 *  21:  avgSourceConf    f32  [0,1]   average source_confidence of available fragments (0 if unknown)
 *  22:  minDifficulty    u8   [0,4]   minimum difficulty across available fragments
 *  23:  fragDiversity    u8   [0,5]   count of distinct fragment styles available
 *  24:  avoidWithCount   f32  [0,1]   fraction of top-ranked entries with compatibility constraints
 *
 * Serialization:
 *   packFeatures(features) → { float32: Float32Array(25), uint8: Uint8Array(7) }
 *   The float32 array stores all 24 features (u8/bool cast to f32);
 *   the uint8 array stores the 7 discrete features in compact form.
 */

import { cosine, tokens } from '../core/nlp.js';

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
 * Extract the 24-feature policy vector from query context.
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
 * @param {number[]}  [entryEmb]   - optional pre-computed entry embeddings array
 * @param {object|null}  [followUp]       - session follow-up object (or null)
 * @param {boolean}     [wasAmbiguous=false] - whether previous turn was ambiguous
 * @returns {object}              - features object (frozen)
 */
export function extractPolicyFeatures(query, qEmb, ranked, entities, intentScores, lastTopic, lastTopicAge, KB, config, entryEmb = null, followUp = null, wasAmbiguous = false) {
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
  if (lastTopic !== null && lastTopic >= 0 && lastTopic < KB.length && qEmb && entryEmb) {
    const lastEmb = entryEmb[lastTopic];
    if (lastEmb) {
      lastTopicSim = cosine(qEmb, lastEmb);
    }
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
    kbCoverage = covered / Math.max(KB.length, 1);
  }

  // ---- Query length in tokens (after STOP-word filtering) ----
  const queryLenTokens = Math.max(1, Math.min(tokens(query).length, 32));

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

  // ---- Follow-up type (from session memory) ----
  // Expanded map covering all nuanced follow-up types from session.js.
  // Types 1-7 are original (unchanged). Types 8+ are new additions.
  const FOLLOWUP_TYPE_MAP = {
    // Original types (1-7) — preserved for backward compatibility
    'simplify': 1, 'compare_previous': 2, 'example': 3, 'elaborate': 4,
    'reference_index': 5, 'another_example': 6, 'specific': 7,
    // New nuanced types (8-20+)
    'continue': 8,
    'how': 9,
    'why': 10,
    'challenge': 11,
    'acknowledge': 12,
    'clarify': 13,
    'deep_dive': 14,
    'relevance': 15,
    'evidence': 16,
    'comparison': 17,
    'summarize': 18,
    'affirm_continue': 19,
  };
  const followUpType = (followUp && followUp.isFollowUp)
    ? (FOLLOWUP_TYPE_MAP[followUp.type] || 0)
    : 0;

  // ---- Follow-up: aggressively modify intent scores and other features ----
  let modifiedIntentDefScore = intentScores?.definition ?? 0;
  let modifiedIntentExScore = intentScores?.example ?? 0;
  let modifiedIntentFormScore = intentScores?.formal ?? 0;
  let modifiedIntentAppScore = intentScores?.application ?? 0;
  let modifiedIntentCompScore = intentScores?.comparison ?? 0;
  let modifiedHasExampleCue = hasExampleCue;
  let modifiedBotCreativity = botCreativity;

  if (followUpType > 0 && followUp && followUp.isFollowUp) {
    switch (followUp.type) {
      case 'simplify':
        // Boost definition to bias toward simpler explanations; lower creativity
        modifiedIntentDefScore = Math.max(modifiedIntentDefScore, 0.65);
        modifiedBotCreativity = Math.min(modifiedBotCreativity, 0.15);
        break;

      case 'example':
        // Strongly bias toward example intent
        modifiedIntentExScore = Math.max(modifiedIntentExScore, 0.75);
        modifiedHasExampleCue = true;
        break;

      case 'elaborate':
        // Boost formal + application scores to get deeper/richer content
        modifiedIntentFormScore = Math.max(modifiedIntentFormScore, 0.50);
        modifiedIntentAppScore = Math.max(modifiedIntentAppScore, 0.50);
        break;

      case 'another_example':
        // Re-bias toward example to get another illustrative fragment
        modifiedIntentExScore = Math.max(modifiedIntentExScore, 0.70);
        break;

      case 'continue':
        // Continue/get more — boost formal for depth, increase depth appetite
        modifiedIntentFormScore = Math.max(modifiedIntentFormScore, 0.40);
        modifiedIntentAppScore = Math.max(modifiedIntentAppScore, 0.40);
        break;

      case 'deep_dive':
        // User wants thorough/detailed treatment — strongly boost all depth intents
        modifiedIntentFormScore = Math.max(modifiedIntentFormScore, 0.65);
        modifiedIntentAppScore = Math.max(modifiedIntentAppScore, 0.55);
        modifiedIntentDefScore = Math.max(modifiedIntentDefScore, 0.40);
        break;

      case 'how':
      case 'why':
        // Causal/explanatory follow-up — boost formal for mechanistic explanation
        modifiedIntentFormScore = Math.max(modifiedIntentFormScore, 0.50);
        modifiedIntentAppScore = Math.max(modifiedIntentAppScore, 0.35);
        modifiedIntentDefScore = Math.max(modifiedIntentDefScore, 0.30);
        break;

      case 'clarify':
        // User didn't understand — simplify and lower creativity
        modifiedIntentDefScore = Math.max(modifiedIntentDefScore, 0.55);
        modifiedBotCreativity = Math.min(modifiedBotCreativity, 0.20);
        modifiedHasExampleCue = true;
        break;

      case 'comparison':
        // User wants comparison — strongly bias comparison intent
        modifiedIntentCompScore = Math.max(modifiedIntentCompScore, 0.70);
        break;

      case 'challenge':
      case 'evidence':
        // User wants proof/evidence — boost formal + definition
        modifiedIntentFormScore = Math.max(modifiedIntentFormScore, 0.65);
        modifiedIntentDefScore = Math.max(modifiedIntentDefScore, 0.50);
        break;

      case 'summarize':
        // User wants brief — lower creativity, bias definition
        modifiedIntentDefScore = Math.max(modifiedIntentDefScore, 0.45);
        modifiedBotCreativity = Math.min(modifiedBotCreativity, 0.20);
        break;

      case 'relevance':
        // User asks "so what" — boost application to show practical relevance
        modifiedIntentAppScore = Math.max(modifiedIntentAppScore, 0.60);
        break;

      case 'acknowledge':
      case 'affirm_continue':
        // User confirms understanding — slightly boost continuity (default behavior)
        modifiedIntentDefScore = Math.max(modifiedIntentDefScore, 0.25);
        break;

      // reference_index — handled downstream in mlp-inference.js via targetIndex
      // compare_previous, specific — handled by existing pipeline logic
    }
  }

  // ---- Previous ambiguity flag ----
  const ambigFlag = !!wasAmbiguous;

  // ---- Aggregate fragment metadata from ranked KB entries ----
  let avgTruthConf = 0;
  let avgSourceConf = 0;
  let minDifficulty = 4;
  let fragDiversity = 0;
  const styleSet = new Set();
  let fragCount = 0;
  for (const r of ranked) {
    const entry = KB[r.i];
    if (!entry || !entry.f) continue;
    for (const cat of ['def', 'int', 'ex', 'form', 'app']) {
      const frags = entry.f[cat];
      if (!frags || !frags.length) continue;
      for (const frag of frags) {
        if (typeof frag === 'object' && frag !== null) {
          if (frag.truth_confidence != null) { avgTruthConf += frag.truth_confidence; fragCount++; }
          if (frag.source_confidence != null) { avgSourceConf += frag.source_confidence; }
          if (frag.difficulty != null) { minDifficulty = Math.min(minDifficulty, frag.difficulty); }
          if (frag.style) { styleSet.add(frag.style); }
        }
      }
    }
  }
  if (fragCount > 0) { avgTruthConf /= fragCount; avgSourceConf /= fragCount; }
  if (minDifficulty === 4) minDifficulty = 0; // default when no annotated fragments
  fragDiversity = Math.min(styleSet.size, 5);

  // ---- Aggregate compatibility constraints (avoid_with) from top entries ----
  let avoidWithCount = 0;
  for (let ri = 0; ri < Math.min(ranked.length, 10); ri++) {
    const entry = KB[ranked[ri].i];
    if (entry && (entry.avoid_with || entry.avoidWith)) {
      avoidWithCount++;
    }
  }
  const avoidWithRatio = Math.min(ranked.length, 10) > 0
    ? avoidWithCount / Math.min(ranked.length, 10)
    : 0;

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
    hasExampleCue: modifiedHasExampleCue,

    // F32 intent scores (indices 4-8) — modified by follow-up when detected
    intentDefScore:  modifiedIntentDefScore,
    intentExScore:   modifiedIntentExScore,
    intentFormScore: modifiedIntentFormScore,
    intentAppScore:  modifiedIntentAppScore,
    intentCompScore: modifiedIntentCompScore,

    // F32 topic features (indices 9, 11)
    lastTopicSim,
    kbCoverage,

    // F32 profile features (indices 16, 17)
    botCreativity: modifiedBotCreativity,
    domainMatch,

    // Session memory features (indices 18-19)
    followUpType,
    wasAmbiguous: ambigFlag,

    // Fragment metadata (indices 20-24)
    avgTruthConf,
    avgSourceConf,
    minDifficulty,
    fragDiversity,
    avoidWithCount: avoidWithRatio,
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
 *   - Float32Array(25) at offset 0  (all features as f32)
 *   - Uint8Array(7)    at offset 100 (discrete features in compact form)
 *
 * Total buffer size: 25 * 4 + 7 = 107 bytes.
 *
 * Uint8Array layout:
 *   [0] = entityCount          (u8, 0-3)
 *   [1] = packed booleans      (bit 0: entityBoostHit, bit 1: hasComparisonCue,
 *                                bit 2: hasFormalCue, bit 3: hasExampleCue,
 *                                bit 4: wasAmbiguous)
 *   [2] = lastTopicAge         (u8, 0-8)
 *   [3] = queryLenTokens       (u8, 1-32)
 *   [4] = followUpType         (u8, 0-19)
 *   [5] = minDifficulty        (u8, 0-4)
 *   [6] = fragDiversity        (u8, 0-5)
 *
 * @param {object} features - the object returned by extractPolicyFeatures()
 * @returns {{ float32: Float32Array, uint8: Uint8Array, buffer: ArrayBuffer }}
 */
export function packFeatures(features) {
  const buffer = new ArrayBuffer(25 * 4 + 7); // 107 bytes
  const f32 = new Float32Array(buffer, 0, 25);
  const u8  = new Uint8Array(buffer, 100, 7);

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
  f32[18] = features.followUpType;             // cast to f32
  f32[19] = features.wasAmbiguous ? 1.0 : 0.0;
  f32[20] = clampf(features.avgTruthConf);
  f32[21] = clampf(features.avgSourceConf);
  f32[22] = features.minDifficulty;            // cast to f32
  f32[23] = features.fragDiversity;            // cast to f32
  f32[24] = clampf(features.avoidWithCount);

  // Fill Uint8Array with compact discrete values
  u8[0] = clampu(features.entityCount, 0, 3);
  u8[1] = packBools(
    features.entityBoostHit,
    features.hasComparisonCue,
    features.hasFormalCue,
    features.hasExampleCue,
    features.wasAmbiguous
  );
  u8[2] = clampu(features.lastTopicAge, 0, 8);
  u8[3] = clampu(features.queryLenTokens, 1, 32);
  u8[4] = clampu(features.followUpType, 0, 19);
  u8[5] = clampu(features.minDifficulty, 0, 4);
  u8[6] = clampu(features.fragDiversity, 0, 5);

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
    followUpType:     uint8[4],
    wasAmbiguous:     bools[4],
    avgTruthConf:     float32[20],
    avgSourceConf:    float32[21],
    minDifficulty:    uint8[5],
    fragDiversity:    uint8[6],
    avoidWithCount:   float32[24],
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

/** Pack 5 booleans into a single u8 (little-endian bit order). */
function packBools(b0, b1, b2, b3, b4) {
  return (b0 ? 1 : 0) | (b1 ? 2 : 0) | (b2 ? 4 : 0) | (b3 ? 8 : 0) | (b4 ? 16 : 0);
}

/** Unpack a single u8 into 5 booleans. */
function unpackBools(byte) {
  return [
    !!(byte & 1),
    !!(byte & 2),
    !!(byte & 4),
    !!(byte & 8),
    !!(byte & 16),
  ];
}
