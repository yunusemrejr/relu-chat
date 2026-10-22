/**
 * query-analysis.js — Question understanding for the ReLU.chat inference layer
 *
 * A finite-state cascade (no download, no randomness) that turns one chat
 * message into one to three clauses and describes each clause:
 *
 *   qtype      what kind of answer is wanted: define, example, formula,
 *              application, compare, relation, why, how, who, when, where,
 *              howmany, yesno, list or other
 *   focus      the phrase the question is about, with question framing and
 *              style requests ("in simple terms", "briefly") removed
 *   anaphora   pronouns and references ("it", "he", "they", "the second one",
 *              "that algorithm") for the discourse tracker to resolve
 *   ellipsis   "what about X?" turns that reuse the previous question's shape
 *   task       requests outside an explainer's abilities: computing specific
 *              numbers, writing code, live information, opinions
 *   style      brevity, depth, simplicity or formality cues
 *
 * Splitting is conservative: "the difference between X and Y" stays whole,
 * while "what is X and how does it relate to Y?" becomes two clauses.
 */

import { wordTokens, fold, STOPWORDS, isGenericWord } from './lexicon.js';

const QUESTION_START = '(?:what|whats|what\'s|how|why|when|who|whom|whose|where|which|is|are|does|do|did|can|could|should|would|will|explain|describe|define|tell|give|show|compare|list|name)';

// Coordinators that introduce a NEW question rather than a second noun.
const CLAUSE_BREAKS = [
  new RegExp(`,?\\s+(?:and|but)\\s+(?:also\\s+|then\\s+)?(?=${QUESTION_START}\\b)`, 'gi'),
  /,\s*or\s+(?=(?:is|are|does|do|did|can|could|should|would|was|were|what|how|why)\b)/gi,
  /,\s+(?=(?:is|are|does|do|did|can|could|should|would|was|were)\s+(?:it|they|that|this|he|she|there)\b)/gi,
  new RegExp(`,?\\s+also\\s+(?=${QUESTION_START}\\b)`, 'gi'),
  new RegExp(`,?\\s+(?:as well as|plus|along with)\\s+(?=(?:what|how|why|when|who|where|which)\\b)`, 'gi'),
  new RegExp(`,\\s+(?=(?:what|how|why|when|who|where)\\s+(?:is|are|was|were|does|do|did|about)\\b)`, 'gi'),
];

const PERSON_PRONOUNS = new Set(['he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself']);
const PLURAL_PRONOUNS = new Set(['they', 'them', 'their', 'theirs', 'themselves', 'both']);
const THING_PRONOUNS = new Set(['it', 'its', 'itself']);
const DEMONSTRATIVES = new Set(['this', 'that', 'these', 'those']);
const REFERENT_NOUNS = new Set(['algorithm', 'method', 'concept', 'idea', 'theorem', 'game', 'model', 'equation', 'formula',
  'technique', 'approach', 'strategy', 'process', 'book', 'work', 'thing', 'one', 'topic', 'term', 'rule', 'result',
  'principle', 'property', 'definition', 'problem', 'paradox', 'dilemma', 'solution', 'equilibrium', 'mechanism', 'api',
  'feature', 'metric', 'measure', 'test', 'method', 'framework', 'school', 'movement', 'instrument', 'invention', 'discovery',
  'man', 'woman', 'guy', 'scholar', 'person', 'scientist', 'thinker', 'author', 'writer']);
const PERSON_NOUNS = new Set(['man', 'woman', 'guy', 'scholar', 'person', 'scientist', 'thinker', 'author', 'writer']);
// Words after which a bare "that"/"this" is a pronoun ("is that true", "explain that").
const PRONOUN_AFTER = new Set(['explain', 'about', 'of', 'like', 'with', 'to', 'on', 'by', 'for', 'mean', 'means', 'is', 'was',
  'does', 'do', 'did', 'understand', 'clarify', 'describe', 'simplify', 'expand', 'into', 'behind', 'from', 'use', 'apply']);
