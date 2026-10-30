// Service Worker for Terania GeoPDF Field Navigator PWA
const CACHE_NAME = 'terania-geopdf-v2.3';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/geopdf-parser.js',
  './js/geo-transform.js',
  './js/geopdf-overlay.js',
  './js/gps-tracker.js',
  './js/pdf-renderer.js',
  './js/field-tools.js',
  './js/app.js',
  './assets/vendor/leaflet.js',
  './assets/vendor/leaflet.css',
  './assets/vendor/pdf.min.js',
  './assets/vendor/pdf.worker.min.js',
  './assets/vendor/proj4.js',
  './assets/vendor/pako.min.js',
  './assets/vendor/images/marker-icon.png',
  './assets/vendor/images/marker-icon-2x.png',
  './assets/vendor/images/marker-shadow.png',
  './assets/vendor/images/layers.png',
  './assets/vendor/images/layers-2x.png',
  './assets/Terania_Horizonal_Green.png',
  './assets/Terania_Horizonal_Reversed.png',
  './assets/Terania_Icon_Green.png',
  './assets/Terania_Icon_Reversed.png',
  './assets/Terania_Stacked_Green.png',
  './assets/Terania_Stacked_Reversed.png',
  './sample/testdcdb_MGA56.pdf'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching app shell and offline assets');
        // Bypass the HTTP cache so a version bump always precaches the
        // current files rather than a stale copy the browser already had.
        const requests = ASSETS_TO_CACHE.map(url => new Request(url, { cache: 'reload' }));
        return cache.addAll(requests);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Deleting outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - cache-first with network fallback for local assets, network-first for external map tiles
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // For external tile servers (OSM, Esri), attempt fetch, cache successful tile responses dynamically
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For site plans in sites/, use network-first so clients always receive newly uploaded plans,
  // while seamlessly falling back to cached offline plans when out in remote field areas.
  if (url.pathname.includes('/sites/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Local assets: Cache first, then network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      if (event.request.headers.get('accept')?.includes('text/html')) {
        return caches.match('./index.html');
      }
    })
  );
});
