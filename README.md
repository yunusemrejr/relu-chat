# ReLU.chat

**On-device, browser-based, open-source chatbots.** Your conversations never leave your computer — no servers, no tracking, no LLMs.

## Features

- **Privacy-first** — All processing happens in your browser using WebAssembly
- **Browser-based** — No installation required, works on any modern browser
- **Open-source** — Fully auditable codebase
- **No LLMs** — Lightweight NLU with transformer-based embeddings + knowledge base retrieval
- **Configurable** — All thresholds centralized in `config.js`
- **Fast** — Progressive loading (heuristic/BOW fallback for instant first turns + hot-swap to full transformer), query embedding memoization, top-k ranking, LRU caches, pre-compiled entity patterns
- **Progressive** — Heuristic fallback handles the very first interactions immediately while the ~22 MB model streams in the background (aided by Service Worker preloading); full dense pipeline hot-swaps seamlessly.

## Chatbots

| Chatbot | Description |
|---------|-------------|
| [Game Theory Chat](chat/game-theory-chat/) | On-device assistant for game theory concepts: Nash equilibrium, Shapley value, auctions, and more (55+ topics) |
| [Golden Age Inquiry](chat/golden-age-inquiry/) | On-device assistant for the scientific and philosophical discoveries of the Islamic Golden Age (8th–14th centuries) |

## How It Works

1. **Load** — Progressive: heuristic + BOW fallback enables immediate responses on first visit while the quantized MiniLM ONNX (~22 MB) and KB embeddings load in background (Service Worker pre-caches). Full pipeline hot-swaps once ready. KB entries encoded (with memoization on repeat visits) and BM25 IDF pre-computed.
2. **Embed** — Your query is embedded into a 384-dimensional vector using a quantized MiniLM model running in-browser.
3. **Signal Layer** — BM25 sparse retrieval, entity extraction, dense cosine ranking, and intent classification are fused into a structured decision packet.
4. **Policy** — A 13K-parameter RL-trained MLP policy network selects mode, intent, topics, fragment order, tone, and creativity.
5. **Compose** — Knowledge fragments are assembled with linguistic connectors into a natural response.
6. **Render** — Mathematical notation is typeset with KaTeX.

Everything runs entirely on your device. Nothing is sent to any server.

## Tech Stack

- **Transformers.js** — In-browser ML with `@xenova/transformers` (MiniLM-L6-v2, quantized ONNX)
- **BM25** — Sparse retrieval with IDF pre-computation (k1=1.5, b=0.75)
- **MLP** — 13K-parameter policy network (25 inputs, 6 action heads)
- **KaTeX** — Fast LaTeX math rendering
- **Vanilla JS** — No framework dependencies
- **CSS** — Custom design system with CSS variables

## Development

```bash
# Clone the repository
git clone https://github.com/yunusemrejr/relu-chat.git
cd relu-chat

# Serve locally (any static file server works)
python -m http.server 8000
# or
npx serve .
```

## Deployment

Deploy the contents of this repository to any static file server. The site requires:

- HTTPS enabled
- Proper MIME types for CSS, JS, and WASM files

## License

MIT
