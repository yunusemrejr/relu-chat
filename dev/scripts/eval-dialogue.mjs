#!/usr/bin/env node
// Scores the chat inference layer on dev/datasets/dialogue-eval/*.json and,
// with --compare, the previous pipeline (signal layer → policy → composeV2) on
// the same questions.
//
//   node dev/scripts/eval-dialogue.mjs [--compare] [--bot id] [--verbose] [--write data/dialogue-evaluation.json]
//
// Metrics (higher is better unless noted):
//   known.topic          named or described topic is the one answered
//   known.falseAbstain   (lower is better) a covered topic got "I don't have notes on…"
//   unknown.honest       an uncovered concept was not answered as if it were covered
//   offTopic.honest      an everyday question got no topic answer
//   crossBot.routed      sent to the assistant that covers it (honest = routed or "not in my notes")
//   wh.correct           answerable who/when/where questions show the evidence; unanswerable ones say so
//   multiPart.complete   every asked-about topic is in the reply
//   turns.correct        multi-turn expectations (pronouns, ellipsis, social turns, unknowns)
import fs from 'node:fs';
import { makeResponder, ROOT, manifest } from './dialogue-harness.mjs';
import { tokens, bowVec, compileAliasRegex, composeV2, setCompositionSeed } from '../../core/nlp.js';
import { SignalLayer } from '../../core/signal-layer.js';
import { SessionMemory } from '../../core/session.js';
import { interpretMessage, conversationalReply } from '../../core/conversation.js';
import { planAnswer } from '../../policy/policy-runtime.js';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const quiet = console.warn; console.warn = () => {};

