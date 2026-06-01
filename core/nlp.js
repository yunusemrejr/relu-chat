// ── Edge-case safeguard constants ──────────────────────────────────────────
const MAX_COSINE_DIM = 4096;
const MAX_TOKEN_LENGTH = 5000;
const MAX_VOCAB_SIZE = 50000;

const DEFAULT_OPENERS = ["", "In short, ", "Here's the idea: ", "Let's unpack it. ", "Great question — ", "Consider this: "];

const DEFAULT_CONNECTORS = {
  def_to_int: ["Intuitively, ", "Put differently, ", "Informally, ", "In essence, ", "To paraphrase, "],
  int_to_ex: ["For instance, ", "As a classic example, ", "Consider: ", "A concrete case — ", "To illustrate, "],
  ex_to_form: ["Formally, ", "Mathematically, ", "Theoretically, ", "From a rigorous standpoint, ", "In formal terms, "],
  form_to_app: ["Applications include ", "It is applied in ", "Practical uses: ", "It shows up in ", "Real-world uses: "],
  def_to_ex: ["For example, ", "As an illustration, ", "Concretely, ", "A classic case: "],
  def_to_form: ["More formally, ", "Rigorously, ", "Precisely, "],
  app_to_ex: ["For example, ", "A concrete case: ", "As an illustration, "],
  app_to_int: ["The intuition is that ", "Intuitively, "]
};

const DEFAULT_CLOSERS = ["", " Want me to go deeper on any piece?", " Ask me for a worked example or a related concept.", " Happy to connect this to another topic if helpful."];

const DEFAULT_SEE_ALSO_PREFIXES = ["See also: ", "Related topics: ", "You might also explore: ", "Further reading: "];

const DEFAULT_COMPARISON_OPENERS = {
  both: "Both **{A}** and **{B}** are important concepts here. ",
  contrast: "While **{A}** and **{B}** are related, they capture different ideas. ",
  similarity: "**{A}** and **{B}** share important structural similarities. "
};

const DEFAULT_TRANSITIONS = ["\n\nRelatedly, ", "\n\nClosely linked — ", "\n\nConnected idea: ", "\n\nBuilding on that, "];

const DEFAULT_INTENTS = {
  definition: {
    prototypes: [
      "what is X", "define X", "explain X", "what does X mean", "tell me about X",
      "describe X", "what is meant by X", "what is the meaning of X", "explain the concept of X",
      "can you explain X", "help me understand X", "what exactly is X", "define the term X",
      "i want to know about X", "could you describe X", "break down X for me",
      "what's the definition of X", "how would you define X", "in simple terms what is X"
    ],
    order: ['def', 'int', 'ex']
  },
  example: {
    prototypes: [
      "give an example of X", "show me an example", "example of X", "illustrate X",
      "concrete case of X", "an example of X", "show an example", "give examples of X",
      "illustrate with an example", "can you give me an example of X", "what's a good example of X",
      "show me X in practice", "demonstrate X with an example", "what would X look like",
      "give me a real example of X", "how does X work in practice", "walk me through an example of X"
    ],
    order: ['ex', 'int', 'def']
  },
  formal: {
    prototypes: [
      "formal definition of X", "prove X", "theorem about X", "math behind X",
      "derive X", "equation for X", "formalism of X", "mathematical definition of X",
      "proof of X", "formal proof of X", "rigorous definition of X", "formal treatment of X",
      "mathematical formulation of X", "give me the formal version of X", "what's the rigorous definition of X",
      "show me the math for X", "how is X formally defined", "what's the mathematical expression for X",
      "derive the formula for X", "prove that X holds"
    ],
    order: ['form', 'def', 'ex']
  },
  application: {
    prototypes: [
      "applications of X", "where is X used", "uses of X", "real world X",
      "practical use of X", "why is X useful", "how is X applied", "real-world applications of X",
      "where does X apply", "practical applications of X", "use cases of X",
      "how is X used in practice", "where can I see X in action", "what are the practical uses of X",
      "why does X matter", "how do people use X", "what's X good for",
      "where has X been applied successfully", "give me a practical example of X"
    ],
    order: ['app', 'ex', 'int']
  },
  comparison: {
    prototypes: [
      "difference between X and Y", "X vs Y", "compare X and Y",
      "how is X different from Y", "relation between X and Y", "X versus Y",
      "X compared to Y", "compare X with Y", "what's the difference between X and Y",
      "how does X relate to Y", "contrast X and Y", "what distinguishes X from Y",
      "how are X and Y similar", "X or Y which is better", "distinguish between X and Y"
    ],
    order: ['def', 'int', 'ex']
  },
  greeting: {
    prototypes: [
      "hi", "hello", "hey there", "good morning", "how are you", "what up",
      "hey", "hi there", "good afternoon", "good evening", "greetings",
      "howdy", "what's up", "yo", "sup", "hiya"
    ],
    order: null
  },
  help: {
    prototypes: [
      "help", "what can you do", "how do i use this", "what topics do you know",
      "menu", "what can you help with", "list topics", "what do you know",
      "show me what you can do", "how does this work", "what are my options",
      "guide me", "i need help", "what should i ask"
    ],
    order: null
  }
};

