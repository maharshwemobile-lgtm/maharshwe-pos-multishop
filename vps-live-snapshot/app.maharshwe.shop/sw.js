self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {}

    try {
      await self.registration.unregister();
    } catch {}

    try {
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(clients.map((client) => client.navigate(client.url)));
    } catch {}
  })());
});

self.addEventListener('fetch', () => {
  // Legacy cache worker disabled on purpose.
});
