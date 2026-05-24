import { BM25Scorer } from './bm25.js';
import { cosine, softmax, tokens, bowVec, compileAliasRegex, extractEntities, classifyIntent, rankEntries } from './nlp.js';
import { extractPolicyFeatures } from '../policy/feature-extractor.js';

const DEFAULT_INTENTS = {
  definition: { prototypes: ["what is X", "define X", "explain X", "what does X mean", "tell me about X", "describe X", "what is meant by X", "what is the meaning of X", "explain the concept of X"], order: ['def', 'int', 'ex'] },
  example: { prototypes: ["give an example of X", "show me an example", "example of X", "illustrate X", "concrete case of X", "an example of X", "show an example", "give examples of X", "illustrate with an example"], order: ['ex', 'int', 'def'] },
  formal: { prototypes: ["formal definition of X", "prove X", "theorem about X", "math behind X", "derive X", "equation for X", "formalism of X", "mathematical definition of X", "proof of X", "formal proof of X", "rigorous definition of X", "formal treatment of X", "mathematical formulation of X"], order: ['form', 'def', 'ex'] },
  application: { prototypes: ["applications of X", "where is X used", "uses of X", "real world X", "practical use of X", "why is X useful", "how is X applied", "real-world applications of X", "where does X apply", "practical applications of X", "use cases of X"], order: ['app', 'ex', 'int'] },
  comparison: { prototypes: ["difference between X and Y", "X vs Y", "compare X and Y", "how is X different from Y", "relation between X and Y", "X versus Y", "X compared to Y", "compare X with Y"], order: ['def', 'int', 'ex'] },
  greeting: { prototypes: ["hi", "hello", "hey there", "good morning", "how are you", "what up", "hey", "hi there", "good afternoon", "good evening"], order: null },
  help: { prototypes: ["help", "what can you do", "how do i use this", "what topics do you know", "menu", "what can you help with", "list topics", "what do you know"], order: null }
};

function entryText(e) {
  if (typeof e.f?.def?.[0] === 'string') {
    return `${e.name} ${(e.aliases || []).join(' ')} ${e.summary || ''} ${(e.f.def || []).join(' ')} ${(e.f.int || []).join(' ')} ${(e.f.ex || []).join(' ')}`;
  }
  return `${e.name} ${e.summary || ''} ${(e.f?.def || []).map(f => typeof f === 'string' ? f : f.text).join(' ')}`;
}

function calibrateConfidence(rawScores, temperature = 1.5) {
  const keys = Object.keys(rawScores);
  if (keys.length === 0) return { calibrated: {}, confidence: 0, entropy: 0 };
  const values = keys.map(k => rawScores[k]);
  const calibrated = softmax(values, temperature);
  const result = {};
  let entropy = 0;
  for (let i = 0; i < keys.length; i++) {
    result[keys[i]] = calibrated[i];
    if (calibrated[i] > 0) entropy -= calibrated[i] * Math.log(calibrated[i]);
  }
  const maxVal = Math.max(...calibrated);
  const secondMax = [...calibrated].sort((a, b) => b - a)[1] || 0;
  const margin = maxVal - secondMax;
  const confidence = Math.min(1, Math.max(0, margin * (1 + 1 / Math.max(1, keys.length))));
  return { calibrated: result, confidence, entropy: entropy / Math.log(keys.length) };
}

function ensembleRanking(denseRanked, sparseRanked, denseWeight = 0.7, sparseWeight = 0.3) {
  const scores = new Map();
  for (const r of denseRanked) {
    scores.set(r.i, { i: r.i, dense: r.s, sparse: 0 });
  }
  for (const r of sparseRanked) {
    if (scores.has(r.i)) {
      scores.get(r.i).sparse = r.s;
    } else {
      scores.set(r.i, { i: r.i, dense: 0, sparse: r.s });
    }
  }
  return [...scores.values()]
    .map(s => ({ i: s.i, s: denseWeight * s.dense + sparseWeight * s.sparse, dense: s.dense, sparse: s.sparse }))
    .sort((a, b) => b.s - a.s);
}

