#!/usr/bin/env node
/**
 * test-followup.js — Follow-up detection & context continuity tests
 *
 * Validates that short, context-dependent prompts are correctly detected
 * and that topic continuity is preserved across multiple follow-up turns.
 *
 * Run: node dev/benchmarks/test-followup.js
 */

import { SessionMemory } from '../../core/session.js';
import { extractPolicyFeatures } from '../../policy/feature-extractor.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function assertEq(actual, expected, label) {
  const ok = actual === expected;
  if (!ok) {
    console.error(`    expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
  }
  assert(ok, label);
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ---------------------------------------------------------------------------
// 1. Follow-up type detection
// ---------------------------------------------------------------------------

section('Follow-up type detection');

const session = new SessionMemory(20);

// Seed session with a turn so follow-ups have context
session.addTurn(
  'What is a neural network?',
  'A neural network is a computing system inspired by biological neural networks.',
  [0], [0], ['nn:def']
);

const followUpTests = [
  // [query, expectedType, label]
  ['how?', 'how', '"how?" → how'],
  ['how so', 'how', '"how so" → how'],
  ['how does that work', 'how', '"how does that work" → how'],
  ['why?', 'why', '"why?" → why'],
  ['why is that', 'why', '"why is that" → why'],
  ['why does that happen', 'why', '"why does that happen" → why'],
  ['what else', 'what_else', '"what else" → what_else'],
  ['anything else', 'what_else', '"anything else" → what_else'],
  ['go on', 'continue', '"go on" → continue'],
  ['continue', 'continue', '"continue" → continue'],
  ['example?', 'example', '"example?" → example'],
  ['another', 'another_example', '"another" → another_example'],
  ['simpler', 'simplify', '"simpler" → simplify'],
  ['tell me more', 'elaborate', '"tell me more" → elaborate'],
  ['what do you mean', 'clarify', '"what do you mean" → clarify'],
  ["i don't get it", 'clarify', '"i don\'t get it" → clarify'],
  ['compare', 'comparison', '"compare" → comparison'],
  ['summarize', 'summarize', '"summarize" → summarize'],
  ['really', 'challenge', '"really" → challenge'],
  ['ok', 'acknowledge', '"ok" → acknowledge'],
  ['yes', 'affirm_continue', '"yes" → affirm_continue'],
  ['prove it', 'evidence', '"prove it" → evidence'],
  ['so what', 'relevance', '"so what" → relevance'],
  ['more details', 'deep_dive', '"more details" → deep_dive'],
];

for (const [query, expectedType, label] of followUpTests) {
  const result = session.detectSimpleFollowUp(query);
  assert(result.isFollowUp === true, `${label} (isFollowUp=true)`);
  assertEq(result.type, expectedType, `${label} (type)`);
}

// Non-follow-up queries should not be detected
const nonFollowUps = [
  'What is machine learning?',
  'Explain the difference between supervised and unsupervised learning',
  'Tell me about gradient descent optimization',
];
for (const query of nonFollowUps) {
  const result = session.detectSimpleFollowUp(query);
  assert(result.isFollowUp === false, `"${query}" → not follow-up`);
}

// ---------------------------------------------------------------------------
// 2. how vs why differentiation in feature extraction
// ---------------------------------------------------------------------------

section('how vs why feature differentiation');

const mockKB = [
  { id: 'nn', name: 'Neural Network', aliases: ['NN'], f: { def: ['def'], int: ['int'], ex: ['ex'], form: ['form'], app: ['app'] }, related: [] },
];
const mockEmb = [0.5, 0.3, 0.1];
const mockRanked = [{ i: 0, s: 0.7 }];
const mockIntentScores = { definition: 0.5, example: 0.3, formal: 0.2, application: 0.2, comparison: 0.1 };

// Test "how" features
const howFollowUp = { isFollowUp: true, type: 'how', target: 'last' };
const howFeatures = extractPolicyFeatures(
  'how?', mockEmb, mockRanked, [0], mockIntentScores,
  0, 1, mockKB, {}, [mockEmb], howFollowUp, false
);
assert(howFeatures.followUpType === 9, '"how" → followUpType=9');
assert(howFeatures.intentAppScore >= 0.5, '"how" boosts application intent');
assert(howFeatures.intentFormScore >= 0.45, '"how" boosts formal intent');

// Test "why" features
const whyFollowUp = { isFollowUp: true, type: 'why', target: 'last' };
const whyFeatures = extractPolicyFeatures(
  'why?', mockEmb, mockRanked, [0], mockIntentScores,
  0, 1, mockKB, {}, [mockEmb], whyFollowUp, false
);
assert(whyFeatures.followUpType === 10, '"why" → followUpType=10');
assert(whyFeatures.intentFormScore >= 0.5, '"why" boosts formal intent');
assert(whyFeatures.intentDefScore >= 0.4, '"why" boosts definition intent');

// how should boost application more than why
assert(
  howFeatures.intentAppScore >= whyFeatures.intentAppScore,
  '"how" application score >= "why" application score'
);

// why should boost formal more than or equal to how
assert(
  whyFeatures.intentFormScore >= howFeatures.intentFormScore,
  '"why" formal score >= "how" formal score'
);

// Test "what_else" features
const whatElseFollowUp = { isFollowUp: true, type: 'what_else', target: 'last' };
const whatElseFeatures = extractPolicyFeatures(
  'what else', mockEmb, mockRanked, [0], mockIntentScores,
  0, 1, mockKB, {}, [mockEmb], whatElseFollowUp, false
);
assert(whatElseFeatures.followUpType === 20, '"what_else" → followUpType=20');
assert(whatElseFeatures.intentAppScore >= 0.45, '"what_else" boosts application intent');
assert(whatElseFeatures.intentExScore >= 0.40, '"what_else" boosts example intent');

// ---------------------------------------------------------------------------
// 3. Topic continuity across follow-up sequence
// ---------------------------------------------------------------------------

section('Topic continuity across follow-up sequence');

const seqSession = new SessionMemory(20);

// Turn 1: User asks a technical question
seqSession.addTurn(
  'What is backpropagation?',
  'Backpropagation is an algorithm for training neural networks by computing gradients.',
  [0], [0], ['bp:def']
);
assertEq(seqSession.lastTopic, 0, 'Turn 1: lastTopic = 0');
assert(seqSession.lastTopicAge === 0, 'Turn 1: lastTopicAge = 0');

// Turn 2: "how?" — should be follow-up to same topic
const turn2 = seqSession.getFollowUpContext('how?');
assert(turn2.isFollowUp === true, 'Turn 2: "how?" is follow-up');
assertEq(turn2.type, 'how', 'Turn 2: type = how');
assert(turn2.lastTopics.includes(0), 'Turn 2: lastTopics includes topic 0');
assert(turn2.conversationDepth >= 1, 'Turn 2: conversationDepth >= 1');

seqSession.addTurn(
  'how?',
  'Backpropagation works by applying the chain rule of calculus layer by layer.',
  [0], [0], ['bp:int']
);
assertEq(seqSession.lastTopic, 0, 'Turn 2: lastTopic still 0');
assert(seqSession.lastTopicAge === 0, 'Turn 2: lastTopicAge = 0');

// Turn 3: "example?" — still same topic
const turn3 = seqSession.getFollowUpContext('example?');
assert(turn3.isFollowUp === true, 'Turn 3: "example?" is follow-up');
assertEq(turn3.type, 'example', 'Turn 3: type = example');
assert(turn3.lastTopics.includes(0), 'Turn 3: lastTopics includes topic 0');

seqSession.addTurn(
  'example?',
  'For example, in a 2-layer network, the output error is propagated backward to adjust weights.',
  [0], [0], ['bp:ex']
);
assertEq(seqSession.lastTopic, 0, 'Turn 3: lastTopic still 0');

// Turn 4: "what else?" — adjacent facts
const turn4 = seqSession.getFollowUpContext('what else');
assert(turn4.isFollowUp === true, 'Turn 4: "what else" is follow-up');
assertEq(turn4.type, 'what_else', 'Turn 4: type = what_else');

seqSession.addTurn(
  'what else',
  'Related concepts include gradient descent, learning rate, and momentum.',
  [0], [0], ['bp:app']
);
assertEq(seqSession.lastTopic, 0, 'Turn 4: lastTopic still 0');

// Verify conversation depth increases
assert(seqSession._computeConversationDepth() >= 4, 'Conversation depth >= 4 after 4 turns on same topic');

// ---------------------------------------------------------------------------
// 4. Engagement signal classification
// ---------------------------------------------------------------------------

section('Engagement signal classification');

const engSession = new SessionMemory(20);
engSession.addTurn('What is X?', 'X is a concept.', [0], [0], ['x:def']);

// how → deepening
const howCtx = engSession.getFollowUpContext('how?');
assertEq(howCtx.engagementSignal, 'deepening', '"how?" → deepening signal');

engSession.addTurn('how?', 'X works by doing Y.', [0], [0], ['x:int']);

// why → deepening
const whyCtx = engSession.getFollowUpContext('why?');
assertEq(whyCtx.engagementSignal, 'deepening', '"why?" → deepening signal');

engSession.addTurn('why?', 'Because Z.', [0], [0], ['x:int']);

// what_else → broadening
const weCtx = engSession.getFollowUpContext('what else');
assertEq(weCtx.engagementSignal, 'broadening', '"what else" → broadening signal');

engSession.addTurn('what else', 'Also W.', [0], [0], ['x:app']);

// example → broadening
const exCtx = engSession.getFollowUpContext('example?');
assertEq(exCtx.engagementSignal, 'broadening', '"example?" → broadening signal');

// ---------------------------------------------------------------------------
// 5. Fragment deduplication tracking
// ---------------------------------------------------------------------------

section('Fragment deduplication');

const fragSession = new SessionMemory(20);
fragSession.addTurn('What is Y?', 'Y is ...', [0], [0], ['y:def', 'y:int']);
fragSession.addTurn('how?', 'Y works by ...', [0], [0], ['y:int', 'y:ex']);

const recentFrags = fragSession.getRecentlyUsedFragments(2);
assert(recentFrags.includes('y:def'), 'Tracks y:def fragment');
assert(recentFrags.includes('y:int'), 'Tracks y:int fragment');
assert(recentFrags.includes('y:ex'), 'Tracks y:ex fragment');

const exhaustion = fragSession.getFragmentExhaustion();
assert(exhaustion.length > 0, 'Fragment exhaustion tracking populated');

// ---------------------------------------------------------------------------
// 6. Topic drift detection with follow-ups
// ---------------------------------------------------------------------------

section('Topic drift detection with follow-ups');

const driftSession = new SessionMemory(20);
driftSession.addTurn('What is X?', 'X is ...', [0], [0], ['x:def']);

// Follow-ups should NOT be detected as drift
for (const q of ['how?', 'why?', 'what else', 'go on', 'example?', 'simpler']) {
  const drift = driftSession.detectTopicDrift(q);
  assert(drift.isDrift === false, `"${q}" is not topic drift`);
  assert(drift.driftScore < 0.5, `"${q}" driftScore < 0.5`);
}

// ---------------------------------------------------------------------------
// 7. Determinism — same input produces same follow-up type
// ---------------------------------------------------------------------------

section('Determinism');

const detSession = new SessionMemory(20);
detSession.addTurn('Q', 'R', [0], [0], ['f']);

const r1 = detSession.detectSimpleFollowUp('how?');
const r2 = detSession.detectSimpleFollowUp('how?');
assertEq(r1.type, r2.type, '"how?" detection is deterministic');

const r3 = detSession.detectSimpleFollowUp('what else');
const r4 = detSession.detectSimpleFollowUp('what else');
assertEq(r3.type, r4.type, '"what else" detection is deterministic');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n═══════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════`);
process.exit(failed > 0 ? 1 : 0);
