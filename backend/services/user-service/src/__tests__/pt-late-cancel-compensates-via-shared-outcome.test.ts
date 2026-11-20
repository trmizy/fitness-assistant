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

// pt-restriction.service reads the restriction tables directly: answer them like an empty database (no restriction) so this unit test needs no DB.
stubPtRestrictionReads();
// the money steps track their progress in session_settlements: keep that table in memory too (no DB writes from a unit test).
stubSessionSettlements();

/**
 * Money-flow redesign plan item 3.1 — the `cancelSession` half of unifying PT-side outcomes.
 *
 * `cancelSession` and `addException` route through the same `resolveSessionOutcome`, so a PT cancelling directly and a PT
 * blocking the whole date cost the same. Since the owner decision of 20/11/2026 that cost is a cash compensation to the
 * client at ANY notice (no 24h grace) for a CONFIRMED session; a REQUESTED one stays free.
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
    status: "ACTIVE", // F1: a session of an ended contract is not cancellable
  };
}

// OWNER DECISION 20/11/2026: no 24h grace - a PT cancelling a CONFIRMED session compensates the client at ANY notice.
for (const [label, hours] of [["3h", 3], ["exactly 24h", 24], ["72h", 72]] as const) {
test(`a PT cancelling a CONFIRMED session ${label} out compensates the client and marks the session NO_SHOW`, async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const contract = contractFixture(contractId);
  const session = {
    id: sessionId,
    contractId,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() + hours * 60 * 60 * 1000),
  };
  const calls: string[] = [];

  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    // Vòng 4 / Phase A1: cancelSession's CONFIRMED branch now CASes via transitionStatus
    // instead of an unconditional updateStatus — mock the primitive it actually calls now.
    patch(sessionRepository, "transitionStatus", async (_id: string, _expected: SessionStatus[], status: SessionStatus) => {
      calls.push(`updateStatus:${status}`);
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
    patch(contractRepository, "incrementSession", async () => {
      calls.push("incrementSession");
      return {} as any;
    }),
    patch(paymentClient, "noShow", async () => {
      calls.push("paymentClient.noShow");
      return { compensation: "100000.00", pt: "90000.00", gym: "0.00", platform: "10000.00", shortfall: "0.00" };
    }),
    patch(paymentClient, "releaseSession", async () => {
      calls.push("paymentClient.releaseSession");
      return { released: { pt: "0", gym: "0", platform: "0" } };
    }),
    patch(contractService, "checkAndCompleteContract", async () => {
      calls.push("checkAndCompleteContract");
      return null;
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    await bookingService.cancelSession(sessionId, "pt-1", "Đột xuất có việc gấp");
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, [
    `updateStatus:${SessionStatus.NO_SHOW}`,
    "incrementCompensatedSessions", // A+: booked in the decision's transaction, before the money call
    "paymentClient.noShow",
    "checkAndCompleteContract",
  ]);
  assert.ok(!calls.includes("incrementSession"), "the client's quota is NOT deducted for a PT-caused cancellation");
  assert.ok(!calls.includes("paymentClient.releaseSession"), "the PT does not additionally get paid for a session compensated as a no-show");
});
}

test("a PT cancelling a REQUESTED (not yet confirmed) session still costs nothing - unchanged", async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.REQUESTED,
    scheduledStartAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
  };
  const calls: string[] = [];

  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(contractRepository, "findById", async () => contractFixture(contractId) as any),
    patch(sessionRepository, "transitionStatus", async (_id: string, _expected: SessionStatus[], status: SessionStatus) => {
      calls.push(`updateStatus:${status}`);
      return true;
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    await bookingService.cancelSession(sessionId, "pt-1", "Báo trước sớm");
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, [`updateStatus:${SessionStatus.CANCELLED}`]);
});
