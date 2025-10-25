const PRECACHE = ['__FAIRPOINT_PRECACHE__']
const CACHE_NAME = 'fairpoint-__FAIRPOINT_BUILD_HASH__'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('fairpoint-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached !== undefined) return cached
      return fetch(event.request).then((response) => {
        if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()))
        return response
      })
    }),
  )
})
