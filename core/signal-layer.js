import { BM25Scorer } from './bm25.js';
import { cosine, softmax, tokens, bowVec, compileAliasRegex, extractEntities, classifyIntent, rankEntries, DEFAULT_INTENTS } from './nlp.js';
import { extractPolicyFeatures } from '../policy/feature-extractor.js';

export class SignalLayer {
  constructor(config = {}) {
    this._bm25Scorer = null;
    this._bm25Ready = false;
    this._config = config;
  }

  initBM25(KB) {
    // Build field-boosted texts: name/aliases repeated 3x, summary 2x
    // so that terms in important fields get higher TF and thus higher BM25 scores.
    const texts = KB.map(e => {
      const name = e.name || '';
      const aliases = Array.isArray(e.aliases) ? e.aliases.join(' ') : '';
      const summary = e.summary || '';
      const f = e.f || {};
      const def = (f.def || []).map(d => typeof d === 'string' ? d : (d?.text || '')).join(' ');
      const int = (f.int || []).map(d => typeof d === 'string' ? d : (d?.text || '')).join(' ');
      const ex = (f.ex || []).map(d => typeof d === 'string' ? d : (d?.text || '')).join(' ');
      const form = (f.form || []).map(d => typeof d === 'string' ? d : (d?.text || '')).join(' ');
      const app = (f.app || []).map(d => typeof d === 'string' ? d : (d?.text || '')).join(' ');
      // Boost name and aliases by repeating, summary doubled
      return `${name} ${name} ${name} ${aliases} ${aliases} ${summary} ${summary} ${def} ${int} ${ex} ${form} ${app}`;
    });
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
          const boostAmount = 0.35 * (1 + (followUp.conversationDepth || 1) * 0.15);
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
          const baseScore = 0.25 + (followUp.conversationDepth || 1) * 0.08;
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

      // "how" — process/mechanism: bias toward formal + application (how it works)
      if (followUpType === 'how') {
        followUpSignals.complexityHint = 'deeper';
        followUpSignals.fragmentCountHint = 'more';
        followUpSignals.intentBias = 'application';
        if (intent.rawScores) {
          intent.rawScores.formal = Math.max(intent.rawScores.formal || 0, 0.45);
          intent.rawScores.application = Math.max(intent.rawScores.application || 0, 0.50);
        }
      }

      // "why" — reason/importance: bias toward intuition + formal (why it matters)
      if (followUpType === 'why') {
        followUpSignals.complexityHint = 'deeper';
        followUpSignals.fragmentCountHint = 'more';
        followUpSignals.intentBias = 'formal';
        if (intent.rawScores) {
          intent.rawScores.formal = Math.max(intent.rawScores.formal || 0, 0.50);
          intent.rawScores.definition = Math.max(intent.rawScores.definition || 0, 0.40);
        }
      }

      // "what else" — adjacent facts: bias toward broader coverage
      if (followUpType === 'what_else') {
        followUpSignals.fragmentCountHint = 'more';
        if (intent.rawScores) {
          intent.rawScores.application = Math.max(intent.rawScores.application || 0, 0.45);
          intent.rawScores.example = Math.max(intent.rawScores.example || 0, 0.40);
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

    // -----------------------------------------------------------------------
    // Explicit correction handling: when user says "I asked about X" or "no, just X"
    // Force the corrected topic to the top of rankings
    // -----------------------------------------------------------------------
    if (followUp && followUp.isFollowUp && (followUp.type === 'topic_correction' || followUp.type === 'topic_rejection')) {
      const correctionTarget = followUp.correctionTarget || followUp.target;

      if (correctionTarget && correctionTarget !== 'last') {
        // Try to find the correction target in the KB by name/alias matching
        const correctionLower = correctionTarget.toLowerCase();
        let correctionIdx = -1;

        for (let i = 0; i < KB.length; i++) {
          const entry = KB[i];
          if (!entry) continue;
          const name = (entry.name || '').toLowerCase();
          const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(a => a.toLowerCase()) : [];
          const allNames = [name, ...aliases];

          if (allNames.some(n => correctionLower.includes(n) || n.includes(correctionLower))) {
            correctionIdx = i;
            break;
          }
        }

        if (correctionIdx >= 0) {
          // Force this topic to the top with a very high score
          const existingIdx = reranked.findIndex(r => r.i === correctionIdx);
          const correctionBoost = 0.8; // Very strong boost — user explicitly asked for this

          if (existingIdx >= 0) {
            reranked[existingIdx] = {
              ...reranked[existingIdx],
              s: reranked[existingIdx].s + correctionBoost,
              correctionBoost,
            };
          } else {
            reranked.push({ i: correctionIdx, s: correctionBoost, correctionBoost, dense: 0, sparse: 0, rerankBonus: 0 });
          }

          // Demote topics that the user explicitly rejected
          if (followUp.type === 'topic_rejection' && session?.lastTopic != null) {
            const lastIdx = reranked.findIndex(r => r.i === session.lastTopic);
            if (lastIdx >= 0 && lastIdx < 3) {
              reranked[lastIdx] = {
                ...reranked[lastIdx],
                s: Math.max(reranked[lastIdx].s - 0.4, 0),
                correctionDemotion: -0.4,
              };
            }
          }

          // Re-sort
          reranked.sort((a, b) => b.s - a.s);

          followUpSignals.topicOverride = correctionIdx;
          followUpSignals.boostApplied = true;
          followUpSignals.boostDelta = correctionBoost;
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
