import * as SecureStore from "expo-secure-store";

import { Preferences } from "./storage";

/**
 * Storage for the refresh token — the one credential worth protecting at rest.
 *
 * Ported from web's services/secureStorage.ts, same reasoning: AsyncStorage (like Capacitor
 * Preferences before it) is durable but NOT an encrypted secret store — on Android it is plain
 * files in the app's data directory, readable on a rooted device, from a debug build, or via an
 * ADB backup. The refresh token is long-lived and mints access tokens, so it belongs in the OS
 * keystore (`expo-secure-store` → Android Keystore / iOS Keychain) instead.
 *
 * The access token deliberately stays in plain storage: it is short-lived, it is sent on every
 * request anyway, and keeping it there avoids a keystore round-trip on the hot path.
 *
 * The web version branched on `Capacitor.isNativePlatform()` to keep browsers on Preferences;
 * that branch is gone here because this app only ever runs native. What IS kept is the failure
 * fallback: a keystore that is unavailable or throws (device policy, corrupted entry) degrades
 * to plain storage rather than throwing, because a storage problem must never be able to lock a
 * user out. Reads therefore still have to consult both locations, and a logout still has to
 * clear both.
 */

const KEY = "refreshToken";

function usable(value: string | null | undefined): string | null {
  return value && value !== "null" && value !== "undefined" ? value : null;
}

async function fromPlainStorage(): Promise<string | null> {
  const { value } = await Preferences.get({ key: KEY });
  return usable(value);
}

export async function readRefreshToken(): Promise<string | null> {
  try {
    const secure = await SecureStore.getItemAsync(KEY);
    if (usable(secure)) return secure;
  } catch {
    // Keystore unreadable — fall through to the fallback location below.
  }

  // Only ever populated when a previous write hit the keystore fallback path.
  const plain = await fromPlainStorage();
  if (!plain) return null;

  // Try to promote it back into the keystore now that we are reading it again; if the keystore
  // is still broken, keep the plain copy so the session survives either way.
  try {
    await SecureStore.setItemAsync(KEY, plain);
    await Preferences.remove({ key: KEY });
  } catch {
    // Keep the plain copy — the session still works.
  }
  return plain;
}

export async function writeRefreshToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, token);
    // Clear any fallback copy so the token does not linger in plain storage.
    await Preferences.remove({ key: KEY });
  } catch {
    await Preferences.set({ key: KEY, value: token });
  }
}

export async function clearRefreshToken(): Promise<void> {
  // Always clear BOTH locations: a device that fell back after a keystore error can
  // legitimately hold a copy in either place. Logging out must leave nothing behind.
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing stored, or keystore unavailable — the plain removal below still runs.
  }
  await Preferences.remove({ key: KEY });
}
