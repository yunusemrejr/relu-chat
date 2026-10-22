/**
 * lexicon.js — Lexical analysis for the ReLU.chat inference layer
 *
 * Everything here is deterministic, dependency-free and sized for a phone:
 *
 *   - fold / wordTokens: accent-folding tokenizer that keeps character spans,
 *     original capitalization and single-letter tokens such as the "q" in
 *     "q-learning".
 *   - stem: a deliberately conservative suffix stripper. Both the knowledge base
 *     and the question pass through it, so only consistency matters.
 *   - splitSentences: math- and abbreviation-aware sentence splitting.
 *   - Lexicon: per-assistant statistics (entry-level IDF, stem bigrams,
 *     per-entry stem sets, sentence inventory) plus a symmetric-delete spelling
 *     index (the SymSpell idea from search engines): every vocabulary word is
 *     stored under its one-character deletions, so a typo is found by looking up
 *     its own deletions instead of comparing it with every word.
 *
 * The lexicon never decides anything on its own. It answers narrow questions
 * ("is this stem known?", "how informative is it?", "which known word is one
 * edit away?") for query analysis, grounding and answer planning.
 */

// ---------------------------------------------------------------------------
// Word lists
// ---------------------------------------------------------------------------

/** Function words that never carry a topic. */
export const STOPWORDS = new Set(`a an the of in on at for to from with without by about into onto over under and or nor but
so if then than as is are was were be been being am do does did doing done has have had having can could should would
will shall might may must this that these those it its it's i me my mine you your yours u ur he him his she her hers
we us our ours they them their theirs what which who whom whose when where why how there here not no yes just also
too very really quite some any each every all both either neither such only own same other another one ones s t
let lets let's i'm im i've ive you're youre what's whats that's thats how's hows dont doesnt didnt cant couldnt wont wouldnt
shouldnt isnt arent wasnt werent havent hasnt hadnt aint youve youll theyre theyve weve hes shes theres heres wheres whos
id ive yall gonna wanna gotta kinda sorta`.split(/\s+/));

/**
 * Frequent English words that rarely name a concept. When such a word is the
 * only unexplained part of a question it does not count as evidence that the
 * question is about something the assistant has never heard of.
 */
export const GENERIC_WORDS = new Set(`
able above actually after again against ago almost alone along already although always among answer anyone anything
anyway anywhere appear approach area around ask asked asking aspect aspects assume away back bad basic basically basics
became because become becomes before begin beginner beginners behind believe best better between big bit book books both
brief briefly bring build built call called came can't cannot care case cases cause caused certain change changed
changes changing chapter check choose clear clearly close come comes coming common commonly complete completely concept
concepts consider considered could couldn't course create created current currently day days deal decide deep deeply
define defined definition demo describe described description detail detailed details did didn't different difficult do
does doesn't doing don't done down during each early easier easiest easy effect else end enough entire especially even
ever every everyday everything exact exactly example examples explain explained explaining explanation explanations fact
facts fall far fast feel few field find first five follow following form forms found four free full fully general
generally get gets getting give given gives giving go goes going gone good got great group guide guy guys half happen
happens hard hear heard help helps high history hmm hold home honest honestly hour huge idea ideas imagine important
include including info information instead interest interested interesting intro introduction intuition intuitive
involve involved issue issues item items job keep kind kinds know knowing known large last later learn learned learning
least left less level levels life light like likely line list little live lol long look looking looks lot lots low made
main mainly make makes making many matter matters maybe mean meaning means meant mind minute minutes mode moment more
most mostly move much name named names near need needed needs never new next nice none normal normally note nothing
now number numbers often ok okay old once open order original others otherwise out outside overall overview own part
parts people perhaps person pick piece place plain play please plus point points possible post practical practice
pretty probably problem problems process pros put question questions quick quickly quite rather read reading ready real
really reason reasons recently remember result results right role run same say saying says second see seem seems seen
sense set several short show shown side simple simpler simply since single small someone something sometimes somewhat
soon sort sorts speak special specific specifically start started state stated step steps still stop story student
students study stuff subject such suppose sure take taken takes talk talking teach tell term terms test text than thank
thanks thing things think third though thought three through thus time times today together told top topic topics total
toward true truly try trying turn two type types typical typically under understand understanding unit until up upon
use used useful uses using usual usually value various version view want wants way ways week well went whatever whether
while whole wide will within word words work worked working works world worth would wouldn't write written wrong year
years yet young
actual add added again age ago agree allow allowed amount answer anyway appear apply around arrive avoid aware bad 
basic beat begin behave belong beside beyond big bigger biggest bring broken busy buy calls came carry catch cause
certain chance cheap check child choice choose chosen claim clean clear click close cold come common compare complete
correct cost cover crazy cut daily dark deal decent deep depend did differ doing done double drop drops dropped
drive eat effect else end enter entire equal even ever everyday exact exist expect explain fail fair fall false
familiar fast fine finish fix follow forget found front fun funny garbage gave general gets give glad goal
gone good got grab great grow guess hand handle happy hard hate have heavy held hello help hidden hide high hit hold
hope huge idea imagine improve include inside instead intuitive job join jump just keep kept kid kill kind knew land
large late lead learn leave left less let lie like list little live lol long look loose lose lost lot love
low made main major make many matter mean meet method middle mind minor miss mistake mix moment money most move
moved moves much must name natural near nearly need never new nice normal note nothing notice now number obvious odd
offer often old once open opposite other own part pass past pay pick picked picks piece place plan plenty
 pop possible pretty prevent probably proper pull push put quick quite rare rather reach read real really
reason recent remove repeat rest right rough run safe save saw say second see seem send
sense setting short show side similar simple sit sits skip slow small smart someone sometimes sound
speak special spend stand start stay stick still stop strange strong stuck stuff suggest super sure
take talk tell tend term than thing think thought throw tiny together told too tool touch tough toward
 trick trouble true trust try ugly under until upon useful usual usually view wait walk want
warm watch way weak wear weird well went whole wide win wish without wonder work worry worse worst wrong yes`.trim().split(/\s+/));

