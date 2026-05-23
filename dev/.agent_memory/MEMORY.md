# MEMORY.md — ReLU.chat Agent Memory

## Root Decision Record

- **UTC**: 2026-05-23T19:45:00Z (updated 2026-05-23T20:30:00Z)
- **Spawn Directory**: /home/area51/Desktop/FTP/relu.chat
- **Physical Directory**: /home/area51/Desktop/FTP/relu.chat
- **Selected Work Root**: /home/area51/Desktop/FTP/relu.chat
- **Task Scope**: Policy runtime bugs + training pipeline fixes + feature extension
- **Git Root**: /home/area51/Desktop/FTP/relu.chat (commit 8a271c3)
- **Parent Memory Found**: None
- **Child Memory Found**: None
- **Resolution**: Single project root, no monorepo nesting

## Active Task

Status: COMPLETED

Two full rounds of fixes applied across 15+ files.

## Key Decisions — Round 1 (Runtime Fixes)

1. Fixed fragmentPlan ignored by renderer — policy decisions now flow through
2. Fixed template field name mismatch (opener vs openerIdx) — correct schema field names used
3. Fixed heuristic fallback pushing features object into topics — topics now enriched from context.ranked
4. Fixed lastTopicSim always returning 0 — now computes real cosine similarity
5. Fixed kbCoverage denominator using ranked.length instead of KB.length
6. Fixed domainMatch using intent embeddings instead of domain prototypes
7. Added feature normalization in MLP (discrete values scaled to [0,1])
8. Aligned ACTION_SIZES between Python training and JS inference (6 heads matching)
9. Created real PyTorch PolicyNetwork model (dev/scripts/policy_model.py)
10. Removed redundant compileAliasRegex call from BOW fallback
11. Removed dead compose import from chatbot-engine
12. Deduplicated STOP word logic between feature-extractor and nlp.js
13. Fixed action-schema.js cross-field validation (padding vs truncation)
14. Fixed pre-existing test for non-existent schema field
15. Removed unused greeterPattern dead code
16. Added console.warn when composeV2 falls back to KB[0] on empty topics

## Key Decisions — Round 2 (Feature Extension + Training Pipeline)

17. Extended feature vector from 18 to 24 features (followUpType, wasAmbiguous, avgTruthConf, avgSourceConf, minDifficulty, fragDiversity)
18. Added MLP inference tests with synthetic weight fixtures (16 new tests)
19. Replaced stub reward function with dynamic 6-component implementation
20. Activated PyTorch optimizer with loss.backward() and optimizer.step()
21. Replaced scalar EMA baseline with state-dependent value function
22. Replaced hash-based dataset builder with real sentence-transformers embeddings (with TF-IDF fallback)
23. Created LLM augmentation script (dev/scripts/augment_prompts.py)
24. Expanded network bottleneck from 24->64->32 to 24->128->64 (~4.4K to ~21K params)
25. Fixed Dockerfile with conditional checkpoint handling and placeholder fallback
26. Added all new 24-feature features to training pipeline constants

## Remaining Work (deferred)

- Add composeV2 integration tests
- Add GitHub Actions CI/CD for nightly training
- Remove deprecated per-chat nlp.js files in chat/*/js/
- Fix `policy.manifest.json` `inputBytes` mismatch (100 vs 103)
- Add Python unit tests for train-policy.py
- Add ONNX/WASM compilation integration tests
- Switch deploy.sh to SFTP from plain FTP
