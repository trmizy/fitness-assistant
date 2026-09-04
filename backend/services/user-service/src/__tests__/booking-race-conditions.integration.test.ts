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
import { contractRepository } from "../repositories/contract.repository";
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

/**
 * Vòng 4 — Phase A. Ba lỗi tương tranh khác trong cùng file, cùng khuôn mẫu kiểm tra thật với
 * Postgres đã dùng ở trên: không mock, race giả lập bằng patch() + sleep() để widening cửa sổ
 * TOCTOU một cách xác định, dọn dữ liệu trong finally.
 *
 * A1 — cancelSession nhánh CONFIRMED ghi qua `updateStatus` (không điều kiện trạng thái) rồi
 * mới gọi contractRepository.incrementSession — hai request huỷ đồng thời cùng một session đều
 * đọc thấy CONFIRMED, đều ghi CANCELLED, đều cộng usedSessions. Đây là đường DUY NHẤT tăng
 * usedSessions không qua claimDeduction/settleTracked nào cả.
 *
 * A2 — confirmSession không chạy trong withPtScheduleLock và không kiểm tra lại contract
 * (status/endDate/ptSuspended/entitlement) — chỉ kiểm session.status + xung đột giờ, cả hai đều
 * đọc trước lock.
 *
 * A3 — bookSession đọc contract TRƯỚC khi vào lock rồi vẫn dùng bản đọc đó (không phải bản đọc
 * lại bằng tx) để tính entitlement bên TRONG lock — nửa dữ liệu tươi (activeSessionCount qua
 * tx), nửa dữ liệu cũ (contract), nên lock không có tác dụng bảo vệ phép so sánh này.
 */

test("A1 — hai cancelSession đồng thời trên cùng một session CONFIRMED — usedSessions chỉ tăng đúng một lần, request thua nhận 409", async () => {
  const contract = await makeActiveContract();
  // Trong 24h (isLate=true cho actor CLIENT) để resolveSessionOutcome trả về clientQuotaEffect
  // DEDUCT — đúng nhánh có lỗ hổng đang kiểm tra.
  const startAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      contractId: contract.id,
      clientUserId: contract.clientUserId,
      ptUserId: contract.ptUserId,
      scheduledStartAt: startAt,
      scheduledEndAt: new Date(startAt.getTime() + 3600_000),
      status: SessionStatus.CONFIRMED,
    },
  });

  // Cùng lý do widening cửa sổ race đã giải thích ở B2 phía trên: không có gì đảm bảo hai lệnh
  // gọi độc lập tự nhiên chồng lên nhau đủ để lộ lỗi nếu không ép buộc.
  const originalFindById = sessionRepository.findById.bind(sessionRepository);
  const restoreFindById = patch(sessionRepository, "findById", async (...args: any[]) => {
    await sleep(200);
    return (originalFindById as any)(...args);
  });

  try {
    const [r1, r2] = await Promise.allSettled([
      bookingService.cancelSession(session.id, contract.clientUserId, "Bận việc đột xuất"),
      bookingService.cancelSession(session.id, contract.clientUserId, "Bận việc đột xuất"),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "chỉ một trong hai lần huỷ đồng thời được xử lý — không được cả hai");
    assert.equal(rejected.length, 1);
    if (rejected[0].status === "rejected") {
      assert.equal((rejected[0].reason as any).status, 409, "yêu cầu thua CAS phải nhận 409, không phải lỗi khác hay im lặng thành công");
    }

    const updatedContract = await prisma.contract.findUnique({ where: { id: contract.id } });
    assert.equal(updatedContract?.usedSessions, 1, "usedSessions phải tăng đúng 1 — đây chính là lỗi double-deduct nếu ra 2");
  } finally {
    restoreFindById();
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});

test("A2 — confirmSession bị từ chối khi hợp đồng đã CANCELLED", async () => {
  const contract = await makeActiveContract({ status: "CANCELLED" });
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      contractId: contract.id,
      clientUserId: contract.clientUserId,
      ptUserId: contract.ptUserId,
      scheduledStartAt: startAt,
      scheduledEndAt: new Date(startAt.getTime() + 3600_000),
      status: SessionStatus.REQUESTED,
    },
  });

  try {
    await assert.rejects(
      () => bookingService.confirmSession(session.id, contract.ptUserId),
      (e: any) => {
        assert.equal(e.status, 409);
        return true;
      },
    );
    const unchanged = await prisma.session.findUnique({ where: { id: session.id } });
    assert.equal(unchanged?.status, SessionStatus.REQUESTED, "session không được đổi trạng thái khi hợp đồng đã huỷ");
  } finally {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});

test("A2 — confirmSession bị từ chối khi hợp đồng đã quá endDate", async () => {
  const contract = await makeActiveContract({ endDate: new Date(Date.now() - 24 * 60 * 60 * 1000) });
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      contractId: contract.id,
      clientUserId: contract.clientUserId,
      ptUserId: contract.ptUserId,
      scheduledStartAt: startAt,
      scheduledEndAt: new Date(startAt.getTime() + 3600_000),
      status: SessionStatus.REQUESTED,
    },
  });

  try {
    await assert.rejects(
      () => bookingService.confirmSession(session.id, contract.ptUserId),
      (e: any) => {
        assert.equal(e.status, 409);
        return true;
      },
    );
    const unchanged = await prisma.session.findUnique({ where: { id: session.id } });
    assert.equal(unchanged?.status, SessionStatus.REQUESTED);
  } finally {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});

