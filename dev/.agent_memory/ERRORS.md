# ERRORS.md — Records of Failures and Discrepancies

## Pre-existing Test Expectation Mismatch

- **File**: dev/scripts/test-policy-runtime.js (line 235)
- **Issue**: Test expected `fragmentPlan.length === 1` after validating topics=[0,1,2] with fragmentPlan having 1 entry. The old action-schema.js silently did nothing (slice on shorter array is no-op). After FIX R6, the code correctly pads fragmentPlan to match topics length, producing 3 entries.
- **Resolution**: Updated test assertion to expect `=== 3`.
- **Status**: Fixed

## Concurrent Agent Analysis Discrepancies

- **Issue**: Code-analyzer and architect agents ran concurrently with coder-heavy and coder-pro. Their analysis reports flagged issues that were being fixed simultaneously by other agents (ACTION_SIZES mismatch, feature normalization).
- **Resolution**: All reported issues verified as fixed after re-reading files. No actual defects remained.
- **Status**: Resolved by post-fix verification

## Known Limitations (deferred)

1. No MLP inference tests (requires synthetic weight fixtures)
2. No composeV2 integration tests
3. Follow-up type and ambiguity signals not yet in feature vector (would require extending 18 features to 20 and updating manifest)
4. Training pipeline still uses skeleton training loop (real PPO not implemented)
5. Greeting pattern regex in heuristic fallback cannot test raw query string (feature signals only)
