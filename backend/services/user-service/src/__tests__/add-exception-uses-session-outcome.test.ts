import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { availabilityService } from "../services/availability.service";
import { availabilityRepository } from "../repositories/availability.repository";
import { sessionRepository } from "../repositories/session.repository";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { notificationService } from "../services/notification.service";
import { SessionStatus } from "../generated/prisma";
import { stubPtRestrictionReads } from "./pt-restriction-reads.stub";
import { stubSessionSettlements } from "./session-settlement-memory.stub";

// pt-restriction.service reads the restriction tables directly: answer them like an empty database (no restriction) so this unit test needs no DB.
stubPtRestrictionReads();
// the money steps track their progress in session_settlements: keep that table in memory too (no DB writes from a unit test).
stubSessionSettlements();

/**
 * Money-flow redesign plan item 3.1 — "hợp nhất hậu quả khi PT nghỉ", the `addException` half.
 *
 * Before this fix, `addException` compensated EVERY confirmed session it hit, regardless of
 * how much notice the PT gave — the exact bug the plan calls out: "PT báo nghỉ sớm không phải
 * bồi thường tiền — chỉ cần đặt lại buổi. Hiện code đang biến mọi lần PT chặn ngày thành vắng
 * mặt có bồi thường, đó là sai." Now routed through the shared `resolveSessionOutcome`
 * (session-outcome.test.ts already covers its six-row matrix in isolation) — this file only
 * has to prove `addException` actually calls it correctly for the two cases that matter here.
 *
 * `compensateNoShowMoney` is a plain function export (not an object method), so it cannot be
 * monkey-patched directly the same way contractRepository/paymentClient can — this instead
 * lets the REAL function run, faking only ITS leaf dependencies (same technique as
 * no-show-compensation-is-retryable.test.ts).
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
    status: "ACTIVE", // F4: the PT block works on a running contract (decided under the contract lock)
  };
}

test("blocking a date ≥24h ahead cancels the confirmed session WITHOUT compensation", async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const contract = contractFixture(contractId);
  const farFutureStart = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const session = { id: sessionId, contractId, clientUserId: "client-1", status: SessionStatus.CONFIRMED, scheduledStartAt: farFutureStart };
  const calls: string[] = [];

  const restores = [
    patch(availabilityRepository, "addException", async () => ({ id: "exc-1" }) as any),
    patch(sessionRepository, "findConflictsByDate", async () => [session] as any),
    patch(sessionRepository, "transitionStatus", async (_id: string, _expected: SessionStatus[], status: SessionStatus) => {
      calls.push(`updateStatus:${status}`);
      return true;
    }),
    patch(contractRepository, "findById", async () => contract as any),
    patch(paymentClient, "noShow", async () => {
      calls.push("paymentClient.noShow");
      return {} as any;
    }),
    patch(notificationService, "create", async (params: any) => {
      calls.push(`notify:${params.eventType}`);
      return {} as any;
    }),
  ];

  try {
    await availabilityService.addException("pt-1", farFutureStart.toISOString().slice(0, 10), "Nghỉ phép");
  } finally {
    restores.forEach((r) => r());
  }

  assert.ok(!calls.includes("paymentClient.noShow"), "no compensation call for a ≥24h block — the plan's headline fix");
  assert.deepEqual(calls, [`updateStatus:${SessionStatus.CANCELLED}`, "notify:SESSION_CANCELLED"]);
});

test("blocking a date <24h ahead compensates the client and marks the session NO_SHOW", async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const contract = contractFixture(contractId);
  const soonStart = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const session = { id: sessionId, contractId, clientUserId: "client-1", status: SessionStatus.CONFIRMED, scheduledStartAt: soonStart };
  const calls: string[] = [];

  const restores = [
    patch(availabilityRepository, "addException", async () => ({ id: "exc-1" }) as any),
    patch(sessionRepository, "findConflictsByDate", async () => [session] as any),
    patch(sessionRepository, "transitionStatus", async (_id: string, _expected: SessionStatus[], status: SessionStatus) => {
      calls.push(`updateStatus:${status}`);
      return true;
    }),
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "incrementCompensatedSessions", async () => ({}) as any),
    patch(paymentClient, "noShow", async () => {
      calls.push("paymentClient.noShow");
      return { compensation: "100000.00", pt: "90000.00", gym: "0.00", platform: "10000.00", shortfall: "0.00" };
    }),
    patch(notificationService, "create", async (params: any) => {
      calls.push(`notify:${params.eventType}`);
      return {} as any;
    }),
  ];

  try {
    await availabilityService.addException("pt-1", soonStart.toISOString().slice(0, 10), "Nghỉ đột xuất");
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, [`updateStatus:${SessionStatus.NO_SHOW}`, "paymentClient.noShow", "notify:SESSION_NO_SHOW_PT"]);
});

/**
 * The idle-holdback clock (contractRepository.findIdleHoldbackCandidates) counts a session the PT
 * cancelled as activity, and tells it from a client cancel by `cancelledBy` = the PT's own id.
 * addException is a PT-initiated cancel path that used to leave cancelledBy empty.
 */
test("a PT block that CANCELS a session records the PT as the canceller; the <24h NO_SHOW path does not touch cancelledBy", async () => {
  const run = async (status: SessionStatus, startInMs: number) => {
    const contractId = randomUUID();
    const start = new Date(Date.now() + startInMs);
    const session = { id: randomUUID(), contractId, clientUserId: "client-1", status, scheduledStartAt: start };
    const extras: any[] = [];
    const restores = [
      patch(availabilityRepository, "addException", async () => ({ id: "exc-1" }) as any),
      patch(sessionRepository, "findConflictsByDate", async () => [session] as any),
      patch(sessionRepository, "transitionStatus", async (_id: string, _expected: SessionStatus[], _s: SessionStatus, extra: any) => {
        extras.push(extra);
        return true;
      }),
      patch(contractRepository, "findById", async () => contractFixture(contractId) as any),
      patch(contractRepository, "incrementCompensatedSessions", async () => ({}) as any),
      patch(paymentClient, "noShow", async () => ({ compensation: "100000.00", pt: "90000.00", gym: "0.00", platform: "10000.00", shortfall: "0.00" }) as any),
      patch(notificationService, "create", async () => ({}) as any),
    ];
    try {
      await availabilityService.addException("pt-1", start.toISOString().slice(0, 10), "Nghỉ phép");
    } finally {
      restores.forEach((r) => r());
    }
    return extras[0];
  };

  assert.equal((await run(SessionStatus.CONFIRMED, 72 * 3600 * 1000)).cancelledBy, "pt-1", "CONFIRMED, >=24h -> CANCELLED by the PT");
  assert.equal((await run(SessionStatus.REQUESTED, 72 * 3600 * 1000)).cancelledBy, "pt-1", "REQUESTED -> CANCELLED by the PT");
  assert.equal("cancelledBy" in (await run(SessionStatus.CONFIRMED, 3 * 3600 * 1000)), false, "<24h is a NO_SHOW, not a cancel");
});
