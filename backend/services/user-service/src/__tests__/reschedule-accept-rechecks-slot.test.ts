import test from "node:test";
import assert from "node:assert/strict";
import { bookingService } from "../services/booking.service";
import { sessionRepository } from "../repositories/session.repository";
import { availabilityRepository } from "../repositories/availability.repository";
import { auditService } from "../services/audit.service";
import { notificationService } from "../services/notification.service";
import { SessionStatus } from "../generated/prisma";

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/**
 * Money-flow redesign plan item 3.2 — "chấp nhận dời lịch không kiểm tra lại khung giờ".
 *
 * `requestReschedule` calls `assertSlotBookable` when the proposal is made, but
 * `respondToReschedule`'s ACCEPT branch used to update the session's time directly with no
 * re-check. Between the proposal and the accept, another session could have taken that slot —
 * accepting anyway gives the PT two sessions at the same time with no error anywhere.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function requestFixture() {
  const proposedStartAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const proposedEndAt = new Date(proposedStartAt.getTime() + 60 * 60 * 1000);
  return {
    id: "req-1",
    sessionId: "session-1",
    status: "PENDING",
    requestedBy: "CLIENT",
    originalStartAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    originalEndAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
    proposedStartAt,
    proposedEndAt,
    session: {
      id: "session-1",
      ptUserId: "pt-1",
      clientUserId: "client-1",
      scheduledStartAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      scheduledEndAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
    },
  };
}

test("accepting a reschedule that now conflicts with another session is rejected, not silently applied", async () => {
  const request = requestFixture();
  const calls: string[] = [];

  const restores = [
    patch(sessionRepository, "findRescheduleRequestById", async () => request as any),
    // Something else took the proposed slot in the meantime.
    patch(sessionRepository, "findConflict", async () => {
      calls.push("findConflict");
      return { id: "other-session" } as any;
    }),
    patch(sessionRepository, "updateRescheduleRequestStatus", async () => {
      calls.push("updateRescheduleRequestStatus");
      return {} as any;
    }),
    patch(sessionRepository, "updateStatus", async () => {
      calls.push("updateStatus");
      return {} as any;
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  let thrown: Error | null = null;
  try {
    await bookingService.respondToReschedule("req-1", "pt-1", "ACCEPT");
  } catch (e) {
    thrown = e as Error;
  } finally {
    restores.forEach((r) => r());
  }

  assert.ok(thrown, "accepting into a slot that is no longer free must be rejected");
  assert.match(thrown!.message, /trùng|khung giờ/i);
  assert.deepEqual(calls, ["findConflict"], "the conflict is caught BEFORE either write — the request stays PENDING and the session's time is untouched");
});

test("accepting a reschedule with a genuinely free slot still succeeds", async () => {
  const request = requestFixture();
  const calls: string[] = [];

  const restores = [
    patch(sessionRepository, "findRescheduleRequestById", async () => request as any),
    patch(sessionRepository, "findConflict", async () => null),
    // Money-flow plan 3.5: an empty schedule now BLOCKS rather than allows — a published,
    // wide-open slot covering the proposed day is required for this "still succeeds" case.
    patch(availabilityRepository, "findByPT", async () => [
      { dayOfWeek: DAY_NAMES[request.proposedStartAt.getDay()], isActive: true, startTime: "00:00", endTime: "23:59" },
    ]),
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(sessionRepository, "updateRescheduleRequestStatus", async () => {
      calls.push("updateRescheduleRequestStatus");
      return {} as any;
    }),
    patch(sessionRepository, "updateStatus", async (_id: string, status: SessionStatus) => {
      calls.push(`updateStatus:${status}`);
      return {} as any;
    }),
    patch(auditService, "record", async () => {
      calls.push("audit");
      return {} as any;
    }),
    patch(notificationService, "create", async () => ({}) as any),
  ];

  try {
    await bookingService.respondToReschedule("req-1", "pt-1", "ACCEPT");
  } finally {
    restores.forEach((r) => r());
  }

  assert.deepEqual(calls, ["updateRescheduleRequestStatus", `updateStatus:${SessionStatus.CONFIRMED}`, "audit"]);
});
