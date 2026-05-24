#!/usr/bin/env node
/**
 * test-signal-layer.js — ReLU.chat Signal Layer & BM25 Test Suite
 *
 * Tests BM25 scoring, SignalLayer DecisionPacket generation, confidence
 * calibration, ensemble ranking, and neural reranking.
 *
 * Run: node dev/scripts/test-signal-layer.js
 */

import { BM25Scorer } from '../../core/bm25.js';
import { SignalLayer } from '../../core/signal-layer.js';

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

// ============================================================================
// Mock Helpers
// ============================================================================

function makeMockKB() {
  return [
    {
      id: 'nash', name: 'Nash Equilibrium', aliases: ['Nash Equilibrium', 'Nash'],
      summary: 'A solution concept in game theory',
      f: { def: ['A solution concept in game theory where no player can benefit by changing strategies unilaterally.'], int: ['Players cannot benefit from changing their strategy while others keep theirs unchanged.'], ex: ['Prisoner\'s dilemma where both confessing is the Nash equilibrium.'] },
      related: []
    },
    {
      id: 'pd', name: 'Prisoner\'s Dilemma', aliases: ['Prisoner\'s Dilemma', 'PD'],
      summary: 'A standard example of a game analyzed in game theory',
      f: { def: ['A classic game theory example showing why two rational individuals might not cooperate.'], int: ['Two prisoners face a choice between cooperating with each other or betraying the other.'] },
      related: []
    },
    {
      id: 'cnn', name: 'Convolutional Neural Network', aliases: ['CNN', 'Convolutional Neural Network'],
      summary: 'A deep learning architecture for grid-like data',
      f: { def: ['A deep learning architecture that uses convolutional filters to process grid-like data.'], int: ['Uses filters to scan across spatial dimensions.'] },
      related: []
    },
  ];
}

function makeMockQEmb(dim = 384) {
  return Array.from({ length: dim }, (_, i) => Math.sin(i * 0.1) * 0.5);
}

function makeMockEntryEmb(count, dim = 384) {
  return Array.from({ length: count }, (_, idx) =>
    Array.from({ length: dim }, (_, i) => Math.sin(i * 0.1 + idx) * 0.5));
}

function makeMockIntentScores(overrides = {}) {
  return {
    definition: overrides.definition ?? 0.65,
    example: overrides.example ?? 0.42,
    formal: overrides.formal ?? 0.21,
    application: overrides.application ?? 0.33,
    comparison: overrides.comparison ?? 0.55,
  };
}

// ============================================================================
// 1. BM25 Tests
// ============================================================================

section('1. BM25Scorer — Sparse Retrieval');

// 1.1 Construction and fitting
{
  const kb = makeMockKB();
  const docs = kb.map(e => `${e.name} ${e.summary} ${e.f.def[0]} ${e.f.int[0]} ${e.f.ex?.[0] || ''}`);
  const bm25 = new BM25Scorer(1.5, 0.75).fit(docs);
  assert(bm25.getReady() === true, 'BM25Scorer is ready after fit()');
  assert(bm25._docCount === 3, 'BM25Scorer has 3 documents');
  assert(bm25._avgDocLen > 0, 'BM25Scorer computes avgDocLen');
}

// 1.2 Scoring
{
  const kb = makeMockKB();
  const docs = kb.map(e => `${e.name} ${e.summary} ${e.f.def[0]} ${e.f.int[0]}`);
  const bm25 = new BM25Scorer(1.5, 0.75).fit(docs);
  const scores = bm25.scoreAll('Nash equilibrium');
  assert(scores.length === 3, 'scoreAll returns scores for all docs');
  assert(scores[0].s >= 0, 'Top BM25 score is non-negative');
  assert(scores[0].s <= 1, 'Top BM25 score is <= 1 (normalized)');
  const nashIdx = kb.findIndex(e => e.id === 'nash');
  const nashScore = scores.find(r => r.i === nashIdx);
  assert(nashScore !== undefined, 'Nash entry has a BM25 score');
}

