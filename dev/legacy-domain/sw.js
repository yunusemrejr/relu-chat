// Served only at https://relu.chat/sw.js after the move to reluchat.yunusemrevurgun.com.
// Browsers that installed the old worker fetch this file to update it. It
// deletes the old origin's caches, unregisters itself and reloads any open
// page at the same path on the new address. No fetch handler: nothing is
// intercepted while it runs.
const NEW_ORIGIN = 'https://reluchat.yunusemrevurgun.com';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      const url = new URL(client.url);
      try { await client.navigate(NEW_ORIGIN + url.pathname + url.search + url.hash); } catch {}
    }
  })());
});
