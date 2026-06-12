/**
 * budget-classifier.js — ReLU.chat Answer Budget Classifier
 *
 * Determines the appropriate answer budget (micro|short|medium|long|diagram_plus_text)
 * using purely local heuristics. This runs before the MLP is retrained with budget
 * prediction, providing a graceful degradation path.
 *
 * Budget enforcement is handled downstream in nlp.js composeV2().
 *
 * @module core/budget-classifier
 * @version 1.0.0
 */

// ---------------------------------------------------------------------------
// Budget classifier — local heuristic rules
// ---------------------------------------------------------------------------

/**
 * Classify the user query into an answer budget using local heuristics.
 *
 * Rules (in priority order, first match wins):
 * 1. Lexical brevity cues: "brief", "tl;dr", "short", "summary", "recap" → short
 * 2. Lexical quick cues: "quick", "fast" → short or micro
 * 3. Depth cues: "prove", "derive", "why", "how exactly", "detailed",
 *    "in depth", "thorough", "comprehensive", "rigorous", "elaborate" → long
 * 4. Device hints: small screen (window.innerWidth < 600) or data-saver mode → short
 * 5. Conversation state: repeated follow-ups increase detail gradually
 *    - depth ≥ 4 → long, depth ≥ 2 → medium
 * 6. Uncertainty: low top-1 similarity (< 0.3) → short (prefer conservative)
 * 7. Default: medium
 *
 * @param {string} query          - normalized user query
 * @param {Object} [context={}]   - runtime context
 * @param {boolean} [context.isMobile]            - device is small screen (auto-detected if omitted)
 * @param {boolean} [context.saveData]            - data-saver mode active (auto-detected if omitted)
 * @param {number}  [context.followUpDepth=0]     - consecutive turns on same topic chain
 * @param {number}  [context.topSim=0.5]          - top-1 cosine similarity (confidence proxy)
 * @param {number}  [context.entityCount=0]       - number of matched entities
 * @param {boolean} [context.hasDiagramAvailable=false] - whether diagram fragments exist
 * @returns {string} one of 'micro', 'short', 'medium', 'long', 'diagram_plus_text', 'auto'
 */
export function classifyAnswerBudget(query, context = {}) {
  // ── Resolve environment-sensitive defaults (safe for SSR / non-browser) ──
  const isMobile = (context.isMobile !== undefined)
    ? context.isMobile
    : (typeof window !== 'undefined' && window.innerWidth < 600);
  const saveData = (context.saveData !== undefined)
    ? context.saveData
    : (typeof navigator !== 'undefined' && !!(navigator.connection && navigator.connection.saveData));
  const followUpDepth = typeof context.followUpDepth === 'number' ? context.followUpDepth : 0;
  const topSim = typeof context.topSim === 'number' ? context.topSim : 0.5;
  const entityCount = typeof context.entityCount === 'number' ? context.entityCount : 0;
  const q = (typeof query === 'string' ? query : '').toLowerCase().trim();

  // ── Rule 1: Lexical brevity cues → short ──
  if (/\b(brief|short|summary|summarize|recap|tl;dr)\b/i.test(q)) {
    return 'short';
  }

  // ── Rule 2: "quick" / "fast" → short (or micro if no entity matched) ──
  if (/\b(quick|fast)\b/i.test(q)) {
    return entityCount === 0 ? 'micro' : 'short';
  }

  // ── Rule 3: Depth/intensive cues → long ──
  if (/\b(prove|derive|why|how\s+exactly|detailed|in\s+depth|thorough|comprehensive|explain\s+deeply|rigorous|elaborate)\b/i.test(q)) {
    return 'long';
  }

  // ── Rule 4: Device constraints → short ──
  if (isMobile || saveData) {
    return 'short';
  }

  // ── Rule 5: Conversation follow-up depth → escalate detail ──
  if (followUpDepth >= 4) {
    return 'long';
  }
  if (followUpDepth >= 2) {
    return 'medium';
  }

  // ── Rule 6: Low confidence → short (conservative, avoid hallucination sprawl) ──
  if (topSim < 0.3) {
    return 'short';
  }

  // ── Rule 7: Default ──
  return 'medium';
}

// ---------------------------------------------------------------------------
// Budget constraints — maps budget → renderer caps
// ---------------------------------------------------------------------------

/**
 * Return the constraint map for a given budget string.
 *
 * Budget levels and their caps:
 *   micro:    single fragment, ≤60 words, no extras
 *   short:    2 fragments, ≤80 words, closer ok, diagram ok
 *   medium:   3 fragments, ≤170 words, all helpers enabled
 *   long:     5 fragments, ≤350 words, all helpers enabled
 *   diagram_plus_text: 3 fragments, ≤150 words, diagram enabled
 *   auto / unknown:    same as medium (safe default)
 *
 * @param {string} budget - one of 'micro','short','medium','long','diagram_plus_text','auto'
 * @returns {{ maxFragments: number, maxWords: number, allowRelated: boolean, allowCloser: boolean, allowDiagram: boolean }}
 */
export function getBudgetConstraints(budget) {
  const map = {
    micro:             { maxFragments: 1, maxWords: 60,  allowRelated: false, allowCloser: false, allowDiagram: false },
    short:             { maxFragments: 2, maxWords: 80,  allowRelated: false, allowCloser: true,  allowDiagram: true  },
    medium:            { maxFragments: 3, maxWords: 170, allowRelated: true,  allowCloser: true,  allowDiagram: true  },
    long:              { maxFragments: 5, maxWords: 350, allowRelated: true,  allowCloser: true,  allowDiagram: true  },
    diagram_plus_text: { maxFragments: 3, maxWords: 150, allowRelated: true,  allowCloser: true,  allowDiagram: true  },
  };

  // 'auto' and unknown budgets default to 'medium'
  if (budget === 'auto' || !budget || !map[budget]) {
    return map.medium;
  }

  return map[budget];
}

// ---------------------------------------------------------------------------
// Internal helpers (exported for testing / debugging)
// ---------------------------------------------------------------------------

/**
 * Detect whether the user query explicitly asks for brevity.
 * Exported utility — not used by the main classifier (Rule 1 handles this),
 * but useful for downstream consumers.
 *
 * @param {string} query
 * @returns {boolean}
 */
export function hasBrevityCue(query) {
  return /\b(brief|short|summary|summarize|recap|tl;dr|quick|fast)\b/i.test(query || '');
}

/**
 * Detect whether the user query explicitly asks for depth.
 * @param {string} query
 * @returns {boolean}
 */
export function hasDepthCue(query) {
  return /\b(prove|derive|why|how\s+exactly|detailed|in\s+depth|thorough|comprehensive|explain\s+deeply|rigorous|elaborate)\b/i.test(query || '');
}
