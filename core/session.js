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
    regex: /^(more\s+detail|tell\s+me\s+more|elaborate|go\s+deeper|expand\s+on\s+(that|it|this))$/i,
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

  // -------------------------------------------------------------------------
  // Expanded follow-up patterns (nuanced prompt handling)
  // -------------------------------------------------------------------------

  // "go ahead" / "keep going" / "and then" / "what's next" / "proceed" / "carry on"
  {
    regex: /^(go\s+ahead|keep\s+going|and\s+then|what('?s|\s+is)\s+next|what\s+next|proceed|carry\s+on|go\s+on|continue|next\s*)$/i,
    type: 'continue',
    target: 'last'
  },

  // "what else" / "anything else" / "what more" / "is there more"
  {
    regex: /^(what\s+else|anything\s+else|what\s+more|is\s+there\s+more|any\s+more|and\s+more)$/i,
    type: 'what_else',
    target: 'last'
  },

  // "how" / "how so" / "how does that work" / "how come"
  {
    regex: /^(how|how\s+so|how\s+does\s+that\s+work|how\s+come|how\s+is\s+that|how\s+does\s+this\s+work|how\s+do\s+you\s+mean|how\s+is\s+this\s+(possible|true|so))$/i,
    type: 'how',
    target: 'last'
  },

  // "why" / "why is that" / "why does that happen" / "why so"
  {
    regex: /^(why|why\s+is\s+that|why\s+does\s+that\s+happen|why\s+so|why\s+do\s+you\s+say\s+that|why\s+would\s+that\s+be|why\s+is\s+this|why\s+is\s+it\s+(so|like\s+that))$/i,
    type: 'why',
    target: 'last'
  },

  // "really" / "seriously" / "are you sure" / "is that true" / "for real"
  {
    regex: /^(really|seriously|are\s+you\s+sure|is\s+that\s+true|for\s+real|no\s+way|you\s+sure|is\s+that\s+right|that\s+true|honestly\??|truthfully|are\s+you\s+serious|you\s+can'?t\s+be\s+serious)\??$/i,
    type: 'challenge',
    target: 'last'
  },

  // "ok" / "okay" / "i see" / "got it" / "understood" / "makes sense" — acknowledgment
  {
    regex: /^(ok|okay|sure|i\s+see|got\s+it|understood|makes\s+sense|right|ah|oh|i\s+get\s+it|that\s+makes\s+sense|i\s+understand|fair\s+enough|alright|fine|gotcha|roger|copy\s+that|i\s+hear\s+you|i\s+follow)$/i,
    type: 'acknowledge',
    target: 'last'
  },

  // "huh" / "what do you mean" / "i don't get it" / "i'm confused" — clarification
  {
    regex: /^(huh|what\s+do\s+you\s+mean|i\s+don'?t\s+get\s+it|i\s+don'?t\s+understand|i'?m\s+confused|not\s+sure\s+i\s+follow|i\s+don'?t\s+follow|you\s+lost\s+me|what\s+does\s+that\s+mean|i\s+don'?t\s+get|i'?m\s+not\s+sure\s+i\s+understand|i'?m\s+lost|not\s+following|what\s+was\s+that|say\s+(that\s+)?again|sorry\s+i\s+don'?t\s+understand|can\s+you\s+repeat|pardon|excuse\s+me|come\s+again|i\s+didn'?t\s+(get|catch)\s+that)$/i,
    type: 'clarify',
    target: 'last'
  },

  // "can you simplify" / "in simpler terms" / "break it down" / "eli5" variants
  {
    regex: /^(can\s+you\s+simplify|simplify\s+(that|this|it|please)|explain\s+(more\s+)?simply|in\s+simpler\s+terms|put\s+(it\s+)?simply|make\s+(it\s+)?(easier|simpler)|can\s+you\s+explain\s+(that|this|it)\s+(more\s+)?simply|break\s+(it\s+)?down(\s+for\s+me)?|explain\s+in\s+(simple|plain)\s+(terms|english|language)|simplify\s+this\s+(please|for\s+me)|too\s+(complex|complicated|advanced|hard|difficult)|over\s+my\s+head|above\s+my\s+head|simpler\s+terms?\s*$|plain\s+english|plain\s+language)$/i,
    type: 'simplify',
    target: 'last'
  },

  // "more details" / "in depth" / "thorough" / "deep dive" / "go into more detail"
  {
    regex: /^(more\s+details?|in\s+(more\s+)?depth|thorough|comprehensive|detailed|full\s+explanation|in-depth|elaborate\s+(on\s+)?(that|this|it)|give\s+me\s+(the\s+)?details?|delve\s+(deeper\s+)?into|deep\s+dive|go\s+into\s+more\s+detail|tell\s+me\s+everything\s+about|spill\s+(the\s+)?(details?|tea)|give\s+me\s+(the\s+)?full\s+picture|i\s+want\s+(to\s+know\s+)?more|tell\s+me\s+in\s+detail|can\s+you\s+go\s+deeper|give\s+me\s+(the\s+)?nitty\s+gritty|what\s+are\s+the\s+details|deeper\s*$)$/i,
    type: 'deep_dive',
    target: 'last'
  },

  // "like what" / "such as" / "for instance" / "example please"
  {
    regex: /^(like\s+what|such\s+as|for\s+instance|namely|give\s+me\s+(some\s+)?(examples?|instances)|examples?\s+(like|such\s+as)|what\s+are\s+some\s+examples?|can\s+you\s+give\s+(me\s+)?(some\s+)?(examples?|instances)|what\s+would\s+be\s+(an?\s+)?example|example\s+please|examples\s+please|show\s+me\s+(some\s+)?(examples?|instances)|like\s+for\s+example|what\s+about\s+an?\s+example|give\s+an?\s+instance|concrete\s+example|real\s+world\s+example|practical\s+example)$/i,
    type: 'example',
    target: 'last'
  },

  // "so what" / "who cares" / "why does it matter" / "relevance"
  {
    regex: /^(so\s+what|who\s+cares|why\s+does\s+(it|that)\s+matter|relevance|what'?s\s+the\s+point|what'?s\s+the\s+relevance|why\s+should\s+i\s+care|so\??|and\s+so\??|what\s+does\s+(it|that)\s+mean\s+for\s+me|how\s+is\s+(this|that)\s+(useful|relevant|helpful)|what\s+is\s+the\s+significance|why\s+is\s+(this|that)\s+important)$/i,
    type: 'relevance',
    target: 'last'
  },

  // "prove it" / "source" / "evidence" / "citation"
  {
    regex: /^(prove\s+it|source|evidence|citation|proof|show\s+(me\s+)?(the\s+)?proof|where'?s\s+the\s+proof|do\s+you\s+have\s+(a\s+)?source|give\s+me\s+(a\s+)?source|cite\s+(that|your\s+sources?)|what'?s\s+the\s+source|how\s+do\s+you\s+know|show\s+(me\s+)?(the\s+)?evidence|what\s+proof\s+do\s+you\s+have|are\s+you\s+mak?ing\s+that\s+up|is\s+that\s+(true|real|accurate|a\s+fact)|can\s+you\s+back\s+that\s+up|where\s+did\s+you\s+(get|find)\s+that|is\s+that\s+(from\s+)?(a\s+)?(source|reference)|says?\s+who|who\s+says?|according\s+to\s+(whom|what)|show\s+me\s+(the\s+)?data|data?\s*$|research\s*$|studies?\s*$|references?\s*$)$/i,
    type: 'evidence',
    target: 'last'
  },

  // "compare" / "contrast" / "difference" / "versus" / "how is it different"
  {
    regex: /^(compare|contrast|difference|how\s+(is|are)\s+(it|they)\s+different|what('?s|\s+is)\s+the\s+difference|how\s+do\s+they\s+compare|versus|vs\.?\b|differentiate|distinguish|on\s+the\s+(other\s+)?(hand|side)|what\s+(about|of)\s+(the\s+)?(other|alternative)|which\s+(is|one)\s+(better|worse|different)|how\s+are\s+they\s+(different|similar|alike)|in\s+what\s+ways?\s+(are\s+they\s+)?(different|similar)|tell\s+me\s+the\s+difference|what\s+sets?\s+them\s+apart|how\s+would\s+you\s+compare|what\s+are\s+the\s+(key\s+)?(differences?|similarities?)|similarities?|parallels?|analogous|similarly|likewise|in\s+contrast)$/i,
    type: 'comparison',
    target: 'last'
  },

  // "summarize" / "tldr" / "brief" / "short version" / "bottom line"
  {
    regex: /^(summarize|tldr|tl;dr|brief|short\s+version|summary|in\s+brief|in\s+short|give\s+me\s+(the\s+)?summary|quick\s+summary|sum\s+(it\s+)?up|recap|conclusion|bottom\s+line|gist|main\s+points?|key\s+points?|takeaway|take-away|wrap\s+(it\s+)?up|can\s+you\s+summarize|to\s+sum\s+(it\s+)?up|in\s+a\s+nutshell|long\s+story\s+short|executive\s+summary|abstract|synopsis|overview|quick\s+version|cliff\s+notes|abridged|condensed|digest|what'?s\s+the\s+gist|give\s+me\s+the\s+short\s+version)$/i,
    type: 'summarize',
    target: 'last'
  },

  // "one more" (alone) / "different example" / "another way" / "alternative"
  {
    regex: /^(one\s+more$|different\s+example|other\s+example|show\s+me\s+another|another\s+way|alternative\s+example|can\s+you\s+give\s+(me\s+)?another|what\s+about\s+another|any\s+other\s+examples?|got\s+(any\s+)?other\s+(examples?|ones?)|more\s+examples?\s*$|another\s+one\s*$|one\s+more\s+time|one\s+more\s+thing|show\s+me\s+(a\s+)?different|what\s+other\s+(examples?|ones?)\s+(are\s+there|exist|do\s+you\s+have)|try\s+another|give\s+(me\s+)?another|another\s+please)$/i,
    type: 'another_example',
    target: 'last'
  },

  // Yes/affirmation continuations (only meaningful when history exists)
  {
    regex: /^(yes|yeah|yep|yup|totally|absolutely|definitely|certainly|indeed|sounds?\s+good|go\s+for\s+it|please\s+do|yes\s+please|by\s+all\s+means|be\s+my\s+guest|feel\s+free|sure\s+thing|you\s+betcha|i'?d\s+love\s+to|tell\s+me|let'?s\s+hear\s+(it|that)|i'?m\s+listening|i'?m\s+all\s+ears|shoot|fire\s+away|go\s+for\s+it|bring\s+(it\s+)?on|hit\s+me|lay\s+(it\s+)?on\s+me)$/i,
    type: 'affirm_continue',
    target: 'last'
  },
];

// ---------------------------------------------------------------------------
// SessionMemory class
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants for sliding window & compression
// ---------------------------------------------------------------------------

/** Minimum turns from the end that are always kept (never evicted by importance). */
const PROTECTED_RECENT_TURNS = 5;

/** Turns after which full response text is compressed to a summary. */
const FULL_RESPONSE_TURNS = 5;

/** How many chars of a turn's response to retain when compressing. */
const COMPRESSED_RESPONSE_LENGTH = 120;

/** How many turns between automatic conversation summaries. */
const SUMMARY_INTERVAL = 10;

/** Decay half-life in turns for entity relevance. */
const ENTITY_DECAY_HALFLIFE = 5;

/** Max turns since last query before time-based drift is assumed. */
const TIME_BASED_DRIFT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** How many times a fragment can be shown before being penalized. */
const FRAGMENT_PENALTY_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// SessionMemory class
// ---------------------------------------------------------------------------

export class SessionMemory {
  /**
   * @param {number} maxHistory - maximum number of turns to retain
   */
  constructor(maxHistory = 20) {
    this.maxHistory = maxHistory;
    /** @type {Array<{query:string, response:string, entities:number[], topics:number[], fragments:string[], ambiguous:boolean, timestamp:number, importance?:number, _compressed?:boolean}>} */
    this.history = [];

    // Per-query transient state (reset after each addTurn)
    this._currentQueryAmbiguous = false;

    // Fragment usage tracking: fragmentId → turnCount (last used turn number)
    this._fragmentUsage = new Map();

    // Fragment diversity tracking: fragmentId → total times shown across session
    /** @type {Map<string, number>} */
    this._fragmentCount = new Map();

    // Entity mention tracking: entityId → { count, lastMentionedTurn, firstMentionedTurn }
    /** @type {Map<number, {count:number, lastMentionedTurn:number, firstMentionedTurn:number}>} */
    this._entityMentions = new Map();

    // Conversation summaries generated periodically
    /** @type {Array<{turn:number, text:string, topics:number[], timestamp:number}>} */
    this._summaries = [];

    // Per-turn engagement signal history
    /** @type {Array<string>} */
    this._engagementHistory = [];

    // Timestamp of the last user query (for time-based drift detection)
    this._lastQueryTime = Date.now();

    this._turnCount = 0;
  }

  // -------------------------------------------------------------------------
  // Core turn recording
  // -------------------------------------------------------------------------

  /**
   * Record a complete user–bot exchange.
   *
   * Uses importance-based eviction: the last PROTECTED_RECENT_TURNS turns are
   * always kept; older turns are evicted based on lowest importance score.
   * Full response text is kept only for the last FULL_RESPONSE_TURNS turns;
   * older turns have their response compressed.
   *
   * Also tracks entity mentions, fragment diversity, engagement signals,
   * and generates periodic conversation summaries.
   *
   * @param {string}   query     - raw user query
   * @param {string}   response  - bot's rendered response text
   * @param {number[]} entities  - KB indices matched by extractEntities
   * @param {number[]} topics    - KB indices presented in the answer
   * @param {string[]} fragments - fragment identifiers shown (e.g. `"relu:def"`)
   */
  addTurn(query, response, entities, topics, fragments) {
    // ── Input validation ─────────────────────────────────────────────
    if (typeof query !== 'string') {
      console.warn('[session] addTurn received non-string query, coercing');
      query = String(query || '');
    }
    if (typeof response !== 'string') {
      console.warn('[session] addTurn received non-string response, coercing');
      response = String(response || '');
    }
    if (!Array.isArray(entities)) {
      console.warn('[session] addTurn received non-array entities, defaulting');
      entities = [];
    } else {
      entities = entities.filter(e => Number.isFinite(e) && e >= 0);
    }
    if (!Array.isArray(topics)) {
      console.warn('[session] addTurn received non-array topics, defaulting');
      topics = [];
    } else {
      topics = topics.filter(t => Number.isFinite(t) && t >= 0);
    }
    if (!Array.isArray(fragments)) {
      console.warn('[session] addTurn received non-array fragments, defaulting');
      fragments = [];
    } else {
      fragments = fragments.filter(f => typeof f === 'string' && f.length > 0);
    }

    const turn = {
      query,
      response,
      entities,
      topics,
      fragments,
      ambiguous: this._currentQueryAmbiguous,
      timestamp: Date.now(),
    };

    // --- Track entity mentions ---
    for (const e of entities) {
      if (this._entityMentions.has(e)) {
        const meta = this._entityMentions.get(e);
        meta.count++;
        meta.lastMentionedTurn = this._turnCount;
      } else {
        this._entityMentions.set(e, {
          count: 1,
          lastMentionedTurn: this._turnCount,
          firstMentionedTurn: this._turnCount,
        });
      }
    }

    // --- Track fragment usage count ---
    const frags = fragments || [];
    for (const f of frags) {
      this._fragmentCount.set(f, (this._fragmentCount.get(f) || 0) + 1);
    }

    this.history.push(turn);
    this._turnCount++;
    this._lastQueryTime = Date.now();

    // --- Importance-based eviction ---
    // If over capacity, evict the least important turn that is NOT among the
    // last PROTECTED_RECENT_TURNS (always keep the most recent turns).
    if (this.history.length > this.maxHistory) {
      const protectedStart = Math.max(0, this.history.length - PROTECTED_RECENT_TURNS);
      let worstIdx = -1;
      let worstScore = Infinity;

      // Compute importance for all turns up to the protected region
      for (let i = 0; i < protectedStart; i++) {
        const imp = this._computeTurnImportance(this.history[i], i);
        this.history[i].importance = imp;
        if (imp < worstScore) {
          worstScore = imp;
          worstIdx = i;
        }
      }

      if (worstIdx >= 0) {
        this.history.splice(worstIdx, 1);
        // Also clean up engagement history for the removed turn
        if (worstIdx < this._engagementHistory.length) {
          this._engagementHistory.splice(worstIdx, 1);
        }
      } else {
        // Fallback: remove oldest (shouldn't happen in normal operation)
        this.history.shift();
        this._engagementHistory.shift();
      }
    }

    // --- Compress old turns for memory efficiency ---
    this._compressHistoryInternal();

    // --- Generate conversation summary every SUMMARY_INTERVAL turns ---
    if (this._turnCount > 0 && this._turnCount % SUMMARY_INTERVAL === 0) {
      const summary = this._generateSummary();
      if (summary) {
        this._summaries.push({
          turn: this._turnCount,
          text: summary,
          topics: topics || [],
          timestamp: Date.now(),
        });
      }
    }

    this._currentQueryAmbiguous = false; // reset for next query
  }

  /**
   * Compress old turn data to conserve memory.
   * - Keeps full response text only for the last FULL_RESPONSE_TURNS turns
   * - Older turns store a truncated response and are marked _compressed
   * @private
   */
  _compressHistoryInternal() {
    const startCompress = Math.max(0, this.history.length - FULL_RESPONSE_TURNS);
    for (let i = 0; i < startCompress; i++) {
      const t = this.history[i];
      if (t && !t._compressed && t.response && t.response.length > COMPRESSED_RESPONSE_LENGTH) {
        t.response = t.response.substring(0, COMPRESSED_RESPONSE_LENGTH) + '…';
        t._compressed = true;
      } else if (t && !t._compressed) {
        t._compressed = true;
      }
    }
  }

  /**
   * Manually compress history — useful if you want to free memory proactively.
   * Can be called at any time; compresses all but the last FULL_RESPONSE_TURNS.
   */
  compressHistory() {
    this._compressHistoryInternal();
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

  /**
   * Return entities with decay weights based on recency and frequency.
   *
   * Each entity is scored by: frequency * (decay ^ turnsSinceLastMention)
   * where decay = 0.5^(1/ENTITY_DECAY_HALFLIFE) ≈ 0.87 per turn.
   *
   * @param {number} [maxAge=10] - maximum turn age to consider
   * @returns {Array<{entity:number, weight:number, count:number, recency:number}>}
   */
  getActiveEntities(maxAge = 10) {
    const decayPerTurn = Math.pow(0.5, 1 / ENTITY_DECAY_HALFLIFE);
    const results = [];

    for (const [entityId, meta] of this._entityMentions) {
      const turnsSince = this._turnCount - meta.lastMentionedTurn;
      if (turnsSince > maxAge) continue;

      const recencyWeight = Math.pow(decayPerTurn, turnsSince);
      const frequencyWeight = Math.min(meta.count / 5, 1);
      const weight = recencyWeight * (0.5 + 0.5 * frequencyWeight);

      results.push({
        entity: entityId,
        weight: Math.min(weight, 1),
        count: meta.count,
        recency: turnsSince,
      });
    }

    // Sort by weight descending
    results.sort((a, b) => b.weight - a.weight);
    return results;
  }

  /**
   * Return a compact summary of the conversation history.
   *
   * Includes: turn count, active entity list (top 5), summary count,
   * last N topics, engagement trend, and memory pressure indicator.
   *
   * @returns {object} compact history summary
   */
  getHistorySummary() {
    const activeEntities = this.getActiveEntities(10);
    const lastTopics = [];
    for (let i = this.history.length - 1; i >= 0 && lastTopics.length < 3; i--) {
      if (this.history[i].topics.length > 0) {
        for (const t of this.history[i].topics) {
          if (!lastTopics.includes(t)) lastTopics.push(t);
        }
      }
    }

    // Engagement trend: last 5 signals
    const recentSignals = this._engagementHistory.slice(-5);
    const deepCount = recentSignals.filter(s => s === 'deepening' || s === 'challenging').length;
    const shallowCount = recentSignals.filter(s => s === 'new_topic' || s === 'acknowledging').length;
    let engagementTrend = 'neutral';
    if (deepCount > shallowCount) engagementTrend = 'deepening';
    else if (shallowCount > deepCount) engagementTrend = 'broadening';

    // Memory pressure: what fraction of maxHistory is used
    const memoryPressure = this.history.length / Math.max(this.maxHistory, 1);

    // How many compressed vs full-response turns
    const compressedCount = this.history.filter(t => t._compressed).length;
    const fullCount = this.history.length - compressedCount;

    return {
      turnCount: this._turnCount,
      historyLength: this.history.length,
      maxHistory: this.maxHistory,
      memoryPressure: parseFloat(memoryPressure.toFixed(2)),
      compressedTurns: compressedCount,
      fullResponseTurns: fullCount,
      activeEntityCount: activeEntities.length,
      topEntities: activeEntities.slice(0, 5).map(e => ({ entity: e.entity, weight: parseFloat(e.weight.toFixed(3)) })),
      lastTopics,
      summaryCount: this._summaries.length,
      engagementTrend,
      recentEngagementSignals: recentSignals,
    };
  }

  /**
   * Return which fragments have been overused (shown too many times).
   *
   * A fragment is "exhausted" if it has been shown more than
   * FRAGMENT_PENALTY_THRESHOLD times across the session.
   * Each entry includes: count, usage ratio, and a penalty score.
   *
   * @returns {Array<{fragmentId:string, count:number, penalty:number}>}
   */
  getFragmentExhaustion() {
    const results = [];

    for (const [fragId, count] of this._fragmentCount) {
      if (count > 0) {
        // Penalty increases sharply beyond the threshold
        let penalty = 0;
        if (count > FRAGMENT_PENALTY_THRESHOLD) {
          // Quadratic penalty: 0 at threshold, 1 at threshold+5
          const over = count - FRAGMENT_PENALTY_THRESHOLD;
          penalty = Math.min(over * over / 25, 1);
        }
        results.push({
          fragmentId: fragId,
          count,
          penalty,
        });
      }
    }

    // Sort by penalty descending (most overused first)
    results.sort((a, b) => b.penalty - a.penalty);
    return results;
  }

  /**
   * Assess the user's current engagement level based on recent signals.
   *
   * Returns a summary of engagement across three axes:
   *   - depth      (how deeply the user is exploring a topic)
   *   - stability  (whether the user stays on topic or jumps around)
   *   - curiosity  (whether the user asks challenging/clarifying questions)
   *
   * @param {number} [window=5] - number of recent turns to consider
   * @returns {{ depth: number, stability: number, curiosity: number, level: string, signals: string[] }}
   */
  getEngagementLevel(window = 5) {
    if (this._engagementHistory.length === 0) {
      return { depth: 0, stability: 0, curiosity: 0, level: 'unknown', signals: [] };
    }

    const recent = this._engagementHistory.slice(-window);
    const total = recent.length;

    // Depth: fraction of turns that are deepening, elaborating, or challenging
    const deepeningSignals = ['deepening', 'challenging', 'clarifying'];
    const depthCount = recent.filter(s => deepeningSignals.includes(s)).length;

    // Stability: fraction of turns that aren't new_topic redirects
    const stableCount = recent.filter(s => s !== 'new_topic' && s !== 'redirecting').length;

    // Curiosity: fraction of turns with questioning/challenging signals
    const curiousSignals = ['challenging', 'clarifying', 'deepening'];
    const curiosityCount = recent.filter(s => curiousSignals.includes(s)).length;

    const depth = total > 0 ? depthCount / total : 0;
    const stability = total > 0 ? stableCount / total : 0;
    const curiosity = total > 0 ? curiosityCount / total : 0;

    // Overall level
    let level = 'neutral';
    const avg = (depth + stability + curiosity) / 3;
    if (avg >= 0.7) level = 'highly_engaged';
    else if (avg >= 0.5) level = 'engaged';
    else if (avg >= 0.3) level = 'neutral';
    else level = 'disengaged';

    return {
      depth: parseFloat(depth.toFixed(2)),
      stability: parseFloat(stability.toFixed(2)),
      curiosity: parseFloat(curiosity.toFixed(2)),
      level,
      signals: recent,
    };
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
    if (!fragmentId || typeof fragmentId !== 'string') {
      console.warn('[session] markFragmentUsed called with invalid fragmentId:', fragmentId);
      return;
    }
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

  /**
   * Enhanced follow-up detection that first tries pattern-based detection,
   * then falls back to heuristic short-query / single-word detection.
   *
   * Handles queries like "how?", "why?", "explain", "example",
   * "simpler please", "i dont get it", "what do you mean", etc.
   *
   * @param {string} query - raw user query
   * @returns {{ isFollowUp: boolean, type?: string, target?: string|number }}
   */
  detectSimpleFollowUp(query) {
    if (!query || typeof query !== 'string') {
      return { isFollowUp: false };
    }

    // First try pattern-based detection
    const patternResult = this.detectFollowUp(query);
    if (patternResult.isFollowUp) {
      return patternResult;
    }

    // No history = can't be a meaningful follow-up
    if (this.history.length === 0) {
      return { isFollowUp: false };
    }

    const rawTrimmed = query.trim();
    const q = rawTrimmed.replace(/[.!?…]+$/, '').trim().toLowerCase();

    // -------------------------------------------------------------------
    // Emoji/symbol-only detection
    // -------------------------------------------------------------------
    // Check if the query is made entirely of emoji, punctuation, or symbols
    // (no letters, no numbers). These are strong non-verbal follow-up cues.
    const strippedSymbols = rawTrimmed.replace(/[\s.?!,;:…\-]+/g, '').trim();
    if (strippedSymbols.length > 0 && strippedSymbols.length <= 6) {
      // Unicode property escape: check if all chars are symbols or punctuation
      // Supports emoji (😊, 👍, 🤔), dingbats (❓, ❗), arrows (→), etc.
      const allSymbols = /^[\u{1F000}-\u{1FFFF}\u{2000}-\u{2FFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{00A9}\u{00AE}\u{2122}\u{23CF}\u{23E9}-\u{23F3}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2934}\u{2935}\u{2B05}-\u{2B07}\u{2B1B}\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}\u{200D}\u{20E3}\u{FE0F}\u{00A9}\u{00AE}]+$/u;
      if (allSymbols.test(strippedSymbols)) {
        // Map common emoji to follow-up types
        const emojiToType = (s) => {
          // Check for question-like emoji/symbols first
          if (/[\u{2753}\u{2754}\u{2049}\u{203C}\u{00BF}\u{003F}]/u.test(s)) return 'clarify';
          if (/[\u{2757}\u{2755}\u{203C}\u{0021}]/u.test(s)) return 'challenge';
          if (/[\u{1F914}\u{1F4AD}\u{1F4AC}]/u.test(s)) return 'clarify';  // 🤔 💭 💬
          if (/[\u{1F44D}\u{1F44C}\u{1F44F}\u{1F4AF}]/u.test(s)) return 'acknowledge'; // 👍 👌 👏 💯
          if (/[\u{1F4A1}\u{1F4A0}]/u.test(s)) return 'elaborate';  // 💡 💠
          if (/[\u{1F642}\u{1F60A}]/u.test(s)) return 'acknowledge'; // 🙂 😊
          if (/[\u{1F62E}\u{1F631}\u{1F633}]/u.test(s)) return 'challenge'; // 😮 😱 😳
          if (/[\u{1F522}\u{0023}]/u.test(s)) return 'clarify'; // 🔢 #
          return 'acknowledge';
        };
        return { isFollowUp: true, type: emojiToType(strippedSymbols), target: 'last' };
      }
    }

    // -------------------------------------------------------------------
    // Punctuation-only detection
    // -------------------------------------------------------------------
    // "...", "??", "?!", "???", "!!", "!", "?!" — confusion/engagement signals
    const punctOnly = rawTrimmed.replace(/\s/g, '');
    if (punctOnly.length > 0 && punctOnly.length <= 4 && /^[.?!,…:;\-]+$/.test(punctOnly)) {
      const hasQuestion = /[\?]/g.test(punctOnly);
      const hasExclamation = /[\!]/g.test(punctOnly);
      if (hasQuestion) return { isFollowUp: true, type: 'clarify', target: 'last' };
      if (hasExclamation) return { isFollowUp: true, type: 'challenge', target: 'last' };
      if (/\.{2,}/.test(punctOnly)) return { isFollowUp: true, type: 'elaborate', target: 'last' };
      return { isFollowUp: true, type: 'acknowledge', target: 'last' };
    }

    // -------------------------------------------------------------------
    // Single-word follow-up mapping (expanded)
    // -------------------------------------------------------------------
    const singleWordMap = {
      'how': 'how',
      'why': 'why',
      'what': 'elaborate',
      'huh': 'clarify',
      'explain': 'simplify',
      'example': 'example',
      'simplify': 'simplify',
      'simpler': 'simplify',
      'elaborate': 'elaborate',
      'more': 'elaborate',
      'continue': 'continue',
      'ok': 'acknowledge',
      'okay': 'acknowledge',
      'sure': 'acknowledge',
      'really': 'challenge',
      'seriously': 'challenge',
      'yes': 'affirm_continue',
      'yeah': 'affirm_continue',
      'tldr': 'summarize',
      'tl;dr': 'summarize',
      'summarize': 'summarize',
      'summary': 'summarize',
      'recap': 'summarize',
      'compare': 'comparison',
      'contrast': 'comparison',
      'simpler': 'simplify',
      'proof': 'evidence',
      'source': 'evidence',
      'details': 'deep_dive',
      'detail': 'deep_dive',
      'depth': 'deep_dive',
      'in-depth': 'deep_dive',
      'thorough': 'deep_dive',
      'got it': 'acknowledge',
      'understood': 'acknowledge',
      'i see': 'acknowledge',
    };

    if (/^[a-z]+$/.test(q) && q in singleWordMap) {
      return { isFollowUp: true, type: singleWordMap[q], target: 'last' };
    }

    // Also check for 2-word phrases in the singleWordMap
    if (/^[a-z]+\s[a-z]+$/.test(q) && q in singleWordMap) {
      return { isFollowUp: true, type: singleWordMap[q], target: 'last' };
    }

    // -------------------------------------------------------------------
    // Very short queries (< 20 chars) — expanded phrase matching
    // -------------------------------------------------------------------
    if (q.length < 20 && q.length > 1) {
      const shortPhraseMap = [
        {
          patterns: [/simpl/, /dumb/, /eli5/, /easier/, /i dont get/, /don'?t get/, /unclear/, /confus/, /what do you mean/, /not understand/, /over my head/, /above my head/, /break down/, /plain english/, /plain language/, /too complex/, /too hard/, /overcomplicated/],
          type: 'simplify'
        },
        {
          patterns: [/example/, /show me/, /sample/, /instance/, /like what/, /such as/, /for instance/],
          type: 'example'
        },
        {
          patterns: [/more/, /detail/, /deeper/, /tell me more/, /expand/, /and then/, /what next/, /keep go/, /elaborat/, /go ahead/, /carry on/, /proceed/, /further/, /anything else/, /what else/, /any more/],
          type: 'elaborate'
        },
        {
          patterns: [/go on/, /continue/],
          type: 'continue'
        },
        {
          patterns: [/another/, /other/, /one more/, /different/, /alternativ/, /one other/],
          type: 'another_example'
        },
        {
          patterns: [/^why\b/, /why is/, /why does/, /why so/],
          type: 'why'
        },
        {
          patterns: [/^how\b/, /how so/, /how does/, /how come/],
          type: 'how'
        },
        {
          patterns: [/really/, /seriously/, /for real/, /are you sure/, /is that (true|real)/, /no way/, /you sure/, /honestly/],
          type: 'challenge'
        },
        {
          patterns: [/^ok/, /^okay/, /got it/, /understood/, /makes sense/, /i see/, /fair enough/, /alright/, /gotcha/, /i get it/, /that makes sense/],
          type: 'acknowledge'
        },
        {
          patterns: [/huh/, /^what$/, /don'?t get/, /confused/, /don'?t understand/, /not following/, /lost me/, /pardon/, /come again/, /say that again/],
          type: 'clarify'
        },
        {
          patterns: [/so what/, /who cares/, /why (does|would|should)/, /matter/, /relevance/, /point\?/, /significance/],
          type: 'relevance'
        },
        {
          patterns: [/prove/, /evidence/, /source/, /citation/, /cite/, /proof/, /back that/, /how do you know/, /is that (true|real|accurate)/, /according/],
          type: 'evidence'
        },
        {
          patterns: [/compare/, /contrast/, /difference/, /^vs\b/, /versus/, /how (is|are).*different/, /similarit/, /distinguish/, /differentiate/, /on the (other|flip)/],
          type: 'comparison'
        },
        {
          patterns: [/summar/, /tldr/, /tl;dr/, /brief/, /short version/, /in short/, /in brief/, /bottom line/, /gist/, /recap/, /conclusion/, /wrap up/, /in a nutshell/, /overview/, /synopsis/, /takeaway/, /key points/, /main points/],
          type: 'summarize'
        },
        {
          patterns: [/^yes$/, /^yeah$/, /^yep$/, /^yup$/, /totally/, /absolutely/, /definitely/, /sounds good/, /yes please/, /tell me/, /let'?s hear/, /shoot/, /fire away/, /bring it/, /hit me/, /i'?m listening/, /i'?m all ears/],
          type: 'affirm_continue'
        },
      ];
      for (const entry of shortPhraseMap) {
        for (const pat of entry.patterns) {
          if (pat.test(q)) {
            return { isFollowUp: true, type: entry.type, target: 'last' };
          }
        }
      }
    }

    return { isFollowUp: false };
  }

  /**
   * Build a rich follow-up context object for the current query.
   * Combines enhanced follow-up detection with session history state,
   * conversation depth tracking, topic continuity scoring, and engagement
   * signal analysis.
   *
   * @param {string} query - raw user query
   * @returns {{
   *   isFollowUp: boolean,
   *   type: string|null,
   *   target: string|number|null,
   *   targetIndex: number|null,
   *   lastTopics: number[],
   *   lastEntities: number[],
   *   lastFragments: string[],
   *   turnCount: number,
   *   conversationDepth: number,
   *   topicContinuity: number,
   *   engagementSignal: string
   * }}
   */
  getFollowUpContext(query) {
    const followUp = this.detectSimpleFollowUp(query);

    const lastTurn = this.history.length > 0
      ? this.history[this.history.length - 1]
      : null;

    // For reference_index, translate the ordinal target into the actual KB index
    let targetIndex = null;
    if (followUp.isFollowUp && followUp.type === 'reference_index' && typeof followUp.target === 'number' && lastTurn) {
      const topics = lastTurn.topics || [];
      if (followUp.target >= 0 && followUp.target < topics.length) {
        targetIndex = topics[followUp.target];
      }
    }

    // ---- Conversation depth: how many consecutive turns share the same topic ----
    const conversationDepth = this._computeConversationDepth();

    // ---- Topic continuity: 0 (brand new topic) to 1 (same topic chain) ----
    const topicContinuity = this._computeTopicContinuity(query);

    // ---- Engagement signal: what the user is doing ----
    const engagementSignal = this._classifyEngagementSignal(followUp, query);

    // ---- Track engagement signal in history (aligned with the current turn) ----
    this._engagementHistory.push(engagementSignal);

    return {
      isFollowUp: followUp.isFollowUp || false,
      type: followUp.type || null,
      target: followUp.target ?? null,
      targetIndex,
      lastTopics: lastTurn ? (lastTurn.topics || []) : [],
      lastEntities: lastTurn ? (lastTurn.entities || []) : [],
      lastFragments: lastTurn ? (lastTurn.fragments || []) : [],
      turnCount: this._turnCount,
      // New rich context fields
      conversationDepth,
      topicContinuity,
      engagementSignal,
    };
  }

  /**
   * Generate a brief summary of recent conversation topics.
   * Uses the last 10 turns to produce a one-line summary.
   * @returns {string|null} summary text, or null if insufficient data
   * @private
   */
  _generateSummary() {
    if (this.history.length === 0) return null;

    const recent = this.history.slice(-SUMMARY_INTERVAL);
    if (recent.length === 0) return null;

    // Collect unique topics mentioned and user intent pattern
    const topicSet = new Set();
    const userQueries = [];
    for (const t of recent) {
      for (const tp of t.topics) topicSet.add(tp);
      if (t.query) userQueries.push(t.query);
    }

    const topicList = [...topicSet].slice(0, 5);
    const queryCount = userQueries.length;

    // Count unique engagement signals
    const recentSignals = this._engagementHistory.slice(-SUMMARY_INTERVAL);
    const deepeningTurns = recentSignals.filter(s =>
      ['deepening', 'challenging', 'clarifying'].includes(s)
    ).length;

    let summary = `Conversation spanned ${queryCount} turns`;
    if (topicList.length > 0) {
      summary += ` covering ${topicList.length} topic(s)`;
    }
    if (deepeningTurns > queryCount * 0.5) {
      summary += ' with deep exploration';
    } else if (deepeningTurns < queryCount * 0.2) {
      summary += ' with broad exploration';
    }
    summary += '.';

    return summary;
  }

  /**
   * Detect whether the current query represents a topic drift (shift to
   * a new topic) or stays on the current conversational thread.
   *
   * Compares the current query against topics from recent turns.
   * Uses entity overlap analysis, time-based decay, and intent shift
   * detection for improved accuracy.
   *
   * @param {string} query - raw user query
   * @param {object[]} [KB] - optional knowledge base for entity-based drift detection
   * @returns {{
   *   isDrift: boolean,
   *   driftScore: number,
   *   previousTopic: number|null,
   *   assessment: string,
   *   factors: { entityOverlap: number, timeDecay: number, intentShift: number, lexicalContinuity: number }
   * }}
   */
  detectTopicDrift(query, KB = null) {
    if (!query || typeof query !== 'string' || this.history.length === 0) {
      return {
        isDrift: false, driftScore: 0, previousTopic: null, assessment: 'no_history',
        factors: { entityOverlap: 0, timeDecay: 0, intentShift: 0, lexicalContinuity: 1 }
      };
    }

    // Get the most recent topic from history
    let lastTopicId = null;
    let lastTopicAge = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].topics.length > 0) {
        lastTopicId = this.history[i].topics[0];
        lastTopicAge = this.history.length - 1 - i;
        break;
      }
    }

    if (lastTopicId === null) {
      return {
        isDrift: false, driftScore: 0, previousTopic: null, assessment: 'no_previous_topic',
        factors: { entityOverlap: 0, timeDecay: 0, intentShift: 0, lexicalContinuity: 1 }
      };
    }

    const q = query.trim().toLowerCase();

    // ---- Check if the query is a continuation signal — these are NOT drifts ----
    const continuationTypes = ['continue', 'elaborate', 'deep_dive', 'how', 'why',
      'clarify', 'example', 'another_example', 'summarize', 'relevance',
      'evidence', 'challenge', 'acknowledge', 'affirm_continue', 'comparison',
      'specific', 'compare_previous', 'simplify', 'reference_index', 'what_else'];
    const followUp = this.detectSimpleFollowUp(query);
    if (followUp.isFollowUp && continuationTypes.includes(followUp.type)) {
      return {
        isDrift: false,
        driftScore: 0.1,
        previousTopic: lastTopicId,
        assessment: `follow_up_${followUp.type}`,
        factors: { entityOverlap: 0, timeDecay: 0, intentShift: 0, lexicalContinuity: 1 }
      };
    }

    // ---- Multi-factor drift scoring ----
    let driftScore = 0.3; // default: slight drift probability
    const factors = { entityOverlap: 0, timeDecay: 0, intentShift: 0, lexicalContinuity: 1 };

    // ---- Factor 1: Entity overlap between current query and recent turns ----
    const recentEntities = this.getActiveEntities(3);
    if (recentEntities.length > 0) {
      // Extract potential entity words from the query (words that match entity names in KB)
      let overlapScore = 0;
      if (KB && Array.isArray(KB)) {
        // Check how many active entities are referenced in the query
        let referencedActive = 0;
        for (const re of recentEntities) {
          if (re.entity >= 0 && re.entity < KB.length) {
            const entry = KB[re.entity];
            if (entry) {
              const name = entry.name ? entry.name.toLowerCase() : '';
              const aliases = (entry.aliases || []).map(a => a.toLowerCase());
              const allNames = [name, ...aliases].filter(Boolean);
              if (allNames.some(n => q.includes(n))) {
                referencedActive++;
                overlapScore += re.weight; // weight by recency/frequency
              }
            }
          }
        }
        // Normalize: high overlap = low drift
        factors.entityOverlap = Math.min(overlapScore / Math.max(recentEntities.length, 1), 1);
        driftScore -= factors.entityOverlap * 0.3;
      }
    }

    // ---- Factor 2: Time-based decay ----
    // Long pauses between messages suggest topic change
    const now = Date.now();
    const timeSinceLastQuery = now - this._lastQueryTime;
    if (timeSinceLastQuery > TIME_BASED_DRIFT_THRESHOLD_MS) {
      // More than 5 minutes → moderate drift probability
      const extraDrift = Math.min((timeSinceLastQuery - TIME_BASED_DRIFT_THRESHOLD_MS) / (30 * 60 * 1000), 0.4);
      factors.timeDecay = extraDrift;
      driftScore += extraDrift;
    }

    // ---- Factor 3: Intent shift detection ----
    // If the last turn was a deepening/elaborating and now the user asks
    // about something completely different, that's a drift
    const lastSignal = this._engagementHistory.length > 0
      ? this._engagementHistory[this._engagementHistory.length - 1]
      : null;
    if (lastSignal && (lastSignal === 'deepening' || lastSignal === 'challenging' || lastSignal === 'clarifying')) {
      // User was deeply engaged — if current query is long with new terms, it's a shift
      const newTermCount = (q.match(/\b[a-z]{4,}\b/g) || []).length;
      if (newTermCount >= 3 && !followUp.isFollowUp) {
        factors.intentShift = 0.3;
        driftScore += 0.3;
      }
    }

    // ---- Factor 4: Lexical continuity ----
    // How many meaningful words from the last query appear in this query
    if (this.history.length > 0) {
      const lastTurn = this.history[this.history.length - 1];
      const lastWords = (lastTurn.query || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const uniqueLastWords = [...new Set(lastWords)];
      const sharedWords = uniqueLastWords.filter(w => q.includes(w)).length;
      if (uniqueLastWords.length > 0) {
        factors.lexicalContinuity = sharedWords / Math.max(uniqueLastWords.length, 1);
        driftScore -= factors.lexicalContinuity * 0.25;
      }
    }

    // ---- Existing heuristic guards (preserved) ----

    // If KB is available, check topic name match
    if (KB && Array.isArray(KB) && lastTopicId >= 0 && lastTopicId < KB.length) {
      const lastEntry = KB[lastTopicId];
      if (lastEntry && lastEntry.name) {
        const nameParts = lastEntry.name.toLowerCase().split(/\s+/);
        const topicNameMatch = nameParts.some(p => q.includes(p));
        if (topicNameMatch) {
          driftScore = Math.min(driftScore, 0.15);
        }
      }
    }

    // Very short queries (< 4 chars) are likely follow-ups, not drifts
    if (q.length < 4) {
      driftScore = Math.max(driftScore - 0.2, 0);
    }

    // Multiple entities in query suggest a new topic inquiry
    const entityCount = (q.match(/\b[a-z]{4,}\b/g) || []).length;
    if (entityCount >= 3) {
      driftScore = Math.min(driftScore + 0.3, 1);
    }

    // Greeting/help patterns indicate mode switch, not topic drift
    const greetingPatterns = /\b(hi|hello|hey|help|menu|what can you do)\b/i;
    if (greetingPatterns.test(q)) {
      return {
        isDrift: false,
        driftScore: 0,
        previousTopic: lastTopicId,
        assessment: 'mode_switch',
        factors
      };
    }

    // Long query with topic-specific language likely shifts topic
    if (q.length > 50 && entityCount >= 2) {
      driftScore = Math.min(driftScore + 0.2, 1);
    }

    // Clamp
    driftScore = Math.max(0, Math.min(1, driftScore));

    const isDrift = driftScore > 0.6;
    const assessment = isDrift ? 'topic_shift' : (driftScore > 0.3 ? 'possible_drift' : 'on_topic');

    return { isDrift, driftScore, previousTopic: lastTopicId, assessment, factors };
  }

  // -------------------------------------------------------------------------
  // Internal helpers for rich follow-up context
  // -------------------------------------------------------------------------

  /**
   * Compute how many consecutive turns have shared the same topic.
   * Walks history backwards counting turns with the same topic index.
   * @returns {number}
   * @private
   */
  _computeConversationDepth() {
    if (this.history.length < 2) return 1;

    // Find the most recent topic
    let currentTopic = null;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].topics.length > 0) {
        currentTopic = this.history[i].topics[0];
        break;
      }
    }
    if (currentTopic === null) return 0;

    // Count consecutive turns with same topic (going backwards)
    let depth = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].topics.includes(currentTopic)) {
        depth++;
      } else {
        break;
      }
    }
    return depth;
  }

  /**
   * Compute a topic continuity score [0, 1] indicating how much the
   * current query appears to continue the existing topic thread.
   * 1 = strong continuity, 0 = completely new topic.
   * @param {string} query
   * @returns {number}
   * @private
   */
  _computeTopicContinuity(query) {
    if (this.history.length === 0) return 0;

    const q = query.trim().toLowerCase();

    // Strong continuity signals — words that reference previous content
    const referencePronouns = /\b(it|this|that|these|those|they|them|the\s+(?:same|above|previous|last|former))\b/i;
    const hasReference = referencePronouns.test(q);

    // Very short queries heavily lean toward continuity
    const isShort = q.length < 15;

    // Check if query contains topic-specific words from last turn
    const lastTurn = this.history[this.history.length - 1];
    const lastQueryWords = lastTurn.query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const sharedTerms = lastQueryWords.filter(w => q.includes(w)).length;
    const hasSharedTerms = sharedTerms > 0;

    // If KB is available, also check entity overlap (handled externally)

    // Compute score
    if (hasReference && isShort) return 0.95;
    if (hasReference) return 0.8;
    if (isShort && this.history.length >= 2) return 0.7;
    if (hasSharedTerms) return 0.65;
    if (isShort) return 0.5;

    // Default: moderate continuity for anything not obviously new
    return 0.35;
  }

  /**
   * Classify the user's engagement signal — what conversational move
   * they are making relative to the current topic.
   *
   * @param {{ isFollowUp: boolean, type?: string }} followUp
   * @param {string} query
   * @returns {string} one of: 'deepening', 'broadening', 'questioning',
   *   'acknowledging', 'challenging', 'redirecting', 'new_topic',
   *   'clarifying', 'affirming'
   * @private
   */
  _classifyEngagementSignal(followUp, query) {
    if (!followUp || !followUp.isFollowUp) {
      return 'new_topic';
    }

    const type = followUp.type || '';

    // Deepening: user wants more detail, deeper explanation
    if (['deep_dive', 'elaborate', 'continue', 'how', 'why'].includes(type)) {
      return 'deepening';
    }

    // Broadening: user wants more examples, comparison, broader view
    if (['example', 'another_example', 'comparison', 'elaborate', 'summarize', 'what_else'].includes(type)) {
      return 'broadening';
    }

    // Questioning: user doubts or questions the content
    if (['challenge', 'evidence', 'relevance', 'clarify'].includes(type)) {
      return 'challenging';
    }

    // Acknowledging: user confirms understanding
    if (['acknowledge'].includes(type)) {
      return 'acknowledging';
    }

    // Affirming: user wants to continue
    if (['affirm_continue'].includes(type)) {
      return 'affirming';
    }

    // Simplification request
    if (['simplify'].includes(type)) {
      return 'clarifying';
    }

    // Reference to specific item
    if (['reference_index', 'specific'].includes(type)) {
      return 'redirecting';
    }

    return 'deepening';
  }

  // -------------------------------------------------------------------------
  // Sliding window — turn importance scoring
  // -------------------------------------------------------------------------

  /**
   * Compute an importance score [0, 1] for a given turn.
   *
   * Factors considered:
   *   - Entity count (more entities → more substantive)
   *   - Topic references from subsequent turns (how often this turn's topics
   *     are referenced by later turns)
   *   - Query length (longer queries tend to be more substantive)
   *   - Engagement signal (deepening > broadening > acknowledging)
   *   - Fragment diversity (turns with unique fragments are more important)
   *
   * @param {object} turn - a history turn object
   * @param {number} index - index in this.history
   * @returns {number} importance score 0–1
   * @private
   */
  _computeTurnImportance(turn, index) {
    if (!turn) return 0;
    let score = 0.3; // baseline

    // --- Entity richness (0 → 0.25) ---
    const entityWeight = Math.min((turn.entities || []).length / 5, 1) * 0.25;
    score += entityWeight;

    // --- Topic downstream reference (0 → 0.20) ---
    // How many subsequent turns reference this turn's topics
    if (turn.topics && turn.topics.length > 0) {
      let downstreamRefs = 0;
      for (let i = index + 1; i < this.history.length; i++) {
        const later = this.history[i];
        if (later && later.topics) {
          const overlap = later.topics.some(t => turn.topics.includes(t));
          if (overlap) downstreamRefs++;
        }
      }
      const downstreamWeight = Math.min(downstreamRefs / 3, 1) * 0.20;
      score += downstreamWeight;
    }

    // --- Query substance (0 → 0.15) ---
    const queryLen = turn.query ? turn.query.trim().length : 0;
    const queryWeight = Math.min(queryLen / 100, 1) * 0.15;
    score += queryWeight;

    // --- Engagement bonus (0 → 0.15) ---
    const ents = this._engagementHistory;
    if (ents.length > 0 && index < ents.length) {
      const signal = ents[index] || '';
      if (signal === 'deepening' || signal === 'challenging') {
        score += 0.15;
      } else if (signal === 'broadening' || signal === 'redirecting') {
        score += 0.08;
      } else if (signal === 'clarifying' || signal === 'affirming') {
        score += 0.05;
      }
    }

    // --- Fragment uniqueness bonus (0 → 0.10) ---
    if (turn.fragments && turn.fragments.length > 0) {
      // Turns with rare fragments are more important
      let avgUsage = 0;
      for (const f of turn.fragments) {
        avgUsage += this._fragmentCount.get(f) || 1;
      }
      avgUsage /= turn.fragments.length;
      // If fragments are rarely used overall → more important
      const rarity = Math.max(0, 1 - (avgUsage - 1) / 5);
      score += rarity * 0.10;
    }

    return Math.min(score, 1);
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
    this._fragmentCount.clear();
    this._entityMentions.clear();
    this._summaries = [];
    this._engagementHistory = [];
    this._lastQueryTime = Date.now();
    this._turnCount = 0;
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  /**
   * Validate session state integrity. Checks for:
   *   - Corrupted history entries (missing required fields)
   *   - History length vs maxHistory
   *   - Fragment tracking consistency
   *   - Engagement history alignment
   *
   * If repair=true, fixes fixable issues in-place.
   *
   * @param {boolean} [repair=false] - whether to attempt in-place repair
   * @returns {{ healthy: boolean, issues: string[], repaired: string[] }}
   */
  healthCheck(repair = false) {
    const issues = [];
    const repaired = [];

    // 1. Validate history length
    if (!Array.isArray(this.history)) {
      issues.push('history is not an array');
      if (repair) {
        this.history = [];
        repaired.push('reset history to empty array');
      }
    }

    if (this.history.length > this.maxHistory * 2) {
      issues.push(`history length ${this.history.length} exceeds maxHistory ${this.maxHistory} by >2x`);
      if (repair) {
        this.history = this.history.slice(-this.maxHistory);
        repaired.push(`trimmed history to last ${this.maxHistory} entries`);
      }
    }

    // 2. Validate each turn entry
    const validTurns = [];
    for (let i = 0; i < this.history.length; i++) {
      const t = this.history[i];
      if (!t || typeof t !== 'object') {
        issues.push(`history[${i}] is null or non-object`);
        continue;
      }
      if (typeof t.query !== 'string') {
        issues.push(`history[${i}] has non-string query`);
        if (repair) {
          t.query = String(t.query || '');
          repaired.push(`fixed query at history[${i}]`);
        }
      }
      if (typeof t.response !== 'string') {
        issues.push(`history[${i}] has non-string response`);
        if (repair) {
          t.response = String(t.response || '');
          repaired.push(`fixed response at history[${i}]`);
        }
      }
      if (!Array.isArray(t.entities)) {
        issues.push(`history[${i}] has non-array entities`);
        if (repair) {
          t.entities = [];
          repaired.push(`fixed entities at history[${i}]`);
        }
      }
      if (!Array.isArray(t.topics)) {
        issues.push(`history[${i}] has non-array topics`);
        if (repair) {
          t.topics = [];
          repaired.push(`fixed topics at history[${i}]`);
        }
      }
      if (!Array.isArray(t.fragments)) {
        issues.push(`history[${i}] has non-array fragments`);
        if (repair) {
          t.fragments = [];
          repaired.push(`fixed fragments at history[${i}]`);
        }
      }
      validTurns.push(t);
    }

    if (repair && validTurns.length !== this.history.length) {
      this.history = validTurns;
    }

    // 3. Validate engagement history alignment
    if (!Array.isArray(this._engagementHistory)) {
      issues.push('_engagementHistory is not an array');
      if (repair) {
        this._engagementHistory = [];
        repaired.push('reset _engagementHistory to empty array');
      }
    }
    if (this._engagementHistory.length > this.history.length) {
      issues.push(`_engagementHistory length (${this._engagementHistory.length}) > history length (${this.history.length})`);
      if (repair) {
        this._engagementHistory = this._engagementHistory.slice(0, this.history.length);
        repaired.push('trimmed _engagementHistory to match history length');
      }
    }

    // 4. Validate _fragmentUsage
    if (!(this._fragmentUsage instanceof Map)) {
      issues.push('_fragmentUsage is not a Map');
      if (repair) {
        this._fragmentUsage = new Map();
        repaired.push('reset _fragmentUsage to new Map');
      }
    }

    // 5. Validate _fragmentCount
    if (!(this._fragmentCount instanceof Map)) {
      issues.push('_fragmentCount is not a Map');
      if (repair) {
        this._fragmentCount = new Map();
        repaired.push('reset _fragmentCount to new Map');
      }
    }

    // 6. Validate _entityMentions
    if (!(this._entityMentions instanceof Map)) {
      issues.push('_entityMentions is not a Map');
      if (repair) {
        this._entityMentions = new Map();
        repaired.push('reset _entityMentions to new Map');
      }
    }

    return {
      healthy: issues.length === 0,
      issues,
      repaired,
    };
  }
}
