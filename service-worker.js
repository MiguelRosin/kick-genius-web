const CACHE_NAME = 'kick-genius-v2';
const CORE_ASSETS = [
  '/index.html',
  '/catalogo.html',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/logo/kick-genius-logo.jpeg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  // CSS, JS y JSON (incluido el catálogo) cambian con cada publicación: si se sirvieran desde caché, los
  // visitantes verían un diseño antiguo mezclado con el nuevo.
  const isCode = /\.(css|js|json)$/.test(url.pathname);

  if (isHTML || isCode) {
    // Network-first para páginas y código: cambian a menudo y no queremos servir versiones desactualizadas.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || (isHTML ? caches.match('/index.html') : Response.error())))
    );
    return;
  }

  // Cache-first para imágenes y estáticos (rara vez cambian una vez subidos).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
