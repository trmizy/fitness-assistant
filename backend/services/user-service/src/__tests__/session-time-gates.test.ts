import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SessionStatus } from "../generated/prisma";
import { bookingService } from "../services/booking.service";
import { sessionRepository } from "../repositories/session.repository";
import { notificationService } from "../services/notification.service";

/**
 * Cụm B3 + B4 — completeSession và markNoShow không kiểm tra thời gian, không đối xứng với
 * reportPtNoShow (đã có kiểm tra `scheduledStartAt.getTime() > Date.now()` từ trước).
 *
 * B3: PT có thể báo "hoàn thành" một buổi tập TRƯỚC KHI nó thực sự diễn ra. Dùng
 * scheduledEndAt (không phải scheduledStartAt) làm mốc — "hoàn thành" nghĩa là toàn bộ buổi
 * đã diễn ra, không chỉ mới bắt đầu.
 *
 * B4: PT có thể báo khách (hoặc tự nhận) vắng mặt TRƯỚC KHI tới giờ hẹn — cùng lỗi logic mà
 * reportPtNoShow (chiều ngược lại: khách báo PT vắng) đã được vá từ trước, dùng cùng mốc
 * scheduledStartAt cho nhất quán với đường đã có.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("B3 — completeSession từ chối khi buổi tập chưa tới giờ kết thúc", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() - 5 * 60 * 1000), // đã bắt đầu 5 phút trước
    scheduledEndAt: new Date(Date.now() + 55 * 60 * 1000), // nhưng còn 55 phút mới kết thúc
  };
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => ({ ...session, status, ...extra })),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    await assert.rejects(
      () => bookingService.completeSession(sessionId, "pt-1"),
      /Chưa tới giờ|chưa kết thúc|chưa diễn ra/i,
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("B3 — completeSession vẫn hoạt động bình thường sau khi buổi tập đã kết thúc", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() - 90 * 60 * 1000),
    scheduledEndAt: new Date(Date.now() - 30 * 60 * 1000), // đã kết thúc 30 phút trước
  };
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => ({
      ...session,
      status,
      ...extra,
    })),
  ];

  try {
    const updated = await bookingService.completeSession(sessionId, "pt-1");
    assert.equal((updated as any).status, SessionStatus.PENDING_CLIENT_CONFIRMATION);
  } finally {
    restores.forEach((r) => r());
  }
});

test("B4 — markNoShow (PT tự nhận vắng mặt) từ chối khi buổi tập chưa tới giờ", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() + 60 * 60 * 1000), // còn 1h nữa mới tới giờ
  };
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => ({ ...session, status, ...extra })),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    await assert.rejects(
      () => bookingService.markNoShow(sessionId, "pt-1", "PT"),
      /Chưa tới giờ/,
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("B4 — markNoShow (PT báo khách vắng mặt) từ chối khi buổi tập chưa tới giờ", async () => {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: SessionStatus.CONFIRMED,
    scheduledStartAt: new Date(Date.now() + 60 * 60 * 1000),
  };
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus, extra: any) => ({ ...session, status, ...extra })),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    await assert.rejects(
      () => bookingService.markNoShow(sessionId, "pt-1", "CLIENT"),
      /Chưa tới giờ/,
    );
  } finally {
    restores.forEach((r) => r());
  }
});
