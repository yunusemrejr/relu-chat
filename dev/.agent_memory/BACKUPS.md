# BACKUPS.md — Backup Records

## Backup: pre-fix-20260523

- **Date**: 2026-05-23
- **Source**: /home/area51/Desktop/FTP/relu.chat/
- **Destination**: /home/area51/Desktop/FTP/relu.chat/_backups/pre-fix-20260523/
- **Size**: 66 MB
- **Files**: 166
- **Excluded**: .git, node_modules, _backups, .agent-logs, .deployments
- **Reason**: Pre-fix snapshot before applying all critical runtime bug fixes, training pipeline alignment, and code refactoring
- **Critical files verified**: policy/policy-runtime.js, policy/feature-extractor.js, policy/mlp-inference.js, policy/action-schema.js, core/nlp.js, core/chatbot-engine.js, core/session.js, dev/scripts/train-policy.py, dev/scripts/test-policy-runtime.js

## Restore Command

```bash
rsync -a _backups/pre-fix-20260523/ .  # restore from backup
```

## Current Git Status (post-fix)

```
M core/chatbot-engine.js
M core/nlp.js
M dev/Dockerfile.policy-build
M dev/scripts/requirements.txt
M dev/scripts/test-policy-runtime.js
M dev/scripts/train-policy.py
M policy/action-schema.js
M policy/feature-extractor.js
M policy/mlp-inference.js
M policy/policy-runtime.js
?? dev/scripts/policy_model.py
```

All changes are uncommitted. Commit before deploy.
