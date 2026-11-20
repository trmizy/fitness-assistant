/**
 * Daily cap on RESCHEDULING (owner decision 19/11/2026): a move (proposed by the client or the PT) onto a day where the client
 * already holds 2 live sessions is refused 409 CLIENT_DAILY_SESSION_LIMIT, and the session being moved is excluded from the count.
 *
 * TEST FIXTURE (repositories replaced, no database): the request-time check. The accept-time re-check under the client lock and
 * the real rows are in session-daily-cap-and-batch.integration.test.ts (isolated *_test database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bookingService } from "../services/booking.service";
import { sessionRepository } from "../repositories/session.repository";
import { contractRepository } from "../repositories/contract.repository";
import { availabilityRepository } from "../repositories/availability.repository";
import { auditService } from "../services/audit.service";
import { notificationService } from "../services/notification.service";
import { CLIENT_DAILY_SESSION_LIMIT } from "../services/session-booking-rules";
import { stubPtRestrictionReads } from "./pt-restriction-reads.stub";

stubPtRestrictionReads();

const HOUR = 60 * 60 * 1000;
const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function harness(opts: { proposed: Date; liveOnTargetDay: Date[] }) {
  const created: any[] = [];
  const capCalls: any[][] = [];
  const startAt = new Date(Date.now() + 72 * HOUR);
  const session = {
    id: "session-1", contractId: "contract-1", ptUserId: "pt-1", clientUserId: "client-1", status: "CONFIRMED",
    scheduledStartAt: startAt, scheduledEndAt: new Date(startAt.getTime() + HOUR),
  };
  const restores = [
    patch(sessionRepository, "findById", async () => session as any),
    patch(sessionRepository, "findOpenRescheduleRequest", async () => null),
    patch(sessionRepository, "countAcceptedReschedules", async () => 0),
    patch(sessionRepository, "findConflict", async () => null),
    patch(sessionRepository, "findClientConflict", async () => null),
    patch(sessionRepository, "findClientActiveStartsBetween", async (...args: any[]) => {
      capCalls.push(args);
      return opts.liveOnTargetDay;
    }),
    patch(sessionRepository, "createRescheduleRequest", async (d: any) => {
      created.push(d);
      return { id: "req-1", ...d };
    }),
    patch(contractRepository, "findById", async () => ({ id: "contract-1", sessionDurationMinutes: 60, startDate: null, endDate: null }) as any),
    patch(availabilityRepository, "findByPT", async () => [
      { dayOfWeek: DAY_NAMES[opts.proposed.getDay()], isActive: true, startTime: "00:00", endTime: "23:59" },
    ]),
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(auditService, "record", async () => ({}) as any),
    patch(notificationService, "create", async () => ({}) as any),
  ];
  return { created, capCalls, restore: () => restores.forEach((r) => r()) };
}

const target = () => {
  const d = new Date(Date.now() + 120 * HOUR);
  d.setHours(15, 0, 0, 0);
  return d;
};
const at = (d: Date, h: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);

for (const who of ["client-1", "pt-1"] as const) {
  test(`reschedule request by ${who === "pt-1" ? "the PT" : "the client"}: target day already has 2 live sessions -> 409 CLIENT_DAILY_SESSION_LIMIT, no request row`, async () => {
    const proposed = target();
    const h = harness({ proposed, liveOnTargetDay: [at(proposed, 7), at(proposed, 9)] });
    try {
      await assert.rejects(
        bookingService.requestReschedule("session-1", who, { proposedStartAt: proposed.toISOString(), reason: "bận" }),
        (e: any) => e.status === 409 && e.code === CLIENT_DAILY_SESSION_LIMIT && /tối đa 2 buổi tập/.test(e.message),
      );
      assert.equal(h.created.length, 0);
    } finally {
      h.restore();
    }
  });
}

test("reschedule request: the moved session is excluded from the count (its id is passed to the query) and a day with 1 live session is fine", async () => {
  const proposed = target();
  const h = harness({ proposed, liveOnTargetDay: [at(proposed, 7)] });
  try {
    const out = await bookingService.requestReschedule("session-1", "client-1", { proposedStartAt: proposed.toISOString(), reason: "bận" });
    assert.equal(out.id, "req-1");
    assert.equal(h.capCalls.length, 1);
    const [clientId, from, to, , excludeId] = h.capCalls[0];
    assert.equal(clientId, "client-1");
    assert.equal(excludeId, "session-1");
    assert.equal(from.getHours(), 0);
    assert.equal(to.getTime() - from.getTime() >= 23 * HOUR, true);
    assert.equal(h.created.length, 1);
  } finally {
    h.restore();
  }
});
