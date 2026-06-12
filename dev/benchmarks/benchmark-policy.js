#!/usr/bin/env node
/**
 * benchmark-policy.js — ReLU.chat Policy Runtime Benchmarks
 *
 * Measures latency of feature extraction, heuristic fallback, MLP inference
 * (float32 and quantized int8), and plan validation.
 * Run: node dev/benchmarks/benchmark-policy.js
 */

import { extractPolicyFeatures, packFeatures } from '../../policy/feature-extractor.js';
import { planAnswerHeuristic } from '../../policy/policy-runtime.js';
import { MLPPolicy } from '../../policy/mlp-inference.js';
import { validatePlan, DEFAULT_PLAN } from '../../policy/action-schema.js';

const KB = [
  { id: 'topic_001', name: 'Nash Equilibrium', aliases: ['Nash equilibrium', 'Nash'], f: { def: ['A solution concept...'], int: ['Players cannot benefit...'], ex: ['Prisoner\'s dilemma...'] }, related: [] },
  { id: 'topic_002', name: 'Prisoner\'s Dilemma', aliases: ['Prisoner\'s dilemma', 'PD'], f: { def: ['A classic game theory example...'], int: ['Two players face a choice...'], ex: ['Both confessing is the Nash equilibrium...'] }, related: [] },
  { id: 'topic_003', name: 'Shapley Value', aliases: ['Shapley value', 'Shapley'], f: { def: ['A solution concept in cooperative game theory...'], int: ['Distributes payoff fairly among players...'], ex: ['Used in cost allocation...'] }, related: [] },
];

const config = {
  botProfile: {
    id: 'test-bot', allowedIntents: ['definition', 'example', 'formal', 'application', 'comparison'],
    tone: 'neutral', maxTopics: 3, creativityCeiling: 0.35, domainPrototypes: ['game theory'],
  }
};

// Mock 384-dim embedding
const qEmb = Array.from({ length: 384 }, () => Math.random() * 2 - 1);
const ranked = [{ i: 0, s: 0.72 }, { i: 1, s: 0.45 }, { i: 2, s: 0.31 }];
const intentScores = { definition: 0.65, example: 0.42, formal: 0.21, application: 0.33, comparison: 0.55 };

function makeSyntheticWeights(version = 2) {
  const w = { _version: version };
  w['fc1.weight'] = Array.from({ length: 128 }, () => Array.from({ length: 25 }, () => Math.random() * 2 - 1));
  w['fc1.bias'] = Array.from({ length: 128 }, () => Math.random() * 0.5);
  w['fc2.weight'] = Array.from({ length: 64 }, () => Array.from({ length: 128 }, () => Math.random() * 2 - 1));
  w['fc2.bias'] = Array.from({ length: 64 }, () => Math.random() * 0.5);
  w['mode_head.weight'] = Array.from({ length: 5 }, () => Array.from({ length: 64 }, () => Math.random()));
  w['mode_head.bias'] = Array.from({ length: 5 }, () => 0);
  w['intent_head.weight'] = Array.from({ length: 5 }, () => Array.from({ length: 64 }, () => Math.random()));
  w['intent_head.bias'] = Array.from({ length: 5 }, () => 0);
  w['topic_count_head.weight'] = Array.from({ length: 4 }, () => Array.from({ length: 64 }, () => Math.random()));
  w['topic_count_head.bias'] = Array.from({ length: 4 }, () => 0);
  w['frag_count_head.weight'] = Array.from({ length: 4 }, () => Array.from({ length: 64 }, () => Math.random()));
  w['frag_count_head.bias'] = Array.from({ length: 4 }, () => 0);
  w['creativity_head.weight'] = [Array.from({ length: 64 }, () => Math.random() * 2 - 1)];
  w['creativity_head.bias'] = [0];
  w['tone_head.weight'] = Array.from({ length: 4 }, () => Array.from({ length: 64 }, () => Math.random()));
  w['tone_head.bias'] = Array.from({ length: 4 }, () => 0);
  return w;
}

