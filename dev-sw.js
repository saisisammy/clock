// EduTrack Developer Panel — Service Worker
// Powered by Mr. Saisi Nyongesa Sammy
const CACHE = 'edutrack-dev-v1';
const ASSETS = [
  './developer.html',
  './dev-manifest.json',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
];
const FIREBASE = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await Promise.allSettled(ASSETS.map(u => c.add(u).catch(() => {})));
      await Promise.allSettled(FIREBASE.map(u =>
        fetch(u).then(r => r.ok ? c.put(u, r) : null).catch(() => {})
      ));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Never intercept Firestore — it manages its own offline layer
  if (url.includes('firestore.googleapis.com') || url.includes('firebase.googleapis.com')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res && res.status === 200)
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => {});
      return cached || network;
    })
  );
});
