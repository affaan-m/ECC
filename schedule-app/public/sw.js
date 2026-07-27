/* Simple offline-first service worker for the Keystone PWA.
 * Caches the app shell so the app keeps working with no network.
 * All user data lives in localStorage, so there is nothing else to sync.
 *
 * Guiding rule in here: never let a handler resolve to `undefined` or reject.
 * The app is installed with `display: standalone`, so a failed navigation has
 * no browser chrome to render an error into and no address bar to retry from
 * — it just shows the manifest's black background_color forever. Every path
 * below therefore ends at *something* renderable.
 */
const CACHE = 'keystone-shell-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

// Shown only if a navigation fails and nothing at all is cached — i.e. the
// very first launch happened offline. Without it the app would be a black
// rectangle with no explanation and no way to retry.
const FALLBACK_HTML = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Keystone</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#111113;color:#f2efe7;font:16px/1.5 system-ui,-apple-system,sans-serif;text-align:center;padding:24px">
<div><p style="font-size:19px;font-weight:600;margin:0 0 8px">Keystone can't load right now</p>
<p style="color:#93a0ad;margin:0 0 20px">No connection, and nothing saved offline yet.</p>
<button onclick="location.reload()" style="font:inherit;font-weight:600;padding:12px 22px;border:0;border-radius:12px;background:#a9822a;color:#fff">Try again</button></div>`;

const fallbackResponse = () =>
  new Response(FALLBACK_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

self.addEventListener('install', (event) => {
  // Individually, not addAll: addAll is all-or-nothing, so one missing shell
  // file would fail the whole install and leave the app with no offline copy.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Lets the page tell a wedged service worker to step aside (see the boot
// fallback in index.html) without the user having to delete the app.
self.addEventListener('message', (event) => {
  if (event.data === 'keystone:reset') {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Network-first for navigations so fresh deploys are picked up; fall back to
  // the cached shell when offline, and to an explanatory page when even that
  // is missing.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() =>
          caches
            .match('./index.html')
            .then((cached) => cached || caches.match('./'))
            .then((cached) => cached || fallbackResponse())
        )
    );
    return;
  }

  // Cache-first for static assets (hashed by Vite, so safe to cache long-term).
  // A rejected fetch here used to surface as a bare network error, which for
  // the entry bundle means a blank document and no clue why.
  event.respondWith(
    caches
      .match(request)
      .then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res && res.status === 200 && res.type === 'basic') {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          })
      )
      .catch(() => Response.error())
  );
});