/** Short words that look like content but are conversational filler. */
const CHAT_WORDS = new Set('lol lmao haha hehe pls plz thx ty btw imo imho idk tbh ok okay hey hi hello yo sup hmm huh umm um uh wow cool nice'.split(' '));

// ---------------------------------------------------------------------------
// Normalization and tokenization
// ---------------------------------------------------------------------------

/** Lowercase, strip accents, normalize quotes and dashes. Length-preserving per code unit is NOT guaranteed. */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .toLowerCase();
}

/**
 * Tokenize while keeping where each word came from.
 * Possessive "'s" is dropped ("prisoner's" → "prisoner") and inner apostrophes
 * are removed ("don't" → "dont"). Hyphens split words ("q-learning" → q, learning).
 * @param {string} text
 * @returns {Array<{w:string, stem:string, start:number, end:number, cap:boolean}>}
 */
export function wordTokens(text) {
  const source = String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’ʼ`´]/g, "'");
  const out = [];
  const re = /[A-Za-z0-9]+(?:'[A-Za-z]+)?/g;
  let m;
  while ((m = re.exec(source))) {
    let w = m[0].toLowerCase();
    if (/'s$/.test(w)) w = w.slice(0, -2);
    w = w.replace(/'/g, '');
    if (!w) continue;
    out.push({ w, stem: stem(w), start: m.index, end: m.index + m[0].length, cap: /^[A-Z]/.test(m[0]) });
  }
  return out;
}

/** Content tokens: no stopwords. */
export function contentTokens(text) {
  return wordTokens(text).filter(t => !STOPWORDS.has(t.w));
}

const STEM_CACHE = new Map();

/** Irregular plurals that suffix rules would split from their singular. */
const IRREGULAR = {
  equilibria: 'equilibrium', criteria: 'criterion', phenomena: 'phenomenon', analyses: 'analysis', hypotheses: 'hypothesis',
  theses: 'thesis', maxima: 'maximum', minima: 'minimum', optima: 'optimum', formulae: 'formula', schemata: 'schema',
  women: 'woman', men: 'man', children: 'child', people: 'person', bias: 'bias', biases: 'bias', alias: 'alias',
  aliases: 'alias', atlas: 'atlas', canvas: 'canvas', gas: 'gas', gases: 'gas', axes: 'axis', data: 'data',
};

/**
 * Conservative suffix stripping. Collapses plurals, -ing/-ed/-ly/-ation and the
 * Latin -ix/-ex ↔ -ices pairs (matrix/matrices, vertex/vertices) onto shared
 * keys. British -ise spellings fold onto -ize.
 * @param {string} word - lowercase word
 * @returns {string}
 */
export function stem(word) {
  let w = String(word || '');
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length <= 3 || /\d/.test(w)) return w;
  const hit = STEM_CACHE.get(word);
  if (hit) return hit;
  if (w.length > 6) w = w.replace(/isations?$/, 'ization').replace(/is(e|ed|es|ing)$/, 'iz$1').replace(/ys(e|ed|es|ing)$/, 'yz$1');
  // Plurals first, so "indexes" and "index" meet below.
  if (/ices$/.test(w) && w.length >= 6) w = w.slice(0, -4) + 'ic';
  else if (/ies$/.test(w) && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (/(?:ss|us|is|os)$/.test(w)) { /* keep: process, corpus, analysis, chaos */ }
  else if (/(?:sh|ch|x|z)es$/.test(w) && w.length > 5) w = w.slice(0, -2);
  else if (/s$/.test(w) && w.length > 3) w = w.slice(0, -1);
  if (/(?:ix|ex)$/.test(w) && w.length >= 5) w = w.slice(0, -2) + 'ic';
  // One derivational/inflectional suffix. -ation, -ate, -ating and -ated meet
  // (deviation, deviate, deviating → devi); multiplication meets multiply;
  // projection meets project; independence, independent and the common
  // misspelling independant meet.
  let verbal = false;
  if (/(?:ct|ss|pt)ion$/.test(w) && w.length > 7) w = w.slice(0, -3);
  else if (/(?:ence|ance|ent|ant)$/.test(w) && w.length > 7) w = w.replace(/(?:ence|ance|ent|ant)$/, '');
  else if (/ation$/.test(w) && w.length > 8) {
    w = w.slice(0, -5);
    if (/ic$/.test(w) && w.length > 5) w = w.slice(0, -1);
  } else if (/at(?:ing|ed)$/.test(w) && w.length > 8) w = w.replace(/at(?:ing|ed)$/, '');
  else if (/ing$/.test(w) && w.length > 6) { w = w.slice(0, -3); verbal = true; }
  else if (/ed$/.test(w) && w.length > 5) { w = w.slice(0, -2); verbal = true; }
  else if (/[^p]ly$/.test(w) && w.length > 6) w = w.slice(0, -2);
  if (verbal && /([bdfgklmnprt])\1$/.test(w) && w.length >= 4) w = w.slice(0, -1);
  if (/ate$/.test(w) && w.length > 6) w = w.slice(0, -3);
  else if (/at$/.test(w) && w.length > 5 && verbal) w = w.slice(0, -2);
  if (/e$/.test(w) && w.length > 4) w = w.slice(0, -1);
  if (/y$/.test(w) && w.length > 4) w = w.slice(0, -1) + 'i';
  STEM_CACHE.set(word, w);
  return w;
}

/** Inflected forms only ("picks" → "pick", "dropped" → "drop"); "importance" stays apart from "important". */
function inflections(w) {
  return [w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, ''), w.replace(/ed$/, ''), w.replace(/ed$/, 'e'), w.replace(/([bdgmnpt])\1ed$/, '$1'), w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/([bdgmnpt])\1ing$/, '$1')];
}

/** True for stopwords, generic English and chat filler, including their inflected forms. */
export function isGenericWord(word) {
  if (STOPWORDS.has(word) || GENERIC_WORDS.has(word) || CHAT_WORDS.has(word) || /^\d+$/.test(word)) return true;
  return word.length > 3 && inflections(word).some(w => w !== word && GENERIC_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

const ABBREVIATIONS = /(?:\b(?:e\.g|i\.e|c|ca|cf|vs|etc|al|dr|st|mr|mrs|ms|fig|eq|approx|no|vol)|\b[A-Z])\.$/i;

/**
 * Split text into sentences without breaking inside $…$ math, decimals or
 * common abbreviations ("c. 780", "e.g.", "Ibn al.").
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const out = [];
  let start = 0, inMath = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '$') { inMath = !inMath; continue; }
    if (inMath || !/[.!?]/.test(ch)) continue;
    const next = s[i + 1];
    if (next !== undefined && !/\s/.test(next)) continue;
    let j = i + 1;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (j >= s.length) break;
    if (!/[A-Z0-9"'($À-ɏ]/.test(s[j])) continue;
    if (ch === '.' && ABBREVIATIONS.test(s.slice(Math.max(start, i - 8), i + 1))) continue;
    out.push(s.slice(start, i + 1).trim());
    start = j;
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// ---------------------------------------------------------------------------
// Edit distance
// ---------------------------------------------------------------------------

/**
 * Optimal-string-alignment (restricted Damerau–Levenshtein) distance with an
 * early exit once the distance exceeds `max`.
 */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[lb];
}

function deletes1(word) {
  const out = new Set();
  for (let i = 0; i < word.length; i++) out.add(word.slice(0, i) + word.slice(i + 1));
  return out;
}

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

const CATEGORY_ORDER = ['def', 'int', 'ex', 'form', 'app'];

/** Strip LaTeX commands so "\cos\theta" does not leak "cos"/"theta" noise into statistics twice. */
function plainForStats(text) {
  return String(text || '').replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}_^$]/g, ' ');
}

const ROLE = 'mathematician|astronomer|physician|philosopher|scholar|polymath|scientist|engineer|geographer|historian|chemist|alchemist|inventor|economist|poet|theologian|traveler|traveller|botanist|physicist|surgeon|jurist|cartographer|translator|optician|musician|architect|founder|patron|ruler|caliph|sultan|woman|man|scribe|calligrapher';

/**
 * Classify an entry for pronoun agreement: a single person ("he", "she"),
 * a group of people ("they"), or anything else ("it").
 * @returns {'person'|'group'|'concept'}
 */
export function entryKind(entry) {
  const summary = String(entry?.summary || '');
  const firstDef = String(entry?.f?.def?.[0] || '');
  const names = [entry?.name || '', ...(entry?.aliases || [])].join(' ').toLowerCase();
  if (/^(?:two|three|four|several)\s+(?:[A-Z][\w-]*\s+){0,2}(?:brothers|sisters|scholars|people|families|men|women)\b/i.test(summary)) return 'group';
  if (new RegExp(`^(?:[A-Z][\\w-]*\\s+){0,4}(?:${ROLE})\\b`, 'i').test(summary)) return 'person';
  const role = new RegExp(`\\b(?:${ROLE})\\b`, 'i');
  const lifespan = /\((?:c\.\s*)?\d{3,4}\s*[–-]\s*(?:c\.\s*)?\d{3,4}\)|\b(?:born|died)\b/i;
  if (lifespan.test(firstDef) && role.test(summary + ' ' + firstDef)) return 'person';
  return /\b(?:ibn|abu|bint|al-[a-z]+i)\b/.test(names) && role.test(summary + ' ' + firstDef) ? 'person' : 'concept';
}

export class Lexicon {
  /**
   * @param {object[]} KB - knowledge entries ({id,name,aliases,summary,f,related,sources})
   */
  constructor(KB) {
    this.KB = Array.isArray(KB) ? KB : [];
    const N = this.KB.length;
    /** stem → number of entries containing it */
    this.df = new Map();
    /** surface word → stem, for every word in the knowledge base */
    this.surface = new Map();
    /** "stemA stemB" adjacency pairs seen anywhere in the knowledge text */
    this.bigrams = new Set();
    /** per entry: Set of stems in all of its text */
    this.entryStems = [];
    /** per entry: Set of stems in its name and aliases */
    this.entryNameStems = [];
    /** per entry: sentence inventory used by the planner */
    this.units = [];
    /** per entry: 'person' | 'group' | 'concept' */
    this.kinds = [];
    /** deletion index for spelling correction: deletion → Set(surface word) */
    this._deletes = new Map();

    for (let i = 0; i < N; i++) {
      const e = this.KB[i] || {};
      const stems = new Set();
      const nameStems = new Set();
      const texts = [e.name, ...(e.aliases || []), e.summary];
      for (const cat of CATEGORY_ORDER) for (const frag of e.f?.[cat] || []) texts.push(typeof frag === 'string' ? frag : frag?.text);
      for (const text of texts) {
        const toks = wordTokens(plainForStats(text));
        for (let k = 0; k < toks.length; k++) {
          const t = toks[k];
          stems.add(t.stem);
          if (!this.surface.has(t.w)) this.surface.set(t.w, t.stem);
          if (k > 0) this.bigrams.add(toks[k - 1].stem + ' ' + t.stem);
        }
      }
      for (const text of [e.name, ...(e.aliases || [])]) for (const t of wordTokens(text)) nameStems.add(t.stem);
      for (const s of stems) this.df.set(s, (this.df.get(s) || 0) + 1);
      this.entryStems.push(stems);
      this.entryNameStems.push(nameStems);
      this.kinds.push(entryKind(e));
      this.units.push(buildUnits(e));
    }
    this.N = N;
    this.maxIdf = Math.log((N + 1) / 0.5) + 1;
    for (const word of this.surface.keys()) {
      if (word.length < 5 || /\d/.test(word)) continue;
      for (const d of [word, ...deletes1(word)]) {
        if (!this._deletes.has(d)) this._deletes.set(d, new Set());
        this._deletes.get(d).add(word);
      }
    }
  }

  /** Smoothed entry-level inverse document frequency; unknown stems get the maximum. */
  idf(s) {
    const df = this.df.get(s) || 0;
    return df ? Math.log((this.N + 1) / (df + 0.5)) + 1 : this.maxIdf;
  }

  hasStem(s) { return this.df.has(s); }

  /** True when the two stems occur next to each other somewhere in the knowledge text. */
  adjacent(a, b) { return this.bigrams.has(a + ' ' + b); }

  /**
   * Spelling correction against the knowledge vocabulary (symmetric delete,
   * distance ≤ 1, or ≤ 2 for long words through shared deletions). Returns
   * null when there is no candidate or when two candidates tie.
   * @param {string} word - lowercase surface word
   * @returns {{word:string, stem:string, distance:number}|null}
   */
  correct(word) {
    if (!word || word.length < 5 || this.surface.has(word) || /\d/.test(word)) return null;
    const max = word.length >= 8 ? 2 : 1;
    const candidates = new Set();
    for (const d of [word, ...deletes1(word)]) for (const c of this._deletes.get(d) || []) candidates.add(c);
    let best = null, tie = false;
    for (const c of candidates) {
      const dist = editDistance(word, c, max);
      if (dist > max) continue;
      const score = dist * 10 - Math.min(9, this.df.get(this.surface.get(c)) || 0) * 0.01;
      if (!best || score < best.score - 1e-9) { best = { word: c, stem: this.surface.get(c), distance: dist, score }; tie = false; }
      else if (Math.abs(score - best.score) < 1e-9 && best.stem !== this.surface.get(c)) tie = true;
    }
    if (!best || tie) return null;
    if (best.distance === 2 && word[0] !== best.word[0]) return null;
    // A substitution confined to the last two letters is a different word form
    // (transformer/transformed), not a typo.
    if (best.word.length === word.length) {
      let first = 0;
      while (first < word.length && word[first] === best.word[first]) first++;
      if (first >= word.length - 2) return null;
    }
    return { word: best.word, stem: best.stem, distance: best.distance };
  }

  /**
   * Can an unknown token still be explained by the vocabulary? Covers
   * compounds written apart or together ("eigen vector" / "eigenvector") and
   * single-edit variants of long words (British/American spellings, typos).
   * @param {Array<{w:string, stem:string}>} toks - token sequence
   * @param {number} k - index of the token to explain
   * @returns {string|null} the vocabulary stem that explains it
   */
  explain(toks, k) {
    const t = toks[k];
    if (!t) return null;
    if (this.hasStem(t.stem)) return t.stem;
    const next = toks[k + 1], prev = toks[k - 1];
    if (next && this.surface.has(t.w + next.w)) return this.surface.get(t.w + next.w);
    if (prev && this.surface.has(prev.w + t.w)) return this.surface.get(prev.w + t.w);
    // A joined word counts only if the notes use its parts as a phrase
    // ("eigen vector"), not merely both words somewhere ("localStorage").
    for (let cut = 4; cut <= t.w.length - 4; cut++) {
      const a = t.w.slice(0, cut), b = t.w.slice(cut);
      if (this.surface.has(a) && this.surface.has(b) && this.adjacent(stem(a), stem(b))) return stem(b);
    }
    const fixed = t.w.length >= 6 ? this.correct(t.w) : null;
    return fixed && fixed.distance === 1 ? fixed.stem : null;
  }
}

/**
 * Break an entry into answer units: one per curated fragment, keeping fragments
 * whole (they are written as self-contained units), plus the overview.
 * Each unit records its sentences and stems so the planner can score evidence
 * at sentence level without re-tokenizing on every question.
 */
function buildUnits(entry) {
  const units = [];
  const seen = new Set();
  const push = (cat, text, k) => {
    if (typeof text !== 'string' || !text.trim()) return;
    // Several knowledge bases repeat the overview as the first definition; say it once.
    const key = text.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return;
    seen.add(key);
    const sentences = splitSentences(text);
    const stems = new Set(wordTokens(plainForStats(text)).map(t => t.stem));
    units.push({
      id: `${entry.id}:${cat}:${k}`, cat, k, text: text.trim(), sentences, stems,
      dependent: /^(?:equivalently|thus|hence|therefore|this|these|that|however|but|so|also|moreover|furthermore|similarly|in other words)\b/i.test(text.trim()),
      pronounLead: /^(?:he|she|his|her|it|its|they|their|him)\b/i.test(text.trim()),
    });
  };
  push('summary', entry.summary, 0);
  for (const cat of CATEGORY_ORDER) (entry.f?.[cat] || []).forEach((frag, k) => push(cat, typeof frag === 'string' ? frag : frag?.text, k));
  return units;
}
