/**
 * N15C-03 - the public delivery mode (card + detail sheet) follows the packages the PT sells (same rule as the
 * ONLINE/OFFLINE/HYBRID search filter), not the application's service_mode. Evidence: TEST FIXTURE (pure function).
 *   npx tsx --test src/__tests__/pt-public-service-mode.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { derivePublicServiceMode } from "../services/pt-public-dto";

describe("derivePublicServiceMode (N15C-03)", () => {
  it("online-only packages -> ONLINE even when the application says OFFLINE", () => {
    assert.equal(derivePublicServiceMode([{ sessionMode: "ONLINE" }], "OFFLINE"), "ONLINE");
  });
  it("offline-only packages -> OFFLINE even when the application says ONLINE", () => {
    assert.equal(derivePublicServiceMode([{ sessionMode: "OFFLINE" }, { sessionMode: "OFFLINE" }], "ONLINE"), "OFFLINE");
  });
  it("both kinds of packages -> HYBRID regardless of the application", () => {
    assert.equal(derivePublicServiceMode([{ sessionMode: "ONLINE" }, { sessionMode: "OFFLINE" }], "ONLINE"), "HYBRID");
  });
  it("no usable package -> falls back to the application value (or null)", () => {
    assert.equal(derivePublicServiceMode([], "HYBRID"), "HYBRID");
    assert.equal(derivePublicServiceMode([], null), null);
  });
});
