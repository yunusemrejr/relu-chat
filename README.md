# ReLU.chat

**On-device, browser-based, open-source chatbots.** Your conversations never leave your computer — no servers, no tracking, no LLMs.

## Features

- **Privacy-first** — All processing happens in your browser using WebAssembly
- **Browser-based** — No installation required, works on any modern browser
- **Open-source** — Fully auditable codebase
- **No LLMs** — Lightweight NLU with transformer-based embeddings + knowledge base retrieval

## Chatbots

| Chatbot | Description |
|---------|-------------|
| [Game Theory Chat](chat/game-theory-chat/) | On-device assistant for game theory concepts: Nash equilibrium, Shapley value, auctions, and more |

## How It Works

1. **Load** — The transformer model downloads once and caches in your browser
2. **Encode** — Your question is embedded locally using the model
3. **Retrieve** — Relevant knowledge base fragments are found via similarity search
4. **Compose** — A response is assembled from weighted fragments, with intent classification
5. **Render** — Mathematical notation is typeset with KaTeX

Everything runs entirely on your device. Nothing is sent to any server.

## Tech Stack

- **Transformers.js** — In-browser ML with `@xenova/transformers`
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

- A web server with PHP support (for `api/subscribe.php`)
- HTTPS enabled
- Proper MIME types for CSS, JS, and WASM files

## License

MIT
