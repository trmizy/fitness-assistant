import { Preferences } from "../services/storage";

/**
 * Runtime server address. Ported from web's config/serverUrl.ts, same priority chain:
 *
 *     stored runtime override  >  build-time env  >  default
 *
 * Two things genuinely differ from web and both are forced by the platform:
 *
 * 1. **No same-origin fallback.** Web defaults to the relative path "/api", which the Vite dev
 *    server proxies to the gateway (stripping the prefix — the gateway's own routes are
 *    "/auth/login", NOT "/api/auth/login"). A native app has no origin to be "same" as, so the
 *    default here must be an absolute URL pointing straight at the gateway, with no /api prefix
 *    — exactly the shape web's own Capacitor build uses (.env.capacitor's
 *    VITE_API_URL=http://192.168.2.100:3000).
 *
 * 2. **Reads are synchronous, storage is not.** Web read localStorage synchronously inside
 *    `apiBaseUrl()`, which api.ts calls at module load. AsyncStorage has no synchronous read, so
 *    the stored override is mirrored into a module-level cache that `loadServerOverride()` fills
 *    once at startup — before the first request goes out. api.ts subscribes to changes (see
 *    `onServerUrlChange`) and re-points its live axios instances, because unlike the web app a
 *    native app cannot reload itself to pick up a new address.
 */

const STORAGE_KEY = "serverUrl";

/**
 * 10.0.2.2 is the Android emulator's alias for the host machine's loopback, so a stock emulator
 * reaches a gateway running on the developer's own machine with no configuration at all. A real
 * device on the LAN needs EXPO_PUBLIC_API_URL (or the in-app override) pointed at the host's LAN
 * address instead — the same requirement the Capacitor build already has.
 */
const DEFAULT_GATEWAY_URL = "http://10.0.2.2:3000";

function env(key: string): string {
  return (process.env[key] as string | undefined)?.trim() || "";
}

function envFlag(key: string, defaultValue: boolean): boolean {
  const value = env(key).toLowerCase();
  if (!value) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value);
}

function isDevBuild(): boolean {
  return __DEV__;
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

// Synchronous mirror of the stored override — see the doc comment above.
let overrideCache = "";

type ChangeListener = (baseUrl: string) => void;
const changeListeners = new Set<ChangeListener>();

/** api.ts subscribes so a newly saved address takes effect without restarting the app. */
export function onServerUrlChange(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notifyChanged(): void {
  const next = apiBaseUrl();
  for (const listener of [...changeListeners]) {
    try {
      listener(next);
    } catch (err) {
      console.error("[serverUrl] change listener failed", err);
    }
  }
}

/**
 * Seeds the synchronous cache from storage. MUST be awaited before the first request — session
 * bootstrap does this first thing, so nothing goes out against the wrong address.
 */
export async function loadServerOverride(): Promise<void> {
  const { value } = await Preferences.get({ key: STORAGE_KEY });
  const loaded = normalize(value ?? "");
  if (loaded === overrideCache) return;

  overrideCache = loaded;
  // api.ts resolved its baseURL at module load, when this cache was still empty — it has to be
  // told, or a stored override would be ignored for the whole session despite being loaded here.
  notifyChanged();
}

/** The user-provided server URL, or "" when none is stored. */
export function getServerOverride(): string {
  return overrideCache;
}

export async function setServerOverride(url: string): Promise<void> {
  const clean = normalize(url);
  overrideCache = clean;
  if (clean) await Preferences.set({ key: STORAGE_KEY, value: clean });
  else await Preferences.remove({ key: STORAGE_KEY });
  notifyChanged();
}

export async function clearServerOverride(): Promise<void> {
  overrideCache = "";
  await Preferences.remove({ key: STORAGE_KEY });
  notifyChanged();
}

/** Base URL for REST calls (axios baseURL). */
export function apiBaseUrl(): string {
  return getServerOverride() || env("EXPO_PUBLIC_API_URL") || DEFAULT_GATEWAY_URL;
}

/**
 * Realtime defaults to on in dev builds, matching web. Kept as an env flag so a build pointed at
 * an environment without the realtime backends deployed can turn it off.
 */
export function isRealtimeEnabled(): boolean {
  return envFlag("EXPO_PUBLIC_ENABLE_REALTIME", isDevBuild());
}

export function isChatWsEnabled(): boolean {
  const explicitChatWs = env("EXPO_PUBLIC_ENABLE_CHAT_WS");
  if (explicitChatWs) return envFlag("EXPO_PUBLIC_ENABLE_CHAT_WS", isDevBuild());
  return envFlag("EXPO_PUBLIC_ENABLE_CHAT", isDevBuild());
}

/** Server URL for the gateway's own Socket.IO. */
export function gatewaySocketUrl(): string {
  return getServerOverride() || env("EXPO_PUBLIC_SOCKET_URL") || DEFAULT_GATEWAY_URL;
}

/**
 * Chat's Socket.IO lives on a separate server from the gateway's, and both default to the
 * "/socket.io" path — so whenever chat is reached *through* the gateway it uses the distinct
 * "/chat-socket.io" prefix, which the gateway rewrites back to the real path. Only a direct
 * connection to chat-service keeps "/socket.io".
 */
export function chatSocketTarget(): { url: string; path: string } {
  const override = getServerOverride();
  if (override) return { url: override, path: "/chat-socket.io" }; // one tunnel, via gateway

  const direct = env("EXPO_PUBLIC_CHAT_WS_URL");
  if (direct) return { url: direct, path: "/socket.io" }; // straight to chat-service

  const gateway = env("EXPO_PUBLIC_SOCKET_URL");
  if (gateway) return { url: gateway, path: "/chat-socket.io" }; // via gateway proxy

  return { url: DEFAULT_GATEWAY_URL, path: "/chat-socket.io" };
}
