'use strict';

const CACHE = 'pagos-shell-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'logic.js', 'app.js',
  'manifest.webmanifest', 'icons/logo-192.png', 'icons/logo-512.png',
  'vendor/xlsx.full.min.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('pagos-shell-') && key !== CACHE).map((key) => caches.delete(key))
  )));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }
  if (!SHELL.some((path) => new URL(path, self.registration.scope).href === url.href)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
