/**
 * responder.js — The ReLU.chat inference layer, end to end
 *
 * Pure and DOM-free, so the browser and the Node test suite run the same code:
 *
 *   message ─► social turn? (conversation.js)
 *           ─► clauses (query-analysis.js)
 *           ─► per clause: retrieval candidates (BM25 + embeddings, reciprocal
 *              rank fusion) → grounding and knowledge boundary (grounding.js)
 *           ─► topic belief update (discourse.js)
 *           ─► per clause: answer-first extraction or lattice decoding
 *              (answer-planner.js), rendered with honest framing
 *           ─► one reply, plus the topics shown and offered for the next turn
 *
 * The trained policy network stays in the loop as an advisor: its intent and
 * depth choices nudge the planner, while grounding decides what the reply is
 * about and whether the knowledge base can support it.
 */

import { Lexicon, wordTokens, isGenericWord } from './lexicon.js';
import { analyzeMessage } from './query-analysis.js';
import { DiscourseState } from './discourse.js';
import { Grounder } from './grounding.js';
import { AnswerPlanner } from './answer-planner.js';
import { interpretMessage, conversationalReply } from './conversation.js';

const SOCIAL = new Set(['greeting', 'identity', 'thanks', 'acknowledgement', 'farewell']);
const FOLLOW_UP_QTYPE = { clarify: 'define', how: 'how', why: 'why', example: 'example', summary: 'define', continue: 'define' };
const CARRY_OVER = new Set(['example', 'formula', 'application', 'why', 'how', 'who', 'when', 'where', 'condition']);
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// Words that frame a question rather than describe what the answer should say.
const FRAME_WORDS = new Set(['explain', 'explained', 'tell', 'describe', 'define', 'definition', 'mean', 'means', 'meaning', 'give',
  'show', 'know', 'want', 'need', 'like', 'please', 'help', 'question', 'concept', 'idea', 'term', 'thing', 'stuff', 'basically',
  'simple', 'simply', 'example', 'examples', 'detail', 'details', 'overview', 'intro', 'introduction', 'brief', 'briefly', 'quick']);

