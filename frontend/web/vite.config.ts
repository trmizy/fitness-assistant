import { defineConfig } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

// These run inside the Vite dev-server process (Node), not the browser
// bundle, so they can read plain process.env (no VITE_ prefix needed) and
// point at Docker-internal hostnames without ever reaching client code.
// Defaults match plain `pnpm dev` outside Docker, where the gateway/chat
// services are expected on localhost. Inside docker-compose.dev.yml these
// are overridden to the service DNS names (api-gateway/chat-service).
const GATEWAY_PROXY_TARGET =
  process.env.GATEWAY_PROXY_TARGET || "http://localhost:3000";
const CHAT_PROXY_TARGET =
  process.env.CHAT_PROXY_TARGET || "http://localhost:3005";

// Extra Host headers Vite should accept beyond localhost (always allowed)
// and *.devtunnels.ms (added below for VS Code Dev Tunnels / port
// forwarding). Comma-separated so other tunnel providers (ngrok, Cloudflare
// Tunnel, ...) can be added via env instead of editing this file.
const extraAllowedHosts = (process.env.VITE_EXTRA_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ["**/*.svg", "**/*.csv"],
  server: {
    port: 5173,
    host: true,
    // VS Code Dev Tunnels / port forwarding serves this app at a hostname
    // like <tunnel-id>-5173.<region>.devtunnels.ms — the tunnel id changes
    // per session, but the ".devtunnels.ms" suffix is the stable domain
    // Microsoft always uses, so match on that instead of any one hostname.
    allowedHosts: [".devtunnels.ms", ...extraAllowedHosts],
    proxy: {
      // Same-origin API access: the browser only ever talks to this Vite
      // origin (localhost:5173 OR the tunnel's https hostname); Vite
      // forwards server-side to the gateway over plain HTTP inside the
      // Docker network. This sidesteps CORS and mixed-content entirely —
      // both real blockers when the frontend's own axios baseURL used to
      // point at an absolute http://127.0.0.1:3000 (see api.ts).
      "/api": {
        target: GATEWAY_PROXY_TARGET,
        changeOrigin: true,
        // Frontend requests are prefixed with /api (see api.ts's default
        // baseURL); the gateway's own routes are NOT (e.g. "/auth/login",
        // not "/api/auth/login") — strip it before forwarding. The one
        // pre-existing exception, POST /api/translate, is already mounted
        // on the gateway at that literal path, so after the frontend's
        // baseURL adds its own /api prefix the double "/api/api/translate"
        // has its FIRST /api stripped here, correctly leaving "/api/translate".
        rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
      },
      // Gateway's own Socket.IO (dashboard/notifications/chat-intent AI) —
      // same path both sides, no rewrite needed.
      "/socket.io": {
        target: GATEWAY_PROXY_TARGET,
        changeOrigin: true,
        ws: true,
      },
      // Chat-service's Socket.IO (call/video signaling) is a second,
      // separate socket.io server that also defaults to "/socket.io" on its
      // own side — proxied under a distinct path here so it doesn't collide
      // with the gateway's socket above, then rewritten back to the real
      // "/socket.io" path chat-service actually listens on. The frontend
      // client passes a matching `path: "/chat-socket.io"` option (see
      // services/socket.ts) only when connecting same-origin through this
      // proxy; a direct absolute VITE_CHAT_WS_URL override still uses
      // chat-service's real "/socket.io" path unchanged.
      "/chat-socket.io": {
        target: CHAT_PROXY_TARGET,
        changeOrigin: true,
        ws: true,
        rewrite: (requestPath) =>
          requestPath.replace(/^\/chat-socket\.io/, "/socket.io"),
      },
    },
  },
});
