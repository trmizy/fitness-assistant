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

stubPtRestrictionReads();
stubSessionSettlements();

/**
 * B32 - the notice the OTHER party gets when a session is cancelled is Vietnamese (it used to be "Client cancelled a session" /
 * "Trainer cancelled the session"), and the PT whose client cancelled late is told they are still paid for the session.
 *
 * TEST FIXTURE: same leaf-I/O stubs as late-cancel-releases-money.test.ts (the real cancelSession runs; the money amount is not known
 * at that point, so the notice names no number).
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const HOUR = 60 * 60 * 1000;
const ENGLISH = /Client cancelled|Trainer cancelled|cancelled the/;

async function cancelAndCapture(opts: { status: SessionStatus; startInHours: number; actor: "client-1" | "pt-1" }) {
  const sessionId = randomUUID();
  const contractId = randomUUID();
  const session = {
    id: sessionId,
    contractId,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: opts.status,
    scheduledStartAt: new Date(Date.now() + opts.startInHours * HOUR),
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
    status: "ACTIVE",
  };
  const notes: any[] = [];
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "transitionStatus", async () => true),
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "incrementSession", async () => ({}) as any),
    patch(contractRepository, "update", async () => ({}) as any),
    patch(paymentClient, "releaseSession", async () => ({ unit: "100000.00", released: { pt: "90000.00", gym: "0.00", platform: "10000.00" } })),
    patch(contractService, "checkAndCompleteContract", async () => null),
    patch(notificationService, "create", async (n: any) => {
      notes.push(n);
      return {} as any;
    }),
  ];
  try {
    await bookingService.cancelSession(sessionId, opts.actor, "Bận việc đột xuất");
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(notes.length, 1);
  return notes[0] as { userId: string; text: string };
}

test("B32: client cancels a CONFIRMED session late - the PT is told, in Vietnamese, they are still paid for it", async () => {
  const n = await cancelAndCapture({ status: SessionStatus.CONFIRMED, startInHours: 2, actor: "client-1" });
  assert.equal(n.userId, "pt-1");
  assert.match(n.text, /sát giờ/);
  assert.match(n.text, /vẫn được thanh toán/);
  assert.doesNotMatch(n.text, ENGLISH);
  assert.doesNotMatch(n.text, /\d{3}/, "no invented amount: the real payout is not known at that point");
});

test("B32: client cancels a CONFIRMED session in good time - plain Vietnamese notice, no payment promise", async () => {
  const n = await cancelAndCapture({ status: SessionStatus.CONFIRMED, startInHours: 48, actor: "client-1" });
  assert.equal(n.text, "Khách đã huỷ một buổi tập.");
});

test("B32: PT cancels a CONFIRMED session in good time - the client gets a Vietnamese notice", async () => {
  const n = await cancelAndCapture({ status: SessionStatus.CONFIRMED, startInHours: 48, actor: "pt-1" });
  assert.equal(n.userId, "client-1");
  assert.equal(n.text, "Huấn luyện viên đã huỷ một buổi tập.");
});

test("B32: cancelling a REQUESTED (unconfirmed) session notifies in Vietnamese both ways", async () => {
  const byClient = await cancelAndCapture({ status: SessionStatus.REQUESTED, startInHours: 48, actor: "client-1" });
  assert.equal(byClient.text, "Khách đã huỷ một buổi tập chưa xác nhận.");
  const byPt = await cancelAndCapture({ status: SessionStatus.REQUESTED, startInHours: 48, actor: "pt-1" });
  assert.equal(byPt.text, "Huấn luyện viên đã huỷ một buổi tập chưa xác nhận.");
});
