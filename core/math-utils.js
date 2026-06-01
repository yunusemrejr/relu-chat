/**
 * math-utils.js — Shared math utilities for ReLU.chat
 *
 * Consolidates functions previously duplicated across core/nlp.js and
 * policy/mlp-inference.js.
 *
 * All functions are behavior-neutral — they preserve the exact semantics
 * of their original implementations.
 */

// ---------------------------------------------------------------------------
// Numerically stable softmax
// ---------------------------------------------------------------------------

/**
 * Softmax with optional temperature parameter.
 *
 * Uses the numerically stable formulation: exp(x_i - max) / Σ exp(x_j - max).
 * Accepts both regular arrays and typed arrays (Float32Array, etc.).
 * Non-finite inputs are treated as 0.
 *
 * @param {Array<number>|Float32Array} arr - input logits
 * @param {number} [t=1] - temperature (must be > 0)
 * @returns {Array<number>|Float32Array} - probabilities that sum to 1
 */
export function softmax(arr, t = 1) {
  if (!Array.isArray(arr) && !(arr instanceof Float32Array) || arr.length === 0) {
    return arr instanceof Float32Array ? new Float32Array(0) : [];
  }
  if (t <= 0) t = 1e-9;

  // Filter non-finite values to 0 (mirrors nlp.js behavior)
  const filtered = arr.map ? arr.map(x => Number.isFinite(x) ? x : 0) : Array.from(arr).map(x => Number.isFinite(x) ? x : 0);
  const m = Math.max(...filtered);
  const e = filtered.map(x => Math.exp((x - m) / t));
  const s = e.reduce((a, b) => a + b, 0);
  if (s > 0) {
    return arr instanceof Float32Array ? new Float32Array(e.map(x => x / s)) : e.map(x => x / s);
  }
  // Fallback: uniform distribution
  const uniform = filtered.map(() => 1 / filtered.length);
  return arr instanceof Float32Array ? new Float32Array(uniform) : uniform;
}

// ---------------------------------------------------------------------------
// Sigmoid activation
// ---------------------------------------------------------------------------

/**
 * Numerically stable sigmoid: 1 / (1 + exp(-x)).
 *
 * @param {number} x - input
 * @returns {number} value in [0, 1]
 */
export function sigmoid(x) {
  if (x >= 0) {
    // Numerically stable for positive x: 1 / (1 + exp(-x))
    return 1 / (1 + Math.exp(-x));
  }
  // For negative x: exp(x) / (1 + exp(x))
  const e = Math.exp(x);
  return e / (1 + e);
}

// ---------------------------------------------------------------------------
// Clamp to [0, 1]
// ---------------------------------------------------------------------------

/**
 * Clamp a number to [0, 1]. Non-finite values become 0.
 *
 * @param {number} v - input value
 * @returns {number} clamped value in [0, 1]
 */
export function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

// ---------------------------------------------------------------------------
// Argmax
// ---------------------------------------------------------------------------

/**
 * Index of the maximum value in an array.
 *
 * @param {Array<number>|Float32Array} arr - input array
 * @returns {number} index of the maximum element
 */
export function argmax(arr) {
  let best = 0;
  let bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > bestVal) {
      best = i;
      bestVal = arr[i];
    }
  }
  return best;
}
