/**
 * Tab options for hidden routes. The full-screen case is a real regression: the onboarding wizard
 * rendered the tab bar underneath it, offering tabs into a workspace the user was not set up for.
 *
 * Runs with: npx tsx --test src/components/navigation/__tests__/hiddenRouteOptions.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hiddenRouteOptions } from "../hiddenRouteOptions";

describe("hiddenRouteOptions", () => {
  it("a hidden route loses its tab button but keeps the bar", () => {
    assert.deepEqual(hiddenRouteOptions("notifications", ["onboarding"]), { href: null });
  });

  it("a full-screen route also hides the bar", () => {
    assert.deepEqual(hiddenRouteOptions("onboarding", ["onboarding"]), {
      href: null,
      tabBarStyle: { display: "none" },
    });
  });

  it("no full-screen routes means every hidden route keeps the bar", () => {
    assert.deepEqual(hiddenRouteOptions("onboarding", []), { href: null });
  });
});
