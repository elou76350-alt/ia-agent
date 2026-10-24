/* CAP caches only a public, build-specific application shell. Never user data. */
const CACHE_NAME = /*__CAP_CACHE_NAME__*/ 'cap-static-unbuilt';
const STATIC_PATHS = /*__CAP_PRECACHE__*/ [];
const STATIC_SET = new Set(STATIC_PATHS);

function publicStaticRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search) return false;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return false;
  return STATIC_SET.has(url.pathname);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (!STATIC_PATHS.length) throw new Error('CAP: missing build cache manifest');
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(STATIC_PATHS.map(path => new Request(path, { cache: 'reload', credentials: 'omit' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('cap-static-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'CAP_ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  // Network navigation does not overwrite a shell that belongs to another build.
  // Offline recovery therefore always uses an index and assets from the same build.
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) return response;
        throw new Error('CAP: application shell unavailable');
      } catch {
        const cached = await (await caches.open(CACHE_NAME)).match('/index.html');
        return cached || new Response('CAP est indisponible hors connexion. Ouvrez une première fois l’application avec Internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }
  if (!publicStaticRequest(request)) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(CACHE_NAME)).match(url.pathname);
    return cached || fetch(request);
  })());
});
