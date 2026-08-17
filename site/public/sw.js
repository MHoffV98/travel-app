// Self-destructing service worker. A previous caching SW could serve a stale
// index.html pointing at chunk files a redeploy had removed, which broke the app
// for returning visitors. This version unregisters itself, clears all caches, and
// reloads open clients so everyone returns to a clean, network-only load.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
// no fetch handler — requests go straight to the network