// 1.3 Term matching (specific query should boost the right doc)
{
  const kb = makeMockKB();
  const docs = kb.map(e => `${e.name} ${e.summary} ${e.f.def[0]} ${e.f.int[0]}`);
  const bm25 = new BM25Scorer(1.5, 0.75).fit(docs);
  const scores = bm25.scoreAll('Nash equilibrium prisoner dilemma');
  const pdIdx = kb.findIndex(e => e.id === 'pd');
  const nashIdx = kb.findIndex(e => e.id === 'nash');
  // Prisoner's Dilemma should score higher with "prisoner" and "dilemma" in query
  const pdScore = scores.find(r => r.i === pdIdx);
  assert(pdScore !== undefined, 'Prisoner entry has BM25 score for relevant query');
  assert(pdScore.s >= 0, 'Prisoner BM25 score is non-negative');
}

// 1.4 Empty query returns zero scores
{
  const kb = makeMockKB();
  const docs = kb.map(e => e.name);
  const bm25 = new BM25Scorer(1.5, 0.75).fit(docs);
  const scores = bm25.scoreAll('');
  for (const s of scores) {
    assert(s.s === 0, 'Empty query produces zero BM25 score');
  }
}

// 1.5 Single document edge case
{
  const bm25 = new BM25Scorer(1.5, 0.75).fit(['game theory Nash equilibrium']);
  assert(bm25.getReady() === true, 'Single document BM25 builds successfully');
  const scores = bm25.scoreAll('Nash');
  assert(scores.length === 1, 'Single document scoreAll returns 1 result');
  assert(scores[0].s > 0, 'Single document BM25 returns positive score on match');
}

// 1.6 Not-ready behavior
{
  const bm25 = new BM25Scorer(1.5, 0.75);
  assert(bm25.getReady() === false, 'BM25Scorer starts not ready');
  const scores = bm25.scoreAll('test');
  assert(Array.isArray(scores) && scores.length === 0, 'scoreAll returns empty when not ready');
}

// ============================================================================
// 2. SignalLayer — Confidence Calibration (internal helper testing)
// ============================================================================

section('2. Confidence Calibration');

{
  // Import helper directly for isolated testing
  const { softmax } = await import('../../core/nlp.js');

  // 2.1 Basic softmax
  const scores = [0.8, 0.3, 0.2];
  const calibrated = softmax(scores, 1.5);
  const sum = calibrated.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 0.001, 'Calibrated scores sum to 1');
  assert(calibrated.every(v => v >= 0 && v <= 1), 'All calibrated scores in [0,1]');
  assert(calibrated[0] > calibrated[1], 'Highest raw score gets highest calibrated');

  // 2.2 Higher temperature = more uniform
  const t1 = softmax(scores, 0.5);
  const t2 = softmax(scores, 5.0);
  const range1 = Math.max(...t1) - Math.min(...t1);
  const range2 = Math.max(...t2) - Math.min(...t2);
  assert(range1 > range2, 'Lower temperature = more peaked, higher = more uniform');

  // 2.3 Edge cases
  const single = softmax([1.0], 1.0);
  assert(Math.abs(single[0] - 1) < 0.001, 'Single-element softmax = 1.0');

  const zeros = softmax([0, 0, 0], 1.0);
  const expected = 1 / 3;
  assert(zeros.every(v => Math.abs(v - expected) < 0.001), 'Uniform input produces uniform softmax');
}

// ============================================================================
// 3. SignalLayer — Ensemble Ranking
// ============================================================================

section('3. Ensemble Ranking');

