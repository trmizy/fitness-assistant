/**
 * Ví chi nhánh: "Có thể rút", tài khoản nhận tiền đã đăng ký, lỗi 409 PAYOUT_ACCOUNT_REQUIRED, lý do từ chối.
 * Phản chiếu web `utils/gymWithdrawal.ts`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PAYOUT_ACCOUNT_REQUIRED_MESSAGE,
  gymWithdrawFormError,
  gymWithdrawalErrorMessage,
  maskAccountNumber,
  payoutAccountState,
  registeredPayoutText,
  rejectionReasonLine,
  reservedPendingOf,
  withdrawCeiling,
  withdrawableOf,
} from "../gymOwner/gymWithdrawal";

describe("withdrawableOf / reservedPendingOf", () => {
  it("dùng `withdrawable` của máy chủ, không dùng availableBalance", () => {
    assert.equal(withdrawableOf({ availableBalance: "1000", withdrawable: "700" }), 700);
    assert.equal(withdrawableOf({ availableBalance: "1000", withdrawable: 0 }), 0); // 0 là số thật, không phải "thiếu"
    assert.equal(withdrawableOf({ availableBalance: "1000", withdrawable: -5 }), 0);
  });
  it("máy chủ cũ không gửi `withdrawable` thì lùi về availableBalance", () => {
    assert.equal(withdrawableOf({ availableBalance: "1000" }), 1000);
    assert.equal(withdrawableOf({ availableBalance: "1000", withdrawable: null }), 1000);
    assert.equal(withdrawableOf({ availableBalance: "1000", withdrawable: "" }), 1000);
  });
  it("ví không có hoặc số rác thì 0", () => {
    assert.equal(withdrawableOf(null), 0);
    assert.equal(withdrawableOf(undefined), 0);
    assert.equal(withdrawableOf({ availableBalance: "abc" }), 0);
    assert.equal(reservedPendingOf(null), 0);
    assert.equal(reservedPendingOf({ reservedPending: "250" }), 250);
    assert.equal(reservedPendingOf({}), 0);
  });
});

describe("withdrawCeiling", () => {
  it("có withdrawable thì dùng thẳng, KHÔNG trừ yêu cầu PENDING lần nữa", () => {
    assert.equal(withdrawCeiling({ availableBalance: "1000", withdrawable: "700" }, [{ id: "w", amount: "300", status: "PENDING" }]), 700);
  });
  it("máy chủ cũ thì availableBalance trừ tổng PENDING (hành vi trước đây)", () => {
    assert.equal(withdrawCeiling({ availableBalance: "1000" }, [{ id: "a", amount: "300", status: "PENDING" }, { id: "b", amount: "50", status: "APPROVED" }]), 700);
    assert.equal(withdrawCeiling({ availableBalance: "100" }, { data: [{ id: "a", amount: "500", status: "PENDING" }] }), 0);
    assert.equal(withdrawCeiling(null, []), 0);
  });
});

describe("registeredPayoutText / payoutAccountState", () => {
  const full = { bankName: " MB ", accountNumber: "0123456789", accountHolder: "NGUYEN VAN A" };
  it("ghép đủ ba trường; thiếu một trường (hoặc chỉ khoảng trắng) thì rỗng", () => {
    assert.equal(registeredPayoutText(full), "MB — 0123456789 — NGUYEN VAN A");
    assert.equal(registeredPayoutText({ ...full, accountHolder: "" }), "");
    assert.equal(registeredPayoutText({ ...full, bankName: "  " }), "");
    assert.equal(registeredPayoutText({ bankName: "MB", accountNumber: null, accountHolder: null }), "");
    assert.equal(registeredPayoutText(null), "");
  });
  it("trạng thái: registered / missing (chủ chưa khai) / unknown (không có payout: vai trò khác, đang tải, lỗi)", () => {
    assert.equal(payoutAccountState({ role: "OWNER", payout: full }), "registered");
    assert.equal(payoutAccountState({ role: "OWNER", payout: { bankName: null, accountNumber: null, accountHolder: null } }), "missing");
    assert.equal(payoutAccountState({ role: "OWNER", payout: { bankName: "MB" } }), "missing");
    assert.equal(payoutAccountState({ role: "MANAGER", payout: null }), "unknown");
    assert.equal(payoutAccountState({ role: "OWNER" }), "unknown");
    assert.equal(payoutAccountState(undefined), "unknown");
  });
  it("che số tài khoản", () => {
    assert.equal(maskAccountNumber("0123456789"), "•••••• 6789");
    assert.equal(maskAccountNumber("1234"), "1234");
  });
});

describe("gymWithdrawFormError (không còn ô nhập tài khoản)", () => {
  it("số tiền hợp lệ và tài khoản đã đăng ký thì gửi được", () => {
    assert.equal(gymWithdrawFormError("500000", 1_000_000, "registered"), null);
  });
  it("số tiền sai hoặc vượt trần", () => {
    assert.match(gymWithdrawFormError("", 1000, "registered")!, /Nhập số tiền/);
    assert.match(gymWithdrawFormError("0", 1000, "registered")!, /Nhập số tiền/);
    assert.match(gymWithdrawFormError("2000", 1000, "registered")!, /vượt quá/);
  });
  it("chưa có tài khoản đã đăng ký (missing) hoặc chưa biết (unknown) thì KHOÁ nút gửi", () => {
    assert.match(gymWithdrawFormError("500", 1000, "missing")!, /khai báo tài khoản nhận tiền/);
    assert.match(gymWithdrawFormError("500", 1000, "unknown")!, /Chưa xác định/);
  });
});

describe("gymWithdrawalErrorMessage", () => {
  it("409 PAYOUT_ACCOUNT_REQUIRED có câu tiếng Việt riêng", () => {
    const e = { response: { status: 409, data: { success: false, error: { code: "PAYOUT_ACCOUNT_REQUIRED", message: "english raw" } } } };
    assert.equal(gymWithdrawalErrorMessage(e), PAYOUT_ACCOUNT_REQUIRED_MESSAGE);
    assert.match(PAYOUT_ACCOUNT_REQUIRED_MESSAGE, /tài khoản nhận tiền/);
  });
  it("lỗi khác dùng thông điệp của máy chủ; không có gì thì câu mặc định", () => {
    assert.equal(gymWithdrawalErrorMessage({ response: { status: 400, data: { error: { code: "EXCEEDS_WITHDRAWABLE_BALANCE", message: "Vượt số dư" } } } }), "Vượt số dư");
    assert.equal(gymWithdrawalErrorMessage(new Error("Network Error")), "Không gửi được yêu cầu rút tiền");
    // 409 với mã khác không bị nhầm thành PAYOUT_ACCOUNT_REQUIRED
    assert.equal(gymWithdrawalErrorMessage({ response: { status: 409, data: { error: { code: "OTHER", message: "x" } } } }), "x");
  });
});

describe("rejectionReasonLine", () => {
  it("chỉ cho yêu cầu REJECTED; có lý do thì hiện, không có thì câu mặc định", () => {
    assert.equal(rejectionReasonLine({ status: "REJECTED", rejectionReason: " Sai tên chủ TK " }), "Lý do từ chối: Sai tên chủ TK");
    assert.equal(rejectionReasonLine({ status: "REJECTED", rejectionReason: null }), "Lý do từ chối: Quản trị viên không ghi lý do.");
    assert.equal(rejectionReasonLine({ status: "REJECTED", rejectionReason: "   " }), "Lý do từ chối: Quản trị viên không ghi lý do.");
    assert.equal(rejectionReasonLine({ status: "PENDING", rejectionReason: "x" }), null);
    assert.equal(rejectionReasonLine({ status: "PAID" }), null);
    assert.equal(rejectionReasonLine(null), null);
  });
});
