/**
 * Client có tối đa 2 PT cùng lúc + Client không thể ở hai buổi tập cùng giờ (với hai PT khác nhau).
 *
 * BACKEND INTEGRATION trên DB `*_test`: requestContract / bookSession / requestReschedule chạy thật, gồm khóa advisory
 * và câu INSERT thật. Chỉ stub phần đọc gói / hồ sơ PT / lịch rảnh / thông báo ở ranh giới repository như các test cùng loại.
 *
 * Trước khi sửa: Client có hợp đồng với bao nhiêu PT cũng được; đặt PT1 thứ Bảy 07:00 và PT2 cùng 07:00 đều thành công
 * (khóa và truy vấn trùng lịch chỉ theo PT), kể cả khi gửi đồng thời.
 */
import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ContractSource, ContractStatus, DayOfWeek, Prisma, SessionMode, SessionStatus } from "../generated/prisma";
import { prisma, profileRepository } from "../repositories/profile.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { sessionRepository } from "../repositories/session.repository";
import { contractRepository } from "../repositories/contract.repository";
import { availabilityService } from "../services/availability.service";
import { contractGymOptionsService } from "../services/contract-gym-options.service";
import { gymClient } from "../clients/gym.client";
import { notificationService } from "../services/notification.service";
import { contractService, CLIENT_PT_LIMIT_REACHED } from "../services/contract.service";
import { bookingService, CLIENT_SCHEDULE_CONFLICT } from "../services/booking.service";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
installAccountsActive();

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}
function makeBarrier(n: number, timeoutMs: number) {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return async () => {
    if (++arrived >= n) release();
    await Promise.race([gate, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  };
}

const DAY_MAP: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUNDAY, 1: DayOfWeek.MONDAY, 2: DayOfWeek.TUESDAY, 3: DayOfWeek.WEDNESDAY,
  4: DayOfWeek.THURSDAY, 5: DayOfWeek.FRIDAY, 6: DayOfWeek.SATURDAY,
};

const contractIds: string[] = [];
const ptIds: string[] = [];

function stubRequestDeps(ptUserId: string) {
  const packageId = randomUUID();
  const pkg = {
    id: packageId, ptUserId, name: "Goi 10 buoi", sessionCount: 10, price: new Prisma.Decimal("5000000"),
    sessionMode: SessionMode.OFFLINE, sessionDurationMinutes: 60, validityDays: null,
    isActive: true, archivedAt: null, version: 1,
  };
  const restores = [
    patch(ptServicePackageRepository, "findById", async () => pkg),
    patch(ptServicePackageRepository, "findByIdForShare", async () => pkg),
    patch(profileRepository, "findByUserId", async () => ({ isPT: true, ptSuspended: false, isAcceptingClients: true })),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(notificationService, "create", async () => ({})),
  ];
  return { packageId, restore: () => restores.forEach((r) => r()) };
}

async function seedContract(ptUserId: string, clientUserId: string, status: ContractStatus, source: ContractSource = ContractSource.INDEPENDENT) {
  const row = await prisma.contract.create({
    data: {
      id: randomUUID(), ptUserId, clientUserId, packageName: "Seed", totalSessions: 10, usedSessions: 0,
      compensatedSessions: 0, price: 1_000_000, status, source, sessionDurationMinutes: 60,
    },
  });
  contractIds.push(row.id);
  return row;
}

async function openAllDay(ptUserId: string, day: Date) {
  ptIds.push(ptUserId);
  await prisma.pTAvailability.create({
    data: { ptUserId, dayOfWeek: DAY_MAP[day.getDay()], startTime: "00:00", endTime: "23:59", isActive: true },
  });
}

/** A Saturday at least 10 days ahead, at 07:00 local. */
function saturday7am(): Date {
  const d = new Date(Date.now() + 10 * 24 * 3600_000);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  d.setHours(7, 0, 0, 0);
  return d;
}
const dateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const book = (clientUserId: string, contractId: string, day: Date, time: string) =>
  (bookingService as any).bookSession(clientUserId, contractId, { scheduledDate: dateStr(day), scheduledTime: time });
const isCode = (code: string) => (e: any) => e?.status === 409 && e?.code === code;

dbTest.after(async () => {
  await prisma.session.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.pTAvailability.deleteMany({ where: { ptUserId: { in: ptIds } } });
  await prisma.$disconnect();
});

// ── Giới hạn 2 PT ────────────────────────────────────────────────

dbTest("PT limit: client with live contracts at 2 other PTs (pending counts) cannot request a 3rd PT", async () => {
  const clientUserId = randomUUID();
  await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  await seedContract(randomUUID(), clientUserId, ContractStatus.PENDING_PAYMENT);
  const pt3 = randomUUID();
  const { packageId, restore } = stubRequestDeps(pt3);
  try {
    await assert.rejects(() => contractService.requestContract(clientUserId, { ptUserId: pt3, packageId }), isCode(CLIENT_PT_LIMIT_REACHED));
    assert.equal(await prisma.contract.count({ where: { clientUserId, ptUserId: pt3 } }), 0);
  } finally {
    restore();
  }
});

dbTest("PT limit: 1 other live PT -> a 2nd PT is allowed; terminal and marketplace contracts do not take a slot", async () => {
  const clientUserId = randomUUID();
  await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  await seedContract(randomUUID(), clientUserId, ContractStatus.COMPLETED);
  await seedContract(randomUUID(), clientUserId, ContractStatus.CANCELLED);
  await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE, ContractSource.MARKETPLACE);
  const pt2 = randomUUID();
  const { packageId, restore } = stubRequestDeps(pt2);
  try {
    const c = await contractService.requestContract(clientUserId, { ptUserId: pt2, packageId });
    contractIds.push(c.id);
    assert.equal(c.status, ContractStatus.PENDING_REVIEW);
  } finally {
    restore();
  }
});