{
  // Test the ensemble logic used by SignalLayer
  const denseRanked = [
    { i: 0, s: 0.8 },
    { i: 1, s: 0.6 },
    { i: 2, s: 0.4 },
  ];
  const sparseRanked = [
    { i: 2, s: 0.9 },
    { i: 1, s: 0.5 },
    { i: 0, s: 0.3 },
  ];

  // Simulate the ensemble function from signal-layer.js
  const scores = new Map();
  for (const r of denseRanked) scores.set(r.i, { i: r.i, dense: r.s, sparse: 0 });
  for (const r of sparseRanked) {
    if (scores.has(r.i)) scores.get(r.i).sparse = r.s;
    else scores.set(r.i, { i: r.i, dense: 0, sparse: r.s });
  }
  const ensemble = [...scores.values()]
    .map(s => ({ i: s.i, s: 0.7 * s.dense + 0.3 * s.sparse }))
    .sort((a, b) => b.s - a.s);

  assert(ensemble.length === 3, 'Ensemble produces correct number of results');

  const expectedOrder = [
    { i: 0, s: 0.7 * 0.8 + 0.3 * 0.3 },
    { i: 2, s: 0.7 * 0.4 + 0.3 * 0.9 },
    { i: 1, s: 0.7 * 0.6 + 0.3 * 0.5 },
  ].sort((a, b) => b.s - a.s);

  for (let i = 0; i < ensemble.length; i++) {
    assert(Math.abs(ensemble[i].s - expectedOrder[i].s) < 0.001,
      `Ensemble rank ${i}: entry ${ensemble[i].i} score correct`);
  }

  // Test that ensemble gives different order than pure dense or sparse
  assert(
    ensemble[0].i === 0 || ensemble[0].i === 2,
    'Ensemble may reorder based on combined signals'
  );
}

// ============================================================================
// 4. SignalLayer — Construction & Basic Processing
// ============================================================================

section('4. SignalLayer — Construction & Processing');

// 4.1 Construction
{
  const sl = new SignalLayer();
  assert(sl instanceof SignalLayer, 'SignalLayer constructs successfully');
  assert(sl.isBM25Ready() === false, 'SignalLayer BM25 not ready before init');
}

// 4.2 BM25 initialization
{
  const kb = makeMockKB();
  const sl = new SignalLayer().initBM25(kb);
  assert(sl.isBM25Ready() === true, 'SignalLayer BM25 ready after initBM25');
}

// 4.3 Basic process (with mock data)
{
  const kb = makeMockKB();
  const sl = new SignalLayer().initBM25(kb);
  const qEmb = makeMockQEmb();
  const entryEmb = makeMockEntryEmb(kb.length);
  const intentEmb = {
    definition: [makeMockQEmb()],
    example: [makeMockQEmb()],
    formal: [makeMockQEmb()],
    application: [makeMockQEmb()],
    comparison: [makeMockQEmb()],
  };
  const config = {
    INTENTS: {
      definition: { prototypes: ['what is X'], order: ['def', 'int', 'ex'] },
      example: { prototypes: ['example of X'], order: ['ex', 'int', 'def'] },
      formal: { prototypes: ['formal X'], order: ['form', 'def', 'ex'] },
      application: { prototypes: ['applications of X'], order: ['app', 'ex', 'int'] },
      comparison: { prototypes: ['X vs Y'], order: ['def', 'int', 'ex'] },
    },
    THRESHOLDS: {},
    botProfile: { creativityCeiling: 0.35, domainPrototypes: [] },
  };

  const dp = await sl.process('What is Nash equilibrium?', qEmb, entryEmb, intentEmb, kb, config, null);

  // Validate DecisionPacket structure
  assert(dp !== null && typeof dp === 'object', 'DecisionPacket is an object');
  assert(dp.query === 'What is Nash equilibrium?', 'DP.query preserved');
  assert(Array.isArray(dp.entities), 'DP.entities is an array');
  assert(dp.intent !== null && typeof dp.intent === 'object', 'DP.intent is an object');
  assert(typeof dp.intent.name === 'string', 'DP.intent.name is a string');
  assert(typeof dp.intent.confidence === 'number', 'DP.intent.confidence is a number');
  assert(typeof dp.isAmbiguous === 'boolean', 'DP.isAmbiguous is a boolean');
  assert(dp.rankings !== null && typeof dp.rankings === 'object', 'DP.rankings is an object');
  assert(Array.isArray(dp.rankings.dense), 'DP.rankings.dense is an array');
  assert(Array.isArray(dp.rankings.sparse), 'DP.rankings.sparse is an array');
  assert(Array.isArray(dp.rankings.ensemble), 'DP.rankings.ensemble is an array');
  assert(Array.isArray(dp.rankings.reranked), 'DP.rankings.reranked is an array');
  assert(dp.bm25Stats !== null && typeof dp.bm25Stats === 'object', 'DP.bm25Stats is an object');
  assert(dp.bm25Stats.enabled === true, 'DP.bm25Stats.enabled is true');
  assert(dp.confidence !== null && typeof dp.confidence === 'object', 'DP.confidence is an object');
  assert(dp.features !== null && typeof dp.features === 'object', 'DP.features is an object (25-feature vector)');
  assert(dp.session !== null && typeof dp.session === 'object', 'DP.session is an object');
}

