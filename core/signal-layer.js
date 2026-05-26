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
  if (!e || typeof e !== 'object') return '';
  const name = e.name || '';
  const aliases = Array.isArray(e.aliases) ? e.aliases.join(' ') : '';
  const summary = e.summary || '';
  if (typeof e.f?.def?.[0] === 'string') {
    const def = (e.f.def || []).join(' ');
    const int = (e.f.int || []).join(' ');
    const ex = (e.f.ex || []).join(' ');
    return `${name} ${aliases} ${summary} ${def} ${int} ${ex}`;
  }
  const def2 = (e.f?.def || []).map(f => typeof f === 'string' ? f : (f && f.text) || '').join(' ');
  return `${name} ${summary} ${def2}`;
}

function calibrateConfidence(rawScores, temperature = 1.5) {
  if (!rawScores || typeof rawScores !== 'object') {
    return { calibrated: {}, confidence: 0, entropy: 0 };
  }
  const keys = Object.keys(rawScores);
  if (keys.length === 0) return { calibrated: {}, confidence: 0, entropy: 0 };
  const values = keys.map(k => Number.isFinite(rawScores[k]) ? rawScores[k] : 0);
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
  return {
    calibrated: result,
    confidence,
    entropy: keys.length > 1 ? entropy / Math.log(keys.length) : 0
  };
}

function ensembleRanking(denseRanked, sparseRanked, denseWeight = 0.7, sparseWeight = 0.3) {
  if (!Array.isArray(denseRanked)) denseRanked = [];
  if (!Array.isArray(sparseRanked)) sparseRanked = [];
  const scores = new Map();
  for (const r of denseRanked) {
    if (r && typeof r.i === 'number') {
      scores.set(r.i, { i: r.i, dense: Number.isFinite(r.s) ? r.s : 0, sparse: 0 });
    }
  }
  for (const r of sparseRanked) {
    if (r && typeof r.i === 'number') {
      if (scores.has(r.i)) {
        scores.get(r.i).sparse = Number.isFinite(r.s) ? r.s : 0;
      } else {
        scores.set(r.i, { i: r.i, dense: 0, sparse: Number.isFinite(r.s) ? r.s : 0 });
      }
    }
  }
  return [...scores.values()]
    .map(s => ({ i: s.i, s: denseWeight * s.dense + sparseWeight * s.sparse, dense: s.dense, sparse: s.sparse }))
    .sort((a, b) => b.s - a.s);
}

