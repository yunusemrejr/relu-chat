/**
 * bot-pack-loader.js
 * Runtime module for loading bot packs with progressive stages.
 *
 * Usage:
 *   const loader = new BotPackLoader('game-theory-chat', '/data/bot-packs/');
 *   loader.on('progress', (e) => console.log(e.stage, e.progress));
 *   await loader.stage1_basic();
 *   await loader.stage2_sparse();
 *   await loader.stage3_vectors();
 *   await loader.stage4_policy();
 *
 * Falls back to old loading path if bot.pack.json is not available.
 */

export class BotPackLoader {
  /**
   * @param {string} botId - bot identifier (e.g. 'game-theory-chat')
   * @param {string} baseUrl - base URL for bot-pack files (default: '/data/bot-packs/')
   */
  constructor(botId, baseUrl = '/data/bot-packs/') {
    this.botId = botId;
    this.baseUrl = baseUrl.replace(/\/$/, '') + '/';
    this.packUrl = this.baseUrl + botId + '/bot.pack.json';

    // Internal state
    this._manifest = null;
    this._entries = null;
    this._aliases = null;
    this._bm25 = null;
    this._entryVectors = null;
    this._fragmentVectors = null;
    this._diagrams = null;
    this._overrides = null;
    this._intents = null;
    this._policy = null;
    this._policyManifest = null;

    this._stage = 0; // 0=none, 1=basic, 2=sparse, 3=vectors, 4=policy
    this._progress = 0;
    this._ready = false;
    this._available = null; // null=unknown, true|false after probe
    this._listeners = { progress: [], ready: [], error: [] };
    this._abortControllers = [];
  }

  // ── Event emitter (minimal) ─────────────────────────────────────────────
  on(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
    return () => {
      this._listeners[event] = this._listeners[event].filter(h => h !== handler);
    };
  }

  _emit(event, data) {
    for (const h of (this._listeners[event] || [])) {
      try { h(data); } catch (e) { console.warn('[BotPackLoader] listener error:', e); }
    }
  }

  _emitProgress(stage, progress, detail = '') {
    this._stage = stage;
    this._progress = Math.max(0, Math.min(1, progress));
    this._emit('progress', {
      stage,
      stageName: ['none', 'basic', 'sparse', 'vectors', 'policy'][stage] || 'unknown',
      progress: this._progress,
      detail,
      botId: this.botId
    });
  }

  _createAbortController() {
    const ac = new AbortController();
    this._abortControllers.push(ac);
    return ac;
  }

  _clearAbortControllers() {
    for (const ac of this._abortControllers) {
      try { ac.abort(); } catch (e) {}
    }
    this._abortControllers = [];
  }

  // ── Core fetch helper ───────────────────────────────────────────────────
  async _fetchJSON(url, options = {}) {
    const ac = options.signal || this._createAbortController().signal;
    try {
      const res = await fetch(url, { ...options, signal: ac });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error(`Failed to load ${url}: ${err.message}`);
    }
  }

  // ── Probe: check if bot pack is available ───────────────────────────────
  async probe() {
    if (this._available !== null) return this._available;
    try {
      const res = await fetch(this.packUrl, { method: 'HEAD' });
      this._available = res.ok;
    } catch (e) {
      this._available = false;
    }
    return this._available;
  }

  // ── Stage 1: Load manifest + basic entries (fast) ───────────────────────
  async stage1_basic() {
    this._emitProgress(1, 0, 'loading manifest');

    this._manifest = await this._fetchJSON(this.packUrl);
    this._emitProgress(1, 0.3, 'manifest loaded');

    const base = this.baseUrl + this.botId + '/';
    const [entries, aliases] = await Promise.all([
      this._fetchJSON(base + this._manifest.entries),
      this._fetchJSON(base + this._manifest.aliasIndex)
    ]);

    this._entries = entries;
    this._aliases = aliases;
    this._emitProgress(1, 1.0, 'basic load complete');

    return {
      manifest: this._manifest,
      entries: this._entries,
      aliases: this._aliases
    };
  }

