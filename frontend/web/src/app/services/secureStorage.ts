import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

/**
 * Storage for the refresh token — the one credential worth protecting at rest.
 *
 * `@capacitor/preferences` is durable but is NOT an encrypted secret store: on Android it
 * is plain SharedPreferences, readable by anyone with access to the app's data directory
 * (a rooted device, a debug build, an ADB backup). The refresh token is long-lived and
 * mints access tokens, so it belongs in the OS keystore instead.
 *
 * The access token deliberately stays in Preferences: it is short-lived, it is sent on
 * every request anyway, and keeping it there avoids a keystore round-trip on the hot path.
 *
 * Two deliberate fallbacks, both so that a storage problem can never lock a user out:
 *
 *  - **Web** keeps using Preferences. The plugin's web implementation is localStorage-backed,
 *    so it would be no more secure while adding a second storage location to reason about.
 *  - **A failing keystore** (unavailable, device policy, corrupted entry) falls back to
 *    Preferences rather than throwing. Degrading to the old behaviour beats refusing to log in.
 */

const KEY = "refreshToken";

const useKeystore = (): boolean => Capacitor.isNativePlatform();

async function fromPreferences(): Promise<string | null> {
  const { value } = await Preferences.get({ key: KEY });
  return value && value !== "null" && value !== "undefined" ? value : null;
}

export async function readRefreshToken(): Promise<string | null> {
  if (!useKeystore()) return fromPreferences();

  try {
    const secure = await SecureStorage.getItem(KEY);
    if (secure) return secure;
  } catch {
    // Keystore unreadable — fall through and try the legacy location.
  }

  // Migration for sessions created before the keystore existed. Anyone already logged in
  // has their token in Preferences; move it across on first read so upgrading the app does
  // not silently sign everyone out. Runs at most once per device — after the move the
  // Preferences copy is gone.
  const legacy = await fromPreferences();
  if (!legacy) return null;
  try {
    await SecureStorage.setItem(KEY, legacy);
    await Preferences.remove({ key: KEY });
  } catch {
    // Keep the legacy copy if it could not be moved; the session still works.
  }
  return legacy;
}

export async function writeRefreshToken(token: string): Promise<void> {
  if (!useKeystore()) {
    await Preferences.set({ key: KEY, value: token });
    return;
  }
  try {
    await SecureStorage.setItem(KEY, token);
    // Clear any pre-migration copy so the token does not linger in plain storage.
    await Preferences.remove({ key: KEY });
  } catch {
    await Preferences.set({ key: KEY, value: token });
  }
}

export async function clearRefreshToken(): Promise<void> {
  // Always clear BOTH locations: a device part-way through migration, or one that fell back
  // after a keystore error, can legitimately hold a copy in either place. Logging out must
  // leave nothing behind in either.
  try {
    if (useKeystore()) await SecureStorage.remove(KEY);
  } catch {
    // Nothing stored, or keystore unavailable — the Preferences removal below still runs.
  }
  await Preferences.remove({ key: KEY });
}
