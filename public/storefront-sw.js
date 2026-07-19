const CACHE = 'maharshwe-storefront-hero-carousel-v25';
const SHELL = [
  '/storefront.html',
  '/storefront-app.css?v=20260718-category-icons-v13',
  '/storefront-google.css?v=20260718-category-icons-v13',
  '/storefront-preview-theme.css?v=20260718-filter-controls-v15',
  '/storefront-original-v2.css?v=20260719-hero-carousel-v25',
  '/storefront-app.js?v=20260719-hero-carousel-v25',
  '/mahar-pos-logo-192.png',
  '/mahar-pos-logo-512.png',
  '/default-product-image.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/storefront.html')));
  }
});
