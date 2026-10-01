// Mathly service worker: keeps the app shell and previously opened lessons/courses available offline.
const SHELL = 'mathly-shell-v1';
const DATA = 'mathly-data-v1';
const CACHEABLE_API = [/^\/api\/me\/lessons\//, /^\/api\/me\/courses/, /^\/api\/me\/skills$/, /^\/api\/me\/progress$/, /^\/api\/me\/resources/];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/favicon.svg', '/theme-init.js']))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k))))); self.clients.claim(); });

self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (!CACHEABLE_API.some((r) => r.test(url.pathname))) return;
    // Network first; fall back to the last copy for this profile when offline.
    const key = `${url.pathname}${url.search}|${req.headers.get('x-profile-id') || ''}`;
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(new Request(`/__cache/${encodeURIComponent(key)}`), copy)); } return res; })
      .catch(() => caches.open(DATA).then((c) => c.match(`/__cache/${encodeURIComponent(key)}`)).then((m) => m || new Response(JSON.stringify({ error: 'You’re offline. Your saved lessons remain available.', code: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } }))));
    return;
  }
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(() => caches.match('/'))); return; }
  if (url.pathname.startsWith('/assets/')) e.respondWith(caches.open(SHELL).then((c) => c.match(req).then((m) => m || fetch(req).then((res) => { c.put(req, res.clone()); return res; }))));
});
