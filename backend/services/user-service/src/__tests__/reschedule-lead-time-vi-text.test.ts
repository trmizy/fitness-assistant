/**
 * B26 / B27 / B32 - rescheduling and session-cancel wording and rules.
 *
 *  B26  the reschedule notifications print the date in Vietnamese, Vietnam time: "10:00 ngày 12/10/2026"
 *       (the request one used to print the server's US-style toLocaleString(); the accept one put the time before the date wrongly).
 *  B27  a reschedule obeys the booking lead time (proposed start >= 24 h from now) and may not leave the contract's
 *       validity window; both are re-checked on accept. The "no reschedule within 12 h of the ORIGINAL start" rule is unchanged.
 *  B32  English notice / error strings are Vietnamese; a client's late cancel tells the PT they are still paid.
 *
 * TEST FIXTURE (repositories replaced, no rows written); the per-PT lock still opens a transaction, so run with a *_test DATABASE_URL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bookingService } from "../services/booking.service";
import { sessionRepository } from "../repositories/session.repository";
import { contractRepository } from "../repositories/contract.repository";
import { availabilityRepository } from "../repositories/availability.repository";
import { auditService } from "../services/audit.service";
import { notificationService } from "../services/notification.service";
import { formatViDateTime, vietnamDayRange } from "../utils/vi-datetime.util";
import { stubPtRestrictionReads } from "./pt-restriction-reads.stub";
import { stubSessionSettlements } from "./session-settlement-memory.stub";

stubPtRestrictionReads();
stubSessionSettlements();

const HOUR = 60 * 60 * 1000;
const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

/** 03:00 UTC = 10:00 in Vietnam, `days` days from today. */
function tenAmVietnam(days: number): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + days, 3, 0, 0));
}
function dmy(d: Date): string {
  const two = (x: number) => String(x).padStart(2, "0");
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

test("formatViDateTime: Vietnam time, time before date, day before month", () => {
  assert.equal(formatViDateTime(new Date("2026-10-12T03:00:00Z")), "10:00 ngày 12/10/2026");
  assert.equal(formatViDateTime(new Date("2026-10-29T01:00:00Z")), "08:00 ngày 29/10/2026", "the B26 sample: 29/10 08:00, not 10/29/2026, 8:00:00 AM");
  assert.equal(formatViDateTime(new Date("2026-12-31T17:30:00Z")), "00:30 ngày 01/01/2027", "rolls into the next Vietnam day");
});

test("vietnamDayRange: the Vietnam calendar day around a UTC instant", () => {
  const { start, end } = vietnamDayRange(new Date("2026-10-24T20:00:00Z")); // 03:00 on the 25th in Vietnam
  assert.equal(start.toISOString(), "2026-10-24T17:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-25T17:00:00.000Z");
});

function requestHarness(opts: { sessionStartInHours?: number; contractEnd?: Date | null; proposed: Date }) {
  const created: any[] = [];
  const notes: any[] = [];
  const startAt = new Date(Date.now() + (opts.sessionStartInHours ?? 72) * HOUR);
  const session = {
    id: "session-1",
    contractId: "contract-1",
    ptUserId: "pt-1",
    clientUserId: "client-1",
    status: "CONFIRMED",
    scheduledStartAt: startAt,
    scheduledEndAt: new Date(startAt.getTime() + HOUR),
  };
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "findOpenRescheduleRequest", async () => null),
    patch(sessionRepository, "countAcceptedReschedules", async () => 0),
    patch(sessionRepository, "findConflict", async () => null),
    patch(sessionRepository, "createRescheduleRequest", async (d: any) => {
      created.push(d);
      return { id: "req-1", ...d };
    }),
    patch(contractRepository, "findById", async () => ({ id: "contract-1", sessionDurationMinutes: 60, startDate: null, endDate: opts.contractEnd ?? null }) as any),
    patch(availabilityRepository, "findByPT", async () => [
      { dayOfWeek: DAY_NAMES[opts.proposed.getDay()], isActive: true, startTime: "00:00", endTime: "23:59" },
    ]),
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(auditService, "record", async () => ({}) as any),
    patch(notificationService, "create", async (n: any) => {
      notes.push(n);
      return {} as any;
    }),
  ];
  return { created, notes, restore: () => restores.forEach((r) => r()) };
}

