/**
 * test-action-schema.js — Unit tests for AnswerPlan validation (policy/action-schema.js)
 *
 * Tests: validatePlan, DEFAULT_PLAN, isAnswerPlanLike, cross-field validation.
 *
 * Run:  node tests/test-action-schema.js
 */

import { validatePlan, DEFAULT_PLAN, PLAN_SCHEMA, isAnswerPlanLike } from '../policy/action-schema.js';

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

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: DEFAULT_PLAN is valid
// ════════════════════════════════════════════════════════════════════════════
{
  const { valid, errors } = validatePlan(DEFAULT_PLAN);
  assert(valid, 'DEFAULT_PLAN passes validation');
  assertEq(errors.length, 0, 'DEFAULT_PLAN has no errors');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: validatePlan with a valid normal plan
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = {
    mode: 'normal',
    topics: [0, 1],
    intent: 'definition',
    fragmentPlan: [
      { topicIdx: 0, cats: ['def', 'int'], fragIndices: [0, 0] },
      { topicIdx: 1, cats: ['def'], fragIndices: [0] },
    ],
    template: {
      openerIdx: 0,
      closerIdx: 1,
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
      policyHash: 'test',
      decisionPath: ['test'],
    },
  };
  const { valid, errors, sanitized } = validatePlan(plan);
  assert(valid, 'valid normal plan passes');
  assertEq(errors.length, 0, 'valid normal plan has no errors');
  assertEq(sanitized.mode, 'normal', 'sanitized mode preserved');
  assertEq(sanitized.topics.length, 2, 'sanitized topics length preserved');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: validatePlan with invalid mode → defaults applied
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = { mode: 'invalid_mode', topics: [], intent: 'definition' };
  const { valid, errors, sanitized } = validatePlan(plan);
  assert(!valid, 'invalid mode → not valid');
  assert(errors.some(e => e.includes('invalid_mode')), 'error mentions invalid mode');
  // Mode field's default in schema is 'off_topic'
  const modeSchema = PLAN_SCHEMA.mode;
  assertEq(sanitized.mode, modeSchema.default, 'mode defaults from schema');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: validatePlan with invalid intent → defaults
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = { mode: 'normal', topics: [0], intent: 'not_a_real_intent', fragmentPlan: [] };
  const { valid, errors, sanitized } = validatePlan(plan);
  assert(!valid, 'invalid intent → not valid');
  assert(errors.some(e => e.includes('intent')), 'error mentions intent');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: Missing fields get defaults
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = { mode: 'normal', topics: [] }; // many fields missing
  const { valid, errors, sanitized } = validatePlan(plan);
  assert(!valid, 'missing fields → not valid');
  assert(errors.length > 1, 'multiple missing field errors');
  assertEq(sanitized.intent, 'definition', 'intent default applied');
  assert(Array.isArray(sanitized.fragmentPlan), 'fragmentPlan default applied');
  assertEq(typeof sanitized.template, 'object', 'template default applied');
  assertEq(sanitized.tone, 'neutral', 'tone default applied');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: Cross-field — topics length != fragmentPlan length
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = {
    mode: 'normal',
    topics: [0, 1, 2],
    intent: 'definition',
    fragmentPlan: [{ topicIdx: 0, cats: ['def'], fragIndices: [0] }], // only 1
  } ;
  const { valid, errors, sanitized } = validatePlan(plan);
  assert(!valid, 'mismatched topics & fragmentPlan → not valid');
  assert(errors.some(e => e.includes('padding')), 'error mentions padding');
  // fragmentPlan should be padded to match topics
  assertEq(sanitized.fragmentPlan.length, 3, 'fragmentPlan padded to match topics');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: Cross-field — fragmentPlan longer than topics → truncated
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = {
    mode: 'normal',
    topics: [0], // only 1
    intent: 'definition',
    fragmentPlan: [
      { topicIdx: 0, cats: ['def'], fragIndices: [0] },
      { topicIdx: 1, cats: ['int'], fragIndices: [0] },
      { topicIdx: 2, cats: ['ex'], fragIndices: [0] },
    ],
  };
  const { valid, errors, sanitized } = validatePlan(plan);
  assert(!valid, 'fragmentPlan > topics → not valid');
  assert(errors.some(e => e.includes('truncat')), 'error mentions truncation');
  assertEq(sanitized.fragmentPlan.length, 1, 'fragmentPlan truncated to 1');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: Cross-field — fragmentPlan topicIdx out of range
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = {
    mode: 'normal',
    topics: [0],
    intent: 'definition',
    fragmentPlan: [{ topicIdx: 99, cats: ['def'], fragIndices: [0] }],
  };
  const { valid, errors, sanitized } = validatePlan(plan);
  assert(!valid, 'topicIdx out of range → not valid');
  // topicIdx should be fixed to 0
  assertEq(sanitized.fragmentPlan[0].topicIdx, 0, 'topicIdx fixed to 0');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 9: Cross-field — comparison mode needs ≥2 topics
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = {
    mode: 'comparison',
    topics: [0], // only 1 topic
    intent: 'comparison',
    fragmentPlan: [{ topicIdx: 0, cats: ['def'], fragIndices: [0] }],
  };
  const { valid, errors, sanitized } = validatePlan(plan);
  assert(!valid, 'comparison with 1 topic → not valid');
  assert(errors.some(e => e.includes('comparison')), 'error mentions comparison');
  assertEq(sanitized.mode, 'normal', 'mode falls back to normal');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 10: Valid comparison plan
// ════════════════════════════════════════════════════════════════════════════
{
  // Note: validatePlan requires ALL schema fields to be present or
  // they get defaults. Even with defaults filled in, the plan may
  // not be "valid" (errors.length=0) if missing fields were filled.
  // Test that validation SUCESSFULLY processes comparison with 2 topics
  // (mode is not demoted to 'normal').
  const completePlan = {
    mode: 'comparison',
    topics: [0, 1],
    intent: 'comparison',
    fragmentPlan: [
      { topicIdx: 0, cats: ['def'], fragIndices: [0] },
      { topicIdx: 1, cats: ['def'], fragIndices: [0] },
    ],
    template: { openerIdx: 0, closerIdx: 0, comparisonOpenerKey: 'none', connectorKeys: [] },
    tone: 'neutral',
    creativity: 0.5,
    guardrails: { maxTopics: 3, requireEntity: false, minSim: 0.15, allowOffTopic: false },
    clarification: null,
    meta: { policyVersion: '0.1.0', policyHash: 'test', decisionPath: [] },
  };
  const { valid, errors, sanitized } = validatePlan(completePlan);
  assert(valid, `comparison with 2 topics is valid (errors: ${errors.join('; ')})`);
  assertEq(sanitized.mode, 'comparison', 'comparison mode preserved');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 11: validatePlan(null) → DEFAULT_PLAN
// ════════════════════════════════════════════════════════════════════════════
{
  const { valid, errors, sanitized } = validatePlan(null);
  assert(!valid, 'null plan → not valid');
  assertEq(sanitized.mode, 'off_topic', 'null plan → DEFAULT_PLAN mode');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 12: validatePlan with non-object → DEFAULT_PLAN
// ════════════════════════════════════════════════════════════════════════════
{
  const { valid, sanitized } = validatePlan('not an object');
  assert(!valid, 'string plan → not valid');
  assertEq(sanitized.mode, 'off_topic', 'string → DEFAULT_PLAN');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 13: Guardrails — topics exceeding maxTopics
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = {
    mode: 'normal',
    topics: [0, 1, 2, 3, 4],
    intent: 'definition',
    fragmentPlan: [
      { topicIdx: 0, cats: ['def'], fragIndices: [0] },
      { topicIdx: 1, cats: ['def'], fragIndices: [0] },
      { topicIdx: 2, cats: ['def'], fragIndices: [0] },
      { topicIdx: 3, cats: ['def'], fragIndices: [0] },
      { topicIdx: 4, cats: ['def'], fragIndices: [0] },
    ],
    guardrails: { maxTopics: 3 },
  };
  const { errors, sanitized } = validatePlan(plan);
  assert(errors.some(e => e.includes('truncat')), 'topics exceeding maxTopics → truncated');
  assert(sanitized.topics.length <= 3, 'topics truncated to maxTopics');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 14: isAnswerPlanLike
// ════════════════════════════════════════════════════════════════════════════
{
  assert(isAnswerPlanLike(DEFAULT_PLAN), 'DEFAULT_PLAN is AnswerPlan-like');
  assert(isAnswerPlanLike({ mode: 'normal', topics: [] }), 'minimal is AnswerPlan-like');
  assert(!isAnswerPlanLike(null), 'null is not AnswerPlan-like');
  assert(!isAnswerPlanLike({}), 'empty object is not AnswerPlan-like');
  assert(!isAnswerPlanLike({ mode: 123, topics: [] }), 'wrong mode type is still AnswerPlan-like');
  assert(!isAnswerPlanLike('string'), 'string is not AnswerPlan-like');
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 15: PLAN_SCHEMA is frozen and has all expected top-level fields
// ════════════════════════════════════════════════════════════════════════════
{
  const expectedFields = ['mode', 'topics', 'intent', 'fragmentPlan', 'template', 'tone', 'creativity', 'guardrails', 'clarification', 'meta'];
  for (const f of expectedFields) {
    assert(f in PLAN_SCHEMA, `PLAN_SCHEMA has field "${f}"`);
  }
  // Verify frozen
  assert(Object.isFrozen(PLAN_SCHEMA), 'PLAN_SCHEMA is frozen');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('\n');
console.log(`\x1b[1mAction Schema Tests:\x1b[0m ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n' + failures.map(f => `  \x1b[31mFAIL\x1b[0m ${f}`).join('\n'));
}
process.exit(failed > 0 ? 1 : 0);
