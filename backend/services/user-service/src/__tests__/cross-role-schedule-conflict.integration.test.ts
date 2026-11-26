/**
 * A PT who also trains as a client of another PT is ONE person with ONE clock.
 *
 * BACKEND INTEGRATION on the isolated `*_test` database: bookSession / bookSessionsBatch / confirmSession / requestReschedule /
 * respondToReschedule / getAvailableSlots / getMyUpcoming run for real (advisory locks and INSERTs included). Only the
 * notification boundary is stubbed, like the sibling client-multi-pt-schedule-guard suite.
 *
 * Before the fix: PT A teaching C at 07:00 could still book PT B at 07:00 as a client (and the reverse) - the PT-side check
 * filtered `where ptUserId`, the client-side check `where clientUserId`, and they never looked at each other. The slot list
 * offered the busy hour as well, and the two roles took two unrelated locks.
 *
 * Stable code: 409 SCHEDULE_CONFLICT_OTHER_ROLE (same-role overlaps keep CLIENT_SCHEDULE_CONFLICT / the plain PT 409).
 */
import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ContractSource, ContractStatus, DayOfWeek, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { sessionRepository } from "../repositories/session.repository";
import { availabilityService } from "../services/availability.service";
import { notificationService } from "../services/notification.service";
import { bookingService, CLIENT_SCHEDULE_CONFLICT, SCHEDULE_CONFLICT_OTHER_ROLE } from "../services/booking.service";
import { bookingController } from "../controllers/booking.controller";
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

