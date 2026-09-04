/**
 * Vòng 4 / Phase D3 — an in-memory mirror of the access token already persisted via
 * @capacitor/preferences. `api.ts`'s request interceptor used to `await Preferences.get(...)`
 * (a native-bridge round-trip) on EVERY single request; reading this module-level variable
 * instead is synchronous, no await needed.
 *
 * This is a CACHE, not the source of truth — Preferences (storage) still is. Every write site
 * (login, register/verify, refresh) must write BOTH storage AND this store, in that order or
 * the other; every clear (logout) must clear both. Forgetting the storage half here would
 * break session persistence across an app restart (memory resets to null on a fresh process,
 * so a token that only ever lived here is gone the moment the app is closed) — the exact
 * regression this phase's own task doc warned about undoing Vòng 3's fix. bootstrapSession is
 * what seeds this store from storage at startup, before anything else reads it.
 */

let accessToken: string | null = null;

export const tokenStore = {
  get(): string | null {
    return accessToken;
  },
  set(token: string | null | undefined): void {
    accessToken = token ?? null;
  },
};
