#!/usr/bin/env node
// Split-conformal calibration of the knowledge boundary (core/grounding.js).
//
// Calibration questions are generated from each knowledge base itself:
//   named        every topic asked by name or alias with several templates,
//                plus a one-letter typo of its longest word
//   descriptive  the topic described with words from its overview but
//                without its name ("what is it called when …")
// For descriptive questions the nonconformity score is s = 1 − coverage of
// the best retrieved topic. With n scores and level α, the conformal quantile
// q = s_(⌈(n+1)(1−α)⌉) bounds the chance that a new exchangeable known
// question scores above q by α. The "not in my notes" boundary is therefore
// set at coverage 1 − q, but never stricter than the hand-set default, so
// calibration can only make an assistant more willing to answer.
//
//   node dev/scripts/calibrate-boundary.mjs [--write]
import fs from 'node:fs';
import { makeResponder, ROOT, manifest } from './dialogue-harness.mjs';
import { analyzeClause } from '../../core/query-analysis.js';
import { wordTokens, isGenericWord, STOPWORDS } from '../../core/lexicon.js';
import { DEFAULT_CALIBRATION } from '../../core/grounding.js';

console.warn = () => {};
const ALPHA = { weak: 0.02, answer: 0.2 };
const NAMED = ['what is {x}?', 'explain {x}', '{x}?', 'tell me about {x}', 'how does {x} work?', 'give me an example of {x}', 'why does {x} matter?', 'whats the formula for {x}'];
const DESCRIBED = ['what is it called when {d}?', 'explain the idea that {d}', 'what do you call {d}'];

// Swap two adjacent letters inside the longest word (never across a hyphen or space).
function typo(alias) {
  const parts = alias.split(/([^A-Za-z]+)/);
  const k = parts.reduce((b, w, i) => (/^[A-Za-z]+$/.test(w) && w.length > (parts[b] || '').length ? i : b), 0);
  const w = parts[k];
  if (!w || w.length < 6) return null;
  const m = Math.floor(w.length / 2);
  parts[k] = w.slice(0, m - 1) + w[m] + w[m - 1] + w.slice(m + 1);
  return parts.join('');
}

function describe(entry) {
  const names = new Set([entry.name, ...(entry.aliases || [])].flatMap(a => wordTokens(a).map(t => t.stem)));
  const words = wordTokens(entry.summary || '').filter(t => !STOPWORDS.has(t.w) && !isGenericWord(t.w) && !names.has(t.stem) && t.w.length > 2);
  if (words.length < 3) return null;
  return words.slice(0, 6).map(t => t.w).join(' ');
}

function quantile(scores, alpha) {
  const s = [...scores].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  const rank = Math.min(n, Math.ceil((n + 1) * (1 - alpha)));
  return s[rank - 1];
}

const out = { version: 1, generated: new Date().toISOString().slice(0, 10), method: 'Split conformal prediction on questions generated from each knowledge base (named, typo and descriptive). Thresholds are coverage levels of the best retrieved topic; calibrated values never exceed the defaults.', alpha: ALPHA, defaults: DEFAULT_CALIBRATION, bots: {} };
for (const bot of manifest().bots) {
  const b = await makeResponder(bot.id, { calibration: null, policy: false });
  const g = b.responder.grounder;
  const named = [], described = [];
  b.KB.forEach((e, i) => {
    const aliases = [...new Set([e.name, ...(e.aliases || [])])].filter(a => a.length > 3 && !/[(),]/.test(a)).slice(0, 3);
    aliases.forEach((a, k) => {
      named.push({ q: NAMED[(i + k) % NAMED.length].replace('{x}', a), i });
      const t = typo(a);
      if (t && k === 0) named.push({ q: `what is ${t}?`, i });
    });
    const d = describe(e);
    if (d) for (const tpl of DESCRIBED) described.push({ q: tpl.replace('{d}', d), i });
  });
  const run = async item => {
    b.responder.reset();
    const clause = analyzeClause(item.q);
    const r = await b.env.rank(clause.text);
    return g.assess(clause, { discourse: b.responder.discourse, candidates: r.candidates, recent: [] });
  };
  const abstain = d => ['unknown', 'offdomain', 'otherbot'].includes(d);
  let namedAbstain = 0, namedRight = 0;
  for (const item of named) { const res = await run(item); if (abstain(res.decision)) { namedAbstain++; if (process.argv.includes("--verbose")) console.log("   abstained:", item.q, "→", res.decision, b.KB[item.i].id); } if (res.topics[0] === item.i) namedRight++; }
  const scores = [];
  let descAbstain = 0, descRight = 0;
  for (const item of described) {
    const res = await run(item);
    if (abstain(res.decision)) descAbstain++;
    if (res.topics[0] === item.i) descRight++;
    if (res.best && res.links.length === 0) scores.push(1 - res.best.core);
  }
  const qWeak = quantile(scores, ALPHA.weak), qAnswer = quantile(scores, ALPHA.answer);
  const thresholds = {
    weak: +Math.min(DEFAULT_CALIBRATION.weak, qWeak == null ? 1 : 1 - qWeak).toFixed(3),
    answer: +Math.min(DEFAULT_CALIBRATION.answer, qAnswer == null ? 1 : 1 - qAnswer).toFixed(3),
  };
  thresholds.weak = Math.max(0.15, thresholds.weak);
  thresholds.answer = Math.max(thresholds.weak + 0.1, thresholds.answer);
  out.bots[bot.id] = {
    thresholds,
    conformal: { weak: qWeak == null ? null : +(1 - qWeak).toFixed(3), answer: qAnswer == null ? null : +(1 - qAnswer).toFixed(3), n: scores.length },
    calibrationSet: {
      named: { n: named.length, abstained: namedAbstain, topicCorrect: +(namedRight / named.length).toFixed(3) },
      descriptive: { n: described.length, abstained: descAbstain, topicCorrect: +(descRight / Math.max(1, described.length)).toFixed(3) },
    },
  };
  console.log(`${bot.id.padEnd(30)} named ${named.length} (abstained ${namedAbstain}, topic ${(100 * namedRight / named.length).toFixed(1)}%)  descriptive ${described.length} (abstained ${descAbstain}, topic ${(100 * descRight / Math.max(1, described.length)).toFixed(1)}%)  conformal weak=${out.bots[bot.id].conformal.weak} answer=${out.bots[bot.id].conformal.answer} → ${JSON.stringify(thresholds)}`);
}
if (process.argv.includes('--write')) {
  fs.writeFileSync(ROOT + 'data/boundary-calibration.json', JSON.stringify(out, null, 2) + '\n');
  console.log('wrote data/boundary-calibration.json');
}
