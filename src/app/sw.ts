const PRECACHE = ['__FAIRPOINT_PRECACHE__']
const CACHE_NAME = 'fairpoint-__FAIRPOINT_BUILD_HASH__'

type ExtendableEvent = Event & { waitUntil: (promise: Promise<unknown>) => void }
type WorkerFetchEvent = Event & { request: Request; respondWith: (response: Promise<Response>) => void }
type WorkerScope = {
  addEventListener: (type: string, listener: (event: Event) => void) => void
  skipWaiting: () => Promise<void>
  clients: { claim: () => Promise<void> }
  location: { origin: string }
}

const worker = self as unknown as WorkerScope

worker.addEventListener('install', (event) => {
  const install = event as ExtendableEvent
  install.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => worker.skipWaiting()))
})

worker.addEventListener('activate', (event) => {
  const activate = event as ExtendableEvent
  activate.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('fairpoint-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => worker.clients.claim()),
  )
})

worker.addEventListener('fetch', (event) => {
  const fetchEvent = event as WorkerFetchEvent
  if (fetchEvent.request.method !== 'GET' || new URL(fetchEvent.request.url).origin !== worker.location.origin) return
  fetchEvent.respondWith(
    caches.match(fetchEvent.request).then((cached) => {
      if (cached !== undefined) return cached
      return fetch(fetchEvent.request).then((response) => {
        if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(fetchEvent.request, response.clone()))
        return response
      })
    }),
  )
})
