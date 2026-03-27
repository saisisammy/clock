// EduTrack Service Worker — Firebase + Offline Support
// Powered by Mr. Saisi Nyongesa Sammy

const CACHE_NAME = 'edutrack-v2.0';
const ASSETS = [
  './', './index.html', './manifest.json',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

const FIREBASE_SDKS = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.allSettled(ASSETS.map(url => cache.add(url).catch(() => {})));
      await Promise.allSettled(FIREBASE_SDKS.map(url =>
        fetch(url).then(r => r.ok ? cache.put(url, r) : null).catch(() => {})
      ));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  // Never intercept Firestore — it has its own IndexedDB offline layer
  if (url.includes('firestore.googleapis.com') || url.includes('firebase.googleapis.com') ||
      url.includes('identitytoolkit') || url.includes('securetoken')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Stale-while-revalidate
        fetch(event.request).then(r => {
          if (r && r.status === 200) caches.open(CACHE_NAME).then(c => c.put(event.request, r.clone()));
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