function neuralRerank(query, qEmb, candidates, entryEmb, strength = 0.15) {
  if (candidates.length === 0) return [];
  const qTokens = new Set(tokens(query));
  return candidates.map(c => {
    let tokenBonus = 0;
    if (qTokens.size > 0 && entryEmb[c.i]) {
      const rerankScore = cosine(qEmb, entryEmb[c.i]);
      tokenBonus = strength * rerankScore;
    }
    return { ...c, s: c.s + tokenBonus, rerankBonus: tokenBonus };
  }).sort((a, b) => b.s - a.s);
}

export class SignalLayer {
  constructor(config = {}) {
    this._bm25Scorer = null;
    this._bm25Ready = false;
    this._config = config;
  }

  initBM25(KB) {
    const texts = KB.map(e => entryText(e));
    this._bm25Scorer = new BM25Scorer(1.5, 0.75).fit(texts);
    this._bm25Ready = this._bm25Scorer.getReady();
    return this;
  }

  isBM25Ready() { return this._bm25Ready; }

  async process(query, qEmb, entryEmb, intentEmb, KB, config, session = null) {
    const INTENTS = config?.INTENTS || DEFAULT_INTENTS;
    const THRESHOLDS = config?.THRESHOLDS || {};

    compileAliasRegex(KB);

    let entities = extractEntities(query, KB);

    const recentEntities = session?.getRecentEntities?.();
    if (recentEntities && recentEntities.length > 0) {
      const entitySet = new Set(entities);
      for (const re of recentEntities) {
        if (!entitySet.has(re)) {
          entities.push(re);
          entitySet.add(re);
        }
      }
    }

    const intentRaw = await classifyIntent(qEmb, intentEmb, INTENTS, THRESHOLDS);
    const calibration = calibrateConfidence(intentRaw.rawScores || intentRaw.scores, 1.5);
    const intent = {
      name: intentRaw.intent,
      rawScores: intentRaw.scores || {},
      calibratedScores: calibration.calibrated,
      confidence: calibration.confidence,
      entropy: calibration.entropy,
    };

    const denseRanked = rankEntries(qEmb, entryEmb).slice(0, 20);

    let sparseRanked = [];
    if (this._bm25Ready) {
      sparseRanked = this._bm25Scorer.scoreAll(query).slice(0, 20);
    }

    const ensemble = ensembleRanking(denseRanked, sparseRanked, 0.7, 0.3);

    const topK = ensemble.slice(0, 10);
    const reranked = neuralRerank(query, qEmb, topK, entryEmb, 0.15);

    const followUp = session?.getFollowUpContext?.(query) || null;
    const wasAmbiguous = session?.wasPreviousQueryAmbiguous?.() || false;

    const queryTokens = tokens(query);
    const isShortQuery = queryTokens.length < 3;
    const hasMultipleEntities = entities.length > 1;
    const lowConfidence = reranked.length === 0 || reranked[0].s < 0.25;
    const scoresClose = reranked.length >= 2 && Math.abs(reranked[0].s - reranked[1].s) < 0.1;

    const isAmbiguous =
      (hasMultipleEntities && scoresClose) ||
      (isShortQuery && lowConfidence) ||
      (scoresClose && reranked[0]?.s > 0.15 && reranked[0]?.s < 0.35);

    const features = extractPolicyFeatures(
      query, qEmb,
      reranked, entities,
      intent.rawScores,
      session?.lastTopic ?? null,
      session?.lastTopicAge ?? null,
      KB, config,
      entryEmb, followUp, wasAmbiguous
    );

    const decisionPacket = {
      query,
      qEmb,
      entities,
      intent,
      isAmbiguous,
      rankings: {
        dense: denseRanked,
        sparse: sparseRanked,
        ensemble,
        reranked,
      },
      bm25Stats: {
        enabled: this._bm25Ready,
        top1Score: sparseRanked[0]?.s || 0,
        top2Score: sparseRanked[1]?.s || 0,
      },
      confidence: {
        intent: intent.confidence,
        top1Sim: reranked[0]?.s || 0,
        top1dense: denseRanked[0]?.s || 0,
        top1sparse: sparseRanked[0]?.s || 0,
      },
      session: {
        followUp,
        wasAmbiguous,
        lastTopic: session?.lastTopic ?? null,
        lastTopicAge: session?.lastTopicAge ?? 0,
      },
      features,
    };

    return Object.freeze(decisionPacket);
  }
}
