# ReLU.chat WASM Policy Integration — Validation Report

**Report Date:** \_DATE\_
**Policy Version:** \_VERSION\_
**WASM Hash:** \_HASH\_
**Tester:** \_TESTER\_

---

## 1. Test Execution Summary

| Metric | Value |
|--------|-------|
| **Total Tests** | \_TOTAL\_ |
| **Passed** | \_PASSED\_ |
| **Failed** | \_FAILED\_ |
| **Skipped** | \_SKIPPED\_ |
| **Duration** | \_DURATION\_ |

---

## 2. Node.js Test Results

### 2.1 Validation Tests (`validatePlan`)

| Test ID | Description | Result | Notes |
|---------|-------------|--------|-------|
| VAL-001 | DEFAULT_PLAN is always valid | \_PASS/FAIL\_ | |
| VAL-002 | Valid plan → passes | \_PASS/FAIL\_ | |
| VAL-003 | Missing fields → uses defaults | \_PASS/FAIL\_ | |
| VAL-004 | Wrong types → rejects | \_PASS/FAIL\_ | |
| VAL-005 | Out-of-range values → rejects | \_PASS/FAIL\_ | |
| VAL-006 | Invalid mode enum → rejects | \_PASS/FAIL\_ | |
| VAL-007 | Cross-field validation | \_PASS/FAIL\_ | |

### 2.2 Feature Extraction Tests

| Test ID | Description | Result | Notes |
|---------|-------------|--------|-------|
| FEAT-001 | Feature count (18 keys) | \_PASS/FAIL\_ | |
| FEAT-002 | Normal query features | \_PASS/FAIL\_ | |
| FEAT-003 | Empty query features | \_PASS/FAIL\_ | |
| FEAT-004 | Entity match | \_PASS/FAIL\_ | |
| FEAT-005 | Comparison cues | \_PASS/FAIL\_ | |
| FEAT-006 | Formal cues | \_PASS/FAIL\_ | |
| FEAT-007 | Example cues | \_PASS/FAIL\_ | |
| FEAT-008 | Feature packing (76 bytes) | \_PASS/FAIL\_ | |
| FEAT-009 | Feature unpacking round-trip | \_PASS/FAIL\_ | |

### 2.3 Policy Runtime Tests

| Test ID | Description | Result | Notes |
|---------|-------------|--------|-------|
| RT-001 | Greeting mode detection | \_PASS/FAIL\_ | |
| RT-002 | Off-topic mode detection | \_PASS/FAIL\_ | |
| RT-003 | Normal mode detection | \_PASS/FAIL\_ | |
| RT-004 | botProfile creativityCeiling respected | \_PASS/FAIL\_ | |
| RT-005 | botProfile tone with formal override | \_PASS/FAIL\_ | |
| RT-006 | Fragment plan structure | \_PASS/FAIL\_ | |
| RT-007 | Template structure | \_PASS/FAIL\_ | |
| RT-008 | Guardrails defaults | \_PASS/FAIL\_ | |
| RT-009 | Intent selection (highest score wins) | \_PASS/FAIL\_ | |
| RT-010 | Comparison intent fallback | \_PASS/FAIL\_ | |

---

## 3. Browser Integration Tests

### 3.1 Policy Loading

| Test | Result | Console Output |
|------|--------|----------------|
| Policy version logged | \_PASS/FAIL\_ | |
| No WASM errors on load | \_PASS/FAIL\_ | |
| Network: policy.wasm (if exists) | \_PASS/FAIL/N/A\_ | |
| Network: policy.weights.bin (if exists) | \_PASS/FAIL/N/A\_ | |
| Network: policy.manifest.json | \_PASS/FAIL\_ | |

### 3.2 Response Mode Tests

| Query | Expected Mode | Actual Mode | Response Contains | Result |
|-------|---------------|-------------|-------------------|--------|
| `hi` | greeting | \_ACTUAL\_ | greeting text | \_PASS/FAIL\_ |
| `What is Nash equilibrium?` | normal/definition | \_ACTUAL\_ | definition | \_PASS/FAIL\_ |
| `CNN vs RNN` | comparison | \_ACTUAL\_ | both topics | \_PASS/FAIL\_ |
| `asdfghjkl` | off_topic | \_ACTUAL\_ | off-topic message | \_PASS/FAIL\_ |
| `Prove convergence of SGD` | normal/formal | \_ACTUAL\_ | formal content | \_PASS/FAIL\_ |
| `Give me an example of recursion` | normal/example | \_ACTUAL\_ | example | \_PASS/FAIL\_ |

---

## 4. Defects Found

### Critical

| ID | Description | Severity | Filed As |
|----|-------------|----------|----------|
| | | | |

### Major

| ID | Description | Severity | Filed As |
|----|-------------|----------|----------|
| | | | |

### Minor

| ID | Description | Severity | Filed As |
|----|-------------|----------|----------|
| | | | |

---

## 5. Decision Path Analysis

Sample `decisionPath` outputs from test queries:

```
hi:                       "heuristic → mode:greeting(low-sim+short+no-intent) → intent:definition(0.150)"
Nash equilibrium:         "heuristic → intent:definition(0.650) → topics:sim-ranked(0.720)"
CNN vs RNN:               "heuristic → intent:comparison(0.550) → comparison-opener:contrast"
asdfghjkl:                "heuristic → mode:off_topic(low-sim+no-intent) → intent:definition(0.150)"
```

---

## 6. Known Limitations / Notes

- `policy.wasm` does not yet exist — runtime falls back to heuristic (expected until `dev/scripts/train-policy.py` is run)
- Feature extractor uses `cosine` from `core/nlp.js` which requires transformer.js in browser; Node.js test uses local cosine implementation
- `lastTopicSim` feature is always 0 in current implementation (caller must set post-hoc)
- KB coverage calculation depends on `ranked` array from caller

---

## 7. Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Tester | | | |
| Reviewer | | | |
| Tech Lead | | | |

---

## Appendix: Raw Test Output

```
_PASTE_RAW_OUTPUT_HERE_
```