function neuralRerank(query, qEmb, candidates, entryEmb, strength = 0.15) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  if (!Array.isArray(qEmb)) return candidates.map(c => ({ ...c, rerankBonus: 0 }));
  const qTokens = new Set(tokens(query || ''));
  return candidates.map(c => {
    if (!c || typeof c.i !== 'number') return { ...c, s: 0, rerankBonus: 0 };
    let tokenBonus = 0;
    if (qTokens.size > 0 && Array.isArray(entryEmb) && entryEmb[c.i]) {
      const rerankScore = cosine(qEmb, entryEmb[c.i]);
      tokenBonus = Number.isFinite(rerankScore) ? strength * rerankScore : 0;
    }
    const baseScore = Number.isFinite(c.s) ? c.s : 0;
    return { ...c, s: baseScore + tokenBonus, rerankBonus: tokenBonus };
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
    // ── Input validation ──────────────────────────────────────────────
    if (!query || typeof query !== 'string') {
      query = '';
    }
    if (!Array.isArray(qEmb)) {
      qEmb = [];
    }
    if (!Array.isArray(KB)) {
      KB = [];
    }
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

    // -----------------------------------------------------------------------
    // Follow-up signal processing: boost rankings and adjust intent based on
    // the detected follow-up type. These modifications are applied BEFORE the
    // policy features are extracted, so the MLP/heuristic sees them.
    // -----------------------------------------------------------------------
    const followUpSignals = {
      boostApplied: false,
      boostDelta: 0,
      fragmentCountHint: null,   // 'more' | 'fewer' | null
      complexityHint: null,       // 'simpler' | 'deeper' | null
      intentBias: null,           // intent name to bias toward
      topicOverride: null,        // KB index to force as topic
    };

    if (followUp && followUp.isFollowUp) {
      const lastTopicId = session?.lastTopic ?? null;

      // 1. Boost last topic's similarity score when a follow-up is detected
      if (lastTopicId != null) {
        const lastTopicIdx = reranked.findIndex(r => r.i === lastTopicId);
        if (lastTopicIdx >= 0) {
          // Apply a boost proportional to follow-up confidence
          const boostAmount = 0.2 * (1 + (followUp.conversationDepth || 1) * 0.1);
          reranked[lastTopicIdx] = {
            ...reranked[lastTopicIdx],
            s: reranked[lastTopicIdx].s + boostAmount,
            followUpBoost: boostAmount,
          };
          followUpSignals.boostApplied = true;
          followUpSignals.boostDelta = boostAmount;

          // Re-sort the reranked array after boosting
          reranked.sort((a, b) => b.s - a.s);
        } else if (lastTopicId >= 0 && lastTopicId < KB.length) {
          // Last topic wasn't in top-K — add it with a base score so it
          // has a chance to be considered by the policy
          const baseScore = 0.15 + (followUp.conversationDepth || 1) * 0.05;
          reranked.push({ i: lastTopicId, s: baseScore, followUpBoost: baseScore, dense: 0, sparse: 0, rerankBonus: 0 });
          reranked.sort((a, b) => b.s - a.s);
          followUpSignals.boostApplied = true;
          followUpSignals.boostDelta = baseScore;
          followUpSignals.topicOverride = lastTopicId;
        }
      }

      // 2. Handle specific follow-up types
      const followUpType = followUp.type || '';

      // "go on" / "continue" / "keep going" — increase fragment count
      if (followUpType === 'continue') {
        followUpSignals.fragmentCountHint = 'more';
      }

      // "elaborate" / "more" / "tell me more" — also increase fragment count
      if (followUpType === 'elaborate' || followUpType === 'deep_dive') {
        followUpSignals.fragmentCountHint = 'more';
        followUpSignals.complexityHint = 'deeper';
        // Boost formal + application intent scores for deeper content
        if (intent.rawScores) {
          intent.rawScores.formal = Math.max(intent.rawScores.formal || 0, 0.45);
          intent.rawScores.application = Math.max(intent.rawScores.application || 0, 0.45);
        }
      }

      // "simplify" / "clarify" — reduce complexity
      if (followUpType === 'simplify' || followUpType === 'clarify') {
        followUpSignals.complexityHint = 'simpler';
        followUpSignals.fragmentCountHint = 'fewer';
        // Boost definition intent for simpler explanations
        if (intent.rawScores) {
          intent.rawScores.definition = Math.max(intent.rawScores.definition || 0, 0.65);
        }
      }

      // "example" / "like what" / "for instance" — bias toward example
      if (followUpType === 'example' || followUpType === 'another_example') {
        followUpSignals.intentBias = 'example';
        if (intent.rawScores) {
          intent.rawScores.example = Math.max(intent.rawScores.example || 0, 0.7);
        }
      }

      // "comparison" / "contrast" / "difference" — bias toward comparison
      if (followUpType === 'comparison') {
        followUpSignals.intentBias = 'comparison';
        if (intent.rawScores) {
          intent.rawScores.comparison = Math.max(intent.rawScores.comparison || 0, 0.6);
        }
      }

      // "how" / "why" — moderate depth increase
      if (followUpType === 'how' || followUpType === 'why') {
        followUpSignals.complexityHint = 'deeper';
        followUpSignals.fragmentCountHint = 'more';
        if (intent.rawScores) {
          intent.rawScores.formal = Math.max(intent.rawScores.formal || 0, 0.35);
        }
      }

      // "summarize" — reduce fragment count, simpler
      if (followUpType === 'summarize') {
        followUpSignals.fragmentCountHint = 'fewer';
        followUpSignals.complexityHint = 'simpler';
      }

      // "evidence" / "challenge" — bias toward formal
      if (followUpType === 'evidence' || followUpType === 'challenge') {
        followUpSignals.intentBias = 'formal';
        if (intent.rawScores) {
          intent.rawScores.formal = Math.max(intent.rawScores.formal || 0, 0.6);
          intent.rawScores.definition = Math.max(intent.rawScores.definition || 0, 0.4);
        }
      }
    }

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
      followUpSignals,
      features,
    };

    return Object.freeze(decisionPacket);
  }
}
