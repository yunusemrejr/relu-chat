// In-browser dialogue evaluation with neural matching (MiniLM sentence
// embeddings), built the way core/chatbot-engine.js builds an assistant once
// the model has loaded. Serve the repository root (npm run dev) and open
// /dev/eval/neural.html. Results: window.__neural (and the page table).
import { tokens, bowVec, compileAliasRegex } from '/core/nlp.js';
import { SignalLayer } from '/core/signal-layer.js';
import { Responder } from '/core/responder.js';
import { createInferenceEnv } from '/core/inference-env.js';
import { loadPolicyRuntime, planAnswer } from '/policy/policy-runtime.js';
import { botOptions } from '/core/bot-options.js';
import { score, wrapResponder, KEYS } from '/dev/scripts/dialogue-score.mjs';

const SETS = ['dialogue-eval', 'dialogue-test', 'dialogue-final'];
const status = text => { window.__neuralStatus = text; document.getElementById('status').textContent = text; };
const json = url => fetch(url).then(r => r.json());

async function extractorOf() {
  const { pipeline, env } = await import('/assets/transformers/transformers.js');
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = '/assets/models/';
  env.backends.onnx.wasm.wasmPaths = '/assets/transformers/';
  env.backends.onnx.wasm.numThreads = 1;
  const extractor = await pipeline('feature-extraction', 'all-MiniLM-L6-v2', { quantized: true });
  const cache = new Map();
  return async text => {
    const key = String(text || '').trim().toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const v = Array.from((await extractor(text, { pooling: 'mean', normalize: true })).data);
    cache.set(key, v);
    return v;
  };
}

async function buildBot(bot, embed, calibration, directory) {
  const [{ KB, entryText }, { INTENTS }, { overrides }] = await Promise.all([
    import(`/data/bots/${bot.id}/knowledge.js`), import(`/data/bots/${bot.id}/intents.js`), import(`/data/bots/${bot.id}/overrides.js`),
  ]);
  compileAliasRegex(KB);
  const entryEmb = [];
  for (const e of KB) entryEmb.push(await embed(entryText(e)));
  const intentEmb = {};
  for (const [name, intent] of Object.entries(INTENTS)) { intentEmb[name] = []; for (const p of intent.prototypes) intentEmb[name].push(await embed(p)); }
  const signalLayer = new SignalLayer().initBM25(KB);
  const profile = { id: bot.id, name: bot.name, allowedIntents: Object.keys(INTENTS), tone: 'neutral', maxTopics: 2, creativityCeiling: 0.2 };
  const responder = new Responder({ KB, botProfile: profile, overrides, calibration: calibration?.bots?.[bot.id]?.thresholds, ...botOptions(bot.id) });
  responder.setDirectory(directory);
  const env = createInferenceEnv({ KB, signalLayer, INTENTS, planAnswer, botProfile: profile, embedding: { model: 'all-MiniLM-L6-v2', quantized: true }, vectors: () => ({ embed, entryEmb, intentEmb, semantic: true }) });
  return { KB, responder, ask: q => responder.respond(q, env) };
}

async function run() {
  status('loading model');
  const embed = await extractorOf();
  await loadPolicyRuntime();
  const [manifest, calibration, directory] = await Promise.all([json('/data/manifest.json'), json('/data/boundary-calibration.json'), json('/data/topic-directory.json')]);
  const results = {};
  const failures = [];
  for (const bot of manifest.bots) {
    status(`embedding ${bot.id}`);
    const b = await buildBot(bot, embed, calibration, directory);
    for (const set of SETS) {
      status(`scoring ${set} / ${bot.id}`);
      const data = await json(`/dev/datasets/${set}/${bot.id}.json`);
      const m = await score(wrapResponder(b), data, (key, detail) => failures.push(`[${set}][${bot.id}] ${key}: ${detail}`));
      results[set] = results[set] || {};
      for (const k of KEYS) { results[set][k] = results[set][k] || [0, 0]; results[set][k][0] += m[k][0]; results[set][k][1] += m[k][1]; }
    }
  }
  const pct = ([a, n]) => (n ? (100 * a / n).toFixed(1) : '—');
  const rows = SETS.map(set => `${set.padEnd(16)} ${KEYS.map(k => pct(results[set][k]).padStart(8)).join('')}`);
  document.getElementById('out').textContent = `${''.padEnd(16)} ${KEYS.map(k => k.slice(0, 7).padStart(8)).join('')}\n${rows.join('\n')}`;
  window.__neural = { results, failures, rows };
  status('done');
}

run().catch(error => { status('error: ' + error.message); console.error(error); });
