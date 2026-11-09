/**
 * B6a — phần thuần của "Tài chính › Hoàn tiền": chip `?type=`, chuẩn hoá danh sách hoàn tiền dịch vụ, tóm tắt (số lượng + cũ nhất,
 * KHÔNG có tổng tiền), mốc "lần hoàn cuối"; cộng các chốt chặn tiền của B1 (trần hoàn, UUID gói hội viên) mà màn hình mới dùng lại.
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/b6a-refund-queue.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REFUND_TYPE,
  REFUND_TYPES,
  isFinalRefund,
  normalizeServiceRefunds,
  parseTypeParam,
  shortId,
  summarizeServiceRefunds,
} from "../refunds/refundQueue";
import { checkMembershipId, checkRefundAmount, moneyText } from "../shared/moneyGuards";

const order = (n: number, over: Record<string, unknown> = {}) => ({
  id: `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`,
  status: "REFUND_REQUESTED",
  titleSnapshot: `Giáo án ${n}`,
  buyerId: `eeeeeeee-0000-4000-8000-${String(n).padStart(12, "0")}`,
  sellerId: `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`,
  priceAtPurchase: 2_000_000,
  refundRequestedAt: "2026-10-27T03:00:00.000Z",
  disputeReason: "Chưa nhận được bản nháp",
  ...over,
});

describe("B6a chip ?type=", () => {
  it("has exactly the two kinds, service first/default", () => {
    assert.deepEqual([...REFUND_TYPES], ["service", "membership"]);
    assert.equal(DEFAULT_REFUND_TYPE, "service");
  });
  it("parses membership (any case/space), everything else falls back to service", () => {
    assert.equal(parseTypeParam("membership"), "membership");
    assert.equal(parseTypeParam(" MEMBERSHIP "), "membership");
    assert.equal(parseTypeParam("service"), "service");
    for (const bad of [null, undefined, "", "garbage", "kind=membership", "memberships", "PAID"]) {
      assert.equal(parseTypeParam(bad as string | null | undefined), "service", String(bad));
    }
  });
});

describe("B6a normalizeServiceRefunds", () => {
  it("maps the API order to a queue row (ids, title, price, requestedAt, reason)", () => {
    const { rows, ignored, rawCount } = normalizeServiceRefunds([order(1)]);
    assert.equal(rawCount, 1);
    assert.equal(ignored, 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "cccccccc-0000-4000-8000-000000000001");
    assert.equal(rows[0].title, "Giáo án 1");
    assert.equal(rows[0].price, 2_000_000);
    assert.equal(rows[0].requestedAt, "2026-10-27T03:00:00.000Z");
    assert.equal(rows[0].disputeReason, "Chưa nhận được bản nháp");
  });
  it("sorts oldest request first and puts rows with no date last (stable)", () => {
    const { rows } = normalizeServiceRefunds([
      order(1, { refundRequestedAt: "2026-10-27T03:00:00Z" }),
      order(2, { refundRequestedAt: null }),
      order(3, { refundRequestedAt: "2026-10-20T03:00:00Z" }),
      order(4, { refundRequestedAt: "not-a-date" }),
    ]);
    assert.deepEqual(rows.map((r) => r.title), ["Giáo án 3", "Giáo án 1", "Giáo án 2", "Giáo án 4"]);
  });
  it("drops non-REFUND_REQUESTED, id-less and non-object entries, and counts them", () => {
    const { rows, ignored, rawCount } = normalizeServiceRefunds([order(1), order(2, { status: "REFUNDED" }), { status: "REFUND_REQUESTED" }, null, "x", 7]);
    assert.equal(rows.length, 1);
    assert.equal(rawCount, 6);
    assert.equal(ignored, 5);
  });
  it("never invents a price: missing / string / NaN price → null (rendered as an em dash, never 0)", () => {
    for (const bad of [undefined, null, "2000000", Number.NaN]) {
      const { rows } = normalizeServiceRefunds([order(1, { priceAtPurchase: bad })]);
      assert.equal(rows[0].price, null, String(bad));
      assert.equal(moneyText(rows[0].price), "—");
    }
    const { rows } = normalizeServiceRefunds([order(1, { priceAtPurchase: 0 })]);
    assert.equal(rows[0].price, 0);
  });
  it("a blank dispute reason becomes null; a missing title gets a neutral label, not undefined", () => {
    const { rows } = normalizeServiceRefunds([order(1, { disputeReason: "   ", titleSnapshot: "" })]);
    assert.equal(rows[0].disputeReason, null);
    assert.equal(rows[0].title, "Dịch vụ cá nhân hoá");
  });
  it("non-array payloads (error body, null, object) give an empty list, not a crash", () => {
    for (const bad of [null, undefined, {}, "oops", 5]) {
      const r = normalizeServiceRefunds(bad);
      assert.deepEqual(r.rows, []);
      assert.equal(r.ignored, 0);
    }
  });
});

describe("B6a summarizeServiceRefunds", () => {
  it("count + oldest valid date; no money total exists on the summary", () => {
    const { rows } = normalizeServiceRefunds([
      order(1, { refundRequestedAt: "2026-10-27T03:00:00Z" }),
      order(2, { refundRequestedAt: "2026-10-22T09:00:00Z" }),
      order(3, { refundRequestedAt: null }),
    ]);
    const s = summarizeServiceRefunds(rows);
    assert.equal(s.count, 3);
    assert.equal(s.oldest, "2026-10-22T09:00:00Z");
    assert.deepEqual(Object.keys(s).sort(), ["count", "oldest"]);
  });
  it("empty → count 0, oldest null", () => {
    assert.deepEqual(summarizeServiceRefunds([]), { count: 0, oldest: null });
  });
  it("no valid dates → oldest null (not a made-up date)", () => {
    const { rows } = normalizeServiceRefunds([order(1, { refundRequestedAt: null })]);
    assert.equal(summarizeServiceRefunds(rows).oldest, null);
  });
});

describe("B6a isFinalRefund (dialog text 'lần hoàn cuối')", () => {
  it("true at/above the ceiling within the 0.005 tolerance, false below", () => {
    assert.equal(isFinalRefund(1_500_000, 1_500_000), true);
    assert.equal(isFinalRefund(1_499_999.996, 1_500_000), true);
    assert.equal(isFinalRefund(1_499_999, 1_500_000), false);
    assert.equal(isFinalRefund(1_000_000, 1_500_000), false);
  });
});

describe("B6a guards reused from B1 (E-10 and the membership id)", () => {
  it("refund > ceiling is blocked with the ceiling in the message; = ceiling and 1 đồng below pass", () => {
    const over = checkRefundAmount("1500001", 1_500_000);
    assert.equal(over.ok, false);
    assert.equal(over.ok === false && over.problem, "OVER_CEILING");
    assert.ok(over.ok === false && over.message?.includes("1.500.000"));
    assert.equal(checkRefundAmount("1500000", 1_500_000).ok, true);
    assert.equal(checkRefundAmount("1499999", 1_500_000).ok, true);
  });
  it("0, negative, blank, non-numeric and a missing/zero ceiling are blocked", () => {
    assert.equal(checkRefundAmount("0", 1_500_000).ok, false);
    assert.equal(checkRefundAmount("-5", 1_500_000).ok, false);
    assert.equal(checkRefundAmount("", 1_500_000).ok, false);
    assert.equal(checkRefundAmount("12abc", 1_500_000).ok, false);
    assert.equal(checkRefundAmount("100", undefined).ok, false);
    assert.equal(checkRefundAmount("100", 0).ok, false);
  });
  it("a membership id must be a full UUID; blank is silent, anything else carries a message", () => {
    assert.deepEqual(checkMembershipId(""), { ok: false, id: "", message: null });
    assert.equal(checkMembershipId("not-a-uuid").ok, false);
    assert.ok(checkMembershipId("not-a-uuid").message);
    const good = checkMembershipId("  123e4567-e89b-12d3-a456-426614174000 ");
    assert.equal(good.ok, true);
    assert.equal(good.id, "123e4567-e89b-12d3-a456-426614174000");
  });
  it("shortId shows the first 8 chars, an em dash when there is no id", () => {
    assert.equal(shortId("cccccccc-0000-4000-8000-000000000001"), "cccccccc");
    assert.equal(shortId(""), "—");
  });
});