// Words after which "that"/"this" is still a pronoun ("that means", "does that work").
const PRONOUN_BEFORE = new Set(['is', 'was', 'does', 'do', 'did', 'mean', 'means', 'meant', 'work', 'works', 'relate', 'relates',
  'compare', 'compares', 'differ', 'differs', 'apply', 'applies', 'has', 'have', 'would', 'will', 'can', 'could', 'should',
  'matter', 'matters', 'happen', 'happens', 'come', 'comes', 'hold', 'holds', 'help', 'helps', 'connect', 'connects',
  'true', 'right', 'correct', 'wrong', 'accurate', 'so', 'possible', 'important', 'useful', 'necessary', 'always', 'really',
  'good', 'bad', 'enough', 'guaranteed', 'unique', 'optimal', 'efficient', 'stable']);
// Relation and comparison wording frames a question; it is not part of what is asked about.
const RELATION_WORDS = new Set(['relate', 'relates', 'related', 'relating', 'relation', 'relationship', 'relationships', 'connect',
  'connects', 'connected', 'connection', 'connections', 'link', 'linked', 'differ', 'differs', 'different', 'difference',
  'differences', 'compare', 'compared', 'comparing', 'comparison', 'versus', 'vs', 'contrast', 'similar', 'distinguish',
  'unlike', 'between']);
const META = /\b(?:what|which|how many)\s+(?:topics|subjects|things|concepts|questions|areas)\b.{0,40}\b(?:you|u)\b|\bwhat (?:can|do|could) (?:you|u) (?:do|know|cover|explain|teach|help(?: me)? with|talk about)\b|\bwhat are you (?:able|for|good at)\b|^(?:help|menu|list topics|topics|commands|options|what can i ask)[?!.]*$|\bhow (?:do|can|should) i use (?:this|you|the (?:bot|chat|assistant))\b/i;
const ORDINALS = { first: 0, '1st': 0, former: 0, second: 1, '2nd': 1, latter: 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, last: -1 };

