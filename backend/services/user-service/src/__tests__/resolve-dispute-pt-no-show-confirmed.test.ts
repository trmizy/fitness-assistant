import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SessionStatus } from "../generated/prisma";
import { bookingService } from "../services/booking.service";
import { sessionRepository } from "../repositories/session.repository";
import { contractRepository } from "../repositories/contract.repository";
import { contractService } from "../services/contract.service";
import { notificationService } from "../services/notification.service";
import { paymentClient } from "../clients/payment.client";
import { stubPtRestrictionReads } from "./pt-restriction-reads.stub";
import { stubSessionSettlements } from "./session-settlement-memory.stub";
import { prisma } from "../repositories/profile.repository";

// pt-restriction.service reads the restriction tables directly: answer them like an empty database (no restriction) so this unit test needs no DB.
stubPtRestrictionReads();
// the money steps track their progress in session_settlements: keep that table in memory too (no DB writes from a unit test).
stubSessionSettlements();

/**
 * Cụm B5 — resolveDispute chỉ có hai kết quả (COMPLETED/CANCELLED), thiếu kết quả "xác nhận
 * PT vắng mặt" cho các tranh chấp đến từ respondToNoShowReport's DENY (khách báo PT vắng mặt,
 * PT phủ nhận, quản trị viên phân xử).
 *
 * Trước khi vá: nếu quản trị viên xác định PT thực sự vắng mặt, lựa chọn gần nhất là
 * CANCELLED — huỷ buổi, không trừ quota, NHƯNG cũng KHÔNG bồi thường khách. Khách bị PT bỏ lỡ
 * buổi tập và không được đồng nào, trong khi nếu PT tự nhận vắng mặt (markNoShow) thì khách
 * luôn được bồi thường. Cùng một sự thật (PT vắng mặt) nhưng hai kết cục tiền khác nhau tuỳ
 * đường đi tới nó — đúng lỗ hổng cụm B5 mô tả.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function contractFixture(id: string) {
  return {
    id,
    paymentTransactionId: "txn-1",
    price: { toString: () => "1000000" } as any,
    totalSessions: 10,
    usedSessions: 3,
    compensatedSessions: 0,
    notes: null,
    platformRate: { toString: () => "0.10" },
    ptRate: { toString: () => "0.90" },
    gymRate: { toString: () => "0" },
    ptUserId: "pt-1",
    gymId: null,
    clientUserId: "client-1",
    status: "ACTIVE", // F2/F3: a running contract -> the ordinary compensation path
  };
}

test("resolveDispute chấp nhận PT_NO_SHOW_CONFIRMED — bồi thường khách, không trừ quota, đúng như markNoShow tự nhận", async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const contract = contractFixture(contractId);
  const session = {
    id: sessionId,
    contractId,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.DISPUTED,
  };
  const calls: string[] = [];

  const restores = [
    // B-1 release gate (D-NEW-12): the ruling core reads the contract's policy-eligibility review. Like the contract / session tables, that table is empty in this unit test, so the read is
    // answered in memory (TEST FIXTURE: an approved ELIGIBLE_CURRENT_POLICY review). The guard itself is proved in dispute-policy-eligibility.integration.test.ts.
    patch((prisma as any).disputeCasePolicyEligibilityReview, "findFirst", async () => ({ id: "fixture-review", result: "ELIGIBLE_CURRENT_POLICY" })),
    // D65 track B: the old door reads whether the session has a Case (assertNoCaseForOldDoor); no Case here, no database.
    patch((prisma as any).disputeCase, "findFirst", async () => null),
    patch(sessionRepository, "findById", async () => session as any),
    // F3: the ruling is a compare-and-set from DISPUTED
    patch(sessionRepository, "transitionStatus", async (_id: string, _expected: SessionStatus[], status: SessionStatus, extra: any) => {
      calls.push(`updateStatus:${status}`);
      // Vòng 4 / Phase E2 — admin-confirmed PT no-show counts toward the client's right to
      // terminate after 3.
      assert.equal(extra?.ptAtFault, true, "admin-confirmed PT no-show must set ptAtFault");
      return true;
    }),
    patch(contractRepository, "findById", async () => contract as any),
    // QUOTA A+ (01/11/2026, Ngai): the entitlement of a validly confirmed PT no-show is booked at the terminal change, in the decision's transaction, once (per-session mark) - not after the money step. The mark's compare-and-set is stubbed statefully here: the first claim wins (the decision), a later one (the settlement) loses.
    patch(sessionRepository, "claimNoShowQuota", (() => {
      let claimed = false;
      return async () => (claimed ? false : (claimed = true));
    })()),
    patch(contractRepository, "incrementCompensatedSessions", async () => {
      calls.push("incrementCompensatedSessions");
      return {} as any;
    }),
    patch(paymentClient, "noShow", async () => {
      calls.push("paymentClient.noShow");
      return { compensation: "100000.00", pt: "90000.00", gym: "0.00", platform: "10000.00", shortfall: "0.00" };
    }),
    patch(contractService, "checkAndCompleteContract", async () => {
      calls.push("checkAndCompleteContract");
      return null;
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    const result = await bookingService.resolveDispute(
      sessionId,
      "admin-1",
      "PT_NO_SHOW_CONFIRMED" as any,
      "Xem lịch sử tin nhắn, xác nhận PT không tới điểm hẹn",
    );
    assert.equal((result as any).quotaDeducted, false, "PT vắng mặt không được trừ buổi của khách");
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, [
    `updateStatus:${SessionStatus.NO_SHOW}`,
    "incrementCompensatedSessions", // A+: booked in the decision's transaction, before the money call
    "paymentClient.noShow",
    "checkAndCompleteContract",
  ]);
});
