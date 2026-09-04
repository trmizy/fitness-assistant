import test from "node:test";
import assert from "node:assert/strict";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

// Gap analysis P0 #1 (docs/OPENGYM_VS_FITNESS_ASSISTANT_GAP_ANALYSIS.md):
// "previous-set prefill" was confirmed MISSING — no per-exercise history
// endpoint existed anywhere. Covers workoutService.getPreviousPerformance,
// which backs the new GET /workouts/exercises/:exerciseId/previous-performance
// route.

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

async function seedExercise(db: PrismaClientLike, id: string) {
  return db.exercise.create({
    data: {
      id,
      exerciseName: `Previous Performance Exercise ${id}`,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BARBELL",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
    },
  });
}

async function seedWorkoutWithSets(
  db: PrismaClientLike,
  options: {
    userId: string;
    date: Date;
    exerciseId: string;
    sets: Array<{
      weight: number | null;
      reps: number | null;
      completed: boolean;
      bodyWeightAtSetKg?: number | null;
      durationSeconds?: number | null;
      distanceMeters?: number | null;
    }>;
  },
) {
  return db.workout.create({
    data: {
      userId: options.userId,
      name: "Previous Performance Test Workout",
      date: options.date,
      exercises: {
        create: [
          {
            exerciseId: options.exerciseId,
            sets: options.sets.length,
            order: 0,
            workoutSets: {
              create: options.sets.map((s, i) => ({
                setNumber: i + 1,
                weight: s.weight,
                reps: s.reps,
                bodyWeightAtSetKg: s.bodyWeightAtSetKg ?? null,
                durationSeconds: s.durationSeconds ?? null,
                distanceMeters: s.distanceMeters ?? null,
                completed: s.completed,
              })),
            },
          },
        ],
      },
    },
    include: { exercises: { include: { workoutSets: true } } },
  });
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workout.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({
    where: { id: { startsWith: `${userId}-ex-` } },
  });
}

test(
  "getPreviousPerformance returns the most recent PRIOR completed session's sets, per set, excluding the current workout",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `prev-perf-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);

      const older = await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2020, 0, 1)),
        exerciseId: ex.id,
        sets: [{ weight: 70, reps: 8, completed: true }],
      });

      const mostRecent = await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 7, 1)),
        exerciseId: ex.id,
        sets: [
          { weight: 100, reps: 8, completed: true },
          { weight: 100, reps: 8, completed: true },
          { weight: 100, reps: 7, completed: true },
        ],
      });

      // A brand new workout in progress "right now" — must be excluded from
      // its own previous-performance lookup.
      const current = await seedWorkoutWithSets(db, {
        userId,
        date: new Date(),
        exerciseId: ex.id,
        sets: [{ weight: 999, reps: 99, completed: false }],
      });

      const result = await service.getPreviousPerformance(userId, ex.id, current.id);

      assert.equal(result.hasHistory, true);
      assert.equal(result.sets.length, 3);
      assert.deepEqual(
        result.sets.map((s) => [s.weightKg, s.reps]),
        [
          [100, 8],
          [100, 8],
          [100, 7],
        ],
      );
      // older/mostRecent only exist to prove "most recent prior session",
      // not "any prior session" — asserting their ids confirms the fixture
      // actually created two distinct workouts rather than being dead code.
      assert.notEqual(older.id, mostRecent.id);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getPreviousPerformance finds a session dated 'today' (VN-timezone calendar-day label) — real bug found via this session's own E2E testing: a `date: { lt: new Date() }` filter used to exclude this exact case for ~7 hours of every real day",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `prev-perf-today-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      // todayAsScheduleDate() is the SAME "today" label every real write
      // path in this codebase uses (createWorkout, WorkoutSchedule, etc.)
      // — during roughly 7 hours of every real day (VN midnight-7am) this
      // is chronologically AHEAD of a raw `new Date()` instant, which is
      // exactly the condition the removed `lt: new Date()` filter got
      // wrong. Deterministic regardless of what wall-clock hour this test
      // itself runs at.
      await seedWorkoutWithSets(db, {
        userId,
        date: todayAsScheduleDate(),
        exerciseId: ex.id,
        sets: [{ weight: 65, reps: 9, completed: true }],
      });

      const result = await service.getPreviousPerformance(userId, ex.id);

      assert.equal(result.hasHistory, true);
      assert.equal(result.sets.length, 1);
      assert.equal(result.sets[0].weightKg, 65);
      assert.equal(result.sets[0].reps, 9);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getPreviousPerformance excludes incomplete sets from the returned history",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `prev-perf-incomplete-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 1)),
        exerciseId: ex.id,
        sets: [
          { weight: 50, reps: 10, completed: true },
          { weight: 50, reps: 10, completed: false },
        ],
      });

      const result = await service.getPreviousPerformance(userId, ex.id);

      assert.equal(result.sets.length, 1);
      assert.equal(result.sets[0].reps, 10);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getPreviousPerformance returns bodyweight, duration, and distance fields without mapping them into weight/reps",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `prev-perf-modes-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 1)),
        exerciseId: ex.id,
        sets: [
          {
            weight: 10,
            reps: 8,
            bodyWeightAtSetKg: 76.5,
            durationSeconds: 1500,
            distanceMeters: 5000,
            completed: true,
          },
        ],
      });

      const result = await service.getPreviousPerformance(userId, ex.id);

      assert.equal(result.hasHistory, true);
      assert.equal(result.sets[0].weightKg, 10);
      assert.equal(result.sets[0].reps, 8);
      assert.equal(result.sets[0].bodyWeightAtSetKg, 76.5);
      assert.equal(result.sets[0].durationSeconds, 1500);
      assert.equal(result.sets[0].distanceMeters, 5000);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getPreviousPerformance reports hasHistory: false when the user has never logged this exercise",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `prev-perf-none-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      const result = await service.getPreviousPerformance(userId, ex.id);
      assert.equal(result.hasHistory, false);
      assert.deepEqual(result.sets, []);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
