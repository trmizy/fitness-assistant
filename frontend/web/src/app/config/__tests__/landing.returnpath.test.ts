/**
 * FIX3-GYM 5b: a guest opening a shared gym link is sent to /login with state.from = /client/gyms?gym=<id>.
 * After login that path must be honoured for a client AND a PT (a PT also uses the client workspace) but never for
 * gym owner / admin. TEST FIXTURE: pure function. Run: npx tsx --test src/app/config/__tests__/landing.returnpath.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isReturnPathForRole, isSafeReturnPath } from "../landing";

describe("gym share link return path", () => {
  const path = "/client/gyms?gym=abc";
  it("is a safe same-app path", () => assert.equal(isSafeReturnPath(path), true));
  it("is honoured for client and pt", () => {
    assert.equal(isReturnPathForRole(path, "client"), true);
    assert.equal(isReturnPathForRole(path, "pt"), true);
  });
  it("is not honoured for gym_owner / admin", () => {
    assert.equal(isReturnPathForRole(path, "gym_owner"), false);
    assert.equal(isReturnPathForRole(path, "admin"), false);
  });
  it("a PT is still refused another role's workspace", () => {
    assert.equal(isReturnPathForRole("/admin/dashboard", "pt"), false);
    assert.equal(isReturnPathForRole("/gym-owner/dashboard", "pt"), false);
  });
});
