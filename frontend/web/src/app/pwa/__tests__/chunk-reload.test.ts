/**
 * Stale-chunk recovery (pwa/chunk-reload.ts). Live bug 2026-11-09 on gymini.vn: after a deploy,
 * /client/workout showed "Failed to fetch dynamically imported module …/TrainingPage-<old>.js".
 *
 * Run with: npx tsx --test src/app/pwa/__tests__/chunk-reload.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isChunkLoadError, reloadOnceForStaleChunk, type ReloadDeps } from "../chunk-reload";

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

function deps(storage: ReloadDeps["storage"], clock: { t: number }, reloads: { n: number }): ReloadDeps {
  return { storage, now: () => clock.t, reload: () => void reloads.n++ };
}

describe("isChunkLoadError", () => {
  it("recognises the browsers' stale-chunk messages", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://gymini.vn/assets/TrainingPage-c-JCFIHQ.js", // Chromium/Edge
      "Importing a module script failed.", // Safari
      "error loading dynamically imported module: https://gymini.vn/assets/x.js", // Firefox
      "Unable to preload CSS for /assets/index-abc.css", // Vite CSS preload
    ]) {
      assert.equal(isChunkLoadError(new Error(message)), true, message);
    }
  });

  it("reads a nested { error } (React Router error shape) and plain strings", () => {
    assert.equal(isChunkLoadError({ error: new TypeError("Failed to fetch dynamically imported module: x") }), true);
    assert.equal(isChunkLoadError("Importing a module script failed."), true);
  });

  it("does not treat ordinary errors as stale chunks", () => {
    for (const e of [new Error("Network Error"), new Error("Request failed with status code 500"), null, undefined, {}]) {
      assert.equal(isChunkLoadError(e), false);
    }
  });
});

describe("reloadOnceForStaleChunk", () => {
  it("reloads once, then refuses inside the 30 s guard (no reload loop), then allows again", () => {
    const storage = memoryStorage();
    const clock = { t: 1_000_000 };
    const reloads = { n: 0 };

    assert.equal(reloadOnceForStaleChunk(deps(storage, clock, reloads)), true);
    assert.equal(reloads.n, 1);

    clock.t += 5_000; // the reloaded page fails again: the chunk is genuinely missing
    assert.equal(reloadOnceForStaleChunk(deps(storage, clock, reloads)), false);
    assert.equal(reloads.n, 1);

    clock.t += 30_000; // a later deploy: recovering again is allowed
    assert.equal(reloadOnceForStaleChunk(deps(storage, clock, reloads)), true);
    assert.equal(reloads.n, 2);
  });

  it("without storage it still reloads, but only once per page", () => {
    const clock = { t: 0 };
    const reloads = { n: 0 };
    assert.equal(reloadOnceForStaleChunk(deps(null, clock, reloads)), true);
    assert.equal(reloadOnceForStaleChunk(deps(null, clock, reloads)), false);
    assert.equal(reloads.n, 1);
  });

  it("a throwing storage never blocks the reload", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    const reloads = { n: 0 };
    assert.equal(reloadOnceForStaleChunk(deps(broken, { t: 50_000 }, reloads)), true);
    assert.equal(reloads.n, 1);
  });
});
