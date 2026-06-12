# System Architecture

## High-Level Overview

ReLU.chat is a **pure static website** with no backend. All intelligence runs client-side using WebAssembly.

```
Browser
├── index.html (Marketing site)
├── chat/game-theory-chat/
│   ├── index.html (Chat UI + CSP)
│   ├── css/styles.css
│   ├── js/
│   │   ├── config.js      → Centralized thresholds, model config, cache limits
│   │   ├── ui.js          → DOM, rendering, KaTeX
│   │   ├── nlp.js         → Intent classification (normalized), retrieval, response composition
│   │   ├── knowledge-base.js → 55+ structured game theory concepts with cross-references
│   │   ├── app.js         → Main orchestration + Transformers.js + LRU cache
│   └── (model cached by browser)
├── errors/ (custom Apache error pages)
└── .htaccess (caching, security headers)
```

## Core Components

### 1. Landing Page (`index.html`)
- Single-file marketing site (~1660 LOC with inline CSS/JS)
- Follows strict design spec in `DESIGN.md`
- Dark technical aesthetic inspired by Linear, Vercel, and xAI

### 2. Game Theory Chat Application
- **Transformers.js** (`@xenova/transformers`)
- Quantized `all-MiniLM-L6-v2` model (~23MB, cached)
- Hand-crafted Knowledge Base (structured JSON-like objects with `related` cross-references)
- Cosine similarity retrieval + intent classification (prototype-count normalized)
- Smart templated response generation with linguistic connectors
- KaTeX for beautiful math rendering
- **LRU cache** for fragment embeddings (bounded, no memory leaks)

### 3. Configuration (`config.js`)
- All thresholds consolidated in one file
- Model version, cache limits, composition parameters
- Easy tuning without hunting through source files

### 4. Deployment Pipeline
- `deploy.sh` + `lftp` for FTP sync to shared hosting
- `.deployignore`, `.htaccess`, extensive deployment logging
- No build step — pure static files

## Data Flow (Query → Response)

1. User types question
2. `app.js:handle()` → `embed()` (transformer or BOW fallback)
3. `nlp.js:compose()`:
   - Rank KB entries by cosine similarity
   - Classify intent using prototype embeddings (normalized by count)
   - Entity extraction via **pre-compiled** alias regex
   - Select best fragments per category (def/int/ex/form/app) with temperature 0.5
   - Track `lastTopic` for conversation context
   - Stitch with linguistic connectors and openers/closers
4. Render with KaTeX and metadata tags (intent, similarity score)

## Fallback System

If the transformer model fails to load:
- Automatically switches to Bag-of-Words (TF) vectorization
- Still provides reasonable retrieval using the same KB

This architecture prioritizes **auditability, privacy, and minimalism**.
