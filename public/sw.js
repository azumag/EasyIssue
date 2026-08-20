const CACHE_NAME = "easyissue-shell-v1";
const APP_SHELL = [
  "/", "/index.html", "/styles.css", "/app.js", "/shared.js",
  "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") event.respondWith(networkFirstNavigation(request));
  else event.respondWith(cacheFirst(request, event));
});

async function networkFirstNavigation(request) {
  try { return await fetch(request); }
  catch { return (await caches.match("/index.html")) ?? new Response("Offline", { status: 503 }); }
}

async function cacheFirst(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const update = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return (await update) ?? new Response("Offline", { status: 503 });
}
