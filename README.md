# ReLU.chat

Six free learning assistants that retrieve and explain curated knowledge in your browser. Chat questions are processed locally. Hosting, optional model downloads, external links, and separate signup or purchase flows still use the network.

## Learn

| Assistant | Topics |
|---|---:|
| [Game Theory](https://relu.chat/chat/game-theory-chat/) | 80 |
| [Golden Age Inquiry](https://relu.chat/chat/golden-age-inquiry/) | 50 |
| [Data Science](https://relu.chat/chat/data-science-chat/) | 41 |
| [Reinforcement Learning](https://relu.chat/chat/reinforcement-learning-chat/) | 16 |
| [Linear Algebra](https://relu.chat/chat/linear-algebra-chat/) | 16 |
| [Web Platform](https://relu.chat/chat/web-platform-chat/) | 16 |

There are also six interactive ML tools and 62 learning guides. The assistants can misunderstand questions. They assemble curated fragments, do not execute code, and cannot solve arbitrary exercises.

## Runtime

The shared vanilla JavaScript engine starts with keyword matching, explicit entity/intent cues, and field-weighted BM25. A 13,079-parameter policy chooses response actions using verified WebAssembly or JavaScript. Built-in rules keep chat usable if policy assets are unavailable. Complete answers include math and available source links, with topic follow-ups, reset, and text export. Shared conversational handling understands casual greetings, thanks, acknowledgments, and stretched words such as “howww.” Clarification and example requests reuse the current topic; without context, the assistant asks which topic you mean. A greeting before a real question does not hide the question. These small turns do not require model inference.

Enhanced semantic matching is optional. Its button loads the approximately 22 MB quantized MiniLM model plus Transformers.js runtime files. The complete knowledge/intent embedding set is prepared before switching backends; incompatible query vectors are cleared. Public knowledge embeddings are cached by content hash in IndexedDB. Conversations remain in memory unless exported. The service worker caches pages on use and preserves downloaded model bytes; it does not preload the large model on every first visit.

## Develop and verify

Use Node.js 22.13 or newer and Python 3.11 or newer locally. `npm run dev` serves the site at http://127.0.0.1:8017. No npm dependency installation is needed. PHP endpoints require a PHP-capable server. Production uses HTTPS and the Apache rules in `.htaccess`.

```bash
npm test
```

This runs every unit suite, six-bot conversation checks, committed model/WASM parity fixtures, deployment safety tests, blog validation, and the 79-page static site audit. Results go to ignored `dev/exports/`. GitHub Actions runs the same command on pushes and pull requests with a ten-minute job timeout. It does not install PyTorch, run nightly training, or publish models.

## Fast laptop policy training

Install the CPU training dependency with `python3 -m pip install -r dev/requirements-fast.txt` in your preferred virtual environment. Clang with wasm-ld is needed to rebuild WASM. No PyTorch, GPU, or remote training service is needed. The whole workflow can be bounded below the ten-minute allowance:

```bash
# This outer deadline covers dataset generation, training, and verification.
timeout 580s bash -e -c '
  node dev/scripts/build-policy-dataset.mjs
  python3 dev/scripts/train-policy-fast.py --max-seconds 120
  bash dev/scripts/build-policy-wasm.sh
  node dev/scripts/verify-fast-policy.mjs
'
```

Training has a supervised warm-up followed by fresh on-policy contextual-bandit REINFORCE updates, a reward baseline, and an entropy bonus. Reward measures agreement with authored routing labels; it does not measure factuality or user satisfaction. The export matches the runtime architecture without LayerNorm, and folds training feature scaling into the first layer. Training accepts at most 540 seconds and exports candidates under `dev/exports/fast-policy/`; it does not automatically publish weights. `verify-fast-policy.mjs` verifies that candidate, rather than silently evaluating deployed weights.

The September 9 release used 2,688 authored cases, split into 1,830 train, 420 validation, and 438 test cases. Topics are disjoint across splits; training templates differ from validation/test templates. The final run took 3.10 seconds. Joint test mode/intent accuracy was 93.6% for the old policy and 98.6% for both the supervised and RL checkpoints. No additional RL test gain was measured. Two development training runs took 6.33 seconds in total.

Before promotion, inspect the validation gate, compare against the prior model, check Python/JS/WASM parity, and run chat regressions. Publish matching model bytes and SHA-256 manifests together. The public report at `data/policy-evaluation.json` includes the scope and measurements. Learned action heads do not replace retrieval, and these figures do not establish general chatbot accuracy.

## Content

Author blog posts in `content/blog/posts/`. `dev/scripts/build-release-content.cjs` adds the September release posts and updates discovery while preserving hand-edited article pages. `scripts/blog/generate.js` is the full regeneration path; use it only when intentionally replacing generated HTML. `dev/scripts/build-catalog.mjs` derives bot navigation from `data/manifest.json`. `dev/scripts/export-bot-pack.js` builds packs with real fragments and references browser-generated embeddings rather than placeholder vectors.

## Commit-based production deployment

`dev/scripts/release_files.py` defines the shared public-file allowlist. `package-release.py` reads a specific Git commit, not the dirty working tree. `deploy-reviewed-release.py` verifies hashes, backs up changed files outside the web root, replaces them atomically, verifies every public file, and records the source commit. It never deletes production files or deploys databases, uploads, secrets, development tools, or test results.

```bash
python3 dev/scripts/package-release.py --commit HEAD --output dev/exports/releases/current
python3 dev/scripts/verify-production.py --manifest dev/exports/releases/current/release.json
```

On a deployment host, install `dev/scripts/post-receive` as the bare repository's executable `hooks/post-receive`. Configure `relu.webRoot` and `relu.backupRoot` in that repository's Git config with absolute, separate directories. The hook deploys `main`, serializes updates with `flock`, and records the exact commit in the private backup root's `current-release.json`. Push the verified commit to GitHub, wait for release checks, and then push the same commit to the deployment remote. Compare both remote refs and the deployment receipt before considering a release complete.

The deployer's explicit `rollback` mode restores a selected backup's prior files. Use the same web/backup roots and check for later unrelated changes before restoring. It leaves newly added files in place, unlinked by restored pages.

Local databases, Python bytecode, training candidates, generated bot-pack experiments, archives, and host-specific release reports are ignored. Runtime databases are created by the PHP endpoint when needed and are never part of a public source release. The frozen policy evaluation is published in `data/policy-evaluation.json`, numerical fixtures live in `tests/fixtures/`, and source data/baselines remain versioned for reproducibility.

Source code: MIT license.
