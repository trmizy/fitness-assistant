import test from "node:test";
import assert from "node:assert/strict";
import { DayOfWeek } from "../generated/prisma";
import { availabilityService } from "../services/availability.service";
import { availabilityRepository } from "../repositories/availability.repository";
import { sessionRepository } from "../repositories/session.repository";
import { profileRepository, prisma } from "../repositories/profile.repository";
import { stubPtRestrictionReads } from "./pt-restriction-reads.stub";

stubPtRestrictionReads();

function patch<T extends object, K extends keyof T>(object: T, key: K, replacement: unknown): () => void {
  const original = object[key];
  object[key] = replacement as T[K];
  return () => { object[key] = original; };
}

test("an explicit all-off week persists an inactive marker so legacy hours cannot reappear", async () => {
  const writes: any[] = [];
  const restore = [
    patch(prisma.pTAvailability, "deleteMany", async () => ({ count: 0 })),
    patch(prisma.pTAvailability, "create", async (args: any) => { writes.push(args.data); return args.data; }),
    patch(prisma, "$transaction", async (operations: Promise<unknown>[]) => Promise.all(operations)),
  ];
  try {
    await availabilityRepository.replaceAll("pt-1", []);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].isActive, false);
    assert.equal(writes[0].ptUserId, "pt-1");
  } finally { restore.reverse().forEach((fn) => fn()); }
});

test("planning day off changes new-booking availability without touching existing sessions", async () => {
  const originalSessionRead = sessionRepository.findConflictsByDate;
  const calls: string[] = [];
  const restore = [
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(availabilityRepository, "addException", async () => { calls.push("exception"); return { id: "day-off-1" }; }),
    patch(sessionRepository, "findConflictsByDate", async () => { calls.push("sessions"); throw new Error("Existing sessions must not be read or changed"); }),
  ];
  try {
    const result = await availabilityService.addPlanningException("pt-1", "2099-05-18", "Nghỉ phép");
    assert.equal(result.affectedSessions, 0);
    assert.deepEqual(calls, ["exception"]);
  } finally {
    restore.reverse().forEach((fn) => fn());
    assert.equal(sessionRepository.findConflictsByDate, originalSessionRead);
  }
});

test("public bookable-only slots exclude elapsed hours and overlaps, without client details", async () => {
  const past = new Date();
  past.setDate(past.getDate() - 2);
  const pastKey = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
  const future = new Date();
  future.setDate(future.getDate() + 3);
  const futureKey = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
  const dayMap = [DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY];
  const restore = [
    patch(profileRepository, "findByUserId", async () => ({ sessionDurationMinutes: 60 })),
    patch(availabilityRepository, "findExceptions", async () => []),
    patch(availabilityRepository, "findByPT", async () => [past, future].map((day) => ({ dayOfWeek: dayMap[day.getDay()], startTime: "08:00", endTime: "11:00", isActive: true }))),
    patch(sessionRepository, "findBookingConflictsByDate", async (_pt: string, start: Date) => start.getFullYear() === future.getFullYear() && start.getMonth() === future.getMonth() && start.getDate() === future.getDate() ? [{ scheduledStartAt: new Date(`${futureKey}T08:30:00`), scheduledEndAt: new Date(`${futureKey}T09:30:00`) }] : []),
  ];
  try {
    assert.deepEqual(await availabilityService.getAvailableSlots("pt-1", pastKey, true), []);
    assert.deepEqual(await availabilityService.getAvailableSlots("pt-1", futureKey, true), ["10:00"]);
  } finally { restore.reverse().forEach((fn) => fn()); }
});
