/**
 * Daily cap (a pending REQUESTED session counts) + batch booking (POST /sessions/batch, all-or-nothing).
 *
 * BACKEND INTEGRATION on a `*_test` database (skipped elsewhere, see test-db-guard.ts): bookSession / bookSessionsBatch run for
 * real, including the PT advisory lock, the client schedule lock and the INSERTs. Only the notification boundary is stubbed.
 *
 * Before the fix: a client could create any number of REQUESTED sessions on one day (the cap did not exist), and booking several
 * slots meant one request per slot with no all-or-nothing guarantee.
 */
import { guardedTest as dbTest } from "./test-db-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ContractSource, ContractStatus, DayOfWeek, SessionMode, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { notificationService } from "../services/notification.service";
import { bookingService } from "../services/booking.service";
import { BATCH_BOOKING_REJECTED, CLIENT_DAILY_SESSION_LIMIT } from "../services/session-booking-rules";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
installAccountsActive();

const contractIds: string[] = [];
const ptIds: string[] = [];
const notifications: any[] = [];
const original = notificationService.create;
(notificationService as any).create = async (n: any) => {
  notifications.push(n);
  return {};
};

const DAYS: DayOfWeek[] = [
  DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY,
];

async function seedPt(): Promise<string> {
  const ptUserId = randomUUID();
  ptIds.push(ptUserId);
  for (const dayOfWeek of DAYS) {
    await prisma.pTAvailability.create({ data: { ptUserId, dayOfWeek, startTime: "00:00", endTime: "23:59", isActive: true } });
  }
  return ptUserId;
}

async function seedContract(ptUserId: string, clientUserId: string, totalSessions = 10) {
  const row = await prisma.contract.create({
    data: {
      id: randomUUID(), ptUserId, clientUserId, packageName: "Seed", totalSessions, usedSessions: 0, compensatedSessions: 0,
      price: 1_000_000, status: ContractStatus.ACTIVE, source: ContractSource.INDEPENDENT, sessionMode: SessionMode.OFFLINE,
      sessionDurationMinutes: 60,
    },
  });
  contractIds.push(row.id);
  return row;
}

/** `offset` days after a point at least 10 days away, "YYYY-MM-DD" (local). */
function day(offset: number): string {
  const d = new Date(Date.now() + (10 + offset) * 24 * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const slot = (offset: number, time: string) => ({ scheduledDate: day(offset), scheduledTime: time });
const sessionsOf = (contractId: string) => prisma.session.findMany({ where: { contractId }, orderBy: { scheduledStartAt: "asc" } });

dbTest.after(async () => {
  (notificationService as any).create = original;
  await prisma.session.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.pTAvailability.deleteMany({ where: { ptUserId: { in: ptIds } } });
  await prisma.$disconnect();
});

dbTest("daily cap: two REQUESTED sessions fill the day, the third is refused 409 CLIENT_DAILY_SESSION_LIMIT, other days stay open", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  await bookingService.bookSession(client, c.id, slot(0, "07:00"));
  await bookingService.bookSession(client, c.id, slot(0, "09:00"));
  await assert.rejects(
    bookingService.bookSession(client, c.id, slot(0, "17:00")),
    (e: any) => e.status === 409 && e.code === CLIENT_DAILY_SESSION_LIMIT && /tối đa 2 buổi/.test(e.message),
  );
  await bookingService.bookSession(client, c.id, slot(1, "07:00"));
  const rows = await sessionsOf(c.id);
  assert.deepEqual(rows.map((r) => r.status), [SessionStatus.REQUESTED, SessionStatus.REQUESTED, SessionStatus.REQUESTED]);
});

dbTest("daily cap: a CANCELLED session frees its place", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  const a = await bookingService.bookSession(client, c.id, slot(0, "07:00"));
  await bookingService.bookSession(client, c.id, slot(0, "09:00"));
  await prisma.session.update({ where: { id: a.id }, data: { status: SessionStatus.CANCELLED } });
  await bookingService.bookSession(client, c.id, slot(0, "11:00"));
});

dbTest("daily cap: 6 concurrent bookings on one day (two PTs) -> exactly 2 succeed", async () => {
  const pt1 = await seedPt();
  const pt2 = await seedPt();
  const client = randomUUID();
  const c1 = await seedContract(pt1, client);
  const c2 = await seedContract(pt2, client);
  const times = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00"];
  const results = await Promise.allSettled(
    times.map((t, i) => bookingService.bookSession(client, i % 2 ? c2.id : c1.id, slot(0, t))),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.ok(failed.every((r) => r.reason?.code === CLIENT_DAILY_SESSION_LIMIT));
  const live = await prisma.session.count({ where: { clientUserId: client } });
  assert.equal(live, 2);
});

dbTest("batch: slots on different days are created together, the PT gets ONE summary notification", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  notifications.length = 0;
  const out = await bookingService.bookSessionsBatch(client, c.id, { slots: [slot(0, "07:00"), slot(1, "07:00"), slot(2, "18:00")] });
  assert.equal(out.length, 3);
  assert.equal((await sessionsOf(c.id)).length, 3);
  const toPt = notifications.filter((n) => n.userId === pt);
  assert.equal(toPt.length, 1);
  assert.match(toPt[0].text, /3 buổi/);
});

