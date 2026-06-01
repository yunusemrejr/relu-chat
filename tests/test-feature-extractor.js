/**
 * test-feature-extractor.js — Unit tests for Policy feature extraction
 * (policy/feature-extractor.js)
 *
 * Tests: extractPolicyFeatures, packFeatures, unpackFeatures,
 * cue word detection, feature ranges.
 *
 * Run:  node tests/test-feature-extractor.js
 */

import { extractPolicyFeatures, packFeatures, unpackFeatures } from '../policy/feature-extractor.js';

// ── Test harness ───────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; process.stdout.write('\x1b[32m.\x1b[0m'); }
  else { failed++; failures.push(msg); process.stdout.write('\x1b[31mF\x1b[0m'); }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) { passed++; process.stdout.write('\x1b[32m.\x1b[0m'); }
  else {
    failed++; failures.push(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}

function assertApprox(actual, expected, msg, tol = 0.0001) {
  if (Math.abs(actual - expected) <= tol) { passed++; process.stdout.write('\x1b[32m.\x1b[0m'); }
  else {
    failed++; failures.push(`${msg}: expected ~${expected}, got ${actual}`);
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}

function assertRange(v, lo, hi, msg) {
  if (v >= lo && v <= hi) { passed++; process.stdout.write('\x1b[32m.\x1b[0m'); }
  else {
    failed++; failures.push(`${msg}: ${v} not in [${lo}, ${hi}]`);
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}

// ── Test fixtures ──────────────────────────────────────────────────────────

// Minimal KB for tests
const KB = [
  { id: 'relu', name: 'ReLU', f: {} },
  { id: 'softmax', name: 'Softmax', f: {} },
  { id: 'sgd', name: 'SGD', f: {} },
];

// Mock ranked entries
const ranked = [
  { i: 0, s: 0.85 },
  { i: 1, s: 0.72 },
  { i: 2, s: 0.45 },
];

// Mock embedding (normalized length)
const qEmb = new Array(64).fill(0);
qEmb[0] = 1; // simple vector

const entryEmb = [
  new Array(64).fill(0), // KB[0] embedding
  new Array(64).fill(0), // KB[1] embedding
  new Array(64).fill(0), // KB[2] embedding
];
entryEmb[0][0] = 1;  // exact match
entryEmb[1][1] = 1;  // orthogonal to qEmb
entryEmb[2][2] = 1;

// ────────────────────────────────────────────────────────────────────────────

const intentScores = {
  definition: 0.75,
  example: 0.30,
  formal: 0.15,
  application: 0.20,
  comparison: 0.05,
};

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: Basic extraction with minimal inputs
// ════════════════════════════════════════════════════════════════════════════
{
  const features = extractPolicyFeatures(
    'what is ReLU',
    qEmb,
    ranked,
    [0],           // entity found: KB[0]
    intentScores,
    0,              // lastTopic = KB[0]
    0,              // lastTopicAge
    KB,
    {},             // config
    entryEmb,
    null,           // followUp
    false           // wasAmbiguous
  );
  assert(features !== undefined, 'features object returned');
  assertEq(features.entityCount, 1, 'entityCount = 1');
  assert(features.entityBoostHit, 'entityBoostHit = true (ranked[0] is entity 0)');
  assertApprox(features.qSimTop1, 0.85, 'qSimTop1 from ranked');
  assertApprox(features.qSimTop2, 0.72, 'qSimTop2 from ranked');
  assertApprox(features.intentDefScore, 0.75, 'intentDefScore preserved');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: Feature values in expected ranges [0,1] (f32 features)
// ════════════════════════════════════════════════════════════════════════════
{
  const features = extractPolicyFeatures(
    'what is ReLU',
    qEmb,
    ranked,
    [0],
    intentScores,
    0, 0, KB, {}, entryEmb, null, false
  );
  assertRange(features.qSimTop1, 0, 1, 'qSimTop1 in [0,1]');
  assertRange(features.qSimTop2, 0, 1, 'qSimTop2 in [0,1]');
  assertRange(features.entityCount, 0, 3, 'entityCount in [0,3]');
  assertRange(features.intentDefScore, 0, 1, 'intentDefScore in [0,1]');
  assertRange(features.lastTopicSim, 0, 1, 'lastTopicSim in [0,1]');
  assertRange(features.lastTopicAge, 0, 8, 'lastTopicAge in [0,8]');
  assertRange(features.kbCoverage, 0, 1, 'kbCoverage in [0,1]');
  assertRange(features.queryLenTokens, 1, 32, 'queryLenTokens in [1,32]');
  assertRange(features.botCreativity, 0, 1, 'botCreativity in [0,1]');
  assertRange(features.domainMatch, 0, 1, 'domainMatch in [0,1]');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: Cue word detection — comparison
// ════════════════════════════════════════════════════════════════════════════
{
  const features = extractPolicyFeatures(
    'compare ReLU vs softmax',
    qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb, null, false
  );
  assert(features.hasComparisonCue, 'comparison cue ("vs") detected');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: Cue word detection — formal
// ════════════════════════════════════════════════════════════════════════════
{
  const features = extractPolicyFeatures(
    'prove the theorem about ReLU',
    qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb, null, false
  );
  assert(features.hasFormalCue, 'formal cue ("prove", "theorem") detected');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: Cue word detection — example
// ════════════════════════════════════════════════════════════════════════════
{
  const features = extractPolicyFeatures(
    'give me an example of softmax',
    qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb, null, false
  );
  assert(features.hasExampleCue, 'example cue ("example") detected');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: No cue words detected
// ════════════════════════════════════════════════════════════════════════════
{
  const features = extractPolicyFeatures(
    'what is the meaning of this',
    qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb, null, false
  );
  assert(!features.hasComparisonCue, 'no comparison cue in neutral query');
  assert(!features.hasFormalCue, 'no formal cue in neutral query');
  assert(!features.hasExampleCue, 'no example cue in neutral query');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: Entity boost hit (entities match ranked entries)
// ════════════════════════════════════════════════════════════════════════════
{
  const featuresHit = extractPolicyFeatures(
    'query', qEmb,
    [{ i: 0, s: 0.9 }, { i: 1, s: 0.5 }],
    [0], // entity 0 is in top-5 ranked
    intentScores, null, null, KB, {}, entryEmb, null, false
  );
  assert(featuresHit.entityBoostHit, 'entity boost hit when entity in ranked');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: Entity boost miss (entities not in top ranked)
// ════════════════════════════════════════════════════════════════════════════
{
  const featuresMiss = extractPolicyFeatures(
    'query', qEmb,
    [{ i: 0, s: 0.9 }, { i: 1, s: 0.5 }],
    [2], // entity 2, which is NOT in the sample ranked above
    intentScores, null, null, KB, {}, entryEmb, null, false
  );
  assert(!featuresMiss.entityBoostHit, 'entity boost miss when entity not in ranked top-5');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 9: lastTopicSim computed when lastTopic set
// ════════════════════════════════════════════════════════════════════════════
{
  const features = extractPolicyFeatures(
    'query', qEmb, ranked, [], intentScores,
    0, 2, KB, {}, entryEmb, null, false
  );
  // lastTopic=0, entryEmb[0] = qEmb → sim = 1.0
  assertApprox(features.lastTopicSim, 1.0, 'lastTopicSim = 1.0 when embeddings match');
  assertEq(features.lastTopicAge, 2, 'lastTopicAge = 2');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 10: followUpType encoded correctly
// ════════════════════════════════════════════════════════════════════════════
{
  const f1 = extractPolicyFeatures(
    'query', qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb,
    { isFollowUp: true, type: 'simplify' }, false
  );
  assertEq(f1.followUpType, 1, 'simplify → type 1');

  const f0 = extractPolicyFeatures(
    'query', qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb,
    null, false
  );
  assertEq(f0.followUpType, 0, 'no followUp → type 0');

  const f3 = extractPolicyFeatures(
    'query', qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb,
    { isFollowUp: true, type: 'example' }, false
  );
  assertEq(f3.followUpType, 3, 'example → type 3');
  // example should boost intentExScore
  assert(f3.hasExampleCue, 'example follow-up sets hasExampleCue = true');
  assert(f3.intentExScore >= 0.75, 'example follow-up boosts intentExScore');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 11: wasAmbiguous flag
// ════════════════════════════════════════════════════════════════════════════
{
  const fTrue = extractPolicyFeatures(
    'query', qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb, null, true
  );
  assertEq(fTrue.wasAmbiguous, true, 'wasAmbiguous=true when passed');

  const fFalse = extractPolicyFeatures(
    'query', qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb, null, false
  );
  assertEq(fFalse.wasAmbiguous, false, 'wasAmbiguous=false when passed');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 12: packFeatures round-trip (pack → unpack → same features)
// ════════════════════════════════════════════════════════════════════════════
{
  const original = extractPolicyFeatures(
    'compare ReLU vs softmax',
    qEmb, ranked, [0, 1], intentScores, 0, 1, KB, {}, entryEmb,
    { isFollowUp: true, type: 'example' }, true
  );
  const packed = packFeatures(original);
  const unpacked = unpackFeatures(packed);

  // Check key fields round-trip
  assertApprox(unpacked.qSimTop1, original.qSimTop1, 'round-trip: qSimTop1');
  assertApprox(unpacked.qSimTop2, original.qSimTop2, 'round-trip: qSimTop2');
  assertEq(unpacked.entityCount, original.entityCount, 'round-trip: entityCount');
  assertEq(unpacked.entityBoostHit, original.entityBoostHit, 'round-trip: entityBoostHit');
  assertApprox(unpacked.intentDefScore, original.intentDefScore, 'round-trip: intentDefScore');
  assertApprox(unpacked.intentExScore, original.intentExScore, 'round-trip: intentExScore');
  assertEq(unpacked.hasComparisonCue, original.hasComparisonCue, 'round-trip: hasComparisonCue');
  assertEq(unpacked.hasExampleCue, original.hasExampleCue, 'round-trip: hasExampleCue');
  assertEq(unpacked.followUpType, original.followUpType, 'round-trip: followUpType');
  assertEq(unpacked.wasAmbiguous, original.wasAmbiguous, 'round-trip: wasAmbiguous');
  assertEq(unpacked.lastTopicAge, original.lastTopicAge, 'round-trip: lastTopicAge');
  assertEq(unpacked.queryLenTokens, original.queryLenTokens, 'round-trip: queryLenTokens');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 13: packFeatures buffer size = 107 bytes (25*4 + 7)
// ════════════════════════════════════════════════════════════════════════════
{
  const original = extractPolicyFeatures(
    'test', qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb, null, false
  );
  const packed = packFeatures(original);
  assertEq(packed.buffer.byteLength, 107, 'packed buffer is 107 bytes');
  assertEq(packed.float32.length, 25, 'float32 array has 25 elements');
  assertEq(packed.uint8.length, 7, 'uint8 array has 7 elements');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 14: Minimum difficulty and fragment diversity (no fragments)
// ════════════════════════════════════════════════════════════════════════════
{
  const features = extractPolicyFeatures(
    'query', qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb, null, false
  );
  assertEq(features.minDifficulty, 0, 'minDifficulty defaults to 0 when no annotated fragments');
  assertEq(features.fragDiversity, 0, 'fragDiversity defaults to 0 when no fragments');
  assertEq(features.avgTruthConf, 0, 'avgTruthConf defaults to 0');
  assertEq(features.avgSourceConf, 0, 'avgSourceConf defaults to 0');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 15: Object.freeze — features is frozen
// ════════════════════════════════════════════════════════════════════════════
{
  const features = extractPolicyFeatures(
    'query', qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb, null, false
  );
  assert(Object.isFrozen(features), 'features object is frozen');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 16: Unpacked features object is also frozen
// ════════════════════════════════════════════════════════════════════════════
{
  const packed = packFeatures(extractPolicyFeatures(
    'query', qEmb, ranked, [], intentScores, null, null, KB, {}, entryEmb, null, false
  ));
  const unpacked = unpackFeatures(packed);
  assert(Object.isFrozen(unpacked), 'unpacked features object is frozen');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('\n');
console.log(`\x1b[1mFeature Extractor Tests:\x1b[0m ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n' + failures.map(f => `  \x1b[31mFAIL\x1b[0m ${f}`).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
