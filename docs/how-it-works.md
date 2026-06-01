# How It Works

ReLU.chat's Game Theory assistant works entirely in your browser through these steps:

## 1. Model Loading (One-time)
- Downloads quantized `Xenova/all-MiniLM-L6-v2` (~23MB)
- Cached by browser via `env.useBrowserCache = true`
- Progress bar shown during initial load

## 2. Knowledge Base Encoding
- 55+ game theory concepts from `knowledge-base.js`
- Each entry contains: `name`, `aliases`, `def`, `intuition`, `examples`, `formal`, `applications`, and `related` cross-references
- Pre-computes embeddings for entire KB and all intent prototypes
- **Alias regex patterns are pre-compiled once** for fast entity extraction

## 3. Query Processing (`nlp.js`)
- **Embedding**: Convert query to 384-dimensional vector
- **Retrieval**: Cosine similarity against KB entries
- **Intent Classification**: Compare against 7 intent categories (definition, example, formal, application, comparison, greeting, help), **normalized by prototype count**
- **Entity Recognition**: Pre-compiled regex-based alias matching for known concepts
- **Fragment Selection**: Chooses best-matching paragraph from relevant categories using weighted softmax with **temperature 0.5** for diversity
- **Context Tracking**: Follow-up queries without entities use the previous topic

## 4. Response Composition
- Uses linguistic templates (`OPENERS`, `CONNECTORS`, `CLOSERS`, `TRANSITIONS`)
- Intelligently orders content based on detected intent
- **Comparison mode**: Explicit "X vs Y" framing when comparing two concepts
- Combines multiple entries when relevant
- Appends metadata (intent, similarity score, matched topics)

## 5. Rendering
- Markdown → HTML conversion
- KaTeX renders all mathematical notation
- Metadata shown as small tags below responses

## Performance Characteristics
- First query: 2-8 seconds (model warm-up)
- Subsequent queries: < 800ms on modern hardware
- **Parallel KB encoding** during init (batched in groups of 4)
- **LRU cache** (500 entries) for fragment embeddings
- Completely offline after initial model download
- Works on mobile browsers

**Nothing ever leaves your device.** No telemetry, no API calls, no cookies for tracking.

See [NLP & Retrieval Pipeline](nlp-pipeline.md) for deeper technical details.