test("B27: a reschedule proposed less than 24 h from now is refused with a code (booking's own lead time)", async () => {
  const proposed = new Date(Date.now() + 8 * HOUR);
  const h = requestHarness({ proposed });
  try {
    await assert.rejects(
      bookingService.requestReschedule("session-1", "client-1", { proposedStartAt: proposed.toISOString(), reason: "bận" }),
      (e: any) => e.status === 400 && e.code === "RESCHEDULE_LEAD_TIME_TOO_SHORT" && /ít nhất 24 giờ/.test(e.message),
    );
    assert.equal(h.created.length, 0, "no request row was written");
    assert.equal(h.notes.length, 0);
  } finally {
    h.restore();
  }
});

test("B27: a reschedule exactly past the 24 h line is accepted; the request notice is Vietnamese-formatted", async () => {
  const proposed = tenAmVietnam(3);
  const h = requestHarness({ proposed });
  try {
    await bookingService.requestReschedule("session-1", "client-1", { proposedStartAt: proposed.toISOString(), reason: "bận" });
    assert.equal(h.created.length, 1);
    assert.equal(h.notes.length, 1);
    assert.equal(h.notes[0].text, `Có yêu cầu dời lịch buổi tập sang 10:00 ngày ${dmy(proposed)}`);
    assert.equal(h.notes[0].userId, "pt-1");
  } finally {
    h.restore();
  }
});

test("B27: a reschedule past the contract end date is refused with a code", async () => {
  const proposed = tenAmVietnam(5);
  const h = requestHarness({ proposed, contractEnd: tenAmVietnam(4) });
  try {
    await assert.rejects(
      bookingService.requestReschedule("session-1", "client-1", { proposedStartAt: proposed.toISOString(), reason: "bận" }),
      (e: any) => e.status === 400 && e.code === "SESSION_OUTSIDE_CONTRACT_VALIDITY" && /thời hạn hợp đồng/.test(e.message),
    );
    assert.equal(h.created.length, 0);
  } finally {
    h.restore();
  }
});

test("B27: a reschedule inside the contract window (ends later than the proposal) is accepted", async () => {
  const proposed = tenAmVietnam(3);
  const h = requestHarness({ proposed, contractEnd: tenAmVietnam(10) });
  try {
    await bookingService.requestReschedule("session-1", "client-1", { proposedStartAt: proposed.toISOString(), reason: "bận" });
    assert.equal(h.created.length, 1);
  } finally {
    h.restore();
  }
});

test("B27: the 12 h rule on the ORIGINAL start is kept (checked first, own message)", async () => {
  const proposed = tenAmVietnam(3);
  const h = requestHarness({ proposed, sessionStartInHours: 10 });
  try {
    await assert.rejects(
      bookingService.requestReschedule("session-1", "client-1", { proposedStartAt: proposed.toISOString(), reason: "bận" }),
      (e: any) => e.status === 400 && /trong vòng 12 giờ/.test(e.message),
    );
  } finally {
    h.restore();
  }
});