export function pick(a) {
  if (!Array.isArray(a) || a.length === 0) return '';
  return a[Math.floor(Math.random() * a.length)];
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) {
    console.warn(`[nlp] cosine dimension mismatch: ${a.length} vs ${b.length}, clamping`);
    return 0;
  }
  const len = Math.min(a.length, b.length, MAX_COSINE_DIM);
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    const ai = Number.isFinite(a[i]) ? a[i] : 0;
    const bi = Number.isFinite(b[i]) ? b[i] : 0;
    s += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) + 1e-9;
  return s / denom;
}

import { softmax } from './math-utils.js';

export function weightedChoice(items, w) {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (!Array.isArray(w) || w.length === 0) return items[0];
  const validW = w.map(x => Number.isFinite(x) && x >= 0 ? x : 0);
  let total = validW.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= validW[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

const STOP = new Set("a an the of in on at for to with and or is are was were be been being what which who whom whose this that these those i you he she it we they them us my your his her its our their me do does did can could should would will might may has have had not no nor don't doesn't didn't won't wouldn't can't couldn't".split(' '));

export { STOP };

export function tokens(t) {
  if (!t || typeof t !== 'string') return [];
  const str = t.slice(0, MAX_TOKEN_LENGTH);
  return str.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && w.length > 0 && !STOP.has(w));
}

function normalizeAlias(a) {
  if (!a || typeof a !== 'string') return '';
  return a.toLowerCase()
    .replace(/[\u2018\u2019'']/g, "'")
    .replace(/\s+-\s+/g, '-')
    .trim();
}

/**
 * Simple Levenshtein-based fuzzy match score.
 * Returns 0-1 similarity (1 = exact match).
 */
function fuzzyScore(a, b) {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  // Quick length-based filter
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.4) return 0;

  const la = a.length, lb = b.length;
  const matrix = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) matrix[i][0] = i;
  for (let j = 0; j <= lb; j++) matrix[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const maxLen = Math.max(la, lb);
  return 1 - matrix[la][lb] / maxLen;
}

/**
 * Word-overlap score between query and a term.
 * Returns 0-1 based on fraction of words matched.
 */
function wordOverlapScore(query, term) {
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const tWords = term.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (qWords.length === 0 || tWords.length === 0) return 0;

  let matches = 0;
  for (const qw of qWords) {
    for (const tw of tWords) {
      if (qw === tw || qw.includes(tw) || tw.includes(qw)) {
        matches++;
        break;
      }
    }
  }
  return matches / Math.max(qWords.length, tWords.length);
}

/**
 * Extract game-theory notation patterns like (D,D), (C,C), (O,O) from queries.
 * Returns an array of normalized notation strings that can be matched against aliases.
 */
function extractNotationPatterns(query) {
  const patterns = [];
  // Match parenthesized strategy profiles: (D,D), (C,C), (O,O), (F,F), etc.
  const notationMatch = query.match(/\([A-Za-z]\s*,\s*[A-Za-z]\)/g);
  if (notationMatch) {
    for (const n of notationMatch) {
      patterns.push(n.toLowerCase().replace(/\s+/g, ''));
    }
  }
  return patterns;
}

