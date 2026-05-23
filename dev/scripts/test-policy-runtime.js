#!/usr/bin/env node
/**
 * test-policy-runtime.js — ReLU.chat Policy Runtime Tests
 *
 * Tests the pure JS functions from the policy system without requiring
 * a browser environment or WASM.
 *
 * Usage:
 *   node test-policy-runtime.js                    # run all tests
 *   node test-policy-runtime.js --section=validation   # validation tests only
 *   node test-policy-runtime.js --section=features     # feature extraction only
 *   node test-policy-runtime.js --section=runtime      # runtime tests only
 *   node test-policy-runtime.js --json                 # JSON output for CI
 */

import { validatePlan, DEFAULT_PLAN, PLAN_SCHEMA, isAnswerPlanLike } from '../../policy/action-schema.js';
import { extractPolicyFeatures, packFeatures, unpackFeatures } from '../../policy/feature-extractor.js';
import { planAnswerHeuristic } from '../../policy/policy-runtime.js';
import { MLPPolicy } from '../../policy/mlp-inference.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const YELLOW = '\x1b[33m';

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ${GREEN}✓${RESET} ${message}`);
    passCount++;
  } else {
    console.log(`  ${RED}✗${RESET} ${message}`);
    failCount++;
  }
}

function section(name) {
  console.log(`\n${YELLOW}━━━ ${name} ━━━${RESET}`);
}

function getArgs() {
  const args = process.argv.slice(2);
  const section = args.find(a => a.startsWith('--section='))?.split('=')[1] || 'all';
  const json = args.includes('--json');
  return { section, json };
}

/** Simple cosine similarity (mirrors nlp.js:cosine) */
function cosine(a, b) {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return s / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

// ---------------------------------------------------------------------------
// Mock data generators
// ---------------------------------------------------------------------------

function makeMockKB() {
  return [
    { id: 'nash', name: 'Nash Equilibrium', aliases: ['Nash Equilibrium', 'Nash'], f: { def: ['A solution concept in game theory...'], int: ['Players cannot benefit...'], ex: ['Prisoner\'s dilemma...'] }, related: [] },
    { id: 'cnn', name: 'Convolutional Neural Network', aliases: ['CNN', 'Convolutional Neural Network'], f: { def: ['A deep learning architecture...'], int: ['Uses filters to scan...'], ex: ['Image classification...'] }, related: [] },
    { id: 'rnn', name: 'Recurrent Neural Network', aliases: ['RNN', 'Recurrent Neural Network'], f: { def: ['A neural network with loops...'], int: ['Processes sequences...'], ex: ['Time series prediction...'] }, related: [] },
  ];
}

function makeMockConfig() {
  return {
    botProfile: {
      id: 'test-bot',
      allowedIntents: ['definition', 'example', 'formal', 'application', 'comparison'],
      tone: 'neutral',
      maxTopics: 3,
      creativityCeiling: 0.35,
      domainPrototypes: ['game theory', 'machine learning'],
    }
  };
}

function makeMockQEmb() {
  // 384-dimensional mock embedding (typical transformer size)
  return Array.from({ length: 384 }, () => Math.random() * 2 - 1);
}

function makeMockRanked() {
  return [
    { i: 0, s: 0.72 },
    { i: 1, s: 0.45 },
    { i: 2, s: 0.31 },
  ];
}

function makeMockIntentScores(overrides = {}) {
  return {
    definition:  overrides.definition ?? 0.65,
    example:     overrides.example ?? 0.42,
    formal:      overrides.formal ?? 0.21,
    application: overrides.application ?? 0.33,
    comparison:  overrides.comparison ?? 0.55,
  };
}

// ---------------------------------------------------------------------------
// 1. Validation Tests
// ---------------------------------------------------------------------------

function runValidationTests() {
  section('1. validatePlan() — Validation Tests');

  // 1.1 DEFAULT_PLAN is always valid
  {
    const result = validatePlan(DEFAULT_PLAN);
    assert(result.valid === true, 'DEFAULT_PLAN passes validation');
    assert(result.errors.length === 0, 'DEFAULT_PLAN produces zero errors');
    assert(result.sanitized !== DEFAULT_PLAN, 'sanitized is a new object (not same reference)');
    assert(
      JSON.stringify(result.sanitized) === JSON.stringify(DEFAULT_PLAN),
      'DEFAULT_PLAN sanitized equals original'
    );
  }

  // 1.2 Valid plan → passes
  {
    const validPlan = {
      mode: 'normal',
      topics: [0, 1],
      intent: 'definition',
      fragmentPlan: [
        { topicIdx: 0, cats: ['def', 'int'], fragIndices: [0, 0] },
        { topicIdx: 1, cats: ['def'], fragIndices: [0] },
      ],
      template: {
        openerIdx: 0,
        closerIdx: 0,
        comparisonOpenerKey: 'none',
        connectorKeys: ['def_to_int'],
      },
      tone: 'neutral',
      creativity: 0.5,
      guardrails: {
        maxTopics: 3,
        requireEntity: false,
        minSim: 0.15,
        allowOffTopic: false,
      },
      clarification: null,
      meta: {
        policyVersion: '0.1.0',
        policyHash: 'test-hash',
        decisionPath: ['test'],
      },
    };
    const result = validatePlan(validPlan);
    assert(result.valid === true, 'Fully-specified valid plan passes');
    assert(result.errors.length === 0, 'Valid plan produces zero errors');
    assert(result.sanitized.mode === 'normal', 'mode preserved');
    assert(result.sanitized.topics.length === 2, 'topics.length preserved');
  }

  // 1.3 Missing fields → uses schema defaults
  {
    const result = validatePlan({});
    // Note: validatePlan({}) returns valid=false because all fields are missing (added to errors).
    // But the sanitized object uses SCHEMA defaults (not DEFAULT_PLAN values).
    assert(result.valid === false, 'Empty object is not valid (fields are missing)');
    assert(result.sanitized.mode === 'normal', 'schema default mode is normal (not off_topic from DEFAULT_PLAN)');
    assert(result.sanitized.topics.length === 0, 'schema default topics is []');
    assert(result.sanitized.intent === 'definition', 'schema default intent is definition');
    assert(result.sanitized.creativity === 0.5, 'schema default creativity is 0.5');
    assert(result.errors.length > 0, 'Missing fields produce error messages');
  }

  // 1.4 Wrong types → rejects
  {
    const result1 = validatePlan({ mode: 123 });
    assert(result1.valid === false, '{ mode: 123 } is invalid');

    const result2 = validatePlan({ topics: 'not-an-array' });
    assert(result2.valid === false, '{ topics: "not-an-array" } is invalid');

    const result3 = validatePlan({ creativity: 'high' });
    assert(result3.valid === false, '{ creativity: "high" } is invalid');

    const result4 = validatePlan({ guardrails: [] });
    assert(result4.valid === false, '{ guardrails: [] } is invalid (must be object)');
  }

  // 1.5 Out-of-range values → rejects
  {
    const result1 = validatePlan({ creativity: 1.5 });
    assert(result1.valid === false, '{ creativity: 1.5 } exceeds max 1');

    const result2 = validatePlan({ creativity: -0.1 });
    assert(result2.valid === false, '{ creativity: -0.1 } below min 0');

    const result3 = validatePlan({ topics: [0, 1, 2, 3, 4, 5, 6] });
    assert(result3.valid === false, 'topics with 7 items exceeds maxItems 3');

    // Removed: lastTopicAge is not a top-level schema field, so validatePlan ignores it.
    // See guardrails sub-schema for maxTopics/minSim validation.
  }

  // 1.6 Invalid enum values → rejects
  {
    const result1 = validatePlan({ mode: 'fast' });
    assert(result1.valid === false, '{ mode: "fast" } not in enum');

    const result2 = validatePlan({ mode: '' });
    assert(result2.valid === false, '{ mode: "" } empty string not in enum');

    const result3 = validatePlan({ intent: 'summary' });
    assert(result3.valid === false, '{ intent: "summary" } not in enum');

    const result4 = validatePlan({ tone: 'funky' });
    assert(result4.valid === false, '{ tone: "funky" } not in enum');
  }

  // 1.7 Cross-field validation
  {
    // topics.length !== fragmentPlan.length — truncates fragmentPlan to topics.length
    const result1 = validatePlan({
      topics: [0, 1, 2],
      fragmentPlan: [{ topicIdx: 0, cats: ['def'], fragIndices: [0] }],
    });
    // fragmentPlan has 1 entry, topics has 3. New code pads fragmentPlan to match topics length.
    assert(result1.sanitized.fragmentPlan.length === 3, 'fragmentPlan padded to match topics (topics=3, fragPlan had 1 entry)');
    assert(result1.errors.some(e => e.includes('fragmentPlan')), 'Error logged for length mismatch');

    // Also test: fragmentPlan has 3, topics has 1 — should truncate
    const result2 = validatePlan({
      topics: [0],
      fragmentPlan: [
        { topicIdx: 0, cats: ['def'], fragIndices: [0] },
        { topicIdx: 1, cats: ['def'], fragIndices: [0] },
        { topicIdx: 2, cats: ['def'], fragIndices: [0] },
      ],
    });
    assert(result2.sanitized.fragmentPlan.length === 1, 'fragmentPlan truncated to match topics.length (1)');
    assert(result2.errors.some(e => e.includes('fragmentPlan')), 'Error logged for length mismatch');

    // mode=comparison with < 2 topics
    const result3 = validatePlan({
      mode: 'comparison',
      topics: [0],
      fragmentPlan: [{ topicIdx: 0, cats: ['def'], fragIndices: [0] }],
    });
    assert(result3.sanitized.mode === 'normal', 'comparison with <2 topics falls back to normal');

    // topicIdx out of range in fragmentPlan
    const result4 = validatePlan({
      topics: [0, 1],
      fragmentPlan: [
        { topicIdx: 0, cats: ['def'], fragIndices: [0] },
        { topicIdx: 99, cats: ['def'], fragIndices: [0] },
      ],
    });
    assert(result4.sanitized.fragmentPlan[1].topicIdx === 0, 'Out-of-range topicIdx corrected to 0');
  }

  // 1.8 isAnswerPlanLike
  {
    assert(isAnswerPlanLike(DEFAULT_PLAN) === true, 'DEFAULT_PLAN is answer-plan-like');
    assert(isAnswerPlanLike({ mode: 'normal', topics: [] }) === true, 'Minimal plan is answer-plan-like');
    assert(!isAnswerPlanLike(null), 'null is not answer-plan-like (returns falsy)');
    assert(isAnswerPlanLike({ mode: 'normal' }) === false, '{ mode } only is not answer-plan-like (needs topics array)');
    assert(isAnswerPlanLike({ topics: [] }) === false, '{ topics } only is not answer-plan-like (needs mode string)');
  }
}

// ---------------------------------------------------------------------------
// 2. Feature Extraction Tests
// ---------------------------------------------------------------------------

function runFeatureTests() {
  section('2. extractPolicyFeatures() — Feature Extraction Tests');

  const KB = makeMockKB();
  const config = makeMockConfig();
  const qEmb = makeMockQEmb();
  const ranked = makeMockRanked();
  const entities = [0]; // Nash Equilibrium matched

  // 2.1 Feature count
  {
    const features = extractPolicyFeatures(
      'What is Nash equilibrium?',
      qEmb, ranked, entities,
      makeMockIntentScores(),
      null, null,
      KB, config
    );
    const keys = Object.keys(features);
    assert(keys.length === 24, `Feature object has 24 keys (got ${keys.length})`);

    // Check expected keys
    const expectedKeys = [
      'qSimTop1', 'qSimTop2', 'entityCount', 'entityBoostHit',
      'intentDefScore', 'intentExScore', 'intentFormScore', 'intentAppScore', 'intentCompScore',
      'lastTopicSim', 'lastTopicAge', 'kbCoverage', 'queryLenTokens',
      'hasComparisonCue', 'hasFormalCue', 'hasExampleCue',
      'botCreativity', 'domainMatch',
      'followUpType', 'wasAmbiguous',
      'avgTruthConf', 'avgSourceConf', 'minDifficulty', 'fragDiversity',
    ];
    for (const k of expectedKeys) {
      assert(keys.includes(k), `Feature key "${k}" is present`);
    }
  }

  // 2.2 Normal query
  {
    const features = extractPolicyFeatures(
      'What is a neural network?',
      qEmb, ranked, entities,
      makeMockIntentScores(),
      null, null,
      KB, config
    );
    assert(features.qSimTop1 >= 0 && features.qSimTop1 <= 1, 'qSimTop1 is in [0,1]');
    assert(features.qSimTop2 >= 0 && features.qSimTop2 <= 1, 'qSimTop2 is in [0,1]');
    assert(features.entityCount >= 0, 'entityCount >= 0');
    assert(features.intentDefScore >= 0 && features.intentDefScore <= 1, 'intentDefScore in [0,1]');
  }

  // 2.3 Empty query
  {
    const features = extractPolicyFeatures(
      '',
      qEmb, ranked, [],
      makeMockIntentScores({ definition: 0, example: 0, formal: 0, application: 0, comparison: 0 }),
      null, null,
      KB, config
    );
    assert(features.queryLenTokens >= 1, 'queryLenTokens minimum is 1 (even for empty)');
    // qSimTop1 comes from ranked array (which is provided by caller), not from query string
    assert(features.qSimTop1 >= 0 && features.qSimTop1 <= 1, 'qSimTop1 is in [0,1] (from ranked array)');
    assert(features.entityCount === 0, 'entityCount is 0 for empty query');
    assert(features.hasComparisonCue === false, 'hasComparisonCue is false for empty query');
    assert(features.hasFormalCue === false, 'hasFormalCue is false for empty query');
    assert(features.hasExampleCue === false, 'hasExampleCue is false for empty query');
  }

  // 2.4 Entity match
  {
    const features = extractPolicyFeatures(
      'Tell me about Nash equilibrium',
      qEmb, ranked, [0], // entity 0 (Nash) is matched
      makeMockIntentScores(),
      null, null,
      KB, config
    );
    assert(features.entityCount > 0, 'entityCount > 0 when entity is found');
    assert(features.entityBoostHit === true, 'entityBoostHit is true when top-ranked matches entity');
  }

  // 2.5 Comparison cues
  {
    const featuresComp1 = extractPolicyFeatures(
      'What is the difference between CNN and RNN?',
      qEmb, ranked, [],
      makeMockIntentScores(),
      null, null, KB, config
    );
    assert(featuresComp1.hasComparisonCue === true, '"difference between X and Y" triggers hasComparisonCue');

    const featuresComp2 = extractPolicyFeatures(
      'Compare machine learning and deep learning',
      qEmb, ranked, [],
      makeMockIntentScores(),
      null, null, KB, config
    );
    assert(featuresComp2.hasComparisonCue === true, '"Compare X and Y" triggers hasComparisonCue');

    const featuresVs = extractPolicyFeatures(
      'CNN vs RNN',
      qEmb, ranked, [],
      makeMockIntentScores(),
      null, null, KB, config
    );
    assert(featuresVs.hasComparisonCue === true, '"X vs Y" triggers hasComparisonCue');

    const featuresNormal = extractPolicyFeatures(
      'Tell me about neural networks',
      qEmb, ranked, [],
      makeMockIntentScores(),
      null, null, KB, config
    );
    assert(featuresNormal.hasComparisonCue === false, 'Normal query hasComparisonCue is false');
  }

  // 2.6 Formal cues
  {
    const featuresFormal1 = extractPolicyFeatures(
      'Prove that gradient descent converges',
      qEmb, ranked, [],
      makeMockIntentScores(),
      null, null, KB, config
    );
    assert(featuresFormal1.hasFormalCue === true, '"Prove" triggers hasFormalCue');

    const featuresFormal2 = extractPolicyFeatures(
      'Give the mathematical definition of entropy',
      qEmb, ranked, [],
      makeMockIntentScores(),
      null, null, KB, config
    );
    assert(featuresFormal2.hasFormalCue === true, '"mathematical" triggers hasFormalCue');

    const featuresFormal3 = extractPolicyFeatures(
      "What's a theorem about topology?",
      qEmb, ranked, [],
      makeMockIntentScores(),
      null, null, KB, config
    );
    assert(featuresFormal3.hasFormalCue === true, '"theorem" triggers hasFormalCue');
  }

  // 2.7 Example cues
  {
    const featuresEx1 = extractPolicyFeatures(
      'Give me an example of recursion',
      qEmb, ranked, [],
      makeMockIntentScores(),
      null, null, KB, config
    );
    assert(featuresEx1.hasExampleCue === true, '"example" triggers hasExampleCue');

    const featuresEx2 = extractPolicyFeatures(
      'Illustrate how quicksort works',
      qEmb, ranked, [],
      makeMockIntentScores(),
      null, null, KB, config
    );
    assert(featuresEx2.hasExampleCue === true, '"Illustrate" triggers hasExampleCue');
  }

  // 2.8 Feature packing
  {
    const features = extractPolicyFeatures(
      'What is Nash equilibrium?',
      qEmb, ranked, entities,
      makeMockIntentScores(),
      null, null,
      KB, config
    );
    const packed = packFeatures(features);

    assert(packed.float32 instanceof Float32Array, 'float32 is Float32Array');
    assert(packed.float32.length === 24, 'float32 has 24 elements');
    assert(packed.uint8 instanceof Uint8Array, 'uint8 is Uint8Array');
    assert(packed.uint8.length === 7, 'uint8 has 7 elements');
    assert(packed.buffer.byteLength === 103, 'buffer is 103 bytes (24*4 + 7)');
  }

  // 2.9 Feature unpacking (round-trip)
  {
    const features = extractPolicyFeatures(
      'What is Nash equilibrium?',
      qEmb, ranked, entities,
      makeMockIntentScores(),
      null, null,
      KB, config
    );
    const packed = packFeatures(features);
    const unpacked = unpackFeatures(packed);

    // Check uint8-derived values are exact
    assert(unpacked.entityCount === features.entityCount, 'entityCount round-trips exactly');
    assert(unpacked.lastTopicAge === features.lastTopicAge, 'lastTopicAge round-trips exactly');
    assert(unpacked.queryLenTokens === features.queryLenTokens, 'queryLenTokens round-trips exactly');
    assert(unpacked.followUpType === features.followUpType, 'followUpType round-trips exactly');
    assert(unpacked.minDifficulty === features.minDifficulty, 'minDifficulty round-trips exactly');
    assert(unpacked.fragDiversity === features.fragDiversity, 'fragDiversity round-trips exactly');

    // Check booleans round-trip
    assert(unpacked.entityBoostHit === features.entityBoostHit, 'entityBoostHit round-trips exactly');
    assert(unpacked.hasComparisonCue === features.hasComparisonCue, 'hasComparisonCue round-trips exactly');
    assert(unpacked.hasFormalCue === features.hasFormalCue, 'hasFormalCue round-trips exactly');
    assert(unpacked.hasExampleCue === features.hasExampleCue, 'hasExampleCue round-trips exactly');
    assert(unpacked.wasAmbiguous === features.wasAmbiguous, 'wasAmbiguous round-trips exactly');

    // Check float values within tolerance
    for (const key of ['qSimTop1', 'qSimTop2', 'intentDefScore', 'kbCoverage', 'botCreativity', 'domainMatch', 'avgTruthConf', 'avgSourceConf']) {
      const diff = Math.abs(unpacked[key] - features[key]);
      assert(diff < 0.001, `${key} round-trips within 0.001 (diff=${diff.toFixed(6)})`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Policy Runtime Tests
// ---------------------------------------------------------------------------

function runRuntimeTests() {
  section('3. planAnswerHeuristic() — Policy Runtime Tests');

  const KB = makeMockKB();
  const config = makeMockConfig();

  // 3.1 Mode detection — greeting
  {
    const lowSimFeatures = {
      qSimTop1: 0.12,
      qSimTop2: 0.08,
      entityCount: 0,
      queryLenTokens: 2,
      hasComparisonCue: false,
      hasFormalCue: false,
      hasExampleCue: false,
      intentDefScore: 0.15,
      intentExScore: 0.12,
      intentFormScore: 0.10,
      intentAppScore: 0.08,
      intentCompScore: 0.05,
      lastTopicSim: 0,
      lastTopicAge: 0,
      kbCoverage: 0.1,
      botCreativity: 0.5,
      domainMatch: 0.3,
    };
    const plan = planAnswerHeuristic(lowSimFeatures, KB, config, {});
    assert(plan.mode === 'greeting', 'Low sim + short query + no content cues → greeting mode');
    assert(
      plan.meta.decisionPath.some(d => d.includes('greeting')),
      'decisionPath includes "greeting"'
    );
  }

  // 3.2 Mode detection — off_topic (low sim + content cues)
  {
    const offTopicFeatures = {
      qSimTop1: 0.12,
      qSimTop2: 0.08,
      entityCount: 0,
      queryLenTokens: 5,
      hasComparisonCue: false,
      hasFormalCue: true,  // has formal cue
      hasExampleCue: false,
      intentDefScore: 0.15,
      intentExScore: 0.12,
      intentFormScore: 0.10,
      intentAppScore: 0.08,
      intentCompScore: 0.05,
      lastTopicSim: 0,
      lastTopicAge: 0,
      kbCoverage: 0.1,
      botCreativity: 0.5,
      domainMatch: 0.3,
    };
    const plan = planAnswerHeuristic(offTopicFeatures, KB, config, {});
    assert(plan.mode === 'off_topic', 'Low sim + formal cue → off_topic mode');
    assert(
      plan.meta.decisionPath.some(d => d.includes('off_topic')),
      'decisionPath includes "off_topic"'
    );
  }

  // 3.3 Mode detection — normal
  {
    const normalFeatures = {
      qSimTop1: 0.72,
      qSimTop2: 0.45,
      entityCount: 0,
      queryLenTokens: 6,
      hasComparisonCue: false,
      hasFormalCue: false,
      hasExampleCue: false,
      intentDefScore: 0.65,
      intentExScore: 0.42,
      intentFormScore: 0.21,
      intentAppScore: 0.33,
      intentCompScore: 0.55,
      lastTopicSim: 0,
      lastTopicAge: 0,
      kbCoverage: 0.5,
      botCreativity: 0.5,
      domainMatch: 0.6,
    };
    const plan = planAnswerHeuristic(normalFeatures, KB, config, {});
    assert(plan.mode === 'normal', 'Normal query → normal mode');
  }

  // 3.4 Bot profile creativity ceiling respected
  {
    const lowCeilingConfig = {
      botProfile: {
        ...config.botProfile,
        creativityCeiling: 0.2,
      }
    };
    const normalFeatures = {
      qSimTop1: 0.72, qSimTop2: 0.45, entityCount: 0, queryLenTokens: 6,
      hasComparisonCue: false, hasFormalCue: false, hasExampleCue: false,
      intentDefScore: 0.65, intentExScore: 0.42, intentFormScore: 0.21,
      intentAppScore: 0.33, intentCompScore: 0.55,
      lastTopicSim: 0, lastTopicAge: 0, kbCoverage: 0.5,
      botCreativity: 0.5, domainMatch: 0.6,
    };
    const plan = planAnswerHeuristic(normalFeatures, KB, lowCeilingConfig, {});
    assert(plan.creativity <= 0.2, `creativity capped by botProfile (got ${plan.creativity}, expected ≤0.2)`);
  }

  // 3.5 Bot profile tone respected, with formal override
  {
    // Start with neutral tone from botProfile, then hasFormalCue should override
    const neutralConfig = {
      botProfile: {
        ...config.botProfile,
        tone: 'neutral',  // start neutral so override adds to decisionPath
      }
    };
    const normalFeatures = {
      qSimTop1: 0.72, qSimTop2: 0.45, entityCount: 0, queryLenTokens: 6,
      hasComparisonCue: false, hasFormalCue: true,  // query has formal cue
      hasExampleCue: false,
      intentDefScore: 0.65, intentExScore: 0.42, intentFormScore: 0.21,
      intentAppScore: 0.33, intentCompScore: 0.55,
      lastTopicSim: 0, lastTopicAge: 0, kbCoverage: 0.5,
      botCreativity: 0.5, domainMatch: 0.6,
    };
    const plan = planAnswerHeuristic(normalFeatures, KB, neutralConfig, {});
    assert(plan.tone === 'formal', 'hasFormalCue overrides tone to formal');
    assert(
      plan.meta.decisionPath.some(d => d.includes('tone:formal')),
      'decisionPath notes tone override'
    );
  }

  // 3.6 Fragment plan structure
  {
    const normalFeatures = {
      qSimTop1: 0.72, qSimTop2: 0.45, entityCount: 0, queryLenTokens: 6,
      hasComparisonCue: false, hasFormalCue: false, hasExampleCue: false,
      intentDefScore: 0.65, intentExScore: 0.42, intentFormScore: 0.21,
      intentAppScore: 0.33, intentCompScore: 0.55,
      lastTopicSim: 0, lastTopicAge: 0, kbCoverage: 0.5,
      botCreativity: 0.5, domainMatch: 0.6,
    };
    const plan = planAnswerHeuristic(normalFeatures, KB, config, {});
    assert(Array.isArray(plan.fragmentPlan), 'fragmentPlan is an array');
    for (const fp of plan.fragmentPlan) {
      assert(typeof fp.topicIdx === 'number', 'fragmentPlan entry has topicIdx (number)');
      assert(Array.isArray(fp.cats), 'fragmentPlan entry has cats (array)');
      assert(Array.isArray(fp.fragIndices), 'fragmentPlan entry has fragIndices (array)');
    }
  }

  // 3.7 Template structure
  {
    const normalFeatures = {
      qSimTop1: 0.72, qSimTop2: 0.45, entityCount: 0, queryLenTokens: 6,
      hasComparisonCue: false, hasFormalCue: false, hasExampleCue: false,
      intentDefScore: 0.65, intentExScore: 0.42, intentFormScore: 0.21,
      intentAppScore: 0.33, intentCompScore: 0.55,
      lastTopicSim: 0, lastTopicAge: 0, kbCoverage: 0.5,
      botCreativity: 0.5, domainMatch: 0.6,
    };
    const plan = planAnswerHeuristic(normalFeatures, KB, config, {});
    assert(typeof plan.template.openerIdx === 'number', 'template.openerIdx is a number');
    assert(typeof plan.template.closerIdx === 'number', 'template.closerIdx is a number');
    assert(['both', 'contrast', 'similarity', 'none'].includes(plan.template.comparisonOpenerKey),
      'template.comparisonOpenerKey is valid enum value');
    assert(Array.isArray(plan.template.connectorKeys), 'template.connectorKeys is an array');
  }

  // 3.8 Guardrails
  {
    const normalFeatures = {
      qSimTop1: 0.72, qSimTop2: 0.45, entityCount: 0, queryLenTokens: 6,
      hasComparisonCue: false, hasFormalCue: false, hasExampleCue: false,
      intentDefScore: 0.65, intentExScore: 0.42, intentFormScore: 0.21,
      intentAppScore: 0.33, intentCompScore: 0.55,
      lastTopicSim: 0, lastTopicAge: 0, kbCoverage: 0.5,
      botCreativity: 0.5, domainMatch: 0.6,
    };
    const plan = planAnswerHeuristic(normalFeatures, KB, config, {});
    assert(typeof plan.guardrails.maxTopics === 'number', 'guardrails.maxTopics is a number');
    assert(plan.guardrails.maxTopics === 3, 'guardrails.maxTopics defaults to 3');
    assert(plan.guardrails.requireEntity === false, 'guardrails.requireEntity is false');
    assert(plan.guardrails.minSim === 0.15, 'guardrails.minSim is 0.15');
    assert(plan.guardrails.allowOffTopic === false, 'guardrails.allowOffTopic is false for normal mode');
  }

  // 3.9 Intent selection
  {
    const featuresDef = {
      qSimTop1: 0.72, qSimTop2: 0.45, entityCount: 0, queryLenTokens: 6,
      hasComparisonCue: false, hasFormalCue: false, hasExampleCue: false,
      intentDefScore: 0.80, intentExScore: 0.42, intentFormScore: 0.21,
      intentAppScore: 0.33, intentCompScore: 0.55,
      lastTopicSim: 0, lastTopicAge: 0, kbCoverage: 0.5,
      botCreativity: 0.5, domainMatch: 0.6,
    };
    const planDef = planAnswerHeuristic(featuresDef, KB, config, {});
    assert(planDef.intent === 'definition', 'Highest intent score wins → definition');

    const featuresComp = {
      ...featuresDef,
      intentDefScore: 0.30,
      intentCompScore: 0.85,
    };
    const planComp = planAnswerHeuristic(featuresComp, KB, config, {});
    assert(planComp.intent === 'comparison', 'Highest intent score wins → comparison');
  }

  // 3.10 Comparison intent fallback when qSimTop2 is low
  {
    const featuresLowSim2 = {
      qSimTop1: 0.72, qSimTop2: 0.20, entityCount: 0, queryLenTokens: 6,
      hasComparisonCue: false, hasFormalCue: false, hasExampleCue: false,
      intentDefScore: 0.30,
      intentExScore: 0.25,
      intentFormScore: 0.21,
      intentAppScore: 0.33,
      intentCompScore: 0.85,  // comparison wins raw
      lastTopicSim: 0, lastTopicAge: 0, kbCoverage: 0.5,
      botCreativity: 0.5, domainMatch: 0.6,
    };
    const plan = planAnswerHeuristic(featuresLowSim2, KB, config, {});
    assert(
      plan.intent !== 'comparison',
      'comparison intent falls back when qSimTop2 < 0.25'
    );
    assert(
      plan.meta.decisionPath.some(d => d.includes('intent-fallback')),
      'decisionPath notes intent fallback'
    );
  }
}

// ---------------------------------------------------------------------------
// 4. MLP Inference Tests
// ---------------------------------------------------------------------------

function makeSyntheticWeights(version = 2) {
  const w = { _version: version };
  // fc1: [128, 24], fc1.bias: [128]
  w['fc1.weight'] = Array.from({ length: 128 }, () =>
    Array.from({ length: 24 }, () => Math.random() * 2 - 1));
  w['fc1.bias'] = Array.from({ length: 128 }, () => Math.random() * 0.5);
  // fc2: [64, 128], fc2.bias: [64]
  w['fc2.weight'] = Array.from({ length: 64 }, () =>
    Array.from({ length: 128 }, () => Math.random() * 2 - 1));
  w['fc2.bias'] = Array.from({ length: 64 }, () => Math.random() * 0.5);
  // mode_head: [5, 64], mode_head.bias: [5]
  w['mode_head.weight'] = Array.from({ length: 5 }, () =>
    Array.from({ length: 64 }, () => Math.random()));
  w['mode_head.bias'] = Array.from({ length: 5 }, () => 0);
  // intent_head: [5, 64], intent_head.bias: [5]
  w['intent_head.weight'] = Array.from({ length: 5 }, () =>
    Array.from({ length: 64 }, () => Math.random()));
  w['intent_head.bias'] = Array.from({ length: 5 }, () => 0);
  // topic_count_head: [4, 64], bias: [4]
  w['topic_count_head.weight'] = Array.from({ length: 4 }, () =>
    Array.from({ length: 64 }, () => Math.random()));
  w['topic_count_head.bias'] = Array.from({ length: 4 }, () => 0);
  // frag_count_head: [4, 64], bias: [4]
  w['frag_count_head.weight'] = Array.from({ length: 4 }, () =>
    Array.from({ length: 64 }, () => Math.random()));
  w['frag_count_head.bias'] = Array.from({ length: 4 }, () => 0);
  // creativity_head: [1, 64], bias: [1]
  w['creativity_head.weight'] = [Array.from({ length: 64 }, () => Math.random() * 2 - 1)];
  w['creativity_head.bias'] = [0];
  // tone_head: [4, 64], bias: [4]
  w['tone_head.weight'] = Array.from({ length: 4 }, () =>
    Array.from({ length: 64 }, () => Math.random()));
  w['tone_head.bias'] = Array.from({ length: 4 }, () => 0);
  return w;
}

function runMLPTests() {
  section('4. MLPPolicy — Inference Tests');

  // 4.1 Construction from valid weights
  {
    const weights = makeSyntheticWeights();
    const policy = new MLPPolicy(weights);
    assert(policy instanceof MLPPolicy, 'MLPPolicy constructed from valid weights');
    assert(policy._version === 2, 'version preserved from weights');
  }

  // 4.2 Missing weight key throws
  {
    const badWeights = makeSyntheticWeights();
    delete badWeights['fc1.weight'];
    let threw = false;
    try { new MLPPolicy(badWeights); } catch (e) { threw = true; }
    assert(threw, 'Missing fc1.weight throws');
  }

  // 4.3 Forward pass produces correct output shapes
  {
    const weights = makeSyntheticWeights();
    const policy = new MLPPolicy(weights);
    const features = new Float32Array(24).fill(0.5);
    const out = policy.forward(features);
    assert(out.modeProbs.length === 5, 'modeProbs length is 5');
    assert(out.intentProbs.length === 5, 'intentProbs length is 5');
    assert(out.topicCountProbs.length === 4, 'topicCountProbs length is 4');
    assert(out.fragCountProbs.length === 4, 'fragCountProbs length is 4');
    assert(typeof out.creativity === 'number', 'creativity is a number');
    assert(out.toneProbs.length === 4, 'toneProbs length is 4');
  }

  // 4.4 Forward pass is deterministic
  {
    const weights = makeSyntheticWeights();
    const policy = new MLPPolicy(weights);
    const features = new Float32Array(24).fill(0.5);
    const out1 = policy.forward(features);
    const out2 = policy.forward(features);
    assert(out1.modeProbs.every((v, i) => v === out2.modeProbs[i]), 'forward pass is deterministic');
  }

  // 4.5 Softmax outputs sum to 1
  {
    const weights = makeSyntheticWeights();
    const policy = new MLPPolicy(weights);
    const features = new Float32Array(24).fill(0.5);
    const out = policy.forward(features);
    const sumMode = [...out.modeProbs].reduce((a, b) => a + b, 0);
    assert(Math.abs(sumMode - 1) < 0.001, 'modeProbs sum to 1');
    const sumIntent = [...out.intentProbs].reduce((a, b) => a + b, 0);
    assert(Math.abs(sumIntent - 1) < 0.001, 'intentProbs sum to 1');
  }

  // 4.6 planAnswer generates valid AnswerPlan
  {
    const weights = makeSyntheticWeights();
    const policy = new MLPPolicy(weights);
    const features = {
      qSimTop1: 0.7, qSimTop2: 0.4, entityCount: 1, entityBoostHit: true,
      intentDefScore: 0.6, intentExScore: 0.4, intentFormScore: 0.3,
      intentAppScore: 0.35, intentCompScore: 0.5,
      lastTopicSim: 0, lastTopicAge: 2, kbCoverage: 0.5, queryLenTokens: 5,
      hasComparisonCue: false, hasFormalCue: false, hasExampleCue: false,
      botCreativity: 0.4, domainMatch: 0.5,
      followUpType: 0, wasAmbiguous: false,
      avgTruthConf: 0.8, avgSourceConf: 0.7, minDifficulty: 1, fragDiversity: 3,
    };
    const context = {
      ranked: [{ i: 0, s: 0.7 }, { i: 1, s: 0.4 }],
      entities: [0],
    };
    const plan = policy.planAnswer(features, context, { maxTopics: 3, creativityCeiling: 0.5 });
    const { valid, errors } = validatePlan(plan);
    assert(valid === true, `MLP planAnswer generates valid plan (errors: ${errors.join(', ')})`);
    assert(Array.isArray(plan.topics), 'topics is an array');
    assert(typeof plan.mode === 'string', 'mode is string');
    assert(typeof plan.intent === 'string', 'intent is string');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { section: targetSection, json } = getArgs();

  console.log(`${YELLOW}ReLU.chat Policy Runtime — Node.js Test Suite${RESET}`);
  console.log(`Node.js ${process.version} | ${new Date().toISOString()}\n`);

  const start = Date.now();

  try {
    if (targetSection === 'all' || targetSection === 'validation') {
      runValidationTests();
    }
    if (targetSection === 'all' || targetSection === 'features') {
      runFeatureTests();
    }
    if (targetSection === 'all' || targetSection === 'runtime') {
      runRuntimeTests();
    }
    if (targetSection === 'all' || targetSection === 'mlp') {
      runMLPTests();
    }
  } catch (err) {
    console.error(`\n${RED}Test suite crashed:${RESET}`, err.message);
    if (!json) {
      console.error(err.stack);
    }
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`\n${YELLOW}━━━ Results ━━━${RESET}`);
  console.log(`  ${GREEN}Passed:${RESET} ${passCount}`);
  console.log(`  ${RED}Failed:${RESET} ${failCount}`);
  console.log(`  Time: ${elapsed}s`);

  if (json) {
    console.log(JSON.stringify({
      passed: passCount,
      failed: failCount,
      elapsed_s: parseFloat(elapsed),
      timestamp: new Date().toISOString(),
    }));
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main();
