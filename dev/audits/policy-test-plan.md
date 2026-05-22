# ReLU.chat WASM Policy Integration — Manual Test Plan

**Date:** \_DATE\_
**Tester:** \_TESTER\_
**Policy Version:** \_VERSION\_ (from policy.manifest.json)
**WASM Hash:** \_HASH\_ (from policy.manifest.json)

---

## Overview

This test plan covers validation of the WASM policy integration at `policy/` (relative to project root). The policy system has three main layers:

1. **action-schema.js** — Plan schema definition and `validatePlan()`
2. **feature-extractor.js** — 18-feature extraction and `packFeatures()`/`unpackFeatures()`
3. **policy-runtime.js** — WASM loading, `planAnswer()`, and `planAnswerHeuristic()`

---

## 1. Validation Tests (`validatePlan`)

> **Module:** `/policy/action-schema.js`
> **Run in Node.js:** `node dev/scripts/test-policy-runtime.js --section=validation`

### 1.1 DEFAULT_PLAN is always valid

- [ ] `validatePlan(DEFAULT_PLAN)` returns `{ valid: true, errors: [] }`
- [ ] The returned `sanitized` equals `DEFAULT_PLAN`

### 1.2 Valid plan → passes

- [ ] Create a plan with all fields populated correctly:
  ```js
  {
    mode: 'normal',
    topics: [0, 1],
    intent: 'definition',
    fragmentPlan: [{ topicIdx: 0, cats: ['def'], fragIndices: [0] }],
    template: { openerIdx: 0, closerIdx: 0, comparisonOpenerKey: 'none', connectorKeys: [] },
    tone: 'neutral',
    creativity: 0.5,
    guardrails: { maxTopics: 3, requireEntity: false, minSim: 0.15, allowOffTopic: false },
    meta: { policyVersion: '0.1.0', policyHash: 'test', decisionPath: [] }
  }
  ```
- [ ] `validatePlan(plan)` returns `valid: true`
- [ ] Returned `sanitized` has all fields preserved

### 1.3 Missing fields → uses defaults

- [ ] Pass empty object `{}` → `valid: true` (uses all defaults)
- [ ] Pass `{ mode: 'greeting' }` → `valid: true`, missing fields filled from schema defaults
- [ ] Check `errors` array contains one entry per missing field

### 1.4 Wrong types → rejects

- [ ] `{ mode: 123 }` → error on `mode` field
- [ ] `{ topics: 'not-an-array' }` → error on `topics` field
- [ ] `{ creativity: 'high' }` → error on `creativity` field
- [ ] `{ guardrails: [] }` → error on `guardrails` field

### 1.5 Out-of-range values → rejects

- [ ] `{ creativity: 1.5 }` → `1.5 > max 1`
- [ ] `{ creativity: -0.1 }` → `-0.1 < min 0`
- [ ] `{ topics: [1, 2, 3, 4, 5, 6] }` → `length 6 > maxItems 3`
- [ ] `{ fragmentPlan: [{ topicIdx: 99 }] }` → `topicIdx=99 out of range` (cross-field validation)

### 1.6 Invalid mode enum → rejects

- [ ] `{ mode: 'fast' }` → `"fast" not in enum [normal, off_topic, greeting, help, comparison]`
- [ ] `{ mode: '' }` → empty string not in enum
- [ ] `{ intent: 'summary' }` → `"summary" not in enum [definition, example, formal, application, comparison]`

### 1.7 Cross-field validation

- [ ] `topics.length !== fragmentPlan.length` → `fragmentPlan` is truncated to match `topics.length`
- [ ] `mode === 'comparison'` with `topics.length < 2` → mode auto-corrected to `'normal'`
- [ ] `topics.length > guardrails.maxTopics` → `topics` truncated

---

## 2. Feature Extraction Tests

> **Module:** `/policy/feature-extractor.js`
> **Run in Node.js:** `node dev/scripts/test-policy-runtime.js --section=features`

### 2.1 Feature count

- [ ] `extractPolicyFeatures()` returns an object with exactly 18 keys
- [ ] Feature names match the spec:
  - `qSimTop1`, `qSimTop2` (f32, indices 0–1)
  - `entityCount` (u8, index 2)
  - `entityBoostHit` (bool, index 3)
  - `intentDefScore`, `intentExScore`, `intentFormScore`, `intentAppScore`, `intentCompScore` (f32, indices 4–8)
  - `lastTopicSim` (f32, index 9)
  - `lastTopicAge` (u8, index 10)
  - `kbCoverage` (f32, index 11)
  - `queryLenTokens` (u8, index 12)
  - `hasComparisonCue`, `hasFormalCue`, `hasExampleCue` (bool, indices 13–15)
  - `botCreativity` (f32, index 16)
  - `domainMatch` (f32, index 17)