const ABSTAIN = new Set(['unknown', 'offdomain', 'otherbot', 'specialization', 'mention']);
const HONEST_MISSING = /don't say who|don't give a date|don't say where|don't give a number|can't confirm|don't name|don't have|couldn't find|couldn't match|won't guess|don't cover|not sure my notes cover/i;
const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[“”"]/g, '"').trim();

/** The previous pipeline, replicated from chatbot-engine.js before this release. */
async function legacy(botId) {
  const [{ KB, entryText }, { INTENTS }, { overrides: ov }] = await Promise.all([
    import(new URL(`data/bots/${botId}/knowledge.js`, 'file://' + ROOT)),
    import(new URL(`data/bots/${botId}/intents.js`, 'file://' + ROOT)),
    import(new URL(`data/bots/${botId}/overrides.js`, 'file://' + ROOT)),
  ]);
  const bot = manifest().bots.find(b => b.id === botId);
  const overrides = { ...ov, openers: [''], closers: [''], transitions: ['\n\n'] };
  const profile = { id: botId, name: bot.name, allowedIntents: Object.keys(INTENTS), tone: 'neutral', maxTopics: 2, creativityCeiling: 0.2 };
  const voc = new Set();
  for (const e of KB) for (const t of tokens(entryText(e))) voc.add(t);
  for (const it of Object.values(INTENTS)) for (const p of it.prototypes) for (const t of tokens(p)) voc.add(t);
  const vocab = new Map([...voc].map((w, i) => [w, i]));
  const entryEmb = KB.map(e => bowVec(entryText(e), vocab));
  const intentEmb = Object.fromEntries(Object.entries(INTENTS).map(([k, v]) => [k, v.prototypes.map(p => bowVec(p, vocab))]));
  compileAliasRegex(KB);
  const signal = new SignalLayer().initBM25(KB);
  const config = { EMBEDDING: { model: 'all-MiniLM-L6-v2' }, THRESHOLDS: { CONFIDENCE: { definition: .2, example: .22, formal: .25, application: .22, comparison: .25, greeting: .3, help: .3 } }, COMPOSITION: { FRAGMENT_TEMP: .4, MAX_ENTRIES: 2 } };
  let session = new SessionMemory(30);
  const ask = async raw => {
    const message = interpretMessage(raw);
    const conv = conversationalReply(message, session, KB, profile);
    if (conv) { session.addTurn(raw, conv.text, [], conv.topics, []); return { text: conv.text, topics: conv.topics, decision: conv.topics.length ? 'answer' : 'social', kind: message.kind }; }
    const q = message.query, qEmb = bowVec(q, vocab);
    const dp = await signal.process(q, qEmb, entryEmb, intentEmb, KB, { INTENTS, THRESHOLDS: config.THRESHOLDS, botProfile: profile, _domainPrototypeEmbs: intentEmb }, session);
    const plan = await planAnswer(q, qEmb, KB, { entities: dp.entities, intent: dp.intent.name, intentScores: dp.intent.rawScores, ranked: dp.rankings.reranked, entryEmb, lastTopic: session.lastTopic, lastTopicAge: session.lastTopicAge, followUp: dp.session.followUp, wasPreviousAmbiguous: dp.session.wasAmbiguous, overrides }, { EMBEDDING: config.EMBEDDING, botProfile: profile, _domainPrototypeEmbs: intentEmb });
    plan._recentlyUsedFragments = session.getRecentlyUsedFragments();
    setCompositionSeed(7);
    const r = await composeV2(q, qEmb, async t => bowVec(t, vocab), entryEmb, intentEmb, session.lastTopic, KB, config, overrides, plan);
    session.addTurn(raw, r.text, dp.entities, plan.topics || [], [], qEmb);
    const decision = ['off_topic', 'greeting', 'help'].includes(plan.mode) ? 'offdomain' : 'answer';
    return { text: r.text, topics: plan.topics || [], decision, kind: 'question' };
  };
  return { KB, ask, reset: () => { session = new SessionMemory(30); } };
}

async function current(botId) {
  const b = await makeResponder(botId);
  return {
    KB: b.KB,
    reset: () => b.responder.reset(),
    ask: async q => {
      const r = await b.ask(q);
      const decisions = r.trace.clauses.map(c => c.decision);
      const decision = decisions.find(d => ABSTAIN.has(d)) || decisions[0] || (r.topics.length ? 'answer' : 'social');
      const other = r.links.find(l => /\/chat\//.test(l.url));
      return { text: r.text, topics: r.topics, decision: r.trace.kind !== 'question' && !r.trace.clauses.length ? (r.topics.length ? 'answer' : 'social') : decision, kind: r.trace.kind, otherBot: other ? other.url.split('/')[2] : null, trace: r.trace };
    },
  };
}

async function score(runner, data, log) {
  const id = i => runner.KB[i]?.id;
  const m = { known: [0, 0], knownFalseAbstain: [0, 0], unknown: [0, 0], offTopic: [0, 0], crossBot: [0, 0], crossBotHonest: [0, 0], wh: [0, 0], multiPart: [0, 0], turns: [0, 0] };
  const hit = (key, ok, detail) => { m[key][0] += ok ? 1 : 0; m[key][1] += 1; if (!ok && log) log(key, detail); };
  for (const k of data.known || []) {
    runner.reset();
    const r = await runner.ask(k.query);
    hit('known', id(r.topics[0]) === k.topicId, `${k.query} → ${r.decision} ${r.topics.map(id)}`);
    const abstained = ABSTAIN.has(r.decision) && r.decision !== 'mention' && r.decision !== 'specialization' || /I don't have notes on|couldn't find that|couldn't match that/.test(r.text);
    m.knownFalseAbstain[0] += abstained ? 1 : 0; m.knownFalseAbstain[1] += 1;
    if (abstained && log) log('knownFalseAbstain', `${k.query} → ${r.decision} ${r.text.slice(0, 100).replace(/\n/g, ' ')}`);
  }
  for (const u of data.unknownConcepts || []) {
    runner.reset();
    const r = await runner.ask(u.query);
    const mentioned = (u.mentionedIn || []).length > 0;
    const ok = ABSTAIN.has(r.decision) || r.decision === 'social' || HONEST_MISSING.test(r.text) || (mentioned && r.topics.some(i => u.mentionedIn.includes(id(i))));
    hit('unknown', ok, `${u.query} → ${r.decision} ${r.topics.map(id)}`);
  }
  for (const q of data.offTopic || []) {
    runner.reset();
    const r = await runner.ask(q);
    hit('offTopic', !r.topics.length && r.decision !== 'otherbot', `${q} → ${r.decision} ${r.topics.map(id)}`);
  }
  for (const c of data.crossBot || []) {
    runner.reset();
    const r = await runner.ask(c.query);
    hit('crossBot', r.decision === 'otherbot' && r.otherBot === c.bot, `${c.query} → ${r.decision} ${r.otherBot || r.topics.map(id)}`);
    hit('crossBotHonest', ABSTAIN.has(r.decision) || !r.topics.length, `${c.query} → ${r.decision} ${r.topics.map(id)}`);
  }
  for (const w of data.whQuestions || []) {
    runner.reset();
    const r = await runner.ask(w.query);
    const ok = w.answerable ? norm(r.text).includes(norm(w.evidence)) : HONEST_MISSING.test(r.text);
    hit('wh', ok, `${w.query} [${w.answerable ? 'expects ' + w.evidence : 'unanswerable'}] → ${r.text.slice(0, 140).replace(/\n/g, ' ')}`);
  }
  for (const q of data.multiPart || []) {
    runner.reset();
    const r = await runner.ask(q.query);
    const got = new Set(r.topics.map(id));
    hit('multiPart', q.topicIds.every(t => got.has(t)), `${q.query} → ${[...got]} (want ${q.topicIds})`);
  }
  for (const conv of data.conversations || []) {
    runner.reset();
    for (const turn of conv.turns) {
      const r = await runner.ask(turn.user);
      let ok;
      if (turn.expect.social) ok = r.kind !== 'question' || !r.topics.length;
      else if (turn.expect.unknown) ok = ABSTAIN.has(r.decision) || HONEST_MISSING.test(r.text);
      else ok = r.topics.map(id).slice(0, 2).includes(turn.expect.topicId);
      hit('turns', ok, `"${turn.user}" want ${JSON.stringify(turn.expect)} → ${r.decision} ${r.topics.map(id)}`);
    }
  }
  return m;
}

// --set dialogue-test scores the held-out set written after the system was frozen.
const setName = option('--set') || 'dialogue-eval';
const files = fs.readdirSync(ROOT + 'dev/datasets/' + setName).filter(f => f.endsWith('.json')).sort();
const only = option('--bot');
const rows = [];
const totals = { current: {}, legacy: {} };
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(ROOT + 'dev/datasets/' + setName + '/' + f, 'utf8'));
  if (only && data.bot !== only) continue;
  const log = flag('--verbose') ? (key, detail) => console.log(`  ✗ [${data.bot}] ${key}: ${detail}`) : null;
  const now = await score(await current(data.bot), data, log);
  const before = flag('--compare') ? await score(await legacy(data.bot), data, null) : null;
  rows.push({ bot: data.bot, now, before });
  for (const [k, v] of Object.entries(now)) { totals.current[k] = totals.current[k] || [0, 0]; totals.current[k][0] += v[0]; totals.current[k][1] += v[1]; }
  if (before) for (const [k, v] of Object.entries(before)) { totals.legacy[k] = totals.legacy[k] || [0, 0]; totals.legacy[k][0] += v[0]; totals.legacy[k][1] += v[1]; }
}
const pct = ([a, n]) => (n ? (100 * a / n).toFixed(1) : '—').padStart(6);
const keys = ['known', 'knownFalseAbstain', 'unknown', 'offTopic', 'crossBot', 'crossBotHonest', 'wh', 'multiPart', 'turns'];
console.log('\n' + 'bot'.padEnd(30) + keys.map(k => k.slice(0, 12).padStart(13)).join(''));
for (const r of rows) {
  console.log(r.bot.padEnd(30) + keys.map(k => pct(r.now[k]).padStart(13)).join(''));
  if (r.before) console.log('  previous pipeline'.padEnd(30) + keys.map(k => pct(r.before[k]).padStart(13)).join(''));
}
console.log('ALL (current)'.padEnd(30) + keys.map(k => pct(totals.current[k] || [0, 0]).padStart(13)).join(''));
if (flag('--compare')) console.log('ALL (previous)'.padEnd(30) + keys.map(k => pct(totals.legacy[k] || [0, 0]).padStart(13)).join(''));
const out = option('--write');
if (out) {
  const frac = v => v ? { correct: v[0], total: v[1], rate: +(v[0] / v[1]).toFixed(4) } : null;
  const SETS = {
    'dialogue-eval': 'Development set: written by a separate model from the topic lists before the layer was built, then used to find and fix failures.',
    'dialogue-test': 'Held-out set in casual chat style (typos, slang). Its first run was recorded before any change; afterwards it was used to diagnose general failure causes, so the current figures are no longer blind.',
    'dialogue-final': 'Final set written after the layer was frozen, in three voices (exam student, skeptical expert, beginner). Scored once; never used for tuning.',
  };
  let report = {};
  try { report = JSON.parse(fs.readFileSync(ROOT + out, 'utf8')); } catch { report = {}; }
  report.description = 'Dialogue evaluation of the ReLU.chat inference layer in keyword-matching mode (no MiniLM download). Questions were written by separate models from topic lists, not taken from the knowledge text. The figures measure topic routing, honesty about coverage, cross-assistant routing and reference resolution; they do not measure the factual accuracy of the curated text. "previous" is the pipeline this layer replaced, run on the same questions.';
  report.metrics = {
    known: 'Covered topic answered (first topic correct)', knownFalseAbstain: 'Covered topic refused ("I don\'t have notes…") — lower is better',
    unknown: 'Uncovered concept handled honestly', offTopic: 'Everyday question given no topic answer', crossBot: 'Routed to the assistant that covers it',
    crossBotHonest: 'Other-assistant question not answered as if covered', wh: 'Who/when/where/how-many: evidence shown, or absence stated',
    multiPart: 'Every asked-about topic answered', turns: 'Multi-turn expectations met (pronouns, ellipsis, social turns, unknowns)',
  };
  report.generated = new Date().toISOString().slice(0, 10);
  report.sets = report.sets || {};
  const firstRun = report.sets[setName]?.firstRun;
  report.sets[setName] = {
    ...(firstRun ? { firstRun } : {}),
    about: SETS[setName] || setName,
    overall: Object.fromEntries(keys.map(k => [k, { current: frac(totals.current[k]), previous: frac(totals.legacy[k]) }])),
    bots: Object.fromEntries(rows.map(r => [r.bot, Object.fromEntries(keys.map(k => [k, { current: frac(r.now[k]), previous: frac(r.before?.[k]) }]))])),
  };
  fs.writeFileSync(ROOT + out, JSON.stringify(report, null, 2) + '\n');
  console.log('wrote', out, setName);
}
console.warn = quiet;
