# Game Theory Chat — Architecture Review & Improvement Plan

## 1. Understanding of the Current Implementation

### What the system is
A fully on-device, browser-based chatbot specialized in mathematical game theory. It uses **Transformers.js** (`all-MiniLM-L6-v2`) for semantic embeddings, a hand-curated **knowledge base** of 55 game theory concepts (each with 5 fragment categories: definition, intuition, example, formal, application), and a **compositional response engine** that classifies user intent, retrieves relevant KB entries via cosine similarity, selects weighted fragments, and assembles natural-language responses with LaTeX rendering via KaTeX.

### Architecture philosophy
- **Privacy-first**: nothing leaves the browser
- **No LLMs**: deterministic, fragment-based composition rather than generation
- **Lightweight**: single HTML entry, no build step, FTP-deployable
- **Graceful degradation**: BOW (bag-of-words) fallback if the transformer fails to load
- **Domain-specific**: tightly scoped to game theory, with high-quality mathematical content

### Tech stack
- `@xenova/transformers@2.17.2` (feature-extraction pipeline, quantized)
- Vanilla JS (ES modules), CSS variables, KaTeX
- 5 files: `index.html`, `app.js`, `ui.js`, `nlp.js`, `knowledge-base.js`, `styles.css`

---

## 2. Key Findings

### 2.1 — Entity extraction is fragile (nlp.js:40–50)
`extractEntities()` builds a new `RegExp` for every KB alias on every query. This is O(n × m) regex compilations per query (55 entries × ~3 aliases each = ~165 regex compilations per message). The regex uses `\b` word boundaries which fail for aliases containing spaces, hyphens, or special characters (e.g., `"prisoner's dilemma"`, `"p-guessing"`). The function also re-scans the full KB even when the transformer embeddings are working well.

### 2.2 — Intent classification is flat and unweighted (nlp.js:56–66)
All intent prototype phrases are treated equally. The cosine similarity is computed against every prototype, taking the max. There is no normalization for prototype count per intent (e.g., `formal` has 7 prototypes, `greeting` has 6, `comparison` has 5). Intents with more prototypes have an inherent advantage. No confidence threshold differentiation per intent.

### 2.3 — Hardcoded similarity thresholds (app.js:99, nlp.js:99–104)
The thresholds `0.18` (off-topic), `0.30` (greeting/help fallback), `0.42` (secondary entry inclusion), and `0.50` (entity-boosted inclusion) are magic numbers tuned for `all-MiniLM-L6-v2`. These are brittle: a different model or domain vocabulary shift would require retuning all of them. They are also spread across two files.

### 2.4 — Fragment selection uses temperature 0.12 (nlp.js:77)
`softmax(scores, 0.12)` is extremely low temperature — it's nearly argmax. This reduces diversity in fragment selection, making responses repetitive for similar queries. The temperature is hardcoded with no way to tune it per category.

### 2.5 — No conversation history or context
Each query is processed in complete isolation. There's no session memory, no ability to resolve pronouns ("What about its Nash equilibrium?" after asking about Prisoner's Dilemma), no follow-up context. The `compose()` function signature accepts only the current query.

### 2.6 — Duplicate suggestion buttons (app.js:115–145)
Two separate sets of suggestion buttons are created: one from hardcoded `SUGGESTIONS` array (lines 115–133) and one from `data-q` attributes in HTML (lines 139–145). These overlap partially but are managed separately, creating redundant click handlers and inconsistent behavior.

### 2.7 — Knowledge base has no versioning or metadata
The KB is a flat array of `kb()` calls. There's no version identifier, no last-updated timestamp, no difficulty level, no cross-references between related concepts (e.g., Nash Equilibrium ↔ Subgame Perfect Equilibrium ↔ Perfect Bayesian Equilibrium). The `entryText()` function concatenates everything into one string, losing structural information.

### 2.8 — No error recovery beyond BOW fallback
If the transformer loads but WebAssembly is unsupported, or if the model quantization is incompatible with the user's browser, the error handler catches it but there's no granular diagnosis. The BOW fallback produces significantly worse results with no indication to the user about degraded quality beyond the status text.

### 2.9 — KaTeX rendering is fragile (ui.js:67–75)
`renderMathInElement` targets `div:last-child` of `.msg-body`, but the DOM structure includes `.meta` as the first child, making `last-child` potentially wrong when meta chips are present. The KaTeX delimiters use `$` which can conflict with regular text containing dollar signs.

### 2.10 — Memory leak risk with fragment cache (app.js:12)
`fragEmbCache` is a `Map` with a soft cap of 1000 entries but no eviction policy. Under heavy use (many unique queries), it grows unbounded until the cap, then stops caching entirely. No LRU, no size monitoring.

### 2.11 — No accessibility beyond basic ARIA
The input has `aria-label`, messages have `role="log"` and `aria-live="polite"`, but there's no focus management after sending, no keyboard navigation for suggestion chips, no screen reader announcement when new messages arrive beyond the live region (which can be overwhelming).

