/**
 * grounding.js — Entity linking and knowledge-boundary decisions
 *
 * Decides what a clause is about and whether the knowledge base can honestly
 * answer it. The decision is an attentional cascade (the Viola–Jones idea from
 * on-device face detection: cheap stages settle easy cases, costlier stages run
 * only when needed):
 *
 *   1. Exact or typo-tolerant alias match over the clause's token sequence
 *      (longest match wins; plural, compound and one-edit variants allowed).
 *   2. Reference resolution for pronouns and ellipsis, via the discourse state.
 *   3. Evidence accounting over the question's focus words. Every content word
 *      is weighted by its information (entry-level IDF; generic English is
 *      nearly weightless; words absent from the knowledge base carry maximum
 *      weight) and marked covered by a candidate topic's name/aliases, its
 *      overview, or only its body text.
 *   4. A three-way decision using thresholds fixed by split-conformal
 *      calibration (dev/scripts/calibrate-boundary.mjs): answer, answer as the
 *      "closest match", or say plainly that the topic is not covered.
 *
 * "I don't know that, but…" is reserved for evidence that the asked-about
 * concept is genuinely missing: a specific word the knowledge base has never
 * seen, or a modifier that turns a known topic into a different concept
 * ("quantum game theory"). Named topics are never refused.
 */

import { wordTokens, isGenericWord, editDistance, STOPWORDS } from './lexicon.js';
import { RELATION_WORDS, classifyQtype } from './query-analysis.js';

/** Defaults; per-assistant values come from data/boundary-calibration.json. */
export const DEFAULT_CALIBRATION = Object.freeze({
  answer: 0.58,      // core coverage at or above which a retrieved topic is answered normally
  weak: 0.34,        // between weak and answer: answered, framed as the closest match
  mention: 0.8,      // body coverage needed to quote where an uncovered concept is mentioned
  oovShare: 0.3,     // share of specific information carried by unknown words that makes a concept "unknown"
});

const SPECIALIZING_QTYPES = new Set(['define', 'how', 'example', 'formula', 'application', 'other', 'why']);
// Questions that name a concept, where one unknown key word means the concept is missing.
const CONCEPT_QTYPES = new Set(['define', 'other', 'example', 'formula', 'list', 'who', 'when', 'where']);
// Which aspect of a topic is wanted ("the formula for…", "an example of…"): framing, not a topic.
const ASPECT_WORDS = new Set(['formula', 'formulas', 'formulae', 'equation', 'equations', 'example', 'examples', 'definition',
  'proof', 'proofs', 'intuition', 'application', 'applications', 'use', 'uses', 'usage', 'meaning', 'history', 'origin', 'origins',
  'purpose', 'advantage', 'advantages', 'disadvantage', 'disadvantages', 'limitation', 'limitations', 'property', 'properties',
  'step', 'steps', 'math', 'maths', 'mathematics', 'derivation', 'explanation', 'summary', 'overview', 'basics', 'notation']);
// Questions whose focus is a noun phrase ("what is X", "an example of X").
const NOUN_QTYPES = new Set(['define', 'other', 'example', 'formula', 'list']);
// Small words allowed inside a noun phrase; any other function word ends it.
const NP_GLUE = new Set(['the', 'a', 'an', 'my', 'your', 'its', 'their', 'this', 'that', 'these', 'those']);
// MiniLM similarity at which a description is matched to its closest topic (see assess()).
const SEMANTIC_ACCEPT = 0.55;
// Numbers, sizes and units ("100", "3x3", "10th", "50ms") carry no topic; names like "f1" or "float32" do.
const NUMBERISH = /^\d+(?:x\d+)?$|^\d+(?:st|nd|rd|th|s|d|k|m|px|ms|mb|gb|kb)$/;
const PREPOSITIONS = new Set(['of', 'for', 'in', 'on', 'with', 'to', 'from', 'by', 'about', 'under', 'between', 'within', 'during', 'without', 'via']);

/** Tokens of an alias, with stopwords kept so contiguity is preserved. */
function aliasRecord(text, index, kind) {
  const toks = wordTokens(text);
  if (!toks.length || toks.every(t => STOPWORDS.has(t.w))) return null;
  const notation = /[(),]/.test(text) && toks.every(t => t.w.length <= 2);
  return {
    index, text, kind, notation,
    raw: notation ? text.toLowerCase().replace(/\s+/g, '') : null,
    stems: toks.map(t => t.stem), words: toks.map(t => t.w),
    joined: toks.map(t => t.w).join(''),
    generic: toks.length === 1 && isGenericWord(toks[0].w),
  };
}

function tokenMatch(q, a, aw) {
  if (q.stem === a || q.w === aw) return 1;
  if (q.w.length === 5 && aw.length === 6 && q.w[0] === aw[0] && editDistance(q.w, aw, 1) === 1) return 0.8;
  if (q.w.length >= 6 && aw.length >= 6 && q.w[0] === aw[0] && editDistance(q.w, aw, 1) === 1) return 0.85;
  return 0;
}

export class Grounder {
  /**
   * @param {object[]} KB
   * @param {import('./lexicon.js').Lexicon} lexicon
   * @param {{calibration?: object}} [options]
   */
  constructor(KB, lexicon, options = {}) {
    this.KB = KB;
    this.lexicon = lexicon;
    this.calibration = { ...DEFAULT_CALIBRATION, ...(options.calibration || {}) };
    this.aliases = [];
    KB.forEach((e, i) => {
      const seen = new Set();
      for (const name of [e.name, ...(e.aliases || [])]) {
        const key = String(name || '').toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const rec = aliasRecord(name, i, 'local');
        if (!rec) continue;
        // A one-word alias found in most entries ("matrix", "agent") says little about which topic is meant.
        rec.isName = key === String(e.name || '').toLowerCase().trim();
        if (rec.stems.length === 1 && !rec.isName) {
          const inNames = lexicon.entryNameStems.filter((names, j) => j !== i && names.has(rec.stems[0])).length;
          if ((lexicon.df.get(rec.stems[0]) || 0) / Math.max(1, KB.length) >= 0.33 || inNames >= 2) rec.generic = true;
        }
        this.aliases.push(rec);
      }
    });
    // "Core" text says what a topic IS: name, aliases, overview and definition.
    this.coreStems = KB.map((e, i) => {
      const s = new Set(lexicon.entryNameStems[i]);
      for (const u of lexicon.units[i]) if (u.cat === 'summary' || u.cat === 'def') for (const x of u.stems) s.add(x);
      return s;
    });
    this.hubs = pageRank(KB).slice(0, 4);
    this.foreign = [];
    // Everyday words that name topics here ("feature", "value", "line") are technical in this assistant.
    this.nameVocabulary = new Set(lexicon.entryNameStems.flatMap(n => [...n]));
    // The topic named after the assistant's whole subject says nothing about which part is asked.
    const subject = wordTokens(options.subject || '').map(t => t.stem).filter(x => !STOPWORDS.has(x)).join(' ');
    this.subjectTopic = subject ? KB.findIndex(e => wordTokens(e.name).map(t => t.stem).join(' ') === subject) : -1;
    if (this.subjectTopic >= 0) for (const a of this.aliases) if (a.index === this.subjectTopic && !a.isName) a.generic = true;
  }