const escapeHTML = s => String(s).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
const bold = s => `**${s}**`;

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Text a user typed, made safe to repeat back, or null when it should not be echoed. */
function echo(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/^(?:the|a|an)\s+/i, '');
  if (!t || t.length > 60 || !/^[\p{L}\p{N}\s'’.,+#/-]+$/u.test(t) || t.split(' ').length > 7) return null;
  return escapeHTML(t);
}

/**
 * The user's own wording for what they asked about: the run of focus words
 * (allowing one small word such as "of" in between) that contains the anchors.
 */
function phraseOf(clause, anchors) {
  if (!anchors.length) return null;
  const all = clause.tokens;
  const focusAt = new Set(clause.focusTokens.map(t => t.start));
  const pos = t => all.findIndex(x => x.start === t.start);
  const idx = anchors.map(pos).filter(i => i >= 0).sort((a, b) => a - b);
  if (!idx.length) return null;
  let first = idx[0], last = idx[idx.length - 1];
  const inFocus = i => i >= 0 && i < all.length && focusAt.has(all[i].start);
  while (inFocus(first - 1) || (inFocus(first - 2) && all[first - 1].w.length <= 3 && !inFocus(first - 1) && /^(?:of|de|al|the)$/.test(all[first - 1].w))) first -= inFocus(first - 1) ? 1 : 2;
  while (inFocus(last + 1) || (inFocus(last + 2) && /^(?:of|de|al|the|and)$/.test(all[last + 1].w))) last += inFocus(last + 1) ? 1 : 2;
  for (let i = first; i <= last; i++) if (!inFocus(i) && !/^(?:of|de|al|the|and)$/.test(all[i].w)) return null;
  return echo(clause.text.slice(all[first].start, all[last].end));
}

export class Responder {
  /**
   * @param {{KB:object[], botProfile?:object, overrides?:object, calibration?:object,
   *   subject?:string, leadIns?:object, compact?:boolean, now?:()=>number}} options
   */
  constructor(options) {
    const { KB } = options;
    this.KB = KB;
    this.bot = options.botProfile || {};
    this.overrides = options.overrides || {};
    this.subject = options.subject || (this.bot.name || 'this subject').replace(/ Chat$/, '').toLowerCase();
    this.leadIns = { ex: 'For example: ', app: null, form: null, ...(options.leadIns || {}) };
    this.askFor = { ex: 'an example', form: 'the math', app: 'where it is used', ...(options.askFor || {}) };
    this.lexicon = new Lexicon(KB);
    this.grounder = new Grounder(KB, this.lexicon, { calibration: options.calibration, subject: this.subject });
    this.planner = new AnswerPlanner(KB, this.lexicon);
    this.discourse = new DiscourseState(KB, this.lexicon, { now: options.now, compact: options.compact });
    this.history = [];
    this.shown = new Set();
    this.introduced = new Set();
    this.tips = 0;
  }

  /** Other assistants' topics, for routing questions this assistant cannot answer. */
  setDirectory(directory) { this.grounder.setDirectory(directory, this.bot.id); }

  reset() {
    this.discourse.reset();
    this.history = [];
    this.shown.clear();
    this.introduced.clear();
    this.tips = 0;
  }

  /** Session view for conversation.js, backed by the topic belief. */
  _sessionView() {
    const lastTopic = this.discourse.currentTopic;
    return { lastTopic, history: this.history };
  }

  /**
   * Produce one reply.
   * @param {string} raw - the user's message
   * @param {{rank:(text:string)=>Promise<{candidates:Array<{i:number,s:number}>, denseTop:object|null, qEmb:number[]}>,
   *   advise?:(text:string, qEmb:number[], context:object)=>Promise<{intent?:string, frags?:number}|null>}} env
   * @returns {Promise<{text:string, topics:number[], offered:number[], links:Array<{title:string,url:string}>,
   *   chips:string[], trace:object}>}
   */
  async respond(raw, env) {
    const query = String(raw || '').trim().slice(0, 2000);
    const message = interpretMessage(query);
    const trace = { kind: message.kind, clauses: [] };

    if (SOCIAL.has(message.kind)) {
      const reply = conversationalReply(message, this._sessionView(), this.KB, this.bot);
      return this._finish(query, reply.text, [], [], [], trace, { kind: message.kind });
    }
    this.discourse.predict();
    this.discourse.predictVerbosity();

    if (FOLLOW_UP_QTYPE[message.kind]) {
      const topic = this.discourse.currentTopic;
      if (topic == null) {
        const reply = conversationalReply(message, this._sessionView(), this.KB, this.bot);
        return this._finish(query, reply.text, [], [], [], trace, { kind: message.kind });
      }
      if (message.kind === 'clarify') this.discourse.observeVerbosity(0.3, 0.05);
      if (message.kind === 'summary') this.discourse.observeVerbosity(0.1, 0.01);
      if (message.kind === 'continue') this.discourse.observeVerbosity(0.75, 0.05);
      const section = this._followUp(topic, message.kind);
      trace.clauses.push({ decision: 'follow-up', topics: [topic], qtype: FOLLOW_UP_QTYPE[message.kind] });
      return this._finish(query, section.text, section.presented, [], [], trace, { qtype: FOLLOW_UP_QTYPE[message.kind] });
    }

    const analysis = analyzeMessage(message.query);
    if (analysis.style.brief) this.discourse.observeVerbosity(0.1, 0.01);
    if (analysis.style.deep) this.discourse.observeVerbosity(0.92, 0.01);
    if (analysis.style.simple) this.discourse.observeVerbosity(0.3, 0.04);
    const level = this.discourse.verbosityLevel();

    // Ground every clause; names from earlier clauses are available to later pronouns.
    const recent = [];
    const grounded = [];
    for (const clause of analysis.clauses) {
      if (clause.ellipsis && clause.qtype === 'define' && CARRY_OVER.has(this.discourse.lastQtype)) clause.qtype = this.discourse.lastQtype;
      const retrieval = await env.rank(clause.text);
      const candidates = [...retrieval.candidates];
      const current = this.discourse.currentTopic;
      if (current != null && !candidates.some(c => c.i === current)) candidates.push({ i: current, s: 0 });
      const g = this.grounder.assess(clause, { discourse: this.discourse, candidates, recent, denseTop: retrieval.denseTop, semantic: !!retrieval.semantic });
      g.qEmb = retrieval.qEmb;
      for (const i of g.topics) if (!recent.includes(i)) recent.push(i);
      grounded.push(g);
      trace.clauses.push({ text: clause.text, qtype: clause.qtype, task: clause.task, decision: g.decision, topics: g.topics.map(i => this.KB[i]?.id), roles: g.roles, coverage: g.coverage && { core: +(g.best?.core ?? g.coverage.core).toFixed(3), oovShare: +g.coverage.oovShare.toFixed(3) } });
    }

    // Measurement update for the topic filter: what the user actually named.
    const evidence = new Map();
    for (const g of grounded) {
      const strength = { answer: 0.9, specialization: 0.6, weak: 0.45, mention: 0.4 }[g.decision] || 0;
      for (const i of g.topics) {
        const s = g.roles[i] === 'named' ? 1 : g.roles[i] === 'reference' ? 0.8 : strength;
        evidence.set(i, Math.max(evidence.get(i) || 0, s));
      }
    }
    this.discourse.measure(evidence);

    // The trained policy advises intent and depth for the first answerable clause.
    let advice = null;
    const firstAnswer = grounded.find(g => g.topics.length && ['answer', 'weak', 'specialization'].includes(g.decision));
    if (env.advise && firstAnswer) {
      try { advice = await env.advise(firstAnswer.clause.text, firstAnswer.qEmb, { topics: firstAnswer.topics, entities: firstAnswer.links.map(l => l.alias.index), lastTopic: this.discourse.lastPresented[0] ?? null }); }
      catch { advice = null; }
    }
    trace.advice = advice;

    const sections = [];
    const presented = [];
    const offered = [];
    const links = [];
    const multi = grounded.length > 1;
    const answeredSomething = grounded.some(g => g.topics.length && ['answer', 'weak', 'mention', 'specialization'].includes(g.decision));
    for (const g of grounded) {
      if (multi && answeredSomething && ['unknown', 'offdomain'].includes(g.decision) && !g.phrase && !['define', 'other', 'example', 'formula', 'list'].includes(g.clause.qtype)) {
        const t = trace.clauses.find(c => c.text === g.clause.text);
        if (t) t.decision = 'suppressed';
        continue;
      }
      const k = this._budget(level, g, advice, grounded.length);
      const section = this._compose(g, { k, level, multi, advice, already: new Set(presented) });
      if (!section) continue;
      // Part of the question named a variant the notes do not cover.
      const caveats = g.decision === 'answer' ? (g.caveats || []).map(c => echo(c.text)).filter(Boolean) : [];
      if (caveats.length) section.text = `My notes don't cover ${joinNames(caveats.map(bold))} specifically.\n\n${section.text}`;
      sections.push(section.text);
      for (const i of section.presented || []) if (!presented.includes(i)) presented.push(i);
      for (const i of section.offered || []) if (!offered.includes(i)) offered.push(i);
      links.push(...(section.links || []));
    }
    let text = sections.filter(Boolean).join('\n\n');
    if (!text) text = this.overrides.offTopicResponse || `I couldn't match that to the topics I cover in ${this.subject}.`;

    // One closing line at most: related topics for single, plain explanations.
    const solo = grounded.length === 1 && grounded[0].decision === 'answer' && presented.length === 1 && ['define', 'other'].includes(grounded[0].clause.qtype);
    if (solo && level !== 'brief') {
      const related = this._related(presented[0], presented);
      if (related.length) {
        text += `\n\nRelated: ${joinNames(related.map(i => this.KB[i].name))}.`;
        offered.push(...related.filter(i => !offered.includes(i)));
      }
      if (this.tips < 1 && !this.introduced.has(-1)) {
        const tip = this._tip(presented[0]);
        if (tip) { text += `\n\n${tip}`; this.tips++; }
      }
    }
    const primary = grounded.find(g => g.topics.length);
    return this._finish(query, text, presented, offered, links, trace, { qtype: primary?.clause.qtype, intent: advice?.intent });
  }

  _finish(query, text, presented, offered, links, trace, turn) {
    this.discourse.commit({ presented, offered: offered.length ? offered : presented, mentioned: this._referents(text, presented), qtype: turn.qtype || null, intent: turn.intent || null });
    for (const i of presented) this.introduced.add(i);
    this.history.push({ query, response: text, topics: presented });
    if (this.history.length > 30) this.history.shift();
    trace.presented = presented.map(i => this.KB[i]?.id);
    trace.verbosity = this.discourse.verbosity.level;
    return { text, topics: presented, offered, links, chips: presented.map(i => this.KB[i]?.name).filter(Boolean), trace };
  }

  /**
   * People and groups the reply itself names ("Founded by Nasir al-Din
   * al-Tusi"): they become referents for the next "he", "she" or "they".
   */
  _referents(text, presented) {
    const plain = String(text).replace(/\*\*/g, '');
    const toks = wordTokens(plain);
    const found = [];
    for (const l of this.grounder.link(toks, plain)) {
      const i = l.alias.index;
      if (this.lexicon.kinds[i] !== 'concept' && !presented.includes(i) && !found.includes(i) && l.quality === 1) found.push(i);
    }
    return found.slice(0, 3);
  }

  /** Units per topic from the verbosity estimate, the policy's advice and the question shape. */
  _budget(level, g, advice, clauses) {
    let k = { brief: 1, normal: 2, deep: 4 }[level];
    const t = g.topics[0];
    const fresh = Number.isInteger(t) && !this.introduced.has(t);
    if (['define', 'other'].includes(g.clause.qtype) && fresh && level !== 'brief') k += 1;
    if (level === 'normal' && advice?.frags >= 3 && g.clause.qtype !== 'define') k += 1;
    if (g.clause.task === 'compute') k = Math.max(k, 2);
    if (clauses > 1) k = Math.max(1, Math.ceil(k / clauses));
    return Math.min(5, k);
  }

  _markShown(units) { for (const u of units) this.shown.add(u.id); }

  /** Render units of one topic as paragraphs, naming the topic once. */
  _renderUnits(topic, units, { header = true, lead = null } = {}) {
    const name = this.KB[topic]?.name || 'This topic';
    const paras = [];
    units.forEach((u, n) => {
      let text = u.text;
      if (n > 0) {
        const lead = this.leadIns[u.cat];
        if (lead && units[n - 1].cat !== u.cat && !/^(?:for example|for instance|e\.g\.|example|consider|suppose|imagine)\b/i.test(text)) text = lead + text;
      }
      paras.push(text);
    });
    this._markShown(units);
    if (lead) return [lead, ...paras].join('\n\n');
    if (header && paras.length) {
      const first = paras[0];
      const mentionsName = first.toLowerCase().slice(0, 60).includes(name.toLowerCase());
      paras[0] = mentionsName ? first : `${bold(name)} — ${first}`;
    }
    return paras.join('\n\n');
  }

  /** Question words that are not the topic's own name: what the answer sentence should contain. */
  _predicate(g, topic) {
    const names = this.lexicon.entryNameStems[topic] || new Set();
    return g.evidence.filter(t => t.explained && !names.has(t.explained) && !FRAME_WORDS.has(t.w)).map(t => t.explained);
  }

  /** Planner options shared by every section. */
  _planOpts(g, topic, k, advice, extra = {}) {
    return {
      qtype: g.clause.qtype, predicate: this._predicate(g, topic), k, shown: this.shown,
      introduce: !this.introduced.has(topic) && ['define', 'other', 'who', 'how', 'why'].includes(g.clause.qtype),
      policyIntent: advice?.intent, ...extra,
    };
  }

  _compose(g, { k, multi, advice, already = new Set() }) {
    const name = i => bold(this.KB[i].name);
    const clause = g.clause;
    switch (g.decision) {
      case 'meta':
        return { text: this.overrides.helpResponse || `I explain ${this.KB.length} topics in ${this.subject}. Ask about one by name, ask for an example, or compare two topics.` };
      case 'empty':
        return { text: 'Which topic would you like to explore? Name a concept or pick a suggested question.' };
      case 'offdomain':
        return this._notCovered(g, true);
      case 'otherbot': {
        const { bot, topic } = g.otherBot;
        const phrase = echo(topic.name);
        const summary = topic.summary ? ` In short: ${topic.summary}` : '';
        return {
          text: `${phrase ? bold(phrase) : 'That'} isn't covered in my notes on ${this.subject}, but ${bold(bot.name)} covers it.${summary}`,
          // The link carries the public topic name, never the user's own words: questions stay on this device.
          links: [{ title: `Ask ${bot.name}`, url: `${bot.url}?q=${encodeURIComponent(`Explain ${topic.name}`)}` }, ...(topic.learn ? [{ title: `${topic.name} guide`, url: topic.learn }] : [])],
        };
      }
      case 'unknown':
        return this._notCovered(g, false);
      case 'mention': {
        const m = g.mentions[0];
        const phrase = echo(g.head && g.head.text) || phraseOf(clause, g.evidence.filter(t => !t.generic)) || echo(clause.focusText);
        const what = phrase ? bold(phrase) : 'that';
        const body = m.unit.sentences.length <= 2 ? m.unit.text : m.sentence;
        this._markShown([m.unit]);
        const also = g.mentions[1] ? ` It also comes up in ${name(g.mentions[1].index)}.` : '';
        return {
          text: `I don't have a dedicated topic on ${what}, but my notes on ${name(m.index)} mention it:\n\n${body}${also}`,
          presented: [m.index], offered: g.mentions.map(x => x.index),
        };
      }
      case 'specialization': {
        const t = g.topics[0];
        const units = this.planner.plan(t, this._planOpts(g, t, Math.max(1, k), advice, { introduce: true }));
        const phrase = echo(g.modifier.text);
        const lead = `My notes cover ${name(t)}, but not ${phrase ? bold(phrase) : 'that variant'} specifically. Here is what I can tell you about ${name(t)}:`;
        return { text: this._renderUnits(t, units, { lead }), presented: [t] };
      }
      case 'weak': {
        const t = g.topics[0];
        const units = this.planner.plan(t, this._planOpts(g, t, Math.max(1, k - 1), advice, { introduce: true }));
        // Say so when part of the question is not in the notes at all.
        const unexplained = (g.best?.cv?.uncovered || []).some(x => !x.generic);
        const lead = unexplained ? `I'm not sure my notes cover exactly that. The closest match is ${name(t)}:` : `The closest match in my notes is ${name(t)}:`;
        return { text: this._renderUnits(t, units, { lead }), presented: [t] };
      }
      case 'answer':
      default:
        return this._answer(g, { k, multi, advice, already });
    }
  }

  /**
   * Honest reply for a question the notes do not cover. Echoes the asked-about
   * phrase only when it is a short noun phrase, and offers the closest topics
   * the evidence supports (or the most central ones).
   */
  _notCovered(g, offDomain) {
    const name = i => bold(this.KB[i].name);
    const clause = g.clause;
    // A description of a concept ("a move that's best whatever the other player picks") is never echoed back as a name.
    const nounLike = !clause.descriptive && !g.situational && ['define', 'other', 'example', 'formula', 'application', 'list'].includes(clause.qtype);
    let phrase = nounLike || g.phrase ? (echo(g.phrase) || phraseOf(clause, g.evidence.filter(t => !t.generic)) || (nounLike ? echo(clause.focusText) : null)) : null;
    // Only a short name reads naturally in "I don't have notes on …".
    if (phrase && phrase.split(' ').length > 4) phrase = null;
    const p = g.pivots || { topics: [], hubs: [] };
    const hubs = p.hubs?.length ? p.hubs : this.grounder.hubs.slice(0, 3);
    let lead;
    if (clause.task === 'live') lead = `I don't have live or current information, and I only cover ${this.subject}.`;
    else if (clause.task === 'action') lead = `I can't do things like that: I'm a learning assistant for ${this.subject}.`;
    else if (clause.task === 'personal') lead = `I can't help with personal matters: I'm a learning assistant for ${this.subject}.`;
    else if (phrase) lead = `I don't have notes on ${bold(phrase)}, so I can't explain it reliably.`;
    else if (offDomain) lead = `That's outside what I can help with here: I only cover ${this.subject}.`;
    else if (clause.descriptive || g.situational) lead = `I couldn't match that description to a topic in my notes on ${this.subject}, so I won't guess.`;
    else lead = `I couldn't find that in my notes on ${this.subject}, so I won't guess.`;
    const current = this.discourse.currentTopic;
    let pivot;
    if (p.topics.length && p.topics[0] === current && this.introduced.has(current)) pivot = `We were looking at ${name(current)}; I can keep going with that${p.topics.length > 1 ? `, or explain ${joinNames(p.topics.slice(1).map(name))}` : ''}.`;
    else if (p.topics.length) pivot = `The closest ${p.topics.length > 1 ? 'topics I cover are' : 'topic I cover is'} ${joinNames(p.topics.map(name))}${g.situational ? ', if one of those is what you mean' : ''}.`;
    else pivot = `Topics I can explain include ${joinNames(hubs.map(name))}.`;
    return { text: `${lead} ${pivot}`, offered: p.topics.length ? p.topics : hubs };
  }

  _answer(g, { k, multi, advice, already = new Set() }) {
    const clause = g.clause;
    const topics = g.topics.filter(i => Number.isInteger(i) && this.KB[i]);
    if (!topics.length) return null;
    const name = i => bold(this.KB[i].name);
    const task = clause.task;
    const taskLead = {
      compute: t => `I can't run calculations on specific numbers, but here is how ${name(t)} works:`,
      code: t => `I don't write or run code, but here is the idea behind ${name(t)}:`,
      live: t => `I don't have live or current information, but here is what my notes say about ${name(t)}:`,
      opinion: t => `I don't have personal opinions, but here is what my notes say about ${name(t)}:`,
      action: t => `I can't do that for you, but here is what my notes say about ${name(t)}:`,
      personal: t => `I can't advise on personal matters, but here is what my notes say about ${name(t)}:`,
    }[task];

    if ((clause.qtype === 'compare' || clause.qtype === 'relation') && topics.length >= 2) {
      const main = clause.qtype === 'compare' ? this._compare(g, topics.slice(0, 2), k, advice, already) : this._relate(g, topics.slice(0, 2), k, advice);
      // "…as well as the hawk-dove game": a third topic gets its own short section.
      for (const t of topics.slice(2, 3)) {
        if (already.has(t)) continue;
        main.text += '\n\n' + this._renderUnits(t, this.planner.plan(t, this._planOpts(g, t, 1, advice, { qtype: 'define', introduce: true })));
        main.presented.push(t);
      }
      return main;
    }
    const unexplained = g.coverage?.uncovered?.filter(x => !x.generic) || [];
    if (clause.qtype === 'compare' && topics.length === 1 && !unexplained.length) {
      const within = g.links.filter(l => l.alias.index === topics[0]);
      if (within.length >= 2 || g.evidence.filter(t => !t.generic).length >= 2) {
        const parts = g.evidence.filter(t => !t.generic && t.explained);
        const hit = parts.length >= 2 ? this.planner.contrastWithin(topics[0], [parts[0].explained], [parts[parts.length - 1].explained]) : null;
        const units = this.planner.plan(topics[0], this._planOpts(g, topics[0], k + 1, advice, { introduce: true, avoid: hit ? new Set([hit.unit.id]) : undefined }));
        const lead = hit ? `${name(topics[0])} covers both. ${hit.unit.sentences.length <= 2 ? hit.unit.text : hit.sentence}` : null;
        if (hit) this._markShown([hit.unit]);
        return { text: lead ? `${lead}\n\n${this._renderUnits(topics[0], units, { header: false })}` : this._renderUnits(topics[0], units), presented: topics.slice(0, 1) };
      }
    }

    const specificQ = ['who', 'when', 'where', 'howmany'].includes(clause.qtype);
    if (topics.length > 1 && specificQ && !taskLead) {
      const identity = /^(?:so\s+|and\s+)?who\s+(?:was|is|were|are)\b/i.test(clause.text);
      const hits = topics.map(t => ({ t, hit: this.planner.extract(t, clause.qtype, this._predicate(g, t), { identity }) })).filter(x => x.hit).sort((a, b) => b.hit.score - a.hit.score);
      if (hits.length) {
        const { t, hit } = hits[0];
        this._markShown([hit.unit]);
        const leadText = hit.unit.sentences.length <= 2 ? hit.unit.text : hit.sentence;
        return { text: leadText.toLowerCase().includes(this.KB[t].name.toLowerCase().slice(0, 12)) ? leadText : `${name(t)} — ${leadText}`, presented: [t] };
      }
    }
    if (topics.length > 1 && !['relation', 'compare'].includes(clause.qtype)) {
      // Several topics asked together: a short section for each.
      const per = Math.max(1, Math.min(2, k - 1));
      const parts = topics.slice(0, 3).map(t => this._renderUnits(t, this.planner.plan(t, this._planOpts(g, t, per, advice))));
      return { text: parts.join('\n\n'), presented: topics.slice(0, 3) };
    }

    const t = topics[0];
    const relationOnly = clause.qtype === 'relation' || (clause.qtype === 'compare' && topics.length === 1);
    const uncovered = g.coverage?.uncovered?.filter(x => !x.generic) || [];
    if (relationOnly && uncovered.length) {
      // "How does that relate to cosine similarity?" where only one side is known.
      const phrase = phraseOf(clause, uncovered);
      const hit = this.planner.extract(t, 'yesno', this._predicate(g, t));
      const what = phrase ? bold(phrase) : 'that';
      const elsewhere = this.grounder.foreign.length ? this.grounder.routeElsewhere(clause, uncovered) : null;
      const pointer = elsewhere ? ` ${bold(elsewhere.bot.name)} covers ${bold(escapeHTML(elsewhere.topic.name))}.` : '';
      const links = elsewhere ? [{ title: `Ask ${elsewhere.bot.name}`, url: `${elsewhere.bot.url}?q=${encodeURIComponent(`Explain ${elsewhere.topic.name}`)}` }] : [];
      if (hit) {
        this._markShown([hit.unit]);
        return { text: `I don't have a separate topic on ${what}, but my notes on ${name(t)} touch on it:\n\n${hit.unit.sentences.length <= 2 ? hit.unit.text : hit.sentence}${pointer ? '\n\n' + pointer.trim() : ''}`, presented: [t], links };
      }
      const units = this.planner.plan(t, this._planOpts(g, t, 1, advice, { introduce: true, qtype: 'define' }));
      return { text: this._renderUnits(t, units, { lead: `I don't have a separate topic on ${what}, so I can't say how it relates to ${name(t)}.${pointer} Here is ${name(t)} in brief:` }), presented: [t], links };
    }

    const specific = ['who', 'when', 'where', 'howmany', 'yesno', 'why', 'how', 'condition'].includes(clause.qtype);
    if (specific && !taskLead) {
      const predicate = this._predicate(g, t);
      const identity = /^(?:so\s+|and\s+)?who\s+(?:was|is|were|are)\b/i.test(clause.text);
      const hit = this.planner.extract(t, clause.qtype, predicate, { identity });
      if (hit) {
        const leadText = hit.unit.sentences.length <= 2 ? hit.unit.text : hit.sentence;
        this._markShown([hit.unit]);
        // A specific question gets its answer; context only when the user wants depth.
        const extra = ['who', 'when', 'where', 'howmany'].includes(clause.qtype) ? (this.discourse.verbosity.level === 'deep' ? 1 : 0) : k - 1;
        const rest = extra > 0 ? this.planner.plan(t, this._planOpts(g, t, extra, advice, { introduce: false, avoid: new Set([hit.unit.id]) })) : [];
        const first = already.has(t) || leadText.toLowerCase().includes(this.KB[t].name.toLowerCase().slice(0, 12)) ? leadText : `${name(t)} — ${leadText}`;
        return { text: [first, rest.length ? this._renderUnits(t, rest, { header: false }) : ''].filter(Boolean).join('\n\n'), presented: [t] };
      }
      const missing = {
        who: `My notes on ${name(t)} don't say who did that. Here is what they do cover:`,
        when: `My notes on ${name(t)} don't give a date for that. Here is what they do cover:`,
        where: `My notes on ${name(t)} don't say where that was. Here is what they do cover:`,
        howmany: `My notes on ${name(t)} don't give a number for that. Here is what they do cover:`,
        yesno: `I can't confirm that directly from my notes, but here is what they say about ${name(t)}:`,
      }[clause.qtype];
      const units = this.planner.plan(t, this._planOpts(g, t, k, advice, { introduce: !this.introduced.has(t) }));
      if (missing && !(identity && this.lexicon.kinds[t] !== 'concept')) return { text: this._renderUnits(t, units, { lead: missing }), presented: [t] };
      return { text: this._renderUnits(t, units), presented: [t] };
    }

    const units = this.planner.plan(t, this._planOpts(g, t, k, advice));
    if (taskLead) return { text: this._renderUnits(t, units, { lead: taskLead(t) }), presented: [t] };
    if (clause.qtype === 'example' && units[0]?.cat === 'ex') return { text: this._renderUnits(t, units, { lead: `An example of ${name(t)}:` }), presented: [t] };
    // A topic already introduced earlier in this reply continues without a second header.
    return { text: this._renderUnits(t, units, { header: !already.has(t) }), presented: [t] };
  }

  _compare(g, [a, b], k, advice, already = new Set()) {
    const name = i => bold(this.KB[i].name);
    const bridges = this.planner.bridge(a, b);
    const lines = [];
    if (bridges.length) {
      lines.push(`Here is how my notes connect ${name(a)} and ${name(b)}:`);
      for (const h of bridges) lines.push(h.sentence);
      this._markShown(bridges.map(h => h.unit));
    } else lines.push(`My notes don't compare ${name(a)} and ${name(b)} directly, so here is each one side by side.`);
    const per = Math.max(1, Math.min(2, k - 1));
    for (const t of [a, b]) {
      // A topic introduced earlier in this reply is not introduced twice.
      if (already.has(t)) continue;
      const units = this.planner.plan(t, this._planOpts(g, t, per, advice, { qtype: 'compare', introduce: true, avoid: new Set(bridges.map(h => h.unit.id)) }));
      lines.push(this._renderUnits(t, units));
    }
    return { text: lines.join('\n\n'), presented: [a, b] };
  }

  _relate(g, [a, b], k, advice) {
    const name = i => bold(this.KB[i].name);
    const bridges = this.planner.bridge(a, b);
    if (bridges.length) {
      this._markShown(bridges.map(h => h.unit));
      const lines = [`Here is how my notes connect ${name(a)} and ${name(b)}:`, ...bridges.map(h => h.sentence)];
      const other = bridges[0].topic === a ? b : a;
      if (!this.introduced.has(other)) lines.push(this._renderUnits(other, this.planner.plan(other, this._planOpts(g, other, 1, advice, { qtype: 'define', introduce: true }))));
      return { text: lines.join('\n\n'), presented: [a, b] };
    }
    const lines = [`My notes don't connect ${name(a)} and ${name(b)} directly. Here is each one briefly:`];
    for (const t of [a, b]) lines.push(this._renderUnits(t, this.planner.plan(t, this._planOpts(g, t, 1, advice, { qtype: 'define', introduce: true }))));
    return { text: lines.join('\n\n'), presented: [a, b] };
  }

  /** A topic-specific follow-up ("why?", "give me an example", "simpler"). */
  _followUp(topic, kind) {
    const qtype = FOLLOW_UP_QTYPE[kind];
    const name = bold(this.KB[topic].name);
    const k = kind === 'summary' ? 1 : kind === 'continue' ? 2 : kind === 'clarify' ? 2 : 1 + (this.discourse.verbosityLevel() === 'deep' ? 1 : 0);
    const g = { clause: { qtype }, evidence: [] };
    if (kind === 'summary') {
      const summary = (this.lexicon.units[topic] || []).find(u => u.cat === 'summary');
      if (summary) { this._markShown([summary]); return { text: `${name}, briefly:\n\n${summary.text}`, presented: [topic] }; }
    }
    const opts = this._planOpts(g, topic, k, null, { introduce: false });
    if (kind === 'clarify') opts.qtype = 'why';
    const units = this.planner.plan(topic, opts);
    const fresh = units.filter(u => !this.shown.has(u.id));
    const lead = {
      clarify: `Another way to see ${name}:`,
      how: `Here is how ${name} works in practice:`,
      why: `Why ${name} works the way it does:`,
      example: `An example of ${name}:`,
      continue: fresh.length ? `More about ${name}:` : `That covers what my notes say about ${name}. Here is a recap:`,
    }[kind];
    return { text: this._renderUnits(topic, units, { lead }), presented: [topic] };
  }

  _related(topic, exclude) {
    const index = new Map(this.KB.map((e, i) => [e.id, i]));
    return (this.KB[topic].related || []).map(id => index.get(id)).filter(i => i !== undefined && !exclude.includes(i)).slice(0, 3);
  }

  _tip(topic) {
    const units = this.lexicon.units[topic] || [];
    const unseen = cat => units.some(u => u.cat === cat && !this.shown.has(u.id));
    const options = ['ex', 'form', 'app'].filter(unseen).map(cat => this.askFor[cat]).filter(Boolean);
    return options.length >= 2 ? `Want more? Ask for ${options[0]} or ${options[1]}.` : null;
  }
}

/** Generic words carry no topic: exported for the evaluation harness. */
export { isGenericWord, wordTokens };
