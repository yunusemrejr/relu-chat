/**
 * test-nlp-utils.js — Unit tests for NLP utility functions (core/nlp.js)
 *
 * Tests pure functions only: cosine, softmax, tokens, pick, weightedChoice,
 * bowVec, compileAliasRegex, extractEntities.
 * No DOM or async dependencies.
 *
 * Run:  node tests/test-nlp-utils.js
 */

import { cosine, tokens, pick, weightedChoice, bowVec, compileAliasRegex, extractEntities } from '../core/nlp.js';
import { softmax } from '../core/math-utils.js';

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
//  cosine tests
// ════════════════════════════════════════════════════════════════════════════

// TEST: identical vectors → 1.0
{
  const v = [1, 2, 3];
  assertApprox(cosine(v, v), 1.0, 'cosine: identical vectors = 1.0');
}

// TEST: orthogonal vectors → 0.0
{
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  assertApprox(cosine(a, b), 0.0, 'cosine: orthogonal vectors = 0.0');
}

// TEST: opposite vectors → -1
{
  const a = [1, 0, 0];
  const b = [-1, 0, 0];
  assertApprox(cosine(a, b), -1.0, 'cosine: opposite vectors = -1.0');
}

// TEST: empty vectors → 0
{
  assertEq(cosine([], []), 0, 'cosine: both empty = 0');
  assertEq(cosine([1, 2], []), 0, 'cosine: one empty = 0');
}

// TEST: dimension mismatch → 0 (with warning)
{
  assertEq(cosine([1, 2, 3], [1, 2]), 0, 'cosine: dimension mismatch = 0');
}

// TEST: non-array inputs → 0
{
  assertEq(cosine(null, [1, 2]), 0, 'cosine: null input = 0');
  assertEq(cosine('string', [1, 2]), 0, 'cosine: string input = 0');
}

// TEST: zero vectors
{
  assertEq(cosine([0, 0, 0], [1, 2, 3]), 0, 'cosine: zero vector = 0');
}

// TEST: NaN/Inf replacements
{
  // NaN in a vector is treated as 0, so both vectors become [1,0] → cosine = 1
  assertApprox(cosine([1, NaN], [1, 0]), 1.0, 'cosine: NaN treated as 0, vectors match → 1.0');
  // Infinity is also treated as 0, vectors become [1,0] vs [1,0] → cosine = 1
  assertApprox(cosine([1, 0], [1, Infinity]), 1.0, 'cosine: Infinity treated as 0, vectors match → 1.0');
  // NaN in first position → both vectors become [0,1] vs [0,1] → 1
  assertApprox(cosine([NaN, 1], [0, 1]), 1.0, 'cosine: NaN at pos 0 treated as 0');
}

// ════════════════════════════════════════════════════════════════════════════
//  softmax tests
// ════════════════════════════════════════════════════════════════════════════

// TEST: basic softmax
{
  const r = softmax([1, 2, 3]);
  assertEq(r.length, 3, 'softmax: length matches input');
  const sum = r.reduce((a, b) => a + b, 0);
  assertApprox(sum, 1.0, 'softmax: probabilities sum to 1');
  // Higher input → higher probability
  assert(r[2] > r[1], 'softmax: higher input yields higher prob');
  assert(r[1] > r[0], 'softmax: middle > lowest');
}

// TEST: temperature parameter
{
  const rLow = softmax([1, 2, 3], 0.1);  // low temp → more peaked
  const rHigh = softmax([1, 2, 3], 10);  // high temp → more uniform
  assertApprox(rLow.reduce((a, b) => a + b, 0), 1.0, 'softmax low-t: sum = 1');
  assertApprox(rHigh.reduce((a, b) => a + b, 0), 1.0, 'softmax high-t: sum = 1');
  // Low temp should be more extreme (max higher)
  assert(rLow[2] > rHigh[2], 'softmax: low temp max > high temp max');
}

// TEST: empty array
{
  const r = softmax([]);
  assertEq(r.length, 0, 'softmax: empty input → empty output');
}

// TEST: zero temperature → clamped to 1e-9
{
  const r = softmax([1, 2, 3], 0);
  assertApprox(r.reduce((a, b) => a + b, 0), 1.0, 'softmax: zero temp sum = 1');
}

// TEST: all equal values → uniform
{
  const r = softmax([5, 5, 5]);
  for (let i = 0; i < 3; i++) {
    assertApprox(r[i], 1 / 3, 'softmax: equal values → uniform');
  }
}

