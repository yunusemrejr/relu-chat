const STOP = new Set("a an the of in on at for to with and or is are was were be been being what which who whom whose this that these those i you he she it we they them us my your his her its our their me do does did can could should would will might may has have had".split(' '));

function tokens(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
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
  }

  fit(documents) {
    this._docCount = documents.length;
    this._docTokens = documents.map(doc => tokens(doc));
    this._docLens = this._docTokens.map(t => t.length);
    this._avgDocLen = this._docLens.reduce((a, b) => a + b, 0) / Math.max(this._docCount, 1);

    this._df.clear();
    for (const tkns of this._docTokens) {
      const seen = new Set();
      for (const t of tkns) {
        if (!seen.has(t)) {
          this._df.set(t, (this._df.get(t) || 0) + 1);
          seen.add(t);
        }
      }
    }

    this._idf.clear();
    for (const [term, df] of this._df) {
      this._idf.set(term, Math.log((this._docCount - df + 0.5) / (df + 0.5) + 1));
    }

    this._ready = true;
    return this;
  }

  score(query, docIdx) {
    if (!this._ready) return 0;
    const qTokens = tokens(query);
    const docTokens = this._docTokens[docIdx];
    const docLen = this._docLens[docIdx];

    if (!docTokens || docLen === 0) return 0;

    const tf = new Map();
    for (const t of docTokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    let score = 0;
    for (const qt of qTokens) {
      const idf = this._idf.get(qt) || 0;
      if (idf === 0) continue;
      const termFreq = tf.get(qt) || 0;
      score += idf * ((termFreq * (this.k1 + 1)) / (termFreq + this.k1 * (1 - this.b + this.b * (docLen / this._avgDocLen))));
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
