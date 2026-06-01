import { KB, entryText, KB_ID_TO_INDEX } from './knowledge-base.js';
import { CONFIG } from './config.js';

const OPENERS = ["", "In short, ", "Here's the idea: ", "Let's unpack it. ", "Great question — ", "Consider this: "];
const CONNECTORS = {
  def_to_int: ["Intuitively, ", "Put differently, ", "Informally, ", "In essence, ", "To paraphrase, "],
  int_to_ex: ["For instance, ", "As a classic example, ", "Consider: ", "A concrete case — ", "To illustrate, "],
  ex_to_form: ["Formally, ", "Mathematically, ", "Theoretically, ", "From a rigorous standpoint, ", "In formal terms, "],
  form_to_app: ["Applications include ", "It is applied in ", "Practical uses: ", "It shows up in ", "Real-world uses: "],
  def_to_ex: ["For example, ", "As an illustration, ", "Concretely, ", "A classic case: "],
  def_to_form: ["More formally, ", "Rigorously, ", "Precisely, "],
  app_to_ex: ["For example, ", "A concrete case: ", "As an illustration, "],
  app_to_int: ["The intuition is that ", "Intuitively, "]
};
const CLOSERS = ["", " Want me to go deeper on any piece?", " Ask me for more detail on a related topic.", " Happy to connect this to another figure or discovery."];
const SEE_ALSO_PREFIXES = ["See also: ", "Related topics: ", "You might also explore: ", "Further reading: "];
const COMPARISON_OPENERS = {
  both: "Both **{A}** and **{B}** are important parts of the Islamic Golden Age. ",
  contrast: "While **{A}** and **{B}** are related, they represent different contributions. ",
  similarity: "**{A}** and **{B}** share important historical connections. ",
};
const TRANSITIONS = ["\n\nRelatedly, ", "\n\nClosely linked — ", "\n\nConnected idea: ", "\n\nBuilding on that, "];

export const INTENTS = {
  definition: { prototypes: ["what is X", "define X", "explain X", "what does X mean", "tell me about X", "describe X", "who was X", "who is X", "what was X", "explain the concept of X"], order: ['def', 'int', 'ex'] },
  example: { prototypes: ["give an example of X", "show me an example", "example of X", "illustrate X", "concrete case of X", "an example of X", "show an example", "give examples of X", "illustrate with an example"], order: ['ex', 'int', 'def'] },
  formal: { prototypes: ["formal definition of X", "prove X", "theorem about X", "math behind X", "derive X", "equation for X", "formalism of X", "mathematical definition of X", "proof of X", "formal proof of X", "rigorous definition of X", "formal treatment of X", "mathematical formulation of X"], order: ['form', 'def', 'ex'] },
  application: { prototypes: ["applications of X", "where is X used", "uses of X", "real world X", "practical use of X", "why is X useful", "how is X applied", "real-world applications of X", "where does X apply", "practical applications of X", "use cases of X"], order: ['app', 'ex', 'int'] },
  comparison: { prototypes: ["difference between X and Y", "X vs Y", "compare X and Y", "how is X different from Y", "relation between X and Y", "X versus Y", "X compared to Y", "compare X with Y"], order: ['def', 'int', 'ex'] },
  greeting: { prototypes: ["hi", "hello", "hey there", "good morning", "how are you", "what up", "hey", "hi there", "good afternoon", "good evening"], order: null },
  help: { prototypes: ["help", "what can you do", "how do i use this", "what topics do you know", "menu", "what can you help with", "list topics", "what do you know"], order: null }
};

export function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

export function cosine(a, b) { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9); }

export function softmax(arr, t = 1) { const m = Math.max(...arr); const e = arr.map(x => Math.exp((x - m) / t)); const s = e.reduce((a, b) => a + b, 0); return e.map(x => x / s); }

export function weightedChoice(items, w) { let total = w.reduce((a, b) => a + b, 0), r = Math.random() * total; for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; } return items[items.length - 1]; }

const STOP = new Set("a an the of in on at for to with and or is are was were be been being what which who whom whose this that these those i you he she it we they them us my your his her its our their me do does did can could should would will might may has have had".split(' '));
export function tokens(t) { return t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)); }

function normalizeAlias(a) {
  return a.toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+-\s+/g, '-')
    .trim();
}

