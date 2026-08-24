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
 * Money-flow redesign plan item 1.4 — "khách huỷ muộn trừ quota nhưng không giải phóng tiền".
 *
 * Ma trận 0.1: khách huỷ < 24h trước giờ hẹn → mất 1 quota, **PT hưởng trọn buổi đó** — same
 * money outcome as if the session had actually happened. `cancelSession` already charged the
 * quota (`shouldDeduct` → `incrementSession`) but never called `releaseSessionMoney`, so the
 * PT's pending share for that session sat frozen until the whole contract eventually
 * terminated.
 *
 * Patches the real singleton collaborators (`sessionRepository`, `contractRepository`,
 * `contractService`, `notificationService`, and `paymentClient` — the one
 * `releaseSessionMoney` itself calls over HTTP) so the REAL `cancelSession` and the REAL
 * `releaseSessionMoney` both run; only their leaf I/O is faked.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function futureBy(ms: number): Date {
  return new Date(Date.now() + ms);
}

const HOUR = 60 * 60 * 1000;

// Unique per call — releaseSessionMoney now does a REAL write to the session_settlements
// table keyed on sessionId (money-flow plan 1.6), so reusing a literal id across test runs
// would find that key already SETTLED and correctly skip re-running, which would look like a
// bug in THIS test rather than the idempotency guarantee it actually is.
function baseFixtures(scheduledStartAt: Date) {
  const sessionId = randomUUID();
  const contractId = randomUUID();
  const session = {
    id: sessionId,
    contractId,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt,
  };
  const contract = {
    id: contractId,
    paymentTransactionId: "txn-1",
    price: { toString: () => "1000000" } as any,
    totalSessions: 10,
    usedSessions: 3,
    compensatedSessions: 0,
    platformRate: { toString: () => "0.10" },
    ptRate: { toString: () => "0.90" },
    gymRate: { toString: () => "0" },
    ptUserId: "pt-1",
    gymId: null,
    clientUserId: "client-1",
    notes: null,
  };
  return { session, contract };
}

test("client cancelling < 24h before the session releases the PT's money for it", async () => {
  const { session, contract } = baseFixtures(futureBy(2 * HOUR)); // 2h out — inside the 24h window
  const calls: string[] = [];

  const restores = [
    patch(sessionRepository, "findById", async () => {
      calls.push("session.findById");
      return session as any;
    }),
    patch(sessionRepository, "updateStatus", async () => {
      calls.push("session.updateStatus");
      return { ...session, status: SessionStatus.CANCELLED } as any;
    }),
    patch(contractRepository, "findById", async () => {
      calls.push("contract.findById");
      return contract as any;
    }),
    patch(contractRepository, "incrementSession", async () => {
      calls.push("incrementSession");
      return {} as any;
    }),
    patch(contractRepository, "update", async () => ({}) as any),
    patch(paymentClient, "releaseSession", async (body: any) => {
      calls.push("paymentClient.releaseSession");
      assert.equal(body.idempotencyKey, `SESSION_RELEASE:${session.id}`);
      return { unit: "100000.00", released: { pt: "90000.00", gym: "0.00", platform: "10000.00" } };
    }),
    patch(contractService, "checkAndCompleteContract", async () => {
      calls.push("checkAndCompleteContract");
      return null;
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    await bookingService.cancelSession(session.id, "client-1", "Bận việc đột xuất");
  } finally {
    restores.forEach((r) => r());
  }

  assert.ok(calls.includes("paymentClient.releaseSession"), "the PT's session money is released — the plan 1.4 fix");
  const order = ["incrementSession", "paymentClient.releaseSession", "checkAndCompleteContract"];
  assert.deepEqual(
    calls.filter((c) => order.includes(c)),
    order,
    "increment quota, THEN release money, THEN check completion — same order deductQuotaOnce uses",
  );
});

test("client cancelling >= 24h ahead does not deduct quota or release money", async () => {
  const { session, contract } = baseFixtures(futureBy(48 * HOUR)); // well outside the window
  const calls: string[] = [];

  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async () => {
      calls.push("session.updateStatus");
      return { ...session, status: SessionStatus.CANCELLED } as any;
    }),
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "incrementSession", async () => {
      calls.push("incrementSession");
      return {} as any;
    }),
    patch(paymentClient, "releaseSession", async () => {
      calls.push("paymentClient.releaseSession");
      return {};
    }),
    patch(contractService, "checkAndCompleteContract", async () => {
      calls.push("checkAndCompleteContract");
      return null;
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    await bookingService.cancelSession(session.id, "client-1", "Đổi lịch trước");
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, ["session.updateStatus"], "no quota, no money, no completion check — the session just returns to the pool");
});

test("the PT cancelling with plenty of notice (≥24h) never deducts quota or releases money", async () => {
  // Money-flow plan 3.1 note: a PT cancelling with LESS than 24h notice now DOES compensate
  // the client (matrix 0.1 row 4) — that case moved to
  // pt-late-cancel-compensates-via-shared-outcome.test.ts, which also covers this ≥24h case.
  // Kept here too since this file is specifically about the money-release call chain.
  const { session, contract } = baseFixtures(futureBy(48 * HOUR)); // well outside the window
  const calls: string[] = [];

  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async () => {
      calls.push("session.updateStatus");
      return { ...session, status: SessionStatus.CANCELLED } as any;
    }),
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "incrementSession", async () => {
      calls.push("incrementSession");
      return {} as any;
    }),
    patch(paymentClient, "releaseSession", async () => {
      calls.push("paymentClient.releaseSession");
      return {};
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    // "pt-1" (session.ptUserId) cancels, not the client.
    await bookingService.cancelSession(session.id, "pt-1", "PT bận đột xuất");
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, ["session.updateStatus"]);
});
