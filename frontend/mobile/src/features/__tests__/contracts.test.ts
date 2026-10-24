/**
 * The client's side of a PT contract. Shapes are real: the contract row and the money breakdown
 * below were both taken from the running gateway on 2026-09-17.
 *
 * Runs with: npx tsx --test src/features/__tests__/contracts.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CLIENT_TERMINATION_CHOICES,
  contractStatus,
  contractStatusFor,
  endActionFor,
  isOpen,
  normalizeContract,
  normalizeContracts,
  normalizeMoneyBreakdown,
  sessionProgress,
  sessionsConsumed,
  sessionsLeft,
  type ContractRow,
} from "../services/contracts";

const RAW_CONTRACT = {
  id: "021e8614-43aa-4b5a-b0b0-3ee39ee88a35",
  ptUserId: "f506697b-32d5-4d22-9bdc-728de4f8bacf",
  clientUserId: "68aca044-a454-4434-9206-c8a43702f664",
  status: "PENDING_REVIEW",
  packageType: "PACKAGE",
  packageName: "Gói 10 buổi tăng cơ",
  sessionMode: "OFFLINE",
  totalSessions: 10,
  usedSessions: 0,
  price: "3000000",
  gymId: "d8b5d3b7-d54d-4420-989b-4d7b188043ff",
  source: "GYM",
  paymentTransactionId: null,
  createdAt: "2026-09-17T10:23:00.000Z",
  ptProfile: { firstName: "E2E", lastName: "Trainer", email: "pt@example.com" },
};

// Shape of GET /contracts/:id/money-breakdown for a CLIENT (the server drops rates / released / stillPending / actuallyReleased).
const RAW_BREAKDOWN = {
  price: "9000000.00",
  totalSessions: 30,
  usedSessions: 0,
  compensatedSessions: 0,
  unit: "300000.00",
  remaining: "9000000.00",
  refundIfCancelledNow: "8100000.00",
  reasonUsed: "CLIENT_CANCELLED",
  contractId: "6db9017a-5b41-40a0-a60d-5d0ad2de20ce",
  paid: true,
  paidTotal: "9000000.00",
  refundedSessionsValue: "0.00",
  canExitWithoutPenalty: false,
  exitReasonIfCancelledNow: "CLIENT_CANCELLED",
};

describe("normalizeContract", () => {
  it("reads a real row, trainer name included", () => {
    const contract = normalizeContract(RAW_CONTRACT);
    assert.equal(contract.id, RAW_CONTRACT.id);
    assert.equal(contract.ptName, "E2E Trainer");
    assert.equal(contract.price, 3000000);
    assert.equal(typeof contract.price, "number");
    assert.equal(contract.totalSessions, 10);
    assert.equal(contract.paid, false);
  });

  it("knows a contract is paid from its transaction, not from its status", () => {
    assert.equal(normalizeContract({ ...RAW_CONTRACT, paymentTransactionId: "tx-1" }).paid, true);
  });

  it("falls back to a generic trainer name rather than rendering blank", () => {
    assert.equal(normalizeContract({ id: "c", status: "ACTIVE" }).ptName, "Huấn luyện viên");
  });

  it("sorts newest first and drops rows with no id", () => {
    const rows = normalizeContracts([
      { ...RAW_CONTRACT, id: "old", createdAt: "2026-01-01T00:00:00.000Z" },
      { ...RAW_CONTRACT, id: "new", createdAt: "2026-09-17T00:00:00.000Z" },
      { status: "ACTIVE" },
    ]);
    assert.deepEqual(rows.map((c) => c.id), ["new", "old"]);
  });
});

describe("statuses", () => {
  it("names all eight the backend can produce", () => {
    for (const status of [
      "PENDING_REVIEW",
      "PENDING_SIGNATURE",
      "PENDING_PAYMENT",
      "ACTIVE",
      "COMPLETED",
      "EXPIRED",
      "CANCELLED",
      "REJECTED",
    ]) {
      assert.notEqual(contractStatus(status).label, status, `${status} chưa có nhãn tiếng Việt`);
    }
  });

  it("labels a CANCELLED contract by what really happened (B38)", () => {
    const at = (extra: Record<string, unknown>) => normalizeContract({ ...RAW_CONTRACT, status: "CANCELLED", ...extra });
    // Withdrawn before any payment.
    assert.equal(contractStatusFor(at({ cancelledBy: RAW_CONTRACT.clientUserId, cancellationReason: "Khách rút yêu cầu" })).label, "Đã huỷ");
    // The payment-deadline sweep.
    assert.equal(
      contractStatusFor(at({ cancelledBy: "SYSTEM", cancellationReason: "Quá hạn thanh toán 24 giờ kể từ khi PT chấp nhận" })).label,
      "Hết hạn thanh toán",
    );
    // Ran, then ended: paid, or ended with a termination reason.
    assert.equal(contractStatusFor(at({ paymentTransactionId: "tx-1", cancelledBy: "SYSTEM" })).label, "Đã chấm dứt");
    assert.equal(contractStatusFor(at({ terminationReason: "CLIENT_CANCELLED" })).label, "Đã chấm dứt");
    // A wished start date alone does not make it an ended contract.
    assert.equal(contractStatusFor(at({ startDate: "2026-11-01T00:00:00.000Z" })).label, "Đã huỷ");
    // Other statuses are untouched; a rejected request reads "Bị từ chối".
    assert.equal(contractStatusFor(normalizeContract({ ...RAW_CONTRACT, status: "REJECTED" })).label, "Bị từ chối");
    assert.equal(contractStatusFor(normalizeContract({ ...RAW_CONTRACT, status: "ACTIVE" })).label, "Đang hiệu lực");
  });

  it("shows an unknown status as itself instead of inventing one", () => {
    assert.equal(contractStatus("SOMETHING_NEW").label, "SOMETHING_NEW");
  });

  it("counts only the four live statuses as open", () => {
    const at = (status: string): ContractRow => normalizeContract({ ...RAW_CONTRACT, status });
    assert.equal(isOpen(at("PENDING_REVIEW")), true);
    assert.equal(isOpen(at("ACTIVE")), true);
    assert.equal(isOpen(at("CANCELLED")), false);
    assert.equal(isOpen(at("REJECTED")), false);
  });
});

describe("which endpoint ends a contract", () => {
  const at = (status: string): ContractRow => normalizeContract({ ...RAW_CONTRACT, status });

  it("withdraws before money settles, terminates after — they are not the same call", () => {
    assert.equal(endActionFor(at("PENDING_REVIEW")), "withdraw");
    assert.equal(endActionFor(at("PENDING_PAYMENT")), "withdraw");
    assert.equal(endActionFor(at("ACTIVE")), "terminate");
  });

  it("offers nothing on a contract that is already history", () => {
    assert.equal(endActionFor(at("CANCELLED")), null);
    assert.equal(endActionFor(at("COMPLETED")), null);
    assert.equal(endActionFor(at("REJECTED")), null);
  });

  it("offers a client exactly the two reasons the server would accept from them", () => {
    assert.deepEqual(
      CLIENT_TERMINATION_CHOICES.map((c) => c.reason),
      ["CLIENT_CANCELLED", "PT_REPEATED_NO_SHOW"],
    );
    // PT_CANCELLED / PT_BANNED / MUTUAL / EXPIRED / COMPLETED are 403 for a client, so they must
    // not appear in the sheet at all.
    const offered = CLIENT_TERMINATION_CHOICES.map((c) => String(c.reason));
    for (const forbidden of ["PT_CANCELLED", "PT_BANNED", "MUTUAL", "EXPIRED", "COMPLETED"]) {
      assert.equal(offered.includes(forbidden), false);
    }
  });
});

describe("session counts", () => {
  it("counts what is left and how far along the package is", () => {
    const contract = normalizeContract({ ...RAW_CONTRACT, totalSessions: 10, usedSessions: 4 });
    assert.equal(sessionsLeft(contract), 6);
    assert.equal(sessionProgress(contract), 0.4);
  });

  it("DQ-2(a): a refunded PT no-show is consumed - 4-session contract, 1 refunded, 3 left", () => {
    const contract = normalizeContract({ ...RAW_CONTRACT, totalSessions: 4, usedSessions: 0, compensatedSessions: 1 });
    assert.equal(sessionsLeft(contract), 3);
    assert.equal(sessionsConsumed(contract), 1);
    assert.equal(sessionProgress(contract), 0.25);
    const mixed = normalizeContract({ ...RAW_CONTRACT, totalSessions: 4, usedSessions: 2, compensatedSessions: 1 });
    assert.equal(sessionsLeft(mixed), 1);
  });

  it("an older response without compensatedSessions counts as 0", () => {
    const contract = normalizeContract({ ...RAW_CONTRACT, totalSessions: 4, usedSessions: 1 });
    assert.equal(contract.compensatedSessions, 0);
    assert.equal(sessionsLeft(contract), 3);
  });

  it("never goes negative or past full, and never divides by zero", () => {
    assert.equal(sessionsLeft(normalizeContract({ ...RAW_CONTRACT, totalSessions: 2, usedSessions: 5 })), 0);
    assert.equal(sessionProgress(normalizeContract({ ...RAW_CONTRACT, totalSessions: 2, usedSessions: 5 })), 1);
    assert.equal(sessionProgress(normalizeContract({ ...RAW_CONTRACT, totalSessions: 0 })), 0);
  });
});

describe("normalizeMoneyBreakdown", () => {
  it("reads the real field names, all of them strings", () => {
    const money = normalizeMoneyBreakdown(RAW_BREAKDOWN)!;
    assert.equal(money.refundIfCancelledNow, 8100000);
    assert.equal(money.unit, 300000);
    assert.equal(money.paid, true);
  });

  it("reads the client aggregates: what was paid, what was refunded for missed sessions, what is left", () => {
    const money = normalizeMoneyBreakdown({ ...RAW_BREAKDOWN, compensatedSessions: 1, refundedSessionsValue: "300000.00" })!;
    assert.equal(money.paidTotal, 9000000);
    assert.equal(money.refundedSessionsValue, 300000);
    assert.equal(money.remaining, 9000000);
  });

  it("exposes no per-party (trainer / gym / platform) figure at all, even if an older server still sends them", () => {
    const money = normalizeMoneyBreakdown({
      ...RAW_BREAKDOWN,
      rates: { ptRate: "0.9" },
      stillPending: { pt: "8100000.00" },
      actuallyReleased: { pt: "1.00" },
    })! as Record<string, unknown>;
    assert.deepEqual(Object.keys(money).filter((k) => /pt|gym|platform|rate/i.test(k)), []);
  });

  it("returns null rather than a screen full of zeros when there is nothing to show", () => {
    assert.equal(normalizeMoneyBreakdown(null), null);
  });
});
