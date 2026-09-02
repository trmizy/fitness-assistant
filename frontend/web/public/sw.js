// Vòng 4 / Phase D1 — bumped: bg-gym.jpg (6MB) -> bg-gym.webp (136KB) in PRECACHE_URLS below.
// A new version forces old installed service workers to drop their stale cache (still
// pointing at the removed .jpg) and precache-fetch the new URL list on next activate.
const APP_VERSION = "pwa-20260902-1";
const STATIC_CACHE = `fitness-ai-static-${APP_VERSION}`;
const RUNTIME_CACHE = `fitness-ai-runtime-${APP_VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/pwa-icon.svg",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/bg-gym.webp",
];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isAppNavigationRequest(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return request.method === "GET" && accept.includes("text/html");
}

function shouldBypassCache(request) {
  if (request.method !== "GET") return true;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return true;

  return (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/socket.io") ||
    url.pathname.startsWith("/chat-socket.io")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" }))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("fitness-ai-") && ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    const cachedIndex = await cache.match("/") || await caches.match("/");
    if (cachedIndex) return cachedIndex;

    return caches.match(OFFLINE_URL);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (shouldBypassCache(request)) return;

  if (isAppNavigationRequest(request)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
