/**
 * answer-planner.js — Choosing and ordering what to say
 *
 * Every curated fragment of a topic is a node in a lattice. A beam search
 * (Viterbi decoding with a small beam, as in speech recognition) picks the
 * ordered subset of fragments that maximizes
 *
 *   Σ emission(unit) + Σ transition(previous unit → unit)
 *
 * emission    evidence that the unit answers this question: weighted overlap
 *             with the question's own words, answer-type cues (years for
 *             "when", causal connectives for "why", worked numbers for
 *             examples), a prior for the question type, centrality within
 *             the topic (TextRank), and novelty: fragments this conversation
 *             already showed are penalized (maximal marginal relevance).
 * transition  discourse coherence between categories (definition → intuition
 *             → example reads naturally; example → definition does not),
 *             lexical cohesion with the previous unit, a heavy penalty for
 *             near-duplicates, and the rule that "Equivalently…"/"This…"
 *             sentences follow their antecedent.
 *
 * extract() answers specific questions first (who, when, where, how many,
 * yes/no, why, how two topics relate) by locating the sentence that carries
 * the requested kind of information. When no sentence does, it says so and the
 * caller falls back to the explanation instead of inventing an answer.
 */

import { wordTokens, isGenericWord } from './lexicon.js';

const CATS = ['summary', 'def', 'int', 'ex', 'form', 'app'];

// How well a category serves each kind of question (0–1).
const PRIOR = {
  define: { summary: 1, def: 0.85, int: 0.7, ex: 0.55, form: 0.25, app: 0.35 },
  other: { summary: 1, def: 0.85, int: 0.7, ex: 0.55, form: 0.25, app: 0.35 },
  example: { summary: 0.3, def: 0.3, int: 0.45, ex: 1, form: 0.25, app: 0.5 },
  formula: { summary: 0.35, def: 0.6, int: 0.35, ex: 0.45, form: 1, app: 0.2 },
  application: { summary: 0.35, def: 0.3, int: 0.45, ex: 0.55, form: 0.15, app: 1 },
  why: { summary: 0.4, def: 0.45, int: 0.9, ex: 0.45, form: 0.6, app: 0.55 },
  how: { summary: 0.45, def: 0.5, int: 0.75, ex: 0.8, form: 0.65, app: 0.35 },
  compare: { summary: 0.9, def: 0.75, int: 0.7, ex: 0.45, form: 0.3, app: 0.35 },
  relation: { summary: 0.7, def: 0.6, int: 0.7, ex: 0.45, form: 0.4, app: 0.45 },
  yesno: { summary: 0.55, def: 0.6, int: 0.7, ex: 0.5, form: 0.5, app: 0.45 },
  who: { summary: 0.8, def: 0.8, int: 0.5, ex: 0.55, form: 0.5, app: 0.45 },
  when: { summary: 0.7, def: 0.8, int: 0.45, ex: 0.55, form: 0.45, app: 0.45 },
  where: { summary: 0.7, def: 0.8, int: 0.45, ex: 0.55, form: 0.4, app: 0.5 },
  howmany: { summary: 0.6, def: 0.7, int: 0.5, ex: 0.6, form: 0.5, app: 0.45 },
  list: { summary: 0.8, def: 0.7, int: 0.55, ex: 0.7, form: 0.3, app: 0.6 },
  condition: { summary: 0.5, def: 0.75, int: 0.7, ex: 0.5, form: 0.55, app: 0.75 },
};

// Discourse coherence of placing category B right after category A.
const TRANSITION = {
  summary: { def: 0.15, int: 0.45, ex: 0.35, form: 0.2, app: 0.25 },
  def: { def: -0.15, int: 0.45, ex: 0.35, form: 0.3, app: 0.2, summary: -0.6 },
  int: { def: -0.25, int: -0.15, ex: 0.45, form: 0.3, app: 0.25, summary: -0.6 },
  ex: { def: -0.4, int: 0.05, ex: -0.05, form: 0.25, app: 0.3, summary: -0.6 },
  form: { def: -0.3, int: 0.1, ex: 0.3, form: -0.1, app: 0.3, summary: -0.6 },
  app: { def: -0.4, int: -0.05, ex: 0.25, form: -0.1, app: -0.15, summary: -0.6 },
};

