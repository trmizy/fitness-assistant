/**
 * Cụm B1 + B2 — kiểm tra thật với Postgres, không mock, vì cả hai lỗi đều chỉ lộ ra dưới điều
 * kiện thật: đếm đúng qua nhiều trạng thái, và một race condition thật giữa hai request.
 *
 * B1 — countActiveByContract chỉ đếm REQUESTED/CONFIRMED, bỏ sót ba trạng thái vẫn đang giữ
 * quyền lợi (PENDING_CLIENT_CONFIRMATION, DISPUTED, PT_NO_SHOW_REPORTED) — khách có thể đặt
 * vượt quá số buổi đã mua trong lúc một buổi khác đang chờ xác nhận/khiếu nại.
 *
 * B2 — bookSession không có transaction/khoá nào — hai request đặt cùng một khung giờ cho
 * cùng một PT gửi gần như đồng thời có thể cả hai đều vượt qua kiểm tra xung đột trước khi cái
 * nào commit, tạo ra hai session chồng giờ cho cùng một PT.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { sessionRepository } from "../repositories/session.repository";
import { bookingService } from "../services/booking.service";
import { SessionStatus, DayOfWeek } from "../generated/prisma";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DAY_MAP: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUNDAY,
  1: DayOfWeek.MONDAY,
  2: DayOfWeek.TUESDAY,
  3: DayOfWeek.WEDNESDAY,
  4: DayOfWeek.THURSDAY,
  5: DayOfWeek.FRIDAY,
  6: DayOfWeek.SATURDAY,
};

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

test("B1 — countActiveByContract đếm đủ cả năm trạng thái còn giữ quyền lợi, không đếm ba trạng thái đã chấm dứt", async () => {
  const contract = await makeActiveContract();
  const base = {
    contractId: contract.id,
    clientUserId: contract.clientUserId,
    ptUserId: contract.ptUserId,
    scheduledStartAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    scheduledEndAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 + 3600_000),
  };

  const holding = [
    SessionStatus.REQUESTED,
    SessionStatus.CONFIRMED,
    SessionStatus.PENDING_CLIENT_CONFIRMATION,
    SessionStatus.DISPUTED,
    SessionStatus.PT_NO_SHOW_REPORTED,
  ];
  const terminal = [SessionStatus.COMPLETED, SessionStatus.CANCELLED, SessionStatus.NO_SHOW];

  try {
    for (const status of [...holding, ...terminal]) {
      await prisma.session.create({ data: { ...base, status } });
    }

    const count = await sessionRepository.countActiveByContract(contract.id);
    assert.equal(count, 5, "phải đếm đủ 5 trạng thái còn giữ quyền lợi — không đếm 3 trạng thái đã chấm dứt");
  } finally {
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});

test("B2 — hai khách khác nhau đặt cùng một khung giờ cho cùng một PT gần như đồng thời — chỉ một thành công", async () => {
  const ptUserId = randomUUID();
  const contractA = await makeActiveContract({ ptUserId });
  const contractB = await makeActiveContract({ ptUserId });

  // 30 ngày sau, đảm bảo qua mọi ràng buộc CANCEL_WINDOW / endDate, và giờ hành chính hợp lệ.
  const startAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  startAt.setHours(10, 0, 0, 0);
  const dayOfWeek = DAY_MAP[startAt.getDay()];
  const dateStr = startAt.toISOString().slice(0, 10);
  const timeStr = "10:00";

  const avail = await prisma.pTAvailability.create({
    data: { ptUserId, dayOfWeek, startTime: "00:00", endTime: "23:59", isActive: true },
  });

  // Real wall-clock timing between two independent calls is not reliable enough to prove a
  // race deterministically — depending on how fast this machine's Postgres round-trips are,
  // the two calls might happen to interleave far enough apart that one naturally finishes
  // before the other even reaches its conflict check, which would "pass" this test even with
  // no lock at all. Forcing an artificial pause inside the conflict check widens the TOCTOU
  // window to something both concurrent calls are guaranteed to land inside — UNLESS the fix
  // acquires a lock before ever reaching this check, in which case the second call blocks at
  // the lock and does not even start this delay until the first has already committed.
  const originalFindConflict = sessionRepository.findConflict.bind(sessionRepository);
  const restoreFindConflict = patch(sessionRepository, "findConflict", async (...args: any[]) => {
    await sleep(300);
    return (originalFindConflict as any)(...args);
  });

  try {
    const [r1, r2] = await Promise.allSettled([
      (bookingService as any).bookSession(contractA.clientUserId, contractA.id, {
        scheduledDate: dateStr,
        scheduledTime: timeStr,
      }),
      (bookingService as any).bookSession(contractB.clientUserId, contractB.id, {
        scheduledDate: dateStr,
        scheduledTime: timeStr,
      }),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "chỉ MỘT trong hai request đồng thời được tạo session — không được cả hai cùng thành công");
    assert.equal(rejected.length, 1);
    if (rejected[0].status === "rejected") {
      assert.match((rejected[0].reason as Error).message, /conflict/i);
    }

    const sessions = await prisma.session.findMany({ where: { ptUserId } });
    assert.equal(sessions.length, 1, "chỉ đúng một session được ghi vào DB cho khung giờ này — không có bản ghi chồng giờ do race");
  } finally {
    restoreFindConflict();
    await prisma.pTAvailability.delete({ where: { id: avail.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contractA.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contractB.id } }).catch(() => {});
  }
});
