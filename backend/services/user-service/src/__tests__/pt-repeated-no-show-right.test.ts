import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { SessionStatus } from "../generated/prisma";
import { bookingService } from "../services/booking.service";
import { sessionRepository } from "../repositories/session.repository";
import { contractRepository } from "../repositories/contract.repository";
import { contractService, PT_REPEATED_NO_SHOW_THRESHOLD } from "../services/contract.service";
import { notificationService } from "../services/notification.service";
import { paymentClient } from "../clients/payment.client";

/**
 * Vòng 4 / Phase E2 — a 3rd confirmed PT no-show on one contract gives the client the RIGHT
 * (never automatic — the client still has to actually call terminate with
 * TerminationReason.PT_REPEATED_NO_SHOW) to end the contract for a full refund of the unused
 * value. This file covers: (1) markNoShow's PT self-admit branch actually sets the
 * ptAtFault flag the count relies on — the one PT-fault path with no prior success-case test
 * at all; (2) contractService.repeatedNoShowEligibility, the function that actually gates the
 * money-moving termination in contract.controller.ts; (3) a real-DB check that the count query
 * only counts ptAtFault rows, not every NO_SHOW.
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

test("markNoShow (PT tự nhận vắng mặt) đánh dấu ptAtFault=true — không có test nào trước đây phủ nhánh thành công này", async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const contract = contractFixture(contractId);
  const session = {
    id: sessionId,
    contractId,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() - 30 * 60 * 1000), // past the E1 grace window
  };
  let capturedExtra: any = null;

  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => {
      capturedExtra = extra;
      return { ...session, status, ...extra } as any;
    }),
    patch(contractRepository, "findById", async () => contract as any),
    patch(contractRepository, "incrementCompensatedSessions", async () => ({}) as any),
    patch(paymentClient, "noShow", async () => ({
      compensation: "100000.00", pt: "90000.00", gym: "0.00", platform: "10000.00", shortfall: "0.00",
    })),
    patch(contractService, "checkAndCompleteContract", async () => null),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    await bookingService.markNoShow(sessionId, "pt-1", "PT");
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(capturedExtra?.ptAtFault, true, "PT self-admitted no-show must set ptAtFault");
});

test("repeatedNoShowEligibility — chưa đủ ngưỡng thì eligible=false", async () => {
  const restore = patch(sessionRepository, "countPtAtFaultByContract", async () => PT_REPEATED_NO_SHOW_THRESHOLD - 1);
  try {
    const result = await contractService.repeatedNoShowEligibility("contract-1");
    assert.equal(result.eligible, false);
    assert.equal(result.count, PT_REPEATED_NO_SHOW_THRESHOLD - 1);
    assert.equal(result.threshold, PT_REPEATED_NO_SHOW_THRESHOLD);
  } finally {
    restore();
  }
});

test("repeatedNoShowEligibility — đủ hoặc vượt ngưỡng thì eligible=true", async () => {
  const restore = patch(sessionRepository, "countPtAtFaultByContract", async () => PT_REPEATED_NO_SHOW_THRESHOLD + 2);
  try {
    const result = await contractService.repeatedNoShowEligibility("contract-1");
    assert.equal(result.eligible, true);
  } finally {
    restore();
  }
});

test("countPtAtFaultByContract (real DB) chỉ đếm session có ptAtFault=true, không đếm mọi NO_SHOW", async () => {
  const contractId = randomUUID();
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();

  const contract = await prisma.contract.create({
    data: {
      id: contractId,
      ptUserId,
      clientUserId,
      packageName: "Test",
      totalSessions: 10,
      status: "ACTIVE",
    },
  });

  const base = {
    contractId,
    ptUserId,
    clientUserId,
    scheduledStartAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    scheduledEndAt: new Date(Date.now() - 60 * 60 * 1000),
  };

  const sessions = await Promise.all([
    prisma.session.create({ data: { id: randomUUID(), ...base, status: "NO_SHOW", ptAtFault: true } }),
    prisma.session.create({ data: { id: randomUUID(), ...base, status: "NO_SHOW", ptAtFault: true } }),
    // Client no-show — same terminal status, but NOT the PT's fault, must not count.
    prisma.session.create({ data: { id: randomUUID(), ...base, status: "NO_SHOW", ptAtFault: false } }),
    prisma.session.create({ data: { id: randomUUID(), ...base, status: "COMPLETED", ptAtFault: false } }),
  ]);

  try {
    const count = await sessionRepository.countPtAtFaultByContract(contractId);
    assert.equal(count, 2, "chỉ 2 session có ptAtFault=true, không đếm client no-show hay session đã hoàn thành");
  } finally {
    await prisma.session.deleteMany({ where: { id: { in: sessions.map((s) => s.id) } } });
    await prisma.contract.delete({ where: { id: contract.id } });
  }
});
