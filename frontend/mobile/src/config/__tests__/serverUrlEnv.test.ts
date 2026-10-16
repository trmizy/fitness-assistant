/**
 * Release-build regression (6/10, real phone over the tunnel): serverUrl.ts read build flags with
 * `process.env[key]`, which Expo never inlines — so a release APK built with
 * EXPO_PUBLIC_ENABLE_REALTIME=true still had chat and calls off. Babel only replaces the literal
 * `process.env.EXPO_PUBLIC_X` form, so this pins the source shape rather than runtime behaviour
 * (under node every form works, which is how the bug got past the unit tests).
 *
 * Runs with: npx tsx --test src/config/__tests__/serverUrlEnv.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Code only — the file's own comments mention the bad form when explaining it.
const src = readFileSync(join(__dirname, "..", "serverUrl.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("serverUrl build flags", () => {
  it("never reads process.env with a computed key", () => {
    assert.equal(/process\.env\[/.test(src), false);
  });

  it("every key passed to env()/envFlag() has a static reader", () => {
    const used = new Set([...src.matchAll(/env(?:Flag)?\("(EXPO_PUBLIC_[A-Z_]+)"/g)].map((m) => m[1]));
    assert.ok(used.size >= 6);
    for (const key of used) {
      assert.ok(src.includes(`${key}: () => process.env.${key}`), `${key} has no static process.env.${key} reader`);
    }
  });
});
