/**
 * build-bm25-index.js
 * Standalone BM25 inverted index builder for bot-pack export.
 * Produces a JSON-serializable inverted index from KB entries.
 *
 * Usage (from export script):
 *   const { buildBM25Index } = require('./build-bm25-index.js');
 *   const index = buildBM25Index(KB);
 */

// ── Stop words (mirrors core/nlp.js) ──────────────────────────────────────
const STOP = new Set(
  'a an the of in on at for to with and or is are was were be been being what which who whom whose this that these those i you he she it we they them us my your his her its our their me do does did can could should would will might may has have had not no nor don\'t doesn\'t didn\'t won\'t wouldn\'t can\'t couldn\'t'.split(' ')
);

function tokenize(t) {
  if (!t || typeof t !== 'string') return [];
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && w.length > 0 && !STOP.has(w));
}

function bigrams(tokenList) {
  const result = [];
  for (let i = 0; i < tokenList.length - 1; i++) {
    result.push(tokenList[i] + '_' + tokenList[i + 1]);
  }
  return result;
}

function countTerms(tokens) {
  const map = new Map();
  for (const t of tokens) {
    map.set(t, (map.get(t) || 0) + 1);
  }
  return map;
}

/**
 * Build an inverted BM25 index from KB entries.
 *
 * Each entry in KB is expected to have:
 *   { id, name, aliases: string[], summary, f: { def[], int[], ex[], form[], app[] } }
 *
 * Returns:
 * {
 *   terms: { "word": [[entryId, tfTitle, tfAlias, tfBody], ...] },
 *   bigrams: { "word1_word2": [[entryId, tfPhrase], ...] },
 *   idf: { "word": 1.92 },
 *   docLen: [45, 67, ...],
 *   avgDocLen: 123.4,
 *   fieldWeights: { title: 4.0, alias: 3.0, summary: 1.5, fragment: 1.0 },
 *   docCount: N
 * }
 */
function buildBM25Index(KB) {
  const docCount = KB.length;
  const fieldWeights = { title: 4.0, alias: 3.0, summary: 1.5, fragment: 1.0 };

  // Per-document field token lists and lengths
  const docs = KB.map((entry, idx) => {
    const titleTokens = tokenize(entry.name || '');
    const aliasTokens = (entry.aliases || []).flatMap(a => tokenize(a));
    const summaryTokens = tokenize(entry.summary || '');
    const f = entry.f || {};
    const fragmentTexts = [
      ...(f.def || []),
      ...(f.int || []),
      ...(f.ex || []),
      ...(f.form || []),
      ...(f.app || [])
    ];
    const fragmentTokens = fragmentTexts.flatMap(txt =>
      typeof txt === 'string' ? tokenize(txt) : tokenize(txt?.text || '')
    );

    const allTokens = [
      ...titleTokens,
      ...aliasTokens,
      ...summaryTokens,
      ...fragmentTokens
    ];

    return {
      entryId: idx,
      titleTokens,
      aliasTokens,
      summaryTokens,
      fragmentTokens,
      allTokens,
      docLen: allTokens.length
    };
  });

  const docLens = docs.map(d => d.docLen);
  const avgDocLen = docLens.reduce((a, b) => a + b, 0) / Math.max(docCount, 1);

  // ── Build term postings (unigrams) ─────────────────────────────────────
  const termPostings = new Map(); // term -> Map(entryId -> {tfTitle, tfAlias, tfSummary, tfFragment})

  for (const doc of docs) {
    const titleCounts = countTerms(doc.titleTokens);
    const aliasCounts = countTerms(doc.aliasTokens);
    const summaryCounts = countTerms(doc.summaryTokens);
    const fragmentCounts = countTerms(doc.fragmentTokens);

    const allUniqueTerms = new Set([
      ...titleCounts.keys(),
      ...aliasCounts.keys(),
      ...summaryCounts.keys(),
      ...fragmentCounts.keys()
    ]);

    for (const term of allUniqueTerms) {
      if (!termPostings.has(term)) {
        termPostings.set(term, new Map());
      }
      const postings = termPostings.get(term);
      postings.set(doc.entryId, [
        titleCounts.get(term) || 0,
        aliasCounts.get(term) || 0,
        summaryCounts.get(term) || 0,
        fragmentCounts.get(term) || 0
      ]);
    }
  }

  // ── Build bigram postings ──────────────────────────────────────────────
  const bigramPostings = new Map(); // bigram -> Map(entryId -> tfPhrase)

  for (const doc of docs) {
    const allBigrams = bigrams(doc.allTokens);
    const bigramCounts = countTerms(allBigrams);

    for (const [bg, count] of bigramCounts) {
      if (!bigramPostings.has(bg)) {
        bigramPostings.set(bg, new Map());
      }
      bigramPostings.get(bg).set(doc.entryId, count);
    }
  }

  // ── Compute IDF for all terms (unigrams + bigrams) ─────────────────────
  const idf = {};

  // Document frequency for unigrams
  for (const [term, postings] of termPostings) {
    const df = postings.size;
    idf[term] = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
  }

  // Document frequency for bigrams
  for (const [bg, postings] of bigramPostings) {
    const df = postings.size;
    idf[bg] = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
  }

  // ── Convert to JSON-friendly structures ────────────────────────────────
  const terms = {};
  for (const [term, postings] of termPostings) {
    terms[term] = Array.from(postings.entries()).map(([entryId, counts]) => [
      entryId, counts[0], counts[1], counts[2], counts[3]
    ]);
  }

  const bigramsOut = {};
  for (const [bg, postings] of bigramPostings) {
    bigramsOut[bg] = Array.from(postings.entries()).map(([entryId, count]) => [
      entryId, count
    ]);
  }

  return {
    terms,
    bigrams: bigramsOut,
    idf,
    docLen: docLens,
    avgDocLen: parseFloat(avgDocLen.toFixed(4)),
    fieldWeights,
    docCount
  };
}

/**
 * Build an alias lookup table with normalized keys.
 * Supports accent normalization, punctuation stripping, lowercase.
 *
 * Returns: { "normalized_alias": [[entryId, score], ...] }
 * Score is a simple weight: exact name = 1.0, first alias = 0.95, others = 0.9
 */
function buildAliasIndex(KB) {
  const aliases = {};

  function normalize(text) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip accents
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  for (let i = 0; i < KB.length; i++) {
    const entry = KB[i];
    const name = entry.name || '';
    const entryAliases = entry.aliases || [];

    // Name gets highest score
    const normName = normalize(name);
    if (normName) {
      if (!aliases[normName]) aliases[normName] = [];
      aliases[normName].push([i, 1.0]);
    }

    // Aliases
    for (let a = 0; a < entryAliases.length; a++) {
      const normAlias = normalize(entryAliases[a]);
      if (!normAlias) continue;
      if (!aliases[normAlias]) aliases[normAlias] = [];
      // Avoid duplicate entry for same alias pointing to same entry
      const already = aliases[normAlias].find(x => x[0] === i);
      if (!already) {
        const score = a === 0 ? 0.95 : 0.9;
        aliases[normAlias].push([i, score]);
      }
    }
  }

  return aliases;
}

module.exports = { buildBM25Index, buildAliasIndex, tokenize, STOP };
