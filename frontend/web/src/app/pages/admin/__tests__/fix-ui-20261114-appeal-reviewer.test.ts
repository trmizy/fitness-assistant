/**
 * N13D-05: appeal tab shows the reviewer's name, not an id.
 * Run: npx tsx --test src/app/pages/admin/__tests__/fix-ui-20261114-appeal-reviewer.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adminDisplayName } from "../disputes/workspace/appealModel";

const admins = [
  { id: "a1", label: "Lê Admin (a1@x.vn)" },
  { id: "a2", displayName: "Trần Hai" },
];

describe("adminDisplayName", () => {
  it("resolves a known admin by name", () => {
    assert.equal(adminDisplayName("a2", admins, "me"), "Trần Hai");
    assert.equal(adminDisplayName("a1", admins, "me"), "Lê Admin (a1@x.vn)");
  });
  it("self -> Bạn", () => assert.equal(adminDisplayName("me", admins, "me"), "Bạn"));
  it("unknown id never echoes the uuid", () => {
    const out = adminDisplayName("d0d00000-0000-4000-8000-000000000004", admins, "me");
    assert.equal(out, "Quản trị viên khác");
    assert.ok(!/d0d0/.test(out));
  });
  it("empty id", () => assert.equal(adminDisplayName(null, admins), "Chưa rõ"));
});
