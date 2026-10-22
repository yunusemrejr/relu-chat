/**
 * discourse.js — Conversation state for the ReLU.chat inference layer
 *
 * Three small estimators borrowed from tracking and control, applied to dialogue:
 *
 * 1. Topic belief — a discrete Bayes filter (the forward step of a hidden
 *    Markov model; the histogram filter used for robot localization). The
 *    hidden state is "which topic the conversation is about", plus a "no topic"
 *    state. Each user turn first runs a time update (topics persist, drift to
 *    related topics, or jump; persistence decays with idle time), then a
 *    measurement update from what the user named. After the assistant answers,
 *    the topics it presented are observed too, because they are what "it" and
 *    "that" will point to next. A vague follow-up ("why?") carries no
 *    measurement, so the belief simply persists. No hand-tuned boosts.
 *
 * 2. Salience-based reference resolution (after Centering Theory). Pronouns are
 *    resolved to the most salient compatible entity: "he/she" only to people,
 *    "it/this" only to non-people, "they/both" to the last pair or a group, and
 *    "the second one" to the order in which topics were last offered. Entities
 *    named earlier in the same message outrank older context.
 *
 * 3. Verbosity — a scalar Kalman filter over the preferred answer length
 *    (0 = brief, 1 = thorough). Explicit cues ("keep it short", "in depth") are
 *    precise measurements; between cues the estimate relaxes toward a neutral
 *    prior, so a request for brevity persists for a few turns and then fades.
 *    Hysteresis on the output level stops the length from flapping.
 */

export class DiscourseState {
  /**
   * @param {object[]} KB
   * @param {import('./lexicon.js').Lexicon} lexicon
   * @param {{now?: () => number, compact?: boolean}} [options]
   */
  constructor(KB, lexicon, options = {}) {
    this.KB = KB;
    this.lexicon = lexicon;
    this.N = KB.length;
    this.now = options.now || (() => Date.now());
    this.neutralVerbosity = options.compact ? 0.42 : 0.5;
    this.related = KB.map(e => (e.related || []).map(id => KB.findIndex(x => x.id === id)).filter(i => i >= 0));
    this.reset();
  }

  reset() {
    // States 0..N-1 are topics; state N is "no topic yet".
    this.belief = new Float64Array(this.N + 1);
    this.belief[this.N] = 1;
    this.lastTime = null;
    this.lastPresented = [];
    this.lastOffered = [];
    this.lastQtype = null;
    this.lastIntent = null;
    this.turns = 0;
    this.verbosity = { mean: this.neutralVerbosity, variance: 0.05, level: 'normal' };
    this.mentions = new Map(); // topic index → turn of last explicit mention
  }

  // ---------------------------------------------------------------------------
  // Bayes filter
  // ---------------------------------------------------------------------------

  /** Time update: belief ← belief · T(Δt). */
  predict() {
    const now = this.now();
    const idleMinutes = this.lastTime == null ? 0 : Math.max(0, (now - this.lastTime) / 60000);
    this.lastTime = now;
    const N = this.N;
    if (!N) return;
    const stay = 0.3 + 0.55 * Math.exp(-idleMinutes / 12);
    const drift = 0.08;
    const next = new Float64Array(N + 1);
    let mass = 0;
    for (let i = 0; i < N; i++) {
      const b = this.belief[i];
      if (b < 1e-9) continue;
      next[i] += b * stay;
      const rel = this.related[i];
      if (rel.length) for (const j of rel) next[j] += (b * drift) / rel.length;
      else next[N] += b * drift;
      mass += b * (1 - stay - drift);
    }
    const none = this.belief[N];
    next[N] += none * 0.7;
    mass += none * 0.3;
    // Jumps land anywhere, including back on "no topic".
    for (let j = 0; j <= N; j++) next[j] += mass / (N + 1);
    this.belief = normalize(next);
  }

  /**
   * Measurement update. `evidence` maps topic index → strength in [0, 1]
   * (1 = named exactly). Topics not listed get a small floor, so one turn can
   * move attention but never makes a topic impossible.
   * @param {Map<number, number>} evidence
   */
  measure(evidence) {
    if (!evidence || !evidence.size) return;
    const N = this.N;
    // How strongly unmentioned topics are ruled out depends on the evidence
    // type: an exact name is near-decisive, a resolved pronoun strong, a
    // retrieval match only suggestive.
    const top = Math.max(...evidence.values());
    const floor = top >= 0.9 ? 0.002 : top >= 0.75 ? 0.02 : 0.15;
    const next = new Float64Array(N + 1);
    for (let j = 0; j < N; j++) next[j] = this.belief[j] * (floor + (1 - floor) * Math.min(1, evidence.get(j) || 0));
    next[N] = this.belief[N] * floor * 0.5;
    this.belief = normalize(next);
    for (const [j, s] of evidence) if (s >= 0.9) this.mentions.set(j, this.turns);
  }

  /** The topic the conversation is about, if the belief is decisive enough. */
  get currentTopic() {
    let best = -1, bs = 0;
    for (let i = 0; i < this.N; i++) if (this.belief[i] > bs) { bs = this.belief[i]; best = i; }
    return best >= 0 && bs >= 0.25 ? best : null;
  }

  /** Belief of one topic. */
  weight(i) { return Number.isInteger(i) && i >= 0 && i < this.N ? this.belief[i] : 0; }

