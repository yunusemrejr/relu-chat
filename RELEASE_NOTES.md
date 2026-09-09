# September 2026 release

Six learning assistants now cover 219 topics: Game Theory, Golden Age Inquiry, Data Science, Reinforcement Learning, Linear Algebra, and Web Platform. The release adds 14 learning guides, bringing the blog to 62 articles.

The shared chat interface understands casual messages such as “hey sup,” “what do you mean?”, “howww,” and “ok got it,” without losing the current topic. It includes clearer topic routing and follow-ups, source links, mobile input improvements, chat reset/export, immediate complete answers, and optional semantic matching. The homepage, article navigation, blog search, structured data, and 79-page sitemap were updated. Timed sales popups were removed.

A CPU-only trainer matches the deployed architecture and completes the recorded run in 3.101 seconds. Joint held-out routing accuracy improved from 93.6% to 98.6%; supervised and REINFORCE checkpoints tied on that test. These scores do not measure factual-answer accuracy. Reproducible results and scope are in `data/policy-evaluation.json`.

The policy now has real fixed-memory WebAssembly inference with JavaScript parity. Keyword indexing is substantially faster in the recorded microbenchmark. Large model downloads are optional, public embeddings can be cached, and mutable assets bypass CDN freshness overrides.

Development and deployment use one release workflow: `npm test` runs the local/CI checks; the production hook packages the same Git commit using a public-file allowlist, preserves runtime data, records hashes, and maintains private rollback backups. Training candidates, deployment records, databases, and bytecode remain local. See README.md for commands and limitations.
