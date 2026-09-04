import test from "node:test";
import assert from "node:assert/strict";
import { todayAsScheduleDate } from "../utils/schedule-lock.util";

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

// Anchored to the real current UTC day (not a hardcoded past date) so these
// schedules are always "today" or later — otherwise, once enough real time
// passes, a fixed historical anchor date silently drifts into the past and
// trips the past-date lock (schedule-lock.util.ts) that every mutating
// schedule/workout endpoint now enforces, failing this test for a reason
// that has nothing to do with what it's actually testing.
function dateOnly(offsetDays: number): Date {
  // Ho_Chi_Minh-aware "today" (todayAsScheduleDate), not a raw UTC calendar
  // day — the two disagree for ~7 hours of every 24 (UTC 17:00-23:59),
  // during which a UTC-only "today" reads as "yesterday" per the real lock
  // check and trips SCHEDULE_DATE_LOCKED — a real, previously-latent bug in
  // this exact helper (verified reproducing), not the lock logic itself.
  const today = todayAsScheduleDate();
  const result = new Date(today);
  result.setUTCDate(result.getUTCDate() + offsetDays);
  return result;
}

async function seedProgramWithSchedule(
  db: PrismaClientLike,
  options: {
    userId: string;
    date: Date;
    exerciseCount: number;
    duplicateGlobalExercise?: boolean;
  },
) {
  const exerciseIds: string[] = [];
  const uniqueExerciseCount = options.duplicateGlobalExercise
    ? 1
    : options.exerciseCount;
  const seedId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  for (let i = 0; i < uniqueExerciseCount; i += 1) {
    const exercise = await db.exercise.create({
      data: {
        id: `${options.userId}-exercise-${seedId}-${i + 1}`,
        exerciseName: `Integration Exercise ${i + 1}`,
        typeOfActivity: "STRENGTH",
        typeOfEquipment: "BODYWEIGHT",
        bodyPart: "UPPER_BODY",
        type: "PUSH",
        muscleGroupsActivated: ["test"],
        instructions: "Test exercise.",
      },
    });
    exerciseIds.push(exercise.id);
  }

  const program = await db.workoutProgram.create({
    data: {
      userId: options.userId,
      name: "Integration Workout Program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Integration Day 1",
          exercises: {
            create: Array.from(
              { length: options.exerciseCount },
              (_unused, index) => ({
                exerciseId: options.duplicateGlobalExercise
                  ? exerciseIds[0]
                  : exerciseIds[index],
                order: index + 1,
                sets: 1,
                reps: 10,
              }),
            ),
          },
        },
      },
    },
    include: {
      days: {
        include: {
          exercises: { orderBy: { order: "asc" } },
        },
      },
    },
  });

  const programDay = program.days[0];
  const schedule = await db.workoutSchedule.create({
    data: {
      userId: options.userId,
      date: options.date,
      programDayId: programDay.id,
      sourceType: "INTEGRATION_TEST",
    },
  });

  return {
    exerciseIds,
    program,
    programDay,
    plannedExercises: programDay.exercises,
    schedule,
  };
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  const workouts = await db.workout.findMany({
    where: { userId },
    select: { id: true },
  });
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({
    where: { id: { startsWith: `${userId}-exercise-` } },
  });
  for (const workout of workouts) {
    await db.workout.deleteMany({ where: { id: workout.id } });
  }
}