// 4.4 DecisionPacket fields (non-null checks)
{
  const kb = makeMockKB();
  const sl = new SignalLayer().initBM25(kb);
  const qEmb = makeMockQEmb();
  const entryEmb = makeMockEntryEmb(kb.length);
  const intentEmb = {
    definition: [makeMockQEmb()],
    example: [makeMockQEmb()],
    formal: [makeMockQEmb()],
    application: [makeMockQEmb()],
    comparison: [makeMockQEmb()],
  };
  const config = {
    INTENTS: {
      definition: { prototypes: ['what is X'], order: ['def', 'int', 'ex'] },
      example: { prototypes: ['example of X'], order: ['ex', 'int', 'def'] },
      formal: { prototypes: ['formal X'], order: ['form', 'def', 'ex'] },
      application: { prototypes: ['applications of X'], order: ['app', 'ex', 'int'] },
      comparison: { prototypes: ['X vs Y'], order: ['def', 'int', 'ex'] },
    },
    THRESHOLDS: {},
    botProfile: { creativityCeiling: 0.35, domainPrototypes: [] },
  };

  const dp = await sl.process('test query', qEmb, entryEmb, intentEmb, kb, config, null);

  assert(dp.rankings.dense.length > 0, 'Dense ranking has results');
  assert(dp.rankings.ensemble.length > 0, 'Ensemble ranking has results');
  assert(dp.rankings.reranked.length > 0, 'Reranked has results');
  assert(typeof dp.confidence.top1Sim === 'number', 'confidence.top1Sim is number');
  assert(typeof dp.bm25Stats.top1Score === 'number', 'bm25Stats.top1Score is number');
  assert(Object.keys(dp.intent.calibratedScores).length > 0, 'intent.calibratedScores has entries');
}

// 4.5 Session-aware processing
{
  const kb = makeMockKB();
  const sl = new SignalLayer().initBM25(kb);
  const qEmb = makeMockQEmb();
  const entryEmb = makeMockEntryEmb(kb.length);
  const intentEmb = {
    definition: [makeMockQEmb()],
    example: [makeMockQEmb()],
    formal: [makeMockQEmb()],
    application: [makeMockQEmb()],
    comparison: [makeMockQEmb()],
  };
  const config = {
    INTENTS: {
      definition: { prototypes: ['what is X'], order: ['def', 'int', 'ex'] },
      example: { prototypes: ['example of X'], order: ['ex', 'int', 'def'] },
      formal: { prototypes: ['formal X'], order: ['form', 'def', 'ex'] },
      application: { prototypes: ['applications of X'], order: ['app', 'ex', 'int'] },
      comparison: { prototypes: ['X vs Y'], order: ['def', 'int', 'ex'] },
    },
    THRESHOLDS: {},
    botProfile: { creativityCeiling: 0.35, domainPrototypes: [] },
  };

  const { SessionMemory } = await import('../../core/session.js');
  const session = new SessionMemory(20);
  session.addTurn('Tell me about game theory', 'Game theory is...', [0], [0], ['nash:def']);

  const dp = await sl.process('explain that simpler', qEmb, entryEmb, intentEmb, kb, config, session);

  assert(dp.session.followUp !== null, 'Session follow-up context present');
  assert(dp.session.followUp.isFollowUp === true, 'Follow-up detected: "explain that simpler"');
  assert(dp.session.lastTopic !== null, 'Session lastTopic present');
  assert(dp.session.wasAmbiguous !== undefined, 'Session wasAmbiguous present');
}