function acceptHarness(opts: { proposedStartAt: Date; contractEnd?: Date | null; requestedBy?: "CLIENT" | "PT" }) {
  const calls: string[] = [];
  const notes: any[] = [];
  const proposedEndAt = new Date(opts.proposedStartAt.getTime() + HOUR);
  const request = {
    id: "req-1",
    sessionId: "session-1",
    status: "PENDING",
    requestedBy: opts.requestedBy ?? "CLIENT",
    originalStartAt: new Date(Date.now() + 72 * HOUR),
    originalEndAt: new Date(Date.now() + 73 * HOUR),
    proposedStartAt: opts.proposedStartAt,
    proposedEndAt,
    session: {
      id: "session-1",
      contractId: "contract-1",
      ptUserId: "pt-1",
      clientUserId: "client-1",
      scheduledStartAt: new Date(Date.now() + 72 * HOUR),
      scheduledEndAt: new Date(Date.now() + 73 * HOUR),
    },
  };
  const restores = [
    patch(sessionRepository, "findRescheduleRequestById", async () => request as any),
    patch(contractRepository, "findById", async () => ({ id: "contract-1", startDate: null, endDate: opts.contractEnd ?? null }) as any),
    patch(sessionRepository, "findConflict", async () => null),
    patch(availabilityRepository, "findByPT", async () => [
      { dayOfWeek: DAY_NAMES[opts.proposedStartAt.getDay()], isActive: true, startTime: "00:00", endTime: "23:59" },
    ]),
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(sessionRepository, "updateRescheduleRequestStatus", async () => {
      calls.push("updateRescheduleRequestStatus");
      return {} as any;
    }),
    patch(sessionRepository, "updateStatus", async () => {
      calls.push("updateStatus");
      return {} as any;
    }),
    patch(auditService, "record", async () => ({}) as any),
    patch(notificationService, "create", async (n: any) => {
      notes.push(n);
      return {} as any;
    }),
  ];
  return { calls, notes, restore: () => restores.forEach((r) => r()) };
}

test("B27: on accept the lead time is re-checked - a proposal that has since come within 24 h cannot be accepted", async () => {
  const h = acceptHarness({ proposedStartAt: new Date(Date.now() + 6 * HOUR) });
  try {
    await assert.rejects(
      bookingService.respondToReschedule("req-1", "pt-1", "ACCEPT"),
      (e: any) => e.status === 400 && e.code === "RESCHEDULE_LEAD_TIME_TOO_SHORT" && /gửi một yêu cầu dời lịch mới/.test(e.message),
    );
    assert.deepEqual(h.calls, [], "neither the request nor the session was written");
  } finally {
    h.restore();
  }
});

test("B27: on accept the contract window is re-checked on the contract as it is now", async () => {
  const h = acceptHarness({ proposedStartAt: tenAmVietnam(5), contractEnd: tenAmVietnam(4) });
  try {
    await assert.rejects(
      bookingService.respondToReschedule("req-1", "pt-1", "ACCEPT"),
      (e: any) => e.status === 400 && e.code === "SESSION_OUTSIDE_CONTRACT_VALIDITY",
    );
    assert.deepEqual(h.calls, []);
  } finally {
    h.restore();
  }
});

test("B26: the accept notice shows the new time as \"10:00 ngày dd/mm/yyyy\"", async () => {
  const start = tenAmVietnam(4);
  const h = acceptHarness({ proposedStartAt: start });
  try {
    await bookingService.respondToReschedule("req-1", "pt-1", "ACCEPT");
    assert.deepEqual(h.calls, ["updateRescheduleRequestStatus", "updateStatus"]);
    assert.equal(h.notes[0].text, `Yêu cầu dời lịch đã được chấp nhận. Giờ mới: 10:00 ngày ${dmy(start)}`);
  } finally {
    h.restore();
  }
});

test("B32: answering your own reschedule request is refused in Vietnamese", async () => {
  const h = acceptHarness({ proposedStartAt: tenAmVietnam(4), requestedBy: "CLIENT" });
  try {
    await assert.rejects(
      bookingService.respondToReschedule("req-1", "client-1", "ACCEPT"),
      (e: any) => e.status === 403 && e.message === "Bạn không thể phản hồi yêu cầu dời lịch do chính mình gửi",
    );
  } finally {
    h.restore();
  }
});
