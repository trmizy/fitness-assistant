import test from "node:test";
import assert from "node:assert/strict";
import { bookingService } from "../services/booking.service";
import { contractRepository } from "../repositories/contract.repository";
import { profileRepository } from "../repositories/profile.repository";
import { sessionRepository } from "../repositories/session.repository";
import { availabilityRepository } from "../repositories/availability.repository";

/**
 * Money-flow redesign plan item 3.5 — "chưa công bố lịch rảnh nghĩa là rảnh mọi lúc".
 *
 * `if (ptAvailability.length === 0) return;` / `if (ptAvailability.length > 0) { ...check... }`
 * both read "no published hours" as "no constraint" — a PT who never set up their weekly
 * schedule could be booked at literally any hour, with no error. Inverted: no published hours
 * now blocks booking entirely, with a clear message.
 *
 * Verified against production data before this change: zero PTs currently have an ACTIVE
 * contract without published availability (checked directly via psql), so this does not break
 * any live PT.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function contractFixture() {
  return {
    id: "c1",
    clientUserId: "client-1",
    ptUserId: "pt-1",
    status: "ACTIVE",
    sessionMode: null,
    totalSessions: 10,
    usedSessions: 0,
    compensatedSessions: 0,
    sessionDurationMinutes: 60,
  };
}

test("a PT with no published availability cannot be booked at all", async () => {
  const contract = contractFixture();
  let sessionCreated = false;

  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(profileRepository, "findByUserId", async () => ({}) as any),
    patch(sessionRepository, "countActiveByContract", async () => 0),
    patch(sessionRepository, "findConflict", async () => null),
    patch(availabilityRepository, "findByPT", async () => []), // never set up a schedule
    patch(sessionRepository, "create", async () => {
      sessionCreated = true;
      return { id: "s1" } as any;
    }),
  ];

  try {
    await assert.rejects(
      () =>
        (bookingService as any).bookSession("client-1", "c1", {
          scheduledDate: "2027-01-01",
          scheduledTime: "03:00", // an hour no reasonable published schedule would ever cover
        }),
      /lịch|availability|chưa công bố/i,
    );
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(sessionCreated, false);
});

test("a PT WITH published availability still books normally inside their hours", async () => {
  const contract = contractFixture();
  let sessionCreated = false;

  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(profileRepository, "findByUserId", async () => ({}) as any),
    patch(sessionRepository, "countActiveByContract", async () => 0),
    patch(sessionRepository, "findConflict", async () => null),
    patch(availabilityRepository, "findByPT", async () => [
      { dayOfWeek: "FRIDAY", isActive: true, startTime: "08:00", endTime: "18:00" },
    ]),
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(sessionRepository, "create", async () => {
      sessionCreated = true;
      return { id: "s1" } as any;
    }),
  ];

  try {
    // 2027-01-01 is a Friday.
    await (bookingService as any).bookSession("client-1", "c1", {
      scheduledDate: "2027-01-01",
      scheduledTime: "09:00",
    });
  } finally {
    restores.forEach((r) => r());
  }

  assert.equal(sessionCreated, true);
});
