const CACHE_NAME = 'gex-shell-v1';
const SHELL_ASSETS = [
  '/mobile/',
  '/mobile/mobile.css',
  '/mobile/mobile.js',
  '/mobile/touch.js',
  '/js/api.js',
  '/js/chart/constants.js',
  '/js/chart/EventBus.js',
  '/js/chart/ViewportModel.js',
  '/js/chart/BaseSection.js',
  '/js/chart/PriceChart.js',
  '/js/chart/GEXSection.js',
  '/js/chart/VolumeSection.js',
  'https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Network-first for API calls
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('{"error":"offline"}', {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
    );
    return;
  }

  // Cache-first for shell assets
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
