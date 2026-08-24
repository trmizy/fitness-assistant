/**
 * Wake Lock fallback tests (FINAL P0 CLOSURE PASS closure item #4) — no
 * jsdom/RTL needed, matches this frontend's pure-logic + node:test
 * convention (see workout-log-url.utils.test.ts). Proves the two required
 * fallback paths never throw and never leave the caller with a broken
 * state: the API missing entirely, and a real request/release rejecting.
 *
 * Run with: npx tsx --test src/app/pages/client/__tests__/wake-lock.utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requestWakeLockSafe, releaseWakeLockSafe } from "../wake-lock.utils";

describe("requestWakeLockSafe", () => {
  it("navigator.wakeLock undefined -> resolves null, does not throw", async () => {
    const result = await requestWakeLockSafe({} as any);
    assert.equal(result, null);
  });

  it("nav itself null/undefined -> resolves null, does not throw", async () => {
    assert.equal(await requestWakeLockSafe(null), null);
    assert.equal(await requestWakeLockSafe(undefined), null);
  });

  it("request() rejects (permission denied / tab not visible) -> resolves null, does not throw", async () => {
    const nav = {
      wakeLock: {
        request: async () => {
          throw new Error("NotAllowedError");
        },
      },
    };
    const result = await requestWakeLockSafe(nav);
    assert.equal(result, null);
  });

  it("request() resolves -> returns the real lock object", async () => {
    const fakeLock = { release: async () => {} };
    const nav = {
      wakeLock: {
        request: async () => fakeLock,
      },
    };
    const result = await requestWakeLockSafe(nav);
    assert.equal(result, fakeLock);
  });
});

describe("releaseWakeLockSafe", () => {
  it("null/undefined lock -> no-op, does not throw", async () => {
    await assert.doesNotReject(() => releaseWakeLockSafe(null));
    await assert.doesNotReject(() => releaseWakeLockSafe(undefined));
  });

  it("lock without a release method -> no-op, does not throw", async () => {
    await assert.doesNotReject(() => releaseWakeLockSafe({} as any));
  });

  it("release() rejects (already released / unsupported) -> does not throw", async () => {
    const lock = {
      release: async () => {
        throw new Error("already released");
      },
    };
    await assert.doesNotReject(() => releaseWakeLockSafe(lock));
  });

  it("release() resolves -> is actually called", async () => {
    let called = false;
    const lock = {
      release: async () => {
        called = true;
      },
    };
    await releaseWakeLockSafe(lock);
    assert.equal(called, true);
  });
});
