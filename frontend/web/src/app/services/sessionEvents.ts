/**
 * A one-signal event channel: "the session is over, send the user to login".
 *
 * Why it exists: `services/api.ts` lives outside the React tree, so it cannot call
 * `useNavigate`. It used to reach for `window.location.href = "/login"`, which is a FULL
 * PAGE LOAD — the WebView tears down React, re-parses the bundle, re-bootstraps the
 * session and refetches everything, just to show the login screen. On Android that reads
 * as the app freezing and restarting itself.
 *
 * Instead api.ts emits here, and AppContext (inside the tree, with a router) does the
 * actual navigation with React Router. No full reload, no lost in-memory state.
 *
 * Deliberately not a library: one event, no payload, no ordering guarantees needed.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe; returns an unsubscribe function. */
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Announce that the session is gone. Safe to call repeatedly — subscribers are expected to
 * be idempotent (navigating to /login twice is harmless).
 *
 * If nobody is listening (e.g. a hard failure before React mounted), fall back to a plain
 * location change so the user is never stranded on a dead screen.
 */
export function emitSessionExpired(): void {
  if (listeners.size === 0) {
    if (
      typeof window !== "undefined" &&
      window.location.pathname !== "/login" &&
      window.location.pathname !== "/register"
    ) {
      window.location.href = "/login";
    }
    return;
  }
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[sessionEvents] listener failed", err);
    }
  }
}

/**
 * Why the session ended, when the user needs to be told. Today only one case: a newer login on the
 * same kind of device (web / mobile) signed this one out — the server answers the refresh with code
 * `SESSION_REPLACED`. api.ts records it here BEFORE it emits, and AppContext takes it once and shows
 * it. Module-level on purpose: api.ts sits outside the React tree.
 */
export const SESSION_REPLACED_CODE = "SESSION_REPLACED";
export const SESSION_REPLACED_NOTICE =
  "Tài khoản đã đăng nhập trên thiết bị khác. Bạn đã được đăng xuất khỏi thiết bị này.";

let pendingSessionNotice: string | null = null;

export function setSessionNotice(message: string): void {
  pendingSessionNotice = message;
}

/** Returns the pending notice once, then forgets it. */
export function takeSessionNotice(): string | null {
  const message = pendingSessionNotice;
  pendingSessionNotice = null;
  return message;
}
