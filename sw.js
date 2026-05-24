const CACHE = 'relu-chat-v3';
const ASSETS = [
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
  '/manifest.webmanifest'
];

const MODEL_CACHE = 'relu-chat-models-v2';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== MODEL_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/assets/models/') || url.pathname.startsWith('/assets/transformers/')) {
    e.respondWith(
      caches.open(MODEL_CACHE).then(c =>
        c.match(e.request).then(r =>
          r || fetch(e.request).then(res => {
            if (res.ok && res.status !== 206) c.put(e.request, res.clone());
            return res;
          }).catch(() => new Response('', { status: 503 }))
        )
      )
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r =>
      r || fetch(e.request).then(res => {
        if (res.ok && url.origin === self.location.origin &&
            (url.pathname.startsWith('/core/') || url.pathname.startsWith('/data/') ||
             url.pathname.startsWith('/assets/') || url.pathname.startsWith('/chat/'))) {
          if (res.status !== 206) {
            const cloned = res.clone();
            caches.open(CACHE).then(c => { c.put(e.request, cloned); });
          }
          return res;
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