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
 * Money-flow redesign plan item 4.3 — "khách báo PT vắng mặt".
 *
 * Before this, `markNoShow` could ONLY be called by the PT — a client whose PT genuinely
 * never showed up had no path to report it at all. Flow: client reports → session parks in
 * PT_NO_SHOW_REPORTED → PT agrees (settled exactly like a PT self-admitted no-show, reusing
 * that logic) or denies (escalates to DISPUTED — the same admin flow item 4.2 built).
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

test("a client can report a PT no-show for a past CONFIRMED session", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() - 60 * 60 * 1000), // 1h in the past
  };
  const calls: string[] = [];

  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => {
      calls.push(`updateStatus:${status}`);
      assert.equal(extra.disputeReason, "PT không đến, tôi đợi 30 phút");
      return { ...session, status } as any;
    }),
    patch(notificationService, "create", async () => {
      calls.push("notify");
      return {} as any;
    }),
  ];

  try {
    await bookingService.reportPtNoShow(sessionId, "client-1", "PT không đến, tôi đợi 30 phút");
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, [`updateStatus:${SessionStatus.PT_NO_SHOW_REPORTED}`, "notify"]);
});

test("cannot report a no-show before the session's scheduled start time", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() + 60 * 60 * 1000), // still in the future
  };
  const restore = patch(sessionRepository, "findById", async () => session as any);

  try {
    await assert.rejects(
      () => bookingService.reportPtNoShow(sessionId, "client-1", "reason"),
      /Chưa thể báo.*vắng mặt/, // Vòng 4 / Phase E1: message now mentions the grace window
    );
  } finally {
    restore();
  }
});

test("E1 — reportPtNoShow bị từ chối khi mới quá giờ hẹn 5 phút (còn trong grace window)", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() - 5 * 60 * 1000),
  };
  const restore = patch(sessionRepository, "findById", async () => session as any);
  try {
    await assert.rejects(
      () => bookingService.reportPtNoShow(sessionId, "client-1", "reason"),
      /Chưa thể báo.*vắng mặt/,
    );
  } finally {
    restore();
  }
});

test("E1 — reportPtNoShow cho phép báo sau khi hết grace window (quá giờ hẹn 20 phút)", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() - 20 * 60 * 1000),
  };
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => ({ ...session, status, ...extra })),
    patch(notificationService, "create", async () => ({}) as any),
  ];
  try {
    const updated = await bookingService.reportPtNoShow(sessionId, "client-1", "reason");
    assert.equal((updated as any).status, SessionStatus.PT_NO_SHOW_REPORTED);
  } finally {
    restores.forEach((r) => r());
  }
});

test("someone other than the client cannot report on their behalf", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() - 60 * 60 * 1000),
  };
  const restore = patch(sessionRepository, "findById", async () => session as any);

  try {
    await assert.rejects(() => bookingService.reportPtNoShow(sessionId, "someone-else", "reason"), /Not authorized/);
  } finally {
    restore();
  }
});

test("the PT agreeing with the report compensates the client — reuses markNoShow's own logic", async () => {
  const contractId = randomUUID();
  const sessionId = randomUUID();
  const contract = contractFixture(contractId);
  const session = {
    id: sessionId,
    contractId,
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.PT_NO_SHOW_REPORTED,
    scheduledStartAt: new Date(Date.now() - 60 * 60 * 1000),
  };
  const calls: string[] = [];

  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus) => {
      calls.push(`updateStatus:${status}`);
      return { ...session, status } as any;
    }),
    patch(contractRepository, "findById", async () => contract as any),
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
    await bookingService.respondToNoShowReport(sessionId, "pt-1", "AGREE");
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, [
    `updateStatus:${SessionStatus.NO_SHOW}`,
    "paymentClient.noShow",
    "incrementCompensatedSessions",
    "checkAndCompleteContract",
  ]);
});

test("the PT denying the report escalates to DISPUTED — the same state 4.2's admin screen resolves", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.PT_NO_SHOW_REPORTED,
    scheduledStartAt: new Date(Date.now() - 60 * 60 * 1000),
  };
  let capturedStatus: string | null = null;
  let capturedNotes: string | null = null;

  const restore = patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => {
    capturedStatus = status;
    capturedNotes = extra.ptNotes;
    return { ...session, status } as any;
  });
  const restoreFind = patch(sessionRepository, "findById", async () => session as any);

  try {
    await bookingService.respondToNoShowReport(sessionId, "pt-1", "DENY", "Tôi có mặt đúng giờ, khách không tới điểm hẹn");
  } finally {
    restore();
    restoreFind();
  }

  assert.equal(capturedStatus, SessionStatus.DISPUTED);
  assert.equal(capturedNotes, "Tôi có mặt đúng giờ, khách không tới điểm hẹn");
});

test("cannot respond to a report that is not in PT_NO_SHOW_REPORTED status", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(),
  };
  const restore = patch(sessionRepository, "findById", async () => session as any);

  try {
    await assert.rejects(() => bookingService.respondToNoShowReport(sessionId, "pt-1", "AGREE"));
  } finally {
    restore();
  }
});