const FRAME_PREFIXES = [
  /^(?:so|well|ok(?:ay)?|alright|hey|hi|hello|um+|uh+|hmm+|also|now|then|right|and|but|oh)\b[,!.\s]*/i,
  /^(?:please|pls|plz|kindly)\s+/i,
  /^(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+|kindly\s+)?(?:help\s+me\s+)?/i,
  /^i\s+(?:want|would like|'d like|wanna|need|wish|hope)\s+to\s+(?:know|understand|learn|see|ask)\s*(?:about|more about|regarding)?\s*/i,
  /^i(?:'m| am)\s+(?:curious|wondering|confused)\s+(?:about|regarding|whether|if|what|how|why)?\s*/i,
  /^(?:do you know|tell me(?:\s+more)?(?:\s+about)?|explain(?:\s+to\s+me)?|describe|define|clarify|summari[sz]e|elaborate(?:\s+on)?|go over|walk me through|teach me(?:\s+about)?|show me|give me|help me understand|what do you know about|what can you tell me about|talk about|discuss|introduce)\b\s*/i,
  /^(?:what|who|when|where|which|why|how)\s+(?:exactly\s+)?(?:is|are|was|were|does|do|did|can|could|would|should|has|have|had)\b\s*/i,
  /^(?:what's|whats|who's|whos|where's|how's|hows)\s+/i,
  /^(?:what|who|which)\s+/i,
  /^(?:how|why|when|where)\s+/i,
  /^(?:is|are|does|do|did|can|could|would|should|was|were|has|have|will)\s+/i,
  /^(?:an?|the|some|any)\s+/i,
  /^(?:an?\s+)?(?:examples?|instances?|illustrations?)\s+(?:of|for)\s+/i,
  /^(?:the\s+)?(?:definition|meaning|formula|equation|math|maths|proof|intuition|idea|concept|history|origin|origins|purpose|point|role|significance|applications?|uses?|use cases?|advantages?|disadvantages?|pros and cons|limitations?|differences?|relationship|relation|connection|basics|overview|notion|theory)\s+(?:of|for|behind|between|in|to|about)\s+/i,
  /^(?:about|regarding|on)\s+/i,
];
const FRAME_SUFFIXES = [
  /\s*[?!.…]+$/,
  /\s+(?:please|pls|plz|thanks|thank you|thx)$/i,
  /\s+(?:in (?:simple|plain|layman'?s?|easy|basic|everyday) (?:terms|english|words|language)|simply|for (?:a )?(?:beginners?|dummies|kids|a child|a novice)|like (?:i'?m|i am) (?:five|5|a child|a beginner)|eli5|in a nutshell|briefly|in brief|in short|in detail|in more detail|in depth|step by step|intuitively|with (?:an |some )?examples?|again|exactly|actually|really|precisely|in practice|in real life|in the real world)$/i,
  /\s+(?:mean|means|work|works|do|does|stand for|refer to|refers to|used for|good for|is|are|about|exactly|actually)$/i,
];

const STYLE = {
  brief: /\b(?:brief|briefly|short(?:ly)?|quick(?:ly)?|tl;?dr|in one (?:sentence|line)|summary|summari[sz]e|in a nutshell|gist|concise(?:ly)?|keep it short|short version)\b/i,
  deep: /\b(?:in (?:more |great |full )?detail|detailed|in[- ]depth|thorough(?:ly)?|comprehensive|deep dive|elaborate|everything about|full explanation|step by step|go deeper)\b/i,
  simple: /\b(?:simple|simply|simpler|plain (?:english|terms|language)|layman'?s?|eli5|beginners?|for dummies|like (?:i'?m|i am) (?:five|5)|easy|easier|intuitive(?:ly)?|intuition)\b/i,
  formal: /\b(?:formal(?:ly)?|rigorous(?:ly)?|mathematical(?:ly)?|precise(?:ly)?)\b/i,
};

const QTYPE_RULES = [
  ['compare', /\bdifferences?\s+(?:between|among|of|in|from)\b|\bthe differences?\s*[?!.]*$|\bdiffer(?:s|ent|ence)?\s+(?:from|than|to)\b|\bhow (?:is|are|does|do|did)\b.{1,60}\b(?:differ|different)\b|\bdistinct from\b|\b(?:compare|compared|comparing|comparison|versus|vs\.?|contrast|distinguish|better than|worse than|similar to|same as|similarities between|unlike)\b/i],
  ['relation', /\b(?:relate|relates|related to|relation|relationship|connect(?:ed|s)? (?:to|with)|connection|linked to|link between|tie into|ties into|have to do with|has to do with)\b/i],
  ['who', /^(?:who|whom|whose)\b|\bwho\s+(?:invented|created|discovered|proposed|introduced|developed|coined|founded|came up with|wrote|built|proved|named|designed|was behind|is behind)\b|\b(?:inventor|founder|discoverer|creator|originator|father of|mother of)\b|\bnamed after\b/i],
  // Present-tense "when"/"where" ("When does the server send a 304?", "Where do
  // service workers need to run?") asks for a condition, not a date or a place.
  ['condition', /^(?:when|where)\s+(?:should|do|does|would|can|could|might|must|is|are|will)\b(?!.{0,60}\b(?:born|founded|built|written|invented|discovered|located|based|buried|died|lived?|published|introduced|used|applied|useful|show up|appear)\b)|^when\s+to\b/i],
  ['when', /^when\b|\b(?:what|which)\s+(?:year|years|century|centuries|decade|era|period|date|age)\b|\bhow long ago\b|\b(?:year|century) (?:was|did|were)\b/i],
  ['where', /^where\b(?!.{0,50}\b(?:used|applied|useful|show up|appear|come in)\b)|\b(?:which|what)\s+(?:city|cities|country|countries|place|region|town|university|school|institution|empire|court)\b/i],
  ['howmany', /^how\s+(?:many|much)\b/i],
  ['why', /^why\b|\bwhy\s+(?:is|are|does|do|did|would|should|was|were|can|not)\b|\bwhat(?:'s| is) the (?:point|reason|purpose|motivation)\b|\bhow come\b/i],
  ['formula', /\b(?:formula|formulae|formulas|equation|equations|derive|derivation|proofs?|prove|proves|formal(?:ly)? (?:definition|statement|version)|mathematical(?:ly)?|math(?:s)? behind|notation|expression for|in symbols|write (?:that|this|it) down)\b/i],
  ['example', /\b(?:examples?|instances?|illustrate|illustration|demonstrate|worked|concrete case|sample)\b|^(?:like what|for example|for instance)\b/i],
  ['application', /\b(?:used for|use cases?|applications?|applied|apply it|in practice|real[- ]world|real life|practical(?:ly)?|useful|good for|where (?:is|are|do|does|would|can) .{1,40}\b(?:used|applied|useful|show up|appear))\b/i],
  // "How do I fix/avoid/use it?" asks for practice, which lives in the application fragments.
  ['application', /^how\s+(?:do|can|should|would|could|might)\s+(?:i|we|you|one|people)\s+(?:fix|prevent|avoid|reduce|combat|handle|deal with|solve|mitigate|stop|detect|diagnose|spot|tell|check|improve|choose|pick|tune|use|apply|get rid of)\b|^how to\s+(?:fix|prevent|avoid|reduce|combat|handle|deal with|mitigate|stop|detect|diagnose|spot|tell|check|improve|choose|pick|tune|use|apply)\b/i],
  ['how', /^how\s+(?:does|do|is|are|can|could|would|should|did|to|was|were)\b|\bhow\s+(?:does|do)\b.{0,60}\bwork\b|^how\b/i],
  ['list', /^(?:list|enumerate)\b|\bwhat are (?:some|the) (?:main |different |key |major )?(?:types|kinds|examples|categories|forms|variants|properties|steps)\b|\bwhich topics\b/i],
  ['yesno', /^(?:is|are|does|do|did|can|could|will|would|should|was|were|has|have|isn'?t|aren'?t|doesn'?t|don'?t|didn'?t|must|might)\b/i],
  ['define', /^(?:what|whats|what's|define|explain|describe|tell|meaning|definition|overview|intro|introduce|summari[sz]e|summary|teach|walk|go)\b|\bmean(?:s|ing)?\b|^(?:i (?:want|would like|need) to (?:know|understand|learn))\b/i],
];

const INTENT_FOR = { define: 'definition', example: 'example', formula: 'formal', application: 'application', compare: 'comparison', condition: 'application' };

const TASKS = {
  action: /^(?:please\s+|can you\s+|could you\s+)?(?:book|reserve|order|buy|purchase|call|text|email|send|schedule|remind|play|navigate|find me|get me|set (?:an? )?(?:alarm|timer|reminder)|cancel|pay)\b/i,
  personal: /\b(?:my|our)\s+(?:friend|friends|boyfriend|girlfriend|partner|wife|husband|mom|mum|dad|mother|father|parents|family|boss|coworker|colleague|relationship|feelings|crush|ex)\b/i,
  compute: /\b(?:calculate|compute|solve|evaluate|work out|find|determine|simplify|what(?:'s| is))\b/i,
  code: /\b(?:write|show|give|generate|create|implement|code up|debug|fix|refactor)\b.{0,40}\b(?:code|program|script|function|class|snippet|implementation|python|javascript|typescript|java|c\+\+|sql|regex|html|css|rust)\b|^how\s+(?:do|can|would|should)\s+(?:i|you|we)\b.{0,60}\b(?:in|using|with)\s+(?:python|javascript|typescript|java|c\+\+|rust|golang|matlab)\b/i,
  live: /\b(?:weather|forecast|stock price|share price|exchange rate|breaking news|news today|today'?s (?:news|price|weather|score)|latest (?:news|version|release|update|updates|developments|research|papers?)|current (?:price|version|events|news|status)|right now|this week'?s|tonight|tomorrow|this weekend|next (?:train|bus|flight|match|game|episode))\b/i,
  opinion: /\b(?:what do you think|your (?:opinion|view|take|favou?rite)|do you (?:like|love|prefer|believe|agree|enjoy)|which (?:one )?(?:do you|would you) (?:prefer|recommend|choose|pick))\b/i,
};

/** Count numeric operands so "how do I compute a dot product?" is not a computation request. */
function numericContent(text) {
  const numbers = (text.match(/(?<![a-z])-?\d+(?:\.\d+)?/gi) || []).length;
  const literal = /\[\s*-?\d|\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d|\d\s*[-+*/×÷^=]\s*-?\d/.test(text);
  return numbers >= 2 || literal;
}

function protectMath(text) {
  const saved = [];
  const masked = text.replace(/\$[^$]*\$/g, m => `\u0000${saved.push(m) - 1}\u0000`);
  return { masked, restore: s => s.replace(/\u0000(\d+)\u0000/g, (m, i) => saved[+i]) };
}

// Chat shorthand that hides question words ("wat is", "how do u").
const SHORTHAND = [[/\b(?:wat|wut|wht|whta)\b/gi, 'what'], [/\bwats\b/gi, 'whats'], [/(?<=^|\s)u(?=\s+[a-z])/gi, 'you'], [/\bur\b/gi, 'your'],
  [/\babt\b/gi, 'about'], [/\bdiff\b/gi, 'difference'], [/\bppl\b/gi, 'people'], [/\b(?:bc|cuz|coz)\b/gi, 'because'],
  [/\bthru\b/gi, 'through'], [/\bw\/(?=\s)/gi, 'with'], [/\bhw\b/gi, 'how'], [/\bexplian\b/gi, 'explain'], [/\bwhta\b/gi, 'what']];

/** Expand common chat shorthand without touching technical tokens. */
export function expandShorthand(text) {
  let s = String(text || '');
  for (const [re, to] of SHORTHAND) s = s.replace(re, to);
  return s;
}

// A first-person statement that sets up the question ("i have 100 columns, how do i…").
const CONTEXT_STATEMENT = /^(?:so\s+|ok(?:ay)?\s+|well\s+)?(?:i|we|my|our|i'm|im|i've|ive|i am|we're|we've|there's|there are|here's)\b(?!.*\?\s*$)/i;
// A clause that only frames the previous one ("…, what's that called", "…, how do you write that down").
const FRAME_ONLY = /^(?:so\s+|and\s+)?(?:what(?:'?s| is)? (?:that|this|it) called|what do (?:you|people) call (?:that|this|it)|what(?:'s| is) the (?:name|term|word) for (?:that|this|it)|is there a (?:name|term|word) for (?:that|this|it)|how do (?:you|i|we) (?:write|express|denote|formali[sz]e) (?:that|this|it)(?: down)?|how does (?:that|this|it) work|what(?:'s| is) (?:that|this)|which (?:one|topic) is (?:that|this)|(?:please\s+)?(?:convince me|prove (?:it|that|this)|show me(?: why| how)?|back (?:it|that) up|justify (?:it|that)|explain (?:it|that|why|how)|elaborate|go on|tell me more|be (?:more )?specific|give (?:me )?(?:an |some )?examples?|with (?:an |some )?examples?|in (?:more )?detail|in simple terms|briefly|keep it short)(?: please)?)\s*[?.!]*$/i;

/**
 * Split a message into at most three question clauses.
 * @param {string} text
 * @returns {string[]}
 */
export function splitClauses(text) {
  const { masked, restore } = protectMath(expandShorthand(String(text || '').trim()));
  let parts = masked.split(/(?<=[?!;])\s+|(?<=\.)\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
  for (const re of CLAUSE_BREAKS) parts = parts.flatMap(p => p.split(re)).map(s => s.trim()).filter(Boolean);
  // Clauses without any content word ("and?", "thanks!") attach to their neighbour.
  const merged = [];
  for (const p of parts) {
    const content = wordTokens(p).some(t => !STOPWORDS.has(t.w) && !isGenericWord(t.w));
    if (!content && merged.length) merged[merged.length - 1] += ' ' + p;
    else merged.push(p);
  }
  // Setup statements join the question that follows; framing clauses join the description before them.
  const joined = [];
  for (let k = 0; k < merged.length; k++) {
    const part = merged[k];
    if (k + 1 < merged.length && CONTEXT_STATEMENT.test(part) && !/\?\s*$/.test(part)) { merged[k + 1] = `${part.replace(/[,;.]\s*$/, '')}, ${merged[k + 1]}`; continue; }
    if (joined.length && FRAME_ONLY.test(part)) { joined[joined.length - 1] = `${joined[joined.length - 1].replace(/[,;.]\s*$/, '')}, ${part}`; continue; }
    joined.push(part);
  }
  if (joined.length > 3) joined.splice(2, joined.length - 2, joined.slice(2).join(' '));
  return joined.map(restore);
}

function stripFrame(text) {
  let s = text.trim();
  for (let pass = 0; pass < 6; pass++) {
    const before = s;
    for (const re of FRAME_PREFIXES) s = s.replace(re, '');
    for (const re of FRAME_SUFFIXES) s = s.replace(re, '');
    s = s.trim();
    if (s === before) break;
  }
  return s;
}

// "keep it short", "put it simply", "sum it up": "it" is the answer, not a topic.
const IDIOM_VERBS = new Set(['keep', 'make', 'put', 'say', 'explain', 'break', 'sum', 'dumb', 'spell', 'lay', 'write', 'phrase', 'word']);
const IDIOM_AFTER = new Set(['short', 'shorter', 'brief', 'briefer', 'simple', 'simpler', 'simply', 'quick', 'concise', 'again', 'down', 'up', 'out', 'like', 'plainly', 'clearly', 'differently', 'another']);

function findAnaphora(tokens, raw = '') {
  const found = [];
  if (DESCRIPTIVE.test(fold(raw)) || /\b(?:write|express|denote) (?:that|this|it) down\b/i.test(raw)) return found;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], next = tokens[i + 1], prev = tokens[i - 1];
    if (t.w === 'it' && prev && next && IDIOM_VERBS.has(prev.w) && IDIOM_AFTER.has(next.w)) continue;
    if (PERSON_PRONOUNS.has(t.w)) { found.push({ word: t.w, kind: 'person', start: t.start, end: t.end }); continue; }
    if (PLURAL_PRONOUNS.has(t.w)) { found.push({ word: t.w, kind: 'plural', start: t.start, end: t.end }); continue; }
    if (THING_PRONOUNS.has(t.w)) { found.push({ word: t.w, kind: 'thing', start: t.start, end: t.end }); continue; }
    if (t.w === 'the' && next && ORDINALS[next.w] !== undefined) {
      const after = tokens[i + 2];
      if (next.w === 'former' || next.w === 'latter' || (after && /^(?:one|topic|item|thing|concept|option)s?$/.test(after.w)) || !after) {
        found.push({ word: `the ${next.w}`, kind: 'ordinal', index: ORDINALS[next.w], start: t.start, end: (after && /^(?:one|topic|item|thing|concept|option)$/.test(after.w) ? after : next).end });
        i++;
      }
      continue;
    }
    if (DEMONSTRATIVES.has(t.w)) {
      if (next && REFERENT_NOUNS.has(next.w)) {
        found.push({ word: `${t.w} ${next.w}`, kind: PERSON_NOUNS.has(next.w) ? 'person' : (t.w === 'these' || t.w === 'those') ? 'plural' : 'thing', start: t.start, end: next.end });
        i++;
        continue;
      }
      if (t.w === 'this' || t.w === 'that') {
        const pronominal = !next || PRONOUN_BEFORE.has(next.w) || (prev && PRONOUN_AFTER.has(prev.w) && (!next || PRONOUN_BEFORE.has(next.w) || STOPWORDS.has(next.w) && !['the', 'a', 'an', 'every', 'each', 'all', 'some', 'any', 'no'].includes(next.w)));
        if (pronominal) found.push({ word: t.w, kind: 'thing', start: t.start, end: t.end });
      } else if (!next || PRONOUN_BEFORE.has(next.w)) {
        found.push({ word: t.w, kind: 'plural', start: t.start, end: t.end });
      }
    }
  }
  return found;
}

/**
 * Describe one clause.
 * @param {string} text
 * @returns {{text:string, qtype:string, intentHint:string|null, focusText:string, focusTokens:object[],
 *   tokens:object[], anaphora:object[], ellipsis:object|null, task:string|null,
 *   style:{brief:boolean, deep:boolean, simple:boolean, formal:boolean}, meta:boolean}}
 */
export { RELATION_WORDS };

// Leading discourse fillers do not change the question type.
function stripFillers(lower) {
  return lower.replace(/^(?:(?:so|well|ok(?:ay)?|alright|and|but|also|now|then|oh|hmm+|um+|uh+|right|great|cool|thanks|thank you)\b[,!.\s]*)+/, '');
}

/**
 * What kind of answer a clause wants. Grounding re-runs this with topic names
 * masked, so "explain the Bellman equation" is a definition request, not a
 * request for a formula.
 * @param {string} text
 */
export function classifyQtype(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const core = stripFillers(fold(raw));
  let qtype = 'other';
  for (const [name, re] of QTYPE_RULES) if (re.test(core)) { qtype = name; break; }
  if (qtype === 'yesno' && /^(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?(?:explain|describe|define|tell|give|show|walk|help|clarify|summari[sz]e|go)\b/.test(core)) {
    qtype = 'other';
    for (const [name, re] of QTYPE_RULES) if (name !== 'yesno' && re.test(core.replace(/^(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?/, ''))) { qtype = name; break; }
  }
  if (qtype === 'other' && wordTokens(raw).some(t => !STOPWORDS.has(t.w))) qtype = 'define';
  return qtype;
}

// "What's it called when…", "the thing where…": the user describes a concept they cannot name.
const DESCRIPTIVE = /\b(?:what(?:'?s| is)? (?:that|this|it) called|what do (?:you|people) call|what(?:'s| is) the (?:name|term|word) for|is there a (?:name|term|word) for|the thing (?:where|when|that)|called when|whats? that process called|what(?:'s| is) that process)\b/i;

export function analyzeClause(text) {
  const raw = expandShorthand(String(text || '')).replace(/\s+/g, ' ').trim();
  const lower = fold(raw).replace(/\s+/g, ' ').trim();
  const style = Object.fromEntries(Object.entries(STYLE).map(([k, re]) => [k, re.test(lower)]));
  const core = stripFillers(lower);
  const qtype = classifyQtype(raw);

  let ellipsis = null;
  const ell = core.match(/^(?:(?:and|so)\s+)?(?:what|how)\s+about\s+(.+?)\s*[?!.]*$/) || core.match(/^and\s+(?:for\s+|with\s+)?(.+?)\s*\?+$/) || core.match(/^(?:same|ditto)\s+(?:for|with)\s+(.+?)\s*[?!.]*$/);
  if (ell && !/\b(?:is|are|does|do|did|was|were|can|could|would|should|will|has|have)\b/.test(ell[1])) ellipsis = { rest: ell[1] };

  let task = null;
  if (TASKS.action.test(core)) task = 'action';
  else if (TASKS.personal.test(core)) task = 'personal';
  else if (TASKS.compute.test(core) && numericContent(raw)) task = 'compute';
  else if (TASKS.code.test(core)) task = 'code';
  else if (TASKS.live.test(core)) task = 'live';
  else if (TASKS.opinion.test(core)) task = 'opinion';

  const tokens = wordTokens(raw);
  const anaphora = findAnaphora(tokens, raw);
  // The focus is a substring of the clause; keep token offsets relative to the clause.
  const focusText = stripFrame(ellipsis ? ellipsis.rest : raw);
  const at = focusText ? fold(raw).lastIndexOf(fold(focusText)) : -1;
  const from = at >= 0 ? at : 0, to = at >= 0 ? at + focusText.length : raw.length;
  const focusTokens = tokens.filter(t => t.start >= from && t.end <= to && !STOPWORDS.has(t.w) && !RELATION_WORDS.has(t.w));
  const meta = META.test(core);
  const descriptive = DESCRIPTIVE.test(core);
  // Definition requests ("what is X", "explain X") name the concept directly, and so
  // does a bare noun phrase ("Cramer's rule for solving systems?").
  const nominal = !/\b(?:is|are|was|were|does|do|did|dont|don't|doesnt|doesn't|can|could|should|would|will|has|have|had|why|how|when|where|who|which)\b/i.test(core) && /^[a-z0-9]/i.test(core);
  const framed = !descriptive && (nominal || /^(?:what(?:'s| is| are| was| were)|whats|define|explain|describe|tell me about|meaning of|definition of|what does|what do)\b/i.test(core));
  return { text: raw, qtype, intentHint: INTENT_FOR[qtype] || null, focusText, focusTokens, tokens, anaphora, ellipsis, task, style, meta, descriptive, framed };
}

/**
 * Analyze a whole message.
 * @param {string} text
 * @returns {{clauses: ReturnType<typeof analyzeClause>[], style: object}}
 */
export function analyzeMessage(text) {
  const clauses = splitClauses(text).map(analyzeClause);
  const style = { brief: false, deep: false, simple: false, formal: false };
  for (const c of clauses) for (const k of Object.keys(style)) style[k] = style[k] || c.style[k];
  return { clauses, style };
}
