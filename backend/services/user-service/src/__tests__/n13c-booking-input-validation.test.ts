/**
 * N13C-02 / N13C-03 / N13C-04 / N13C-05 - booking and reschedule input validation.
 *
 *  N13C-02  a wrong session mode on booking is refused in Vietnamese (code SESSION_MODE_MISMATCH), no English text.
 *  N13C-03  proposing a reschedule to the exact current start is refused (400 RESCHEDULE_SAME_TIME).
 *  N13C-04  the "only CONFIRMED sessions" error no longer prints the raw enum.
 *  N13C-05  responding to a reschedule request with a missing/invalid action is 400 INVALID_RESCHEDULE_ACTION and the request stays PENDING.
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

test("N13C-02: booking with the wrong session mode -> Vietnamese message + code, no English / raw enum", async () => {
  const restore = patch(contractRepository, "findById", async () => ({
    id: "contract-1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: "ACTIVE",
    sessionMode: "OFFLINE",
  }));
  try {
    await assert.rejects(
      bookingService.bookSession("client-1", "contract-1", { scheduledDate: "2099-01-01", scheduledTime: "09:00", sessionMode: "ONLINE" }),
      (e: any) =>
        e.status === 400 &&
        e.code === "SESSION_MODE_MISMATCH" &&
        /Hình thức buổi tập phải khớp với hợp đồng/.test(e.message) &&
        /trực tiếp/.test(e.message) &&
        !/Session mode|OFFLINE|ONLINE/.test(e.message),
    );
  } finally {
    restore();
  }
});

function requestHarness(opts: { sessionStatus?: string }) {
  const created: any[] = [];
  const startAt = new Date(Date.now() + 72 * HOUR);
  const session = {
    id: "session-1",
    contractId: "contract-1",
    ptUserId: "pt-1",
    clientUserId: "client-1",
    status: opts.sessionStatus ?? "CONFIRMED",
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
    patch(contractRepository, "findById", async () => ({ id: "contract-1", sessionDurationMinutes: 60, startDate: null, endDate: null }) as any),
    patch(availabilityRepository, "findByPT", async () =>
      DAY_NAMES.map((d) => ({ dayOfWeek: d, isActive: true, startTime: "00:00", endTime: "23:59" })),
    ),
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(auditService, "record", async () => ({}) as any),
    patch(notificationService, "create", async () => ({}) as any),
  ];
  return { session, created, restore: () => restores.forEach((r) => r()) };
}

test("N13C-03: a reschedule to the exact current start time is refused and writes nothing", async () => {
  const h = requestHarness({});
  try {
    await assert.rejects(
      bookingService.requestReschedule("session-1", "client-1", { proposedStartAt: h.session.scheduledStartAt.toISOString(), reason: "bận" }),
      (e: any) => e.status === 400 && e.code === "RESCHEDULE_SAME_TIME" && /trùng với giờ hiện tại/.test(e.message),
    );
    assert.equal(h.created.length, 0);
  } finally {
    h.restore();
  }
});

test("N13C-03: a different start time is still accepted", async () => {
  const h = requestHarness({});
  try {
    await bookingService.requestReschedule("session-1", "client-1", {
      proposedStartAt: new Date(h.session.scheduledStartAt.getTime() + 24 * HOUR).toISOString(),
      reason: "bận",
    });
    assert.equal(h.created.length, 1);
  } finally {
    h.restore();
  }
});

test("N13C-04: a non-CONFIRMED session is refused without printing the raw enum", async () => {
  const h = requestHarness({ sessionStatus: "REQUESTED" });
  try {
    await assert.rejects(
      bookingService.requestReschedule("session-1", "client-1", {
        proposedStartAt: new Date(h.session.scheduledStartAt.getTime() + 24 * HOUR).toISOString(),
        reason: "bận",
      }),
      (e: any) => e.status === 400 && e.code === "RESCHEDULE_REQUIRES_CONFIRMED" && !/CONFIRMED/.test(e.message) && /đã được xác nhận/.test(e.message),
    );
  } finally {
    h.restore();
  }
});

test("N13C-05: respond with a missing / invalid action -> 400 INVALID_RESCHEDULE_ACTION, request not touched", async () => {
  const calls: string[] = [];
  const restores = [
    patch(sessionRepository, "findRescheduleRequestById", async () => {
      calls.push("find");
      return null as any;
    }),
    patch(sessionRepository, "updateRescheduleRequestStatus", async () => {
      calls.push("update");
      return {} as any;
    }),
  ];
  try {
    for (const bad of [undefined, null, "", "MAYBE", "accept", true, { accept: true }]) {
      await assert.rejects(
        bookingService.respondToReschedule("req-1", "pt-1", bad as any),
        (e: any) => e.status === 400 && e.code === "INVALID_RESCHEDULE_ACTION" && /không hợp lệ/.test(e.message),
        `action=${JSON.stringify(bad)}`,
      );
    }
    assert.deepEqual(calls, [], "nothing was read or written for an invalid action");
  } finally {
    restores.forEach((r) => r());
  }
});