export function bowVec(t, vocab) { const v = new Array(vocab.size).fill(0); for (const tk of tokens(t)) if (vocab.has(tk)) v[vocab.get(tk)] += 1; const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) + 1e-9; return v.map(x => x / n); }

export function compileAliasRegex() {
  for (const e of KB) {
    e.aliasRegex = [];
    e.aliasPartialRegex = [];
    for (const a of e.aliases) {
      const na = normalizeAlias(a);
      const escaped = na.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedPartial = escaped.replace(/\\?\s+/g, '\\s*');
      e.aliasRegex.push(new RegExp('(?:^|\\s|\\b)' + escaped + '(?:\\s|\\b|$)', 'i'));
      e.aliasPartialRegex.push(new RegExp('(?:^|\\s)' + escapedPartial + '(?:\\s|$)', 'i'));
    }
  }
}

export function extractEntities(query) {
  const q = ' ' + query.toLowerCase() + ' ';
  const found = [], seen = new Set();
  for (let i = 0; i < KB.length; i++) {
    for (let j = 0; j < KB[i].aliasRegex.length; j++) {
      if (KB[i].aliasRegex[j].test(q) && !seen.has(KB[i].id)) {
        found.push(i);
        seen.add(KB[i].id);
        break;
      }
    }
    if (seen.has(KB[i].id)) continue;
    for (let j = 0; j < KB[i].aliasPartialRegex.length; j++) {
      if (KB[i].aliasPartialRegex[j].test(q) && !seen.has(KB[i].id)) {
        found.push(i);
        seen.add(KB[i].id);
        break;
      }
    }
  }
  return found;
}

export function rankEntries(qEmb, entryEmb) {
  return entryEmb.map((e, i) => ({ i, s: cosine(qEmb, e) })).sort((a, b) => b.s - a.s);
}

export async function classifyIntent(qEmb, intentEmb) {
  const scores = {};
  const rawMax = {};
  for (const k of Object.keys(INTENTS)) {
    let max = -1;
    for (const pe of intentEmb[k]) { const s = cosine(qEmb, pe); if (s > max) max = s; }
    rawMax[k] = max;
    const countNorm = Math.log(intentEmb[k].length + 1);
    scores[k] = max * countNorm;
  }
  let best = 'definition', bs = -1;
  for (const k in scores) if (scores[k] > bs) { bs = scores[k]; best = k; }
  const confThresholds = CONFIG.THRESHOLDS.CONFIDENCE || {};
  if (confThresholds[best] !== undefined && rawMax[best] < confThresholds[best]) {
    best = 'definition';
  }
  return { intent: best, scores, rawScores: rawMax };
}

export async function selectFragment(entry, cat, qEmb, embedCached) {
  const frags = entry.f[cat];
  if (!frags || frags.length === 0) return null;
  if (frags.length === 1) return frags[0];
  const scores = [];
  for (const fr of frags) {
    const v = await embedCached(fr);
    scores.push(cosine(qEmb, v));
  }
  const catTemp = (CONFIG.COMPOSITION.FRAGMENT_TEMP_BY_CAT && CONFIG.COMPOSITION.FRAGMENT_TEMP_BY_CAT[cat])
    || CONFIG.COMPOSITION.FRAGMENT_TEMP;
  const w = softmax(scores, catTemp);
  return weightedChoice(frags, w);
}

