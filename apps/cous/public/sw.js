// Where: the production build serves this file at /sw.js (public/ is
//        copied into dist/).
// When: a production page registers it (src/pwa/register.ts).
// Why: cous plays offline after one visit. A page loads network first,
//      with the cached page as the fallback. Other files load from the
//      cache first. /api (the leaderboard) always uses the network.

const CACHE = 'cous-v1';
const PAGE = new URL('/', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(PAGE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// The page sends the files that it loaded. Cache each one, and delete
// the files that this page did not load (the files of an old build).
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-files') return;
  const urls = event.data.urls.filter(
    (u) => new URL(u).origin === self.location.origin,
  );
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(urls.map((u) => cache.add(u)));
      const keep = new Set([PAGE, ...urls]);
      for (const request of await cache.keys()) {
        if (!keep.has(request.url)) await cache.delete(request);
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(PAGE, copy));
          return response;
        })
        .catch(() => caches.match(PAGE)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