  /**
   * Register other assistants' topics so an unanswerable question can be sent
   * to the assistant that covers it.
   * @param {{bots: object[], topics: Array<[number, string, string, string[], string, string]>}} directory
   * @param {string} selfId
   */
  setDirectory(directory, selfId) {
    this.foreign = [];
    this.directory = directory;
    if (!directory?.bots || !directory?.topics) return;
    for (const [b, id, name, aliases, summary, learn] of directory.topics) {
      const bot = directory.bots[b];
      if (!bot || bot.id === selfId) continue;
      const seen = new Set();
      for (const text of [name, ...(aliases || [])]) {
        const key = String(text || '').toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const rec = aliasRecord(text, -1, 'foreign');
        if (rec && !rec.generic && rec.joined.length >= 4) this.foreign.push({ ...rec, bot, topic: { id, name, summary, learn } });
      }
    }
  }

  /**
   * Find non-overlapping alias mentions in a token sequence.
   * @param {object[]} tokens - wordTokens() of the clause
   * @param {string} raw - original clause text (for case and notation checks)
   * @param {object[]} [table] - alias table (local by default)
   */
  link(tokens, raw, table = this.aliases) {
    const found = [];
    const lowerRaw = raw.toLowerCase().replace(/\s+/g, '');
    for (const a of table) {
      if (a.notation) {
        const at = lowerRaw.indexOf(a.raw);
        if (at >= 0) found.push({ alias: a, start: 0, end: 0, quality: 1, notation: true });
        continue;
      }
      const n = a.stems.length;
      for (let p = 0; p < tokens.length; p++) {
        // Joined compound: "qlearning" / "webassembly" against a two-word alias.
        if (n > 1 && (tokens[p].w === a.joined || tokens[p].stem === a.joined)) {
          found.push({ alias: a, start: p, end: p + 1, quality: 0.95 });
          continue;
        }
        if (p + n > tokens.length) continue;
        let q = 1, ok = true, relaxed = 0;
        for (let k = 0; k < n && ok; k++) {
          let m = tokenMatch(tokens[p + k], a.stems[k], a.words[k]);
          // Inside a multi-word name the other words confirm it, so one short
          // typo ("bais" for "bias") is tolerated.
          if (!m && n > 1 && !relaxed && tokens[p + k].w.length >= 4 && a.words[k].length >= 4 && tokens[p + k].w[0] === a.words[k][0] && editDistance(tokens[p + k].w, a.words[k], 1) === 1) { m = 0.8; relaxed++; }
          if (!m) ok = false; else q = Math.min(q, m);
        }
        if (!ok) {
          // Split compound: "eigen vectors" against "eigenvectors" (two real words, never "me an" → "mean").
          const pair = p + 1 < tokens.length && [tokens[p], tokens[p + 1]].every(t => t.w.length >= 3 && !STOPWORDS.has(t.w));
          if (n === 1 && pair && (tokens[p].w + tokens[p + 1].w === a.words[0] || tokens[p].w + tokens[p + 1].stem === a.stems[0])) found.push({ alias: a, start: p, end: p + 2, quality: 0.95 });
          continue;
        }
        if (n === 1) {
          const t = tokens[p];
          const surface = raw.slice(t.start, t.end);
          if (a.words[0].length <= 2 && surface !== surface.toUpperCase() && !/\d/.test(a.words[0]) && (STOPWORDS.has(t.w) || isGenericWord(t.w) || tokens.length > 8)) continue;
          if (a.words[0].length === 3 && (STOPWORDS.has(t.w) || isGenericWord(t.w)) && surface !== surface.toUpperCase()) continue;
        }
        found.push({ alias: a, start: p, end: p + n, quality: q });
      }
    }
    found.sort((x, y) => (y.end - y.start) - (x.end - x.start) || y.quality - x.quality || x.start - y.start);
    const taken = [];
    const out = [];
    for (const f of found) {
      if (f.notation) { if (!out.some(o => o.alias.index === f.alias.index)) out.push(f); continue; }
      const clash = taken.find(([s, e]) => f.start < e && s < f.end);
      if (clash) {
        // Same span, different topic: the topic named exactly that wins; otherwise keep both readings.
        const twin = out.find(o => o.start === f.start && o.end === f.end && o.alias.index !== f.alias.index && o.quality === f.quality);
        if (twin && clash[0] === f.start && clash[1] === f.end) {
          if (f.alias.isName && !twin.alias.isName) out.splice(out.indexOf(twin), 1, f);
          else if (!twin.alias.isName && !f.alias.isName) { f.ambiguous = true; twin.ambiguous = true; out.push(f); }
        }
        continue;
      }
      taken.push([f.start, f.end]);
      out.push(f);
    }
    const unique = [];
    for (const f of out.sort((x, y) => x.start - y.start)) if (!unique.some(u => u.alias.index === f.alias.index && u.alias.kind === f.alias.kind && (f.alias.kind === 'local' || u.alias.bot === f.alias.bot && u.alias.topic.id === f.alias.topic.id))) unique.push(f);
    return unique;
  }

  /**
   * Weigh each focus word: how informative it is and whether the knowledge
   * base has ever seen it.
   */
  focusEvidence(clause) {
    const lx = this.lexicon;
    const anaphoraSpans = clause.anaphora.map(a => [a.start, a.end]);
    const focus = clause.focusTokens.filter(t => !anaphoraSpans.some(([s, e]) => t.start >= s && t.end <= e) && !RELATION_WORDS.has(t.w));
    return focus.map((t, k) => {
      const nameWord = this.nameVocabulary.has(t.stem) && !STOPWORDS.has(t.w) && !ASPECT_WORDS.has(t.w) && t.w.length > 2;
      const generic = !nameWord && (isGenericWord(t.w) || ASPECT_WORDS.has(t.w) || t.w.length === 1 || NUMBERISH.test(t.w));
      const explained = generic ? (lx.hasStem(t.stem) ? t.stem : null) : lx.explain(focus, k);
      const weight = generic ? 0.25 : explained ? lx.idf(explained) : lx.maxIdf;
      return { ...t, generic, explained, oov: !generic && !explained, weight };
    });
  }

