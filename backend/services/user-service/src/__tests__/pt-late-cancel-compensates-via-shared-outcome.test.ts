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

/**
 * Money-flow redesign plan item 3.1 — the `cancelSession` half of unifying PT-side outcomes.
 *
 * Before this fix, `cancelSession` NEVER compensated the client for a PT cancellation,
 * regardless of notice — the exact incentive problem the plan describes: a PT choosing between
 * `PATCH /:id/cancel` (this function, no cost) and blocking their whole date via
 * `addException` (which DID compensate, before 3.1's addException fix) would always prefer the
 * free option. Now both route through the same `resolveSessionOutcome`.
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
  };
}

test("a PT cancelling < 24h out compensates the client and marks the session NO_SHOW", async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const contract = contractFixture(contractId);
  const session = {
    id: sessionId,
    contractId,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() + 3 * 60 * 60 * 1000), // 3h out — late
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
    "paymentClient.noShow",
    "incrementCompensatedSessions",
    "checkAndCompleteContract",
  ]);
  assert.ok(!calls.includes("incrementSession"), "the client's quota is NOT deducted for a PT-caused cancellation");
  assert.ok(!calls.includes("paymentClient.releaseSession"), "the PT does not additionally get paid for a session compensated as a no-show");
});

test("a PT cancelling ≥ 24h out still costs nothing — unchanged from before 3.1", async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
  };
  const calls: string[] = [];

  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    // Vòng 4 / Phase A1: same swap as above — REQUESTED-branch cancel also CASes now.
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
