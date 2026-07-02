const CACHE_NAME = 'maharshwe-pos-phase11-settings-v1';
const STATIC_ASSETS = ['./manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => new Response(
        '<!doctype html><html><body style="font-family:Arial;padding:30px;text-align:center"><h2>Mahar POS is offline</h2><p>Internet ပြန်ရပြီးနောက် Refresh လုပ်ပါ။</p></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      ))
    );
    return;
  }

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok && (url.pathname.endsWith('.svg') || url.pathname.endsWith('.webmanifest'))) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
