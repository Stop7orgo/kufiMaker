/* ═══════════════════════════════════════════════════
   kufiMaker — Service Worker
   Strategy:
   - Cache-first for app shell (index.html, letters.json, fonts)
   - Network-first for everything else
   ═══════════════════════════════════════════════════ */

const CACHE_NAME = 'kufimaker-v1';
const BASE = '/kufiMaker';

// Files to cache on install (app shell)
const PRECACHE = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/letters.json',
  // Google Fonts (cached on first load)
  'https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;900&display=swap'
];

// ── Install: pre-cache app shell ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache same-origin files strictly, fonts with no-cors
      return Promise.allSettled(
        PRECACHE.map(url => {
          const req = url.startsWith('http')
            ? new Request(url, { mode: 'no-cors' })
            : new Request(url);
          return cache.add(req).catch(() => {
            // Non-critical: don't fail install if one resource misses
            console.warn('[SW] Failed to cache:', url);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ───────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for shell, network-first otherwise ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and non-http requests
  if (!url.protocol.startsWith('http')) return;

  // ── App shell & letters.json → Cache-first ──
  const isShell =
    url.pathname === BASE + '/' ||
    url.pathname === BASE + '/index.html' ||
    url.pathname === BASE + '/letters.json';

  if (isShell) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => {
          // Offline fallback: return cached index.html
          return caches.match(BASE + '/index.html');
        });
      })
    );
    return;
  }

  // ── Google Fonts → Cache-first (stale-while-revalidate) ──
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // ── Everything else → Network-first ──
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
