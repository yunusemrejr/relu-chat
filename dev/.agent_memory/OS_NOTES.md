# OS_NOTES.md — Environment Notes

## System

- **OS**: Linux
- **Platform**: linux (Mint/Ubuntu)
- **Node**: v22.21.1
- **Python**: 3.12.3
- **Shell**: bash

## Workspace

- **Work Root**: /home/area51/Desktop/FTP/relu.chat
- **Physical Root**: /home/area51/Desktop/FTP/relu.chat (same)
- **Git Root**: Same (commit 8a271c3)
- **Backup Dir**: /home/area51/Desktop/FTP/relu.chat/_backups/
- **Agent Memory**: /home/area51/Desktop/FTP/relu.chat/dev/.agent_memory/

## Project Structure

- Core engine: core/ (nlp.js, chatbot-engine.js, session.js, cache.js, ui.js)
- Policy runtime: policy/ (policy-runtime.js, feature-extractor.js, mlp-inference.js, action-schema.js)
- Chat bots: chat/ (game-theory-chat, golden-age-inquiry, data-science-chat)
- Bot data: data/bots/ (knowledge.js, intents.js, overrides.js per bot)
- Training: dev/scripts/ (train-policy.py, policy_model.py, test-policy-runtime.js, annotate-fragments.py)
- Architecture docs: docs/ (architecture.md, nlp-pipeline.md, wasm-policy-architecture.json)

## Test Command

```bash
node dev/scripts/test-policy-runtime.js
```

## Deployment

- FTP-based via deploy.sh
- Requires .env with credentials
- See deploy.sh.example for reference
