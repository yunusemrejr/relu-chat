import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { stem, splitSentences, Lexicon } from '../core/lexicon.js';
import { analyzeMessage, analyzeClause } from '../core/query-analysis.js';
import { makeResponder, manifest } from '../dev/scripts/dialogue-harness.mjs';

console.warn = () => {};
const REFUSED = ['unknown', 'offdomain', 'otherbot'];
const decisions = r => r.trace.clauses.map(c => c.decision);
const ids = (b, r) => r.topics.map(i => b.KB[i].id);

test('stemming joins word families and sentence splitting respects math and abbreviations', () => {
  for (const family of [['deviation', 'deviate', 'deviating'], ['multiplication', 'multiply'], ['matrix', 'matrices'], ['projection', 'project'], ['independence', 'independent', 'independant'], ['optimise', 'optimization']])
    assert.equal(new Set(family.map(stem)).size, 1, family.join('/'));
  assert.deepEqual(splitSentences('Al-Khwarizmi (c. 780–850) worked in Baghdad. Nash (1950) proved $x=1.5$ holds.'), ['Al-Khwarizmi (c. 780–850) worked in Baghdad.', 'Nash (1950) proved $x=1.5$ holds.']);
});

test('spelling correction fixes typos but not different word forms', async () => {
  const { KB } = await import('../data/bots/data-science-chat/knowledge.js');
  const lx = new Lexicon(KB);
  assert.equal(lx.correct('overfiting')?.word, 'overfitting');
  assert.equal(lx.correct('regresion')?.word, 'regression');
  // Short everyday words are never "explained" as knowledge-base words.
  assert.equal(lx.explain([{ w: 'bread', stem: 'bread' }], 0), null);
  const ga = new Lexicon((await import('../data/bots/golden-age-inquiry/knowledge.js')).KB);
  assert.equal(ga.correct('transformer'), null, 'transformer is not a typo of transformed');
});

test('clauses split on new questions, comparisons stay whole, idioms are not pronouns', () => {
  assert.equal(analyzeMessage('can you explain eigenvalues and how they relate to PCA and also what SVD is').clauses.length, 3);
  assert.equal(analyzeMessage('what is the difference between precision and recall').clauses.length, 1);
  assert.equal(analyzeClause('difference between precision and recall').qtype, 'compare');
  assert.equal(analyzeClause('what is temporal difference learning?').qtype, 'define');
  assert.equal(analyzeClause('when did he live?').qtype, 'when');
  assert.equal(analyzeClause('When does the server send a 304?').qtype, 'condition');
  assert.equal(analyzeClause('how do i fix it?').qtype, 'application');
  assert.deepEqual(analyzeClause('when did he live?').anaphora.map(a => a.kind), ['person']);
  assert.equal(analyzeClause('keep it short: what is the shapley value?').anaphora.length, 0);
  assert.equal(analyzeClause('compute the dot product of (1,2) and (3,4)').task, 'compute');
  assert.equal(analyzeClause('how do I compute a dot product?').task, null);
  assert.equal(analyzeClause('What is the event loop in JavaScript?').task, null);
});

