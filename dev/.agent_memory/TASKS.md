# TASKS.md — Completed Work Log

## Round 1: Runtime Bugs + Refactoring

| Task | Agent | Files |
|------|-------|-------|
| Template field name fix | coder-pro | core/nlp.js |
| comparisonOpenerKey fix | coder-pro | core/nlp.js |
| fragmentPlan renderer fix | coder-pro | core/nlp.js |
| Heuristic topics enrichment | coder-pro | policy/policy-runtime.js |
| lastTopicSim real cosine | coder-pro | policy/feature-extractor.js |
| entryEmb context forwarding | coder-pro | policy/policy-runtime.js, core/chatbot-engine.js |
| domain prototypes fix | coder-pro | core/chatbot-engine.js |
| kbCoverage fix | coder-pro | policy/feature-extractor.js |
| MLP feature normalization | coder-pro | policy/mlp-inference.js |
| ACTION_SIZES alignment | coder-heavy | dev/scripts/train-policy.py |
| Real PyTorch model created | coder-heavy | dev/scripts/policy_model.py (NEW) |
| ONNX export real impl | coder-heavy | dev/scripts/train-policy.py |
| WASM compilation functional | coder-heavy | dev/scripts/train-policy.py |
| Dockerfile fix | coder-heavy | dev/Dockerfile.policy-build |
| Requirements update | coder-heavy | dev/scripts/requirements.txt |
| Redundant alias regex removed | code-refactorer | core/chatbot-engine.js |
| Dead compose import removed | code-refactorer | core/chatbot-engine.js |
| STOP word dedup | code-refactorer | policy/feature-extractor.js |
| Action-schema validation fix | code-refactorer | policy/action-schema.js |
| Test fix for schema field | code-refactorer | dev/scripts/test-policy-runtime.js |

## Round 2: Feature Extension + Training Pipeline Completion

| Task | Agent | Files |
|------|-------|-------|
| Feature vector 18->24 | coder-pro | policy/feature-extractor.js, policy/mlp-inference.js, policy/policy-runtime.js, policy/policy.manifest.json, dev/scripts/train-policy.py, dev/scripts/policy_model.py, dev/scripts/test-policy-runtime.js |
| MLP inference tests (16 new) | coder-pro | dev/scripts/test-policy-runtime.js |
| Dynamic reward function | coder-heavy | dev/scripts/train-policy.py |
| Active optimizer + backward | coder-heavy | dev/scripts/train-policy.py |
| State-dependent value baseline | coder-heavy | dev/scripts/train-policy.py |
| Real sentence-transformers dataset | coder-heavy | dev/scripts/train-policy.py |
| LLM augmentation script | master-of-chaos | dev/scripts/augment_prompts.py (NEW) |
| Bottleneck 24->128->64 | master-of-chaos | dev/scripts/policy_model.py, policy/mlp-inference.js, dev/scripts/test-policy-runtime.js |
| Dockerfile conditional build | master-of-chaos | dev/Dockerfile.policy-build |

## Verification Results

| Check | Result |
|-------|--------|
| JS test suite (144 tests) | ALL PASS |
| Python syntax (train-policy.py) | OK |
| Python syntax (policy_model.py) | OK |
| Python syntax (augment_prompts.py) | OK |
| Action spaces (Python vs JS) | MATCH (6 heads, 24 features) |
| Weight shapes (PyTorch vs JS) | MATCH (all 16 tensors) |
| Optimizer active | YES (Adam, backward, step) |
| Value baseline | State-dependent (not EMA) |
| Backup | _backups/pre-fix-20260523/ (66MB) |
