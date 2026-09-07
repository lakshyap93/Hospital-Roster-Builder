const CACHE = 'hospital-roster-builder-v30';
const SHELL = [
  '/',
  '/index.html',
  '/login',
  '/login.html',
  '/create-password',
  '/create-password.html',
  '/staff',
  '/staff.html',
  '/roster',
  '/roster.html',
  '/history',
  '/history.html',
  '/about',
  '/about.html',
  '/style.css',
  '/config.js',
  '/supabase-client.js',
  '/script.js',
  '/auth.js',
  '/auth-guard.js',
  '/env-router.js',
  '/create-password.js',
  '/pwa-install.js',
  '/manifest.webmanifest',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/app-logo.svg',
  '/hospital-logo.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      await Promise.allSettled(
        SHELL.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Caching skipped for:', url, err.message || err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache Supabase / API backend requests; preserve live data
  if (url.hostname.includes('supabase.co') || url.pathname.includes('/rest/v1/') || url.pathname.includes('/auth/v1/')) {
    return;
  }

  // Handle page navigations
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          const loginCached = await caches.match('/login') || await caches.match('/login.html');
          if (loginCached) return loginCached;
          const rootCached = await caches.match('/') || await caches.match('/index.html');
          return rootCached;
        })
    );
    return;
  }

  // Static assets: cache-first or network-first for same-origin
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
