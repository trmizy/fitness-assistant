import test from "node:test";
import assert from "node:assert/strict";
import { bookingService } from "../services/booking.service";
import { contractRepository } from "../repositories/contract.repository";
import { profileRepository } from "../repositories/profile.repository";
import { sessionRepository } from "../repositories/session.repository";
import { availabilityRepository } from "../repositories/availability.repository";

/**
 * Money-flow redesign plan item 3.4 — "thời lượng buổi tập nhận từ phía khách".
 *
 * `data.durationMin` (client-supplied) used to override the contract's frozen
 * `sessionDurationMinutes` snapshot, defaulting to 60 only if absent — a client calling the API
 * directly could book a 180-minute session against a package sold as 60 minutes. The session's
 * length must always come from what the contract actually promised, never the request body.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function contractFixture(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

test("a client-supplied durationMin is ignored — the contract's own snapshot wins", async () => {
  const contract = contractFixture({ sessionDurationMinutes: 60 });
  // Definite-assignment assertion: set inside the sessionRepository.create mock below, read
  // after bookSession resolves — TS's control-flow analysis does not track a reassignment
  // made inside a nested callback back to this outer scope.
  let createdEndAt!: Date;

  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(profileRepository, "findByUserId", async () => ({}) as any),
    patch(sessionRepository, "countActiveByContract", async () => 0),
    // Money-flow plan 3.5: an empty schedule now blocks booking — a wide-open published slot
    // covering Friday (2027-01-01) is used here so this test stays about duration, not
    // availability.
    patch(availabilityRepository, "findByPT", async () => [
      { dayOfWeek: "FRIDAY", isActive: true, startTime: "00:00", endTime: "23:59" },
    ]),
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(sessionRepository, "findConflict", async () => null),
    patch(sessionRepository, "create", async (data: any) => {
      createdEndAt = data.scheduledEndAt;
      return { id: "s1", ...data };
    }),
  ];

  try {
    await (bookingService as any).bookSession("client-1", "c1", {
      scheduledDate: "2027-01-01",
      scheduledTime: "09:00",
      durationMin: 180, // a direct-API caller trying to book 3x the paid duration
    });
  } finally {
    restores.forEach((r) => r());
  }

  assert.notEqual(createdEndAt, undefined);
  const startAt = new Date("2027-01-01T09:00:00");
  const actualDurationMin = (createdEndAt.getTime() - startAt.getTime()) / (60 * 1000);
  assert.equal(actualDurationMin, 60, "the session's length must match the contract's 60-minute snapshot, not the requested 180");
});

test("a contract with no duration snapshot (legacy row) falls back to 60, still ignoring client input", async () => {
  const contract = contractFixture({ sessionDurationMinutes: null });
  let createdEndAt!: Date;

  const restores = [
    patch(contractRepository, "findById", async () => contract as any),
    patch(profileRepository, "findByUserId", async () => ({}) as any),
    patch(sessionRepository, "countActiveByContract", async () => 0),
    // Money-flow plan 3.5: an empty schedule now blocks booking — a wide-open published slot
    // covering Friday (2027-01-01) is used here so this test stays about duration, not
    // availability.
    patch(availabilityRepository, "findByPT", async () => [
      { dayOfWeek: "FRIDAY", isActive: true, startTime: "00:00", endTime: "23:59" },
    ]),
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(sessionRepository, "findConflict", async () => null),
    patch(sessionRepository, "create", async (data: any) => {
      createdEndAt = data.scheduledEndAt;
      return { id: "s1", ...data };
    }),
  ];

  try {
    await (bookingService as any).bookSession("client-1", "c1", {
      scheduledDate: "2027-01-01",
      scheduledTime: "09:00",
      durationMin: 999,
    });
  } finally {
    restores.forEach((r) => r());
  }

  const startAt = new Date("2027-01-01T09:00:00");
  const actualDurationMin = (createdEndAt.getTime() - startAt.getTime()) / (60 * 1000);
  assert.equal(actualDurationMin, 60);
});
