# ReLU.chat Documentation

Welcome to the official documentation for **ReLU.chat** — a privacy-first, fully on-device, open-source collection of specialized chatbots that run entirely in the browser.

## Table of Contents

- [Project Overview](overview.md)
- [System Architecture](architecture.md)
- [How It Works](how-it-works.md)
- [Game Theory Chat](chatbot-game-theory.md)
- [Knowledge Base](knowledge-base.md)
- [NLP & Retrieval Pipeline](nlp-pipeline.md)
- [Design System](design-system.md)
- [Deployment](deployment.md)
- [Contributing & Roadmap](contributing.md)

## Core Principles
- **100% client-side**: No servers, no data collection, no API keys
- **Lightweight ML**: Uses quantized `all-MiniLM-L6-v2` via Transformers.js
- **Mathematical clarity**: Heavy use of KaTeX for game theory notation
- **Auditable**: Single static site, no build step, pure vanilla JS
- **Configurable**: All thresholds centralized in `config.js`
- **Documentation is offline-only**: See [Documentation Policy](documentation-policy.md)

Last updated: April 2026 (v1.1.0)

**Remote Repository** (public, no docs): https://github.com/yunusemrejr/relu-chat  
**Live Production Site**: https://relu.chat  
**Local Repository**: Contains full codebase + offline `docs/` folder (never pushed)  
**Deployment**: Via `deploy.sh` + lftp (respects `.deployignore` — excludes `docs/`)  

**Important**: The `docs/` folder exists **only** in the local git repository and on this device. It is never published to remote or production. This rule is documented within the docs themselves.
