// EduTrack Service Worker
// Bump CACHE_VERSION to force a full cache refresh on next deploy
const CACHE_VERSION = 'edutrack-v1';

const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg'
];

// ── INSTALL: pre-cache core shell ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(PRECACHE_URLS))
  );
  // Take control immediately without waiting for old SW to die
  self.skipWaiting();
});

// ── ACTIVATE: purge stale caches ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      )
    )
  );
  // Claim all open clients immediately
  self.clients.claim();
});

// ── FETCH: Network-first for Firebase/CDN, Cache-first for local ───
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network-only for:
  //   • Firebase Firestore / Auth / Storage
  //   • Google Fonts (keeps the font fresh, graceful offline fallback)
  const networkOnlyHosts = [
    'firestore.googleapis.com',
    'firebase.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseapp.com',
    'firebasestorage.googleapis.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
  ];

  if (networkOnlyHosts.some(h => url.hostname.includes(h))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // CDN assets (Font Awesome, jsPDF) – stale-while-revalidate
  const cdnHosts = ['cdnjs.cloudflare.com'];
  if (cdnHosts.some(h => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Everything else (local app shell) – cache-first with network fallback
  event.respondWith(cacheFirst(event.request));
});

// ── SKIP WAITING message (sent by the page on update detection) ────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ────────────────────────────────────────────────────────────────────
// Strategy helpers
// ────────────────────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not in cache – return a minimal offline page for navigation
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);
  return cached || fetchPromise;
}
