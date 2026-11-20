/**
 * A one-signal event channel: "the session is over, send the user to login".
 *
 * Why it exists: `services/api.ts` lives outside the React tree, so it cannot use a navigation
 * hook. It emits here instead, and AppContext (inside the tree, with the router available) does
 * the actual navigation.
 *
 * Ported from web's services/sessionEvents.ts. The one difference: web's no-listener fallback
 * assigned `window.location.href`, which does not exist here and has no RN equivalent worth
 * reaching for — a listener is always registered before anything can emit (AppContext subscribes
 * synchronously at mount, and the only pre-mount caller, session bootstrap, opts out of the
 * redirect entirely via `_skipAuthRedirect`). So a missing listener means a real wiring bug, and
 * saying so is more useful than papering over it with a navigation that would fire before the
 * router exists.
 *
 * Deliberately not a library: one event, no payload, no ordering guarantees needed.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe; returns an unsubscribe function. */
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Announce that the session is gone. Safe to call repeatedly — subscribers are expected to
 * be idempotent (navigating to the login screen twice is harmless).
 */
export function emitSessionExpired(): void {
  if (listeners.size === 0) {
    console.warn(
      "[sessionEvents] session expired with no listener attached — the user will not be sent to login",
    );
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
 * `SESSION_REPLACED`. api.ts records it here BEFORE it emits, and whoever shows the login screen
 * (AppContext) takes it once. Module-level on purpose: api.ts sits outside the React tree.
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
