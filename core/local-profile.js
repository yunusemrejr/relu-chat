/**
 * local-profile.js — ReLU.chat Local Personalization Module
 *
 * Browser-only IndexedDB storage for user preferences.
 * Never syncs to any server. All data stays local.
 *
 * Stores:
 *   - Feedback history (thumbs, length preferences, diagram ratings)
 *   - Topic mastery (visit counts, last seen timestamps)
 *   - Preferences (answer budget, diagram preference, learning toggle)
 *   - Fragment boosts (user-driven relevance adjustments)
 */

const DB_NAME = 'relu-local-profile';
const DB_VERSION = 1;

/** @enum {string} */
const STORE = {
  FEEDBACK: 'feedback',
  MASTERY: 'mastery',
  PREFERENCES: 'preferences',
  FRAGMENT_BOOSTS: 'fragment_boosts',
};

/** @enum {string} */
const PREF_KEY = {
  BUDGET: 'budget',
  DIAGRAMS: 'diagrams',
  LEARNING_ENABLED: 'learning_enabled',
};

/** @enum {string} */
export const FEEDBACK_TYPE = {
  THUMBS_UP: 'thumbs_up',
  THUMBS_DOWN: 'thumbs_down',
  SHORTER: 'shorter',
  LONGER: 'longer',
  DIAGRAM_HELPFUL: 'diagram_helpful',
};

/** @enum {string} */
export const BUDGET = {
  SHORT: 'short',
  MEDIUM: 'medium',
  LONG: 'long',
};

/**
 * Opens the IndexedDB database, creating object stores if needed.
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE.FEEDBACK)) {
        db.createObjectStore(STORE.FEEDBACK, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE.MASTERY)) {
        db.createObjectStore(STORE.MASTERY, { keyPath: 'topicId' });
      }
      if (!db.objectStoreNames.contains(STORE.PREFERENCES)) {
        db.createObjectStore(STORE.PREFERENCES, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE.FRAGMENT_BOOSTS)) {
        db.createObjectStore(STORE.FRAGMENT_BOOSTS, { keyPath: 'fragmentId' });
      }
    };
  });
}

/**
 * LocalProfile — per-bot local personalization backed by IndexedDB.
 *
 * All methods are async. Call `init()` before using.
 */
export class LocalProfile {
  /**
   * @param {string} botId - unique bot identifier (used for namespacing if needed)
   */
  constructor(botId) {
    this.botId = botId || 'default';
    /** @type {IDBDatabase|null} */
    this._db = null;
  }

  /**
   * Open the IndexedDB connection.
   * Safe to call multiple times — returns existing connection on repeat calls.
   * @returns {Promise<void>}
   */
  async init() {
    if (this._db) return;
    this._db = await openDatabase();
  }

  /**
   * Close the IndexedDB connection.
   */
  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  /**
   * Internal helper: run a request on a given store.
   * @private
   * @param {string} storeName
   * @param {string} mode - 'readonly' | 'readwrite'
   * @returns {IDBObjectStore}
   */
  _store(storeName, mode = 'readonly') {
    if (!this._db) throw new Error('LocalProfile not initialized. Call init() first.');
    return this._db.transaction(storeName, mode).objectStore(storeName);
  }

  /**
   * Promisify an IndexedDB request.
   * @private
   * @template T
   * @param {IDBRequest<T>} request
   * @returns {Promise<T>}
   */
  _promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---------------------------------------------------------------------------
  // Feedback & budget preferences
  // ---------------------------------------------------------------------------

