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
