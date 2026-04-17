import { KB, kb } from './knowledge-base.js';

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
const CLOSERS = ["", " Want me to go deeper on any piece?", " Ask me for a worked example or a related concept.", " Happy to connect this to another topic if helpful."];
const TRANSITIONS = ["\n\nRelatedly, ", "\n\nClosely linked — ", "\n\nConnected idea: ", "\n\nBuilding on that, "];

export const INTENTS = {
  definition: { prototypes: ["what is X", "define X", "explain X", "what does X mean", "tell me about X", "describe X"], order: ['def', 'int', 'ex'] },
  example: { prototypes: ["give an example of X", "show me an example", "example of X", "illustrate X", "concrete case of X"], order: ['ex', 'int', 'def'] },
  formal: { prototypes: ["formal definition of X", "prove X", "theorem about X", "math behind X", "derive X", "equation for X", "formalism of X"], order: ['form', 'def', 'ex'] },
  application: { prototypes: ["applications of X", "where is X used", "uses of X", "real world X", "practical use of X", "why is X useful"], order: ['app', 'ex', 'int'] },
  comparison: { prototypes: ["difference between X and Y", "X vs Y", "compare X and Y", "how is X different from Y", "relation between X and Y"], order: ['def', 'int', 'ex'] },
  greeting: { prototypes: ["hi", "hello", "hey there", "good morning", "how are you", "what up"], order: null },
  help: { prototypes: ["help", "what can you do", "how do i use this", "what topics do you know", "menu"], order: null }
};

export function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

export function cosine(a, b) { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9); }

export function softmax(arr, t = 1) { const m = Math.max(...arr); const e = arr.map(x => Math.exp((x - m) / t)); const s = e.reduce((a, b) => a + b, 0); return e.map(x => x / s); }

export function weightedChoice(items, w) { let total = w.reduce((a, b) => a + b, 0), r = Math.random() * total; for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; } return items[items.length - 1]; }

const STOP = new Set("a an the of in on at for to with and or is are was were be been being what which who whom whose this that these those i you he she it we they them us my your his her its our their me do does did can could should would will might may has have had".split(' '));
export function tokens(t) { return t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)); }

export function bowVec(t, vocab) { const v = new Array(vocab.size).fill(0); for (const tk of tokens(t)) if (vocab.has(tk)) v[vocab.get(tk)] += 1; const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) + 1e-9; return v.map(x => x / n); }

export function entryText(e) {
  const frags = Object.values(e.f).flat().join(' ');
  return `${e.name}. ${e.summary} ${frags}`;
}

export function extractEntities(query) {
  const q = ' ' + query.toLowerCase() + ' ';
  const found = [], seen = new Set();
  for (let i = 0; i < KB.length; i++) {
    for (const a of KB[i].aliases) {
      const re = new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (re.test(q)) { if (!seen.has(KB[i].id)) { found.push(i); seen.add(KB[i].id); } break; }
    }
  }
  return found;
}

export function rankEntries(qEmb, entryEmb) {
  return entryEmb.map((e, i) => ({ i, s: cosine(qEmb, e) })).sort((a, b) => b.s - a.s);
}

export async function classifyIntent(qEmb, intentEmb) {
  const scores = {};
  for (const k of Object.keys(INTENTS)) {
    let max = -1;
    for (const pe of intentEmb[k]) { const s = cosine(qEmb, pe); if (s > max) max = s; }
    scores[k] = max;
  }
  let best = 'definition', bs = -1;
  for (const k in scores) if (scores[k] > bs) { bs = scores[k]; best = k; }
  return { intent: best, scores };
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
  const w = softmax(scores, 0.12);
  return weightedChoice(frags, w);
}

export async function compose(query, qEmb, embedCached, entryEmb, intentEmb) {
  const ranked = rankEntries(qEmb, entryEmb);
  const entities = extractEntities(query);
  const { intent } = await classifyIntent(qEmb, intentEmb);

  if (intent === 'greeting' && entities.length === 0 && ranked[0].s < 0.3) {
    return {
      text: pick(OPENERS) + "I'm a focused on-device assistant for **mathematical game theory**. Ask me about Nash equilibrium, Shapley values, auctions, evolutionary stability, or any of 55+ topics I know — all processing runs in your browser.",
      meta: [{ text: 'intent: greeting', type: 'intent' }]
    };
  }
  if (intent === 'help' && ranked[0].s < 0.3) {
    const sample = KB.slice(0, 10).map(e => e.name).join(', ');
    return {
      text: "I can discuss **mathematical game theory** entirely on your device. Try:\n• \"Define Nash equilibrium\"\n• \"Example of a zero-sum game\"\n• \"Formal definition of the Shapley value\"\n• \"Applications of mechanism design\"\n\nTopics I know include: " + sample + ", and many more (55 total).",
      meta: [{ text: 'intent: help', type: 'intent' }]
    };
  }
  if (ranked[0].s < 0.18 && entities.length === 0) {
    return {
      text: "I specialize in **mathematical game theory** and that query didn't map to anything I know well. Try asking about a concept like Nash equilibrium, the Prisoner's Dilemma, auctions, bargaining, or evolutionary strategies.",
      meta: [{ text: 'off-topic', type: 'warn' }]
    };
  }

  let topEntries;
  if (entities.length > 0) {
    topEntries = [...entities];
    for (const r of ranked.slice(0, 2)) if (!topEntries.includes(r.i) && r.s > 0.50) topEntries.push(r.i);
    topEntries = topEntries.slice(0, 3);
  } else {
    topEntries = [ranked[0].i];
    if (ranked.length > 1 && ranked[1].s > 0.42) topEntries.push(ranked[1].i);
  }

  const order = INTENTS[intent]?.order || ['def', 'int', 'ex'];

  let parts = [];
  for (let ei = 0; ei < topEntries.length; ei++) {
    const entry = KB[topEntries[ei]];
    const pieces = [];
    const cats = ei === 0 ? order : [order[0]];
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
      } else if (ei === 0) {
        connector = Math.random() < 0.6 ? `**${entry.name}** — ` : "";
      } else {
        connector = pick(TRANSITIONS).replace(/\\n/g, '\n') + `**${entry.name}**: `;
      }
      pieces.push(connector + frag);
      prev = cat;
    }
    parts.push(pieces.join(' '));
  }

  let text = pick(OPENERS) + parts[0];
  for (let i = 1; i < parts.length; i++) text += parts[i];
  text += pick(CLOSERS);

  const meta = [{ text: `intent: ${intent}`, type: 'intent' }];
  for (const idx of topEntries) meta.push({ text: KB[idx].name, type: '' });
  meta.push({ text: `sim ${ranked[0].s.toFixed(2)}`, type: 'score' });
  if (entities.length > 0) meta.push({ text: `${entities.length} entit${entities.length > 1 ? 'ies' : 'y'}`, type: 'score' });

  return { text, meta };
}
