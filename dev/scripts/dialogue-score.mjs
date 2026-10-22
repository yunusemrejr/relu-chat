// Scoring shared by the Node evaluation (dev/scripts/eval-dialogue.mjs) and the
// in-browser neural-matching evaluation (dev/eval/neural.html). No Node APIs.
export const ABSTAIN = new Set(['unknown', 'offdomain', 'otherbot', 'specialization', 'mention']);
export const HONEST_MISSING = /don't say who|don't give a date|don't say where|don't give a number|can't confirm|don't name|don't have|couldn't find|couldn't match|won't guess|don't cover|not sure my notes cover/i;
export const KEYS = ['known', 'knownFalseAbstain', 'unknown', 'offTopic', 'crossBot', 'crossBotHonest', 'wh', 'multiPart', 'turns'];
const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[“”"]/g, '"').trim();

/** Adapt a responder ({KB, responder, ask}) to the runner interface scored below. */
export function wrapResponder(b) {
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

export async function score(runner, data, log) {
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