  /** How much of the focus information a set of topics accounts for. */
  coverage(evidence, topics, links = []) {
    let total = 0, specific = 0, core = 0, body = 0, oov = 0;
    const uncovered = [];
    for (const t of evidence) {
      total += t.weight;
      if (!t.generic) specific += t.weight;
      if (t.oov) oov += t.weight;
      const s = t.explained;
      let c = 0, b = 0;
      for (const i of topics) {
        const inAlias = links.some(l => l.alias.index === i && t.start >= l.span[0] && t.end <= l.span[1]);
        if (inAlias || (s && this.lexicon.entryNameStems[i].has(s))) { c = 1; b = 1; break; }
        if (s && this.coreStems[i].has(s)) c = Math.max(c, 0.9);
        if (s && this.lexicon.entryStems[i].has(s)) b = Math.max(b, 0.85);
      }
      b = Math.max(b, c);
      core += t.weight * c;
      body += t.weight * b;
      if (!t.generic && b === 0) uncovered.push(t);
    }
    return {
      core: total ? core / total : 0,
      body: total ? body / total : 0,
      specific, oovShare: specific ? oov / specific : 0,
      uncovered, oovTokens: uncovered.filter(t => t.oov),
    };
  }

  /**
   * Sentences that mention the focus phrase although no topic is about it.
   * All specific focus stems must appear within a short window.
   */
  findMentions(evidence, exclude = []) {
    const words = evidence.filter(t => !t.generic && t.explained && t.explained.length > 2);
    const want = words.map(t => t.explained);
    if (!want.length || want.length > 4 || want.reduce((n, s) => n + this.lexicon.idf(s), 0) < 2.5) return [];
    const exact = want.length === 1 ? new RegExp(`\\b${words[0].w.replace(/[^a-z0-9]/g, '')}s?\\b`, 'i') : null;
    const hits = [];
    this.lexicon.units.forEach((units, i) => {
      if (exclude.includes(i)) return;
      for (const u of units) {
        if (!want.every(s => u.stems.has(s))) continue;
        for (const sentence of u.sentences) {
          const toks = wordTokens(sentence).map(t => t.stem);
          const pos = want.map(s => toks.indexOf(s));
          if (pos.some(p => p < 0)) continue;
          const span = Math.max(...pos) - Math.min(...pos);
          if (span > want.length + 2) continue;
          if (exact && !exact.test(sentence)) continue;
          hits.push({ index: i, unit: u, sentence, score: want.reduce((n, s) => n + this.lexicon.idf(s), 0) - span * 0.2 - (u.cat === 'summary' || u.cat === 'def' ? 0 : 0.1) });
          break;
        }
      }
    });
    hits.sort((a, b) => b.score - a.score || a.index - b.index);
    const out = [];
    for (const h of hits) if (!out.some(o => o.index === h.index)) out.push(h);
    return out.slice(0, 2);
  }

  /**
   * Topics to offer when the question itself is not covered: the current topic
   * if it shares vocabulary with the question, retrieved topics whose names
   * share a specific word, otherwise the most central topics (PageRank over the
   * related-topic graph).
   */
  pivots(evidence, candidates, discourse, described = false) {
    const out = [];
    const current = discourse?.currentTopic;
    const specific = evidence.filter(t => !t.generic && t.explained);
    const sharesName = i => specific.some(t => this.lexicon.entryNameStems[i].has(t.explained) && this.lexicon.idf(t.explained) >= 2);
    if (current != null && specific.some(t => this.lexicon.entryStems[current].has(t.explained))) out.push(current);
    for (const c of candidates) if (out.length < 2 && c.semantic && !out.includes(c.i)) out.push(c.i);
    // One shared name word is coincidence when the asked phrase contains a word the notes never use ("jordan normal form").
    const unknownConcept = evidence.some(t => t.oov && !t.generic);
    if (!unknownConcept) for (const c of candidates) if (out.length < 3 && !out.includes(c.i) && sharesName(c.i)) out.push(c.i);
    // A described situation: the topics whose text shares most of its words.
    if (described && !out.length) for (const c of [...candidates].sort((a, b) => (b.body || 0) - (a.body || 0))) if (out.length < 2 && (c.body || 0) >= 0.15) out.push(c.i);
    return { topics: out, hubs: out.length ? [] : this.hubs.filter(i => !out.includes(i)).slice(0, 3) };
  }

