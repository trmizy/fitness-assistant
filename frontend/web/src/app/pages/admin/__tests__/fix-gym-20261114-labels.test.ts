/**
 * Fix round 14/11/2026 (N13E-11 / N13E-12): the admin gym-case page and the owner branch page no longer print raw enum names or unformatted money.
 * CODE AUDIT-level unit tests of the pure label helpers (no browser).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deadlineKindLabel } from "../disputes/workspace/deadlinesModel";
import { describeEvidence } from "../complaints/gymCaseModel";
import { MEMBERSHIP_STATUS_VI, viLabel } from "../../../utils/labels.vi";

describe("N13E-11: gym-case deadline kinds", () => {
  it("FIRST_RESPONSE and SUPPLEMENT_ROUND are Vietnamese, unknown kinds stay readable", () => {
    assert.equal(deadlineKindLabel("FIRST_RESPONSE"), "Phản hồi lần đầu");
    assert.equal(deadlineKindLabel("SUPPLEMENT_ROUND"), "Bổ sung theo yêu cầu");
    assert.equal(deadlineKindLabel(undefined), "Thời hạn khác");
  });
});

describe("N13E-12: membership status + price", () => {
  it("owner branch page labels (no raw CANCELLED / ACTIVE)", () => {
    assert.equal(viLabel(MEMBERSHIP_STATUS_VI, "CANCELLED"), "Đã huỷ");
    assert.equal(viLabel(MEMBERSHIP_STATUS_VI, "ACTIVE"), "Đang hoạt động");
    assert.equal(viLabel(MEMBERSHIP_STATUS_VI, "PENDING_PAYMENT"), "Chờ thanh toán");
  });
  it("the membership evidence row shows the price as money, not 700000", () => {
    const view = describeEvidence({ id: "e1", source: "MEMBERSHIP_RECORD", payload: { status: "ACTIVE", priceAtPurchase: "700000", durationDaysSnapshot: 30 } } as never);
    const price = view.fields.find((f) => f.label === "Giá lúc mua");
    assert.ok(price, "price field present");
    assert.match(price!.value, /700\.000/);
    assert.ok(price!.value.includes("₫"));
    assert.notEqual(price!.value, "700000");
  });
});
