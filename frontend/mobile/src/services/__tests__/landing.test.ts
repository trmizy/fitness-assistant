/**
 * Where a role is allowed to land, and which captured return paths are safe to honour.
 *
 * These are pure decisions with no rendering, and they are the ones that go wrong quietly: a bad
 * answer here does not crash, it drops somebody into the wrong workspace or bounces them off a
 * guard they should never have met.
 *
 * Runs with: npx tsx --test src/services/__tests__/landing.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ROLE_HOME,
  isReturnPathForRole,
  isSafeReturnPath,
  landingPathFor,
  roleOf,
} from "../../config/landing";

describe("roleOf", () => {
  it("reads the explicit roles case-insensitively", () => {
    assert.equal(roleOf({ role: "ADMIN" }), "admin");
    assert.equal(roleOf({ role: "admin" }), "admin");
    assert.equal(roleOf({ role: "GYM_OWNER" }), "gym_owner");
    assert.equal(roleOf({ role: "PT" }), "pt");
  });

  it("treats isPT as PT even when role says otherwise", () => {
    // A PT's account keeps a client role and gains the flag — reading only `role` would send a
    // trainer into the client workspace and hide their own.
    assert.equal(roleOf({ role: "CUSTOMER", isPT: true }), "pt");
  });

  it("falls back to client for anything unknown, null or empty", () => {
    assert.equal(roleOf({ role: "CUSTOMER" }), "client");
    assert.equal(roleOf({ role: "SOMETHING_NEW" }), "client");
    assert.equal(roleOf({}), "client");
    assert.equal(roleOf(null), "client");
    assert.equal(roleOf(undefined), "client");
  });

  it("ranks admin above the PT flag", () => {
    // An admin who is also a trainer must still land in the admin console.
    assert.equal(roleOf({ role: "ADMIN", isPT: true }), "admin");
    assert.equal(roleOf({ role: "GYM_OWNER", isPT: true }), "gym_owner");
  });
});

describe("landingPathFor", () => {
  it("sends each role to its own home", () => {
    assert.equal(landingPathFor({ role: "CUSTOMER" }), ROLE_HOME.client);
    assert.equal(landingPathFor({ role: "PT" }), ROLE_HOME.pt);
    assert.equal(landingPathFor({ role: "GYM_OWNER" }), ROLE_HOME.gym_owner);
    assert.equal(landingPathFor({ role: "ADMIN" }), ROLE_HOME.admin);
  });
});

describe("isSafeReturnPath", () => {
  it("accepts an ordinary in-app path", () => {
    assert.equal(isSafeReturnPath("/client/dashboard"), true);
    assert.equal(isSafeReturnPath("/client/payments/result?id=1"), true);
  });

  it("rejects anything that could leave the app", () => {
    assert.equal(isSafeReturnPath("https://evil.com"), false);
    // Protocol-relative: the exact case a naive `startsWith("/")` waves through.
    assert.equal(isSafeReturnPath("//evil.com"), false);
    assert.equal(isSafeReturnPath("client/dashboard"), false);
  });

  it("rejects empty and missing values", () => {
    assert.equal(isSafeReturnPath(""), false);
    assert.equal(isSafeReturnPath(null), false);
    assert.equal(isSafeReturnPath(undefined), false);
  });

  it("rejects /login itself, which would bounce straight back", () => {
    assert.equal(isSafeReturnPath("/login"), false);
  });
});

describe("isReturnPathForRole", () => {
  it("lets a role return to its own zone", () => {
    assert.equal(isReturnPathForRole("/client/dashboard", "client"), true);
    assert.equal(isReturnPathForRole("/pt/students", "pt"), true);
    assert.equal(isReturnPathForRole("/gym-owner/gyms", "gym_owner"), true);
    assert.equal(isReturnPathForRole("/admin/approvals", "admin"), true);
  });

  it("blocks a path belonging to a DIFFERENT role's zone", () => {
    // The real bug this exists for: a PT logs out from /pt/dashboard, the guard stores that as the
    // return path, and then a client signs in on the same screen and inherits it.
    assert.equal(isReturnPathForRole("/pt/dashboard", "client"), false);
    assert.equal(isReturnPathForRole("/admin/dashboard", "client"), false);
    assert.equal(isReturnPathForRole("/client/dashboard", "admin"), false);
  });

  it("blocks the bare zone as well as paths under it", () => {
    assert.equal(isReturnPathForRole("/pt", "client"), false);
    assert.equal(isReturnPathForRole("/pt/", "client"), false);
  });

  it("does not confuse a zone with a path that merely starts with the same letters", () => {
    // "/ptx" is not inside "/pt" — a plain startsWith check without the separator would reject it.
    assert.equal(isReturnPathForRole("/ptx/thing", "client"), true);
  });

  it("is permissive about paths outside every zone", () => {
    // There is no such route today, but guessing would be worse than allowing it.
    assert.equal(isReturnPathForRole("/settings", "client"), true);
  });

  it("lets a PT return into the client workspace, which they are allowed to use", () => {
    // A PT has two workspaces; the client one admits them (see app/client/_layout.tsx).
    assert.equal(isReturnPathForRole("/client/dashboard", "pt"), true);
  });
});
