# HANDOFF.md — Agent Continuation Summary

## State at Handoff

**Date**: 2026-05-23T20:15:00Z  
**Test Status**: 116/116 passing  
**Git Status**: 10 modified files + 1 untracked (policy_model.py)  
**Backup**: _backups/pre-fix-20260523/ (66MB, restorable)

## What Was Accomplished

### Runtime Contract Fixes
The policy-to-renderer contract is now whole. All critical bugs that prevented the policy's output from being correctly consumed by the renderer are fixed:
- fragmentPlan is now read from the policy plan (not rebuilt from scratch)
- Template field names match the schema (openerIdx/closerIdx, not opener/closer)
- comparisonOpenerKey is read from the plan
- Heuristic fallback enriches topics from context.ranked instead of pushing feature objects
- lastTopicSim computes real cosine similarity
- kbCoverage uses KB.length as denominator
- Domain prototypes are properly pre-embedded (not using intent embeddings)
- MLP normalizes discrete features (version-gated)

### Training Pipeline Alignment
The Python training pipeline now matches the JS inference engine:
- Same 6-head action space (mode, intent, topic_count, frag_count, creativity, tone)
- Real PyTorch PolicyNetwork model with proper architecture
- Real ONNX export (not a stub)
- Dockerfile and requirements.txt fixed

### Code Quality
- STOP word logic deduplicated across modules
- Dead imports and redundant calls removed
- Cross-field validation correctly handles both padding and truncation
- Pre-existing test expectation mismatch fixed

## Files Changed (10 modified, 1 new)

| File | Change Type | Summary |
|------|-------------|---------|
| core/nlp.js | MODIFIED | fragmentPlan fix, openerIdx/closerIdx field names, comparisonOpenerKey, empty topics warning |
| core/chatbot-engine.js | MODIFIED | entryEmb in context, domain prototype embedding, removed compose import, removed redundant compileAliasRegex |
| policy/policy-runtime.js | MODIFIED | Enriched heuristic plan, entryEmb pass-through, context.overrides fix, removed greeterPattern dead code |
| policy/feature-extractor.js | MODIFIED | lastTopicSim computation, kbCoverage fix, tokens import, removed computeQueryLen/STOP duplication |
| policy/mlp-inference.js | MODIFIED | Feature normalization (version-gated) |
| policy/action-schema.js | MODIFIED | Cross-field validation (pad vs truncate) |
| dev/scripts/train-policy.py | MODIFIED | ACTION_SIZES aligned, ONNX export real, WASM compile functional, model import |
| dev/scripts/policy_model.py | NEW | Real PyTorch PolicyNetwork (4088 params) |
| dev/scripts/test-policy-runtime.js | MODIFIED | Test expectation fixed for fragmentPlan padding, invalid lastTopicAge test removed |
| dev/Dockerfile.policy-build | MODIFIED | Fixed invalid --onnx-path flag |
| dev/scripts/requirements.txt | MODIFIED | Added sentence-transformers, onnx-simplifier, onnxoptimizer |

## Remaining Work for Next Agent

### High Priority
1. **Implement PPO training loop** in train-policy.py (replace stub REINFORCE with proper PPO with state-dependent baseline, GAE, clipped surrogate)
2. **Add MLP inference tests** in test-policy-runtime.js using synthetic weight fixtures
3. **Add composeV2 integration tests** that verify the full plan-to-renderer pipeline
4. **Retrain the policy** once training loop is real: `python3 dev/scripts/train-policy.py --bot game-theory --epochs 1000`

### Medium Priority
5. **Extend feature vector** from 18 to 20 features: add followUp type (7-class one-hot or int) and wasPreviousAmbiguous (bool). Update manifest.json inputFeatures, WEIGHT_SHAPES, all serialization code
6. **Add GitHub Actions workflow** for nightly training on T4 GPU
7. **Remove deprecated chat/*/js/nlp.js** files (check HTML references first)

### Low Priority
8. Add performance benchmarks (dev/benchmarks/)
9. Fill in validation report template (dev/audits/policy-validation-report.md)
10. Switch deploy.sh to SFTP/FTPS from plain FTP
11. Add deployment locking mechanism
12. Implement backup retention policy

## Precautions
- All changes are uncommitted. The next agent should review git diff before committing.
- The .env file contains FTP credentials that should NOT be committed.
- Backup exists at _backups/pre-fix-20260523/ for rollback.
