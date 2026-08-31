import test from "node:test";
import assert from "node:assert/strict";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

// Real, currently-reproducible bug found via this session's own regression
// testing (fires reliably during roughly VN-midnight-to-7am every single
// day — reproduced live while writing this test). Root cause: createWorkout
// left `Workout.date` unset when called with neither a `scheduleId` nor an
// explicit `date`, letting Prisma's raw `@default(now())` apply — a true
// UTC instant. Every other date this codebase writes/compares
// (WorkoutSchedule.date, and every other call site in workout.service.ts)
// is a UTC-midnight-anchored calendar-day LABEL in Asia/Ho_Chi_Minh (see
// schedule-lock.util.ts's own module doc comment). During the ~7 hours of
// each real day where VN-local-day has already advanced past UTC-day, a
// freshly created workout got dated "yesterday" by that label convention —
// assertWorkoutEditableByWorkoutId's schedule-less fallback then
// immediately locked it as SCHEDULE_DATE_LOCKED("past"), on data the user
// had that same moment created. Fixed by defaulting to the same
// todayAsScheduleDate() helper every other "what day is today" call site
// already uses. This test asserts the exact date value, not just "the lock
// didn't fire" (which exercise-name-snapshot.integration.test.ts already
// covers indirectly) — so a future regression is caught even if it
// coincidentally lands on the correct side of the lock boundary.

const fitnessDatabaseUrl =
  process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);

if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type WorkoutServiceLike =
  (typeof import("../services/workout.service"))["workoutService"];
type WorkoutQueueLike =
  (typeof import("../services/workout.service"))["workoutQueue"];

let prisma: PrismaClientLike | undefined;
let workoutService: WorkoutServiceLike | undefined;
let workoutQueue: WorkoutQueueLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/workout.service");
    prisma = prismaModule.prisma;
    workoutService = serviceModule.workoutService;
    workoutQueue = serviceModule.workoutQueue;
  }
  return {
    prisma,
    workoutService: workoutService!,
    workoutQueue: workoutQueue!,
  };
}

test.after(async () => {
  if (workoutQueue) await workoutQueue.close();
  if (prisma) await prisma.$disconnect();
});

test(
  "createWorkout with neither scheduleId nor an explicit date stamps Workout.date as today's VN-timezone calendar-day label, not a raw UTC instant",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { workoutService: service } = await loadModules();
    const userId = `createworkout-date-it-${Date.now()}`;

    const workout = await service.createWorkout(userId, {
      name: "Date regression test workout",
      exercises: [],
    } as any);

    const expected = todayAsScheduleDate().toISOString();
    assert.equal(
      new Date(workout.date).toISOString(),
      expected,
      "Workout.date must be today's VN-calendar-day label (todayAsScheduleDate()), not a raw now() instant",
    );

    await prisma!.workout.deleteMany({ where: { userId } });
  },
);

test(
  "createWorkout with an explicit date still honors the caller's value (regression fix scoped to the missing-date case only)",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { workoutService: service } = await loadModules();
    const userId = `createworkout-date-explicit-it-${Date.now()}`;

    const explicitDate = todayAsScheduleDate().toISOString();
    const workout = await service.createWorkout(userId, {
      name: "Date regression test workout (explicit date)",
      date: explicitDate,
      exercises: [],
    } as any);

    assert.equal(new Date(workout.date).toISOString(), explicitDate);

    await prisma!.workout.deleteMany({ where: { userId } });
  },
);
