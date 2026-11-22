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

// Gym Owner handoff item 1 (22/11/2026): a GYM request is shown by WHO asked (requestedByUserId), the branch id is never looked up as a user.
import { withdrawalRequesterId } from "../withdrawals/withdrawalOwnerNames";
import { payoutOrigin, PAYOUT_ORIGIN_NOTE, normalizeQueue } from "../withdrawals/withdrawalQueue";

describe("GYM requester (requestedByUserId)", () => {
  it("looks up the requester of a GYM row, never the branch id; an older GYM row without one is skipped", () => {
    const ids = ownerIdsToLookUp([
      { ownerType: "GYM", ownerId: "branch-1", requestedByUserId: "owner-user" },
      { ownerType: "GYM", ownerId: "branch-2", requestedByUserId: null },
      { ownerType: "GYM", ownerId: "branch-3" },
      { ownerType: "PT", ownerId: "pt-1", requestedByUserId: "ignored-for-pt" },
    ]);
    assert.deepEqual(ids, ["owner-user", "pt-1"]);
  });
  it("withdrawalRequesterId: the owner for PT / CLIENT, the requester for GYM", () => {
    assert.equal(withdrawalRequesterId({ ownerType: "PT", ownerId: "p", requestedByUserId: "x" }), "p");
    assert.equal(withdrawalRequesterId({ ownerType: "GYM", ownerId: "g", requestedByUserId: "u" }), "u");
    assert.equal(withdrawalRequesterId({ ownerType: "GYM", ownerId: "g", requestedByUserId: null }), "");
  });
  it("payoutOrigin: registered account / manual GYM text from before the rule / nothing for PT and CLIENT", () => {
    assert.equal(payoutOrigin({ ownerType: "GYM", payoutSource: "REGISTERED_ACCOUNT" }), "REGISTERED");
    assert.equal(payoutOrigin({ ownerType: "GYM", payoutSource: null }), "MANUAL_GYM");
    assert.equal(payoutOrigin({ ownerType: "PT", payoutSource: null }), null);
    assert.equal(payoutOrigin({ ownerType: "CLIENT", payoutSource: undefined }), null);
    assert.match(PAYOUT_ORIGIN_NOTE.REGISTERED, /đã đăng ký/);
  });
  it("normalizeQueue keeps requestedByUserId and payoutSource from the API", () => {
    const { rows } = normalizeQueue([
      { id: "w1", ownerType: "GYM", ownerId: "g", amount: "1000", status: "PENDING", payoutInfo: "VCB — 1 — A", createdAt: "2026-11-22T00:00:00Z", requestedByUserId: "u1", payoutSource: "REGISTERED_ACCOUNT" },
      { id: "w2", ownerType: "PT", ownerId: "p", amount: "1000", status: "PENDING", payoutInfo: "x", createdAt: "2026-11-22T00:00:00Z" },
    ]);
    assert.equal(rows[0].requestedByUserId, "u1");
    assert.equal(rows[0].payoutSource, "REGISTERED_ACCOUNT");
    assert.equal(rows[1].requestedByUserId, null);
    assert.equal(rows[1].payoutSource, null);
  });
});
