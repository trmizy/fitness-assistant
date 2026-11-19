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

/**
 * The same reason is also kept in sessionStorage (tab-scoped, short-lived) so the login screen can still show it after a FULL page
 * load — a reload of an already-kicked session starts with an empty module and a toast fired before the toaster mounts is lost.
 * It is cleared as soon as the login screen has shown it.
 */
export const SESSION_NOTICE_STORAGE_KEY = "gymini.sessionEndedNotice";
const SESSION_NOTICE_MAX_AGE_MS = 10 * 60_000;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function setSessionNotice(message: string): void {
  pendingSessionNotice = message;
  try {
    storage()?.setItem(SESSION_NOTICE_STORAGE_KEY, JSON.stringify({ message, at: Date.now() }));
  } catch {
    /* storage blocked: the in-memory notice still works for this page load */
  }
}

/** Login screen: the reason a session ended (survives a reload) without removing it — pair with `consumePersistedSessionNotice`. */
export function peekPersistedSessionNotice(now = Date.now()): string | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_NOTICE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { message?: unknown; at?: unknown };
    if (typeof parsed.message !== "string" || !parsed.message) return null;
    if (typeof parsed.at === "number" && now - parsed.at > SESSION_NOTICE_MAX_AGE_MS) return null;
    return parsed.message;
  } catch {
    return null;
  }
}

/** Returns the pending notice once, then forgets it. */
export function takeSessionNotice(): string | null {
  const message = pendingSessionNotice;
  pendingSessionNotice = null;
  return message;
}

/** Removes the stored reason (call after the login screen has shown it) and returns it. */
export function consumePersistedSessionNotice(now = Date.now()): string | null {
  const message = peekPersistedSessionNotice(now);
  try {
    storage()?.removeItem(SESSION_NOTICE_STORAGE_KEY);
  } catch {
    /* nothing to clean */
  }
  return message;
}
