/**
 * inference-env.js — Retrieval and policy hooks for the responder
 *
 * Shared by the browser engine and the Node test harness so both run the same
 * retrieval. Candidates come from two rankers fused with reciprocal rank
 * fusion (scores from BM25 and cosine similarity live on different scales;
 * ranks do not):
 *
 *   field-weighted BM25 over names, aliases, overview and fragments, and
 *   cosine similarity over entry embeddings (bag-of-words by default,
 *   MiniLM sentence embeddings once enhanced matching is on).
 *
 * Only MiniLM similarity counts as semantic evidence for the knowledge
 * boundary; bag-of-words similarity is lexical and already covered by BM25.
 */

import { rankTopK, classifyIntent } from './nlp.js';

const RRF_K = 8;

/**
 * @param {{KB:object[], signalLayer:object, vectors:()=>{embed:(t:string)=>Promise<number[]>, entryEmb:number[][],
 *   intentEmb:object, semantic:boolean}, INTENTS:object, THRESHOLDS?:object, planAnswer?:Function,
 *   botProfile?:object, embedding?:object}} deps
 */
export function createInferenceEnv(deps) {
  const { KB, signalLayer, vectors, INTENTS, THRESHOLDS = {}, planAnswer, botProfile, embedding } = deps;

  async function rank(text) {
    const { embed, entryEmb, semantic } = vectors();
    const qEmb = await embed(text);
    const sparse = signalLayer.sparseRank ? signalLayer.sparseRank(text, 15) : [];
    const dense = rankTopK(qEmb, entryEmb, 15).filter(d => d.s > 0);
    const fused = new Map();
    const add = (list, weight) => list.forEach((d, r) => fused.set(d.i, (fused.get(d.i) || 0) + weight / (RRF_K + r + 1)));
    add(sparse.filter(d => d.s > 0), 1);
    add(dense, semantic ? 1 : 0.5);
    const denseScore = new Map(dense.map(d => [d.i, d.s]));
    // With sentence embeddings, a close neighbour is a fair "closest topic" to offer.
    // Each ranker's top five always stay candidates, so a strong word match is
    // never pushed out when the two rankers disagree; the rest fill by fused score.
    const keep = new Set([...sparse.filter(d => d.s > 0).slice(0, 5), ...dense.slice(0, 5)].map(d => d.i));
    const ordered = [...fused.entries()].map(([i, s]) => ({ i, s, dense: semantic ? denseScore.get(i) || 0 : null, semantic: semantic && (denseScore.get(i) || 0) >= 0.4 }))
      .sort((a, b) => b.s - a.s || a.i - b.i);
    const candidates = [...ordered.filter(c => keep.has(c.i)), ...ordered.filter(c => !keep.has(c.i))].slice(0, 12).sort((a, b) => b.s - a.s || a.i - b.i);
    const denseTop = semantic && dense[0] && (!dense[1] || dense[0].s - dense[1].s >= 0.04) ? dense[0] : null;
    return { candidates, denseTop, qEmb, semantic };
  }

  async function advise(text, qEmb, ctx) {
    if (typeof planAnswer !== 'function') return null;
    const { entryEmb, intentEmb } = vectors();
    const intent = await classifyIntent(qEmb, intentEmb, INTENTS, THRESHOLDS);
    const ranked = (ctx.topics || []).map((i, r) => ({ i, s: Math.max(0.3, 0.92 - r * 0.15) }));
    const plan = await planAnswer(text, qEmb, KB, {
      entities: ctx.entities || [], intent: intent.intent, intentScores: intent.rawScores || {}, ranked, entryEmb,
      lastTopic: ctx.lastTopic ?? null, lastTopicAge: ctx.lastTopic == null ? 0 : 1, followUp: null, wasPreviousAmbiguous: false,
    }, { EMBEDDING: embedding, botProfile, _domainPrototypeEmbs: intentEmb });
    return { intent: plan?.intent || null, frags: plan?.fragmentPlan?.[0]?.cats?.length || null, mode: plan?.mode || null, policy: plan?.meta?.policyVersion || null };
  }

  return { rank, advise };
}