### 2.12 — CSS has unused/duplicated rules
- `.msg.bot .msg-body` has shadow/border/padding rules that are then overridden (lines 290–298 in styles.css have empty rule blocks)
- `.suggestions-inline` class is defined in CSS but never used in HTML
- Two separate `.suggestion` button styles (one for the scrollable bar, one for inline) with near-identical definitions

### 2.13 — No CSP or security headers
The HTML has no `<meta http-equiv="Content-Security-Policy">`. Given that this is a privacy-focused product, the absence of CSP is a missed opportunity to enforce the "no external scripts beyond CDN" guarantee.

### 2.14 — Model version is hardcoded and untested for updates
`Xenova/all-MiniLM-L6-v2` is pinned at the version bundled with `transformers@2.17.2`. If the model is updated upstream with breaking changes, there's no version pinning at the model level. No integrity check (SRI) on the CDN scripts.

### 2.15 — Comparison intent never triggers multi-entry responses properly
The `comparison` intent (nlp.js:22) has order `['def', 'int', 'ex']` but `compose()` at line 119 only uses the first entry's full order and secondary entries get only `order[0]`. For comparisons, both entities should get full treatment, but the logic at lines 107–113 doesn't special-case comparison.

---

## 3. Prioritized Improvement Plan

### Priority 1 — Critical correctness & robustness

#### 1a. Fix entity extraction regex (nlp.js)
Pre-compile all alias regex patterns once during `init()` instead of per-query. Store compiled patterns alongside KB entries.

```javascript
// In knowledge-base.js, add to each entry:
aliasRegex: null  // populated at init

// In app.js init(), after KB loads:
for (const e of KB) {
  e.aliasRegex = e.aliases.map(a => new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'));
}

// In extractEntities, use pre-compiled:
export function extractEntities(query, compiledAliases) {
  const q = ' ' + query.toLowerCase() + ' ';
  const found = [], seen = new Set();
  for (let i = 0; i < compiledAliases.length; i++) {
    for (const re of compiledAliases[i]) {
      if (re.test(q) && !seen.has(KB[i].id)) {
        found.push(i);
        seen.add(KB[i].id);
        break;
      }
    }
  }
  return found;
}
```

#### 1b. Consolidate and document thresholds (new `config.js`)
Extract all magic numbers into a single configuration object:

```javascript
export const CONFIG = {
  EMBEDDING: { model: 'Xenova/all-MiniLM-L6-v2', quantized: true },
  THRESHOLDS: {
    OFF_TOPIC: 0.18,
    GREETING_FALLBACK: 0.30,
    SECONDARY_ENTRY: 0.42,
    ENTITY_BOOST: 0.50,
  },
  COMPOSITION: {
    FRAGMENT_TEMP: 0.12,
    OPENER_WEIGHT: 0.6,
    MAX_ENTRIES: 3,
  },
  CACHE: { MAX_FRAG_EMBEDDINGS: 1000 },
};
```

Import this everywhere instead of hardcoded values.

#### 1c. Fix duplicate suggestion buttons (app.js)
Remove the `data-q` buttons from HTML and the corresponding event listener (lines 139–145). Keep only the JS-generated buttons from the `SUGGESTIONS` array, which is already defined. Alternatively, keep the HTML buttons and remove the JS-generated ones, populating the JS array from `document.querySelectorAll('.suggestion[data-q]')`.

#### 1d. Fix KaTeX target selector (ui.js:68)
```javascript
// Current (broken):
const target = role === 'bot' ? div.querySelector('.msg-body > div:last-child') : ...

// Fixed:
const target = div.querySelector('.msg-body > div:not(.meta)');
```

### Priority 2 — Quality & user experience

#### 2a. Add related-concept cross-references to KB
Add a `related` field to each KB entry listing concept IDs that are conceptually linked. In `compose()`, after generating the response, append a "See also" line with links to related concepts that weren't already covered.

```javascript
// In knowledge-base.js kb() function, add 7th parameter:
kb(id, name, aliases, summary, f, related=[])

// Example:
kb('nash_eq', 'Nash Equilibrium', [...], {...}, ['spe', 'corr_eq', 'mixed_strat'])

// In compose(), after building text:
const related = topEntries.flatMap(i => KB[i].related || []).filter(r => !topEntries.includes(KB.findIndex(e => e.id === r)));
if (related.length > 0) {
  text += '\n\nSee also: ' + related.slice(0, 3).map(id => KB.find(e => e.id === id).name).join(', ') + '.';
}
```

#### 2b. Improve intent classification with prototype normalization
Weight scores by inverse prototype count to prevent intent bias:

```javascript
export async function classifyIntent(qEmb, intentEmb) {
  const scores = {};
  for (const k of Object.keys(INTENTS)) {
    let max = -1;
    for (const pe of intentEmb[k]) {
      const s = cosine(qEmb, pe);
      if (s > max) max = s;
    }
    // Normalize by number of prototypes (fewer prototypes = higher bar)
    scores[k] = max * Math.log(intentEmb[k].length + 1);
  }
  // ... rest unchanged
}
```

