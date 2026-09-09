const CACHE_VERSION = 14;
const CACHE_PREFIX = 'relu-chat';
const APP_CACHE = `${CACHE_PREFIX}-v${CACHE_VERSION}`;
// Keep downloaded embedding/runtime bytes across UI releases. Version the URL
// when changing these model files; mutable policy artifacts use APP_CACHE.
const MODEL_CACHE = `${CACHE_PREFIX}-models-v13`;
const APP_ASSETS = ['/', '/chat/', '/errors/offline.html', '/assets/fonts/sora.css', '/assets/shared-design.css?v=14', '/manifest.webmanifest'];
const isModel = url => url.pathname.startsWith('/assets/models/all-MiniLM-L6-v2/') || url.pathname.startsWith('/assets/transformers/');
const openCache = name => caches.open(name).catch(() => null);
const readCache = (cache, request) => cache ? cache.match(request).catch(() => undefined) : Promise.resolve(undefined);
// Storage quotas or private browsing must not discard a valid network response.
const saveCache = (cache, request, response) => cache ? cache.put(request, response).catch(() => {}) : Promise.resolve();
async function cacheFirst(request) {
  const cache = await openCache(MODEL_CACHE);
  const response = await readCache(cache, request);
  if (response) return response;
  const fresh = await fetch(request);
  if (fresh.ok && fresh.status !== 206) await saveCache(cache, request, fresh.clone());
  return fresh;
}
async function networkFirst(request, navigation = false) {
  const cache = await openCache(APP_CACHE);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(request, { signal: controller.signal, cache: 'no-cache' });
    if (response.ok && response.status !== 206) await saveCache(cache, request, response.clone());
    return response;
  } catch {
    const cached = await readCache(cache, request);
    if (cached) return cached;
    if (navigation) return (await readCache(cache, '/errors/offline.html')) || new Response('This page is not available offline. Reconnect and try again.', {status:503,headers:{'Content-Type':'text/plain'}});
    return new Response('Offline asset unavailable', { status: 503 });
  } finally { clearTimeout(timeout); }
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await openCache(APP_CACHE);
    await Promise.all(APP_ASSETS.map(async url => {
      const response = await fetch(url, {cache:'reload'});
      if (!response.ok) throw new Error(`Precache failed: ${url}`);
      await saveCache(cache,url,response);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX + '-') && key !== APP_CACHE && key !== MODEL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // API writes and partial responses must never enter a public asset cache.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || request.headers.has('range')) return;
  if (isModel(url)) { event.respondWith(cacheFirst(request)); return; }
  if (request.mode === 'navigate') { event.respondWith(networkFirst(request, true)); return; }
  if (/\.(?:js|css|json|wasm|bin|woff2?|png|svg|webp|jpg|webmanifest)$/.test(url.pathname)) event.respondWith(networkFirst(request));
});
