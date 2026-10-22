// Builds the same responder the browser builds (bag-of-words vectors, BM25,
// trained policy, topic directory, calibrated boundary) for Node tests,
// evaluation and calibration. No DOM, no network.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tokens, bowVec, compileAliasRegex } from '../../core/nlp.js';
import { SignalLayer } from '../../core/signal-layer.js';
import { Responder } from '../../core/responder.js';
import { createInferenceEnv } from '../../core/inference-env.js';
import { loadPolicyRuntime, planAnswer } from '../../policy/policy-runtime.js';
import { botOptions } from '../../core/bot-options.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = rel => fs.readFileSync(ROOT + rel);

let policyReady = null;
function ensurePolicy() {
  if (!policyReady) {
    const original = globalThis.fetch;
    globalThis.fetch = async url => {
      const rel = String(url).replace(/^\//, '');
      try { return new Response(read(rel), { status: 200 }); } catch { return original ? original(url) : new Response('', { status: 404 }); }
    };
    policyReady = loadPolicyRuntime().catch(() => null);
  }
  return policyReady;
}

export const manifest = () => JSON.parse(read('data/manifest.json'));

/**
 * @param {string} botId
 * @param {{calibration?: object|null, directory?: boolean, policy?: boolean, now?: () => number}} [opts]
 */
export async function makeResponder(botId, opts = {}) {
  const bot = manifest().bots.find(b => b.id === botId);
  if (!bot) throw new Error(`Unknown bot ${botId}`);
  const [{ KB, entryText }, { INTENTS }, { overrides }] = await Promise.all([
    import(new URL(`data/bots/${botId}/knowledge.js`, 'file://' + ROOT)),
    import(new URL(`data/bots/${botId}/intents.js`, 'file://' + ROOT)),
    import(new URL(`data/bots/${botId}/overrides.js`, 'file://' + ROOT)),
  ]);
  const vocabulary = new Set();
  for (const e of KB) for (const t of tokens(entryText(e))) vocabulary.add(t);
  for (const it of Object.values(INTENTS)) for (const p of it.prototypes) for (const t of tokens(p)) vocabulary.add(t);
  const vocab = new Map([...vocabulary].map((w, i) => [w, i]));
  const entryEmb = KB.map(e => bowVec(entryText(e), vocab));
  const intentEmb = Object.fromEntries(Object.entries(INTENTS).map(([k, v]) => [k, v.prototypes.map(p => bowVec(p, vocab))]));
  compileAliasRegex(KB);
  const signalLayer = new SignalLayer().initBM25(KB);
  if (opts.policy !== false) await ensurePolicy();
  let calibration = opts.calibration;
  if (calibration === undefined) {
    try { calibration = JSON.parse(read('data/boundary-calibration.json')).bots?.[botId]?.thresholds || null; } catch { calibration = null; }
  }
  const profile = { id: botId, name: bot.name, allowedIntents: Object.keys(INTENTS), tone: 'neutral', maxTopics: 2, creativityCeiling: 0.2 };
  const responder = new Responder({ KB, botProfile: profile, overrides, calibration: calibration || undefined, now: opts.now, ...botOptions(botId) });
  if (opts.directory !== false) {
    try { responder.setDirectory(JSON.parse(read('data/topic-directory.json'))); } catch { /* routing disabled */ }
  }
  const env = createInferenceEnv({
    KB, signalLayer, INTENTS, planAnswer: opts.policy === false ? null : planAnswer, botProfile: profile,
    embedding: { model: 'all-MiniLM-L6-v2', quantized: true },
    vectors: () => ({ embed: async t => bowVec(t, vocab), entryEmb, intentEmb, semantic: false }),
  });
  return { bot, KB, responder, env, ask: q => responder.respond(q, env) };
}
