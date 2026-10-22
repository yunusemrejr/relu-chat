// Distribution of MiniLM similarity between questions and topics, to choose
// the semantic acceptance threshold. Uses the development and casual-chat sets
// only (the final set stays out of tuning). Results: window.__stats.
const SETS = ['dialogue-eval', 'dialogue-test'];
const json = url => fetch(url).then(r => r.json());

const { pipeline, env } = await import('/assets/transformers/transformers.js');
env.allowLocalModels = true; env.allowRemoteModels = false; env.localModelPath = '/assets/models/';
env.backends.onnx.wasm.wasmPaths = '/assets/transformers/'; env.backends.onnx.wasm.numThreads = 1;
const extractor = await pipeline('feature-extraction', 'all-MiniLM-L6-v2', { quantized: true });
const embed = async t => Array.from((await extractor(t, { pooling: 'mean', normalize: true })).data);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

const manifest = await json('/data/manifest.json');
const rows = [];
for (const bot of manifest.bots) {
  window.__statsStatus = 'embedding ' + bot.id;
  const { KB, entryText } = await import(`/data/bots/${bot.id}/knowledge.js`);
  // ?units: score each topic by its best-matching passage (overview, definition,
  // intuition and example fragments) instead of its whole text.
  const units = new URLSearchParams(location.search).has('units');
  const E = [];
  for (const e of KB) {
    if (!units) { E.push([await embed(entryText(e))]); continue; }
    const texts = [e.summary, ...(e.f?.def || []), ...(e.f?.int || []), ...(e.f?.ex || [])].filter(t => typeof t === 'string' && t.trim());
    const vs = [];
    for (const t of [...new Set(texts)]) vs.push(await embed(t));
    E.push(vs);
  }
  for (const set of SETS) {
    const data = await json(`/dev/datasets/${set}/${bot.id}.json`);
    const items = [
      ...(data.known || []).map(k => ({ q: k.query, label: 'known', want: k.topicId })),
      ...(data.unknownConcepts || []).filter(u => !(u.mentionedIn || []).length).map(u => ({ q: u.query, label: 'unknown' })),
      ...(data.offTopic || []).map(q => ({ q, label: 'offtopic' })),
      ...(data.crossBot || []).map(c => ({ q: c.query, label: 'crossbot' })),
    ];
    for (const it of items) {
      const v = await embed(it.q);
      const sims = E.map((vs, i) => [i, Math.max(...vs.map(e => dot(v, e)))]).sort((a, b) => b[1] - a[1]);
      rows.push({ bot: bot.id, set, label: it.label, top: sims[0][1], margin: sims[0][1] - sims[1][1], right: it.want ? KB[sims[0][0]].id === it.want : null });
    }
  }
}
const summary = [];
for (const tau of [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75]) {
  const known = rows.filter(r => r.label === 'known');
  const acceptRight = known.filter(r => r.top >= tau && r.right).length / known.length;
  const acceptWrong = known.filter(r => r.top >= tau && !r.right).length / known.length;
  const neg = rows.filter(r => r.label !== 'known');
  const falseAccept = neg.filter(r => r.top >= tau).length / neg.length;
  summary.push({ tau, acceptRight: +acceptRight.toFixed(3), acceptWrong: +acceptWrong.toFixed(3), falseAccept: +falseAccept.toFixed(3), negatives: neg.length, known: known.length });
}
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };
const byLabel = l => rows.filter(r => r.label === l).map(r => r.top);
window.__stats = { summary, quantiles: Object.fromEntries(['known', 'unknown', 'offtopic', 'crossbot'].map(l => [l, { p10: q(byLabel(l), 0.1), p50: q(byLabel(l), 0.5), p90: q(byLabel(l), 0.9), p98: q(byLabel(l), 0.98) }])) };
window.__statsStatus = 'done';
