'use strict';

const CACHE = 'pagos-shell-v4';
const SHELL = ['./', 'index.html', 'styles.css?v=1.2.3', 'startup.js?v=1.2.3',
  'config.js?v=1.2.3', 'logic.js?v=1.2.3', 'app.js?v=1.2.3',
  'manifest.webmanifest?v=1.2.3', 'icons/logo-192.png', 'icons/logo-512.png',
  'vendor/xlsx.full.min.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('pagos-shell-') && key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
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
