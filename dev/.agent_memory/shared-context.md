# Shared Context — relu.chat

## Project Overview

**relu.chat** is a fully deployed, browser-based, privacy-first open-source chatbot platform. Features include **Game Theory Chat** and **Golden Age Inquiry** — on-device AI assistants for mathematical game theory and Islamic Golden Age scientific discoveries.

- **Domain**: relu.chat
- **Hosting**: Namecheap Linux shared hosting, Pure-FTPd (port 21)
- **Backend**: None — 100% client-side WebAssembly
- **Deployment**: FTP via lftp-based `deploy.sh`
- **Current Version**: v1.2.0

## Current State

- [x] Git repository initialized
- [x] Landing page (index.html) — marketing site with features, showcase, newsletter
- [x] Game Theory Chat (`/chat/game-theory-chat/`) — full on-device NLU assistant
- [x] Golden Age Inquiry (`/chat/golden-age-inquiry/`) — full on-device NLU assistant
- [x] Knowledge bases: 55+ game theory concepts, 20+ Golden Age topics
- [x] PHP email handler (api/subscribe.php)
- [x] .htaccess security configuration
- [x] Custom error pages (404, 403, 500)
- [x] FTP deployment script (deploy.sh)
- [x] Centralized config (config.js) for all thresholds
- [x] CSP fixed for HuggingFace model downloads
- [x] Production deployed and live
- [x] UI refresh (v1.3.0) — refined dark theme, removed AI-slop patterns, tighter typography, cleaner color palette

## Architecture Decisions

1. **No backend for chat** — all NLP runs in-browser via Transformers.js
2. **Fragment-based composition** — not LLM generation; deterministic, auditable responses
3. **Pre-compiled entity regex** — alias patterns compiled once at init, not per-query
4. **LRU cache** — bounded fragment embedding cache (500 entries)
5. **Parallel KB encoding** — batched in groups of 4 during init
6. **Config centralization** — all magic numbers in `config.js`
7. **Cross-referenced KB** — `related` field links conceptually linked entries
8. **Conversation context** — `lastTopic` tracker for follow-up queries
9. **Normalized intent classification** — prototype count normalization prevents bias
10. **FTP deployment** — `docs/` excluded from production (local-only documentation)
11. **Shared architecture** — all chat bots use identical app.js/nlp.js/ui.js patterns with domain-specific knowledge bases

## Active Tasks

None.

## Open Flags

None.

## Forward Notes

- **Next steps**: Additional chatbots (Cryptography, Quantum Computing), PWA support, conversation export
- **Deploy**: `./deploy.sh` — respects `.deployignore` (excludes `docs/`, `.env`, `deploy.sh`)
- **GitHub**: `git push origin main` — `.gitignore` excludes `docs/`, `.env`, `deploy.sh`
- **KB versions**: Game Theory `1.1.0`, Golden Age `1.0.0`
- **CSP fix**: Added HuggingFace CDN domains to chat HTML CSP meta tags (was causing offline mode fallback)
- **UI refresh notes (v1.3.0)**:
  - Removed gradient text clichés, "featured"/"new" badges, decorative gradient lines
  - Tightened color palette: no purple tones, more restrained blue accent (#1d4ed8)
  - Refined typography hierarchy with proper letter-spacing
  - Cleaner shadows (3-layer Vercel-style), no glow-overuse
  - Removed status indicator "ready" labels and blinking dot patterns from landing page
  - Chat CSS: smaller status dot (5px), removed box-shadow glow on dot, tighter spacing throughout
  - Backups in `_backups/backup-YYYYMMDD-HHMMSS/`