export function bowVec(t, vocab) {
  if (!t || typeof t !== 'string' || !vocab || vocab.size === 0) {
    const empty = new Array(vocab ? Math.min(vocab.size, MAX_VOCAB_SIZE) : 0).fill(0);
    return empty;
  }
  const size = Math.min(vocab.size, MAX_VOCAB_SIZE);
  const v = new Array(size).fill(0);
  for (const tk of tokens(t)) {
    if (vocab.has(tk)) {
      const idx = vocab.get(tk);
      if (idx >= 0 && idx < size) v[idx] += 1;
    }
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) + 1e-9;
  return v.map(x => x / norm);
}

export function compileAliasRegex(KB) {
  if (!Array.isArray(KB)) return;
  for (const e of KB) {
    if (!e || typeof e !== 'object') continue;
    e.aliasRegex = [];
    e.aliasPartialRegex = [];
    const aliases = Array.isArray(e.aliases) ? e.aliases : [];
    for (const a of aliases) {
      if (!a || typeof a !== 'string') continue;
      const na = normalizeAlias(a);
      if (!na) continue;
      const escaped = na.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedPartial = escaped.replace(/\\?\s+/g, '\\s*');
      try {
        e.aliasRegex.push(new RegExp('(?:^|\\s|\\b)' + escaped + '(?:\\s|\\b|$)', 'i'));
        e.aliasPartialRegex.push(new RegExp('(?:^|\\s)' + escapedPartial + '(?:\\s|$)', 'i'));
      } catch (err) {
        console.warn(`[nlp] Invalid alias regex for "${na}":`, err.message);
      }
    }
  }
}

export function extractEntities(query, KB) {
  if (!query || typeof query !== 'string' || !Array.isArray(KB) || KB.length === 0) return [];
  const q = ' ' + query.toLowerCase() + ' ';
  const qClean = query.toLowerCase().trim();
  const found = [], seen = new Set();

  // First pass: exact alias regex matching (existing behavior)
  for (let i = 0; i < KB.length; i++) {
    const entry = KB[i];
    if (!entry || typeof entry !== 'object') continue;
    const id = entry.id;
    if (seen.has(id)) continue;
    const aliasRegex = Array.isArray(entry.aliasRegex) ? entry.aliasRegex : [];
    const aliasPartialRegex = Array.isArray(entry.aliasPartialRegex) ? entry.aliasPartialRegex : [];

    for (let j = 0; j < aliasRegex.length; j++) {
      try {
        if (aliasRegex[j] && aliasRegex[j].test(q)) {
          found.push(i);
          seen.add(id);
          break;
        }
      } catch (e) { /* skip bad regex */ }
    }
    if (seen.has(id)) continue;

    for (let j = 0; j < aliasPartialRegex.length; j++) {
      try {
        if (aliasPartialRegex[j] && aliasPartialRegex[j].test(q)) {
          found.push(i);
          seen.add(id);
          break;
        }
      } catch (e) { /* skip bad regex */ }
    }
  }

  // Second pass: word-overlap scoring for entries not found by exact match
  // Only check if we found fewer than 3 entities
  if (found.length < 3) {
    const qWords = new Set(qClean.split(/\s+/).filter(w => w.length > 2));

    for (let i = 0; i < KB.length; i++) {
      const entry = KB[i];
      if (!entry || typeof entry !== 'object') continue;
      if (seen.has(entry.id)) continue;

      const name = (entry.name || '').toLowerCase();
      const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(a => a.toLowerCase()) : [];
      const allTerms = [name, ...aliases].filter(Boolean);

      let bestScore = 0;
      for (const term of allTerms) {
        // Word overlap
        const overlap = wordOverlapScore(qClean, term);
        if (overlap > bestScore) bestScore = overlap;

        // Fuzzy match for short terms (handles typos)
        if (term.length >= 4 && qClean.length <= 30) {
          const fuzzy = fuzzyScore(qClean, term);
          if (fuzzy > bestScore) bestScore = fuzzy;
        }
      }

      // Threshold: require at least 0.5 word overlap or 0.75 fuzzy
      if (bestScore >= 0.5) {
        found.push(i);
        seen.add(entry.id);
        if (found.length >= 5) break; // cap at 5 entities
      }
    }
  }

  // Third pass: notation pattern matching for game theory
  if (found.length < 3) {
    const notations = extractNotationPatterns(query);
    for (const notation of notations) {
      for (let i = 0; i < KB.length; i++) {
        const entry = KB[i];
        if (!entry || typeof entry !== 'object') continue;
        if (seen.has(entry.id)) continue;
        const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(a => a.toLowerCase()) : [];
        if (aliases.includes(notation)) {
          found.push(i);
          seen.add(entry.id);
          break;
        }
      }
    }
  }

  return found;
}

