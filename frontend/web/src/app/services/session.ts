/**
 * Session restore — the single place that decides, at startup and on resume,
 * whether the user still has a usable session.
 *
 * Why this exists: the app used to decide by reading `accessToken` alone. That
 * is not enough on mobile. An access token is short-lived, so after the app had
 * been closed (or backgrounded) for a while it was always stale on the next
 * launch — yet the app rendered as logged-in, fired its first request, got a
 * 401, and only then reacted. Whichever code path noticed first would send the
 * user to the login screen. To the user that reads as "the app logged me out
 * every time", even though `refreshToken` was sitting in storage the whole time,
 * still valid, never consulted.
 *
 * The rule now: `refreshToken` decides whether a session exists at all;
 * `accessToken` only decides whether we need to refresh before the first call.
 */
import { Preferences } from "@capacitor/preferences";
import type { User } from "../types";
import { api, refreshOnce, clearStoredSession, RefreshUnavailableError } from "./api";
import { hasUsableToken, isAccessTokenExpiringSoon } from "./token";

export type BootstrapResult =
  | { status: "authenticated"; user: User | null }
  | { status: "unauthenticated" };

/** Reads the cached user object written at login. Only ever a fallback for display —
 *  the server's answer wins whenever we can reach it. */
async function readCachedUser(): Promise<User | null> {
  try {
    const { value } = await Preferences.get({ key: "user" });
    return value ? (JSON.parse(value) as User) : null;
  } catch {
    return null;
  }
}

/**
 * Confirms the session against the server and returns the authoritative user.
 *
 * Uses POST /auth/verify rather than /profile/me on purpose: /profile/me returns a
 * UserProfile, which carries `isPT` but NOT `role` — restoring from it would silently
 * demote every ADMIN and GYM_OWNER to a plain client on the next app launch, because
 * AppContext derives the whole role from `user.role`. /auth/verify returns the real
 * account record (id, email, firstName, lastName, role, isActive).
 *
 * `_skipAuthRedirect` lets the shared interceptor still do its one refresh attempt on a
 * 401, but stops it from hard-redirecting to /login on failure — this function reports
 * the failure to its caller instead, so startup can render the login screen without
 * reloading the app.
 */
async function verifySessionWithServer(): Promise<User | null> {
  const { data } = await api.post(
    "/auth/verify",
    {},
    { _skipAuthRedirect: true } as never,
  );
  return (data?.user as User) ?? null;
}

/**
 * Restores the session before the router renders anything.
 *
 *   no refreshToken                        -> unauthenticated
 *   accessToken fresh                      -> verify -> authenticated
 *   accessToken missing/expiring/unreadable-> refresh -> verify -> authenticated
 *   refresh fails, or verify still fails   -> clear session -> unauthenticated
 *
 * A network error is deliberately NOT treated as "logged out": if the server can't be
 * reached we keep the stored session and let the user in with the cached user object,
 * rather than destroying a perfectly valid session because the train went into a tunnel.
 */
export async function bootstrapSession(): Promise<BootstrapResult> {
  try {
    const [{ value: accessToken }, { value: refreshToken }] = await Promise.all([
      Preferences.get({ key: "accessToken" }),
      Preferences.get({ key: "refreshToken" }),
    ]);

    // The refresh token is what actually defines "there is a session here".
    if (!hasUsableToken(refreshToken)) {
      await clearStoredSession();
      return { status: "unauthenticated" };
    }

    if (isAccessTokenExpiringSoon(accessToken)) {
      try {
        const refreshed = await refreshOnce();
        if (!hasUsableToken(refreshed)) {
          // The server rejected the refresh token — session genuinely over.
          await clearStoredSession();
          return { status: "unauthenticated" };
        }
      } catch (err) {
        if (err instanceof RefreshUnavailableError) {
          // Couldn't reach the server. Keep the session and let the user in offline on the
          // cached user — the first successful request later will sort it out.
          return { status: "authenticated", user: await readCachedUser() };
        }
        throw err;
      }
    }

    try {
      const user = await verifySessionWithServer();
      if (user) {
        // Keep the cache in step with the server (role changes, renames, etc.).
        await Preferences.set({ key: "user", value: JSON.stringify(user) });
        return { status: "authenticated", user };
      }
      await clearStoredSession();
      return { status: "unauthenticated" };
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;

      // 401/403 after a refresh attempt means the session is genuinely dead.
      if (status === 401 || status === 403) {
        await clearStoredSession();
        return { status: "unauthenticated" };
      }

      // Anything else (offline, 5xx, timeout) is the server's problem, not the session's.
      // Stay logged in on the cached user; the next successful request will correct it.
      return { status: "authenticated", user: await readCachedUser() };
    }
  } catch (err) {
    console.error("[session] bootstrap failed", err);
    return { status: "unauthenticated" };
  }
}

/**
 * Refreshes proactively when the app returns to the foreground.
 *
 * Without this, an app resumed hours later waits for its first request to fail before it
 * discovers the token died — the user sees a flash of broken/empty screens, or gets bounced
 * to login, for a session that was always recoverable.
 *
 * Returns false only when the session is truly gone (no refresh token, or refresh rejected),
 * which the caller should treat as "log out". A network failure returns true: unreachable is
 * not the same as unauthenticated.
 */
export async function ensureFreshAccessToken(): Promise<boolean> {
  try {
    const [{ value: accessToken }, { value: refreshToken }] = await Promise.all([
      Preferences.get({ key: "accessToken" }),
      Preferences.get({ key: "refreshToken" }),
    ]);

    if (!hasUsableToken(refreshToken)) return false;
    if (!isAccessTokenExpiringSoon(accessToken)) return true;

    try {
      const refreshed = await refreshOnce();
      return hasUsableToken(refreshed);
    } catch (err) {
      // Unreachable server is not a dead session — see doc comment.
      if (err instanceof RefreshUnavailableError) return true;
      throw err;
    }
  } catch {
    return true; // see doc comment — don't log anyone out over a failed network call
  }
}
