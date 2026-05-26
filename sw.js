const CACHE_VERSION = 5;
const CACHE_PREFIX = 'relu-chat';
const APP_CACHE = `${CACHE_PREFIX}-v${CACHE_VERSION}`;
const MODEL_CACHE = `${CACHE_PREFIX}-models-v${CACHE_VERSION}`;

const APP_ASSETS = [
  '/',
  '/assets/logo.png',
  '/assets/fonts/inter.css',
  '/assets/katex/katex.min.css',
  '/assets/katex/katex.min.js',
  '/assets/katex/auto-render.min.js',
  '/core/ui.js',
  '/core/cache.js',
  '/core/nlp.js',
  '/core/bm25.js',
  '/core/signal-layer.js',
  '/core/chatbot-engine.js',
  '/assets/transformers/transformers.js',
  '/manifest.webmanifest'
];

// Immutable assets: versioned URLs that never change (cache-first, no network needed)
const IMMUTABLE_REGEX = /\/assets\/transformers\/.*\.wasm$|\/assets\/models\/.*\.(onnx|json)$/;

// Static assets that benefit from stale-while-revalidate: serve cached, update in background
const STATIC_REGEX = /\.(css|js|woff2?|ttf|otf|eot|png|svg|webmanifest)$/;

// Model assets to background-preload after activation (best-effort, don't block)
const MODEL_PRELOAD_ASSETS = [
  '/assets/transformers/ort-wasm-simd-threaded.wasm',
  '/assets/transformers/ort-wasm-simd.wasm',
  '/assets/transformers/ort-wasm-threaded.wasm',
  '/assets/transformers/ort-wasm.wasm',
  '/assets/models/all-MiniLM-L6-v2/onnx/model_quantized.onnx',
  '/assets/models/policy/policy.manifest.json',
  '/assets/models/policy/policy.weights.json',
];

function isModelRequest(url) {
  return url.pathname.startsWith('/assets/models/') || url.pathname.startsWith('/assets/transformers/');
}

function isImmutable(url) {
  return IMMUTABLE_REGEX.test(url.pathname);
}

function isStaticAsset(url) {
  return STATIC_REGEX.test(url.pathname);
}

// ---- Caching strategies ----

/** Cache-first: return cached response or fetch+store. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.status !== 206) {
    cache.put(request, response.clone());
  }
  return response;
}

/** Stale-while-revalidate: serve cached immediately, update in background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok && response.status !== 206) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

/** Handle model file requests with Range request support. */
async function handleModelRequest(request) {
  const cache = await caches.open(MODEL_CACHE);

  // Range request: serve partial content from cached full response
  if (request.headers.has('range')) {
    return handleRangeRequest(request, cache);
  }

  // Normal request: cache-first
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.status !== 206) {
    cache.put(request, response.clone());
  }
  return response;
}

/** Serve partial content from a cached full response. */
async function handleRangeRequest(request, cache) {
  // Match on URL alone (strip Range header from cache key)
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);

  if (cached) {
    const blob = await cached.blob();
    const match = request.headers.get('range').match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) + 1 : blob.size;
      if (start < blob.size && end <= blob.size && start < end) {
        const sliced = blob.slice(start, end);
        return new Response(sliced, {
          status: 206,
          statusText: 'Partial Content',
          headers: {
            'Content-Range': `bytes ${start}-${start + sliced.size - 1}/${blob.size}`,
            'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
            'Content-Length': String(sliced.size),
          },
        });
      }
    }
    // Range not satisfiable or malformed range — serve full response
    return cached;
  }

  // Not cached: pass Range request through to network
  const response = await fetch(request);
  if (response.ok && response.status !== 206) {
    cache.put(new Request(request.url, { method: 'GET' }), response.clone());
  }
  return response;
}

// ---- Event handlers ----

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP_CACHE).then(c => c.addAll(APP_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  const activeCaches = [APP_CACHE, MODEL_CACHE];

  // Phase 1: clean up old caches — fast, blocks activate
  const cleanup = caches.keys().then(keys =>
    Promise.all(keys.filter(k => !activeCaches.includes(k)).map(k => caches.delete(k)))
  );

  e.waitUntil(cleanup.then(() => self.clients.claim()));

  // Phase 2: pre-cache critical model files in background (best-effort)
  e.waitUntil(
    caches.open(MODEL_CACHE).then(c =>
      Promise.allSettled(MODEL_PRELOAD_ASSETS.map(asset => c.add(asset)))
    ).then(() => {
      console.log('[sw] Model preloading complete');
    })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // ---- Model files: /assets/models/ and /assets/transformers/ ----
  if (isModelRequest(url)) {
    if (isImmutable(url)) {
      // Immutable WASM files: cache-first (no network after first fetch)
      e.respondWith(cacheFirst(e.request, MODEL_CACHE));
    } else {
      // Model files with range request support
      e.respondWith(handleModelRequest(e.request));
    }
    return;
  }

  // ---- Static assets (CSS, JS, fonts, images): stale-while-revalidate ----
  if (isStaticAsset(url)) {
    e.respondWith(staleWhileRevalidate(e.request, APP_CACHE));
    return;
  }

  // ---- Default: cache-first with network fallback (preserves existing behavior) ----
  e.respondWith(
    caches.match(e.request).then(r =>
      r || fetch(e.request).then(res => {
        if (res.ok && res.status !== 206 &&
            (url.pathname.startsWith('/core/') || url.pathname.startsWith('/data/') ||
             url.pathname.startsWith('/assets/') || url.pathname.startsWith('/chat/'))) {
          const cloned = res.clone();
          caches.open(APP_CACHE).then(c => { c.put(e.request, cloned); });
        }
        return res;
      }).catch(() => {
        if (e.request.mode === 'navigate') {
          return caches.match('/');
        }
        return new Response('', { status: 503 });
      })
    )
  );
});