test(
  "Workout Log completion persists canonical progress through Prisma",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `workout-it-${Date.now()}`;
    await deleteSeed(db, userId);

    const seeded = await seedProgramWithSchedule(db, {
      userId,
      date: dateOnly(0),
      exerciseCount: 4,
    });

    try {
      const started = await service.startSchedule(userId, seeded.schedule.id);
      assert.equal(started.totalExercises, 4);
      assert.equal(started.completedExercises, 0);
      assert.equal(started.progressPercent, 0);
      assert.equal(started.sessionStatus, "in_progress");

      const startedSchedule = await db.workoutSchedule.findUniqueOrThrow({
        where: { id: seeded.schedule.id },
        include: { workout: { include: { exercises: true } } },
      });
      assert.equal(startedSchedule.status, "IN_PROGRESS");
      assert.ok(startedSchedule.workoutId);
      assert.equal(startedSchedule.workout?.exercises.length, 4);
      assert.equal(
        startedSchedule.workout?.exercises.every((exercise) =>
          Boolean(exercise.programExerciseId),
        ),
        true,
      );

      const expectedProgress = [25, 50, 75, 100];
      for (const [
        index,
        plannedExercise,
      ] of seeded.plannedExercises.entries()) {
        const result = await service.completeScheduleExercise(
          userId,
          seeded.schedule.id,
          plannedExercise.id,
        );
        assert.equal(result.completedExercises, index + 1);
        assert.equal(result.totalExercises, 4);
        assert.equal(result.progressPercent, expectedProgress[index]);
      }

      const completedSchedule = await db.workoutSchedule.findUniqueOrThrow({
        where: { id: seeded.schedule.id },
        include: {
          workout: {
            include: {
              exercises: {
                include: { workoutSets: true },
              },
            },
          },
        },
      });
      assert.equal(completedSchedule.status, "COMPLETED");
      assert.equal(completedSchedule.progressPercent, 100);
      assert.equal(completedSchedule.completedExercises, 4);
      assert.equal(completedSchedule.totalExercises, 4);
      assert.ok(completedSchedule.completedAt);
      assert.equal(
        completedSchedule.workout?.exercises.every(
          (exercise) =>
            exercise.workoutSets.length > 0 &&
            exercise.workoutSets.every((set) => set.completed),
        ),
        true,
      );

      const idempotent = await service.completeScheduleExercise(
        userId,
        seeded.schedule.id,
        seeded.plannedExercises[0].id,
      );
      assert.equal(idempotent.progressPercent, 100);
      assert.equal(idempotent.completedExercises, 4);

      const duplicateLogs = await db.workoutExercise.groupBy({
        by: ["workoutId", "programExerciseId"],
        where: {
          workoutId: completedSchedule.workoutId!,
          programExerciseId: { not: null },
        },
        _count: { id: true },
      });
      assert.equal(
        duplicateLogs.every((row) => row._count.id === 1),
        true,
      );

      await assert.rejects(
        () =>
          service.completeScheduleExercise(
            "other-user",
            seeded.schedule.id,
            seeded.plannedExercises[0].id,
          ),
        (err: any) => err?.status === 404,
      );

      const wrongSeed = await seedProgramWithSchedule(db, {
        userId,
        date: dateOnly(1),
        exerciseCount: 1,
      });
      await assert.rejects(
        () =>
          service.completeScheduleExercise(
            userId,
            seeded.schedule.id,
            wrongSeed.plannedExercises[0].id,
          ),
        (err: any) => err?.status === 404,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  // Hardening pass §3 — completeScheduleExercise's optional 4th arg
  // (`performed`) is the only way a session-only exercise swap
  // (SwapExerciseModal) and the user's actually-logged weight/RPE/RIR ever
  // reach the persisted WorkoutExercise/WorkoutSet log rows for the common,
  // schedule-linked completion path. Before this, that data was silently
  // discarded and only the PLANNED exercise/weight were ever recorded.
  "Workout Log completion with `performed` records the actually-performed exercise/weight/RPE/RIR, and leaves the planned program exercise untouched",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `workout-swap-it-${Date.now()}`;
    await deleteSeed(db, userId);

    const seeded = await seedProgramWithSchedule(db, {
      userId,
      date: dateOnly(0),
      exerciseCount: 2,
    });
    const substituteExerciseId = seeded.exerciseIds[1]; // a REAL exercise row, standing in for what SwapExerciseModal would return

    try {
      await service.startSchedule(userId, seeded.schedule.id);
      const plannedExercise = seeded.plannedExercises[0];

      const result = await service.completeScheduleExercise(
        userId,
        seeded.schedule.id,
        plannedExercise.id,
        {
          exerciseId: substituteExerciseId,
          weight: 42.5,
          reps: 8,
          rpe: 8.5,
          rir: 1,
          notes: 'Đã đổi từ "Integration Exercise 1" sang "Integration Exercise 2"',
        },
      );
      assert.equal(result.completedExercises, 1);

      const loggedExercise = await db.workoutExercise.findFirstOrThrow({
        where: { workoutId: result.workoutId!, programExerciseId: plannedExercise.id },
        include: { workoutSets: true },
      });
      // The LOG row records what was actually performed...
      assert.equal(loggedExercise.exerciseId, substituteExerciseId);
      assert.equal(loggedExercise.weight, 42.5);
      assert.equal(loggedExercise.reps, 8);
      assert.match(loggedExercise.notes ?? "", /Đã đổi từ/);
      assert.ok(loggedExercise.workoutSets.length > 0);
      assert.equal(loggedExercise.workoutSets[0].rpe, 8.5);
      assert.equal(loggedExercise.workoutSets[0].rir, 1);
      assert.equal(loggedExercise.workoutSets.every((s) => s.completed), true);

      // ...while the underlying PLAN (WorkoutProgramExercise) is completely
      // untouched — a session-only swap must never rewrite the program, so
      // future weeks/sessions still see the originally-planned exercise.
      const stillPlanned = await db.workoutProgramExercise.findUniqueOrThrow({
        where: { id: plannedExercise.id },
      });
      assert.equal(stillPlanned.exerciseId, plannedExercise.exerciseId);
      assert.notEqual(stillPlanned.exerciseId, substituteExerciseId);

      // Re-completing (idempotent path) with a CORRECTED value must update
      // the existing log row, not silently drop the correction.
      const again = await service.completeScheduleExercise(
        userId,
        seeded.schedule.id,
        plannedExercise.id,
        { weight: 45, rpe: 9, rir: 0 },
      );
      assert.equal(again.completedExercises, 1);
      const reLogged = await db.workoutExercise.findFirstOrThrow({
        where: { workoutId: result.workoutId!, programExerciseId: plannedExercise.id },
        include: { workoutSets: true },
      });
      assert.equal(reLogged.weight, 45);
      assert.equal(reLogged.workoutSets[0].rpe, 9);
      assert.equal(reLogged.workoutSets[0].rir, 0);
      // exerciseId from the FIRST completion (the swap) must survive since
      // the correction call didn't specify a new one.
      assert.equal(reLogged.exerciseId, substituteExerciseId);

      // Omitting `performed` entirely (old call shape) must still work
      // exactly as before — falls back to the plan's prescribed values.
      const secondExercise = seeded.plannedExercises[1];
      const noBody = await service.completeScheduleExercise(
        userId,
        seeded.schedule.id,
        secondExercise.id,
      );
      assert.equal(noBody.completedExercises, 2);
      const fallbackLogged = await db.workoutExercise.findFirstOrThrow({
        where: { workoutId: result.workoutId!, programExerciseId: secondExercise.id },
      });
      assert.equal(fallbackLogged.exerciseId, secondExercise.exerciseId);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "Workout Log completion keys off planned exercise id when global exercise id is duplicated",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `workout-dup-it-${Date.now()}`;
    await deleteSeed(db, userId);

    const seeded = await seedProgramWithSchedule(db, {
      // Today, not a future date — this test is about duplicate-exercise-id
      // handling, not date locking (future days are now locked, §3.3 fix).
      userId,
      date: dateOnly(0),
      exerciseCount: 2,
      duplicateGlobalExercise: true,
    });

    try {
      await service.startSchedule(userId, seeded.schedule.id);
      const first = await service.completeScheduleExercise(
        userId,
        seeded.schedule.id,
        seeded.plannedExercises[0].id,
      );
      assert.equal(first.completedExercises, 1);
      assert.equal(first.totalExercises, 2);
      assert.equal(first.progressPercent, 50);

      const schedule = await db.workoutSchedule.findUniqueOrThrow({
        where: { id: seeded.schedule.id },
        include: {
          workout: {
            include: {
              exercises: {
                orderBy: { order: "asc" },
                include: { workoutSets: true },
              },
            },
          },
        },
      });

      const [firstLogged, secondLogged] = schedule.workout?.exercises ?? [];
      assert.equal(
        firstLogged.programExerciseId,
        seeded.plannedExercises[0].id,
      );
      assert.equal(
        secondLogged.programExerciseId,
        seeded.plannedExercises[1].id,
      );
      assert.equal(
        firstLogged.workoutSets.every((set) => set.completed),
        true,
      );
      assert.equal(
        secondLogged.workoutSets.every((set) => set.completed),
        false,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