export async function compose(query, qEmb, embedCached, entryEmb, intentEmb, lastTopic = null) {
  const ranked = rankEntries(qEmb, entryEmb);
  let entities = extractEntities(query);
  const { intent } = await classifyIntent(qEmb, intentEmb);

  if (entities.length === 0 && lastTopic !== null && lastTopic >= 0 && ranked[0].s > 0.25) {
    entities = [lastTopic];
  }

  if (intent === 'greeting' && entities.length === 0 && ranked[0].s < CONFIG.THRESHOLDS.GREETING_FALLBACK) {
    return {
      text: pick(OPENERS) + "I'm an on-device assistant focused on the **scientific and philosophical discoveries** of the Islamic Golden Age (8th–14th centuries). Ask me about Al-Khwarizmi's algebra, Ibn al-Haytham's optics, the House of Wisdom, or any of the scholars and ideas that shaped modern science.",
      meta: [{ text: 'intent: greeting', type: 'intent' }]
    };
  }
  if (intent === 'help' && ranked[0].s < CONFIG.THRESHOLDS.GREETING_FALLBACK) {
    const sample = KB.slice(0, 10).map(e => e.name).join(', ');
    return {
      text: "I can discuss the **scientific and philosophical heritage** of the Islamic Golden Age entirely on your device. Try:\n• \"Who was Al-Khwarizmi?\"\n• \"How did Ibn al-Haytham discover optics?\"\n• \"What was the House of Wisdom?\"\n• \"Explain the Tusi couple\"\n\nTopics I know include: " + sample + ", and more.",
      meta: [{ text: 'intent: help', type: 'intent' }]
    };
  }
  if (ranked[0].s < CONFIG.THRESHOLDS.OFF_TOPIC && entities.length === 0) {
    return {
      text: "I specialize in the **scientific and philosophical discoveries** of the Islamic Golden Age. Try asking about scholars like Al-Khwarizmi, Ibn Sina, Ibn al-Haytham, or concepts like algebra, optics, the astrolabe, the translation movement, or the House of Wisdom.",
      meta: [{ text: 'off-topic', type: 'warn' }]
    };
  }

  let topEntries;
  if (entities.length > 0) {
    topEntries = [...entities];
    for (const r of ranked.slice(0, 2)) if (!topEntries.includes(r.i) && r.s > CONFIG.THRESHOLDS.ENTITY_BOOST) topEntries.push(r.i);
    topEntries = topEntries.slice(0, CONFIG.COMPOSITION.MAX_ENTRIES);
  } else {
    topEntries = [ranked[0].i];
    if (ranked.length > 1 && ranked[1].s > CONFIG.THRESHOLDS.SECONDARY_ENTRY) topEntries.push(ranked[1].i);
  }

  const order = INTENTS[intent]?.order || ['def', 'int', 'ex'];

  let parts = [];
  if (intent === 'comparison' && topEntries.length >= 2) {
    const eA = KB[topEntries[0]], eB = KB[topEntries[1]];
    const openerKey = Math.random() < 0.33 ? 'similarity' : (Math.random() < 0.5 ? 'contrast' : 'both');
    const openerText = COMPARISON_OPENERS[openerKey].replace('{A}', eA.name).replace('{B}', eB.name);
    parts.push(openerText);
  }
  for (let ei = 0; ei < topEntries.length; ei++) {
    const entry = KB[topEntries[ei]];
    const pieces = [];
    const cats = (intent === 'comparison' && topEntries.length >= 2) ? order : (ei === 0 ? order : [order[0]]);
    let prev = null;
    for (let ci = 0; ci < cats.length; ci++) {
      const cat = cats[ci];
      const frag = await selectFragment(entry, cat, qEmb, embedCached);
      if (!frag) continue;
      let connector = "";
      if (prev) {
        const key = `${prev}_to_${cat}`;
        const pool = CONNECTORS[key];
        if (pool) connector = pick(pool);
      } else if (intent === 'comparison' && topEntries.length >= 2 && ei === 0) {
        connector = "";
      } else if (ei === 0 && intent !== 'comparison') {
        connector = Math.random() < 0.6 ? `**${entry.name}** — ` : "";
      } else {
        connector = pick(TRANSITIONS).replace(/\\n/g, '\n') + `**${entry.name}**: `;
      }
      pieces.push(connector + frag);
      prev = cat;
    }
    parts.push(pieces.join(' '));
  }

  let text = (intent !== 'comparison' || topEntries.length < 2 ? pick(OPENERS) : '') + parts[0];
  for (let i = 1; i < parts.length; i++) text += parts[i];

  const lastEntry = KB[topEntries[topEntries.length - 1]];
  if (lastEntry.related && lastEntry.related.length > 0) {
    const relNames = lastEntry.related.slice(0, 3).map(rid => {
      const ri = KB_ID_TO_INDEX.get(rid);
      return ri !== undefined ? KB[ri].name : rid;
    }).filter(Boolean);
    if (relNames.length > 0) {
      text += '\n\n' + pick(SEE_ALSO_PREFIXES) + relNames.join(', ') + '.';
    }
  }
  text += pick(CLOSERS);

  const meta = [{ text: `intent: ${intent}`, type: 'intent' }];
  for (const idx of topEntries) meta.push({ text: KB[idx].name, type: '' });
  meta.push({ text: `sim ${ranked[0].s.toFixed(2)}`, type: 'score' });
  if (entities.length > 0) meta.push({ text: `${entities.length} entit${entities.length > 1 ? 'ies' : 'y'}`, type: 'score' });

  return { text, meta };
}