async function seedContract(ptUserId: string, clientUserId: string) {
  const row = await prisma.contract.create({
    data: {
      id: randomUUID(), ptUserId, clientUserId, packageName: "Seed", totalSessions: 10, usedSessions: 0,
      compensatedSessions: 0, price: 1_000_000, status: ContractStatus.ACTIVE, source: ContractSource.INDEPENDENT, sessionDurationMinutes: 60,
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
/** A session row straight into the table (TEST FIXTURE), 60 minutes from `at`. */
async function seedSession(contractId: string, ptUserId: string, clientUserId: string, at: Date, status: SessionStatus = SessionStatus.CONFIRMED) {
  return prisma.session.create({
    data: { contractId, ptUserId, clientUserId, status, scheduledStartAt: at, scheduledEndAt: new Date(at.getTime() + 3600_000) },
  });
}
/** A Saturday at least 10 days ahead, at 07:00 local. */
function saturday7am(): Date {
  const d = new Date(Date.now() + 10 * 24 * 3600_000);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  d.setHours(7, 0, 0, 0);
  return d;
}
const at = (day: Date, hour: number) => {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const dateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const book = (clientUserId: string, contractId: string, day: Date, time: string) =>
  (bookingService as any).bookSession(clientUserId, contractId, { scheduledDate: dateStr(day), scheduledTime: time });
const isOtherRole = (e: any) => e?.status === 409 && e?.code === SCHEDULE_CONFLICT_OTHER_ROLE;

dbTest.after(async () => {
  await prisma.sessionRescheduleRequest.deleteMany({ where: { session: { contractId: { in: contractIds } } } });
  await prisma.session.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.pTAvailability.deleteMany({ where: { ptUserId: { in: ptIds } } });
  await prisma.$disconnect();
});

// ── Repro, both directions ───────────────────────────────────────

dbTest("Repro 1: PT A teaches C at 07:00 -> A, acting as a client, cannot book PT B at 07:00 (409 OTHER_ROLE); 08:00 and a CANCELLED row are fine", async () => {
  const day = saturday7am();
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const teach = await seedContract(A, C); // A is the PT
  const attend = await seedContract(B, A); // A is the client
  await openAllDay(B, day);
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    const taught = await seedSession(teach.id, A, C, at(day, 7));
    await assert.rejects(() => book(A, attend.id, day, "07:00"), isOtherRole);
    await assert.rejects(() => book(A, attend.id, day, "07:30"), isOtherRole, "overlap, not only an identical start");
    assert.equal(await prisma.session.count({ where: { contractId: attend.id } }), 0, "nothing was created");
    const next = await book(A, attend.id, day, "08:00");
    assert.equal(next.status, SessionStatus.REQUESTED, "back-to-back is allowed (touching ends do not overlap)");
    await prisma.session.update({ where: { id: taught.id }, data: { status: SessionStatus.CANCELLED } });
    const again = await book(A, attend.id, day, "07:00");
    assert.equal(again.status, SessionStatus.REQUESTED, "a CANCELLED teaching session no longer holds the hour");
  } finally {
    restore();
  }
});

dbTest("Repro 2 (reverse): A attends PT B at 07:00 -> client C cannot book A (as PT) at 07:00 (409 OTHER_ROLE)", async () => {
  const day = saturday7am();
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const attend = await seedContract(B, A);
  const teach = await seedContract(A, C);
  await openAllDay(A, day);
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    await seedSession(attend.id, B, A, at(day, 7), SessionStatus.REQUESTED);
    await assert.rejects(() => book(C, teach.id, day, "07:00"), isOtherRole);
    const ok = await book(C, teach.id, day, "09:00");
    assert.equal(ok.status, SessionStatus.REQUESTED);
  } finally {
    restore();
  }
});

dbTest("Same-role rules keep their own answers: client double-booking is still CLIENT_SCHEDULE_CONFLICT, not OTHER_ROLE", async () => {
  const day = saturday7am();
  const client = randomUUID();
  const c1 = await seedContract(randomUUID(), client);
  const c2 = await seedContract(randomUUID(), client);
  await openAllDay(c1.ptUserId, day);
  await openAllDay(c2.ptUserId, day);
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    await book(client, c1.id, day, "07:00");
    await assert.rejects(() => book(client, c2.id, day, "07:00"), (e: any) => e?.status === 409 && e?.code === CLIENT_SCHEDULE_CONFLICT);
  } finally {
    restore();
  }
});

dbTest("Batch: a slot where the PT is busy as a client is refused per slot with OTHER_ROLE, nothing is created", async () => {
  const day = saturday7am();
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const teach = await seedContract(A, C);
  const attend = await seedContract(B, A);
  await openAllDay(B, day);
  await seedSession(teach.id, A, C, at(day, 7));
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    await assert.rejects(
      () => (bookingService as any).bookSessionsBatch(A, attend.id, { slots: [{ scheduledDate: dateStr(day), scheduledTime: "07:00" }, { scheduledDate: dateStr(day), scheduledTime: "09:00" }] }),
      (e: any) =>
        e?.status === 409 &&
        e.slotErrors.length === 1 &&
        e.slotErrors[0].scheduledTime === "07:00" &&
        e.slotErrors[0].code === SCHEDULE_CONFLICT_OTHER_ROLE,
    );
    assert.equal(await prisma.session.count({ where: { contractId: attend.id } }), 0, "all-or-nothing");
  } finally {
    restore();
  }
});

// ── Confirm / accept ────────────────────────────────────────────

dbTest("Confirm: the PT cannot confirm a REQUESTED session while they attend someone else's CONFIRMED session at that hour", async () => {
  const day = saturday7am();
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const teach = await seedContract(A, C);
  const attend = await seedContract(B, A);
  const req = await seedSession(teach.id, A, C, at(day, 7), SessionStatus.REQUESTED);
  await seedSession(attend.id, B, A, at(day, 7), SessionStatus.CONFIRMED);
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    await assert.rejects(() => (bookingService as any).confirmSession(req.id, A), isOtherRole);
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: req.id } })).status, SessionStatus.REQUESTED, "still REQUESTED");
    // the same session at a free hour confirms
    const free = await seedSession(teach.id, A, C, at(day, 10), SessionStatus.REQUESTED);
    await (bookingService as any).confirmSession(free.id, A);
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: free.id } })).status, SessionStatus.CONFIRMED);
  } finally {
    restore();
  }
});

dbTest("Confirm: the PT cannot confirm while the CLIENT is teaching (CONFIRMED) at that hour", async () => {
  const day = saturday7am();
  const A = randomUUID(), X = randomUUID(), Y = randomUUID();
  const withA = await seedContract(A, X); // X is A's client...
  const xTeaches = await seedContract(X, Y); // ...and teaches Y
  const req = await seedSession(withA.id, A, X, at(day, 7), SessionStatus.REQUESTED);
  await seedSession(xTeaches.id, X, Y, at(day, 7), SessionStatus.CONFIRMED);
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    await assert.rejects(() => (bookingService as any).confirmSession(req.id, A), isOtherRole);
  } finally {
    restore();
  }
});