dbTest("batch: all-or-nothing - three slots on one day -> the 3rd is refused per slot and NOTHING is created", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  await assert.rejects(
    bookingService.bookSessionsBatch(client, c.id, { slots: [slot(0, "07:00"), slot(0, "09:00"), slot(0, "11:00"), slot(1, "07:00")] }),
    (e: any) =>
      e.status === 409 &&
      e.code === BATCH_BOOKING_REJECTED &&
      e.slotErrors.length === 1 &&
      e.slotErrors[0].index === 2 &&
      e.slotErrors[0].code === CLIENT_DAILY_SESSION_LIMIT,
  );
  assert.equal((await sessionsOf(c.id)).length, 0);
});

dbTest("batch: the cap also counts sessions the client already has (pending ones included)", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  await bookingService.bookSession(client, c.id, slot(0, "07:00"));
  await assert.rejects(
    bookingService.bookSessionsBatch(client, c.id, { slots: [slot(0, "09:00"), slot(0, "11:00")] }),
    (e: any) => e.slotErrors.length === 1 && e.slotErrors[0].index === 1 && e.slotErrors[0].code === CLIENT_DAILY_SESSION_LIMIT,
  );
  assert.equal((await sessionsOf(c.id)).length, 1);
});

dbTest("batch: a duplicate slot, a slot overlapping another PT's session of the client, and an occupied PT slot are reported per slot", async () => {
  const pt = await seedPt();
  const otherPt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  const other = await seedContract(otherPt, client);
  await bookingService.bookSession(client, other.id, slot(3, "07:00")); // the client's OTHER PT, same hour
  const rival = randomUUID();
  const rivalContract = await seedContract(pt, rival);
  await bookingService.bookSession(rival, rivalContract.id, slot(4, "07:00")); // PT already taken at that hour
  await assert.rejects(
    bookingService.bookSessionsBatch(client, c.id, {
      slots: [slot(5, "07:00"), slot(5, "07:00"), slot(3, "07:00"), slot(4, "07:00")],
    }),
    (e: any) => {
      const byIndex = Object.fromEntries(e.slotErrors.map((s: any) => [s.index, s]));
      return (
        e.status === 409 &&
        Object.keys(byIndex).join() === "1,2,3" &&
        byIndex[1].code === "BATCH_DUPLICATE_SLOT" &&
        byIndex[2].code === "CLIENT_SCHEDULE_CONFLICT" &&
        /trùng/.test(byIndex[3].message)
      );
    },
  );
  assert.equal((await sessionsOf(c.id)).length, 0);
});

dbTest("batch: more slots than the contract has sessions left -> refused, nothing created", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client, 2);
  await assert.rejects(
    bookingService.bookSessionsBatch(client, c.id, { slots: [slot(0, "07:00"), slot(1, "07:00"), slot(2, "07:00")] }),
    (e: any) => e.code === BATCH_BOOKING_REJECTED && e.slotErrors.length === 1 && e.slotErrors[0].index === 2 && /chỉ còn 2 buổi/.test(e.slotErrors[0].message),
  );
  assert.equal((await sessionsOf(c.id)).length, 0);
});

dbTest("batch: inside 24 h is refused per slot; an empty or oversized batch is 400; another client's contract is 403", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  const soon = new Date(Date.now() + 2 * 3600_000);
  const soonSlot = {
    scheduledDate: `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`,
    scheduledTime: `${String(soon.getHours()).padStart(2, "0")}:00`,
  };
  await assert.rejects(
    bookingService.bookSessionsBatch(client, c.id, { slots: [soonSlot, slot(0, "07:00")] }),
    (e: any) => e.status === 400 && e.slotErrors.length === 1 && e.slotErrors[0].index === 0 && /24 giờ|quá khứ/.test(e.slotErrors[0].message),
  );
  await assert.rejects(bookingService.bookSessionsBatch(client, c.id, { slots: [] }), (e: any) => e.status === 400 && e.code === "BATCH_EMPTY");
  await assert.rejects(
    bookingService.bookSessionsBatch(client, c.id, { slots: Array.from({ length: 11 }, (_, i) => slot(i, "07:00")) }),
    (e: any) => e.status === 400 && e.code === "BATCH_TOO_LARGE",
  );
  await assert.rejects(bookingService.bookSessionsBatch(randomUUID(), c.id, { slots: [slot(0, "07:00")] }), (e: any) => e.status === 403);
  assert.equal((await sessionsOf(c.id)).length, 0);
});

