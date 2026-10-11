'use strict';
// Precise subject instruments shared by the entire site. The topic/guide slug
// selects a content-specific motif; coordinates follow fixed illustrative
// models rather than random data. Covers are static; inline plates opt into
// the finite, visibility-aware timelines in figures.js.

const COLORS = {
  'game-theory': '#f4b73f',
  'golden-age': '#36c6b3',
  'data-science': '#5aaaf5',
  'reinforcement-learning': '#9bd54a',
  'linear-algebra': '#f26da6',
  'web-platform': '#a994ff',
  brand: '#ff6b4a',
};
const INK = '#0d1210';
const PAPER = '#f3f5f2';
const W = 480, H = 320;

const { instrument, SUBJECTS } = require('./instruments.cjs');
const f = n => +n.toFixed(1);
const brand = () => '<path d="M64 226H216L416 66" fill="none" stroke="#24342e" stroke-width="14" stroke-linecap="round"/><circle cx="216" cy="226" r="8" fill="#f3f2e9" stroke="#24342e" stroke-width="2"/>';
const DRAW = { ...Object.fromEntries(Object.keys(SUBJECTS).map(key => [key, () => instrument(key)])), brand };

/** Inner SVG markup, with a motif matched to the actual topic or guide slug. */
function plateBody(subject, seed) {
  const key = DRAW[subject] ? subject : 'brand';
  return key === 'brand' ? brand() : instrument(key, seed);
}

/**
 * A complete inline plate. `anim` opts into figures.js when in view.
 * Decorative: surrounding headings/captions carry the meaning.
 */
function plate(subject, seed = '', { anim = true, className = '' } = {}) {
  const key = DRAW[subject] ? subject : 'brand';
  return `<svg class="plate-svg instrument-svg ${className}" data-subject="${key}"${anim ? ' data-motion-figure' : ''} viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><rect width="${W}" height="${H}" fill="${COLORS[key]}"/>${plateBody(key, seed)}</svg>`;
}

/** Standalone .svg document (for blog covers; 1200x630 canvas, plate centred). */
function coverSvg(subject, seed = '') {
  const key = DRAW[subject] ? subject : 'brand';
  const s = 1.7; // 480x320 -> 816x544
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630"><rect width="1200" height="630" fill="${COLORS[key]}"/><g transform="translate(${f((1200 - W * s) / 2)} ${f((630 - H * s) / 2 + 0)}) scale(${s})">${plateBody(key, seed).replace(/ class="a-[a-z]+"/g, '').replace(/ style="--d:\d+ms"/g, '')}</g></svg>\n`;
}

/** Which subject a guide belongs to, for its cover colour. First matching tag wins. */
const TAG_SUBJECT = [
  ['reinforcement-learning', ['reinforcement-learning', 'policy-network', 'ppo', 'reward-design', 'training', 'cold-start']],
  ['linear-algebra', ['linear-algebra', 'cosine-similarity', 'vectors', 'vector-search', 'embeddings', 'float32', 'float64', 'precision', 'numerical-computing', 'math', 'word2vec']],
  ['game-theory', ['game-theory']],
  ['golden-age', ['history-of-science', 'sources']],
  ['web-platform', ['web-platform', 'browser', 'service-worker', 'pwa', 'webassembly', 'wasm', 'indexeddb', 'offline', 'offline-first', 'caching', 'web-workers', 'accessibility', 'rendering', 'loading', 'storage', 'javascript', 'performance', 'katex', 'animation', 'webgpu']],
  ['data-science', ['data-science', 'evaluation', 'ndcg', 'mrr', 'machine-learning', 'bias', 'bm25', 'retrieval', 'nlp']],
];
function subjectOfPost(post) {
  const tags = new Set(post.tags || []);
  for (const [subject, list] of TAG_SUBJECT) if (list.some((t) => tags.has(t))) return subject;
  return 'data-science';
}


module.exports = { COLORS, INK, PAPER, plate, plateBody, coverSvg, subjectOfPost };