// ── Reschedule ──────────────────────────────────────────────────

dbTest("Reschedule request: a client-side move onto the client's OWN teaching hour is refused (OTHER_ROLE)", async () => {
  const day = saturday7am();
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const teach = await seedContract(A, C);
  const attend = await seedContract(B, A);
  await openAllDay(B, day);
  await seedSession(teach.id, A, C, at(day, 7));
  const moving = await seedSession(attend.id, B, A, at(day, 9));
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    await assert.rejects(
      () => (bookingService as any).requestReschedule(moving.id, A, { proposedStartAt: at(day, 7).toISOString(), reason: "doi gio" }),
      isOtherRole,
    );
    assert.equal(await prisma.sessionRescheduleRequest.count({ where: { sessionId: moving.id } }), 0);
  } finally {
    restore();
  }
});

dbTest("Reschedule request: a PT-side move onto the PT's OWN client hour is refused (OTHER_ROLE)", async () => {
  const day = saturday7am();
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const teach = await seedContract(A, C);
  const attend = await seedContract(B, A);
  await openAllDay(A, day);
  await seedSession(attend.id, B, A, at(day, 7));
  const moving = await seedSession(teach.id, A, C, at(day, 9));
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    await assert.rejects(
      () => (bookingService as any).requestReschedule(moving.id, A, { proposedStartAt: at(day, 7).toISOString(), reason: "doi gio" }),
      isOtherRole,
    );
  } finally {
    restore();
  }
});

dbTest("Reschedule accept: a conflict that appeared AFTER the proposal is caught on accept, under the locks", async () => {
  const day = saturday7am();
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const teach = await seedContract(A, C);
  const attend = await seedContract(B, A);
  await openAllDay(A, day);
  const moving = await seedSession(teach.id, A, C, at(day, 9));
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    // C proposes 07:00 (A is free then), A is about to accept...
    const request = await (bookingService as any).requestReschedule(moving.id, C, { proposedStartAt: at(day, 7).toISOString(), reason: "doi gio" });
    // ...but in the meantime A (as a client) is confirmed into B's 07:00 session.
    await seedSession(attend.id, B, A, at(day, 7), SessionStatus.CONFIRMED);
    await assert.rejects(() => (bookingService as any).respondToReschedule(request.id, A, "ACCEPT"), isOtherRole);
    const row = await prisma.session.findUniqueOrThrow({ where: { id: moving.id } });
    assert.equal(row.scheduledStartAt.getTime(), at(day, 9).getTime(), "the session did not move");
  } finally {
    restore();
  }
});

// ── Concurrency ─────────────────────────────────────────────────