### 2.2 Normal query

- [ ] Call with a normal definition query like "What is a neural network?"
- [ ] Verify `qSimTop1` and `qSimTop2` are between 0 and 1
- [ ] Verify `entityCount >= 0`
- [ ] Verify all intent scores are between 0 and 1

### 2.3 Empty query

- [ ] Call with `query: ''`
- [ ] `queryLenTokens` should be at least 1 (minimum enforced)
- [ ] All similarity scores should be 0
- [ ] `entityCount` should be 0
- [ ] `hasComparisonCue`, `hasFormalCue`, `hasExampleCue` all false

### 2.4 Entity match

- [ ] Query contains an entity that exists in KB (e.g., "Nash equilibrium")
- [ ] `extractEntities()` finds the entity
- [ ] `entityCount > 0`
- [ ] `entityBoostHit` is `true` if a top-5 ranked entry matches the entity

### 2.5 Comparison cues

- [ ] Query "What is the difference between CNN and RNN?" → `hasComparisonCue: true`
- [ ] Query "Compare machine learning and deep learning" → `hasComparisonCue: true`
- [ ] Query "X vs Y" → `hasComparisonCue: true`
- [ ] Query "Tell me about AI" → `hasComparisonCue: false`

### 2.6 Formal cues

- [ ] Query "Prove that gradient descent converges" → `hasFormalCue: true`
- [ ] Query "Give the mathematical definition of entropy" → `hasFormalCue: true`
- [ ] Query "What's a theorem about topology?" → `hasFormalCue: true`

### 2.7 Example cues

- [ ] Query "Give me an example of recursion" → `hasExampleCue: true`
- [ ] Query "Illustrate how quicksort works" → `hasExampleCue: true`

### 2.8 Feature packing

- [ ] `packFeatures(features)` returns object with keys: `float32`, `uint8`, `buffer`
- [ ] `float32` is a `Float32Array` of length 18
- [ ] `uint8` is a `Uint8Array` of length 4
- [ ] `buffer.byteLength === 76` (18 * 4 + 4)

### 2.9 Feature unpacking (round-trip)

- [ ] `unpackFeatures(packFeatures(features))` returns an object with all 18 features
- [ ] Round-trip preserves `entityCount`, `lastTopicAge`, `queryLenTokens` exactly (uint8 values)
- [ ] Round-trip preserves boolean features exactly
- [ ] Round-trip preserves float values within 0.001 precision

---

## 3. Policy Runtime Tests

> **Module:** `/policy/policy-runtime.js`
> **Run in Node.js:** `node dev/scripts/test-policy-runtime.js --section=runtime`

### 3.1 `planAnswerHeuristic` — mode detection

#### Greeting intent
- [ ] Low `qSimTop1` (< 0.15) + very short query (≤4 tokens) + no content cues → mode `'greeting'`
- [ ] `decisionPath` includes `'mode:greeting'`

#### Off-topic detection
- [ ] Low `qSimTop1` (< 0.15) + has content cues (example/formal) → mode `'off_topic'`
- [ ] Low `qSimTop1` (< 0.12) + `qSimTop2` (< 0.10) + no entities + long query → mode `'off_topic'`
- [ ] `decisionPath` includes `'mode:off_topic'`

#### Normal mode
- [ ] Normal query with decent similarity → mode `'normal'`

#### Comparison mode
- [ ] Query with comparison cue + high second similarity → mode determined by intent classifier
- [ ] If intent is `'comparison'` but `qSimTop2 < 0.25` → intent falls back to `'definition'`

### 3.2 `planAnswerHeuristic` — respects botProfile

- [ ] Pass `config.botProfile.creativityCeiling = 0.2`
- [ ] `plan.creativity <= 0.2`
- [ ] Pass `config.botProfile.tone = 'formal'`
- [ ] If query has formal cue, `plan.tone` should be `'formal'` (override)

### 3.3 `planAnswerHeuristic` — fragment plan structure

- [ ] `fragmentPlan` is an array
- [ ] Each entry has `topicIdx`, `cats` (array), `fragIndices` (array)
- [ ] For `intent: 'definition'`, cats order is `['def', 'int', 'ex']`
- [ ] For `intent: 'example'`, cats order is `['ex', 'int', 'def']`
- [ ] For `intent: 'comparison'` with ≥2 topics, second topic gets only first cat

### 3.4 `planAnswerHeuristic` — template structure

- [ ] `template.openerIdx` is a number ≥ 0
- [ ] `template.closerIdx` is a number ≥ 0
- [ ] `template.comparisonOpenerKey` is `'both'`, `'contrast'`, `'similarity'`, or `'none'`
- [ ] `template.connectorKeys` is an array of strings like `'def_to_int'`

### 3.5 `planAnswerHeuristic` — guardrails

