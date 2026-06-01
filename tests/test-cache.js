/**
 * test-cache.js — Unit tests for LRUCache (core/cache.js)
 *
 * Tests: get/set, eviction order, has/delete/clear, max size, edge cases.
 * Run:  node tests/test-cache.js
 */

import { LRUCache } from '../core/cache.js';

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

function assertUndef(actual, msg) {
  if (actual === undefined) { passed++; process.stdout.write('\x1b[32m.\x1b[0m'); }
  else {
    failed++; failures.push(`${msg}: expected undefined, got ${JSON.stringify(actual)}`);
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: Basic get/set
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  assertEq(cache.get('a'), 1, 'get returns set value');
  assertEq(cache.get('b'), 2, 'get returns set value (2)');
  assertEq(cache.size, 2, 'size reflects set count');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: get of missing key returns undefined
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(3);
  assertUndef(cache.get('nonexistent'), 'get missing key returns undefined');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: Eviction order — oldest (least recently used) is evicted first
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.set('d', 4); // triggers eviction — 'a' should be evicted
  assertUndef(cache.get('a'), 'oldest evicted when max reached');
  assertEq(cache.get('b'), 2, 'newer entries survive eviction');
  assertEq(cache.get('c'), 3, 'middle entries survive eviction');
  assertEq(cache.get('d'), 4, 'new entry accessible');
  assertEq(cache.size, 3, 'size capped at max');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: get() refreshes position (LRU promotion)
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.get('a'); // refreshes 'a' — now 'b' is oldest
  cache.set('d', 4); // should evict 'b', not 'a'
  assertUndef(cache.get('b'), 'get-promoted: b evicted after a was refreshed');
  assertEq(cache.get('a'), 1, 'get-promoted: a still present');
  assertEq(cache.get('c'), 3, 'get-promoted: c still present');
  assertEq(cache.get('d'), 4, 'get-promoted: d present');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: set() overwrites existing key and refreshes position
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 99); // overwrite
  assertEq(cache.get('a'), 99, 'set overwrites value');
  assertEq(cache.size, 2, 'overwrite does not increase size');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: has() method
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(5);
  cache.set('x', 10);
  assert(cache.has('x'), 'has returns true for existing key');
  assert(!cache.has('y'), 'has returns false for missing key');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: delete() method
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(5);
  cache.set('a', 1);
  cache.set('b', 2);
  assert(cache.delete('a'), 'delete returns true for existing key');
  assert(!cache.has('a'), 'deleted key is gone');
  assertEq(cache.size, 1, 'size decrements after delete');
  assert(!cache.delete('z'), 'delete returns false for missing key');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: clear() method
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(5);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.clear();
  assertEq(cache.size, 0, 'size is 0 after clear');
  assertUndef(cache.get('a'), 'get returns undefined after clear');
  assert(!cache.has('b'), 'has returns false after clear');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 9: max size constraint (default 500, clamped to [1, 10000])
// ════════════════════════════════════════════════════════════════════════════
{
  // max=0 is falsy, so the constructor falls through to default 500
  const c1 = new LRUCache(0);
  assertEq(c1.max, 500, 'max=0 uses default 500');

  const c2 = new LRUCache(20000); // should clamp to 10000
  // We can't easily test 10K insertion, but verify max is clamped
  assert(c2.max <= 10000, 'max clamps to <= 10000');
  assertEq(c2.max, 10000, 'max clamps to exactly 10000');

  const c3 = new LRUCache();  // default
  assertEq(c3.max, 500, 'default max is 500');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 10: Edge case — set null/undefined values (should be rejected)
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(5);
  cache.set('a', null);
  cache.set('b', undefined);
  assertEq(cache.size, 0, 'null/undefined values not stored');
  assertUndef(cache.get('a'), 'get null value returns undefined');
  assertUndef(cache.get('b'), 'get undefined value returns undefined');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 11: Edge case — set empty arrays (should be rejected)
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(5);
  cache.set('a', []);
  assertEq(cache.size, 0, 'empty arrays not stored');
  // But non-empty arrays are OK
  cache.set('b', [1, 2, 3]);
  assertEq(cache.size, 1, 'non-empty array is stored');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 12: Edge case — get with null key
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(3);
  cache.set('valid', 42);
  assertUndef(cache.get(null), 'get(null) returns undefined');
  assertUndef(cache.get(undefined), 'get(undefined) returns undefined');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 13: Edge case — repeated sets of same key with different values
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(3);
  cache.set('a', 1);
  cache.set('a', 2);
  cache.set('a', 3);
  assertEq(cache.size, 1, 'repeated set on same key keeps size 1');
  assertEq(cache.get('a'), 3, 'repeated set stores last value');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 14: Stress — fill beyond capacity and verify oldest N evicted
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(5);
  for (let i = 0; i < 10; i++) cache.set(`k${i}`, i);
  // First 5 should be evicted
  for (let i = 0; i < 5; i++) {
    assertUndef(cache.get(`k${i}`), `stress: k${i} evicted`);
  }
  // Last 5 should remain
  for (let i = 5; i < 10; i++) {
    assertEq(cache.get(`k${i}`), i, `stress: k${i} remains`);
  }
  assertEq(cache.size, 5, 'stress: size capped');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 15: delete then re-set same key
// ════════════════════════════════════════════════════════════════════════════
{
  const cache = new LRUCache(3);
  cache.set('key', 'original');
  cache.delete('key');
  assert(!cache.has('key'), 'key deleted');
  cache.set('key', 'new');
  assertEq(cache.get('key'), 'new', 're-set after delete works');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('\n');
console.log(`\x1b[1mLRUCache Tests:\x1b[0m ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n' + failures.map(f => `  \x1b[31mFAIL\x1b[0m ${f}`).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