  /**
   * Ground one analyzed clause.
   * @param {object} clause - analyzeClause() result
   * @param {{discourse:import('./discourse.js').DiscourseState, candidates:Array<{i:number, s:number}>,
   *   recent:number[], previousQtype?:string, denseTop?:{i:number, s:number}|null}} ctx
   */
  assess(clause, ctx) {
    const { discourse } = ctx;
    const cal = this.calibration;
    const evidence = this.focusEvidence(clause);
    const result = { clause, evidence, links: [], resolved: [], topics: [], decision: 'answer', mentions: [], pivots: null, modifier: null, otherBot: null, roles: {}, caveats: [] };
    if (clause.meta) { result.decision = 'meta'; return result; }

    // Stage 1: names.
    const links = this.link(clause.tokens, clause.text).map(l => ({ ...l, span: l.notation ? [0, 0] : [clause.tokens[l.start].start, clause.tokens[l.end - 1].end] }));
    result.links = links;
    clause.links = links;
    // Words inside a topic's own name ("Bellman equation", "Example selection") are not question cues.
    const cueTypes = ['formula', 'example', 'application', 'compare', 'relation', 'define', 'how', 'list'];
    if (links.some(l => !l.notation) && cueTypes.includes(clause.qtype)) {
      let masked = clause.text;
      for (const l of [...links].filter(l => !l.notation).sort((a, b) => b.span[0] - a.span[0])) masked = masked.slice(0, l.span[0]) + 'X' + masked.slice(l.span[1]);
      const again = classifyQtype(masked);
      if (cueTypes.includes(again)) clause.qtype = again;
    }

    // A modifier the knowledge base never pairs with a topic name turns it into
    // another concept ("quantum game theory", "Dutch auction").
    const specs = SPECIALIZING_QTYPES.has(clause.qtype) ? links.map(l => this.specialization(clause, evidence, l)).filter(Boolean) : [];
    const specialized = new Set(specs.map(x => x.index));
    const named = [];
    for (const l of links) if (!named.includes(l.alias.index) && !specialized.has(l.alias.index)) named.push(l.alias.index);

    // Stage 2: references. A pronoun whose kind matches a topic named in the same
    // clause refers to it; "the Mu'tazila and their theology" has a local antecedent.
    const resolved = [];
    const kinds = this.lexicon.kinds;
    const namedKinds = new Set(named.map(i => (kinds[i] === 'person' ? 'person' : 'thing')));
    for (const a of clause.anaphora) {
      const kind = a.kind === 'person' ? 'person' : 'thing';
      if (a.kind !== 'ordinal' && !['compare', 'relation'].includes(clause.qtype) && (namedKinds.has(kind) || a.kind === 'plural' && named.length)) continue;
      if (this.localAntecedent(clause, a, evidence)) continue;
      const found = discourse.resolve(a, { recent: ctx.recent, exclude: named });
      // Bridging: "its memory" after WebAssembly means the topic named "memory" that belongs to it.
      const bridged = this.bridgeReference(clause, a, found[0]);
      for (const i of bridged != null ? [bridged, ...found] : found) if (!resolved.includes(i) && !named.includes(i)) resolved.push(i);
    }
    result.resolved = resolved;

    // In comparisons every named side counts, even a broad one ("…versus reinforcement learning").
    const comparing = clause.qtype === 'compare' || clause.qtype === 'relation';
    // "X, and also Y": each conjunct is its own referring expression.
    const conjuncts = this.conjuncts(clause, evidence);
    const coordinated = l => conjuncts.length > 1 && links.some(m => m !== l && conjuncts.findIndex(c => c.some(t => t.start >= l.span[0] && t.end <= l.span[1])) !== conjuncts.findIndex(c => c.some(t => t.start >= m.span[0] && t.end <= m.span[1])));
    const specificLinks = links.filter(l => !specialized.has(l.alias.index) && (comparing || coordinated(l) || !l.alias.generic || l.quality === 1 && evidence.filter(t => !t.generic).length <= 1));
    let topics = [...resolved, ...specificLinks.map(l => l.alias.index)].filter((i, k, a) => a.indexOf(i) === k);
    if (!specificLinks.length && !specs.length && links.length) topics.push(...links.map(l => l.alias.index).filter(i => !topics.includes(i)));
    for (const i of resolved) result.roles[i] = 'reference';
    for (const l of links) if (!specialized.has(l.alias.index)) result.roles[l.alias.index] = result.roles[l.alias.index] || 'named';
    // A conjunct without a name match is grounded to the topic whose own name accounts for all its words.
    for (const seg of conjuncts.length > 1 ? conjuncts : []) {
      if (seg.some(t => links.some(l => t.start >= l.span[0] && t.end <= l.span[1]))) continue;
      const spec = seg.filter(t => !t.generic && t.explained);
      if (!spec.length) continue;
      let found = null;
      this.lexicon.entryNameStems.forEach((names, i) => {
        if (topics.includes(i) || specialized.has(i) || !spec.every(t => names.has(t.explained))) return;
        if (!found || names.size < this.lexicon.entryNameStems[found].size) found = i;
      });
      if (found != null) { topics.push(found); result.roles[found] = 'named'; }
    }

    if ((clause.task === 'action' || clause.task === 'personal') && !specificLinks.length) {
      result.decision = 'offdomain';
      result.pivots = this.pivots([], [], discourse);
      return result;
    }
    // Generic one-word names alone ("matrix") do not settle the topic when the
    // question has other specific words; let retrieval weigh them.
    if (!specificLinks.length && !resolved.length && !specs.length && evidence.filter(t => !t.generic).length > 1) topics = [];
    topics = this.orderTopics(clause, evidence, topics, links);

    // Stage 3: evidence accounting.
    const cov = this.coverage(evidence, topics, links);
    result.coverage = cov;
    const head = this.headPhrase(clause, evidence);
    result.head = head;

    if (specs.length && !topics.length) {
      result.decision = 'specialization';
      result.modifier = specs[0];
      result.topics = [specs[0].index];
      return result;
    }
    result.caveats = specs;
    // The asked-about head ("Cramer's rule" in "Cramer's rule for solving
    // systems") is not one of the named topics and is unknown: say so.
    if (topics.length && head && NOUN_QTYPES.has(clause.qtype) && !links.some(l => l.span[0] < head.end && head.start < l.span[1]) && (head.oov || head.novel)) {
      result.caveats = [...specs, { index: topics[0], text: head.text, head: true }];
    }
    // A common one-word topic name ("vector") is one piece of evidence: when the
    // rest of a longer description fits another topic much better, that topic wins.
    const commonName = l => l.end - l.start === 1 && (this.lexicon.df.get(l.alias.stems[0]) || 0) / Math.max(1, this.KB.length) >= 0.33;
    if (topics.length === 1 && !resolved.length && specificLinks.length === 1 && commonName(specificLinks[0]) && evidence.filter(t => !t.generic).length >= 3) {
      const own = this.coverage(evidence, topics, links).core;
      const rival = (ctx.candidates || []).slice(0, 10).filter(c => c.i !== topics[0]).map(c => ({ i: c.i, core: this.coverage(evidence, [c.i]).core })).sort((a, b) => b.core - a.core)[0];
      if (rival && rival.core >= own + 0.2) { topics = [rival.i]; result.roles = { [rival.i]: 'retrieved' }; }
    }
    if (topics.length) {
      // Generic single-word aliases ("state", "model") are weak evidence next to unknown specific words.
      if (!specificLinks.length && !resolved.length && cov.oovShare >= cal.oovShare) {
        topics = [];
      } else {
        // Words left unexplained by the named topics may name one more topic ("…as well as the Maragha observatory").
        const extra = this.residual(cov.uncovered, topics, ctx.candidates || []);
        if (extra != null) { topics.push(extra); result.roles[extra] = 'residual'; }
        result.topics = topics.slice(0, 3);
        result.decision = 'answer';
        return result;
      }
    }

    const content = evidence.filter(t => !t.generic);
    // "What does Q-learning do?" in another assistant: its words are generic here, its name is exact there.
    if (!topics.length && this.foreign.length && !['live', 'action', 'personal'].includes(clause.task)) {
      const early = this.routeElsewhere(clause, evidence);
      if (early?.exact && !content.some(t => t.explained && this.lexicon.idf(t.explained) >= 2 && !early.covers?.includes(t.start))) { result.decision = 'otherbot'; result.otherBot = early; return result; }
    }
    if (!content.length) {
      // Nothing specific asked: about the topic of an earlier clause, the current topic, or small talk.
      const current = ctx.recent?.length ? ctx.recent[ctx.recent.length - 1] : discourse.currentTopic;
      if (current != null && clause.qtype !== 'other') { result.topics = [current]; result.roles[current] = 'context'; result.decision = 'answer'; return result; }
      result.decision = evidence.length ? 'offdomain' : 'empty';
      result.pivots = this.pivots(evidence, ctx.candidates || [], discourse);
      return result;
    }

    // Stage 4: retrieval candidates, scored by how much of the question they
    // explain, with the conversation's topic belief as a prior (MAP choice).
    // The more specific the question, the less the prior matters; with
    // sentence embeddings loaded, semantic similarity is evidence too.
    const priorWeight = 0.3 * Math.min(1, 2 / Math.max(1, content.length));
    const scored = (ctx.candidates || []).slice(0, 10).map((c, rank) => {
      const cv = this.coverage(evidence, [c.i]);
      const prior = discourse.weight(c.i);
      const semantic = ctx.semantic && c.dense != null ? 0.5 * Math.max(0, c.dense - 0.3) : 0;
      return { i: c.i, s: c.s, rank, core: cv.core, body: cv.body, prior, dense: c.dense, score: cv.core + priorWeight * prior + semantic, cv };
    });
    scored.sort((a, b) => b.score - a.score || b.body - a.body || a.rank - b.rank);
    let best = scored[0] || null;
    // Clause continuity: a later part of the same message without a topic of its
    // own ("Please give the strict and the weak distinction.") continues the topic
    // just answered, unless another topic fits it clearly better.
    const previous = ctx.recent?.length ? ctx.recent[ctx.recent.length - 1] : null;
    if (previous != null) {
      const own = this.coverage(evidence, [previous]);
      const fits = own.body >= 0.3 || (content.length <= 3 && content.some(t => t.explained && this.lexicon.entryStems[previous].has(t.explained)));
      if (fits && !(best && best.i !== previous && best.core >= own.core + 0.3)) {
        result.topics = [previous];
        result.roles[previous] = 'context';
        result.decision = 'answer';
        return result;
      }
    }
    result.best = best;
    const oovShare = cov.oovShare;
    // Unknown words weigh most in short "what is X" questions; descriptions of a
    // situation ("why does my page freeze…") naturally use words the notes lack.
    // Conditionals and first-person situations ("if my agent…") describe, they do not name a concept.
    const situational = clause.descriptive || /^(?:if|when|suppose|imagine|say|assume)\b/i.test(clause.text) || /\b(?:my|our|your|i|we|i'm|im|i've)\b/i.test(clause.text);
    result.situational = situational;
    const conceptual = !situational && content.length <= 4 && (CONCEPT_QTYPES.has(clause.qtype) || (clause.qtype === 'how' && /\bwork(?:s|ing)?\b/i.test(clause.text)));
    // In a described situation, unknown ordinary words are expected; only unknown
    // names (acronyms, CamelCase, digits, mid-sentence capitals) say a concept is missing.
    const unknownName = content.some(t => t.oov && this.looksLikeName(clause, t));
    const oovLimit = conceptual ? Math.min(0.6, cal.oovShare + 0.05 * Math.max(0, content.length - 3)) : unknownName ? 0.6 : 1.01;
    // A described situation ("why does my page freeze…") can be answered from a topic's body, not only its overview.
    if (!conceptual) for (const c of scored) c.core = Math.max(c.core, 0.85 * c.body);
    const novel = this.novelCompound(clause, evidence, best) || (head && head.novel && best && !this.coverage(head.tokens, [best.i]).body ? { index: null, head: null, text: head.text } : null);
    const headMissed = head && best && !head.oov && this.coverage(head.tokens, [best.i]).body < 0.5;
    // An exact multi-word phrase found in another topic's text ("symmetric
    // matrices") outranks a broad one-word match on the best topic's name.
    const phrase = best && !headMissed ? this.phraseElsewhere(clause, evidence, best.i) : null;
    // A paraphrase that only the semantic model understands still counts, unless
    // a short concept question contains unknown specific words.
    const denseRescue = ctx.denseTop && best && ctx.denseTop.i === best.i && ctx.denseTop.s >= 0.6 && (oovShare === 0 || (!conceptual && oovShare < oovLimit));
    const other = this.foreign.length ? this.routeElsewhere(clause, evidence) : null;
    // Another assistant with this exact topic beats a match on incidental words
    // here, and so does any exact name there when nothing here can answer.
    const nameCovers = best && content.every(t => t.explained && this.lexicon.entryNameStems[best.i].has(t.explained));
    const weakHere = !best || best.core < cal.weak || oovShare >= oovLimit ||
      (other?.exact && other.covers && !evidence.filter(t => other.covers.includes(t.start) && t.explained).some(t => this.coreStems[best.i].has(t.explained)));
    const routable = other && !['live', 'action', 'personal'].includes(clause.task);
    if (routable && !nameCovers && (other.share >= 0.9 || (other.exact && (weakHere || other.unknownInside)))) { result.decision = 'otherbot'; result.otherBot = other; return result; }

    if (!novel && !headMissed && !phrase && oovShare < oovLimit && best && (best.core >= cal.answer || denseRescue)) {
      result.topics = [best.i];
      const second = scored[1];
      if ((clause.qtype === 'compare' || clause.qtype === 'relation') && second && second.core >= cal.weak) result.topics.push(second.i);
      result.decision = 'answer';
      return result;
    }
    if (novel?.head != null) {
      result.decision = 'specialization';
      result.modifier = novel;
      result.topics = [novel.head];
      return result;
    }
    const tailUnknown = head && evidence.some(t => t.oov && !head.tokens.includes(t));
    const mentionEvidence = phrase ? phrase.tokens : (headMissed || (head && head.novel)) && !tailUnknown ? head.tokens : evidence;
    const mentions = mentionEvidence.every(t => !t.oov) ? this.findMentions(mentionEvidence) : [];
    if (phrase && mentions.length) result.phrase = phrase.text;
    if (mentions.length && (!best || best.body >= cal.mention || mentions[0].index !== best.i || best.core < cal.answer || novel || headMissed)) {
      result.decision = 'mention';
      result.mentions = mentions;
      result.topics = [mentions[0].index];
      return result;
    }
    const meaningful = best && content.some(t => t.explained && this.lexicon.idf(t.explained) >= 2 && this.coreStems[best.i].has(t.explained));
    const weakFloor = conceptual ? cal.weak : 0.55 * cal.weak;
    const sharesText = !conceptual && best && best.body >= 0.3;
    if (!novel && !headMissed && meaningful && (oovShare < oovLimit || sharesText) && best.core >= weakFloor) {
      result.topics = [best.i];
      result.decision = 'weak';
      return result;
    }
    // Neural matching: a description the words alone could not place, whose
    // meaning is clearly closest to one topic (MiniLM cosine ≥ 0.55 with a margin;
    // measured on the development sets: 54% of covered questions, 1.9% of others).
    // Unknown names, new terms and concept questions with unknown words veto it,
    // and the reply is framed as the closest match.
    const vetoed = novel || unknownName || (conceptual && oovShare >= cal.oovShare) || ['live', 'action', 'personal'].includes(clause.task);
    if (ctx.semantic && !vetoed) {
      const dense = (ctx.candidates || []).filter(c => Number.isFinite(c.dense)).sort((a, b) => b.dense - a.dense);
      const [top, runner] = dense;
      if (top && top.dense >= SEMANTIC_ACCEPT && (!runner || top.dense - runner.dense >= 0.03)) {
        const cv = this.coverage(evidence, [top.i]);
        result.best = { i: top.i, core: cv.core, body: cv.body, cv };
        result.topics = [top.i];
        result.decision = 'weak';
        result.semantic = true;
        return result;
      }
    }
    if (routable) { result.decision = 'otherbot'; result.otherBot = other; return result; }
    if (head && (headMissed || head.novel)) result.phrase = head.text;
    else if (novel) result.phrase = novel.text;
    // For a clearly new term, word overlap with other topics is no basis for "closest".
    result.pivots = this.pivots(evidence, scored, discourse, situational && !result.phrase);
    // In-domain gap or a different subject altogether? If not a single word of
    // the question (even a common one like "normal" or "process") occurs in
    // this knowledge base, the question is about something else entirely.
    const touchesDomain = evidence.some(t => t.explained);
    result.decision = touchesDomain && clause.task !== 'live' ? 'unknown' : 'offdomain';
    return result;
  }

