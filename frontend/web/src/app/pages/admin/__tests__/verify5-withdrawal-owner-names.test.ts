/**
 * VERIFY5 — tên người rút ở hàng đợi rút tiền của admin (thay cho mã người dùng).
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/verify5-withdrawal-owner-names.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { OWNER_LOOKUP_LIMIT, ownerIdsToLookUp, parseOwnerNames } from "../withdrawals/withdrawalOwnerNames";

describe("ownerIdsToLookUp", () => {
  it("looks up only PT / CLIENT owners, distinct and sorted (a GYM wallet's ownerId is a branch id)", () => {
    const ids = ownerIdsToLookUp([
      { ownerType: "CLIENT", ownerId: "b" },
      { ownerType: "GYM", ownerId: "gym-1" },
      { ownerType: "PT", ownerId: "a" },
      { ownerType: "CLIENT", ownerId: "b" },
      { ownerType: "PT", ownerId: "" },
    ]);
    assert.deepEqual(ids, ["a", "b"]);
  });
  it("is empty for an empty queue, and capped at the gateway limit", () => {
    assert.deepEqual(ownerIdsToLookUp([]), []);
    const many = Array.from({ length: OWNER_LOOKUP_LIMIT + 25 }, (_, i) => ({ ownerType: "CLIENT" as const, ownerId: `u${String(i).padStart(4, "0")}` }));
    assert.equal(ownerIdsToLookUp(many).length, OWNER_LOOKUP_LIMIT);
  });
});

describe("parseOwnerNames", () => {
  it("reads the gateway shape { success, data: { users } }", () => {
    const m = parseOwnerNames({ success: true, data: { total: 1, users: [{ id: "u1", name: " Huỳnh Minh Thịnh ", email: "t@x.test" }] } });
    assert.deepEqual(m.get("u1"), { name: "Huỳnh Minh Thịnh", email: "t@x.test" });
  });
  it("also accepts { users } and a bare array; falls back to the email when the name is empty", () => {
    assert.equal(parseOwnerNames({ users: [{ id: "u2", name: "An" }] }).get("u2")?.name, "An");
    assert.equal(parseOwnerNames([{ id: "u3", name: "", email: "e@x.test" }]).get("u3")?.name, "e@x.test");
  });
  it("skips rows without an id or without any usable name, and never throws on junk", () => {
    const m = parseOwnerNames({ data: { users: [{ name: "No id" }, { id: "u4" }, { id: 7, name: "x" }, null] } });
    assert.equal(m.size, 0);
    for (const junk of [undefined, null, "x", 5, {}, { data: null }, { data: { users: "nope" } }]) assert.equal(parseOwnerNames(junk).size, 0);
  });
});
