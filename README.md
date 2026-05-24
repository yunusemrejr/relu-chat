# ReLU.chat

**On-device, browser-based, open-source chatbots.** Your conversations never leave your computer — no servers, no tracking, no LLMs.

## Features

- **Privacy-first** — All processing happens in your browser using WebAssembly
- **Browser-based** — No installation required, works on any modern browser
- **Open-source** — Fully auditable codebase
- **No LLMs** — Lightweight NLU with transformer-based embeddings + knowledge base retrieval
- **Configurable** — All thresholds centralized in `config.js`
- **Fast** — Parallel KB encoding, LRU cache, pre-compiled entity patterns

## Chatbots

| Chatbot | Description |
|---------|-------------|
| [Game Theory Chat](chat/game-theory-chat/) | On-device assistant for game theory concepts: Nash equilibrium, Shapley value, auctions, and more (55+ topics) |
| [Golden Age Inquiry](chat/golden-age-inquiry/) | On-device assistant for the scientific and philosophical discoveries of the Islamic Golden Age (8th–14th centuries) |

## How It Works

1. **Load** — The transformer model downloads once and caches in your browser. KB entries are encoded and BM25 IDF is pre-computed.
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
