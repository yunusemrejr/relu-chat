# October 2026 release: smarter answers, honest limits

All six assistants share a new inference layer that understands a whole message before answering. It splits multi-part questions ("what is X and how does it relate to Y?") and answers every part. It follows "it", "he", "they", "the second one" and "its memory" across turns with a Bayes filter over topics. It answers who, when, where and yes/no questions with the sentence that carries the answer, and it remembers whether you asked for short or detailed replies.

When a question goes beyond the notes, the assistant says so and offers what it does know. It names the closest covered topic, quotes the passage where an uncovered term appears, or sends you to the assistant that covers it, through a link that asks your question there. "I don't have notes on X" requires specific evidence: an unknown word in a short concept question, a term the notes never use, or a modifier that turns a known topic into a different one ("quantum game theory"). Topics asked for by name are never refused. Thresholds were checked with split-conformal calibration on 1,489 questions generated from the knowledge bases; none was refused.

A separate model wrote a final question set after the layer was frozen, and it was scored once. On it, the previous pipeline refused 29.2% of questions about covered topics; the new layer refused 4.2%. All of those refusals came from short follow-ups such as "Convince me." being judged as separate questions, which is now fixed. The same blind run measured 86.1% correct topics (52.8% before), 87.5% honest handling of uncovered concepts (52.1%), 91.7% routing of other-assistant questions (none before) and 91.7% complete multi-part answers (16.7%). These figures measure routing and honesty, not the factual accuracy of the curated text. The development and casual-chat sets, their histories and per-assistant results are in `data/dialogue-evaluation.json`.

The trained policy network still advises intent and depth, and the previous pipeline remains as an automatic fallback. Everything runs locally in a few milliseconds with no new download.

# September 2026 release

Six learning assistants now cover 219 topics: Game Theory, Golden Age Inquiry, Data Science, Reinforcement Learning, Linear Algebra, and Web Platform. The release adds 14 learning guides, bringing the blog to 62 articles.

The shared chat interface understands casual messages such as “hey sup,” “what do you mean?”, “howww,” and “ok got it,” without losing the current topic. It includes clearer topic routing and follow-ups, source links, mobile input improvements, chat reset/export, immediate complete answers, and optional semantic matching. The homepage, article navigation, blog search, structured data, and 79-page sitemap were updated. Timed sales popups were removed.

Definitions introduce a new subject with its curated overview before moving into details. Related-topic suggestions omit unresolved internal IDs. Data Science knowledge and exported packs include corrected bias–variance and cross-validation explanations, with scikit-learn references.

A CPU-only trainer matches the deployed architecture and completes the recorded run in 3.101 seconds. Joint held-out routing accuracy improved from 93.6% to 98.6%; supervised and REINFORCE checkpoints tied on that test. These scores do not measure factual-answer accuracy. Reproducible results and scope are in `data/policy-evaluation.json`.

The policy now has real fixed-memory WebAssembly inference with JavaScript parity. Keyword indexing is substantially faster in the recorded microbenchmark. Large model downloads are optional, public embeddings can be cached, and mutable assets bypass CDN freshness overrides.

Development and deployment use one release workflow: `npm test` runs the local/CI checks; the production hook packages the same Git commit using a public-file allowlist, preserves runtime data, records hashes, and maintains private rollback backups. Training candidates, deployment records, databases, and bytecode remain local. See README.md for commands and limitations.
