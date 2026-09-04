import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SessionStatus, SessionDisputeType } from "../generated/prisma";
import { bookingService } from "../services/booking.service";
import { sessionRepository } from "../repositories/session.repository";
import { notificationService } from "../services/notification.service";

/**
 * Vòng 4 / Phase E4 — disputeType is audit/admin-screen classification only; it never changes
 * how resolveDispute rules on a session. PENDING_CLIENT_CONFIRMATION (where disputeSession
 * fires from) has two different origins — completeSession's "it happened" vs markNoShow's
 * "client no-show" (ptNotes: "Client no-show") — disputeType is the only thing in the data
 * model that tells them apart afterwards.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("disputeSession từ báo cáo hoàn thành bình thường -> DELIVERY_DISPUTE", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.PENDING_CLIENT_CONFIRMATION,
    ptNotes: "Session went well, covered upper body",
  };
  let capturedExtra: any = null;
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => {
      capturedExtra = extra;
      return { ...session, status, ...extra } as any;
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];
  try {
    await bookingService.disputeSession(sessionId, "client-1", "Tôi không tập buổi này");
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(capturedExtra?.disputeType, SessionDisputeType.DELIVERY_DISPUTE);
});

test("disputeSession từ báo cáo 'khách vắng mặt' (markNoShow CLIENT) -> CLIENT_NO_SHOW_CLAIM", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.PENDING_CLIENT_CONFIRMATION,
    ptNotes: "Client no-show", // exact string markNoShow's CLIENT branch writes
  };
  let capturedExtra: any = null;
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => {
      capturedExtra = extra;
      return { ...session, status, ...extra } as any;
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];
  try {
    await bookingService.disputeSession(sessionId, "client-1", "Tôi có tới, PT ghi nhầm");
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(capturedExtra?.disputeType, SessionDisputeType.CLIENT_NO_SHOW_CLAIM);
});

test("respondToNoShowReport DENY -> PT_NO_SHOW_CLAIM", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.PT_NO_SHOW_REPORTED,
  };
  let capturedExtra: any = null;
  const restore = patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => {
    capturedExtra = extra;
    return { ...session, status, ...extra } as any;
  });
  const restoreFind = patch(sessionRepository, "findById", async () => session as any);
  try {
    await bookingService.respondToNoShowReport(sessionId, "pt-1", "DENY", "Tôi có mặt đúng giờ");
  } finally {
    restore();
    restoreFind();
  }
  assert.equal(capturedExtra?.disputeType, SessionDisputeType.PT_NO_SHOW_CLAIM);
});