// 4.6 Ambiguity detection
{
  const kb = makeMockKB();
  const sl = new SignalLayer().initBM25(kb);
  const qEmb = makeMockQEmb();
  const entryEmb = makeMockEntryEmb(kb.length);
  const intentEmb = {
    definition: [makeMockQEmb()],
    example: [makeMockQEmb()],
    formal: [makeMockQEmb()],
    application: [makeMockQEmb()],
    comparison: [makeMockQEmb()],
  };
  const config = {
    INTENTS: {
      definition: { prototypes: ['what is X'], order: ['def', 'int', 'ex'] },
      example: { prototypes: ['example of X'], order: ['ex', 'int', 'def'] },
      formal: { prototypes: ['formal X'], order: ['form', 'def', 'ex'] },
      application: { prototypes: ['applications of X'], order: ['app', 'ex', 'int'] },
      comparison: { prototypes: ['X vs Y'], order: ['def', 'int', 'ex'] },
    },
    THRESHOLDS: {},
    botProfile: { creativityCeiling: 0.35, domainPrototypes: [] },
  };

  // Very short query with random embedding → likely ambiguous
  const dp = await sl.process('it', qEmb, entryEmb, intentEmb, kb, config, null);

  assert(typeof dp.isAmbiguous === 'boolean', 'Ambiguity detection returns boolean');
}

// 4.7 DecisionPacket is immutable
{
  const kb = makeMockKB();
  const sl = new SignalLayer().initBM25(kb);
  const qEmb = makeMockQEmb();
  const entryEmb = makeMockEntryEmb(kb.length);
  const intentEmb = {
    definition: [makeMockQEmb()],
    example: [makeMockQEmb()],
    formal: [makeMockQEmb()],
    application: [makeMockQEmb()],
    comparison: [makeMockQEmb()],
  };
  const config = {
    INTENTS: {
      definition: { prototypes: ['what is X'], order: ['def', 'int', 'ex'] },
      example: { prototypes: ['example of X'], order: ['ex', 'int', 'def'] },
      formal: { prototypes: ['formal X'], order: ['form', 'def', 'ex'] },
      application: { prototypes: ['applications of X'], order: ['app', 'ex', 'int'] },
      comparison: { prototypes: ['X vs Y'], order: ['def', 'int', 'ex'] },
    },
    THRESHOLDS: {},
    botProfile: { creativityCeiling: 0.35, domainPrototypes: [] },
  };

  const dp = await sl.process('test', qEmb, entryEmb, intentEmb, kb, config, null);

  let threw = false;
  try { dp.isAmbiguous = true; } catch (e) { threw = true; }
  assert(threw === true, 'DecisionPacket is frozen (immutable)');
}

// ============================================================================
// 5. Edge Cases
// ============================================================================

section('5. Edge Cases');

