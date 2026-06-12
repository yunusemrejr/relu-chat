/**
 * test-local-profile.js — Node.js tests for LocalProfile
 *
 * Tests IndexedDB operations, budget inference, topic mastery,
 * export/clear, and fragment boost accumulation.
 *
 * Run with: node dev/scripts/test-local-profile.js
 */

import { LocalProfile, FEEDBACK_TYPE, BUDGET } from '../../core/local-profile.js';

// ---------------------------------------------------------------------------
// Minimal fake-indexeddb polyfill for Node.js
// ---------------------------------------------------------------------------

class FakeIDBRequest {
  constructor(result) {
    this.result = result;
    this.error = null;
    queueMicrotask(() => this.onsuccess?.({ target: this }));
  }
}

class FakeObjectStore {
  constructor(name) {
    this.name = name;
    this._data = new Map();
  }

  getAll() {
    return new FakeIDBRequest([...this._data.values()]);
  }

  get(key) {
    return new FakeIDBRequest(this._data.get(key) ?? undefined);
  }

  put(value) {
    const key = value.id ?? value.topicId ?? value.key ?? value.fragmentId;
    this._data.set(key, value);
    return new FakeIDBRequest(key);
  }

  clear() {
    this._data.clear();
    return new FakeIDBRequest(undefined);
  }
}

class FakeTransaction {
  constructor(db, storeName) {
    this._db = db;
    this._storeName = storeName;
  }

  objectStore(name) {
    return this._db._getStore(name);
  }
}

class FakeDB {
  constructor() {
    this.objectStoreNames = {
      contains: (name) => ['feedback', 'mastery', 'preferences', 'fragment_boosts'].includes(name),
    };
    /** @type {Map<string, FakeObjectStore>} */
    this._stores = new Map();
  }

  _getStore(name) {
    if (!this._stores.has(name)) {
      this._stores.set(name, new FakeObjectStore(name));
    }
    return this._stores.get(name);
  }

  transaction(storeName, _mode) {
    return new FakeTransaction(this, storeName);
  }

  close() {}
}

// Patch the module's internal openDatabase to use our fake
// We do this by monkey-patching after the module loads.
// Since the real module uses indexedDB (browser-only), we replace it.

// Set up fake indexedDB on global
const fakeIndexedDB = {
  open: () => {
    const req = {
      result: new FakeDB(),
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      req.onsuccess?.({ target: req });
    });
    return req;
  },
};

global.indexedDB = fakeIndexedDB;

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results = { passed: 0, failed: 0, errors: [] };