dbTest("PT limit: two concurrent requests to two different PTs while 1 PT is already live -> exactly one wins", async () => {
  const clientUserId = randomUUID();
  await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  const ptA = randomUUID();
  const ptB = randomUUID();
  // One stub that answers for both PTs' packages, with a pause inside the locked section to force the overlap.
  const pkgFor = (ptUserId: string, id: string) => ({
    id, ptUserId, name: "Goi", sessionCount: 10, price: new Prisma.Decimal("5000000"), sessionMode: SessionMode.OFFLINE,
    sessionDurationMinutes: 60, validityDays: null, isActive: true, archivedAt: null, version: 1,
  });
  const idA = randomUUID();
  const idB = randomUUID();
  const lookup = (id: string) => (id === idA ? pkgFor(ptA, idA) : pkgFor(ptB, idB));
  const barrier = makeBarrier(2, 500);
  const original = contractRepository.findOtherLivePtsForClient.bind(contractRepository);
  const restores = [
    patch(ptServicePackageRepository, "findById", async (id: string) => lookup(id)),
    patch(ptServicePackageRepository, "findByIdForShare", async (id: string) => lookup(id)),
    // Only the in-transaction re-count (2nd call of each request) waits at the barrier.
    patch(contractRepository, "findOtherLivePtsForClient", async (...args: any[]) => {
      if (args[2]) await barrier();
      return (original as any)(...args);
    }),
    patch(profileRepository, "findByUserId", async () => ({ isPT: true, ptSuspended: false, isAcceptingClients: true })),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(notificationService, "create", async () => ({})),
  ];
  try {
    const results = await Promise.allSettled([
      contractService.requestContract(clientUserId, { ptUserId: ptA, packageId: idA }),
      contractService.requestContract(clientUserId, { ptUserId: ptB, packageId: idB }),
    ]);
    const rows = await prisma.contract.findMany({ where: { clientUserId, ptUserId: { in: [ptA, ptB] } } });
    rows.forEach((r) => contractIds.push(r.id));
    assert.equal(rows.length, 1, "only one of the two concurrent requests may take the 2nd slot");
    const loser = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.ok(loser && isCode(CLIENT_PT_LIMIT_REACHED)(loser.reason), `loser must be 409 ${CLIENT_PT_LIMIT_REACHED}`);
  } finally {
    restores.forEach((r) => r());
  }
});

// ── Trùng lịch của Client ───────────────────────────────────────

dbTest("Client schedule: PT1 Sat 07:00 (REQUESTED) blocks PT2 Sat 07:00 and 07:30; 08:00 with PT2 is allowed", async () => {
  const clientUserId = randomUUID();
  const day = saturday7am();
  const c1 = await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  const c2 = await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  await openAllDay(c1.ptUserId, day);
  await openAllDay(c2.ptUserId, day);
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    const s1 = await book(clientUserId, c1.id, day, "07:00");
    assert.equal(s1.status, SessionStatus.REQUESTED);
    await assert.rejects(() => book(clientUserId, c2.id, day, "07:00"), isCode(CLIENT_SCHEDULE_CONFLICT));
    await assert.rejects(() => book(clientUserId, c2.id, day, "07:30"), isCode(CLIENT_SCHEDULE_CONFLICT));
    const s2 = await book(clientUserId, c2.id, day, "08:00");
    assert.equal(s2.status, SessionStatus.REQUESTED, "two sessions with two PTs on the same day, back to back, are fine");
  } finally {
    restore();
  }
});

