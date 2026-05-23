/**
 * session.js — ReLU.chat Session Memory Module
 *
 * Replaces the single `lastTopic` integer with a proper turn-based session
 * memory that tracks conversation history, follow-up detection, ambiguity
 * state, fragment deduplication, and entity persistence across turns.
 *
 * Architecture:
 *   SessionMemory is a pure-data class with no DOM or network dependencies.
 *   It is consumed by chatbot-engine.js (handle function) and provides input
 *   to the policy runtime (planAnswer → extractPolicyFeatures).
 *
 * Turn storage:
 *   Each turn records { query, response, entities[], topics[], fragments[],
 *                       ambiguous, timestamp }.
 *   History is capped at `maxHistory` turns (FIFO eviction).
 */

// ---------------------------------------------------------------------------
// Follow-up detection — regex-based pattern matching
// ---------------------------------------------------------------------------

const FOLLOWUP_PATTERNS = [
  // "explain that simpler" / "simplify" / "dumb it down" / "ELI5"
  {
    regex: /\b(explain\s+(that|it|this)\s+simpler|simplify\s+(that|it|this)|dumb\s+it\s+down|explain\s+like\s+(i'?m?\s+)?(five|5)|eli5)\b/i,
    type: 'simplify',
    target: 'last'
  },

  // "compare it with the previous one" / "how does it compare"
  {
    regex: /\b(compare\s+(it|that|this)\s+with\s+(the\s+)?(previous|last|former|one\s+before)|how\s+does\s+(it|that|this)\s+compare)\b/i,
    type: 'compare_previous',
    target: 'last'
  },

  // "give an example" / "show me an example" / standalone "example"
  {
    regex: /^(give|show|provide)\s+(me\s+)?(an?\s+)?example|^example\s*(please)?$|^an?\s+example\s*(please)?$/i,
    type: 'example',
    target: 'last'
  },

  // "more detail" / "tell me more" / "elaborate" / "go deeper" / "expand on that"
  {
    regex: /^(more\s+detail|tell\s+me\s+more|elaborate|go\s+deeper|expand\s+on\s+(that|it|this)|continue|go\s+on)$/i,
    type: 'elaborate',
    target: 'last'
  },

  // "another example" / "another one" / "one more example"
  {
    regex: /^(another\s+(example|one)|one\s+more\s+example|give\s+me\s+another)/i,
    type: 'another_example',
    target: 'last'
  },

  // "what about the second/third/fourth one" — ordinal references
  {
    regex: /\b(?:what\s+about|tell\s+me\s+about|and\s+what\s+about|how\s+about)\s+the\s+(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s*(one|item|topic|entry)?\b/i,
    type: 'reference_index',
    targetFn: (m) => {
      const ordinals = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, '1st': 0, '2nd': 1, '3rd': 2, '4th': 3, '5th': 4 };
      return ordinals[m[1]?.toLowerCase()] ?? 0;
    }
  },

  // "tell me more about X" / "more about X" / "what about X" — specific topic
  {
    regex: /(?:tell\s+me\s+more\s+about|more\s+about|what\s+about|elaborate\s+on|explain\s+more\s+about|go\s+deeper\s+on)\s+(.+)/i,
    type: 'specific',
    targetFn: (m) => m[1]?.trim() || 'last'
  },
];

// ---------------------------------------------------------------------------
// SessionMemory class
// ---------------------------------------------------------------------------

export class SessionMemory {
  /**
   * @param {number} maxHistory - maximum number of turns to retain (FIFO)
   */
  constructor(maxHistory = 20) {
    this.maxHistory = maxHistory;
    /** @type {Array<{query:string, response:string, entities:number[], topics:number[], fragments:string[], ambiguous:boolean, timestamp:number}>} */
    this.history = [];

    // Per-query transient state (reset after each addTurn)
    this._currentQueryAmbiguous = false;

    // Fragment usage tracking: fragmentId → turnCount (last used turn number)
    this._fragmentUsage = new Map();
    this._turnCount = 0;
  }

  // -------------------------------------------------------------------------
  // Core turn recording
  // -------------------------------------------------------------------------

  /**
   * Record a complete user–bot exchange.
   *
   * @param {string}   query     - raw user query
   * @param {string}   response  - bot's rendered response text
   * @param {number[]} entities  - KB indices matched by extractEntities
   * @param {number[]} topics    - KB indices presented in the answer
   * @param {string[]} fragments - fragment identifiers shown (e.g. `"relu:def"`)
   */
  addTurn(query, response, entities, topics, fragments) {
    const turn = {
      query,
      response,
      entities: entities || [],
      topics: topics || [],
      fragments: fragments || [],
      ambiguous: this._currentQueryAmbiguous,
      timestamp: Date.now(),
    };

    this.history.push(turn);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    this._turnCount++;
    this._currentQueryAmbiguous = false; // reset for next query
  }

  // -------------------------------------------------------------------------
  // Topic tracking (replaces old `lastTopic` variable)
  // -------------------------------------------------------------------------

  /**
   * The KB index of the last topic discussed.
   * Walks history backwards to find the most recent turn with topics.
   * @returns {number|null}
   */
  get lastTopic() {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].topics.length > 0) {
        return this.history[i].topics[0];
      }
    }
    return null;
  }

  /**
   * Number of turns since the lastTopic was established.
   * Returns history.length if no topic has ever been set.
   * @returns {number}
   */
  get lastTopicAge() {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].topics.length > 0) {
        return this.history.length - 1 - i;
      }
    }
    return this.history.length;
  }

  // -------------------------------------------------------------------------
  // History accessors
  // -------------------------------------------------------------------------

  /**
   * Return a shallow copy of the full conversation history.
   * @returns {Array<object>}
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Return the most recent user query string, or null if empty.
   * @returns {string|null}
   */
  getLastUserQuery() {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1].query;
  }

  /**
   * Return the most recent bot response string, or null if empty.
   * @returns {string|null}
   */
  getLastBotResponse() {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1].response;
  }

  // -------------------------------------------------------------------------
  // Entity persistence across turns
  // -------------------------------------------------------------------------

  /**
   * Collect entity KB indices from the last `maxAge` turns (deduplicated).
   * This allows follow-up queries to benefit from recently mentioned entities
   * even when the current query doesn't re-state them explicitly.
   *
   * @param {number} maxAge - number of recent turns to scan
   * @returns {number[]}
   */
  getRecentEntities(maxAge = 3) {
    const entitySet = new Set();
    const start = Math.max(0, this.history.length - maxAge);
    for (let i = start; i < this.history.length; i++) {
      for (const e of this.history[i].entities) {
        entitySet.add(e);
      }
    }
    return [...entitySet];
  }

  // -------------------------------------------------------------------------
  // Fragment deduplication
  // -------------------------------------------------------------------------

  /**
   * Return fragment identifiers used in the last `maxTurns`.
   * Combines both turn-level fragment records and explicitly-marked fragments.
   *
   * @param {number} maxTurns - lookback window in turns
   * @returns {string[]}
   */
  getRecentlyUsedFragments(maxTurns = 5) {
    const result = new Set();

    // Collect from turn-level fragment arrays
    const start = Math.max(0, this.history.length - maxTurns);
    for (let i = start; i < this.history.length; i++) {
      for (const f of this.history[i].fragments) {
        result.add(f);
      }
    }

    // Collect from explicit fragment usage tracker
    const threshold = this._turnCount - maxTurns;
    for (const [fragId, turnNum] of this._fragmentUsage) {
      if (turnNum >= threshold) {
        result.add(fragId);
      }
    }

    return [...result];
  }

  /**
   * Explicitly mark a fragment as used in the current turn.
   * Fragment IDs can be any unique string, e.g. `"ReLU:def"` or `"softmax:int"`.
   *
   * @param {string} fragmentId
   */
  markFragmentUsed(fragmentId) {
    this._fragmentUsage.set(fragmentId, this._turnCount);
  }

  // -------------------------------------------------------------------------
  // Follow-up detection
  // -------------------------------------------------------------------------

  /**
   * Analyze a query to determine if it is a follow-up to a previous response.
   *
   * Detected types:
   *   simplify          — "explain that simpler"
   *   compare_previous  — "compare it with the previous one"
   *   example           — "give an example"
   *   elaborate         — "more detail"
   *   reference_index   — "what about the second one"
   *   another_example   — "another example"
   *   specific          — "tell me more about X"
   *
   * @param {string} query - raw user query
   * @returns {{ isFollowUp: boolean, type?: string, target?: string|number }}
   */
  detectFollowUp(query) {
    if (!query || typeof query !== 'string') {
      return { isFollowUp: false };
    }

    const q = query.trim();

    // Skip very long queries (> 120 chars) — unlikely to be simple follow-ups
    if (q.length > 120) {
      return { isFollowUp: false };
    }

    for (const pat of FOLLOWUP_PATTERNS) {
      const match = q.match(pat.regex);
      if (match) {
        const target = typeof pat.targetFn === 'function'
          ? pat.targetFn(match)
          : pat.target;
        return { isFollowUp: true, type: pat.type, target };
      }
    }

    return { isFollowUp: false };
  }

  // -------------------------------------------------------------------------
  // Ambiguity tracking
  // -------------------------------------------------------------------------

  /**
   * Mark the currently-processing query as ambiguous.
   * Called by chatbot-engine after entity extraction and similarity scoring
   * when the pipeline detects that the query has multiple reasonable
   * interpretations.
   *
   * @param {string} query - the ambiguous query (stored for debugging)
   */
  setAmbiguous(query) {
    this._currentQueryAmbiguous = true;
  }

  /**
   * Check if the previous turn's query was flagged as ambiguous.
   * Used by the pipeline to decide whether to ask clarifying questions
   * or to use a wider topic net.
   *
   * @returns {boolean}
   */
  wasPreviousQueryAmbiguous() {
    if (this.history.length === 0) return false;
    return this.history[this.history.length - 1].ambiguous || false;
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  /**
   * Reset all session state (history, fragment tracking, ambiguity).
   * Useful when the chatbot is re-initialized or for testing.
   */
  reset() {
    this.history = [];
    this._currentQueryAmbiguous = false;
    this._fragmentUsage.clear();
    this._turnCount = 0;
  }
}
