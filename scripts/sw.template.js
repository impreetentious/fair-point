const PRECACHE = ['__PRECACHE__']
const CACHE_NAME = '__PRODUCT_SLUG__-__BUILD_HASH__'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('__PRODUCT_SLUG__-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

// Cached response URLs omit fragments. A fresh response preserves the requested
// worker URL, whose fragment carries the bundled worker's bootstrap parameters.
function workerResponse(request, response) {
  return request.destination === 'worker'
    ? new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    : response
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin)
    return
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached !== undefined) return workerResponse(event.request, cached)
      return fetch(event.request).then((response) => {
        if (response.ok)
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()))
        return workerResponse(event.request, response)
      })
    }),
  )
})
