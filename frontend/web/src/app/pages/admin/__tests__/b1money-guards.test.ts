/**
 * B1-MONEY — phần thuần: ánh xạ lỗi admin → tiếng Việt, chặn số tiền hoàn vượt trần, kiểm tra UUID gói hội viên.
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/b1money-guards.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeAdminError, errorStateKind } from "../shared/useAdminError";
import { checkMembershipId, checkRefundAmount, hasText, isUuid, moneyText } from "../shared/moneyGuards";

const http = (status: number, data?: unknown) => ({ response: { status, data }, message: "Request failed" });

describe("describeAdminError", () => {
  it("never prints [object Object] for a structured / odd body", () => {
    const weird = [
      http(500, { error: { message: { nested: true } } }),
      http(400, { error: { code: { x: 1 }, message: ["a"] } }),
      http(400, { message: 42 }),
      new Error("boom"),
      {},
      null,
      undefined,
      "string error",
    ];
    for (const e of weird) {
      for (const action of ["read", "write"] as const) {
        const v = describeAdminError(e, { action });
        assert.ok(v.message.length > 0);
        assert.ok(!v.message.includes("[object Object]"), `got ${v.message}`);
      }
    }
  });

  it("maps 400 / 403 / 404 / 409 / 500 to Vietnamese", () => {
    assert.equal(describeAdminError(http(403)).kind, "forbidden");
    assert.match(describeAdminError(http(403)).message, /không có quyền/);
    assert.equal(describeAdminError(http(404)).kind, "not-found");
    assert.equal(describeAdminError(http(400, { success: false, error: { code: "WHATEVER", message: "bad input" } })).kind, "validation");
    assert.match(describeAdminError(http(400, { error: { code: "WHATEVER", message: "bad input" } })).message, /không hợp lệ/);
    assert.equal(describeAdminError(http(500)).kind, "server");
  });

  it("does not leak an English backend message, but keeps a Vietnamese one", () => {
    assert.ok(!describeAdminError(http(400, { error: { code: "X", message: "refundAmount must be a positive number" } })).message.includes("refundAmount"));
    assert.equal(describeAdminError(http(400, { error: "Lý do là bắt buộc" })).message, "Lý do là bắt buộc");
  });

  it("409 is stale (refetch) with a specific message", () => {
    const v = describeAdminError(http(409, { success: false, error: { code: "PERSONALIZED_SERVICE_REFUND_INVALID_STATE", message: "Order is not awaiting" } }));
    assert.equal(v.stale, true);
    assert.equal(v.ambiguous, false);
    assert.match(v.message, /không còn chờ hoàn tiền/);
    const generic = describeAdminError(http(409, {}));
    assert.equal(generic.stale, true);
    assert.match(generic.message, /đã được người khác xử lý/);
  });

  it("withdrawal INVALID_STATUS (400) and ALREADY_PAID mean the queue is stale", () => {
    assert.equal(describeAdminError(http(400, { success: false, error: { code: "INVALID_STATUS" } })).stale, true);
    assert.equal(describeAdminError(http(400, { success: false, error: { code: "ALREADY_PAID" } })).stale, true);
    assert.equal(describeAdminError(http(400, { success: false, error: { code: "REASON_REQUIRED" } })).stale, false);
  });

  it("a write with no response / 5xx is ambiguous (never auto-retry); a read is not", () => {
    const net = describeAdminError({ message: "Network Error" }, { action: "write" });
    assert.equal(net.kind, "network");
    assert.equal(net.ambiguous, true);
    assert.match(net.message, /Chưa xác nhận được kết quả/);
    assert.equal(describeAdminError({ message: "Network Error" }, { action: "read" }).ambiguous, false);
    const srv = describeAdminError(http(500, { success: false, error: { code: "INTERNAL_ERROR" } }), { action: "write", serverHint: "Có thể ví không đủ số dư." });
    assert.equal(srv.ambiguous, true);
    assert.match(srv.message, /Có thể ví không đủ số dư\./);
    assert.equal(describeAdminError(http(500), { action: "read" }).ambiguous, false);
  });

  it("translates gym-service membership refund errors (English message used as code)", () => {
    assert.match(describeAdminError(http(404, { success: false, error: { code: "Membership not found", message: "Membership not found" } })).message, /Không tìm thấy gói hội viên/);
    assert.match(describeAdminError(http(409, { error: { code: "Membership has already expired" } })).message, /hết hạn/);
    assert.match(describeAdminError(http(409, { error: { code: "No payment on record to refund" } })).message, /không có giao dịch thanh toán/);
    const cancelled = describeAdminError(http(409, { error: { code: "Cannot refund a membership in CANCELLED status" } }));
    assert.match(cancelled.message, /đã huỷ/);
    assert.ok(!/Cannot refund/.test(cancelled.message));
    assert.match(describeAdminError(http(400, { error: { code: "INVALID_REFUND_REASON" } })).message, /Lý do hoàn tiền không hợp lệ/);
  });

  it("errorStateKind maps to ErrorState kinds", () => {
    assert.equal(errorStateKind(describeAdminError({ message: "Network Error" })), "network");
    assert.equal(errorStateKind(describeAdminError(http(403))), "forbidden");
    assert.equal(errorStateKind(describeAdminError(http(500))), "server");
    assert.equal(errorStateKind(describeAdminError(http(400))), "generic");
  });
});

describe("checkRefundAmount (E-10: block > refundableCeiling)", () => {
  it("accepts an amount within (0, ceiling]", () => {
    for (const raw of ["1", "50000", "100000", "99999.99", " 250000 "]) {
      assert.deepEqual(checkRefundAmount(raw, 250000).ok, true, raw);
    }
    const ok = checkRefundAmount("100000", 100000);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.amount, 100000);
  });

  it("blocks above the ceiling, with the ceiling in the message", () => {
    const r = checkRefundAmount("100001", 100000);
    assert.equal(r.ok, false);
    assert.equal(r.problem, "OVER_CEILING");
    assert.match(r.message ?? "", /vượt mức còn có thể hoàn/);
    assert.match(r.message ?? "", /100\.000/);
  });

  it("blocks zero, negative, non-numeric and empty (empty has no message yet)", () => {
    assert.equal(checkRefundAmount("0", 100).problem, "NOT_POSITIVE");
    assert.equal(checkRefundAmount("-5", 100).problem, "INVALID");
    assert.equal(checkRefundAmount("abc", 100).problem, "INVALID");
    assert.equal(checkRefundAmount("1e3", 100).problem, "INVALID");
    assert.equal(checkRefundAmount("1,5", 100).problem, "INVALID");
    assert.equal(checkRefundAmount("1.234", 100).problem, "INVALID");
    const empty = checkRefundAmount("  ", 100);
    assert.equal(empty.ok, false);
    assert.equal(empty.problem, "EMPTY");
    assert.equal(empty.message, null);
  });

  it("blocks everything when there is no refundable amount left", () => {
    for (const ceiling of [0, -1, undefined, null, NaN]) {
      assert.equal(checkRefundAmount("10", ceiling as any).problem, "NO_CEILING");
    }
  });
});

describe("membership id / text guards", () => {
  it("requires a full UUID", () => {
    assert.equal(isUuid("123e4567-e89b-12d3-a456-426614174000"), true);
    assert.equal(isUuid("  123E4567-E89B-12D3-A456-426614174000  "), true);
    assert.equal(isUuid("123e4567"), false);
    assert.equal(isUuid("123e4567-e89b-12d3-a456-42661417400g"), false);
    const good = checkMembershipId("  123e4567-e89b-12d3-a456-426614174000 ");
    assert.deepEqual(good, { ok: true, id: "123e4567-e89b-12d3-a456-426614174000", message: null });
    const bad = checkMembershipId("abc");
    assert.equal(bad.ok, false);
    assert.match((bad as any).message, /UUID/);
    assert.equal((checkMembershipId("") as any).message, null);
  });

  it("hasText ignores whitespace-only input (bank reference, note, reason)", () => {
    assert.equal(hasText("   \n"), false);
    assert.equal(hasText(" VCB-1 "), true);
  });

  it("moneyText shows — instead of 0 / Liên hệ for missing numbers", () => {
    assert.equal(moneyText(null), "—");
    assert.equal(moneyText(undefined), "—");
    assert.equal(moneyText("abc"), "—");
    assert.match(moneyText("1500000.00"), /1\.500\.000/);
    assert.match(moneyText(0), /0/);
  });
});
