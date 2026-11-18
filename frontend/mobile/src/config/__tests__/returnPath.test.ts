/**
 * N17M-08 — link opened while signed out on a COLD start must survive the trip through /login.
 * Chạy: npx tsx --test src/config/__tests__/returnPath.test.ts
 */
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PENDING_RETURN_TTL_MS,
  clearReturnPath,
  clearSignedOutOnPurpose,
  markSignedOutOnPurpose,
  isBareWorkspaceRoot,
  anchorOptionsFor,
  isMeaningfulReturnPath,
  pickReturnPath,
  peekReturnPath,
  rememberReturnPath,
  resolveReturnPath,
} from "../returnPath";
import { redirectSystemPath } from "../../../app/+native-intent";

const GYM = "/client/services/gyms/7d5e3f0a-1b2c-4d3e-8f90-123456789abc";

describe("returnPath", () => {
  beforeEach(() => clearReturnPath());

  it("only internal, non-root paths are meaningful (no open redirect)", () => {
    assert.equal(isMeaningfulReturnPath(GYM), true);
    for (const bad of ["/", "", null, undefined, "//evil.com", "https://evil.com/x", "evil.com", "/login", "javascript:alert(1)"]) {
      assert.equal(isMeaningfulReturnPath(bad as string | null | undefined), false, String(bad));
    }
  });

  it("refuses to remember an unsafe path", () => {
    rememberReturnPath("//evil.com");
    rememberReturnPath("https://evil.com");
    rememberReturnPath("/");
    assert.equal(peekReturnPath(), null);
  });

  it("peek does not consume; clear does", () => {
    rememberReturnPath(GYM);
    assert.equal(peekReturnPath(), GYM);
    assert.equal(peekReturnPath(), GYM);
    clearReturnPath();
    assert.equal(peekReturnPath(), null);
  });

  it("expires after the TTL (an abandoned link cannot redirect a later login)", () => {
    rememberReturnPath(GYM, 1_000);
    assert.equal(peekReturnPath(1_000 + PENDING_RETURN_TTL_MS), GYM);
    assert.equal(peekReturnPath(1_001 + PENDING_RETURN_TTL_MS), null);
    assert.equal(peekReturnPath(1_000), null, "expired entry is dropped, not revived");
  });

  it("resolve: the guard's own path wins; the bare root (cold-start default) falls back to the link", () => {
    rememberReturnPath(GYM);
    assert.equal(resolveReturnPath("/client/payments/result?txnId=1"), "/client/payments/result?txnId=1");
    assert.equal(resolveReturnPath("/"), GYM);
    assert.equal(resolveReturnPath(undefined), GYM);
    clearReturnPath();
    assert.equal(resolveReturnPath("/"), null);
  });
});

describe("cold start through the router root (device log, N17M-08)", () => {
  beforeEach(() => clearReturnPath());

  it("recognises bare workspace roots and homes, not specific routes", () => {
    for (const root of ["/", "/client", "/client/", "/pt", "/admin", "/gym-owner", "/client/dashboard", "/pt/dashboard", "/client?x=1"]) {
      assert.equal(isBareWorkspaceRoot(root), true, root);
    }
    for (const specific of [GYM, "/client/payments/result?txnId=1", "/pt/schedule", "/ptx"]) {
      assert.equal(isBareWorkspaceRoot(specific), false, specific);
    }
  });

  it("guard sees /client but a link is remembered: the link wins", () => {
    rememberReturnPath(GYM);
    assert.equal(resolveReturnPath("/client"), GYM);
    assert.equal(resolveReturnPath("/client/dashboard"), GYM);
  });

  it("guard sees /client and nothing is remembered: plain cold start keeps /client (ends at Home)", () => {
    assert.equal(resolveReturnPath("/client"), "/client");
    assert.equal(resolveReturnPath("/"), null);
  });

  it("login side: fromParam=/client + remembered link -> link; specific fromParam wins", () => {
    assert.equal(pickReturnPath("/client", GYM), GYM);
    assert.equal(pickReturnPath(undefined, GYM), GYM);
    assert.equal(pickReturnPath("/client/payments/result?txnId=1", GYM), "/client/payments/result?txnId=1");
    assert.equal(pickReturnPath("/client", null), "/client");
    assert.equal(pickReturnPath(undefined, null), null);
  });

  it("an unsafe remembered value is never picked", () => {
    assert.equal(pickReturnPath("/client", "//evil.com"), "/client");
    assert.equal(pickReturnPath("/", "https://evil.com"), null);
  });
});