const CUES = {
  when: /\b(?:c\.\s*)?(?:[1-9]\d{2,3})(?:\s*[–-]\s*(?:c\.\s*)?\d{3,4})?\s*(?:CE|BCE|AD|BC|AH)?\b(?!\s*(?:years?|days?|months?|times|%|percent|pages?|people|volumes|chapters|stars|degrees|km|miles|mills|books|works|x\b))|\b(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth)[- ]centur(?:y|ies)\b|\b\d{3}0s\b/i,
  where: /\b(?:in|at|from|to|across|throughout|near)\s+(?:the\s+)?(?:city of\s+)?[A-Z][a-zA-Z'-]+/,
  howmany: /\b(?:\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|hundreds?|thousands?|millions?)\b/i,
  why: /\b(?:because|since|so that|therefore|thus|hence|which means|this means|as a result|due to|in order to|ensures?|guarantees?|so\b|lets?|allows?|prevents?|avoids?|reduces?|makes?)\b/i,
  how: /\b(?:by\b|first|then|update|updates|compute|computes|iterat|step|repeat|apply|applies|until|each|combin|estimat|replace|multipl|sum|add)/i,
  example: /\b(?:for example|for instance|e\.g\.|consider|suppose|imagine|if\b)|\d/i,
  contrast: /\b(?:unlike|whereas|while|in contrast|differs?|instead|rather than|but|however|on the other hand|compared with|compare with|versus|vs\.?)\b/i,
};
// Origin questions ("who came up with…") need an origin statement, not any sentence with a name.
const ORIGIN = /\b(?:proposed|introduced|developed|formulated|invented|discovered|coined|founded|named (?:after|by)|due to|credited to|pioneered|designed|devised|first (?:described|defined|studied|used|posed|stated)|originated|created|conceived|established)\b/i;
const ATTRIBUTION = /\b(?:proved|showed|built|wrote|described|defined|studied|translated|compiled|authored|led|ran|directed|observed|measured|calculated|corrected|improved)\b/i;
const YEAR_ATTRIBUTION = /\b[A-Z][a-zA-Z-]+(?:\s+(?:and|&)\s+[A-Z][a-zA-Z-]+)?\s+\(\s*(?:c\.\s*)?\d{3,4}/;

/** Capitalized names inside a sentence (not its first word, not single letters). */
function capitalizedNames(sentence) {
  const names = [];
  const re = /(?<=[^.!?]\s)((?:(?:al-|ibn |bin |de |von |van )?[A-Z][a-zA-Z'’-]+)(?:\s+(?:al-|ibn |bin |de |of |von |van )?[A-Z][a-zA-Z'’-]+)*)/g;
  let m;
  while ((m = re.exec(sentence))) if (m[1].replace(/['’]s$/, '').length > 1) names.push(m[1]);
  return names;
}

/** Looks like a person: a possessive name, "by/of Name", or two capitalized words. */
function personLike(sentence, names) {
  return names.some(n => /['’]s$/.test(n) || /\s/.test(n.replace(/^(?:al-|ibn |bin )/i, '')) && !/\b(?:of|the)\b/i.test(n)) ||
    /\b(?:by|from|of|to)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/.test(sentence.replace(/^\S+\s/, ''));
}

/** TextRank centrality of each unit within its topic (weighted PageRank over stem overlap). */
function textRank(units) {
  const n = units.length;
  if (n < 2) return units.map(() => 1);
  const w = units.map(a => units.map(b => {
    if (a === b) return 0;
    let shared = 0;
    for (const s of a.stems) if (b.stems.has(s)) shared++;
    return shared / (Math.log(a.stems.size + 1) + Math.log(b.stems.size + 1) + 1e-9);
  }));
  const outSum = w.map(row => row.reduce((x, y) => x + y, 0) || 1);
  let r = new Array(n).fill(1 / n);
  for (let it = 0; it < 30; it++) {
    r = r.map((_, j) => 0.15 / n + 0.85 * w.reduce((acc, row, i) => acc + (row[j] / outSum[i]) * r[i], 0));
  }
  const max = Math.max(...r) || 1;
  return r.map(x => x / max);
}

function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

export class AnswerPlanner {
  /**
   * @param {object[]} KB
   * @param {import('./lexicon.js').Lexicon} lexicon
   */
  constructor(KB, lexicon) {
    this.KB = KB;
    this.lexicon = lexicon;
    this.centrality = lexicon.units.map(textRank);
    this.nameStems = KB.map(e => [e.name, ...(e.aliases || [])].map(a => wordTokens(a).map(t => t.stem)).filter(s => s.length));
  }

  /** Weighted overlap between the question's own words and a unit or sentence (0–1). */
  overlap(stems, predicate) {
    if (!predicate.length) return 0;
    let hit = 0, total = 0;
    for (const p of predicate) {
      const w = this.lexicon.idf(p);
      total += w;
      if (stems.has(p)) hit += w;
    }
    return total ? hit / total : 0;
  }

  /**
   * Choose up to k units for one topic.
   * @param {number} topic
   * @param {{qtype:string, predicate:string[], k:number, shown:Set<string>, introduce:boolean,
   *   avoid?:Set<string>, policyIntent?:string, unitScore?:(unit:object)=>number}} opts
   * @returns {object[]} ordered units
   */
  plan(topic, opts) {
    const units = this.lexicon.units[topic] || [];
    if (!units.length) return [];
    const qtype = PRIOR[opts.qtype] ? opts.qtype : 'define';
    const prior = PRIOR[qtype];
    const policyCat = { definition: 'def', example: 'ex', formal: 'form', application: 'app', comparison: 'def' }[opts.policyIntent] || null;
    const central = this.centrality[topic];
    const avoid = opts.avoid || new Set();
    const emission = units.map((u, idx) => {
      if (avoid.has(u.id)) return -Infinity;
      let e = prior[u.cat] ?? 0.3;
      e += 0.9 * this.overlap(u.stems, opts.predicate);
      if (policyCat && u.cat === policyCat) e += 0.12;
      e += 0.12 * central[idx];
      const cue = CUES[qtype];
      if (cue && cue.test(u.text)) e += 0.2;
      if (opts.shown.has(u.id)) e -= 0.75;
      if (opts.unitScore) e += opts.unitScore(u);
      return e;
    });
    const k = Math.max(1, Math.min(opts.k, units.length));
    // Fixed first unit: a new subject starts with its overview.
    const summaryIdx = units.findIndex(u => u.cat === 'summary');
    const forced = opts.introduce && summaryIdx >= 0 && !avoid.has(units[summaryIdx].id) && !opts.shown.has(units[summaryIdx].id) ? summaryIdx : -1;
    let beam = forced >= 0
      ? [{ path: [forced], score: emission[forced] + 0.5 }]
      : units.map((u, i) => ({ path: [i], score: emission[i] - (u.dependent ? 0.6 : 0) })).filter(b => Number.isFinite(b.score));
    beam.sort((a, b) => b.score - a.score);
    beam = beam.slice(0, 6);
    let best = beam[0];
    for (let step = 1; step < k; step++) {
      const next = [];
      for (const b of beam) {
        const last = units[b.path[b.path.length - 1]];
        for (let i = 0; i < units.length; i++) {
          if (b.path.includes(i) || !Number.isFinite(emission[i])) continue;
          const u = units[i];
          let t = TRANSITION[last.cat]?.[u.cat] ?? 0;
          const sim = jaccard(last.stems, u.stems);
          t += sim > 0.6 ? -1.2 : 0.3 * sim;
          for (const p of b.path) if (jaccard(units[p].stems, u.stems) > 0.6) t -= 1.2;
          if (u.dependent) t += last.cat === u.cat && last.k === u.k - 1 ? 0.25 : -0.6;
          const gain = emission[i] + t;
          // Stop adding material that would make the answer worse, not better.
          if (gain < 0.15) continue;
          next.push({ path: [...b.path, i], score: b.score + gain });
        }
      }
      if (!next.length) break;
      next.sort((a, b) => b.score - a.score);
      beam = next.slice(0, 6);
      best = beam[0];
    }
    return (best?.path || []).map(i => units[i]);
  }

  /**
   * Find the sentence that answers a specific question about one topic.
   * @param {number} topic
   * @param {string} qtype
   * @param {string[]} predicate - question words that are not part of the topic's name
   * @returns {{unit:object, sentence:string, score:number}|null}
   */
  extract(topic, qtype, predicate, opts = {}) {
    const units = this.lexicon.units[topic] || [];
    const isPerson = this.lexicon.kinds[topic] === 'person';
    const specific = predicate.filter(p => this.lexicon.idf(p) >= 1.5);
    let best = null;
    for (const u of units) {
      for (const s of u.sentences) {
        const stems = new Set(wordTokens(s).map(t => t.stem));
        const ov = this.overlap(stems, predicate);
        let score = 0;
        if (qtype === 'when') {
          if (!CUES.when.test(s)) continue;
          score = 1 + ov;
        } else if (qtype === 'where') {
          if (!CUES.where.test(s)) continue;
          score = 0.8 + ov;
        } else if (qtype === 'howmany') {
          if (!CUES.howmany.test(s) || !specific.some(p => stems.has(p))) continue;
          const toks = wordTokens(s);
          const counted = toks.some((t, n) => specific.includes(t.stem) && toks.slice(Math.max(0, n - 3), n).some(x => /^\d+$|^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundreds?|thousands?|dozens?)$/.test(x.w)));
          score = 0.8 + ov + (counted ? 0.5 : 0);
        } else if (qtype === 'who') {
          if (isPerson && opts.identity) { score = u.cat === 'summary' ? 2 : u.cat === 'def' ? 1.5 : 0; if (!score) continue; }
          else {
            // An attribution verb counts only when the question uses it ("who proved…", "who wrote…").
            const asked = predicate.some(p => ATTRIBUTION.test(p) || stems.has(p) && ATTRIBUTION.test(s));
            const names = capitalizedNames(s).filter(n => !this.nameStems[topic].some(ns => ns.join(' ') === wordTokens(n).map(t => t.stem).join(' ')));
            const credited = ORIGIN.test(s) || YEAR_ATTRIBUTION.test(s) || (asked && ATTRIBUTION.test(s)) || (ov >= 0.5 && personLike(s, names));
            if (!credited || (!names.length && !YEAR_ATTRIBUTION.test(s))) continue;
            score = 1 + ov + (ORIGIN.test(s) ? 0.2 : 0);
          }
        } else if (qtype === 'yesno' || qtype === 'why' || qtype === 'how' || qtype === 'condition') {
          if (!specific.length) continue;
          const hits = specific.filter(p => stems.has(p)).length;
          if (!hits) continue;
          score = ov + (qtype === 'why' && CUES.why.test(s) ? 0.25 : 0) + (qtype === 'how' && CUES.how.test(s) ? 0.15 : 0);
          if (score < 0.3) continue;
        } else continue;
        if (u.cat === 'summary' || u.cat === 'def') score += 0.05;
        if (!best || score > best.score) best = { unit: u, sentence: s, score };
      }
    }
    return best;
  }

  /**
   * Sentences of topic a that name topic b (and vice versa): how the
   * knowledge base itself connects them.
   */
  bridge(a, b) {
    const out = [];
    for (const [from, to] of [[a, b], [b, a]]) {
      for (const u of this.lexicon.units[from] || []) {
        for (const s of u.sentences) {
          const toks = wordTokens(s).map(t => t.stem);
          const hit = this.nameStems[to].some(ns => ns.length && toks.some((_, p) => ns.every((x, k) => toks[p + k] === x)) && !(ns.length === 1 && isGenericWord(ns[0])));
          if (hit) out.push({ topic: from, unit: u, sentence: s, contrast: CUES.contrast.test(s) });
        }
      }
    }
    out.sort((x, y) => Number(y.contrast) - Number(x.contrast) || x.unit.sentences.length - y.unit.sentences.length);
    return out.filter((h, k) => out.findIndex(o => o.sentence === h.sentence) === k).slice(0, 2);
  }

  /** A sentence within one topic that contrasts two of its own aspects (e.g. precision vs recall). */
  contrastWithin(topic, stemsA, stemsB) {
    for (const u of this.lexicon.units[topic] || []) {
      for (const s of u.sentences) {
        const st = new Set(wordTokens(s).map(t => t.stem));
        if (stemsA.some(x => st.has(x)) && stemsB.some(x => st.has(x))) return { unit: u, sentence: s };
      }
    }
    return null;
  }
}

export { CATS };
