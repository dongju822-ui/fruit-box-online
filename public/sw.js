const CACHE_NAME = "fruit-box-pwa-v6";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/css/style.css",
  "/js/audio.js",
  "/js/game.js",
  "/js/lobby.js",
  "/assets/bgm/3.mp3",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png"
];

function isCacheableResponse(response) {
  return response && response.ok && response.type !== "opaque";
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request, { cache: "no-store" });
    if (isCacheableResponse(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return cache.match("/index.html");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "skipWaiting") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.url.includes("/socket.io/")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const accept = request.headers.get("accept") || "";
  const isUiAsset =
    request.mode === "navigate"
    || accept.includes("text/html")
    || url.pathname.endsWith(".html")
    || url.pathname.endsWith(".css")
    || url.pathname.endsWith(".js")
    || url.pathname.endsWith(".webmanifest");

  if (isUiAsset) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
