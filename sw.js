// EduTrack Service Worker — Offline-First PWA
// Powered by Mr. Saisi Nyongesa Sammy
// v4.0 — Fixed Firebase SDK caching + proper offline-first strategy

const CACHE = 'edutrack-v4';

// ── App shell — cached verbatim on install ────────────────────────
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
];

// ── CDN assets — cached on install ───────────────────────────────
const CDN_ASSETS = [
  // FontAwesome CSS + webfonts
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-brands-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-regular-400.woff2',
  // PDF libraries
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

// ── Firebase SDK files ────────────────────────────────────────────
// NOTE: Firebase v10 uses ES module imports internally. The main files
// below import sub-chunks at runtime. We cannot predict all sub-chunk URLs
// in advance, so we use a cache-first strategy for ALL gstatic.com requests,
// caching them dynamically on first fetch. On subsequent loads (offline),
// they are served from cache.
const FIREBASE_MAIN = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js',
];

// ── Domains that use their own offline mechanism — bypass SW ──────
// Firestore manages its own IndexedDB offline queue. Intercepting these
// calls would break that mechanism.
const BYPASS_DOMAINS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaselogging.googleapis.com',
  'cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-', // already in CDN_ASSETS
];

function isBypassed(url) {
  // Never intercept Firestore API calls
  if (BYPASS_DOMAINS.slice(0, 6).some(d => url.includes(d))) return true;
  return false;
}

// ── INSTALL ───────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // 1. App shell — must succeed
    for (const url of APP_SHELL) {
      try { await cache.add(url); }
      catch(e) { console.warn('[SW] Shell cache miss:', url, e.message); }
    }

    // 2. CDN assets — best effort
    await Promise.allSettled(
      CDN_ASSETS.map(url =>
        fetch(url, { cache: 'no-cache' })
          .then(r => { if (r.ok || r.type === 'opaque') cache.put(url, r); })
          .catch(() => {})
      )
    );

    // 3. Firebase SDK — fetch with cors, cache the response + follow all redirects
    await Promise.allSettled(
      FIREBASE_MAIN.map(url =>
        fetch(url, { mode: 'cors', cache: 'no-cache' })
          .then(r => { if (r.ok) cache.put(url, r.clone()); return r; })
          .catch(() => {})
      )
    );

    self.skipWaiting();
  })());
});

// ── ACTIVATE ──────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Delete ALL old caches
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ── FETCH — cache-first for assets, bypass for Firestore ──────────
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const method = event.request.method;

  // Bypass: Firestore & Firebase API calls (they have their own offline handling)
  if (isBypassed(url)) return;

  // Only handle GET
  if (method !== 'GET') return;

  // Only handle http(s)
  if (!url.startsWith('http')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // ── Cache-first strategy ──────────────────────────────────────
    // For gstatic.com (Firebase SDK sub-chunks), fonts, etc.:
    // serve from cache if available, otherwise fetch + cache dynamically.
    const cached = await cache.match(event.request);

    if (cached) {
      // Serve from cache immediately
      // Background refresh only if online (stale-while-revalidate)
      if (navigator.onLine) {
        fetch(event.request)
          .then(r => { if (r && r.ok) cache.put(event.request, r.clone()); })
          .catch(() => {});
      }
      return cached;
    }

    // Not in cache — fetch from network and cache it
    try {
      const response = await fetch(event.request);
      if (response && (response.ok || response.type === 'opaque')) {
        // Cache everything we successfully fetch (including Firebase sub-chunks)
        cache.put(event.request, response.clone());
      }
      return response;
    } catch(networkErr) {
      // Network completely failed
      if (event.request.mode === 'navigate') {
        // Navigation: serve the app shell
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      // For other resources return 503
      return new Response(
        JSON.stringify({ error: 'offline', url }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
  })());
});

// ── MESSAGE ───────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
