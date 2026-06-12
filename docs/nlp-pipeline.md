# NLP & Retrieval Pipeline

Detailed breakdown of the intelligence layer in `js/nlp.js` and `js/app.js`.

## Configuration

All magic numbers are centralized in `config.js`:
- Thresholds (`OFF_TOPIC`, `GREETING_FALLBACK`, `SECONDARY_ENTRY`, `ENTITY_BOOST`)
- Composition settings (`FRAGMENT_TEMP`, `MAX_ENTRIES`)
- Cache size limits

## Embedding Strategy

- Primary: `feature-extraction` pipeline with `Xenova/all-MiniLM-L6-v2` (quantized, mean pooling, normalized)
- Fallback: Bag-of-Words (TF normalized) when model fails to load

## Retrieval Process (`compose` function)

1. **Rank KB entries** by cosine similarity of query embedding
2. **Entity Extraction**: Pre-compiled regex matching against all concept aliases (compiled once at init)
3. **Intent Classification**: Max cosine against intent prototype embeddings, **normalized by prototype count** to prevent bias toward intents with more prototypes
4. **Fragment Selection**: For top entries, select best fragment per semantic category using per-fragment embedding + softmax with **temperature 0.5** (diverse but relevant)
5. **Conversation Context**: Tracks `lastTopic` to resolve follow-up queries with no explicit entities

## Response Generation

- **Linguistic Intelligence**: 6 categories of connectors (`def_to_int`, `int_to_ex`, `form_to_app`, etc.)
- **Contextual Ordering**: Different fragment order based on detected intent
- **Comparison Mode**: When intent is `comparison` and two entities are detected, uses explicit "X vs Y" framing for both entries
- **Multi-hop**: Can combine 1-3 related concepts when highly relevant
- **Fallback Messages**: Smart responses for greetings, help, off-topic queries
- **Related Concepts**: Appends "See also" references based on interlinked KB entries

## Similarity Thresholds

Configured in `config.js`:
- Strong match: > 0.42
- Weak match: < 0.18 triggers off-topic response
- Intent prototypes normalized by count to prevent bias

## Extensibility

The system is designed so new chatbots can be added by:
1. Creating new knowledge-base.js with domain-specific structured entries
2. Updating intent prototypes if needed
3. Minor UI tweaks

This is a **lightweight RAG** system without any LLM — fully deterministic and auditable.
