// Service worker DartCam.
// - Pages et code de l'app : réseau d'abord (toujours à jour en ligne), cache en secours (hors ligne).
// - OpenCV.js et icônes : cache d'abord (gros fichier, ne change pas).
// CACHE et CORE sont réécrits au build (vite.config.ts) avec la version et la liste des fichiers.
const CACHE = 'dartcam-dev';
const CORE = ['./', './index.html'];
// OpenCV.js et les icônes vivent dans un cache séparé qui survit aux mises à jour de l'app
// (OpenCV pèse ~10 Mo : on ne le retélécharge pas à chaque nouvelle version).
const STATIC = 'dartcam-static-v1';
const isStatic = (path) => path.includes('/vendor/') || path.includes('/icons/');

self.addEventListener('install', (event) => {
  const base = new URL('./', self.location).pathname;
  const app = CORE.filter((u) => !isStatic(base + u.slice(2)));
  const statics = CORE.filter((u) => isStatic(base + u.slice(2)));
  event.waitUntil(
    Promise.all([
      caches.open(CACHE).then((c) => c.addAll(app)),
      caches.open(STATIC).then(async (c) => {
        for (const u of statics) if (!(await c.match(u))) await c.add(u);
      }),
    ]).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isStatic(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req)
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
          .then((hit) => hit || new Response('Hors ligne', { status: 503 })),
      ),
  );
});
