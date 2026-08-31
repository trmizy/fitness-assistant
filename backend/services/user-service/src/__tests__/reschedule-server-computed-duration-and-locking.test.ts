import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bookingService } from "../services/booking.service";
import { sessionRepository } from "../repositories/session.repository";
import { contractRepository } from "../repositories/contract.repository";
import { availabilityRepository } from "../repositories/availability.repository";
import { notificationService } from "../services/notification.service";
import { prisma } from "../repositories/profile.repository";
import { DayOfWeek } from "../generated/prisma";

/**
 * Cụm H1 — requestReschedule nhận proposedEndAt trực tiếp từ người gọi thay vì tính từ
 * contract.sessionDurationMinutes (đúng kỷ luật book-session-duration-from-contract.test.ts
 * đã có cho đặt lịch ban đầu — money-flow plan 3.4). Một caller gọi thẳng API có thể đề xuất
 * dời sang một buổi dài hơn/ngắn hơn hẳn so với gói đã mua.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("requestReschedule: proposedEndAt do người gọi tự gửi bị bỏ qua — luôn tính lại từ sessionDurationMinutes của hợp đồng", async () => {
  const sessionId = "session-1";
  const contract = {
    id: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: "ACTIVE",
    sessionDurationMinutes: 60,
  };
  const session = {
    id: sessionId,
    contractId: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: "CONFIRMED",
    scheduledStartAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    scheduledEndAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
  };

  const proposedStartAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  let createdWith: any = null;

  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(contractRepository, "findById", async () => contract as any),
    patch(sessionRepository, "findOpenRescheduleRequest", async () => null),
    patch(sessionRepository, "countAcceptedReschedules", async () => 0),
    patch(sessionRepository, "findConflict", async () => null),
    patch(availabilityRepository, "findByPT", async () => [
      { dayOfWeek: ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][proposedStartAt.getDay()], isActive: true, startTime: "00:00", endTime: "23:59" },
    ]),
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(sessionRepository, "createRescheduleRequest", async (data: any) => {
      createdWith = data;
      return { id: "req-1", ...data };
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    await (bookingService as any).requestReschedule(sessionId, "client-1", {
      proposedStartAt: proposedStartAt.toISOString(),
      proposedEndAt: new Date(proposedStartAt.getTime() + 999 * 60 * 1000).toISOString(), // cố tình gửi 999 phút — phải bị bỏ qua
      reason: "Bận việc đột xuất",
    });
  } finally {
    restores.forEach((r) => r());
  }

  assert.ok(createdWith, "phải tạo được yêu cầu dời lịch");
  const actualDurationMin = (createdWith.proposedEndAt.getTime() - createdWith.proposedStartAt.getTime()) / (60 * 1000);
  assert.equal(actualDurationMin, 60, "thời lượng đề xuất phải khớp đúng 60 phút của hợp đồng — không phải 999 phút người gọi tự gửi");
});

// ── Cụm H2 — chấp nhận dời lịch phải nằm trong CÙNG transaction có khoá mà Cụm B2 đã dựng ──

const DAY_MAP: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUNDAY,
  1: DayOfWeek.MONDAY,
  2: DayOfWeek.TUESDAY,
  3: DayOfWeek.WEDNESDAY,
  4: DayOfWeek.THURSDAY,
  5: DayOfWeek.FRIDAY,
  6: DayOfWeek.SATURDAY,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeActiveContract(overrides: Record<string, unknown> = {}) {
  return prisma.contract.create({
    data: {
      id: randomUUID(),
      ptUserId: randomUUID(),
      clientUserId: randomUUID(),
      packageName: "Test Package",
      totalSessions: 10,
      usedSessions: 0,
      compensatedSessions: 0,
      status: "ACTIVE",
      sessionDurationMinutes: 60,
      ...overrides,
    },
  });
}

test("respondToReschedule (ACCEPT) — hai yêu cầu dời lịch của cùng một PT cùng nhắm vào một khung giờ, gửi gần như đồng thời: chỉ một thành công", async () => {
  const ptUserId = randomUUID();
  const contractA = await makeActiveContract({ ptUserId });
  const contractB = await makeActiveContract({ ptUserId });

  const targetStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  targetStart.setHours(10, 0, 0, 0);
  const targetEnd = new Date(targetStart.getTime() + 60 * 60 * 1000);
  const dayOfWeek = DAY_MAP[targetStart.getDay()];

  const avail = await prisma.pTAvailability.create({
    data: { ptUserId, dayOfWeek, startTime: "00:00", endTime: "23:59", isActive: true },
  });

  // Hai buổi CONFIRMED gốc, giờ khác nhau, cùng một PT — mỗi buổi có một yêu cầu dời lịch
  // PENDING nhắm vào ĐÚNG cùng một khung giờ đích.
  const originalA = new Date(targetStart.getTime() + 5 * 24 * 60 * 60 * 1000);
  const originalB = new Date(targetStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  const sessionA = await prisma.session.create({
    data: {
      contractId: contractA.id, clientUserId: contractA.clientUserId, ptUserId,
      status: "CONFIRMED", scheduledStartAt: originalA, scheduledEndAt: new Date(originalA.getTime() + 3600_000),
    },
  });
  const sessionB = await prisma.session.create({
    data: {
      contractId: contractB.id, clientUserId: contractB.clientUserId, ptUserId,
      status: "CONFIRMED", scheduledStartAt: originalB, scheduledEndAt: new Date(originalB.getTime() + 3600_000),
    },
  });
  const requestA = await prisma.sessionRescheduleRequest.create({
    data: {
      sessionId: sessionA.id, requestedBy: "CLIENT",
      originalStartAt: sessionA.scheduledStartAt, originalEndAt: sessionA.scheduledEndAt,
      proposedStartAt: targetStart, proposedEndAt: targetEnd, reason: "test", status: "PENDING",
    },
  });
  const requestB = await prisma.sessionRescheduleRequest.create({
    data: {
      sessionId: sessionB.id, requestedBy: "CLIENT",
      originalStartAt: sessionB.scheduledStartAt, originalEndAt: sessionB.scheduledEndAt,
      proposedStartAt: targetStart, proposedEndAt: targetEnd, reason: "test", status: "PENDING",
    },
  });

  // Cùng kỹ thuật chèn độ trễ có kiểm soát đã dùng ở booking-race-conditions.integration.test.ts
  // — buộc cả hai lệnh gọi đồng thời cùng "thấy" khung giờ còn trống trước khi cái nào commit,
  // trừ khi bản vá đã khoá đúng theo PT TRƯỚC KHI chạy tới bước kiểm tra này.
  const originalFindConflict = sessionRepository.findConflict.bind(sessionRepository);
  const restoreFindConflict = patch(sessionRepository, "findConflict", async (...args: any[]) => {
    await sleep(300);
    return (originalFindConflict as any)(...args);
  });

  try {
    const [r1, r2] = await Promise.allSettled([
      bookingService.respondToReschedule(requestA.id, ptUserId, "ACCEPT"),
      bookingService.respondToReschedule(requestB.id, ptUserId, "ACCEPT"),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "chỉ MỘT trong hai yêu cầu đồng thời được chấp nhận — không được cả hai cùng thành công");
    assert.equal(rejected.length, 1);

    const sessionsAtTarget = await prisma.session.findMany({
      where: { ptUserId, scheduledStartAt: targetStart },
    });
    assert.equal(sessionsAtTarget.length, 1, "chỉ đúng một buổi tập được dời vào khung giờ này — không có bản ghi chồng giờ do race");
  } finally {
    restoreFindConflict();
    await prisma.sessionRescheduleRequest.deleteMany({ where: { id: { in: [requestA.id, requestB.id] } } }).catch(() => {});
    await prisma.pTAvailability.delete({ where: { id: avail.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contractA.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contractB.id } }).catch(() => {});
  }
});
