export interface PwaWindowLike {
  location?: {
    protocol?: string;
    hostname?: string;
    reload?: () => void;
  };
}

export interface PwaNavigatorLike {
  serviceWorker?: unknown;
}

export function isSecurePwaContext(win: PwaWindowLike | undefined | null) {
  const protocol = win?.location?.protocol;
  const hostname = win?.location?.hostname;
  return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
}

export function shouldRegisterPwa(
  nav: PwaNavigatorLike | undefined | null,
  win: PwaWindowLike | undefined | null,
  isDev: boolean,
) {
  return Boolean(!isDev && nav?.serviceWorker && isSecurePwaContext(win));
}

export function isAppNavigationRequest(request: Request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return request.method === "GET" && accept.includes("text/html");
}

export function shouldBypassServiceWorkerCache(request: Request) {
  if (request.method !== "GET") return true;

  const url = new URL(request.url);
  const pathname = url.pathname;

  return (
    pathname.startsWith("/api") ||
    pathname.startsWith("/socket.io") ||
    pathname.startsWith("/chat-socket.io")
  );
}