dbTest("Client schedule: a CANCELLED session no longer holds the client's slot", async () => {
  const clientUserId = randomUUID();
  const day = saturday7am();
  const c1 = await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  const c2 = await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  await openAllDay(c2.ptUserId, day);
  await prisma.session.create({
    data: {
      contractId: c1.id, clientUserId, ptUserId: c1.ptUserId, status: SessionStatus.CANCELLED,
      scheduledStartAt: day, scheduledEndAt: new Date(day.getTime() + 3600_000),
    },
  });
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    const s = await book(clientUserId, c2.id, day, "07:00");
    assert.equal(s.status, SessionStatus.REQUESTED);
  } finally {
    restore();
  }
});

dbTest("Client schedule: PT1 and PT2 booked at Sat 07:00 CONCURRENTLY -> exactly one session is created", async () => {
  const clientUserId = randomUUID();
  const day = saturday7am();
  const c1 = await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  const c2 = await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  await openAllDay(c1.ptUserId, day);
  await openAllDay(c2.ptUserId, day);
  // Force the race instead of leaving it to timing: each call waits here until both have arrived (or 500 ms passed).
  // Without the client lock both arrive together and both pass; with it the 2nd waits on the lock, the timeout lets
  // the 1st through, and the 2nd then sees its committed row.
  const barrier = makeBarrier(2, 500);
  const original = sessionRepository.findClientConflict.bind(sessionRepository);
  const restores = [
    patch(sessionRepository, "findClientConflict", async (...args: any[]) => {
      await barrier();
      return (original as any)(...args);
    }),
    patch(notificationService, "create", async () => ({})),
  ];
  try {
    const results = await Promise.allSettled([book(clientUserId, c1.id, day, "07:00"), book(clientUserId, c2.id, day, "07:00")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const loser = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.ok(loser && isCode(CLIENT_SCHEDULE_CONFLICT)(loser.reason), `loser must be 409 ${CLIENT_SCHEDULE_CONFLICT}, got ${(loser as any)?.reason?.message}`);
    assert.equal(await prisma.session.count({ where: { clientUserId, status: SessionStatus.REQUESTED } }), 1);
  } finally {
    restores.forEach((r) => r());
  }
});

dbTest("Client schedule: a reschedule cannot move a PT2 session onto the client's PT1 session", async () => {
  const clientUserId = randomUUID();
  const day = saturday7am();
  const c1 = await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  const c2 = await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  await openAllDay(c1.ptUserId, day);
  await openAllDay(c2.ptUserId, day);
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    await book(clientUserId, c1.id, day, "07:00");
    const s2 = await book(clientUserId, c2.id, day, "09:00");
    await prisma.session.update({ where: { id: s2.id }, data: { status: SessionStatus.CONFIRMED } });
    await assert.rejects(
      () => (bookingService as any).requestReschedule(s2.id, clientUserId, { proposedStartAt: day.toISOString(), reason: "doi gio" }),
      isCode(CLIENT_SCHEDULE_CONFLICT),
    );
  } finally {
    restore();
  }
});

// ── Màn chọn phòng gym ──────────────────────────────────────────

dbTest("Gym options: a client already at the PT limit gets requestBlockedReason CLIENT_PT_LIMIT_REACHED before sending", async () => {
  const clientUserId = randomUUID();
  await seedContract(randomUUID(), clientUserId, ContractStatus.ACTIVE);
  await seedContract(randomUUID(), clientUserId, ContractStatus.PENDING_REVIEW);
  const pt3 = randomUUID();
  const { packageId, restore } = stubRequestDeps(pt3);
  const restores: Array<() => void> = [];
  try {
    const r = await contractGymOptionsService.getGymOptions(clientUserId, { ptUserId: pt3, packageId });
    assert.equal(r.requestBlockedReason, CLIENT_PT_LIMIT_REACHED);
    assert.equal(r.gymsReason, "REQUEST_BLOCKED");
    restores.push(patch(gymClient, "listAcceptedGymsForPt", async () => []));
    const ok = await contractGymOptionsService.getGymOptions(randomUUID(), { ptUserId: pt3, packageId });
    assert.equal(ok.requestBlockedReason, null, "a client with no other PT is not blocked");
  } finally {
    restore();
    restores.forEach((r) => r());
  }
});
