import { STOP } from './nlp.js';

function tokens(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
}

function bigrams(tokenList) {
  const result = [];
  for (let i = 0; i < tokenList.length - 1; i++) {
    result.push(tokenList[i] + '_' + tokenList[i + 1]);
  }
  return result;
}

export class BM25Scorer {
  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this._ready = false;
    this._docCount = 0;
    this._avgDocLen = 0;
    this._docLens = [];
    this._df = new Map();
    this._idf = new Map();
    this._docTokens = [];
    this._docBigrams = [];
  }

  fit(documents) {
    this._docCount = documents.length;
    this._docTokens = documents.map(doc => tokens(doc));
    this._docLens = this._docTokens.map(t => t.length);
    this._avgDocLen = this._docLens.reduce((a, b) => a + b, 0) / Math.max(this._docCount, 1);

    // Build document frequency map (unigrams + bigrams)
    this._df.clear();
    for (const tkns of this._docTokens) {
      const seen = new Set();
      // Unigrams
      for (const t of tkns) {
        if (!seen.has(t)) {
          this._df.set(t, (this._df.get(t) || 0) + 1);
          seen.add(t);
        }
      }
      // Bigrams
      for (const bg of bigrams(tkns)) {
        if (!seen.has(bg)) {
          this._df.set(bg, (this._df.get(bg) || 0) + 1);
          seen.add(bg);
        }
      }
    }

    // Compute IDF
    this._idf.clear();
    for (const [term, df] of this._df) {
      this._idf.set(term, Math.log((this._docCount - df + 0.5) / (df + 0.5) + 1));
    }

    // Pre-compute bigrams for each document
    this._docBigrams = this._docTokens.map(tkns => bigrams(tkns));

    this._ready = true;
    return this;
  }

  score(query, docIdx) {
    if (!this._ready) return 0;
    const qTokens = tokens(query);
    const docTokens = this._docTokens[docIdx];
    const docLen = this._docLens[docIdx];

    if (!docTokens || docLen === 0) return 0;

    // Build term frequency map
    const tf = new Map();
    for (const t of docTokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    let score = 0;

    // Unigram scoring
    for (const qt of qTokens) {
      const idf = this._idf.get(qt) || 0;
      if (idf === 0) continue;
      const termFreq = tf.get(qt) || 0;
      if (termFreq === 0) continue;
      score += idf * ((termFreq * (this.k1 + 1)) / (termFreq + this.k1 * (1 - this.b + this.b * (docLen / this._avgDocLen))));
    }

    // Bigram scoring (bonus for adjacent word matches)
    const qBigrams = bigrams(qTokens);
    const docBigramSet = new Set(this._docBigrams[docIdx] || []);
    if (qBigrams.length > 0 && docBigramSet.size > 0) {
      for (const qbg of qBigrams) {
        if (docBigramSet.has(qbg)) {
          const idf = this._idf.get(qbg) || 1.5; // default IDF for unseen bigrams
          score += idf * 0.8; // bigram bonus (scaled to not dominate)
        }
      }
    }

    return score;
  }

  scoreAll(query) {
    if (!this._ready) return [];
    const results = [];
    for (let i = 0; i < this._docCount; i++) {
      results.push({ i, s: this.score(query, i) });
    }
    const maxScore = results.reduce((m, r) => Math.max(m, r.s), 0);
    if (maxScore > 0) {
      for (const r of results) r.s /= maxScore;
    }
    return results.sort((a, b) => b.s - a.s);
  }

  getReady() { return this._ready; }
}
