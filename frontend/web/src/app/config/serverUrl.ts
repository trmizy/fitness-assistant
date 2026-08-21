// Runtime server address, for builds that can't hardcode one at build time.
//
// The Capacitor APK reaches the backend through a tunnel (Cloudflare quick tunnel,
// VS Code dev tunnel, …) whose public URL changes every time it restarts. Baking that
// URL into the bundle would mean rebuilding + reinstalling the APK after every tunnel
// restart, so instead the user can paste the current URL into the in-app "Cấu hình máy
// chủ" screen; it is stored here and wins over the build-time VITE_* values.
//
// Web dev is unaffected: with no override stored, every getter falls back to exactly
// what it returned before (same-origin paths proxied by the Vite dev server).
const STORAGE_KEY = "serverUrl";

function env(key: string): string {
  // @ts-ignore - ImportMeta.env is provided by Vite
  return (import.meta.env?.[key] as string | undefined)?.trim() || "";
}

/** Strips a trailing slash so callers can concatenate paths safely, and ensures a protocol exists. */
function normalize(url: string): string {
  let clean = url.trim().replace(/\/+$/, "");
  if (clean && !clean.startsWith("http://") && !clean.startsWith("https://")) {
    // Local IPs/hostnames default to http, everything else (tunnels, prod) to https
    if (/^(localhost|127\.0\.0\.1|10\.0\.2\.2|\d+\.\d+\.\d+\.\d+)/.test(clean)) {
      clean = "http://" + clean;
    } else {
      clean = "https://" + clean;
    }
  }
  return clean;
}

/** The user-provided server URL, or "" when none is stored. */
export function getServerOverride(): string {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return ""; // private mode / storage disabled
  }
}

export function setServerOverride(url: string): void {
  const clean = normalize(url);
  if (clean) localStorage.setItem(STORAGE_KEY, clean);
  else localStorage.removeItem(STORAGE_KEY);
}

export function clearServerOverride(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Base URL for REST calls (axios baseURL). */
export function apiBaseUrl(): string {
  return getServerOverride() || env("VITE_API_URL") || "/api";
}

/** Server URL for the gateway's own Socket.IO ("" = same origin). */
export function gatewaySocketUrl(): string {
  return getServerOverride() || env("VITE_SOCKET_URL") || "";
}

/**
 * Chat's Socket.IO lives on a separate server from the gateway's, and both default to
 * the "/socket.io" path — so whenever chat is reached *through* the gateway (or the
 * Vite dev proxy) it uses the distinct "/chat-socket.io" prefix, which that proxy
 * rewrites back to the real path. Only a direct connection to chat-service keeps
 * "/socket.io".
 */
export function chatSocketTarget(): { url: string; path: string } {
  const override = getServerOverride();
  if (override) return { url: override, path: "/chat-socket.io" }; // one tunnel, via gateway

  const direct = env("VITE_CHAT_WS_URL");
  if (direct) return { url: direct, path: "/socket.io" }; // straight to chat-service

  const gateway = env("VITE_SOCKET_URL");
  if (gateway) return { url: gateway, path: "/chat-socket.io" }; // via gateway proxy

  return { url: "", path: "/chat-socket.io" }; // web dev: same origin, Vite proxy
}
