import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decidePushPermission, isPromptBlockedRoute, type PushPermissionInput } from "../push/pushPermission";

const base: PushPermissionInput = {
  granted: false,
  canAskAgain: true,
  askedBefore: false,
  pathname: "/client/dashboard",
  onDeepLinkLanding: false,
};
const decide = (over: Partial<PushPermissionInput>) => decidePushPermission({ ...base, ...over });

describe("decidePushPermission", () => {
  it("granted → register the token, never a dialog", () => {
    assert.equal(decide({ granted: true, canAskAgain: false }), "register");
    assert.equal(decide({ granted: true, pathname: "/client/payments/result" }), "register");
  });

  it("undetermined and never asked → prompt once on a normal screen", () => {
    assert.equal(decide({}), "prompt");
  });

  it("denied (cannot ask again) → never prompt", () => {
    assert.equal(decide({ canAskAgain: false }), "skip");
  });

  it("asked flag already set → never prompt again, even if the OS would still allow it", () => {
    assert.equal(decide({ askedBefore: true }), "skip");
  });

  it("payment result / checkout screens → defer, not prompt", () => {
    assert.equal(decide({ pathname: "/client/payments/result" }), "defer");
    assert.equal(decide({ pathname: "/client/payments" }), "defer");
  });

  it("splash / role redirect ('/') → defer", () => {
    assert.equal(decide({ pathname: "/" }), "defer");
    assert.equal(decide({ pathname: "" }), "defer");
  });

  it("still on the screen a deep link cold-started the app on → defer", () => {
    assert.equal(decide({ onDeepLinkLanding: true }), "defer");
  });

  it("an asked flag beats the route (defer never turns into a second prompt)", () => {
    assert.equal(decide({ askedBefore: true, pathname: "/client/payments/result" }), "skip");
  });
});

describe("isPromptBlockedRoute", () => {
  it("does not block look-alike prefixes", () => {
    assert.equal(isPromptBlockedRoute("/client/paymentsx"), false);
    assert.equal(isPromptBlockedRoute("/client/dashboard"), false);
  });
});