  /**
   * Record a feedback event for a topic.
   *
   * @param {string} topicId
   * @param {{ type: 'thumbs_up'|'thumbs_down'|'shorter'|'longer'|'diagram_helpful', timestamp?: number }} feedback
   * @returns {Promise<void>}
   */
  async recordFeedback(topicId, feedback) {
    const store = this._store(STORE.FEEDBACK, 'readwrite');
    const entry = {
      id: `event_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      topicId,
      type: feedback.type,
      timestamp: feedback.timestamp || Date.now(),
    };
    await this._promisify(store.put(entry));
  }

  /**
   * Infer the preferred answer budget from feedback history.
   *
   * Counts 'shorter' vs 'longer' feedback events. Falls back to 'medium'
   * if insufficient data.
   *
   * @returns {Promise<'short'|'medium'|'long'>}
   */
  async getBudgetPreference() {
    const store = this._store(STORE.FEEDBACK, 'readonly');
    const all = await this._promisify(store.getAll());

    let shorter = 0;
    let longer = 0;
    let thumbsUp = 0;
    let thumbsDown = 0;

    for (const entry of all) {
      if (entry.type === FEEDBACK_TYPE.SHORTER) shorter++;
      if (entry.type === FEEDBACK_TYPE.LONGER) longer++;
      if (entry.type === FEEDBACK_TYPE.THUMBS_UP) thumbsUp++;
      if (entry.type === FEEDBACK_TYPE.THUMBS_DOWN) thumbsDown++;
    }

    // Explicit length feedback takes priority
    if (shorter > longer) return BUDGET.SHORT;
    if (longer > shorter) return BUDGET.LONG;

    // If no explicit length preference, look at overall satisfaction
    const total = thumbsUp + thumbsDown;
    if (total >= 3 && thumbsDown > thumbsUp) {
      // User is generally unhappy — try shorter answers
      return BUDGET.SHORT;
    }

    return BUDGET.MEDIUM;
  }

  // ---------------------------------------------------------------------------
  // Diagram preferences
  // ---------------------------------------------------------------------------

  /**
   * Record that a user opened (interacted with) a diagram.
   * @param {string} diagramId
   * @returns {Promise<void>}
   */
  async recordDiagramOpened(diagramId) {
    const store = this._store(STORE.FEEDBACK, 'readwrite');
    const entry = {
      id: `diagram_${diagramId}_${Date.now()}`,
      topicId: diagramId,
      type: FEEDBACK_TYPE.DIAGRAM_HELPFUL,
      timestamp: Date.now(),
    };
    await this._promisify(store.put(entry));
  }

  /**
   * Determine whether the user prefers diagrams based on interaction history.
   *
   * Returns true if the user has opened at least 2 diagrams or explicitly
   * given diagram_helpful feedback.
   *
   * @returns {Promise<boolean>}
   */
  async prefersDiagrams() {
    const store = this._store(STORE.FEEDBACK, 'readonly');
    const all = await this._promisify(store.getAll());
    const diagramEvents = all.filter(e => e.type === FEEDBACK_TYPE.DIAGRAM_HELPFUL);

    // Also check stored preference override
    const prefStore = this._store(STORE.PREFERENCES, 'readonly');
    const pref = await this._promisify(prefStore.get(PREF_KEY.DIAGRAMS));
    if (pref && typeof pref.value === 'boolean') return pref.value;

    return diagramEvents.length >= 2;
  }

  // ---------------------------------------------------------------------------
  // Topic mastery
  // ---------------------------------------------------------------------------

  /**
   * Record that the user interacted with a topic.
   * Increments count and updates lastSeen timestamp.
   *
   * @param {string} topicId
   * @returns {Promise<void>}
   */
  async recordTopicInteraction(topicId) {
    const store = this._store(STORE.MASTERY, 'readwrite');
    const existing = await this._promisify(store.get(topicId));

    const entry = {
      topicId,
      count: (existing?.count || 0) + 1,
      lastSeen: Date.now(),
    };
    await this._promisify(store.put(entry));
  }

  /**
   * Get mastery stats for a single topic.
   *
   * @param {string} topicId
   * @returns {Promise<{ count: number, lastSeen: number }>}
   */
  async getTopicMastery(topicId) {
    const store = this._store(STORE.MASTERY, 'readonly');
    const result = await this._promisify(store.get(topicId));
    return {
      count: result?.count || 0,
      lastSeen: result?.lastSeen || 0,
    };
  }

  /**
   * Get the most frequently visited topics.
   *
   * @param {number} [limit=5]
   * @returns {Promise<Array<{ topicId: string, count: number, lastSeen: number }>>}
   */
  async getFrequentlyVisitedTopics(limit = 5) {
    const store = this._store(STORE.MASTERY, 'readonly');
    const all = await this._promisify(store.getAll());

    all.sort((a, b) => b.count - a.count);
    return all.slice(0, limit).map(r => ({
      topicId: r.topicId,
      count: r.count,
      lastSeen: r.lastSeen,
    }));
  }

  // ---------------------------------------------------------------------------
  // Fragment boosts
  // ---------------------------------------------------------------------------

  /**
   * Apply a relevance boost (positive or negative) to a fragment.
   *
   * @param {string} fragmentId
   * @param {number} delta - e.g. +0.2 or -0.1
   * @returns {Promise<void>}
   */
  async recordFragmentBoost(fragmentId, delta) {
    const store = this._store(STORE.FRAGMENT_BOOSTS, 'readwrite');
    const existing = await this._promisify(store.get(fragmentId));

    const entry = {
      fragmentId,
      boost: (existing?.boost || 0) + delta,
      lastModified: Date.now(),
    };
    await this._promisify(store.put(entry));
  }

  /**
   * Get all fragment boosts as a Map.
   *
   * @returns {Promise<Map<string, { boost: number, lastModified: number }>>}
   */
  async getFragmentBoosts() {
    const store = this._store(STORE.FRAGMENT_BOOSTS, 'readonly');
    const all = await this._promisify(store.getAll());

    const map = new Map();
    for (const r of all) {
      map.set(r.fragmentId, { boost: r.boost, lastModified: r.lastModified });
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  /**
   * Check whether local learning is enabled.
   * Defaults to true if never set.
   *
   * @returns {Promise<boolean>}
   */
  async isLocalLearningEnabled() {
    const store = this._store(STORE.PREFERENCES, 'readonly');
    const result = await this._promisify(store.get(PREF_KEY.LEARNING_ENABLED));
    return result?.value !== false; // default true
  }

  /**
   * Enable or disable local learning.
   *
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setLocalLearningEnabled(enabled) {
    const store = this._store(STORE.PREFERENCES, 'readwrite');
    await this._promisify(store.put({ key: PREF_KEY.LEARNING_ENABLED, value: !!enabled }));
  }

  // ---------------------------------------------------------------------------
  // Export / clear
  // ---------------------------------------------------------------------------

  /**
   * Export the entire local profile as a JSON-serializable object.
   * Suitable for user download or migration.
   *
   * @returns {Promise<object>}
   */
  async exportProfile() {
    const profile = {
      botId: this.botId,
      exportedAt: Date.now(),
      version: 1,
      feedback: [],
      mastery: [],
      preferences: {},
      fragmentBoosts: [],
    };

    const feedbackStore = this._store(STORE.FEEDBACK, 'readonly');
    profile.feedback = await this._promisify(feedbackStore.getAll());

    const masteryStore = this._store(STORE.MASTERY, 'readonly');
    profile.mastery = await this._promisify(masteryStore.getAll());

    const prefStore = this._store(STORE.PREFERENCES, 'readonly');
    const prefs = await this._promisify(prefStore.getAll());
    for (const p of prefs) {
      profile.preferences[p.key] = p.value;
    }

    const boostStore = this._store(STORE.FRAGMENT_BOOSTS, 'readonly');
    profile.fragmentBoosts = await this._promisify(boostStore.getAll());

    return profile;
  }

  /**
   * Delete all local data for this profile.
   * WARNING: irreversible.
   *
   * @returns {Promise<void>}
   */
  async clearProfile() {
    for (const name of Object.values(STORE)) {
      const store = this._store(name, 'readwrite');
      await this._promisify(store.clear());
    }
  }
}
