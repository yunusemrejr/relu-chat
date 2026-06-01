/**
 * test-bm25.js — Unit tests for BM25Scorer (core/bm25.js)
 *
 * Tests: fit(), score(), scoreAll(), getReady(), edge cases.
 * Run:  node tests/test-bm25.js
 */

import { BM25Scorer } from '../core/bm25.js';

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

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: getReady() before fit → false
// ════════════════════════════════════════════════════════════════════════════
{
  const bm = new BM25Scorer();
  assertEq(bm.getReady(), false, 'getReady() returns false before fit()');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: fit() with known documents → getReady() true
// ════════════════════════════════════════════════════════════════════════════
{
  const docs = [
    'ReLU activation introduces non-linearity in neural networks',
    'The softmax function converts logits to probabilities',
    'Stochastic gradient descent optimizes neural network weights',
  ];
  const bm = new BM25Scorer();
  bm.fit(docs);
  assertEq(bm.getReady(), true, 'getReady() returns true after fit()');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: score() — query matching document 0 (about ReLU)
// ════════════════════════════════════════════════════════════════════════════
{
  const docs = [
    'ReLU activation introduces non-linearity in neural networks',
    'The softmax function converts logits to probabilities',
    'Stochastic gradient descent optimizes neural network weights',
  ];
  const bm = new BM25Scorer();
  bm.fit(docs);
  const s0 = bm.score('ReLU activation', 0);
  const s1 = bm.score('ReLU activation', 1);
  const s2 = bm.score('ReLU activation', 2);
  assert(s0 > 0, 'query "ReLU activation" scores > 0 on doc 0');
  assert(s0 >= s1, 'doc 0 scores higher or equal for "ReLU activation" vs doc 1');
  assert(s0 >= s2, 'doc 0 scores higher or equal for "ReLU activation" vs doc 2');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: score() — query should have highest score on matching doc
// ════════════════════════════════════════════════════════════════════════════
{
  const docs = [
    'ReLU activation introduces non-linearity in neural networks',
    'The softmax function converts logits to probabilities',
    'Stochastic gradient descent optimizes neural network weights',
  ];
  const bm = new BM25Scorer();
  bm.fit(docs);
  const s0 = bm.score('softmax', 0);
  const s1 = bm.score('softmax', 1);
  const s2 = bm.score('softmax', 2);
  assert(s1 > 0, 'query "softmax" scores > 0 on doc 1');
  assert(s1 >= s0, 'doc 1 scores >= doc 0 for "softmax"');
  assert(s1 >= s2, 'doc 1 scores >= doc 2 for "softmax"');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: scoreAll() returns sorted results
// ════════════════════════════════════════════════════════════════════════════
{
  const docs = [
    'ReLU activation introduces non-linearity in neural networks',
    'The softmax function converts logits to probabilities',
    'Stochastic gradient descent optimizes neural network weights',
  ];
  const bm = new BM25Scorer();
  bm.fit(docs);
  const results = bm.scoreAll('ReLU function');
  assert(Array.isArray(results), 'scoreAll returns array');
  assertEq(results.length, 3, 'scoreAll returns 3 results');
  // Check sorted: first should have highest score
  for (let i = 1; i < results.length; i++) {
    assert(results[i - 1].s >= results[i].s, `result ${i - 1} >= result ${i} (sorted)`);
  }
  // Check max score is 1.0 after normalization
  assertApprox(results[0].s, 1.0, 'top result normalized to 1.0');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: scoreAll() before fit → empty array
// ════════════════════════════════════════════════════════════════════════════
{
  const bm = new BM25Scorer();
  const results = bm.scoreAll('anything');
  assertEq(results.length, 0, 'scoreAll before fit returns empty');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: score() before fit returns 0
// ════════════════════════════════════════════════════════════════════════════
{
  const bm = new BM25Scorer();
  assertEq(bm.score('test', 0), 0, 'score before fit returns 0');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: Edge case — empty documents array
// ════════════════════════════════════════════════════════════════════════════
{
  const bm = new BM25Scorer();
  bm.fit([]);
  assertEq(bm.getReady(), true, 'fit with empty docs still sets ready');
  assertEq(bm.scoreAll('query').length, 0, 'scoreAll with empty docs returns empty');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 9: Edge case — empty query
// ════════════════════════════════════════════════════════════════════════════
{
  const docs = ['the quick brown fox', 'lazy dog sleeps'];
  const bm = new BM25Scorer();
  bm.fit(docs);
  assertEq(bm.score('', 0), 0, 'empty query scores 0');
  // ScoreAll with empty query (only stop words or empty)
  const results = bm.scoreAll('');
  assertEq(results.length, 2, 'scoreAll with empty query returns all docs');
  // All scores should be 0 (after normalization, first may be 0 or NaN -> 0)
  for (const r of results) {
    assertEq(r.s, 0, `empty query: all scores normalized to 0 (got ${r.s})`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 10: Edge case — single-word documents
// ════════════════════════════════════════════════════════════════════════════
{
  const docs = ['neural', 'networks', 'activation'];
  const bm = new BM25Scorer();
  bm.fit(docs);
  const results = bm.scoreAll('neural');
  assertEq(results.length, 3, 'single-word docs: scoreAll returns 3');
  // First should be doc 0
  assertEq(results[0].i, 0, 'single-word docs: doc 0 matches "neural"');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 11: Bigram matching — adjacent words get bonus
// ════════════════════════════════════════════════════════════════════════════
{
  const docs = [
    'neural network architectures are deep',
    'gradient descent converges quickly',
    'neural style transfer uses gradient',
  ];
  const bm = new BM25Scorer();
  bm.fit(docs);
  // "neural network" as bigram should match doc 0 best
  const s0 = bm.score('neural network', 0);
  const s1 = bm.score('neural network', 1);
  const s2 = bm.score('neural network', 2);
  assert(s0 > 0, 'bigram "neural network" scores on doc 0');
  assert(s0 >= s1, 'bigram "neural network": doc 0 >= doc 1');
  assert(s0 >= s2, 'bigram "neural network": doc 0 >= doc 2');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 12: score with out-of-range docIdx returns 0
// ════════════════════════════════════════════════════════════════════════════
{
  const docs = ['hello world'];
  const bm = new BM25Scorer();
  bm.fit(docs);
  assertEq(bm.score('hello', -1), 0, 'score with negative idx returns 0');
  assertEq(bm.score('hello', 99), 0, 'score with out-of-range idx returns 0');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 13: fit() returns this (chainable)
// ════════════════════════════════════════════════════════════════════════════
{
  const bm = new BM25Scorer();
  const result = bm.fit(['test document']);
  assertEq(result, bm, 'fit() returns this for chaining');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 14: Custom k1 and b parameters
// ════════════════════════════════════════════════════════════════════════════
{
  const docs = ['a b c d e f g h i j', 'a b'];
  const bmDefault = new BM25Scorer();
  bmDefault.fit(docs);
  const bmLong = new BM25Scorer(2.0, 1.0);
  bmLong.fit(docs);
  // Higher b means more length normalization → longer docs penalized more
  const sDef = bmDefault.score('a b', 0);
  const sLong = bmLong.score('a b', 0);
  // Both should be non-zero, and scores may differ since params differ
  assert(sDef >= 0, 'custom params: default score >= 0');
  assert(sLong >= 0, 'custom params: high-b score >= 0');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 15: Repeated fit() replaces previous state
// ════════════════════════════════════════════════════════════════════════════
{
  const bm = new BM25Scorer();
  bm.fit(['doc one aa', 'doc two bb']);
  bm.fit(['doc three cc', 'doc four dd']);
  const r2 = bm.scoreAll('three');
  assert(r2.length === 2, 're-fit: correct result count');
  assertApprox(r2[0].s, 1.0, 're-fit: top result for new query is 1.0');
  // The doc that best matches "three" should be first
  assertEq(r2[0].i, 0, 're-fit: doc 0 matches "three"');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('\n');
console.log(`\x1b[1mBM25Scorer Tests:\x1b[0m ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n' + failures.map(f => `  \x1b[31mFAIL\x1b[0m ${f}`).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
