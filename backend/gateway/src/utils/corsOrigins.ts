// Any http(s)://localhost:<port> or 127.0.0.1:<port> is allowed outright —
// covers Vite (5173), n8n (5678), the gateway itself (3000), and Expo's web
// dev server (8081 by default, but the port can change across SDK versions/
// config) without needing to hardcode every port. Native app requests
// (Expo Go, iOS/Android) send no Origin header at all — `cors`/`socket.io`
// both call this with `origin === undefined` in that case, which must be
// allowed too (mobile-app-friendly, not a bug to "fix").
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// A phone/tablet on the same WiFi, or a desktop browser opened via the LAN IP instead of
// "localhost", reaches this stack at http://<private-ip>:5173 — and that IP is a DHCP
// lease that changes on its own schedule, not on the developer's. Hardcoding one snapshot
// of it into CORS_ORIGIN (what this used to require) breaks the moment the lease renews,
// exactly the same recurring failure already fixed for VNPAY_RETURN_URL/FRONTEND_URL
// (see payment-service's return-URL fix) — confirmed reproducing here too: a real login
// from http://192.168.1.2:5173 got a 500 "Not allowed by CORS" from this gateway while
// CORS_ORIGIN still held yesterday's LAN IP, with no code change needed to fix it except
// this. Matching on the RFC1918 private ranges (same trust boundary as localhost: only
// something already inside this network could ever present one of these as its real page
// origin) removes the need to keep that value in sync by hand at all.
const PRIVATE_LAN_ORIGIN_RE =
  /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

// VS Code Dev Tunnels / port forwarding serves the frontend at
// https://<tunnel-id>-<port>.<region>.devtunnels.ms — the tunnel id and
// region change per session/user, so match the stable Microsoft-owned
// domain suffix rather than any one hostname.
//
// NOTE this middleware still runs (and can still reject) even when the frontend proxies
// same-origin through Vite (frontend/web/vite.config.ts): the browser itself doesn't
// enforce CORS for that case (it never sees a cross-origin request), but the browser
// still SENDS its real Origin header on the request, Vite's proxy forwards it unchanged
// (`changeOrigin` there only rewrites the outgoing Host header, not Origin), and THIS
// gateway validates whatever Origin arrives regardless of how the request reached it.
// Confirmed directly: a same-origin, Vite-proxied login from http://192.168.1.2:5173
// still got a 500 "Not allowed by CORS" from here, because the Origin header on that
// proxied request was still "http://192.168.1.2:5173" and nothing above matched it yet
// (before PRIVATE_LAN_ORIGIN_RE existed). So every one of these patterns is live for the
// primary dev setup too, not just for someone bypassing the proxy with an absolute
// VITE_API_URL — that case just makes it additionally visible as a real browser-side
// CORS block on top of this gateway's own rejection.
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
  if (PRIVATE_LAN_ORIGIN_RE.test(origin)) return true;
  if (DEV_TUNNEL_ORIGIN_RE.test(origin)) return true;
  return envOrigins().includes(origin);
}
