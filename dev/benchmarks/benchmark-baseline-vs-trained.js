#!/usr/bin/env node
/**
 * benchmark-baseline-vs-trained.js — ReLU.chat Policy Behavior Comparison
 *
 * Compares a trained policy model against a random-weight baseline on
 * a set of curated test scenarios. Each scenario includes the query,
 * expected intent, and expected mode. The benchmark reports:
 *   - Per-scenario action comparison (mode, intent, topic_count, tone, creativity)
 *   - Aggregate metrics (intent accuracy, mode accuracy, agreement rate)
 *   - Logit divergence (L1 distance between trained and baseline output distributions)
 *
 * Usage:
 *   node dev/benchmarks/benchmark-baseline-vs-trained.js
 *   node dev/benchmarks/benchmark-baseline-vs-trained.js --weights assets/models/policy/policy.weights.json
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MLPPolicy } from '../../policy/mlp-inference.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Test scenarios — query, feature signals, expected behavior
// ---------------------------------------------------------------------------

// Each scenario is a feature object (matching extractPolicyFeatures output) with
// an expected intent and mode. These are hand-crafted to represent diverse queries.
const TEST_SCENARIOS = [
  {
    name: 'definition: Nash equilibrium',
    features: {
      qSimTop1: 0.78, qSimTop2: 0.52, entityCount: 1, entityBoostHit: true,
      intentDefScore: 0.82, intentExScore: 0.35, intentFormScore: 0.28,
      intentAppScore: 0.22, intentCompScore: 0.15,
      lastTopicSim: 0.0, lastTopicAge: 8, kbCoverage: 0.65,
      queryLenTokens: 5, hasComparisonCue: false, hasFormalCue: false,
      hasExampleCue: false, botCreativity: 0.35, domainMatch: 0.65,
      followUpType: 0, wasAmbiguous: false,
      avgTruthConf: 0.85, avgSourceConf: 0.75, minDifficulty: 1, fragDiversity: 3,
      avoidWithCount: 0.1,
    },
    expectedIntent: 'definition',
    expectedMode: 'normal',
  },
  {
    name: 'example: Prisoner\'s dilemma',
    features: {
      qSimTop1: 0.62, qSimTop2: 0.40, entityCount: 1, entityBoostHit: true,
      intentDefScore: 0.30, intentExScore: 0.75, intentFormScore: 0.18,
      intentAppScore: 0.45, intentCompScore: 0.20,
      lastTopicSim: 0.0, lastTopicAge: 8, kbCoverage: 0.55,
      queryLenTokens: 7, hasComparisonCue: false, hasFormalCue: false,
      hasExampleCue: true, botCreativity: 0.35, domainMatch: 0.60,
      followUpType: 0, wasAmbiguous: false,
      avgTruthConf: 0.80, avgSourceConf: 0.70, minDifficulty: 2, fragDiversity: 3,
      avoidWithCount: 0.1,
    },
    expectedIntent: 'example',
    expectedMode: 'normal',
  },
  {
    name: 'formal: prove theorem',
    features: {
      qSimTop1: 0.45, qSimTop2: 0.28, entityCount: 0, entityBoostHit: false,
      intentDefScore: 0.25, intentExScore: 0.15, intentFormScore: 0.72,
      intentAppScore: 0.12, intentCompScore: 0.10,
      lastTopicSim: 0.0, lastTopicAge: 8, kbCoverage: 0.35,
      queryLenTokens: 8, hasComparisonCue: false, hasFormalCue: true,
      hasExampleCue: false, botCreativity: 0.35, domainMatch: 0.55,
      followUpType: 0, wasAmbiguous: false,
      avgTruthConf: 0.75, avgSourceConf: 0.65, minDifficulty: 3, fragDiversity: 2,
      avoidWithCount: 0.05,
    },
    expectedIntent: 'formal',
    expectedMode: 'normal',
  },
  {
    name: 'application: real world uses',
    features: {
      qSimTop1: 0.55, qSimTop2: 0.42, entityCount: 1, entityBoostHit: true,
      intentDefScore: 0.20, intentExScore: 0.40, intentFormScore: 0.12,
      intentAppScore: 0.80, intentCompScore: 0.18,
      lastTopicSim: 0.0, lastTopicAge: 8, kbCoverage: 0.50,
      queryLenTokens: 9, hasComparisonCue: false, hasFormalCue: false,
      hasExampleCue: false, botCreativity: 0.35, domainMatch: 0.62,
      followUpType: 0, wasAmbiguous: false,
      avgTruthConf: 0.78, avgSourceConf: 0.72, minDifficulty: 2, fragDiversity: 4,
      avoidWithCount: 0.08,
    },
    expectedIntent: 'application',
    expectedMode: 'normal',
  },
  {
    name: 'comparison: Nash vs Pareto',
    features: {
      qSimTop1: 0.65, qSimTop2: 0.55, entityCount: 2, entityBoostHit: true,
      intentDefScore: 0.30, intentExScore: 0.28, intentFormScore: 0.15,
      intentAppScore: 0.20, intentCompScore: 0.78,
      lastTopicSim: 0.0, lastTopicAge: 8, kbCoverage: 0.60,
      queryLenTokens: 11, hasComparisonCue: true, hasFormalCue: false,
      hasExampleCue: false, botCreativity: 0.35, domainMatch: 0.68,
      followUpType: 0, wasAmbiguous: false,
      avgTruthConf: 0.82, avgSourceConf: 0.70, minDifficulty: 3, fragDiversity: 4,
      avoidWithCount: 0.15,
    },
    expectedIntent: 'comparison',
    expectedMode: 'comparison',
  },
  {
    name: 'off-topic: weather query',
    features: {
      qSimTop1: 0.08, qSimTop2: 0.05, entityCount: 0, entityBoostHit: false,
      intentDefScore: 0.05, intentExScore: 0.04, intentFormScore: 0.03,
      intentAppScore: 0.06, intentCompScore: 0.02,
      lastTopicSim: 0.0, lastTopicAge: 8, kbCoverage: 0.05,
      queryLenTokens: 6, hasComparisonCue: false, hasFormalCue: false,
      hasExampleCue: false, botCreativity: 0.35, domainMatch: 0.10,
      followUpType: 0, wasAmbiguous: false,
      avgTruthConf: 0.30, avgSourceConf: 0.25, minDifficulty: 1, fragDiversity: 0,
      avoidWithCount: 0.0,
    },
    expectedIntent: 'definition',  // any, won't matter — mode is key
    expectedMode: 'off_topic',
  },
  {
    name: 'greeting: hello',
    features: {
      qSimTop1: 0.03, qSimTop2: 0.01, entityCount: 0, entityBoostHit: false,
      intentDefScore: 0.02, intentExScore: 0.01, intentFormScore: 0.01,
      intentAppScore: 0.02, intentCompScore: 0.01,
      lastTopicSim: 0.0, lastTopicAge: 8, kbCoverage: 0.02,
      queryLenTokens: 2, hasComparisonCue: false, hasFormalCue: false,
      hasExampleCue: false, botCreativity: 0.35, domainMatch: 0.05,
      followUpType: 0, wasAmbiguous: false,
      avgTruthConf: 0.1, avgSourceConf: 0.1, minDifficulty: 1, fragDiversity: 0,
      avoidWithCount: 0.0,
    },
    expectedIntent: 'definition',
    expectedMode: 'greeting',
  },
  {
    name: 'definition: Shapley value',
    features: {
      qSimTop1: 0.70, qSimTop2: 0.48, entityCount: 1, entityBoostHit: true,
      intentDefScore: 0.78, intentExScore: 0.30, intentFormScore: 0.35,
      intentAppScore: 0.40, intentCompScore: 0.12,
      lastTopicSim: 0.0, lastTopicAge: 8, kbCoverage: 0.58,
      queryLenTokens: 4, hasComparisonCue: false, hasFormalCue: false,
      hasExampleCue: false, botCreativity: 0.35, domainMatch: 0.63,
      followUpType: 0, wasAmbiguous: false,
      avgTruthConf: 0.83, avgSourceConf: 0.73, minDifficulty: 2, fragDiversity: 3,
      avoidWithCount: 0.08,
    },
    expectedIntent: 'definition',
    expectedMode: 'normal',
  },
  {
    name: 'follow-up: elaborate',
    features: {
      qSimTop1: 0.72, qSimTop2: 0.50, entityCount: 1, entityBoostHit: true,
      intentDefScore: 0.60, intentExScore: 0.35, intentFormScore: 0.30,
      intentAppScore: 0.25, intentCompScore: 0.10,
      lastTopicSim: 0.68, lastTopicAge: 1, kbCoverage: 0.62,
      queryLenTokens: 3, hasComparisonCue: false, hasFormalCue: false,
      hasExampleCue: false, botCreativity: 0.35, domainMatch: 0.64,
      followUpType: 4, wasAmbiguous: false,
      avgTruthConf: 0.84, avgSourceConf: 0.74, minDifficulty: 2, fragDiversity: 3,
      avoidWithCount: 0.1,
    },
    expectedIntent: 'definition',
    expectedMode: 'normal',
  },
  {
    name: 'ambiguous query',
    features: {
      qSimTop1: 0.35, qSimTop2: 0.22, entityCount: 0, entityBoostHit: false,
      intentDefScore: 0.38, intentExScore: 0.32, intentFormScore: 0.18,
      intentAppScore: 0.28, intentCompScore: 0.20,
      lastTopicSim: 0.0, lastTopicAge: 8, kbCoverage: 0.30,
      queryLenTokens: 6, hasComparisonCue: false, hasFormalCue: false,
      hasExampleCue: false, botCreativity: 0.35, domainMatch: 0.45,
      followUpType: 0, wasAmbiguous: true,
      avgTruthConf: 0.55, avgSourceConf: 0.50, minDifficulty: 3, fragDiversity: 2,
      avoidWithCount: 0.05,
    },
    expectedIntent: 'definition',
    expectedMode: 'normal',
  },
];

const BOT_PROFILE = {
  allowedIntents: ['definition', 'example', 'formal', 'application', 'comparison'],
  tone: 'neutral',
  maxTopics: 3,
  creativityCeiling: 0.35,
};

const CONTEXT = {
  ranked: [{ i: 0, s: 0.78 }, { i: 1, s: 0.52 }, { i: 2, s: 0.31 }],
};

// ---------------------------------------------------------------------------
// Helper: generate random weights (baseline)
// ---------------------------------------------------------------------------

function makeRandomWeights(version = 2) {
  const w = { _version: version };
  const randMat = (rows, cols) =>
    Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.random() * 2 - 1));
  const randVec = (len) => Array.from({ length: len }, () => Math.random() * 0.5);

  w['fc1.weight'] = randMat(128, 25);
  w['fc1.bias'] = randVec(128);
  w['fc2.weight'] = randMat(64, 128);
  w['fc2.bias'] = randVec(64);
  w['mode_head.weight'] = randMat(5, 64);
  w['mode_head.bias'] = randVec(5);
  w['intent_head.weight'] = randMat(5, 64);
  w['intent_head.bias'] = randVec(5);
  w['topic_count_head.weight'] = randMat(4, 64);
  w['topic_count_head.bias'] = randVec(4);
  w['frag_count_head.weight'] = randMat(4, 64);
  w['frag_count_head.bias'] = randVec(4);
  w['creativity_head.weight'] = [randVec(64).map(v => v * 2)];
  w['creativity_head.bias'] = [0];
  w['tone_head.weight'] = randMat(4, 64);
  w['tone_head.bias'] = randVec(4);
  return w;
}

// ---------------------------------------------------------------------------
// Helper: run all scenarios through a policy
// ---------------------------------------------------------------------------

function runScenarios(policy, label) {
  const results = [];
  for (const scenario of TEST_SCENARIOS) {
    const plan = policy.planAnswer(scenario.features, CONTEXT, BOT_PROFILE);
    results.push({
      name: scenario.name,
      expectedIntent: scenario.expectedIntent,
      expectedMode: scenario.expectedMode,
      predictedIntent: plan.intent,
      predictedMode: plan.mode,
      predictedTone: plan.tone,
      predictedTopicCount: plan.topics.length || 0,
      predictedCreativity: plan.creativity,
      decisionPath: plan.meta?.decisionPath || [],
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helper: compute aggregate metrics
// ---------------------------------------------------------------------------

function computeMetrics(results) {
  let intentCorrect = 0;
  let modeCorrect = 0;
  let total = results.length;

  for (const r of results) {
    if (r.predictedIntent === r.expectedIntent && r.expectedMode !== 'off_topic' && r.expectedMode !== 'greeting') {
      intentCorrect++;
    }
    if (r.predictedMode === r.expectedMode) {
      modeCorrect++;
    }
  }
  return {
    intentAccuracy: (intentCorrect / total * 100).toFixed(1),
    modeAccuracy: (modeCorrect / total * 100).toFixed(1),
    totalScenarios: total,
  };
}

// ---------------------------------------------------------------------------
// Helper: compute L1 divergence between two policies' output probabilities
// ---------------------------------------------------------------------------

function computeLogitDivergence(trainedPolicy, baselinePolicy, features) {
  const tOut = trainedPolicy.forward(new Float32Array(25).map((_, i) => {
    const keys = ['qSimTop1','qSimTop2','entityCount','entityBoostHit',
      'intentDefScore','intentExScore','intentFormScore','intentAppScore','intentCompScore',
      'lastTopicSim','lastTopicAge','kbCoverage','queryLenTokens',
      'hasComparisonCue','hasFormalCue','hasExampleCue',
      'botCreativity','domainMatch','followUpType','wasAmbiguous',
      'avgTruthConf','avgSourceConf','minDifficulty','fragDiversity','avoidWithCount'];
    return features[keys[i]] || 0;
  }));
  const bOut = baselinePolicy.forward(new Float32Array(25).map((_, i) => {
    const keys = ['qSimTop1','qSimTop2','entityCount','entityBoostHit',
      'intentDefScore','intentExScore','intentFormScore','intentAppScore','intentCompScore',
      'lastTopicSim','lastTopicAge','kbCoverage','queryLenTokens',
      'hasComparisonCue','hasFormalCue','hasExampleCue',
      'botCreativity','domainMatch','followUpType','wasAmbiguous',
      'avgTruthConf','avgSourceConf','minDifficulty','fragDiversity','avoidWithCount'];
    return features[keys[i]] || 0;
  }));

  // L1 distance between probability distributions
  const dists = {
    mode: l1(tOut.modeProbs, bOut.modeProbs),
    intent: l1(tOut.intentProbs, bOut.intentProbs),
    topicCount: l1(tOut.topicCountProbs, bOut.topicCountProbs),
    fragCount: l1(tOut.fragCountProbs, bOut.fragCountProbs),
    tone: l1(tOut.toneProbs, bOut.toneProbs),
  };
  dists.mean = (dists.mode + dists.intent + dists.topicCount + dists.fragCount + dists.tone) / 5;
  return dists;
}

function l1(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadTrainedWeights(weightsPath) {
  if (!existsSync(weightsPath)) {
    console.error(`ERROR: Trained weights not found at ${weightsPath}`);
    console.error('Run `python3 dev/scripts/train-policy.py` first to generate trained weights.');
    return null;
  }
  try {
    const raw = readFileSync(weightsPath, 'utf-8');
    const json = JSON.parse(raw);
    const weights = json.weights || json;
    return weights;
  } catch (e) {
    console.error(`ERROR: Failed to parse weights from ${weightsPath}: ${e.message}`);
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const weightsPath = args.includes('--weights')
    ? args[args.indexOf('--weights') + 1]
    : resolve(__dirname, '../../assets/models/policy/policy.weights.json');

  console.log('═'.repeat(70));
  console.log('ReLU.chat Policy — Baseline vs Trained Behavior Comparison');
  console.log('═'.repeat(70));
  console.log(`  Weights path: ${weightsPath}`);
  console.log(`  Scenarios:    ${TEST_SCENARIOS.length}`);
  console.log();

  // Load trained weights
  const trainedWeights = loadTrainedWeights(weightsPath);
  if (!trainedWeights) {
    console.log('\nUsing random weights as trained (no trained model found).');
    console.log('This means both policies will be random — results will be meaningless.');
    console.log('Run training first: python3 dev/scripts/train-policy.py --epochs 200');
  }

  // Build baseline (random weights)
  const baselineWeights = makeRandomWeights();
  const baselinePolicy = new MLPPolicy(baselineWeights);

  // Build trained policy
  const trainedPolicy = trainedWeights
    ? new MLPPolicy(trainedWeights)
    : new MLPPolicy(makeRandomWeights());

  // -----------------------------------------------------------------------
  // Per-scenario comparison
  // -----------------------------------------------------------------------
  const baselineResults = runScenarios(baselinePolicy, 'baseline');
  const trainedResults = runScenarios(trainedPolicy, 'trained');

  console.log('Per-Scenario Comparison:');
  console.log('─'.repeat(70));
  console.log(
    'Scenario'.padEnd(34) +
    'Expected'.padEnd(20) +
    'Baseline'.padEnd(20) +
    'Trained'
  );
  console.log('─'.repeat(70));

  for (let i = 0; i < TEST_SCENARIOS.length; i++) {
    const s = TEST_SCENARIOS[i];
    const b = baselineResults[i];
    const t = trainedResults[i];

    console.log(
      s.name.padEnd(34) +
      `${s.expectedMode}/${s.expectedIntent}`.padEnd(20) +
      `${b.predictedMode}/${b.predictedIntent}`.padEnd(20) +
      `${t.predictedMode}/${t.predictedIntent}`
    );
  }

  // -----------------------------------------------------------------------
  // Aggregate metrics
  // -----------------------------------------------------------------------
  const baselineMetrics = computeMetrics(baselineResults);
  const trainedMetrics = computeMetrics(trainedResults);

  console.log();
  console.log('═'.repeat(70));
  console.log('Aggregate Metrics:');
  console.log('─'.repeat(70));
  console.log(`  Baseline (random weights):`);
  console.log(`    Mode accuracy:    ${baselineMetrics.modeAccuracy}%`);
  console.log(`    Intent accuracy:  ${baselineMetrics.intentAccuracy}%`);
  console.log(`  Trained model:`);
  console.log(`    Mode accuracy:    ${trainedMetrics.modeAccuracy}%`);
  console.log(`    Intent accuracy:  ${trainedMetrics.intentAccuracy}%`);

  // Mode accuracy delta
  const modeDelta = parseFloat(trainedMetrics.modeAccuracy) - parseFloat(baselineMetrics.modeAccuracy);
  const intentDelta = parseFloat(trainedMetrics.intentAccuracy) - parseFloat(baselineMetrics.intentAccuracy);
  console.log(`  Improvement:`);
  console.log(`    Mode delta:       ${modeDelta > 0 ? '+' : ''}${modeDelta.toFixed(1)} pp`);
  console.log(`    Intent delta:     ${intentDelta > 0 ? '+' : ''}${intentDelta.toFixed(1)} pp`);

  // -----------------------------------------------------------------------
  // Logit divergence (average L1 across scenarios)
  // -----------------------------------------------------------------------
  console.log();
  console.log('═'.repeat(70));
  console.log('Output Divergence (L1 distance between trained vs baseline):');
  console.log('─'.repeat(70));

  let avgDiv = { mode: 0, intent: 0, topicCount: 0, fragCount: 0, tone: 0, mean: 0 };
  for (const s of TEST_SCENARIOS) {
    const d = computeLogitDivergence(trainedPolicy, baselinePolicy, s.features);
    avgDiv.mode += d.mode;
    avgDiv.intent += d.intent;
    avgDiv.topicCount += d.topicCount;
    avgDiv.fragCount += d.fragCount;
    avgDiv.tone += d.tone;
    avgDiv.mean += d.mean;
  }
  const n = TEST_SCENARIOS.length;
  console.log(`  Mode (L1):        ${(avgDiv.mode / n).toFixed(4)}`);
  console.log(`  Intent (L1):      ${(avgDiv.intent / n).toFixed(4)}`);
  console.log(`  Topic Count (L1): ${(avgDiv.topicCount / n).toFixed(4)}`);
  console.log(`  Frag Count (L1):  ${(avgDiv.fragCount / n).toFixed(4)}`);
  console.log(`  Tone (L1):        ${(avgDiv.tone / n).toFixed(4)}`);
  console.log(`  Mean L1:          ${(avgDiv.mean / n).toFixed(4)}`);
  console.log();
  console.log('(L1=0 means identical outputs, L1=2 means maximally different)');
  console.log();

  // -----------------------------------------------------------------------
  // Decision path sampling
  // -----------------------------------------------------------------------
  console.log('═'.repeat(70));
  console.log('Sample Decision Paths (first 3 scenarios):');
  console.log('─'.repeat(70));

  for (let i = 0; i < Math.min(3, TEST_SCENARIOS.length); i++) {
    console.log(`  ${TEST_SCENARIOS[i].name}:`);
    console.log(`    Trained  → ${trainedResults[i].decisionPath.join(' → ')}`);
    console.log(`    Baseline → ${baselineResults[i].decisionPath.join(' → ')}`);
  }

  console.log();
  console.log('Done.');
}

main();