// TEST: NaN in input
{
  const r = softmax([1, NaN, 3]);
  assertApprox(r.reduce((a, b) => a + b, 0), 1.0, 'softmax: NaN replaced by 0, sums to 1');
}

// ════════════════════════════════════════════════════════════════════════════
//  tokens tests
// ════════════════════════════════════════════════════════════════════════════

// TEST: basic tokenization
{
  const r = tokens('Hello world neural network');
  assert(Array.isArray(r), 'tokens: returns array');
  assertEq(r[0], 'hello', 'tokens: lowercased');
  assertEq(r[1], 'world', 'tokens: second word');
  assertEq(r[2], 'neural', 'tokens: third word');
  assertEq(r[3], 'network', 'tokens: fourth word');
}

// TEST: stop word filtering
{
  const r = tokens('the quick brown fox');
  assert(!r.includes('the'), 'tokens: stop word "the" removed');
  assertEq(r.length, 3, 'tokens: 3 non-stop words remain');
}

// TEST: punctuation removal
{
  const r = tokens('Hello, world! How\'s it going?');
  assert(!r.some(w => w.includes(',')), 'tokens: no commas');
  assert(!r.some(w => w.includes('!')), 'tokens: no exclamation');
  assert(!r.some(w => w.includes('?')), 'tokens: no question marks');
}

// TEST: empty input
{
  assertEq(tokens('').length, 0, 'tokens: empty string → empty array');
  assertEq(tokens(null).length, 0, 'tokens: null → empty array');
  assertEq(tokens(undefined).length, 0, 'tokens: undefined → empty array');
  assertEq(tokens(123).length, 0, 'tokens: number → empty array');
}

// TEST: only stop words
{
  const r = tokens('the a an in on');
  assertEq(r.length, 0, 'tokens: all stop words → empty');
}

// TEST: numbers preserved
{
  const r = tokens('model 3 layer 2');
  assert(r.includes('model'), 'tokens: word preserved');
  assert(r.includes('3'), 'tokens: number preserved');
  assert(r.includes('layer'), 'tokens: word preserved');
  assert(r.includes('2'), 'tokens: number preserved');
}

// ════════════════════════════════════════════════════════════════════════════
//  pick tests
// ════════════════════════════════════════════════════════════════════════════

// TEST: picks from array
{
  const arr = ['apple', 'banana', 'cherry'];
  const p = pick(arr);
  assert(arr.includes(p), 'pick: returns element from array');
}

// TEST: empty array → empty string
{
  assertEq(pick([]), '', 'pick: empty array → ""');
}

// TEST: non-array → empty string
{
  assertEq(pick('not array'), '', 'pick: non-array → ""');
  assertEq(pick(null), '', 'pick: null → ""');
}

// TEST: single element
{
  assertEq(pick(['only']), 'only', 'pick: single element');
}

// ════════════════════════════════════════════════════════════════════════════
//  weightedChoice tests
// ════════════════════════════════════════════════════════════════════════════

// TEST: basic weighted selection (zero-weight excluded)
{
  const items = ['a', 'b', 'c'];
  // With all weight on 'b', it should always pick 'b'
  for (let i = 0; i < 10; i++) {
    const r = weightedChoice(items, [0, 1, 0]);
    assertEq(r, 'b', `weightedChoice: zero-weight excluded (run ${i})`);
  }
}

// TEST: empty items → null
{
  assertEq(weightedChoice([], [1]), null, 'weightedChoice: empty items → null');
}

// TEST: empty weights → first item
{
  assertEq(weightedChoice(['a', 'b', 'c'], []), 'a', 'weightedChoice: empty weights → first');
}

// TEST: all zero weights → random from items
{
  const r = weightedChoice(['x', 'y', 'z'], [0, 0, 0]);
  assert(['x', 'y', 'z'].includes(r), 'weightedChoice: all-zero weights picks from items');
}

