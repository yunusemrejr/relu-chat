/**
 * test-session.js — Unit tests for SessionMemory (core/session.js)
 *
 * Tests: addTurn, lastTopic, lastTopicAge, getRecentlyUsedFragments,
 * markFragmentUsed, detectFollowUp, getActiveEntities, reset, eviction.
 *
 * Run:  node tests/test-session.js
 */

import { SessionMemory } from '../core/session.js';

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

function assertDeepEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; process.stdout.write('\x1b[32m.\x1b[0m'); }
  else {
    failed++; failures.push(`${msg}: expected ${b}, got ${a}`);
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: Initial state
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  assertEq(s.lastTopic, null, 'initial lastTopic is null');
  assertEq(s.lastTopicAge, 0, 'initial lastTopicAge is 0');
  assertEq(s.history.length, 0, 'initial history is empty');
  assertEq(s.getRecentlyUsedFragments().length, 0, 'initial fragments empty');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: addTurn() sets lastTopic and lastTopicAge
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.addTurn('What is ReLU?', 'ReLU is...', [0], [0], ['relu:def']);
  assertEq(s.lastTopic, 0, 'lastTopic set to first topic index');
  assertEq(s.lastTopicAge, 0, 'lastTopicAge is 0 for most recent turn');
  assertEq(s.history.length, 1, 'history has 1 entry');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: lastTopicAge increments with turns without topic
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.addTurn('Q1', 'R1', [0], [0], ['f1']);
  s.addTurn('Q2', 'R2', [], [], []); // no topics
  s.addTurn('Q3', 'R3', [], [], []);
  assertEq(s.lastTopic, 0, 'lastTopic still 0');
  assertEq(s.lastTopicAge, 2, 'lastTopicAge is 2 (two turns since last topic)');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: lastTopic updates with new topic
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.addTurn('Q1', 'R1', [0], [0], ['f1']);
  s.addTurn('Q2', 'R2', [1], [1], ['f2']);
  assertEq(s.lastTopic, 1, 'lastTopic updates to 1');
  assertEq(s.lastTopicAge, 0, 'lastTopicAge resets to 0');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: getRecentlyUsedFragments collects fragment IDs
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.addTurn('Q1', 'R1', [0], [0], ['fragA', 'fragB']);
  s.addTurn('Q2', 'R2', [1], [1], ['fragC']);
  const frags = s.getRecentlyUsedFragments(2);
  assert(frags.includes('fragA'), 'recent fragments include fragA');
  assert(frags.includes('fragB'), 'recent fragments include fragB');
  assert(frags.includes('fragC'), 'recent fragments include fragC');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5b: getRecentlyUsedFragments respects maxTurns
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.addTurn('Q1', 'R1', [0], [0], ['oldFrag']);
  s.addTurn('Q2', 'R2', [1], [1], ['newFrag']);
  const frags = s.getRecentlyUsedFragments(1); // only last 1 turn
  assert(frags.includes('newFrag'), 'last 1 turn includes newFrag');
  assert(!frags.includes('oldFrag'), 'last 1 turn excludes oldFrag');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: markFragmentUsed adds to usage tracker
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.markFragmentUsed('custom:frag');
  s.addTurn('Q', 'R', [], [], []);
  const frags = s.getRecentlyUsedFragments(1);
  assert(frags.includes('custom:frag'), 'marked fragment appears in recent');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: detectFollowUp — non-follow-up query
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  const result = s.detectFollowUp('What is reinforcement learning?');
  assertEq(result.isFollowUp, false, 'detectFollowUp: substantive query is not follow-up');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: detectFollowUp — "explain that simpler" → simplify
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  const result = s.detectFollowUp('explain that simpler');
  assert(result.isFollowUp, 'detectFollowUp: "explain that simpler" is follow-up');
  assertEq(result.type, 'simplify', 'type is simplify');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 9: detectFollowUp — "give me another example" → another_example
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  const result = s.detectFollowUp('give me another');
  assert(result.isFollowUp, 'detectFollowUp: "give me another" is follow-up');
  assertEq(result.type, 'another_example', 'type is another_example');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 10: detectFollowUp — "compare it with the previous one"
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  const result = s.detectFollowUp('compare it with the previous one');
  assert(result.isFollowUp, 'detectFollowUp: comparison is follow-up');
  assertEq(result.type, 'compare_previous', 'type is compare_previous');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 11: detectFollowUp — "give an example" → example
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  const result = s.detectFollowUp('give an example');
  assert(result.isFollowUp, 'detectFollowUp: "give an example" is follow-up');
  assertEq(result.type, 'example', 'type is example');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 12: detectFollowUp — "more detail" → elaborate
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  const result = s.detectFollowUp('more detail');
  assert(result.isFollowUp, 'detectFollowUp: "more detail" is follow-up');
  assertEq(result.type, 'elaborate', 'type is elaborate');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 13: detectFollowUp — "what about the second one" → reference_index
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  const result = s.detectFollowUp('what about the second one');
  assert(result.isFollowUp, 'detectFollowUp: ordinal reference is follow-up');
  assertEq(result.type, 'reference_index', 'type is reference_index');
  assertEq(result.target, 1, 'target index is 1 (second)');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 14: detectFollowUp — long queries (>120 chars) not follow-ups
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  const longQuery = 'explain that simpler '.repeat(10); // >120 chars
  const result = s.detectFollowUp(longQuery);
  assertEq(result.isFollowUp, false, 'detectFollowUp: long query is not follow-up');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 15: getActiveEntities — entity decay
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.addTurn('Q1', 'R1', [0], [0], []);
  s.addTurn('Q2', 'R2', [1], [1], []);
  s.addTurn('Q3', 'R3', [0], [0], []); // entity 0 mentioned again
  const active = s.getActiveEntities(10);
  assert(active.length >= 1, 'getActiveEntities returns entities');
  // Entity 0 should have higher weight (mentioned twice, more recent)
  const e0 = active.find(e => e.entity === 0);
  assert(e0 !== undefined, 'entity 0 is active');
  assert(e0.weight > 0, 'entity 0 has positive weight');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 16: reset() clears all state
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.addTurn('Q1', 'R1', [0], [0], ['f1']);
  s.markFragmentUsed('custom');
  s.getFollowUpContext('test'); // pushes engagement signal
  s.reset();
  assertEq(s.history.length, 0, 'reset: history cleared');
  assertEq(s.lastTopic, null, 'reset: lastTopic null');
  assertEq(s.lastTopicAge, 0, 'reset: lastTopicAge 0');
  assertEq(s.getRecentlyUsedFragments().length, 0, 'reset: fragments cleared');
  assertEq(s.getActiveEntities().length, 0, 'reset: entities cleared');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 17: History eviction (add many turns, oldest ejected)
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory(5); // max 5 turns
  for (let i = 0; i < 10; i++) {
    s.addTurn(`Q${i}`, `R${i}`, [i % 3], [i % 3], [`f${i}`]);
  }
  // Should have at most 5 turns (with importance-based eviction)
  assert(s.history.length <= 5, `eviction: history length ${s.history.length} <= 5`);
  // The most recent turn should be Q9
  const lastTurn = s.history[s.history.length - 1];
  assertEq(lastTurn.query, 'Q9', 'eviction: last turn is most recent');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 18: addTurn with non-string query/response coerces
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.addTurn(123, 456, null, 'not array', null);
  assertEq(s.history[0].query, '123', 'non-string query coerced');
  assertEq(s.history[0].response, '456', 'non-string response coerced');
  assertDeepEq(s.history[0].entities, [], 'non-array entities defaulted');
  assertDeepEq(s.history[0].topics, [], 'non-array topics defaulted');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 19: detectFollowUp — empty/null query
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  assertEq(s.detectFollowUp('').isFollowUp, false, 'empty query not follow-up');
  assertEq(s.detectFollowUp(null).isFollowUp, false, 'null query not follow-up');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 20: markFragmentUsed with invalid input
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.markFragmentUsed(null);
  s.markFragmentUsed('');
  s.markFragmentUsed(123);
  // Should not throw; verify no fragments recorded
  const frags = s.getRecentlyUsedFragments();
  assertEq(frags.length, 0, 'invalid fragment IDs not recorded');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 21: getHistory() returns shallow copy (mutation safe)
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  s.addTurn('Q', 'R', [0], [0], []);
  const copy = s.getHistory();
  // Shallow copy: same objects, but different array. Mutating an element
  // affects the original because object references are shared.
  assertEq(copy[0].query, 'Q', 'getHistory shallow copy has same data');
  // The array itself is different
  copy.pop();
  assertEq(s.history.length, 1, 'mutation of copy array does not affect original length');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 22: getEngagementLevel initial state
// ════════════════════════════════════════════════════════════════════════════
{
  const s = new SessionMemory();
  const el = s.getEngagementLevel();
  assertEq(el.level, 'unknown', 'engagement: initial level is unknown');
  assertEq(el.depth, 0, 'engagement: initial depth 0');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('\n');
console.log(`\x1b[1mSessionMemory Tests:\x1b[0m ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n' + failures.map(f => `  \x1b[31mFAIL\x1b[0m ${f}`).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
