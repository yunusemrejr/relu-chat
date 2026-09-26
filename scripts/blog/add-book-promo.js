#!/usr/bin/env node
/**
 * Blog Book Promo — inserts the "Remain Valuable" end-note into articles.
 *
 * - Inserts a contextual `rv-note` aside between related-reading and the
 *   article footer, plus the shared stylesheet link in <head>.
 * - Copy variant is chosen from the post's tags in content/blog/posts/*.json.
 * - Idempotent: files that already contain the note are skipped.
 * - Never regenerates pages (article HTML carries hand-applied SEO edits).
 *
 * Usage:
 *   node scripts/blog/add-book-promo.js [--dry-run] [--print-map]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const POSTS_DIR = path.join(ROOT, 'content', 'blog', 'posts');
const BLOG_OUT = path.join(ROOT, 'blog');

const BOOK_URL = 'https://theknowledgeproject.gumroad.com/l/remainvaluable';
const BOOK_TITLE = 'How to Remain Valuable When Intelligence Becomes Cheap';
const CSS_HREF = '/assets/css/remain-valuable.css?v=1';
const CSS_ANCHOR_RE = /<link rel="stylesheet" href="\/assets\/css\/article\.css"\s*\/?>/;
const NOTE_ANCHOR = '</aside><div class="article-footer">';
const NOTE_MARKER = 'class="rv-note"';

// Tag clusters. First match wins, in priority order below.
const STRATEGY_TAGS = new Set([
  'game-theory', 'history-of-science', 'bias', 'sources',
  'accessibility', 'aria', 'wcag', 'inclusive-design',
]);
const ML_TAGS = new Set([
  'reinforcement-learning', 'machine-learning', 'data-science',
  'sentence-transformers', 'minilm', 'mlp', 'policy-network', 'ppo',
  'reward-design', 'quantization', 'int8', 'distillation', 'model-size',
  'nlp', 'ner', 'intent-classification', 'intents', 'natural-language',
  'rag', 'word2vec', 'zero-shot', 'training', 'evaluation', 'tokenization',
  'bpe', 'on-device-ai', 'browser-ai', 'browser-ml', 'edge-ai',
  'chatbots', 'chat-architecture', 'prototypes', 'fuzzy-matching',
  'spelling-correction', 'conversation', 'correction', 'topic', 'context',
  'follow-up', 'session', 'chat-sessions', 'memory', 'chat', 'state-machine',
  'patterns', 'fallbacks', 'cold-start',
]);
const WEB_TAGS = new Set([
  'web-platform', 'javascript', 'service-worker', 'wasm', 'webassembly',
  'web-workers', 'webgpu', 'performance', 'caching', 'offline',
  'offline-first', 'pwa', 'storage', 'indexeddb',
  'loading', 'boot', 'profiling', 'latency', 'debugging', 'privacy',
  'security', 'local-first', 'progressive', 'streaming', 'on-device',
  'optimization', 'open-source', 'animation',
]);
const MATH_TAGS = new Set([
  'linear-algebra', 'math', 'latex', 'katex', 'mathjax', 'vectors',
  'vector-search', 'cosine-similarity', 'bm25', 'retrieval', 'ranking',
  'sparse', 'ensemble', 'mrr', 'ndcg', 'precision', 'numerical-computing',
  'float32', 'float64', 'worked-example', 'chunking', 'metadata',
  'query-expansion', 'eviction', 'search', 'knowledge-base', 'composition',
  'embeddings',
]);

const COPY = {
  ml: `This guide covered one corner of machine intelligence. <em>${BOOK_TITLE}</em> zooms out: a 240-page practical guide to the human strengths and strategic advantages that stay valuable as AI takes on more cognitive work.`,
  web: `Fast, private software that runs anywhere is one way to stay ahead of the curve. The bigger picture is in <em>${BOOK_TITLE}</em>: a 240-page practical guide to the human and strategic advantages that compound as AI improves.`,
  math: `Fundamentals like these compound for decades. <em>${BOOK_TITLE}</em> applies the same long-view thinking to your career: a 240-page practical guide to the advantages that stay valuable when intelligence gets cheap.`,
  strategy: `Systems change; judgment stays scarce. <em>${BOOK_TITLE}</em> is a 240-page practical guide to the human, economic, and strategic advantages that remain valuable even when AI can do most cognitive work.`,
};

function pickVariant(tags) {
  const set = new Set(tags || []);
  const has = (cluster) => [...cluster].some((t) => set.has(t));
  if (has(STRATEGY_TAGS)) return 'strategy';
  if (has(ML_TAGS)) return 'ml';
  if (has(WEB_TAGS)) return 'web';
  if (has(MATH_TAGS)) return 'math';
  return 'strategy';
}

function buildNote(variant) {
  return (
    `<aside class="rv-note" aria-label="Recommended book">` +
    `<span class="rv-note-label">Going further</span>` +
    `<p class="rv-note-text">${COPY[variant]} ` +
    `<a class="rv-note-link" href="${BOOK_URL}" target="_blank" rel="noopener noreferrer">Get the book <span class="rv-arrow" aria-hidden="true">&rarr;</span></a></p>` +
    `</aside>`
  );
}

function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const printMap = args.has('--print-map');

  const posts = fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(POSTS_DIR, f), 'utf8')))
    .filter((p) => p.status === 'published' || p.published !== false);

  let inserted = 0;
  let skipped = 0;
  const errors = [];
  const map = [];

  for (const post of posts) {
    const variant = pickVariant(post.tags);
    map.push(`${post.slug} -> ${variant}`);
    const file = path.join(BLOG_OUT, post.slug, 'index.html');
    if (!fs.existsSync(file)) {
      errors.push(`${post.slug}: missing ${file}`);
      continue;
    }
    let html = fs.readFileSync(file, 'utf8');
    if (html.includes(NOTE_MARKER) && html.includes(CSS_HREF)) {
      skipped += 1;
      continue;
    }
    if (!html.includes(NOTE_ANCHOR)) {
      errors.push(`${post.slug}: anchor not found`);
      continue;
    }
    const cssMatch = html.match(CSS_ANCHOR_RE);
    if (!cssMatch) {
      errors.push(`${post.slug}: CSS anchor not found`);
      continue;
    }
    html = html.replace(
      CSS_ANCHOR_RE,
      `${cssMatch[0]}\n<link rel="stylesheet" href="${CSS_HREF}">`
    );
    html = html.replace(
      NOTE_ANCHOR,
      `</aside>\n${buildNote(variant)}\n<div class="article-footer">`
    );
    if (!dryRun) fs.writeFileSync(file, html);
    inserted += 1;
  }

  if (printMap) console.log(map.sort().join('\n'));
  console.log(
    `${dryRun ? '[dry-run] ' : ''}posts=${posts.length} inserted=${inserted} skipped=${skipped} errors=${errors.length}`
  );
  for (const e of errors) console.log(`ERROR ${e}`);
  if (errors.length > 0) process.exitCode = 1;
}

main();
