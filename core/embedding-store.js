// Only public knowledge vectors are persisted. Questions and conversations are not.
const STORE = 'vectors';
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('relu-embeddings-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function embeddingKey(KB, entryText, intents, model) {
  const data = new TextEncoder().encode(JSON.stringify([model, KB.map(entryText), intents]));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function readEmbeddings(key) {
  let db;
  try {
    db = await openDB();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch { return null; } finally { db?.close(); }
}
export function validEmbeddings(value, entryCount, intents, dimensions = 384) {
  const vector = v => Array.isArray(v) && v.length === dimensions && v.every(Number.isFinite);
  return Array.isArray(value?.entries) && value.entries.length === entryCount && value.entries.every(vector) &&
    Object.entries(intents).every(([name, intent]) => Array.isArray(value?.intents?.[name]) &&
      value.intents[name].length === intent.prototypes.length && value.intents[name].every(vector));
}
export async function writeEmbeddings(key, vectors) {
  let db;
  try {
    db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(vectors, key);
      // Bound public vector storage across knowledge-base revisions.
      const keys = store.getAllKeys();
      keys.onsuccess = () => { for (const old of keys.result.filter(k => k !== key).slice(0, Math.max(0, keys.result.length - 12))) store.delete(old); };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } catch { /* Caching is optional in private mode and under storage pressure. */ }
  finally { db?.close(); }
}