// ── Daily cap applies to rescheduling too (owner decision 19/11/2026) ─────────────────────────────────────────────────────────
const iso = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00`).toISOString();
const confirm = (id: string) => prisma.session.update({ where: { id }, data: { status: SessionStatus.CONFIRMED } });
const isCap = (e: any) => e.status === 409 && e.code === CLIENT_DAILY_SESSION_LIMIT && /tối đa 2 buổi/.test(e.message);

dbTest("reschedule request: a move onto a day already holding 2 live sessions is refused 409 CLIENT_DAILY_SESSION_LIMIT (client and PT proposer); a day with 1 is fine", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  await bookingService.bookSession(client, c.id, slot(0, "07:00"));
  await bookingService.bookSession(client, c.id, slot(0, "09:00"));
  const moving = await bookingService.bookSession(client, c.id, slot(2, "07:00"));
  await confirm(moving.id);
  await assert.rejects(bookingService.requestReschedule(moving.id, client, { proposedStartAt: iso(0, "15:00"), reason: "doi gio" }), isCap);
  await assert.rejects(bookingService.requestReschedule(moving.id, pt, { proposedStartAt: iso(0, "15:00"), reason: "doi gio" }), isCap);
  assert.equal(await prisma.sessionRescheduleRequest.count({ where: { sessionId: moving.id } }), 0);
  // A day with only 1 other session still has room.
  await bookingService.bookSession(client, c.id, slot(3, "07:00"));
  const ok = await bookingService.requestReschedule(moving.id, client, { proposedStartAt: iso(3, "15:00"), reason: "doi gio" });
  assert.equal(ok.status, "PENDING");
});

dbTest("reschedule request: the session being moved does not count against its own target day (move within a full day is allowed)", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  const a = await bookingService.bookSession(client, c.id, slot(0, "07:00"));
  await bookingService.bookSession(client, c.id, slot(0, "09:00"));
  await confirm(a.id);
  const req = await bookingService.requestReschedule(a.id, client, { proposedStartAt: iso(0, "16:00"), reason: "doi gio" });
  assert.equal(req.status, "PENDING");
});

dbTest("reschedule accept: re-checks the cap under the lock - a booking made after the proposal that filled the target day makes ACCEPT 409 and nothing moves", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  await bookingService.bookSession(client, c.id, slot(0, "07:00"));
  const moving = await bookingService.bookSession(client, c.id, slot(2, "07:00"));
  await confirm(moving.id);
  // Proposed by the CLIENT while the target day still has room (1 session) ...
  const req = await bookingService.requestReschedule(moving.id, client, { proposedStartAt: iso(0, "15:00"), reason: "doi gio" });
  // ... then another booking fills it (2 live), so the PT's accept must be refused.
  await bookingService.bookSession(client, c.id, slot(0, "11:00"));
  await assert.rejects(bookingService.respondToReschedule(req.id, pt, "ACCEPT"), isCap);
  const after = await prisma.session.findUniqueOrThrow({ where: { id: moving.id } });
  assert.equal(after.scheduledStartAt.toISOString(), new Date(`${day(2)}T07:00:00`).toISOString());
  assert.equal((await prisma.sessionRescheduleRequest.findUniqueOrThrow({ where: { id: req.id } })).status, "PENDING");
});

dbTest("reschedule accept (PT-proposed, CLIENT accepts): refused when the target day is full at accept time, allowed when it has room", async () => {
  const pt = await seedPt();
  const client = randomUUID();
  const c = await seedContract(pt, client);
  await bookingService.bookSession(client, c.id, slot(0, "07:00"));
  const moving = await bookingService.bookSession(client, c.id, slot(2, "07:00"));
  await confirm(moving.id);
  const req = await bookingService.requestReschedule(moving.id, pt, { proposedStartAt: iso(0, "15:00"), reason: "pt ban" });
  const filler = await bookingService.bookSession(client, c.id, slot(0, "11:00"));
  await assert.rejects(bookingService.respondToReschedule(req.id, client, "ACCEPT"), isCap);
  // The filler is cancelled -> room again -> the same accept now succeeds.
  await prisma.session.update({ where: { id: filler.id }, data: { status: SessionStatus.CANCELLED } });
  await bookingService.respondToReschedule(req.id, client, "ACCEPT");
  const after = await prisma.session.findUniqueOrThrow({ where: { id: moving.id } });
  assert.equal(after.scheduledStartAt.toISOString(), iso(0, "15:00"));
});