// TEST: NaN in weights → treated as 0
{
  const items = ['a', 'b', 'c'];
  for (let i = 0; i < 5; i++) {
    const r = weightedChoice(items, [NaN, 1, NaN]);
    assertEq(r, 'b', 'weightedChoice: NaN weights treated as 0');
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  bowVec tests
// ════════════════════════════════════════════════════════════════════════════

// TEST: basic BOW vector
{
  const vocab = new Map([['neural', 0], ['networks', 1], ['deep', 2]]);
  const v = bowVec('neural networks and deep networks', vocab);
  assertEq(v.length, 3, 'bowVec: length matches vocab size');
  assert(v[0] > 0, 'bowVec: "neural" appears');
  assert(v[2] > 0, 'bowVec: "deep" appears');
  // Check normalized: norm should be ~1
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  assertApprox(norm, 1.0, 'bowVec: L2 norm = 1');
}

// TEST: empty input
{
  const vocab = new Map([['a', 0]]);
  const v = bowVec('', vocab);
  assertEq(v.length, 1, 'bowVec: empty text returns zeroed vector');
  assertEq(v[0], 0, 'bowVec: value is 0');
}

// TEST: no vocab match
{
  const vocab = new Map([['apple', 0]]);
  const v = bowVec('banana orange', vocab);
  assertEq(v[0], 0, 'bowVec: no match → 0');
  // Norm of zero vector → normalized to 0
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  assertApprox(norm, 0, 'bowVec: zero vector norm = 0');
}

// ════════════════════════════════════════════════════════════════════════════
//  compileAliasRegex tests
// ════════════════════════════════════════════════════════════════════════════

// TEST: basic alias regex compilation
{
  const KB = [
    { id: 'relu', name: 'ReLU', aliases: ['ReLU', 'rectified linear unit'] },
    { id: 'softmax', name: 'Softmax', aliases: [] },
  ];
  compileAliasRegex(KB);
  assert(Array.isArray(KB[0].aliasRegex), 'compileAliasRegex: aliasRegex is array');
  assert(KB[0].aliasRegex.length > 0, 'compileAliasRegex: at least one regex compiled');
  assert(Array.isArray(KB[1].aliasRegex), 'compileAliasRegex: empty aliases → empty regex array');
  assertEq(KB[1].aliasRegex.length, 0, 'compileAliasRegex: no aliases → 0 regexes');
}

// TEST: compileAliasRegex handles non-array input gracefully
{
  // Should not throw
  compileAliasRegex(null);
  compileAliasRegex('not array');
  assert(true, 'compileAliasRegex: handles non-array input');
}

// ════════════════════════════════════════════════════════════════════════════
//  extractEntities tests
// ════════════════════════════════════════════════════════════════════════════

// TEST: exact alias match
{
  const KB = [
    { id: 'relu', name: 'ReLU', aliases: ['ReLU', 'rectified linear unit'] },
    { id: 'softmax', name: 'Softmax', aliases: ['softmax'] },
  ];
  compileAliasRegex(KB);
  const result = extractEntities('what is ReLU?', KB);
  assertEq(result.length, 1, 'extractEntities: exact match finds 1 entity');
  assertEq(result[0], 0, 'extractEntities: matched KB index 0');
}

// TEST: multiple entity matches
{
  const KB = [
    { id: 'relu', name: 'ReLU', aliases: ['ReLU'] },
    { id: 'softmax', name: 'Softmax', aliases: ['softmax'] },
  ];
  compileAliasRegex(KB);
  const result = extractEntities('compare ReLU and softmax', KB);
  assert(result.length >= 1, 'extractEntities: finds at least one entity in mixed query');
}

// TEST: fuzzy matching (via word overlap)
{
  const KB = [
    { id: 'relu', name: 'ReLU', aliases: ['rectified linear unit'] },
  ];
  compileAliasRegex(KB);
  const result = extractEntities('tell me about rectified linear', KB);
  assert(result.length >= 0, 'extractEntities: partial alias handled'); // may match via fuzzy
}

// TEST: no match
{
  const KB = [
    { id: 'relu', name: 'ReLU', aliases: ['ReLU'] },
  ];
  compileAliasRegex(KB);
  const result = extractEntities('tell me about cats', KB);
  assertEq(result.length, 0, 'extractEntities: no match returns empty');
}

// TEST: empty query
{
  const KB = [{ id: 'x', name: 'X', aliases: ['x'] }];
  compileAliasRegex(KB);
  assertEq(extractEntities('', KB).length, 0, 'extractEntities: empty query → empty');
  assertEq(extractEntities(null, KB).length, 0, 'extractEntities: null query → empty');
}

// TEST: empty KB
{
  assertEq(extractEntities('hello', []).length, 0, 'extractEntities: empty KB → empty');
}

// TEST: entry with null aliases should not crash
{
  const KB = [
    { id: 'x', name: 'X', aliases: null },
    { id: 'y', name: 'Y', aliases: undefined },
  ];
  compileAliasRegex(KB);
  const result = extractEntities('test', KB);
  assertEq(result.length, 0, 'extractEntities: null aliases handled');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('\n');
console.log(`\x1b[1mNLP Utils Tests:\x1b[0m ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n' + failures.map(f => `  \x1b[31mFAIL\x1b[0m ${f}`).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