#### 2c. Increase fragment temperature for diversity
Change `softmax(scores, 0.12)` to `softmax(scores, 0.5)` for categories with multiple fragments. This produces more varied responses across repeated similar queries while still favoring relevant fragments.

#### 2d. Add comparison-specific response logic
When intent is `comparison` and two entities are detected, structure the response to explicitly contrast them:

```javascript
if (intent === 'comparison' && topEntries.length >= 2) {
  const connector = `**${KB[topEntries[0]].name}** vs **${KB[topEntries[1]].name}** — `;
  // Build contrasting response
}
```

#### 2e. Lightweight conversation context
Add a `lastTopic` tracker (the most-recently-discussed KB entry ID). When a query has no entities but `lastTopic` is set and the top-ranked entry similarity is moderate (> 0.25), treat it as a follow-up about `lastTopic`:

```javascript
let lastTopic = null;

// In compose(), after entity extraction:
if (entities.length === 0 && lastTopic && ranked[0].s > 0.25) {
  entities = [KB.findIndex(e => e.id === lastTopic)];
}

// At end of compose:
if (topEntries.length > 0) lastTopic = KB[topEntries[0]].id;
```

### Priority 3 — Performance & maintainability

#### 3a. Replace unbounded Map cache with simple LRU
```javascript
class LRUCache {
  constructor(max) { this.max = max; this.cache = new Map(); }
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const v = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, v);
    return v;
  }
  set(key, val) {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.max) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, val);
  }
}

// Usage:
const fragEmbCache = new LRUCache(500);
```

#### 3b. Parallelize KB embedding during init
The current `init()` embeds KB entries sequentially. Use `Promise.all` with batching to parallelize:

```javascript
const BATCH = 4;
for (let i = 0; i < KB.length; i += BATCH) {
  const batch = KB.slice(i, i + BATCH).map(e => embed(entryText(e)));
  entryEmb.push(...await Promise.all(batch));
  bar.style.width = ((i + BATCH) / KB.length * 100) + '%';
}
```

#### 3c. Add CSP meta tag to HTML
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none';">
```

#### 3d. Add SRI to CDN scripts
```html
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
```

#### 3e. Remove unused CSS
- Delete `.suggestions-inline` rules (lines 404–439)
- Delete empty `.msg.bot .msg-body` rule block (line 299)
- Consolidate the two `.suggestion` style blocks

#### 3f. Web Worker for embedding computation
Move `embed()` calls to a Web Worker to prevent UI blocking during inference. The transformer pipeline runs synchronously within the `await`, blocking the main thread. A worker would keep the UI responsive during model warm-up and query processing.

```javascript
// embed-worker.js
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
let extractor = null;
self.onmessage = async (e) => {
  if (e.data.type === 'init') {
    extractor = await pipeline('feature-extraction', e.data.model, { quantized: true });
  } else if (e.data.type === 'embed') {
    const out = await extractor(e.data.text, { pooling: 'mean', normalize: true });
    self.postMessage({ id: e.data.id, vec: Array.from(out.data) });
  }
};
```

### Priority 4 — Polish & future-proofing

#### 4a. KB versioning
Add `KB_VERSION = '1.0.0'` and `KB_UPDATED = '2026-01-15'` to `knowledge-base.js`. Display in a subtle footer or debug chip.

#### 4b. Add `description` field to KB entries
Currently `summary` serves double duty. Add a separate `description` for longer-form explanations that can be used in future "deep dive" mode.

#### 4c. Search endpoint for KB
Add a lightweight client-side search: when user types in the input, show matching KB concept names as autocomplete suggestions (not just the static suggestion buttons).

#### 4d. Export conversation
Add a button to export the conversation as markdown or JSON, consistent with the privacy-first philosophy.

---

## 4. Summary of Impact

| Area | Current State | After Improvements |
|------|--------------|-------------------|
| Entity extraction | O(n×m) regex per query, fails on special chars | Pre-compiled, O(n) per query, robust |
| Intent classification | Unnormalized, prototype-count biased | Normalized, fair across intents |
| Response diversity | Near-argmax (temp=0.12), repetitive | Higher temp (0.5), varied responses |
| Conversation flow | Stateless, no context | Light follow-up tracking |
| Memory | Unbounded cache, leak risk | LRU eviction, bounded |
| Performance | Sequential KB embedding, main-thread blocking | Parallel init, optional worker |
| Security | No CSP, no SRI | CSP enforced, SRI on CDN |
| KB maintainability | Flat array, no cross-refs | Versioned, interlinked concepts |
| Comparison queries | Generic treatment | Dedicated contrast logic |
| CSS bloat | ~15% unused rules | Clean, minimal |

All changes preserve the fundamental architecture: on-device processing, fragment-based composition, no server calls, no LLMs, no build step, FTP-deployable.