describe("redirectSystemPath remembers only COLD-start links", () => {
  beforeEach(() => clearReturnPath());

  it("cold gym link: rewritten and remembered", () => {
    const out = redirectSystemPath({ path: "https://gymini.vn/gyms/abc-123", initial: true });
    assert.equal(out, "/client/services/gyms/abc-123");
    assert.equal(peekReturnPath(), "/client/services/gyms/abc-123");
  });

  it("warm gym link: rewritten, NOT remembered (the guard reads its route reliably)", () => {
    const out = redirectSystemPath({ path: "https://gymini.vn/gyms/abc-123", initial: false });
    assert.equal(out, "/client/services/gyms/abc-123");
    assert.equal(peekReturnPath(), null);
  });

  it("cold payment-result link is remembered as the status-less result href", () => {
    const out = redirectSystemPath({ path: "fitnessassistant://client/payments/result?txnId=T1&status=success", initial: true });
    assert.ok(!out.includes("status=success"));
    assert.equal(peekReturnPath(), out);
  });

  it("unrelated or foreign-host links remember nothing", () => {
    redirectSystemPath({ path: "https://evil.example/gyms/abc", initial: true });
    redirectSystemPath({ path: "/client/dashboard", initial: true });
    assert.equal(peekReturnPath(), null);
  });
});

describe("anchorOptionsFor — FIX8-5 (system back after login lands on the hub, not exit)", () => {
  it("the gym link and other routes inside a tab stack are anchored so the hub sits underneath", () => {
    for (const route of [GYM, "/client/services/booking", "/client/profile/wallet", "/pt/service-orders/abc"]) {
      assert.deepEqual(anchorOptionsFor(route), { withAnchor: true }, route);
    }
  });

  it("a plain login (role home) and tab roots get NO options", () => {
    for (const route of ["/client/dashboard", "/pt/dashboard", "/gym-owner/dashboard", "/admin/dashboard", "/client/services", "/client/services?tab=contracts", "/client/workout"]) {
      assert.equal(anchorOptionsFor(route), undefined, route);
    }
  });

  it("the cold gym link remembered by +native-intent resolves to an anchored route", () => {
    clearReturnPath();
    redirectSystemPath({ path: "https://gymini.vn/gyms/abc-123", initial: true });
    const target = pickReturnPath("/client", peekReturnPath());
    assert.equal(target, "/client/services/gyms/abc-123");
    assert.deepEqual(anchorOptionsFor(target!), { withAnchor: true });
    clearReturnPath();
  });
});

describe("deliberate sign-out — AWS-MOB-ISO-01", () => {
  beforeEach(() => {
    clearReturnPath();
    clearSignedOutOnPurpose();
  });

  const RESULT = "/client/payments/result?txnId=ee421f0e-3e0e-4326-ba6e-88d8952241e3";

  it("a session that drops mid-flow still carries the screen it was on", () => {
    assert.equal(resolveReturnPath(RESULT), RESULT);
  });

  it("after 'Đăng xuất' the guard offers NO return path, so the next account lands on its own home", () => {
    markSignedOutOnPurpose();
    assert.equal(resolveReturnPath(RESULT), null);
    assert.equal(resolveReturnPath(GYM), null);
  });

  it("signing out also drops a remembered cold-start link", () => {
    rememberReturnPath(GYM);
    markSignedOutOnPurpose();
    assert.equal(peekReturnPath(), null);
  });

  it("the next sign-in lifts the suppression", () => {
    markSignedOutOnPurpose();
    clearSignedOutOnPurpose();
    assert.equal(resolveReturnPath(RESULT), RESULT);
  });
});
