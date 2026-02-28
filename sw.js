/* ═══════════════════════════════════════════════════
   kufiMaker — Service Worker v2
   Strategy:
   · Cache-first  → app shell (HTML, letters.json, icons)
   · Stale-while-revalidate → Google Fonts
   · Network-first → everything else
   · Query params (?new=1, ?view=letters) → always serve index.html
═══════════════════════════════════════════════════ */

const CACHE = 'kufimaker-v4';
const BASE  = '/kufiMaker';

const PRECACHE = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/style.css',
  BASE + '/app.js',
  BASE + '/letters.json',
  BASE + '/manifest.json',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-512.png',
  BASE + '/icons/icon-512-maskable.png',
  BASE + '/icons/new-192.png',
  BASE + '/icons/letters-192.png',
];

/* ── Install ─────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(() => console.warn('[SW] skip:', url))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

/* ── Activate ────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ───────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  /* Share Target — POST صورة أو JSON */
  if (
    req.method === 'POST' &&
    url.pathname === BASE + '/' &&
    url.searchParams.has('share-target')
  ) {
    event.respondWith((async () => {
      try {
        const formData = await req.formData();
        const cache    = await caches.open('kufimaker-share');
        const imgFile  = formData.get('image');
        if(imgFile && imgFile.type && imgFile.type.startsWith('image/')){
          await cache.put('shared-image', new Response(imgFile));
        }
        const jsonFile = formData.get('json');
        if(jsonFile){
          const text = await jsonFile.text();
          await cache.put('shared-json', new Response(text, {headers:{'Content-Type':'application/json'}}));
        }
      } catch(e) { console.warn('[SW share]', e); }
      return Response.redirect(BASE + '/?share-target', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

  /* Shortcut URLs → strip query, serve index.html */
  if (
    url.origin === self.location.origin &&
    url.pathname === BASE + '/' &&
    url.search
  ) {
    event.respondWith(
      caches.match(BASE + '/index.html')
        .then(cached => cached || fetch(BASE + '/index.html'))
    );
    return;
  }

  /* Google Fonts → stale-while-revalidate */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  /* App shell & assets → cache-first */
  const isShell =
    url.pathname === BASE + '/' ||
    url.pathname === BASE + '/index.html' ||
    url.pathname === BASE + '/style.css' ||
    url.pathname === BASE + '/app.js' ||
    url.pathname === BASE + '/letters.json' ||
    url.pathname === BASE + '/manifest.json' ||
    url.pathname.startsWith(BASE + '/icons/');

  if (isShell) {
    event.respondWith(cacheFirst(req));
    return;
  }

  /* Everything else → network-first */
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

/* ── Helpers ─────────────────────────────────────── */
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return caches.match(BASE + '/index.html');
  }
}

async function staleWhileRevalidate(req) {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match(req);
  const fresh  = fetch(req).then(res => {
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fresh;
}

/* force update from client */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