test('every topic asked by name is answered, never refused (all six assistants)', async () => {
  for (const bot of manifest().bots) {
    const b = await makeResponder(bot.id, { policy: false });
    let right = 0;
    for (const [i, e] of b.KB.entries()) {
      for (const q of [`what is ${e.name}?`, `explain ${e.aliases?.[0] || e.name}`]) {
        b.responder.reset();
        const r = await b.ask(q);
        assert.ok(!decisions(r).some(d => REFUSED.includes(d)), `${bot.id}: "${q}" was refused: ${r.text.slice(0, 120)}`);
        assert.ok(!/I don't have notes on/.test(r.text), `${bot.id}: "${q}"`);
        if (r.topics[0] === i) right++;
      }
    }
    assert.ok(right / (2 * b.KB.length) >= 0.97, `${bot.id}: named topic accuracy ${right}/${2 * b.KB.length}`);
  }
});

test('unknown concepts get an honest answer that points to what is known', async () => {
  const la = await makeResponder('linear-algebra-chat', { policy: false });
  let r = await la.ask('what is the jordan normal form?');
  assert.match(r.text, /I don't have notes on \*\*jordan normal form\*\*/);
  assert.equal(r.topics.length, 0);
  r = await la.ask('what is a nash equilibrium?');
  assert.match(r.text, /Game Theory Chat/);
  assert.ok(r.links.some(l => l.url.startsWith('/chat/game-theory-chat/?q=')));
  r = await la.ask('what is the capital of France?');
  assert.equal(r.topics.length, 0);
  assert.ok(!/Vector —/.test(r.text));
  const rl = await makeResponder('reinforcement-learning-chat', { policy: false });
  r = await rl.ask('what is inverse reinforcement learning?');
  assert.match(r.text, /My notes cover \*\*Reinforcement learning\*\*, but not \*\*inverse reinforcement learning\*\* specifically/);
  const gt = await makeResponder('game-theory-chat', { policy: false });
  r = await gt.ask('what is quantum game theory?');
  assert.match(r.text, /I don't have notes on \*\*quantum game theory\*\*/);
  const ds = await makeResponder('data-science-chat', { policy: false });
  r = await ds.ask('what is a confusion matrix?');
  assert.match(r.text, /I don't have a dedicated topic on \*\*confusion matrix\*\*, but my notes on \*\*Model Evaluation\*\* mention it/);
});

test('pronouns, ellipsis and answer-first extraction follow the conversation', async () => {
  const gt = await makeResponder('game-theory-chat', { policy: false });
  await gt.ask('what is nash equilibrium?');
  let r = await gt.ask('who came up with it?');
  assert.match(r.text, /Nash \(1950\)/);
  await gt.ask('what about the prisoners dilemma?');
  r = await gt.ask('is it always pareto optimal?');
  assert.deepEqual(ids(gt, r), ['prisoners_dilemma']);
  assert.match(r.text, /Pareto/);
  const ga = await makeResponder('golden-age-inquiry', { policy: false });
  await ga.ask('who was al-khwarizmi?');
  r = await ga.ask('when did he live?');
  assert.match(r.text, /c\. 780–850/);
  await ga.ask('tell me about the house of wisdom');
  r = await ga.ask('who founded it?');
  assert.match(r.text, /Harun al-Rashid/);
  const ds = await makeResponder('data-science-chat', { policy: false });
  await ds.ask('what is overfitting');
  r = await ds.ask('how do i fix it?');
  assert.match(r.text, /Combat overfitting with/);
  await ds.ask('keep it short: what is model evaluation?');
  r = await ds.ask('and accuracy?');
  assert.equal(r.trace.verbosity, 'brief');
  assert.deepEqual(ids(ds, r), ['accuracy']);
});

test('multi-part questions answer every part and comparisons use the notes’ own connections', async () => {
  const la = await makeResponder('linear-algebra-chat', { policy: false });
  let r = await la.ask('can you explain eigenvalues and how they relate to PCA and also what SVD is');
  assert.ok(ids(la, r).includes('eigenvalues-eigenvectors') && ids(la, r).includes('singular-value-decomposition'));
  assert.match(r.text, /PCA/);
  const gt = await makeResponder('game-theory-chat', { policy: false });
  r = await gt.ask('what is a stackelberg duopoly and how is it different from cournot?');
  assert.deepEqual(ids(gt, r).slice(0, 2), ['stackelberg', 'cournot']);
  assert.match(r.text, /Here is how my notes connect/);
});

test('follow-up requests in the same message continue the topic instead of being refused', async () => {
  const rl = await makeResponder('reinforcement-learning-chat', { policy: false });
  let r = await rl.ask("Is a single step's reward the same thing as the return? Convince me.");
  assert.deepEqual(ids(rl, r), ['reward-return']);
  assert.ok(!/don't have notes|couldn't find|won't guess/.test(r.text), r.text);
  const gt = await makeResponder('game-theory-chat', { policy: false });
  r = await gt.ask("What's a dominant strategy? Please give the strict and the weak distinction.");
  assert.ok(!/don't have notes|couldn't find|won't guess/.test(r.text), r.text);
  assert.match(r.text, /weak dominance/);
  assert.equal((r.text.match(/\*\*Dominant Strategy\*\* —/g) || []).length, 1, 'one header per topic');
});

test('user text echoed back is escaped', async () => {
  const la = await makeResponder('linear-algebra-chat', { policy: false });
  for (const q of ['what is <img src=x onerror=alert(1)>?', 'explain **bold** <script>x</script> things']) {
    const r = await la.ask(q);
    assert.ok(!/<img|<script/i.test(r.text), r.text);
  }
});

test('dialogue evaluation stays above its release bar', () => {
  const run = spawnSync(process.execPath, ['dev/scripts/eval-dialogue.mjs'], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 100000 });
  assert.equal(run.status, 0, run.stderr);
  const all = run.stdout.split('\n').find(l => l.startsWith('ALL (current)'));
  const [known, falseAbstain, unknown, offTopic, crossBot, , wh, multiPart, turns] = all.replace('ALL (current)', '').trim().split(/\s+/).map(Number);
  assert.equal(falseAbstain, 0, 'covered topics must never be refused');
  assert.ok(known >= 95 && unknown >= 95 && offTopic >= 95 && crossBot >= 90 && multiPart >= 90 && turns >= 85 && wh >= 75, all);
});
