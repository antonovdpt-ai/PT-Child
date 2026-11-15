/* Cache only the public offline screen, never patient records, auth, or the app shell. */
const CACHE = 'fizira-offline-v1';
const OFFLINE_PAGE = '/offline.html';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE_PAGE)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('fizira-offline-') && key !== CACHE)
      .map(key => caches.delete(key))
  )));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).catch(async () =>
      (await caches.match(OFFLINE_PAGE)) || Response.error()
    )
  );
});