  /**
   * Split the question's words at coordination ("and also", "as well as",
   * "plus", commas). Returns the groups of evidence tokens, or one group.
   */
  conjuncts(clause, evidence) {
    const toks = clause.tokens;
    const breaks = new Set();
    for (let k = 1; k < toks.length; k++) {
      const between = clause.text.slice(toks[k - 1].end, toks[k].start);
      if (/,|;/.test(between)) breaks.add(k);
      if (['and', 'or', 'plus'].includes(toks[k].w) || (toks[k].w === 'as' && toks[k + 1]?.w === 'well' && toks[k + 2]?.w === 'as') || (toks[k].w === 'along' && toks[k + 1]?.w === 'with')) breaks.add(k);
    }
    if (!breaks.size) return [evidence];
    const groups = [];
    let current = [];
    for (let k = 0; k < toks.length; k++) {
      if (breaks.has(k) && current.length) { groups.push(current); current = []; }
      const ev = evidence.find(e => e.start === toks[k].start);
      if (ev) current.push(ev);
    }
    if (current.length) groups.push(current);
    return groups.filter(g => g.length);
  }

  /**
   * The head of a focus phrase with a prepositional tail: "trace" in "trace of
   * a matrix", "Cramer's rule" in "Cramer's rule for solving systems". Null
   * when the focus has no such structure.
   */
  headPhrase(clause, evidence) {
    if (!clause.framed || evidence.length < 2 || evidence.length > 6) return null;
    const toks = clause.tokens;
    const first = toks.findIndex(t => t.start === evidence[0].start);
    let cut = -1;
    const inName = k => (clause.links || []).some(l => !l.notation && toks[k].start >= l.span[0] && toks[k].end <= l.span[1]);
    for (let k = first + 1; k < toks.length; k++) {
      if (PREPOSITIONS.has(toks[k].w) && !inName(k)) { cut = toks[k].start; break; }
      const inFocus = evidence.some(e => e.start === toks[k].start);
      // A verb or clause word ("does", "when", "that") ends the noun phrase.
      if (!inFocus && !NP_GLUE.has(toks[k].w)) break;
    }
    if (cut < 0) return null;
    const tokens = evidence.filter(e => e.end <= cut && !e.generic);
    if (!tokens.length || tokens.length > 3) return null;
    const start = tokens[0].start, end = tokens[tokens.length - 1].end;
    const text = clause.text.slice(start, end);
    if (!/^[\w\s'-]{2,40}$/.test(text)) return null;
    const oov = tokens.some(t => t.oov);
    const novel = !oov && tokens.length === 2 && !this.lexicon.adjacent(tokens[0].explained, tokens[1].explained);
    return { tokens, text, start, end, oov, novel };
  }

  /** An adjacent pair of question words that the knowledge base uses together, but not in `topic`'s core text. */
  phraseElsewhere(clause, evidence, topic) {
    const toks = clause.tokens;
    for (let k = 0; k + 1 < evidence.length; k++) {
      const a = evidence[k], b = evidence[k + 1];
      if (a.generic || b.generic || !a.explained || !b.explained) continue;
      if (toks.findIndex(t => t.start === b.start) !== toks.findIndex(t => t.start === a.start) + 1) continue;
      if (!this.lexicon.adjacent(a.explained, b.explained)) continue;
      const core = this.coreStems[topic];
      if (core.has(a.explained) && core.has(b.explained)) return null;
      return { tokens: [a, b], text: clause.text.slice(a.start, b.end) };
    }
    return null;
  }

  /**
   * Order the topics of a clause: the possessed noun in "Avicenna's Canon of
   * Medicine" first; otherwise the topic that explains most of the question.
   * Comparisons keep the order the user gave.
   */
  orderTopics(clause, evidence, topics, links) {
    if (topics.length < 2 || clause.qtype === 'compare' || clause.qtype === 'relation') return topics;
    const pos = new Map(links.map(l => [l.alias.index, l.span[0]]));
    const possessed = new Set();
    for (const l of links) {
      const after = clause.text.slice(l.span[1], l.span[1] + 3);
      if (/^['’]s?\s/.test(after)) for (const m of links) if (m.span[0] > l.span[1] && m.span[0] <= l.span[1] + 4) possessed.add(m.alias.index);
    }
    const head = this.headPhrase(clause, evidence);
    const headShare = new Map(topics.map(i => [i, head ? this.coverage(head.tokens, [i], links).core : 0]));
    const share = new Map(topics.map(i => [i, this.coverage(evidence, [i], links).body]));
    return [...topics].sort((a, b) => Number(possessed.has(b)) - Number(possessed.has(a)) || (headShare.get(b) - headShare.get(a)) || (share.get(b) - share.get(a)) || ((pos.get(a) ?? -1) - (pos.get(b) ?? -1)));
  }

  /** An unknown token typed like a name: "PPO", "localStorage", "float32", "Kubernetes" mid-sentence. */
  looksLikeName(clause, token) {
    const surface = clause.text.slice(token.start, token.end);
    return /[a-z][A-Z]|^[A-Z0-9]{2,}$|\d/.test(surface) || (token.cap && token.start > 0 && !/[.!?]\s*$/.test(clause.text.slice(0, token.start)));
  }

  /**
   * Bridging reference: a possessive pronoun followed by a noun that names a
   * different topic ("its memory", "his algebra") points to that topic,
   * preferring one related to the possessor.
   */
  bridgeReference(clause, anaphor, owner) {
    if (owner == null || !['its', 'his', 'her', 'their'].includes(anaphor.word)) return null;
    const toks = clause.tokens;
    const at = toks.findIndex(t => t.start === anaphor.start);
    const noun = toks[at + 1];
    if (!noun || STOPWORDS.has(noun.w) || isGenericWord(noun.w) || ASPECT_WORDS.has(noun.w)) return null;
    const related = new Set((this.KB[owner].related || []).map(id => this.KB.findIndex(e => e.id === id)));
    const named = this.lexicon.entryNameStems.map((n, i) => (i !== owner && n.has(noun.stem) ? i : -1)).filter(i => i >= 0);
    if (!named.length) return null;
    return named.find(i => related.has(i) || (this.KB[i].related || []).includes(this.KB[owner].id)) ?? (named.length === 1 ? named[0] : null);
  }

  /**
   * "his"/"its"/"their" right after "and"/"with"/"of" usually points back to a
   * noun phrase in the same clause ("the Mu'tazila and their theology").
   */
  localAntecedent(clause, anaphor, evidence) {
    if (!['his', 'her', 'its', 'their'].includes(anaphor.word)) return false;
    const toks = clause.tokens;
    const at = toks.findIndex(t => t.start === anaphor.start);
    if (at < 2 || !['and', 'with', 'of', 'in'].includes(toks[at - 1].w)) return false;
    return evidence.some(e => e.end <= toks[at - 1].start && !e.generic);
  }

  /**
   * Unexplained words that name another topic: only accepted when that topic's
   * own name or aliases account for nearly all of them.
   */
  residual(uncovered, topics, candidates) {
    const left = uncovered.filter(t => t.explained);
    if (!left.length || left.length > 3) return null;
    const mass = left.reduce((n, t) => n + t.weight, 0);
    let best = null;
    for (const c of candidates.slice(0, 10)) {
      if (topics.includes(c.i)) continue;
      const names = this.lexicon.entryNameStems[c.i];
      const core = this.coreStems[c.i];
      const hit = left.reduce((n, t) => n + (names.has(t.explained) ? t.weight : core.has(t.explained) ? 0.6 * t.weight : 0), 0) / mass;
      const named = left.some(t => names.has(t.explained) && this.lexicon.idf(t.explained) >= 2);
      if (named && hit >= 0.8 && (!best || hit > best.hit)) best = { i: c.i, hit };
    }
    return best ? best.i : null;
  }

  /**
   * A two-word term ("learning rate", "log loss") whose words never occur next
   * to each other anywhere in the knowledge base is a concept the notes do not
   * contain, even though each word is familiar. If the second word is part of a
   * topic's name ("Dutch auction" → Auction Theory), that topic is the nearest
   * known generalization.
   */
  novelCompound(clause, evidence, best) {
    const toks = clause.tokens;
    // Hyphenated terms straight from the text, so "t-test" counts even though "t" is a stopword.
    for (const m of clause.text.matchAll(/\b([A-Za-z0-9]+)-([A-Za-z][A-Za-z0-9]+)\b/g)) {
      const [a, b] = [wordTokens(m[1])[0], wordTokens(m[2])[0]];
      if (!a || !b || STOPWORDS.has(b.w) || isGenericWord(b.w) && !this.lexicon.hasStem(b.stem)) continue;
      if (!this.lexicon.hasStem(b.stem) || this.lexicon.adjacent(a.stem, b.stem) || this.lexicon.surface.has(a.w + b.w)) continue;
      if (this.aliases.some(al => al.joined === a.w + b.w)) continue;
      if (a.w.length > 1 && !this.lexicon.hasStem(a.stem)) continue;
      return { index: null, head: null, text: m[0], modifiers: [a.w] };
    }
    // A hyphenated term ("R-squared", "log-loss") the notes never use is new in any kind of question.
    for (let k = 0; k + 1 < evidence.length; k++) {
      const a = evidence[k], b = evidence[k + 1];
      if (clause.text.slice(a.end, b.start) !== '-' || a.oov || b.oov || !b.explained) continue;
      if (this.lexicon.adjacent(a.explained || a.stem, b.explained) || this.lexicon.surface.has(a.w + b.w)) continue;
      return { index: null, head: null, text: clause.text.slice(a.start, b.end), modifiers: [a.w] };
    }
    const words = evidence.filter(t => !STOPWORDS.has(t.w));
    if (words.length !== 2 || !SPECIALIZING_QTYPES.has(clause.qtype)) return null;
    const [a, b] = words;
    const ia = toks.findIndex(t => t.start === a.start), ib = toks.findIndex(t => t.start === b.start);
    if (ib !== ia + 1 || !b.explained || isGenericWord(b.w) && !this.lexicon.hasStem(b.stem)) return null;
    const sa = a.explained || a.stem;
    if (this.lexicon.adjacent(sa, b.explained) || this.lexicon.surface.has(a.w + b.w)) return null;
    if (a.generic && !this.lexicon.hasStem(a.stem)) return null;
    const text = clause.text.slice(a.start, b.end);
    if (!/^[\w\s'-]{3,40}$/.test(text)) return null;
    // Only a distinctive head word ("auction", not "game") makes a topic the nearest generalization.
    const namesWithHead = this.lexicon.entryNameStems.filter(n => n.has(b.explained)).length;
    const head = best && namesWithHead <= 2 && this.lexicon.entryNameStems[best.i].has(b.explained) && !this.lexicon.entryNameStems[best.i].has(sa) ? best.i : null;
    return { index: head, head, text, modifiers: [a.w] };
  }

  /**
   * "quantum game theory", "inverse reinforcement learning", "Kalai–Smorodinsky
   * bargaining solution": a known topic name preceded by a specific modifier
   * that never appears next to it, or in that topic's text, anywhere in the
   * knowledge base. Generic words never count.
   */
  specialization(clause, evidence, link) {
    if (!link || link.notation) return null;
    const tokens = clause.tokens;
    const mods = [];
    for (let k = link.start - 1; k >= 0 && mods.length < 2; k--) {
      const t = tokens[k];
      if (STOPWORDS.has(t.w) || RELATION_WORDS.has(t.w)) break;
      if (clause.anaphora.some(a => t.start >= a.start && t.end <= a.end)) break;
      mods.unshift(t);
    }
    if (!mods.length) {
      // "WebAssembly SIMD": an unknown word right after a topic name.
      const next = tokens[link.end];
      const ev = next && evidence.find(e => e.start === next.start);
      if (!ev || !ev.oov || ev.generic || /\d/.test(next.w)) return null;
      const after = clause.text.slice(next.end).trim();
      if (after && !/^[,;:?!.]/.test(after)) return null;
      const text = clause.text.slice(tokens[link.start].start, next.end);
      return /^[\w\s'-]{3,60}$/.test(text) ? { index: link.alias.index, text, modifiers: [next.w] } : null;
    }
    const anchor = link.alias.stems[0];
    const index = link.alias.index;
    for (const m of mods) {
      const ev = evidence.find(e => e.start === m.start);
      if (!ev || ev.generic || /\d/.test(m.w)) return null;
      if (ev.explained && (this.lexicon.entryStems[index].has(ev.explained) || this.lexicon.adjacent(ev.explained, anchor))) return null;
      if (!ev.oov && this.lexicon.idf(ev.explained) < 2.2) return null;
    }
    const text = clause.text.slice(mods[0].start, tokens[link.end - 1].end);
    if (!/^[\w\s'-]{3,60}$/.test(text)) return null;
    return { index, text, modifiers: mods.map(m => m.w) };
  }

  /**
   * Another assistant's topic that covers what this one does not know. Only the
   * question's unexplained specific words are weighed, so "How does IndexedDB
   * store data in the browser?" routes on "IndexedDB" alone.
   */
  routeElsewhere(clause, evidence) {
    const links = this.link(clause.tokens, clause.text, this.foreign);
    if (!links.length) return null;
    const unknown = evidence.filter(t => !t.generic && !/\d/.test(t.w) && !(t.explained && this.lexicon.idf(t.explained) < 2));
    const pool = unknown.length ? unknown : evidence.filter(t => !t.generic);
    const mass = pool.reduce((n, t) => n + t.weight, 0) || 1;
    let best = null;
    for (const l of links) {
      const span = [clause.tokens[l.start].start, clause.tokens[l.end - 1].end];
      const inside = evidence.filter(t => t.start >= span[0] && t.end <= span[1]);
      const covered = pool.filter(t => t.start >= span[0] && t.end <= span[1]).reduce((n, t) => n + t.weight, 0);
      const share = covered / mass;
      // An exact, specific name (not one generic word) is enough when this assistant has no answer.
      // Multi-word names only: a single everyday word ("forecast", "laptop") must instead cover most of the question.
      const exactPhrase = m => m.quality === 1 && m.end - m.start > 1 && m.alias.joined.length >= 5;
      // One technical word also counts: CamelCase or acronyms as typed ("IndexedDB"), or a long word unknown here.
      const surface = clause.text.slice(clause.tokens[l.start].start, clause.tokens[l.end - 1].end);
      const nameHere = inside.some(t => t.explained && this.lexicon.entryNameStems.some(n => n.has(t.explained)));
      const technical = l.end - l.start === 1 && l.quality === 1 && !nameHere &&
        ((inside.some(t => t.oov) && (/[a-z][A-Z]|[A-Z]{2,}/.test(surface) || surface.length >= 8)) || (surface.toLowerCase() === String(l.alias.topic.name).toLowerCase() && surface.length >= 8));
      const exact = exactPhrase(l) || technical;
      // A named concept this knowledge base never uses as a phrase ("null space" in game theory) belongs elsewhere.
      const toks = clause.tokens.slice(l.start, l.end).filter(t => !STOPWORDS.has(t.w));
      const foreignPhrase = toks.length > 1 && toks.some((t, k) => k > 0 && !this.lexicon.adjacent(toks[k - 1].stem, t.stem));
      const unknownInside = inside.some(t => t.oov) || (exactPhrase(l) && foreignPhrase);
      if ((share >= 0.6 && l.quality >= 0.85 || exact) && (!best || share > best.share)) best = { share, exact, unknownInside, covers: inside.map(t => t.start), bot: l.alias.bot, topic: l.alias.topic };
    }
    return best;
  }
}

/** PageRank over the related-topic graph; returns topic indices by centrality. */
export function pageRank(KB, damping = 0.85, iterations = 40) {
  const N = KB.length;
  if (!N) return [];
  const index = new Map(KB.map((e, i) => [e.id, i]));
  const out = KB.map(e => (e.related || []).map(id => index.get(id)).filter(j => j !== undefined));
  let rank = new Float64Array(N).fill(1 / N);
  for (let it = 0; it < iterations; it++) {
    const next = new Float64Array(N).fill((1 - damping) / N);
    let dangling = 0;
    for (let i = 0; i < N; i++) {
      if (!out[i].length) { dangling += rank[i]; continue; }
      for (const j of out[i]) next[j] += (damping * rank[i]) / out[i].length;
    }
    for (let j = 0; j < N; j++) next[j] += (damping * dangling) / N;
    rank = next;
  }
  return [...rank.keys()].sort((a, b) => rank[b] - rank[a] || a - b);
}