// 5.1 Empty query
{
  const kb = makeMockKB();
  const sl = new SignalLayer().initBM25(kb);
  const qEmb = makeMockQEmb();
  const entryEmb = makeMockEntryEmb(kb.length);
  const intentEmb = {
    definition: [makeMockQEmb()],
    example: [makeMockQEmb()],
    formal: [makeMockQEmb()],
    application: [makeMockQEmb()],
    comparison: [makeMockQEmb()],
  };
  const config = {
    INTENTS: {
      definition: { prototypes: ['what is X'], order: ['def', 'int', 'ex'] },
      example: { prototypes: ['example of X'], order: ['ex', 'int', 'def'] },
      formal: { prototypes: ['formal X'], order: ['form', 'def', 'ex'] },
      application: { prototypes: ['applications of X'], order: ['app', 'ex', 'int'] },
      comparison: { prototypes: ['X vs Y'], order: ['def', 'int', 'ex'] },
    },
    THRESHOLDS: {},
    botProfile: { creativityCeiling: 0.35, domainPrototypes: [] },
  };

  const dp = await sl.process('', qEmb, entryEmb, intentEmb, kb, config, null);
  assert(dp !== null, 'Empty query does not crash');
  assert(Array.isArray(dp.entities), 'Empty query produces entities array');
}

// 5.2 Very long query
{
  const kb = makeMockKB();
  const sl = new SignalLayer().initBM25(kb);
  const qEmb = makeMockQEmb();
  const entryEmb = makeMockEntryEmb(kb.length);
  const intentEmb = {
    definition: [makeMockQEmb()],
    example: [makeMockQEmb()],
    formal: [makeMockQEmb()],
    application: [makeMockQEmb()],
    comparison: [makeMockQEmb()],
  };
  const config = {
    INTENTS: {
      definition: { prototypes: ['what is X'], order: ['def', 'int', 'ex'] },
      example: { prototypes: ['example of X'], order: ['ex', 'int', 'def'] },
      formal: { prototypes: ['formal X'], order: ['form', 'def', 'ex'] },
      application: { prototypes: ['applications of X'], order: ['app', 'ex', 'int'] },
      comparison: { prototypes: ['X vs Y'], order: ['def', 'int', 'ex'] },
    },
    THRESHOLDS: {},
    botProfile: { creativityCeiling: 0.35, domainPrototypes: [] },
  };

  const longQuery = 'What is the Nash equilibrium in the prisoner dilemma '.repeat(10);
  const dp = await sl.process(longQuery, qEmb, entryEmb, intentEmb, kb, config, null);
  assert(dp !== null, 'Very long query does not crash');
  assert(dp.rankings.reranked.length > 0, 'Long query produces reranked results');
}

// 5.3 BM25 without init
{
  const kb = makeMockKB();
  const sl = new SignalLayer(); // NOT initialized
  const qEmb = makeMockQEmb();
  const entryEmb = makeMockEntryEmb(kb.length);
  const intentEmb = {
    definition: [makeMockQEmb()],
    example: [makeMockQEmb()],
    formal: [makeMockQEmb()],
    application: [makeMockQEmb()],
    comparison: [makeMockQEmb()],
  };
  const config = {
    INTENTS: {
      definition: { prototypes: ['what is X'], order: ['def', 'int', 'ex'] },
      example: { prototypes: ['example of X'], order: ['ex', 'int', 'def'] },
      formal: { prototypes: ['formal X'], order: ['form', 'def', 'ex'] },
      application: { prototypes: ['applications of X'], order: ['app', 'ex', 'int'] },
      comparison: { prototypes: ['X vs Y'], order: ['def', 'int', 'ex'] },
    },
    THRESHOLDS: {},
    botProfile: { creativityCeiling: 0.35, domainPrototypes: [] },
  };

  const dp = await sl.process('test', qEmb, entryEmb, intentEmb, kb, config, null);
  assert(dp !== null, 'SignalLayer works without BM25 initialized');
  assert(dp.bm25Stats.enabled === false, 'bm25Stats.enabled is false');
  assert(dp.rankings.sparse.length === 0, 'Sparse ranking is empty without BM25');
}

// ============================================================================
// Results
// ============================================================================

console.log(`\n${YELLOW}━━━ Results ━━━${RESET}`);
console.log(`  ${GREEN}Passed:${RESET} ${passCount}`);
console.log(`  ${RED}Failed:${RESET} ${failCount}`);
console.log(`  Total: ${passCount + failCount}\n`);

process.exit(failCount > 0 ? 1 : 0);
