/**
 * G-13 — mã lỗi ổn định của payment-service → tiếng Việt trên màn admin (phần thuần).
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/g13-admin-error-codes.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ADMIN_ERROR_CODES, describeAdminError } from "../shared/useAdminError";

const http = (status: number, data?: unknown) => ({ response: { status, data }, message: "Request failed" });
const envelope = (status: number, code: string, message = "raw English message") =>
  http(status, { success: false, error: { code, message } });
// BE-1 / G-06..G-09 shape: { error: "<vi text>", code }
const flat = (status: number, code: string) => http(status, { error: "raw English message", code });

describe("G-13 withdrawal write codes", () => {
  it("409 INSUFFICIENT_BALANCE -> Vietnamese, stale (list reloaded), not ambiguous", () => {
    const v = describeAdminError(envelope(409, "INSUFFICIENT_BALANCE", "Insufficient balance in wallet abc"), { action: "write" });
    assert.equal(v.kind, "conflict");
    assert.equal(v.code, "INSUFFICIENT_BALANCE");
    assert.equal(v.stale, true);
    assert.equal(v.ambiguous, false);
    assert.equal(v.message, "Số dư khả dụng của ví không đủ — yêu cầu cần xem lại. Danh sách đã được tải lại.");
    assert.ok(!/Insufficient|abc/.test(v.message));
  });

  it("409 WALLET_NOT_ACTIVE -> Vietnamese, stale", () => {
    const v = describeAdminError(envelope(409, "WALLET_NOT_ACTIVE", "Wallet abc is not ACTIVE"), { action: "write" });
    assert.equal(v.stale, true);
    assert.equal(v.ambiguous, false);
    assert.match(v.message, /không hoạt động/);
    assert.ok(!/ACTIVE/.test(v.message));
  });

  it("500 INTERNAL_ERROR: a write is ambiguous (re-read before retrying) and keeps the serverHint; a read is not", () => {
    const w = describeAdminError(envelope(500, "INTERNAL_ERROR"), { action: "write", serverHint: "Có thể ví không đủ số dư." });
    assert.equal(w.ambiguous, true);
    assert.equal(w.stale, false);
    assert.match(w.message, /Chưa xác nhận được kết quả/);
    assert.match(w.message, /Có thể ví không đủ số dư\./);
    const r = describeAdminError(envelope(500, "INTERNAL_ERROR"), { action: "read" });
    assert.equal(r.ambiguous, false);
    assert.ok(r.message.length > 0 && !/raw English/.test(r.message));
  });

  it("state conflicts now arrive as 409 with the same codes and are still stale", () => {
    for (const code of ["INVALID_STATUS", "ALREADY_PAID", "FOUR_EYES_REQUIRED"]) {
      const v = describeAdminError(envelope(409, code), { action: "write" });
      assert.equal(v.stale, true, code);
      assert.equal(v.ambiguous, false, code);
      assert.equal(v.message, ADMIN_ERROR_CODES[code].message, code);
    }
  });
});

describe("G-13 finance screen codes", () => {
  const cases: Array<[number, string, RegExp]> = [
    [400, "INVALID_QUERY", /Bộ lọc không hợp lệ/],
    [400, "INVALID_ID", /Mã không hợp lệ/],
    [404, "TRANSACTION_NOT_FOUND", /Không tìm thấy giao dịch/],
    [404, "WALLET_NOT_FOUND", /Không tìm thấy ví/],
    [429, "RECONCILIATION_RUN_TOO_SOON", /đợi ít giây/],
    [500, "RECONCILIATION_FAILED", /đối soát sổ ví/],
    [500, "VNPAY_L3_FAILED", /VNPay/],
    [500, "WITHDRAWAL_HISTORY_FAILED", /lịch sử rút tiền/],
    [500, "TRANSACTIONS_LIST_FAILED", /danh sách giao dịch/],
    [500, "TRANSACTION_DETAIL_FAILED", /chi tiết giao dịch/],
    [500, "WALLETS_LIST_FAILED", /danh sách ví/],
    [500, "WALLET_DETAIL_FAILED", /chi tiết ví/],
    [500, "RECONCILIATION_RUNS_FAILED", /lịch sử đối soát/],
    [500, "GATEWAY_RECONCILIATION_FAILED", /đối chiếu cổng/],
    [500, "OBLIGATIONS_REPORT_FAILED", /báo cáo nghĩa vụ/],
  ];

  for (const [status, code, re] of cases) {
    it(`${status} ${code} -> specific Vietnamese message (both body shapes, no raw English)`, () => {
      for (const err of [envelope(status, code), flat(status, code)]) {
        const v = describeAdminError(err, { action: "read" });
        assert.equal(v.code, code);
        assert.match(v.message, re);
        assert.ok(!/raw English/.test(v.message));
        assert.equal(v.ambiguous, false);
      }
    });
  }

  it("RECONCILIATION_FAILED on the POST (write) is ambiguous: the run may have been recorded", () => {
    const v = describeAdminError(flat(500, "RECONCILIATION_FAILED"), { action: "write" });
    assert.equal(v.ambiguous, true);
    assert.match(v.message, /tải lại lịch sử đối soát/);
  });

  it("no payment-service admin code ever prints [object Object] or an empty message", () => {
    for (const code of Object.keys(ADMIN_ERROR_CODES)) {
      assert.ok(ADMIN_ERROR_CODES[code].message.length > 0);
      assert.ok(!ADMIN_ERROR_CODES[code].message.includes("[object Object]"));
    }
  });
});