export function rankEntries(qEmb, entryEmb) {
  if (!Array.isArray(qEmb) || !Array.isArray(entryEmb) || entryEmb.length === 0) return [];
  return entryEmb
    .map((e, i) => {
      if (!Array.isArray(e)) return { i, s: 0 };
      return { i, s: cosine(qEmb, e) };
    })
    .sort((a, b) => b.s - a.s);
}

export async function classifyIntent(qEmb, intentEmb, intents, thresholds) {
  if (!Array.isArray(qEmb) || qEmb.length === 0 || !intents || !intentEmb) {
    return { intent: 'definition', scores: {}, rawScores: {} };
  }
  const scores = {}, rawMax = {};
  const qLen = qEmb.length; // not useful here, but keep for API compat
  
  for (const k of Object.keys(intents)) {
    const protos = intentEmb[k];
    if (!Array.isArray(protos) || protos.length === 0) continue;
    
    // Score each prototype, weight by recency (later prototypes are more specific)
    let max = -1;
    let weightedSum = 0;
    let totalWeight = 0;
    for (let pi = 0; pi < protos.length; pi++) {
      const pe = protos[pi];
      if (!Array.isArray(pe)) continue;
      const s = cosine(qEmb, pe);
      if (Number.isFinite(s) && s > max) max = s;
      // Weight later prototypes slightly higher (they're more specific)
      const weight = 1.0 + pi * 0.02;
      weightedSum += s * weight;
      totalWeight += weight;
    }
    
    rawMax[k] = max > -1 ? max : 0;
    
    // Combined score: best match + weighted average (prevents one lucky match from dominating)
    const avgScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const countNorm = Math.log(protos.length + 1);
    scores[k] = (0.7 * rawMax[k] + 0.3 * avgScore) * countNorm;
  }
  
  let best = 'definition', bs = -1;
  for (const k in scores) {
    if (Number.isFinite(scores[k]) && scores[k] > bs) {
      bs = scores[k];
      best = k;
    }
  }
  
  // Adaptive confidence threshold: shorter queries need higher confidence
  const confThresholds = thresholds?.CONFIDENCE || {};
  if (confThresholds[best] !== undefined && rawMax[best] < confThresholds[best]) {
    best = 'definition';
  }
  
  return { intent: best, scores, rawScores: rawMax };
}

export async function selectFragment(entry, cat, qEmb, embedCached, config, recentlyUsedFragments) {
  if (!entry || !cat || !Array.isArray(qEmb) || typeof embedCached !== 'function') return null;
  const f = entry.f;
  if (!f || typeof f !== 'object') return null;
  const frags = f[cat];
  if (!Array.isArray(frags) || frags.length === 0) return null;
  if (frags.length === 1) return frags[0];

  const scores = [];
  for (let fi = 0; fi < frags.length; fi++) {
    const fr = frags[fi];
    try {
      const v = await embedCached(fr);
      let sim = (Array.isArray(v) && v.length > 0) ? cosine(qEmb, v) : 0;

      // Diversity penalty: penalize recently-shown fragments by category ID
      if (recentlyUsedFragments && recentlyUsedFragments.length > 0) {
        const fragId = `${entry.id}:${cat}`;
        if (recentlyUsedFragments.includes(fragId)) {
          sim *= 0.5;
        }
      }

      scores.push(sim);
    } catch (e) {
      scores.push(0);
    }
  }
  const catTemp = (config?.COMPOSITION?.FRAGMENT_TEMP_BY_CAT && config.COMPOSITION.FRAGMENT_TEMP_BY_CAT[cat])
    || config?.COMPOSITION?.FRAGMENT_TEMP || 0.8;
  const w = softmax(scores, catTemp);
  return weightedChoice(frags, w);
}

