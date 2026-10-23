/**
 * FH-9 - câu chữ và số hiển thị "Tiền theo từng hợp đồng" của PT. Phần thuần, không cần trình duyệt.
 * Hình dạng dữ liệu lấy từ phản hồi THẬT của GET /me/pt-wallet/contracts (xem fh9-pt-holdback.integration.test.ts của payment-service).
 *
 * Chạy: npx tsx --test src/app/pages/pt/__tests__/ptWalletContracts.utils.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  HOLDBACK_RELEASE_CONDITION,
  contractTitle,
  earnedPercent,
  holdbackBadge,
  holdbackNote,
  type PtWalletContractRow,
} from "../ptWalletContracts.utils";

const row = (over: Partial<PtWalletContractRow> & { release?: Partial<PtWalletContractRow["release"]> } = {}): PtWalletContractRow => ({
  contractId: "6f1c2d3e-0000-4000-8000-00000000abcd",
  transactionId: "tx-1",
  paidAt: "2026-10-01T00:00:00.000Z",
  contractValue: "1000000.00",
  expectedIncome: "900000.00",
  holdbackTarget: "90000.00",
  pending: "720000.00",
  earned: "180000.00",
  held: "90000.00",
  availableFromContract: "90000.00",
  compensationPaid: "0.00",
  ...over,
  release: { state: "RUNNING", ended: false, heldDueToDispute: false, undecidedSessions: 0, openObligations: "0.00", reserved: "0.00", pendingFaultReview: false, reviewBy: null, reviewOverdue: false, ...(over.release ?? {}) },
});

describe("holdbackNote", () => {
  it("running contract with money held: the owner's sentence, no date", () => {
    const n = holdbackNote(row());
    assert.equal(n, "Sẽ trả lại khi hợp đồng kết thúc và đối soát hoàn tất");
    assert.equal(n, HOLDBACK_RELEASE_CONDITION);
    assert.doesNotMatch(String(n), /\d{1,2}\/\d{1,2}|\d{4}|ngày/, "never a fixed date");
  });
  it("running contract that will hold but has not yet: says so, still no date", () => {
    const n = holdbackNote(row({ held: "0.00" }));
    assert.match(String(n), /các buổi đầu sẽ được tạm giữ/);
    assert.match(String(n), /đối soát hoàn tất/);
  });
  it("a contract without a holdback shows no note at all", () => {
    assert.equal(holdbackNote(row({ holdbackTarget: "0.00", held: "0.00", release: { state: "NO_HOLDBACK" } })), null);
  });
  it("ended but waiting on the contract's own items: names the reasons in plain words", () => {
    const n = holdbackNote(row({ release: { state: "WAITING_RECONCILIATION", ended: true, heldDueToDispute: true, undecidedSessions: 2, openObligations: "50000.00" } }));
    assert.match(String(n), /2 buổi chưa được chốt/);
    assert.match(String(n), /một khoản của chính hợp đồng này chưa được xử lý xong/);
    assert.doesNotMatch(String(n), /OBLIGATION|OPEN|UNRESOLVED/i, "no internal terms");
  });
  it("a potential PT-fault amount waits for an admin: says nothing is paid before it is verified, with the review-by date", () => {
    const n = String(holdbackNote(row({ release: { state: "WAITING_RECONCILIATION", ended: true, heldDueToDispute: true, pendingFaultReview: true, reserved: "70000.00", reviewBy: "2026-11-05T00:00:00.000Z" } })));
    assert.match(n, /70\.000/);
    assert.match(n, /chỉ dùng bồi thường cho khách nếu được xác minh là lỗi của bạn/);
    assert.match(n, /Hạn xem xét/);
    assert.doesNotMatch(n, /FAULT|REVIEW|UNCOMPUTABLE/, "no internal terms");
  });
  it("released: tells the PT it is back", () => {
    assert.match(String(holdbackNote(row({ held: "0.00", release: { state: "RELEASED", ended: true } }))), /đã được trả lại/);
  });
});

describe("holdbackBadge", () => {
  it("dispute wins over plain holding", () => {
    assert.deepEqual(holdbackBadge(row({ release: { state: "WAITING_RECONCILIATION", ended: true, heldDueToDispute: true } })), { label: "Tạm giữ do tranh chấp / đối soát", tone: "warn" });
  });
  it("held, released, none", () => {
    assert.equal(holdbackBadge(row())?.label, "Đang tạm giữ");
    assert.equal(holdbackBadge(row({ held: "0.00", release: { state: "RELEASED", ended: true } }))?.label, "Đã trả lại");
    assert.equal(holdbackBadge(row({ held: "0.00", release: { state: "NO_HOLDBACK" } })), null);
  });
});

describe("numbers", () => {
  it("earnedPercent is earned / expected income, clamped to 0..100", () => {
    assert.equal(earnedPercent(row()), 20);
    assert.equal(earnedPercent(row({ earned: "900000.00" })), 100);
    assert.equal(earnedPercent(row({ earned: "999999999.00" })), 100);
    assert.equal(earnedPercent(row({ expectedIncome: "0.00" })), 0);
  });
  it("the cards never show a raw id as the title when the package name is known", () => {
    assert.equal(contractTitle(row(), "Gói 10 buổi"), "Gói 10 buổi");
    assert.equal(contractTitle(row(), null), "Hợp đồng …00abcd", "only a short reference, never the whole id");
  });
});