dbTest("Concurrent: A teaches (C books A) and A attends (A books B) at the SAME hour at once -> exactly one session is created", async () => {
  const day = saturday7am();
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const teach = await seedContract(A, C);
  const attend = await seedContract(B, A);
  await openAllDay(A, day);
  await openAllDay(B, day);
  // Force the overlap instead of leaving it to timing: each booking waits at its first locked conflict read until both arrived
  // (or 500 ms passed). Without the shared user-schedule lock both pass; with it the second queues on the lock, the timeout
  // lets the first commit, and the second then sees its row.
  const barrier = makeBarrier(2, 500);
  const original = sessionRepository.findConflict.bind(sessionRepository);
  const restores = [
    patch(sessionRepository, "findConflict", async (...args: any[]) => {
      await barrier();
      return (original as any)(...args);
    }),
    patch(notificationService, "create", async () => ({})),
  ];
  try {
    const results = await Promise.allSettled([book(C, teach.id, day, "07:00"), book(A, attend.id, day, "07:00")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactly one of the two");
    const loser = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.ok(loser && isOtherRole(loser.reason), `loser must be 409 ${SCHEDULE_CONFLICT_OTHER_ROLE}, got ${(loser as any)?.reason?.message}`);
    const live = await prisma.session.count({ where: { contractId: { in: [teach.id, attend.id] }, status: SessionStatus.REQUESTED } });
    assert.equal(live, 1);
  } finally {
    restores.forEach((r) => r());
  }
});

dbTest("Concurrent: A books B while B books A (two PT locks, one shared pair of user locks) -> one wins, no deadlock", async () => {
  const day = saturday7am();
  const A = randomUUID(), B = randomUUID();
  const aClientOfB = await seedContract(B, A);
  const bClientOfA = await seedContract(A, B);
  await openAllDay(A, day);
  await openAllDay(B, day);
  const restore = patch(notificationService, "create", async () => ({}));
  try {
    const results = await Promise.allSettled([book(A, aClientOfB.id, day, "07:00"), book(B, bClientOfA.id, day, "07:00")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const loser = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.ok(loser && isOtherRole(loser.reason), `got ${(loser as any)?.reason?.message}`);
  } finally {
    restore();
  }
});

// ── Slots shown to the client ───────────────────────────────────

dbTest("Slots: a PT who is busy AS A CLIENT is not offered at that hour (to anyone); a viewer busy AS A PT does not see it either", async () => {
  const day = saturday7am();
  const B = randomUUID(), X = randomUUID(), V = randomUUID(), Z = randomUUID();
  const bAttends = await seedContract(X, B); // B attends X at 07:00
  const vTeaches = await seedContract(V, Z); // V teaches Z at 09:00
  await openAllDay(B, day);
  await seedSession(bAttends.id, X, B, at(day, 7));
  await seedSession(vTeaches.id, V, Z, at(day, 9));
  const anyone: string[] = await availabilityService.getAvailableSlots(B, dateStr(day), true, randomUUID());
  assert.ok(!anyone.includes("07:00"), "B is attending a session at 07:00");
  assert.ok(anyone.includes("08:00") && anyone.includes("09:00"), "other hours stay open for everyone else");
  const asV: string[] = await availabilityService.getAvailableSlots(B, dateStr(day), true, V);
  assert.ok(!asV.includes("09:00"), "V is teaching at 09:00, so V cannot be offered it");
  assert.ok(!asV.includes("07:00"));
  assert.ok(asV.includes("08:00"));
  const unfiltered: string[] = await availabilityService.getAvailableSlots(B, dateStr(day));
  assert.ok(!unfiltered.includes("07:00"), "the PT's own calendar view also hides the hour they are busy as a client");
});

// ── Calendar split: GET /sessions/upcoming?as= ──────────────────

dbTest("Upcoming: ?as=pt returns only sessions the user teaches, ?as=client only those they attend, no param returns both", async () => {
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const teach = await seedContract(A, C);
  const attend = await seedContract(B, A);
  const soon = new Date(Date.now() + 5 * 24 * 3600_000);
  const taught = await seedSession(teach.id, A, C, soon);
  const attended = await seedSession(attend.id, B, A, new Date(soon.getTime() + 2 * 3600_000));
  const ids = (rows: any[]) => rows.map((r) => r.id).sort();
  assert.deepEqual(ids(await bookingService.getMyUpcoming(A, "pt")), [taught.id]);
  assert.deepEqual(ids(await bookingService.getMyUpcoming(A, "client")), [attended.id]);
  assert.deepEqual(ids(await bookingService.getMyUpcoming(A)), ids([taught, attended]), "default is unchanged: both roles");
});

dbTest("Upcoming controller: as=pt / as=client reach the service, a bogus value is 400, absent keeps the legacy shape", async () => {
  const seen: Array<string | undefined> = [];
  const restore = patch(bookingService, "getMyUpcoming", async (_u: string, as?: string) => {
    seen.push(as);
    return [];
  });
  const call = async (query: Record<string, unknown>) => {
    let status = 200;
    let body: any;
    const res: any = { status(s: number) { status = s; return res; }, json(b: unknown) { body = b; return res; } };
    await (bookingController as any).getMyUpcoming({ headers: { "x-user-id": "u1", "x-user-role": "CLIENT" }, query }, res);
    return { status, body };
  };
  try {
    assert.equal((await call({ as: "pt" })).status, 200);
    assert.equal((await call({ as: "CLIENT" })).status, 200);
    assert.equal((await call({})).status, 200);
    assert.equal((await call({ as: "admin" })).status, 400);
    assert.deepEqual(seen, ["pt", "client", undefined]);
  } finally {
    restore();
  }
});