  /** Topics ordered by belief. */
  ranked(limit = 5) {
    return [...this.belief.slice(0, this.N).keys()].sort((a, b) => this.belief[b] - this.belief[a]).slice(0, limit).filter(i => this.belief[i] > 0.02);
  }

  // ---------------------------------------------------------------------------
  // Reference resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve one anaphor.
   * @param {{kind:string, index?:number}} anaphor
   * @param {{recent?: number[], exclude?: number[]}} [scope] - recent: entities named
   *   earlier in this message (most recent last); exclude: entities named in this clause
   * @returns {number[]} resolved topic indices (empty when unresolved)
   */
  resolve(anaphor, scope = {}) {
    const exclude = new Set(scope.exclude || []);
    const recent = (scope.recent || []).filter(i => !exclude.has(i));
    const kinds = this.lexicon.kinds;
    const fits = i => {
      const k = kinds[i];
      if (anaphor.kind === 'person') return k === 'person';
      if (anaphor.kind === 'thing') return k === 'concept';
      if (anaphor.kind === 'plural') return true;
      return true;
    };
    if (anaphor.kind === 'ordinal') {
      const list = this.lastOffered.length ? this.lastOffered : this.lastPresented;
      const idx = anaphor.index === -1 ? list.length - 1 : anaphor.index;
      return Number.isInteger(list[idx]) ? [list[idx]] : [];
    }
    if (anaphor.kind === 'plural') {
      const pair = recent.length >= 2 ? recent.slice(-2) : this.lastPresented.length >= 2 ? this.lastPresented.slice(0, 2) : null;
      if (pair && pair.every(i => !exclude.has(i))) return pair;
      const group = this.ranked(6).find(i => kinds[i] === 'group' && !exclude.has(i));
      if (group != null) return [group];
    }
    for (let r = recent.length - 1; r >= 0; r--) if (fits(recent[r])) return [recent[r]];
    let best = -1, bs = 0.04;
    for (let i = 0; i < this.N; i++) {
      if (exclude.has(i) || !fits(i)) continue;
      // Presented topics carry a salience bonus over topics that were only implied.
      const s = this.belief[i] * (this.lastPresented[0] === i ? 1.3 : this.lastPresented.includes(i) ? 1.1 : 1);
      if (s > bs) { bs = s; best = i; }
    }
    return best >= 0 ? [best] : [];
  }

  // ---------------------------------------------------------------------------
  // Verbosity (scalar Kalman filter)
  // ---------------------------------------------------------------------------

  /** Relax toward the neutral prior and widen uncertainty. */
  predictVerbosity() {
    const v = this.verbosity;
    v.mean += 0.25 * (this.neutralVerbosity - v.mean);
    v.variance = Math.min(0.25, v.variance + 0.01);
  }

  /** Fuse one measurement z ∈ [0, 1] with noise variance r. */
  observeVerbosity(z, r) {
    const v = this.verbosity;
    const k = v.variance / (v.variance + r);
    v.mean += k * (z - v.mean);
    v.variance = (1 - k) * v.variance;
  }

  /** brief | normal | deep, with hysteresis around the band edges. */
  verbosityLevel() {
    const v = this.verbosity;
    const m = v.mean;
    const prev = v.level;
    let level = m < 0.33 ? 'brief' : m > 0.66 ? 'deep' : 'normal';
    if (prev === 'brief' && m < 0.37) level = 'brief';
    if (prev === 'deep' && m > 0.62) level = 'deep';
    v.level = level;
    return level;
  }

  // ---------------------------------------------------------------------------
  // Turn bookkeeping
  // ---------------------------------------------------------------------------

  /**
   * Record what the assistant just did, as an observation for the filter.
   * @param {{presented:number[], offered?:number[], qtype?:string, intent?:string}} turn
   */
  commit(turn) {
    this.turns++;
    const presented = (turn.presented || []).filter(i => Number.isInteger(i) && i >= 0 && i < this.N);
    if (presented.length) {
      const evidence = new Map();
      presented.forEach((i, rank) => evidence.set(i, rank === 0 ? 1 : 0.7));
      const floor = 0.02;
      const next = new Float64Array(this.N + 1);
      for (let j = 0; j < this.N; j++) next[j] = this.belief[j] * (floor + (1 - floor) * (evidence.get(j) || 0));
      next[this.N] = this.belief[this.N] * floor * 0.5;
      this.belief = normalize(next);
      this.lastPresented = presented;
    }
    // People named inside the reply become secondary referents (Centering's forward-looking centers).
    const mentioned = (turn.mentioned || []).filter(i => Number.isInteger(i) && i >= 0 && i < this.N && !presented.includes(i));
    if (mentioned.length) {
      const total = this.belief.reduce((a, b) => a + b, 0);
      for (const i of mentioned) this.belief[i] += 0.3 * total / mentioned.length;
      this.belief = normalize(this.belief);
    }
    this.lastOffered = (turn.offered || []).filter(i => Number.isInteger(i) && i >= 0 && i < this.N);
    if (turn.qtype) this.lastQtype = turn.qtype;
    if (turn.intent) this.lastIntent = turn.intent;
  }
}

function normalize(v) {
  let s = 0;
  for (const x of v) s += x;
  if (!(s > 0)) { v.fill(0); v[v.length - 1] = 1; return v; }
  for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
}