function bench(label, fn, iterations = 1000) {
  // Warmup
  for (let i = 0; i < 100; i++) fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  const ns = Number(end - start) / iterations;
  console.log(`  ${label}: ${(ns / 1000).toFixed(2)} µs (${iterations} iterations)`);
}

function main() {
  console.log('ReLU.chat Policy Runtime — Performance Benchmarks');
  console.log(`Node ${process.version}\n`);

  // 1. Feature extraction
  console.log('1. Feature Extraction:');
  bench('extractPolicyFeatures', () => {
    extractPolicyFeatures('What is Nash equilibrium?', qEmb, ranked, [0], intentScores, null, null, KB, config, null, null, false);
  });
  bench('packFeatures', () => {
    const features = extractPolicyFeatures('What is Nash equilibrium?', qEmb, ranked, [0], intentScores, null, null, KB, config, null, null, false);
    packFeatures(features);
  });

  // 2. Heuristic fallback
  console.log('\n2. Heuristic Fallback:');
  const normalFeatures = {
    qSimTop1: 0.72, qSimTop2: 0.45, entityCount: 0, entityBoostHit: false,
    intentDefScore: 0.65, intentExScore: 0.42, intentFormScore: 0.21,
    intentAppScore: 0.33, intentCompScore: 0.55,
    lastTopicSim: 0, lastTopicAge: 0, kbCoverage: 0.5, queryLenTokens: 6,
    hasComparisonCue: false, hasFormalCue: false, hasExampleCue: false,
    botCreativity: 0.5, domainMatch: 0.6,
    followUpType: 0, wasAmbiguous: false,
    avgTruthConf: 0.8, avgSourceConf: 0.7, minDifficulty: 1, fragDiversity: 3,
  };
  bench('planAnswerHeuristic', () => planAnswerHeuristic(normalFeatures, KB, config, {}));

  // 3. MLP inference
  console.log('\n3. MLP Inference (synthetic weights):');
  const weights = makeSyntheticWeights();
  const mlp = new MLPPolicy(weights);

  // Load quantized weights (once, up-front)
  mlp.loadQuantized();

  // Memory stats
  const stats = mlp.getStats();
  console.log(`   Params:        ${stats.totalParams.toLocaleString()}`);
  console.log(`   Float32 bytes: ${stats.floatBytes.toLocaleString()}`);
  console.log(`   Quant bytes:   ${stats.quantizedBytes.toLocaleString()} (${stats.memorySavedPct}% reduction)`);

  const features24 = new Float32Array(25).fill(0.5);

  // Float32 forward pass
  bench('MLPPolicy.forward() (float32)', () => mlp.forward(features24));

  // Quantized forward pass
  bench('MLPPolicy.forwardQuantized() (int8)', () => mlp.forwardQuantized(features24));

  // Static benchmark with speedup ratio
  const bm = MLPPolicy.benchmark(mlp, features24, 5000);
  console.log(`   MLPPolicy.benchmark():`);
  console.log(`     float32:    ${bm.float32_us} µs`);
  if (bm.quantized_us !== null) {
    console.log(`     quantized:  ${bm.quantized_us} µs  (${bm.speedup}x speedup)`);
  }

  bench('MLPPolicy.planAnswer()', () => mlp.planAnswer(normalFeatures, { ranked }, {}));

  // 4. Validation
  console.log('\n4. Plan Validation:');
  const validPlan = { mode: 'normal', topics: [0, 1], intent: 'definition', fragmentPlan: [{ topicIdx: 0, cats: ['def', 'int'], fragIndices: [0, 0] }, { topicIdx: 1, cats: ['def'], fragIndices: [0] }], template: { openerIdx: 0, closerIdx: 0, comparisonOpenerKey: 'none', connectorKeys: ['def_to_int'] }, tone: 'neutral', creativity: 0.5, guardrails: { maxTopics: 3, requireEntity: false, minSim: 0.15, allowOffTopic: false }, clarification: null, meta: { policyVersion: '0.1.0', policyHash: 'test', decisionPath: ['test'] } };
  bench('validatePlan()', () => validatePlan(validPlan));

  console.log(`\nDone.`);
}

main();
