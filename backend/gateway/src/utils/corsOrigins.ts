// Any http(s)://localhost:<port> or 127.0.0.1:<port> is allowed outright —
// covers Vite (5173), n8n (5678), the gateway itself (3000), and Expo's web
// dev server (8081 by default, but the port can change across SDK versions/
// config) without needing to hardcode every port. Native app requests
// (Expo Go, iOS/Android) send no Origin header at all — `cors`/`socket.io`
// both call this with `origin === undefined` in that case, which must be
// allowed too (mobile-app-friendly, not a bug to "fix").
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function envOrigins(): string[] {
  return (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // native mobile clients, curl, server-to-server
  if (LOCALHOST_ORIGIN_RE.test(origin)) return true;
  return envOrigins().includes(origin);
}