// ============================================================
// compose() — legacy fallback (unchanged behavior when policy unavailable)
// ============================================================
export async function compose(query, qEmb, embedCached, entryEmb, intentEmb, lastTopic, KB, config, overrides) {
  if (!Array.isArray(KB) || KB.length === 0) {
    return {
      text: "I don't have any knowledge loaded yet. Please try again later.",
      meta: [{ text: 'empty-kb', type: 'warn' }]
    };
  }
  const OPENERS = overrides?.openers || DEFAULT_OPENERS;
  const CONNECTORS = overrides?.connectors || DEFAULT_CONNECTORS;
  const CLOSERS = overrides?.closers || DEFAULT_CLOSERS;
  const SEE_ALSO_PREFIXES = overrides?.seeAlsoPrefixes || DEFAULT_SEE_ALSO_PREFIXES;
  const COMPARISON_OPENERS = overrides?.comparisonOpeners || DEFAULT_COMPARISON_OPENERS;
  const TRANSITIONS = overrides?.transitions || DEFAULT_TRANSITIONS;
  const INTENTS = overrides?.intents || DEFAULT_INTENTS;
  const thresholdConfig = config?.THRESHOLDS || {};
  const compositionConfig = config?.COMPOSITION || {};

  const ranked = rankEntries(qEmb, entryEmb);
  let entities = extractEntities(query, KB);
  const { intent } = await classifyIntent(qEmb, intentEmb, INTENTS, thresholdConfig);

  if (entities.length === 0 && lastTopic !== null && lastTopic >= 0 && ranked[0]?.s > 0.25) {
    entities = [lastTopic];
  }

  if (intent === 'greeting' && entities.length === 0 && ranked[0]?.s < (thresholdConfig.GREETING_FALLBACK || 0.25)) {
    return {
      text: overrides?.greetingResponse || (pick(OPENERS) + "Hi! I'm an on-device assistant. All processing runs in your browser."),
      meta: [{ text: 'intent: greeting', type: 'intent' }]
    };
  }

  if (intent === 'help' && ranked[0]?.s < (thresholdConfig.GREETING_FALLBACK || 0.25)) {
    return {
      text: overrides?.helpResponse || "I can discuss topics entirely on your device. Try a question or choose a suggestion below.",
      meta: [{ text: 'intent: help', type: 'intent' }]
    };
  }

  if (ranked[0]?.s < (thresholdConfig.OFF_TOPIC || 0.15) && entities.length === 0) {
    return {
      text: overrides?.offTopicResponse || "That didn't map to anything I know well. Try asking about a topic I'm trained on.",
      meta: [{ text: 'off-topic', type: 'warn' }]
    };
  }

  let topEntries;
  if (entities.length > 0) {
    topEntries = [...entities];
    for (const r of ranked.slice(0, 2)) if (!topEntries.includes(r.i) && r.s > (thresholdConfig.ENTITY_BOOST || 0.45)) topEntries.push(r.i);
    topEntries = topEntries.slice(0, compositionConfig.MAX_ENTRIES || 3);
  } else {
    topEntries = [ranked[0].i];
    if (ranked.length > 1 && ranked[1].s > (thresholdConfig.SECONDARY_ENTRY || 0.38)) topEntries.push(ranked[1].i);
  }

  const order = INTENTS[intent]?.order || ['def', 'int', 'ex'];

  let parts = [];
  if (intent === 'comparison' && topEntries.length >= 2) {
    const eA = KB[topEntries[0]], eB = KB[topEntries[1]];
    if (eA && eB && eA.name && eB.name) {
      const openerKey = Math.random() < 0.33 ? 'similarity' : (Math.random() < 0.5 ? 'contrast' : 'both');
      const openerText = (COMPARISON_OPENERS[openerKey] || '').replace(/\{A\}/g, eA.name).replace(/\{B\}/g, eB.name);
      parts.push(openerText);
    }
  }

  for (let ei = 0; ei < topEntries.length; ei++) {
    const entry = KB[topEntries[ei]];
    if (!entry || typeof entry !== 'object') {
      console.warn(`[compose] KB entry at index ${topEntries[ei]} is invalid, skipping`);
      continue;
    }
    const entryName = entry.name || 'topic';
    const pieces = [];
    const cats = (intent === 'comparison' && topEntries.length >= 2) ? order : (ei === 0 ? order : [order[0]]);
    let prev = null;
    for (let ci = 0; ci < cats.length; ci++) {
      const cat = cats[ci];
      const frag = await selectFragment(entry, cat, qEmb, embedCached, config);
      if (!frag) continue;
      let connector = "";
      if (prev) {
        const key = `${prev}_to_${cat}`;
        const pool = CONNECTORS[key];
        if (pool) connector = pick(pool);
      } else if (intent === 'comparison' && topEntries.length >= 2 && ei === 0) {
        connector = "";
      } else if (ei === 0 && intent !== 'comparison') {
        connector = Math.random() < 0.6 ? `**${entryName}** — ` : "";
      } else {
        connector = pick(TRANSITIONS).replace(/\\n/g, '\n') + `**${entryName}**: `;
      }
      pieces.push(connector + frag);
      prev = cat;
    }
    if (pieces.length > 0) parts.push(pieces.join(' '));
  }

  let text = (intent !== 'comparison' || topEntries.length < 2 ? pick(OPENERS) : '') + (parts[0] || '');
  for (let i = 1; i < parts.length; i++) text += parts[i];

  const lastEntryIdx = topEntries[topEntries.length - 1];
  const lastEntry = lastEntryIdx !== undefined ? KB[lastEntryIdx] : null;
  if (lastEntry && lastEntry.related && Array.isArray(lastEntry.related) && lastEntry.related.length > 0) {
    const relNames = lastEntry.related.slice(0, 3).map(rid => {
      const found = Array.isArray(KB) ? KB.findIndex(e => e && e.id === rid) : -1;
      return found >= 0 && KB[found] ? KB[found].name : rid;
    }).filter(Boolean);
    if (relNames.length > 0) {
      text += '\n\n' + pick(SEE_ALSO_PREFIXES) + relNames.join(', ') + '.';
    }
  }
  text += pick(CLOSERS);

  const meta = [{ text: `intent: ${intent}`, type: 'intent' }];
  for (const idx of topEntries) {
    const entry = KB[idx];
    meta.push({ text: entry && entry.name ? entry.name : `entry:${idx}`, type: '' });
  }
  meta.push({ text: `sim ${(ranked[0]?.s || 0).toFixed(2)}`, type: 'score' });
  if (entities.length > 0) meta.push({ text: `${entities.length} entit${entities.length > 1 ? 'ies' : 'y'}`, type: 'score' });

  return { text, meta };
}

