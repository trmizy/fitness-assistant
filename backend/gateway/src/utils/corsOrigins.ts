// Any http(s)://localhost:<port> or 127.0.0.1:<port> is allowed outright —
// covers Vite (5173), n8n (5678), the gateway itself (3000), and Expo's web
// dev server (8081 by default, but the port can change across SDK versions/
// config) without needing to hardcode every port. Native app requests
// (Expo Go, iOS/Android) send no Origin header at all — `cors`/`socket.io`
// both call this with `origin === undefined` in that case, which must be
// allowed too (mobile-app-friendly, not a bug to "fix").
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// VS Code Dev Tunnels / port forwarding serves the frontend at
// https://<tunnel-id>-<port>.<region>.devtunnels.ms — the tunnel id and
// region change per session/user, so match the stable Microsoft-owned
// domain suffix rather than any one hostname. In the primary dev setup this
// doesn't even get exercised (the frontend proxies same-origin through
// Vite — see frontend/web/vite.config.ts — so the browser never makes a
// cross-origin request at all), but it's kept here as defense-in-depth for
// anyone bypassing that proxy with an absolute VITE_API_URL.
// Real hostnames have 2+ dot-separated labels before the domain itself,
// e.g. "abc123-5173.asse.devtunnels.ms" (tunnel id + region) — allow any
// number of labels, not just one.
const DEV_TUNNEL_ORIGIN_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.devtunnels\.ms$/i;

function envOrigins(): string[] {
  return (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // native mobile clients, curl, server-to-server
  if (LOCALHOST_ORIGIN_RE.test(origin)) return true;
  if (DEV_TUNNEL_ORIGIN_RE.test(origin)) return true;
  return envOrigins().includes(origin);
}