test("A2 — confirmSession bị từ chối khi PT đã bị khoá (ptSuspended)", async () => {
  const contract = await makeActiveContract();
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      contractId: contract.id,
      clientUserId: contract.clientUserId,
      ptUserId: contract.ptUserId,
      scheduledStartAt: startAt,
      scheduledEndAt: new Date(startAt.getTime() + 3600_000),
      status: SessionStatus.REQUESTED,
    },
  });
  const profile = await prisma.userProfile.create({
    data: { userId: contract.ptUserId, ptSuspended: true },
  });

  try {
    await assert.rejects(
      () => bookingService.confirmSession(session.id, contract.ptUserId),
      (e: any) => {
        assert.equal(e.status, 409);
        return true;
      },
    );
    const unchanged = await prisma.session.findUnique({ where: { id: session.id } });
    assert.equal(unchanged?.status, SessionStatus.REQUESTED);
  } finally {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
    await prisma.userProfile.delete({ where: { id: profile.id } }).catch(() => {});
  }
});

test("A2 — hai confirmSession cho hai session khác nhau cùng khung giờ của cùng một PT — chỉ một thành công", async () => {
  const ptUserId = randomUUID();
  const contractA = await makeActiveContract({ ptUserId });
  const contractB = await makeActiveContract({ ptUserId });
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + 3600_000);

  const sessionA = await prisma.session.create({
    data: {
      contractId: contractA.id, clientUserId: contractA.clientUserId, ptUserId,
      scheduledStartAt: startAt, scheduledEndAt: endAt, status: SessionStatus.REQUESTED,
    },
  });
  const sessionB = await prisma.session.create({
    data: {
      contractId: contractB.id, clientUserId: contractB.clientUserId, ptUserId,
      scheduledStartAt: startAt, scheduledEndAt: endAt, status: SessionStatus.REQUESTED,
    },
  });

  try {
    const [r1, r2] = await Promise.allSettled([
      bookingService.confirmSession(sessionA.id, ptUserId),
      bookingService.confirmSession(sessionB.id, ptUserId),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "chỉ một trong hai session cùng khung giờ được CONFIRMED — PT không thể ở hai nơi cùng lúc");
    assert.equal(rejected.length, 1);

    const confirmedCount = await prisma.session.count({
      where: { id: { in: [sessionA.id, sessionB.id] }, status: SessionStatus.CONFIRMED },
    });
    assert.equal(confirmedCount, 1);
  } finally {
    await prisma.session.deleteMany({ where: { id: { in: [sessionA.id, sessionB.id] } } });
    await prisma.contract.delete({ where: { id: contractA.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contractB.id } }).catch(() => {});
  }
});

test("A3 — bookSession: hợp đồng bị dùng hết quyền lợi đúng lúc giữa lần đọc trước-lock và lúc vào lock — bị chặn, không tạo session", async () => {
  const ptUserId = randomUUID();
  const contract = await makeActiveContract({ ptUserId, totalSessions: 1, usedSessions: 0 });

  const startAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  startAt.setHours(10, 0, 0, 0);
  const dayOfWeek = DAY_MAP[startAt.getDay()];
  const dateStr = startAt.toISOString().slice(0, 10);

  const avail = await prisma.pTAvailability.create({
    data: { ptUserId, dayOfWeek, startTime: "00:00", endTime: "23:59", isActive: true },
  });

  // Mô phỏng đúng kịch bản A3 nêu: contractRepository.findById gọi KHÔNG kèm `db` (tham số thứ
  // hai) chính là lần đọc trước-lock trong bookSession — ngay sau lần đọc đó, "một buổi khác
  // trên cùng hợp đồng" dùng hết quyền lợi còn lại, trước khi request hiện tại kịp vào lock.
  const originalFindById = contractRepository.findById.bind(contractRepository);
  const restoreFindById = patch(contractRepository, "findById", async (id: string, db?: any) => {
    const result = await originalFindById(id, db);
    if (!db) {
      await prisma.contract.update({ where: { id }, data: { usedSessions: { increment: 1 } } });
    }
    return result;
  });

  try {
    await assert.rejects(
      () =>
        (bookingService as any).bookSession(contract.clientUserId, contract.id, {
          scheduledDate: dateStr,
          scheduledTime: "10:00",
        }),
      (e: any) => {
        assert.equal(e.status, 400);
        assert.match(e.message, /limit reached/i);
        return true;
      },
    );

    const sessions = await prisma.session.findMany({ where: { contractId: contract.id } });
    assert.equal(sessions.length, 0, "không được tạo session nào — bản sửa phải đọc lại contract TRONG lock và thấy entitlement đã hết");
  } finally {
    restoreFindById();
    await prisma.pTAvailability.delete({ where: { id: avail.id } }).catch(() => {});
    await prisma.contract.delete({ where: { id: contract.id } }).catch(() => {});
  }
});