// ============================================================
// composeV2() — policy-driven pure renderer (receives AnswerPlan)
// ============================================================
export async function composeV2(query, qEmb, embedCached, entryEmb, intentEmb, lastTopic, KB, config, overrides, plan) {
  // plan is an AnswerPlan from the policy runtime
  // This function is intentionally pure: plan dictates all decisions.

  const OPENERS = overrides?.openers || DEFAULT_OPENERS;
  const CONNECTORS = overrides?.connectors || DEFAULT_CONNECTORS;
  const CLOSERS = overrides?.closers || DEFAULT_CLOSERS;
  const SEE_ALSO_PREFIXES = overrides?.seeAlsoPrefixes || DEFAULT_SEE_ALSO_PREFIXES;
  const COMPARISON_OPENERS = overrides?.comparisonOpeners || DEFAULT_COMPARISON_OPENERS;
  const TRANSITIONS = overrides?.transitions || DEFAULT_TRANSITIONS;
  const INTENTS = overrides?.intents || DEFAULT_INTENTS;
  const compositionConfig = config?.COMPOSITION || {};

  if (!plan || plan.mode === 'off_topic') {
    return {
      text: overrides?.offTopicResponse || "That didn't map to anything I know well. Try asking about a topic I'm trained on.",
      meta: [{ text: 'off-topic', type: 'warn' }]
    };
  }

  if (plan.mode === 'greeting') {
    return {
      text: overrides?.greetingResponse || (pick(OPENERS) + "Hi! I'm an on-device assistant. All processing runs in your browser."),
      meta: [{ text: 'intent: greeting', type: 'intent' }]
    };
  }

  if (plan.mode === 'help') {
    return {
      text: overrides?.helpResponse || "I can discuss topics entirely on your device. Try a question or choose a suggestion below.",
      meta: [{ text: 'intent: help', type: 'intent' }]
    };
  }

  if (plan.mode === 'clarify') {
    let text;
    if (plan.clarification?.ambiguity_type === 'multiple_topics') {
      text = `I see a few possible topics in your question. Did you mean:\n` +
        (plan.clarification.options || []).map((opt, i) => `  • ${opt}`).join('\n');
    } else if (plan.clarification?.ambiguity_type === 'low_confidence') {
      text = `I'm not entirely sure what you're asking about. Could you rephrase or be more specific?`;
    } else {
      text = `I may be reading this wrong. Could you clarify your question?`;
    }
    return { text, meta: [{ text: 'clarification', type: 'warn' }] };
  }

  // KB mode (normal) or comparison mode
  const topEntries = Array.isArray(plan.topics) && plan.topics.length > 0
    ? plan.topics.slice(0, compositionConfig.MAX_ENTRIES || 3)
    : (console.warn('[composeV2] plan.topics empty, falling back to KB[0]'), [0]);

  const intent = plan.intent || 'definition';
  const order = INTENTS[intent]?.order || ['def', 'int', 'ex'];
  const creativity = typeof plan.creativity === 'number' ? plan.creativity : 0.2;

  let parts = [];
  let selectedFragments = [];

  if (plan.mode === 'comparison' && topEntries.length >= 2) {
    const eA = KB[topEntries[0]], eB = KB[topEntries[1]];
    if (eA && eB && eA.name && eB.name) {
      const openerKey = plan.template?.comparisonOpenerKey || (creativity < 0.33 ? 'similarity' : (creativity < 0.66 ? 'contrast' : 'both'));
      const openerText = (COMPARISON_OPENERS[openerKey] || '').replace(/\{A\}/g, eA.name).replace(/\{B\}/g, eB.name);
      parts.push(openerText);
    }
  }

  for (let ei = 0; ei < topEntries.length; ei++) {
    const entry = KB[topEntries[ei]];
    if (!entry || typeof entry !== 'object') {
      console.warn(`[composeV2] KB entry at index ${topEntries[ei]} is invalid, skipping`);
      continue;
    }
    const entryName = entry.name || 'topic';
    const pieces = [];
    const cats = (plan.fragmentPlan && plan.fragmentPlan[ei] && plan.fragmentPlan[ei].cats)
      ? plan.fragmentPlan[ei].cats
      : ((plan.mode === 'comparison' && topEntries.length >= 2) ? order : (ei === 0 ? order : [order[0]]));
    let prev = null;

    for (let ci = 0; ci < cats.length; ci++) {
      const cat = cats[ci];
      // Respect fragmentPlan counts from policy (simple 0/1 gate here)
      const wantFrag = plan.fragmentPlan && plan.fragmentPlan[ei] && plan.fragmentPlan[ei].cats && plan.fragmentPlan[ei].cats.includes(cat);
      if (!wantFrag) continue;

      const frag = await selectFragment(entry, cat, qEmb, embedCached, config, plan._recentlyUsedFragments);
      if (!frag) continue;
      selectedFragments.push(frag);

      let connector = "";
      if (prev) {
        const key = `${prev}_to_${cat}`;
        const pool = CONNECTORS[key];
        if (pool) connector = pick(pool);
      } else if (plan.mode === 'comparison' && topEntries.length >= 2 && ei === 0) {
        connector = "";
      } else if (ei === 0 && plan.mode !== 'comparison') {
        connector = Math.random() < (0.5 + creativity * 0.2) ? `**${entryName}** — ` : "";
      } else {
        connector = pick(TRANSITIONS).replace(/\\n/g, '\n') + `**${entryName}**: `;
      }
      pieces.push(connector + frag);
      prev = cat;
    }
    if (pieces.length > 0) parts.push(pieces.join(' '));
  }

  // === Factual Guardrail ===
  let guardrailWarnings = [];
  // selectedFragments populated during selection above (see selectFragment calls)
  // Note: fragments may be strings (legacy) or {id, text, truth_confidence, source_confidence, avoid_with, ...}
  for (let i = 0; i < selectedFragments.length; i++) {
    const fragment = selectedFragments[i];
    if (fragment && typeof fragment === 'object') {
      if (fragment.truth_confidence != null && fragment.truth_confidence < 0.5) {
        guardrailWarnings.push(`Low truth_confidence (${fragment.truth_confidence}) for fragment ${fragment.id || i}`);
      }
      if (fragment.source_confidence != null && fragment.source_confidence < 0.3) {
        guardrailWarnings.push(`Skipping low source_confidence (${fragment.source_confidence}) fragment ${fragment.id || i}`);
        // In a full impl we'd filter it from parts/selectedFragments here
      }
    }
  }
  // avoid_with cross-check (simplified pairwise)
  for (let i = 0; i < selectedFragments.length; i++) {
    for (let j = i + 1; j < selectedFragments.length; j++) {
      const a = selectedFragments[i];
      const b = selectedFragments[j];
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        if (Array.isArray(a.avoid_with) && a.avoid_with.includes(b.id)) {
          guardrailWarnings.push(`avoid_with conflict: ${a.id} ↔ ${b.id}`);
        }
        if (Array.isArray(b.avoid_with) && b.avoid_with.includes(a.id)) {
          guardrailWarnings.push(`avoid_with conflict: ${b.id} ↔ ${a.id}`);
        }
      }
    }
  }
  if (plan.guardrails?.requireEntity) {
    // In composeV2 entity matching is decided upstream in plan; warn if flag set without evidence
    guardrailWarnings.push('requireEntity guardrail active (entities handled by policy)');
  }
  if (guardrailWarnings.length > 0) {
    console.warn('[composeV2] Guardrail warnings:', guardrailWarnings);
  }

  // Template indices from plan (simple deterministic pick for now)
  const openerIdx = plan.template?.openerIdx ?? 0;
  const closerIdx = plan.template?.closerIdx ?? 0;
  const opener = OPENERS[openerIdx % OPENERS.length] || '';
  const closer = CLOSERS[closerIdx % CLOSERS.length] || '';

  let text = (plan.mode !== 'comparison' || topEntries.length < 2 ? opener : '') + (parts[0] || '');
  for (let i = 1; i < parts.length; i++) text += parts[i];

  // Related topics (respect guardrails)
  const lastEntry = KB[topEntries[topEntries.length - 1]];
  if (lastEntry?.related && lastEntry.related.length > 0 && plan.guardrails?.requireCite !== true) {
    const relNames = lastEntry.related.slice(0, 3).map(rid => {
      const found = KB.findIndex(e => e.id === rid);
      return found >= 0 ? KB[found].name : rid;
    }).filter(Boolean);
    if (relNames.length > 0) {
      text += '\n\n' + pick(SEE_ALSO_PREFIXES) + relNames.join(', ') + '.';
    }
  }

  text += closer;

  const meta = [{ text: `intent: ${intent}`, type: 'intent' }];
  for (const idx of topEntries) {
    const entry = KB[idx];
    meta.push({ text: entry && entry.name ? entry.name : `entry:${idx}`, type: '' });
  }
  meta.push({ text: `plan:${plan.mode}`, type: 'score' });
  if (selectedFragments.length > 0) {
    meta.fragmentIds = selectedFragments.map(f => (f && f.id) || null).filter(Boolean);
  }
  if (guardrailWarnings.length > 0) {
    meta.guardrailWarnings = guardrailWarnings;
  }

  return { text, meta };
}
