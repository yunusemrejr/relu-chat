export class LRUCache {
  constructor(max) {
    this.max = Math.max(1, Math.min(max || 500, 10000));
    this.cache = new Map();
  }
  get(key) {
    if (key == null || !this.cache.has(key)) return undefined;
    const v = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, v);
    return v;
  }
  set(key, val) {
    if (val === null || val === undefined) return;
    if (Array.isArray(val) && val.length === 0) return;
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.max) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, val);
  }
  has(key) {
    return this.cache.has(key);
  }
  delete(key) {
    return this.cache.delete(key);
  }
  clear() {
    this.cache.clear();
  }
  get size() {
    return this.cache.size;
  }
}