  // ── Stage 2: Load BM25 index (fast to medium) ───────────────────────────
  async stage2_sparse() {
    this._emitProgress(2, 0, 'loading bm25 index');

    const base = this.baseUrl + this.botId + '/';
    this._bm25 = await this._fetchJSON(base + this._manifest.bm25Index);

    // Also load overrides and intents if available (they're small)
    const loadExtras = [];
    if (this._manifest.overrides) {
      loadExtras.push(
        this._fetchJSON(base + this._manifest.overrides).then(o => { this._overrides = o; })
      );
    }
    if (this._manifest.intents) {
      loadExtras.push(
        this._fetchJSON(base + this._manifest.intents).then(i => { this._intents = i; })
      );
    }
    if (loadExtras.length > 0) {
      await Promise.all(loadExtras);
    }

    this._emitProgress(2, 1.0, 'sparse load complete');

    return {
      bm25: this._bm25,
      overrides: this._overrides,
      intents: this._intents
    };
  }

  // ── Stage 3: Load precomputed vectors (medium, may be large) ────────────
  async stage3_vectors() {
    this._emitProgress(3, 0, 'loading vectors');

    const base = this.baseUrl + this.botId + '/';
    const manifest = this._manifest;

    // Vectors may be large — load sequentially to avoid memory spike
    if (manifest.entryVectors) {
      this._entryVectors = await this._fetchJSON(base + manifest.entryVectors);
      this._emitProgress(3, 0.5, 'entry vectors loaded');
    }

    if (manifest.fragmentVectors) {
      this._fragmentVectors = await this._fetchJSON(base + manifest.fragmentVectors);
      this._emitProgress(3, 1.0, 'fragment vectors loaded');
    } else {
      this._emitProgress(3, 1.0, 'vectors load complete (no fragment vectors)');
    }

    this._ready = true;
    this._emit('ready', { stage: 3, botId: this.botId });

    return {
      entryVectors: this._entryVectors,
      fragmentVectors: this._fragmentVectors
    };
  }

  // ── Stage 4: Load diagrams + policy (optional, on demand) ───────────────
  async stage4_policy() {
    this._emitProgress(4, 0, 'loading policy');

    const base = this.baseUrl + this.botId + '/';
    const manifest = this._manifest;

    const loadables = [];

    if (manifest.diagrams) {
      loadables.push(
        this._fetchJSON(base + manifest.diagrams).then(d => { this._diagrams = d; })
      );
    }

    if (manifest.policy?.manifest) {
      loadables.push(
        this._fetchJSON(base + manifest.policy.manifest).then(m => { this._policyManifest = m; })
      );
    }

    if (manifest.policy?.weights) {
      loadables.push(
        this._fetchJSON(base + manifest.policy.weights).then(w => { this._policy = w; })
      );
    }

    if (loadables.length > 0) {
      await Promise.all(loadables);
    }

    this._emitProgress(4, 1.0, 'policy load complete');

    return {
      diagrams: this._diagrams,
      policy: this._policy,
      policyManifest: this._policyManifest
    };
  }

  // ── Load all stages sequentially ────────────────────────────────────────
  async loadAll() {
    await this.stage1_basic();
    await this.stage2_sparse();
    await this.stage3_vectors();
    await this.stage4_policy();
    return this.getData();
  }

  // ── Get current status ──────────────────────────────────────────────────
  getStatus() {
    return {
      stage: this._stage,
      stageName: ['none', 'basic', 'sparse', 'vectors', 'policy'][this._stage] || 'unknown',
      progress: this._progress,
      ready: this._ready,
      available: this._available,
      botId: this.botId
    };
  }

  // ── Get all loaded data ─────────────────────────────────────────────────
  getData() {
    return {
      manifest: this._manifest,
      entries: this._entries,
      aliases: this._aliases,
      bm25: this._bm25,
      entryVectors: this._entryVectors,
      fragmentVectors: this._fragmentVectors,
      diagrams: this._diagrams,
      overrides: this._overrides,
      intents: this._intents,
      policy: this._policy,
      policyManifest: this._policyManifest
    };
  }

  // ── Cancel all in-flight loads ──────────────────────────────────────────
  cancel() {
    this._clearAbortControllers();
    this._ready = false;
    this._stage = 0;
    this._progress = 0;
  }

  // ── Static: quick check if bot-pack exists for a bot ────────────────────
  static async isAvailable(botId, baseUrl = '/data/bot-packs/') {
    const loader = new BotPackLoader(botId, baseUrl);
    return loader.probe();
  }
}

// ── Convenience: load a bot pack in one call ──────────────────────────────
export async function loadBotPack(botId, baseUrl = '/data/bot-packs/') {
  const loader = new BotPackLoader(botId, baseUrl);
  const available = await loader.probe();
  if (!available) {
    return { available: false, loader, data: null };
  }
  const data = await loader.loadAll();
  return { available: true, loader, data };
}
