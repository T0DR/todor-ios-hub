// Offline-Cache nur für die App-Dateien. Persönliche Daten werden nie hier gespeichert.
const CACHE = 'hub-v1';
const FILES = ['./', 'index.html', 'styles.css', 'boot.js', 'markdown.js', 'script.js', 'manifest.webmanifest', 'assets/icon.svg', 'assets/apple-touch-icon.png', 'assets/icon-192.png', 'assets/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Query (z. B. ?result=… vom Kurzbefehl) nie cachen – immer die Seite selbst ausliefern
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      const net = fetch(e.request.url.split('?')[0]).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(new Request(url.origin + url.pathname), res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