async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed++;
    results.errors.push({ name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value, msg = '') {
  if (!value) {
    throw new Error(msg || 'expected truthy value');
  }
}

function assertFalse(value, msg = '') {
  if (value) {
    throw new Error(msg || 'expected falsy value');
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\nLocalProfile Tests\n==================\n');

  const profile = new LocalProfile('test-bot');
  await profile.init();

  // ── Budget preference inference ─────────────────────────────────────────
  await test('default budget is medium with no feedback', async () => {
    const budget = await profile.getBudgetPreference();
    assertEqual(budget, BUDGET.MEDIUM);
  });

  await test('shorter feedback yields short budget', async () => {
    await profile.recordFeedback('topic_a', { type: FEEDBACK_TYPE.SHORTER });
    await profile.recordFeedback('topic_b', { type: FEEDBACK_TYPE.SHORTER });
    const budget = await profile.getBudgetPreference();
    assertEqual(budget, BUDGET.SHORT);
  });

  await test('longer feedback overrides shorter', async () => {
    await profile.recordFeedback('topic_c', { type: FEEDBACK_TYPE.LONGER });
    await profile.recordFeedback('topic_d', { type: FEEDBACK_TYPE.LONGER });
    await profile.recordFeedback('topic_e', { type: FEEDBACK_TYPE.LONGER });
    const budget = await profile.getBudgetPreference();
    assertEqual(budget, BUDGET.LONG);
  });

  await test('many thumbs_down yields short budget', async () => {
    await profile.clearProfile();
    for (let i = 0; i < 4; i++) {
      await profile.recordFeedback(`topic_${i}`, { type: FEEDBACK_TYPE.THUMBS_DOWN });
    }
    const budget = await profile.getBudgetPreference();
    assertEqual(budget, BUDGET.SHORT);
  });

  // ── Diagram preferences ─────────────────────────────────────────────────
  await test('prefersDiagrams defaults false without interaction', async () => {
    await profile.clearProfile();
    const pref = await profile.prefersDiagrams();
    assertFalse(pref);
  });

  await test('prefersDiagrams true after 2 diagram opens', async () => {
    await profile.recordDiagramOpened('diagram_1');
    await profile.recordDiagramOpened('diagram_2');
    const pref = await profile.prefersDiagrams();
    assertTrue(pref);
  });

  await test('prefersDiagrams respects stored preference override', async () => {
    await profile.clearProfile();
    // Set explicit preference via internal store
    const store = profile._store('preferences', 'readwrite');
    await profile._promisify(store.put({ key: 'diagrams', value: true }));
    const pref = await profile.prefersDiagrams();
    assertTrue(pref);
  });

  // ── Topic mastery ───────────────────────────────────────────────────────
  await test('topic mastery starts at zero', async () => {
    await profile.clearProfile();
    const mastery = await profile.getTopicMastery('nonexistent');
    assertEqual(mastery.count, 0);
    assertEqual(mastery.lastSeen, 0);
  });

  await test('topic interaction increments count', async () => {
    await profile.recordTopicInteraction('game_theory');
    await profile.recordTopicInteraction('game_theory');
    const mastery = await profile.getTopicMastery('game_theory');
    assertEqual(mastery.count, 2);
    assertTrue(mastery.lastSeen > 0);
  });

  await test('frequently visited topics sorted by count', async () => {
    await profile.clearProfile();
    await profile.recordTopicInteraction('alpha');
    await profile.recordTopicInteraction('alpha');
    await profile.recordTopicInteraction('alpha');
    await profile.recordTopicInteraction('beta');
    await profile.recordTopicInteraction('beta');
    await profile.recordTopicInteraction('gamma');

    const top = await profile.getFrequentlyVisitedTopics(2);
    assertEqual(top.length, 2);
    assertEqual(top[0].topicId, 'alpha');
    assertEqual(top[0].count, 3);
    assertEqual(top[1].topicId, 'beta');
    assertEqual(top[1].count, 2);
  });

  // ── Fragment boosts ─────────────────────────────────────────────────────
  await test('fragment boost accumulates', async () => {
    await profile.clearProfile();
    await profile.recordFragmentBoost('relu:def', 0.2);
    await profile.recordFragmentBoost('relu:def', 0.3);
    await profile.recordFragmentBoost('softmax:int', -0.1);

    const boosts = await profile.getFragmentBoosts();
    assertTrue(boosts.has('relu:def'));
    assertEqual(boosts.get('relu:def').boost, 0.5);
    assertTrue(boosts.has('softmax:int'));
    assertEqual(boosts.get('softmax:int').boost, -0.1);
  });

  await test('fragment boost map is empty initially', async () => {
    await profile.clearProfile();
    const boosts = await profile.getFragmentBoosts();
    assertEqual(boosts.size, 0);
  });

  // ── Settings ────────────────────────────────────────────────────────────
  await test('local learning enabled by default', async () => {
    await profile.clearProfile();
    const enabled = await profile.isLocalLearningEnabled();
    assertTrue(enabled);
  });

  await test('can disable local learning', async () => {
    await profile.setLocalLearningEnabled(false);
    const enabled = await profile.isLocalLearningEnabled();
    assertFalse(enabled);
  });

  await test('can re-enable local learning', async () => {
    await profile.setLocalLearningEnabled(true);
    const enabled = await profile.isLocalLearningEnabled();
    assertTrue(enabled);
  });

  // ── Export / clear ──────────────────────────────────────────────────────
  await test('exportProfile returns complete structure', async () => {
    await profile.clearProfile();
    await profile.recordTopicInteraction('topic_x');
    await profile.recordFeedback('topic_x', { type: FEEDBACK_TYPE.THUMBS_UP });
    await profile.recordFragmentBoost('frag:1', 0.1);

    const exported = await profile.exportProfile();
    assertEqual(exported.botId, 'test-bot');
    assertEqual(exported.version, 1);
    assertTrue(Array.isArray(exported.feedback));
    assertTrue(Array.isArray(exported.mastery));
    assertTrue(Array.isArray(exported.fragmentBoosts));
    assertEqual(typeof exported.preferences, 'object');
    assertTrue(exported.exportedAt > 0);
    assertEqual(exported.mastery.length, 1);
    assertEqual(exported.mastery[0].topicId, 'topic_x');
    assertEqual(exported.feedback.length, 1);
    assertEqual(exported.fragmentBoosts.length, 1);
  });

  await test('clearProfile removes all data', async () => {
    await profile.recordTopicInteraction('topic_y');
    await profile.clearProfile();

    const mastery = await profile.getTopicMastery('topic_y');
    assertEqual(mastery.count, 0);

    const boosts = await profile.getFragmentBoosts();
    assertEqual(boosts.size, 0);

    const feedbackStore = profile._store('feedback', 'readonly');
    const allFeedback = await profile._promisify(feedbackStore.getAll());
    assertEqual(allFeedback.length, 0);
  });

  profile.close();

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n-------------------------');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log('-------------------------\n');

  if (results.failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
