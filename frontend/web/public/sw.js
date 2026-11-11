// Vòng 4 / Phase D1 — bumped: bg-gym.jpg (6MB) -> bg-gym.webp (136KB) in PRECACHE_URLS below.
// A new version forces old installed service workers to drop their stale cache (still
// pointing at the removed .jpg) and precache-fetch the new URL list on next activate.
// 2026-11-09 — bumped to purge runtime caches that may hold index.html stored under a .js URL
// (see isCacheableAssetResponse below).
const APP_VERSION = "pwa-20261109-1";
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

// CloudFront answers a missing file with the SPA's index.html and status 200 (its 403/404 ->
// /index.html rule). After a deploy removes an old hashed chunk, that HTML would otherwise be
// cached under the .js URL and served forever, so a reload could never recover. Only a
// response whose type fits the request is cached.
function isCacheableAssetResponse(request, response) {
  if (!response.ok) return false;
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (type.includes("text/html")) return false;
  if (request.destination === "script" && !type.includes("javascript")) return false;
  if (request.destination === "style" && !type.includes("css")) return false;
  return true;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (isCacheableAssetResponse(request, response)) {
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