- [ ] `guardrails.maxTopics` is set from `config.botProfile.maxTopics` or default 3
- [ ] `guardrails.requireEntity` is `false`
- [ ] `guardrails.minSim` is `0.15`
- [ ] `guardrails.allowOffTopic` is `true` when mode is `'off_topic'`

### 3.6 Manifest validation

- [ ] Load with valid manifest → `ready: true`
- [ ] Load with invalid manifest (missing `version`) → `ready: false`, error logged
- [ ] Load with `inputFeatures !== 18` → `ready: false`, error logged
- [ ] Load with non-array `botProfiles` → `ready: false`, error logged

### 3.7 WASM loading fallback

- [ ] Set `skipWasm: true` → `ready: true` (heuristic mode), not `ready: false`
- [ ] WASM unavailable → falls back to heuristic, no crash
- [ ] WASM fetch fails → falls back to heuristic, `error` field contains reason

---

## 4. Engine Integration Tests (Browser Manual)

> **Files:** `core/chatbot-engine.js`, `core/nlp.js`, `policy/policy-runtime.js`

### 4.1 Policy loaded indicator

1. Open browser DevTools → Console
2. Navigate to any bot page (e.g., `/bots/relu.html`)
3. Wait for loading to complete
4. [ ] Console shows `[policy-runtime] Ready. Policy version: X.X.X, model: Y`
5. [ ] No `[policy-runtime]` warnings about WASM failures (if WASM is expected)

### 4.2 Network tab verification

1. Open DevTools → Network tab
2. Reload the bot page
3. [ ] `policy.wasm` is requested and returns HTTP 200 (or 0 bytes if not built yet — see note below)
4. [ ] `policy.weights.bin` is requested
5. [ ] `policy.manifest.json` is requested

> **Note:** If `policy.wasm` does not exist yet (expected before `dev/scripts/train-policy.py` is run), the runtime will fall back to heuristic. This is expected behavior. The Network tab should show the fetch failing with 404, and the console should show the fallback warning.

### 4.3 Greeting response

1. Type: `hi`
2. [ ] Response is a greeting (contains "Hi!" or similar)
3. [ ] DevTools Console shows decision path with `mode:greeting`

### 4.4 Definition query

1. Type: `What is Nash equilibrium?`
2. [ ] Response contains a definition of Nash equilibrium
3. [ ] Response is not off-topic

### 4.5 Comparison query

1. Type: `What is the difference between CNN and RNN?`
2. [ ] Response includes comparison framing (e.g., "While X and Y are related...")
3. [ ] Response covers both topics

### 4.6 Off-topic query

1. Type: `asdfghjkl qwertyuiop`
2. [ ] Response indicates off-topic (e.g., "didn't map to anything I know")
3. [ ] DevTools Console shows `mode:off_topic` in decision path

### 4.7 Formal query

1. Type: `Prove the convergence of gradient descent`
2. [ ] Response addresses formal/mathematical content
3. [ ] `hasFormalCue: true` detected

### 4.8 Example query

1. Type: `Give me an example of recursion`
2. [ ] Response includes a concrete example
3. [ ] `hasExampleCue: true` detected

---

## 5. Edge Cases

### 5.1 Empty KB
- [ ] Load with empty KB array → no crash
- [ ] `planAnswer` returns safe fallback plan

### 5.2 Malformed entity input
- [ ] Pass `entities` as non-array → gracefully handled, treated as empty

### 5.3 NaN/Infinity in embeddings
- [ ] `qEmb` contains `NaN` → features derived from it default to 0
- [ ] Similarity scores computed from `NaN` embeddings → 0

### 5.4 Very long query
- [ ] Query with 100+ tokens after stop-word filtering → `queryLenTokens` capped at 32

### 5.5 Unicode/special characters
- [ ] Query: `"What is π?"` → no crash, features extracted normally
- [ ] Query: `"Bonjour, c'est quoi le machine learning?"` → works (mixed language)

---

## 6. Test Execution Checklist

- [ ] All Node.js unit tests pass: `node dev/scripts/test-policy-runtime.js`
- [ ] Policy manifest is present and valid
- [ ] WASM binary exists (or absence is expected and logged)
- [ ] Browser console shows no errors on page load
- [ ] All manual browser tests above pass
- [ ] No console errors during any browser interaction

---

## Appendix: Quick Commands

```bash
# Run all Node.js policy tests
cd /home/area51/Desktop/FTP/relu.chat
node dev/scripts/test-policy-runtime.js

# Run specific section
node dev/scripts/test-policy-runtime.js --section=validation
node dev/scripts/test-policy-runtime.js --section=features
node dev/scripts/test-policy-runtime.js --section=runtime

# Verify policy manifest exists
cat /home/area51/Desktop/FTP/relu.chat/assets/models/policy/policy.manifest.json
```
