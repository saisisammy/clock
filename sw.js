// EduTrack Service Worker — Full Offline PWA
// Powered by Mr. Saisi Nyongesa Sammy
// Version 3.0 — Proper offline-first caching

const CACHE = 'edutrack-v3';

// ── App shell — cached on install ────────────────────────────────
// These are the files needed to run the app without network.
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
];

// ── External assets — cached on install (best-effort) ────────────
const EXTERNAL = [
  // Fonts
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap',
  'https://fonts.gstatic.com/s/plusjakartasans/v8/LDIoaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_KU7NSg.woff2',
  // FontAwesome
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-brands-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-regular-400.woff2',
  // jsPDF
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

// ── Firebase SDK files — cached via fetch+put (not cache.add) ────
// These are ES modules; we cache them so the app loads offline.
const FIREBASE_SDKS = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js',
];

// ── Domains that Firestore uses — NEVER intercept these ───────────
// Firestore handles its own offline queue via IndexedDB internally.
const FIRESTORE_DOMAINS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaselogging.googleapis.com',
  'play.googleapis.com',
];

function isFirestore(url) {
  return FIRESTORE_DOMAINS.some(d => url.includes(d));
}

// ── INSTALL — cache everything needed for offline use ─────────────
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // 1. Cache app shell (critical — fail hard if these fail)
    try {
      await cache.addAll(APP_SHELL);
    } catch(e) {
      console.warn('[SW] App shell cache failed:', e.message);
      // Try one by one to cache what we can
      for (const url of APP_SHELL) {
        await cache.add(url).catch(() => {});
      }
    }

    // 2. Cache external assets (best-effort — don't block install)
    await Promise.allSettled(
      EXTERNAL.map(url =>
        fetch(url, { cache: 'no-cache' })
          .then(r => { if (r.ok || r.type === 'opaque') cache.put(url, r); })
          .catch(() => {})
      )
    );

    // 3. Cache Firebase SDK modules (fetch with cors mode)
    await Promise.allSettled(
      FIREBASE_SDKS.map(url =>
        fetch(url, { mode: 'cors', cache: 'no-cache' })
          .then(r => { if (r.ok) cache.put(url, r); })
          .catch(() => {})
      )
    );

    await self.skipWaiting();
  })());
});

// ── ACTIVATE — delete old caches ──────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ── FETCH — serve from cache, update in background ───────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const method = event.request.method;

  // Never intercept Firestore network calls — it manages its own offline layer
  if (isFirestore(url)) return;

  // Only handle GET requests
  if (method !== 'GET') return;

  // Skip non-http(s) requests
  if (!url.startsWith('http')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // 1. Check cache first
    const cached = await cache.match(event.request);

    if (cached) {
      // Cache hit — return immediately, refresh in background (stale-while-revalidate)
      if (navigator.onLine) {
        event.waitUntil(
          fetch(event.request)
            .then(r => { if (r && r.ok) cache.put(event.request, r.clone()); })
            .catch(() => {})
        );
      }
      return cached;
    }

    // 2. Not in cache — fetch from network
    try {
      const response = await fetch(event.request);
      if (response && response.ok) {
        // Cache successful responses for future offline use
        cache.put(event.request, response.clone());
      }
      return response;
    } catch(e) {
      // Network failed — try navigation fallback
      if (event.request.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      // For other resources, return a basic offline response
      return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
  })());
});

// ── MESSAGE — handle updates from the app ─────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CACHE_URLS') {
    // App can request specific URLs to be cached
    const urls = event.data.urls || [];
    caches.open(CACHE).then(cache =>
      Promise.allSettled(urls.map(url => cache.add(url).catch(() => {})))
    );
  }
});
