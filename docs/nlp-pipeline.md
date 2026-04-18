# NLP & Retrieval Pipeline

Detailed breakdown of the intelligence layer in `js/nlp.js` and `js/app.js`.

## Embedding Strategy

- Primary: `feature-extraction` pipeline with `Xenova/all-MiniLM-L6-v2` (quantized, mean pooling, normalized)
- Fallback: Bag-of-Words (TF normalized) when model fails to load

## Retrieval Process (`compose` function)

1. **Rank KB entries** by cosine similarity of query embedding
2. **Entity Extraction**: Regex matching against all concept aliases
3. **Intent Classification**: Max cosine against intent prototype embeddings
   - Intents: `definition`, `example`, `formal`, `application`, `comparison`, `greeting`, `help`
4. **Fragment Selection**: For top entries, select best fragment per semantic category using per-fragment embedding + softmax

## Response Generation

- **Linguistic Intelligence**: 6 categories of connectors (`def_to_int`, `int_to_ex`, `form_to_app`, etc.)
- **Contextual Ordering**: Different fragment order based on detected intent
- **Multi-hop**: Can combine 1-3 related concepts when highly relevant
- **Fallback Messages**: Smart responses for greetings, help, off-topic queries

## Similarity Thresholds

- Strong match: > 0.42
- Weak match: < 0.18 triggers off-topic response
- Intent prototypes heavily influence routing

## Extensibility

The system is designed so new chatbots can be added by:
1. Creating new knowledge-base.js with domain-specific structured entries
2. Updating intent prototypes if needed
3. Minor UI tweaks

This is a **lightweight RAG** system without any LLM — fully deterministic and auditable.
