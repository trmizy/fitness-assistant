import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The RN stand-in for `@capacitor/preferences`, deliberately exposing the SAME shape
 * (`get({key}) -> {value}`, `set({key, value})`, `remove({key})`) rather than a nicer one.
 *
 * Why keep an awkward wrapper shape: `services/api.ts` and `services/session.ts` are ported
 * line-for-line from the web app and are expected to stay diffable against it for the rest of
 * the migration. Matching Preferences' call shape means those two files differ from web's only
 * in their import line, so a future fix on either side can be carried across by eye instead of
 * by re-reasoning the whole flow.
 *
 * Backend is AsyncStorage, the true equivalent of Capacitor Preferences: durable, per-app, and
 * NOT encrypted. That is fine for what lives here (access token, cached user object, server
 * override) but not for the refresh token — see services/secureStorage.ts.
 */

type KeyOptions = { key: string };
type SetOptions = { key: string; value: string };

export const Preferences = {
  async get({ key }: KeyOptions): Promise<{ value: string | null }> {
    try {
      return { value: await AsyncStorage.getItem(key) };
    } catch {
      // A storage read must never be the reason a user cannot use the app; every caller
      // already treats a null value as "not stored".
      return { value: null };
    }
  },

  async set({ key, value }: SetOptions): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (err) {
      console.error("[storage] write failed", key, err);
    }
  },

  async remove({ key }: KeyOptions): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (err) {
      console.error("[storage] remove failed", key, err);
    }
  },
};
