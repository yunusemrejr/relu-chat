/**
 * test-tools-math.js — Unit tests for interactive ML tools math
 *
 * Tests activation functions, gradient descent math, and backpropagation
 * chain rule computations used by the tools/ directory.
 *
 * Run:  node tests/test-tools-math.js
 */

import { softmax, sigmoid, clamp01 } from '../core/math-utils.js';

// ── Test harness ───────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; process.stdout.write('\x1b[32m.\x1b[0m'); }
  else { failed++; failures.push(msg); process.stdout.write('\x1b[31mF\x1b[0m'); }
}

function assertEq(actual, expected, msg) {
  if (Object.is(actual, expected) || Math.abs(actual - expected) < 1e-6) {
    passed++; process.stdout.write('\x1b[32m.\x1b[0m');
  } else {
    failed++; failures.push(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}

function assertClose(actual, expected, tol, msg) {
  tol = tol || 1e-6;
  if (Math.abs(actual - expected) < tol) { passed++; process.stdout.write('\x1b[32m.\x1b[0m'); }
  else {
    failed++; failures.push(`${msg}: expected ${expected} ± ${tol}, got ${actual}`);
    process.stdout.write('\x1b[31mF\x1b[0m');
  }
}

// ── Activation functions (replicated from tools) ──────────────────────────

function relu(x) { return Math.max(0, x); }

function reluPrime(x) { return x > 0 ? 1 : 0; }

function sigmoidPrime(x) {
  const s = sigmoid(x);
  return s * (1 - s);
}

function tanh(x) { return Math.tanh(x); }

function tanhPrime(x) {
  const t = Math.tanh(x);
  return 1 - t * t;
}

// ── Gradient descent: derivative via numerical check ──────────────────────

function numericalDerivative(f, x, h) {
  h = h || 1e-6;
  return (f(x + h) - f(x - h)) / (2 * h);
}

function quadratic(x) { return x * x + 0.08 * Math.sin(x * 3); }
function quadraticPrime(x) { return 2 * x + 0.24 * Math.cos(x * 3); }

function quartic(x) { return Math.pow(x, 4) - 3 * x * x + 1; }
function quarticPrime(x) { return 4 * Math.pow(x, 3) - 6 * x; }

// ── Tests ─────────────────────────────────────────────────────────────────

// 1. Activation: ReLU
console.log('\n  Activation: ReLU');
assertEq(relu(5), 5, 'relu(5) = 5');
assertEq(relu(0), 0, 'relu(0) = 0');
assertEq(relu(-3), 0, 'relu(-3) = 0');
assertEq(relu(0.001), 0.001, 'relu(0.001)');
assertEq(reluPrime(5), 1, 'relu\'(5) = 1');
assertEq(reluPrime(0), 0, 'relu\'(0) = 0');
assertEq(reluPrime(-2), 0, 'relu\'(-2) = 0');

// 2. Activation: Sigmoid
console.log('\n  Activation: Sigmoid');
assertClose(sigmoid(0), 0.5, 1e-6, 'sigmoid(0) = 0.5');
assertClose(sigmoid(100), 1, 1e-6, 'sigmoid(100) ≈ 1');
assertClose(sigmoid(-100), 0, 1e-6, 'sigmoid(-100) ≈ 0');
assertClose(sigmoid(1), 0.7310585, 1e-6, 'sigmoid(1)');
assertClose(sigmoid(-1), 0.2689414, 1e-6, 'sigmoid(-1)');

// Sigmoid derivative: σ'(x) = σ(x)(1-σ(x))
assertClose(sigmoidPrime(0), 0.25, 1e-6, 'sigmoid\'(0) = 0.25');
assertClose(sigmoidPrime(2), sigmoid(2) * (1 - sigmoid(2)), 1e-6, 'sigmoid\'(2)');

// 3. Activation: Tanh
console.log('\n  Activation: Tanh');
assertEq(tanh(0), 0, 'tanh(0) = 0');
assertClose(tanh(1), 0.761594, 1e-6, 'tanh(1)');
assertClose(tanhPrime(1), 1 - Math.pow(Math.tanh(1), 2), 1e-6, 'tanh\'(1)');

// 4. Softmax
console.log('\n  Softmax');
const sm = softmax([1, 2, 3]);
assertClose(sm[0], 0.0900305, 1e-6, 'softmax[0]');
assertClose(sm[1], 0.2447284, 1e-6, 'softmax[1]');
assertClose(sm[2], 0.6652409, 1e-6, 'softmax[2]');
assertClose(sm.reduce((a, b) => a + b, 0), 1, 1e-6, 'softmax sums to 1');

// Softmax with temperature
const smHot = softmax([1, 2, 3], 0.5);
assert(smHot[2] > sm[2], 'lower temperature sharpens distribution');

// Softmax with Float32Array
const sm32 = softmax(new Float32Array([0, 0]));
assertClose(sm32[0], 0.5, 1e-6, 'softmax uniform Float32Array');

// 5. Clamp01
console.log('\n  Clamp01');
assertEq(clamp01(0.5), 0.5, 'clamp01(0.5)');
assertEq(clamp01(-0.1), 0, 'clamp01(-0.1)');
assertEq(clamp01(1.5), 1, 'clamp01(1.5)');
assertEq(clamp01(Infinity), 0, 'clamp01(Infinity) is finite');
assertEq(clamp01(NaN), 0, 'clamp01(NaN)');
assertEq(clamp01(-Infinity), 0, 'clamp01(-Infinity)');

// 6. Gradient descent: derivative computation
console.log('\n  Gradient Descent Derivatives');
// Quadratic: f(x) = x² + ε
assertClose(quadraticPrime(1), numericalDerivative(quadratic, 1), 1e-4, 'quadraticPrime(1)');
assertClose(quadraticPrime(0), numericalDerivative(quadratic, 0), 1e-4, 'quadraticPrime(0)');
assertClose(quadraticPrime(-1), numericalDerivative(quadratic, -1), 1e-4, 'quadraticPrime(-1)');

// Quartic: f(x) = x⁴ − 3x² + 1 (two local minima)
assertClose(quarticPrime(1), numericalDerivative(quartic, 1), 1e-4, 'quarticPrime(1)');
assertClose(quarticPrime(0), numericalDerivative(quartic, 0), 1e-4, 'quarticPrime(0)');
assertClose(quarticPrime(-1), numericalDerivative(quartic, -1), 1e-4, 'quarticPrime(-1)');

// Gradient descent step: x₁ = x₀ - α * f'(x₀)
function gdStep(x, lr, df) { return x - lr * df(x); }
const x1 = gdStep(2, 0.1, quadraticPrime);
assert(x1 < 2, 'gd step moves toward minimum (positive grad → negative update)');
const x2 = gdStep(-2, 0.1, quadraticPrime);
assert(x2 > -2, 'gd step moves toward minimum (negative grad → positive update)');

// 7. Backpropagation: chain rule
console.log('\n  Backpropagation Chain Rule');

// Small 2→2→1 network (same topology as the visualizer)
const Wih = [[0.5, -0.4], [0.3, 0.6]];
const Who = [0.8, -0.5];
const Bh = [0.1, -0.2];
const Bo = 0.3;

function forwardBP(x1, x2) {
  const z1 = x1 * Wih[0][0] + x2 * Wih[1][0] + Bh[0];
  const a1 = relu(z1);
  const z2 = x1 * Wih[0][1] + x2 * Wih[1][1] + Bh[1];
  const a2 = relu(z2);
  const yRaw = a1 * Who[0] + a2 * Who[1] + Bo;
  const y = sigmoid(yRaw);
  return { z1, a1, z2, a2, yRaw, y };
}

const result = forwardBP(0.5, 0.3);
assert(result.y > 0, 'forward pass produces positive output');
assert(result.y < 1, 'sigmoid output bounded in (0,1)');
assertEq(result.a1, relu(result.z1), 'ReLU activation: a1 = ReLU(z1)');
assertEq(result.a2, relu(result.z2), 'ReLU activation: a2 = ReLU(z2)');

// Loss: L = ½(y - t)²
function mseLoss(y, t) { return 0.5 * (y - t) ** 2; }

const target = 1;
const loss = mseLoss(result.y, target);
assert(loss >= 0, 'MSE loss is non-negative');

// Chain rule verification: dL/dy_raw = dL/dy * dy/dy_raw
const dLdy = result.y - target;
const dy_dyRaw = sigmoidPrime(result.yRaw);
const dL_dyRaw = dLdy * dy_dyRaw;
assertClose(dL_dyRaw, (result.y - target) * result.y * (1 - result.y), 1e-8, 'dL/dy_raw via chain rule');

// Verify gradient for w_h1: dL/dw_h1 = dL/dy_raw * a1
const gradWh1 = dL_dyRaw * result.a1;
assertClose(gradWh1, (result.y - target) * result.y * (1 - result.y) * result.a1, 1e-8, 'gradient w_h1');

// Verify gradient for w_11: dL/dw_11 = dL/dz_1 * x1
const dL_da1 = dL_dyRaw * Who[0];
const da1_dz1 = reluPrime(result.z1);
const dL_dz1 = dL_da1 * da1_dz1;
const gradW11 = dL_dz1 * 0.5; // x1 = 0.5
assertClose(gradW11, dL_dz1 * 0.5, 1e-8, 'gradient w_11');

// Numerical gradient check for a weight
function lossAtWeight(w_new, weightIdx) {
  const wCopy = [[Wih[0][0], Wih[0][1]], [Wih[1][0], Wih[1][1]]];
  if (weightIdx < 2) wCopy[0][weightIdx] = w_new;
  else wCopy[1][weightIdx - 2] = w_new;
  const z1_ = 0.5 * wCopy[0][0] + 0.3 * wCopy[1][0] + Bh[0];
  const a1_ = relu(z1_);
  const z2_ = 0.5 * wCopy[0][1] + 0.3 * wCopy[1][1] + Bh[1];
  const a2_ = relu(z2_);
  const yRaw_ = a1_ * Who[0] + a2_ * Who[1] + Bo;
  const y_ = sigmoid(yRaw_);
  return mseLoss(y_, target);
}

const numGradW11 = numericalDerivative(w => lossAtWeight(w, 0), Wih[0][0], 1e-5);
assertClose(gradW11, numGradW11, 1e-4, 'numerical gradient check w_11');

// 8. Backpropagation weight update
console.log('\n  Weight Update');
const lr = 0.5;
const updatedW11 = Wih[0][0] - lr * gradW11;
const updatedLoss = lossAtWeight(updatedW11, 0);
assert(updatedLoss <= loss + 1e-6, 'loss decreases after gradient descent step');

// Weight moves in direction of negative gradient
assert(updatedW11 !== Wih[0][0], 'weight changes after gradient descent step');

// 9. Edge cases
console.log('\n  Edge Cases');
assert(Number.isNaN(relu(NaN)), 'relu(NaN) is NaN (Math.max propagates NaN)');
assert(Number.isFinite(sigmoid(1000)), 'sigmoid(1000) is finite');
assert(Number.isFinite(sigmoid(-1000)), 'sigmoid(-1000) is finite');
assert(Number.isFinite(tanh(1000)), 'tanh(1000) is finite');

// Softmax with all zeros
const smZero = softmax([0, 0, 0]);
smZero.forEach(v => assertClose(v, 1/3, 1e-6, 'uniform softmax'));

// Softmax with extreme values
const smExtreme = softmax([1000, -1000, 0]);
assertClose(smExtreme[0], 1, 1e-6, 'softmax extreme max');
assertClose(smExtreme[1], 0, 1e-6, 'softmax extreme min');

// ── Results ───────────────────────────────────────────────────────────────

console.log(`\n\n  Results: ${passed} passed, ${failed} failed${failed ? ':\n  ' + failures.join('\n  ') : ''}`);
process.exit(failed > 0 ? 1 : 0);
