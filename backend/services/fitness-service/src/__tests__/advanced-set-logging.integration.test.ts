/**
 * Integration tests for the professional-athlete advanced set-logging
 * fields added to WorkoutSet (setType, tempo, rangeOfMotion, side,
 * painScore, techniqueNotes) — migration
 * 20260730000000_workout_set_advanced_logging.
 *
 * These fields are additive/optional and are exercised here through the
 * REAL per-set endpoints (`addSet`/`updateSet`) against a real (test-only)
 * database — same gated-real-DB convention as schedule-lock.integration
 * .test.ts. `addSet`/`updateSet` are the correct level for this data: they
 * already operate on one real WorkoutSet at a time, matching the
 * per-set granularity a professional user's set-by-set log actually needs
 * (unlike `createWorkout`, which today only supports one uniform
 * reps/weight/rpe/rir prescription applied to every set of an exercise).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/advanced-set-logging.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

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

function dateOnly(offsetDays: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays),
  );
}

async function seedStartedSchedule(db: PrismaClientLike, userId: string) {
  const seedId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const exercise = await db.exercise.create({
    data: {
      id: `${userId}-exercise-${seedId}`,
      exerciseName: "Advanced Logging Test Exercise",
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BARBELL",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
    },
  });
  const program = await db.workoutProgram.create({
    data: {
      userId,
      name: "Advanced Logging Test Program",
      status: "ACTIVE",
      days: {
        create: {
          dayNumber: 1,
          title: "Day 1",
          exercises: { create: { exerciseId: exercise.id, order: 1, sets: 3, reps: 5 } },
        },
      },
    },
    include: { days: { include: { exercises: true } } },
  });
  const programDay = program.days[0];
  const schedule = await db.workoutSchedule.create({
    data: {
      userId,
      date: dateOnly(0),
      programDayId: programDay.id,
      sourceType: "ADVANCED_LOGGING_TEST",
    },
  });
  return { exercise, programDay, schedule };
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
  await db.workoutProgram.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({ where: { id: { startsWith: `${userId}-exercise-` } } });
}

const skipOpts = {
  skip: canUseIntegrationDb
    ? false
    : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
};

test(
  "addSet: persists setType/tempo/rangeOfMotion/side/painScore/techniqueNotes on a real WorkoutSet row",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `advlog-it-add-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedStartedSchedule(db, userId);
      const started = await service.startSchedule(userId, seeded.schedule.id);

      const created = await service.addSet(started.workoutId!, userId, {
        exerciseId: seeded.exercise.id,
        weight: 100,
        reps: 3,
        rpe: 9.5,
        setType: "TOP",
        tempo: "3-1-1-0",
        rangeOfMotion: "FULL",
        side: "BOTH",
        painScore: 1,
        techniqueNotes: "Bar path drifted forward slightly on rep 3.",
      });

      assert.equal((created as any).setType, "TOP");
      assert.equal((created as any).tempo, "3-1-1-0");
      assert.equal((created as any).rangeOfMotion, "FULL");
      assert.equal((created as any).side, "BOTH");
      assert.equal((created as any).painScore, 1);
      assert.equal(
        (created as any).techniqueNotes,
        "Bar path drifted forward slightly on rep 3.",
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "addSet: rejects an invalid setType instead of silently storing garbage",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `advlog-it-badtype-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedStartedSchedule(db, userId);
      const started = await service.startSchedule(userId, seeded.schedule.id);
      await assert.rejects(
        () =>
          service.addSet(started.workoutId!, userId, {
            exerciseId: seeded.exercise.id,
            setType: "NOT_A_REAL_TYPE" as any,
          }),
        (err: any) => err?.status === 400,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "addSet: rejects a painScore outside 0-10",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `advlog-it-badpain-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedStartedSchedule(db, userId);
      const started = await service.startSchedule(userId, seeded.schedule.id);
      await assert.rejects(
        () =>
          service.addSet(started.workoutId!, userId, {
            exerciseId: seeded.exercise.id,
            painScore: 11,
          }),
        (err: any) => err?.status === 400,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "updateSet: can update the advanced fields on an already-logged set",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `advlog-it-update-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedStartedSchedule(db, userId);
      const started = await service.startSchedule(userId, seeded.schedule.id);
      const created = await service.addSet(started.workoutId!, userId, {
        exerciseId: seeded.exercise.id,
        weight: 60,
      });

      const updated = await service.updateSet((created as any).id, userId, {
        setType: "BACKOFF",
        side: "LEFT",
        painScore: 0,
      } as any);

      assert.equal((updated as any).setType, "BACKOFF");
      assert.equal((updated as any).side, "LEFT");
      assert.equal((updated as any).painScore, 0);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "addSet: omitting the advanced fields entirely still works and leaves them null (fully backward compatible)",
  skipOpts,
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `advlog-it-omit-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const seeded = await seedStartedSchedule(db, userId);
      const started = await service.startSchedule(userId, seeded.schedule.id);
      const created = await service.addSet(started.workoutId!, userId, {
        exerciseId: seeded.exercise.id,
        weight: 50,
        reps: 10,
      });
      assert.equal((created as any).setType, null);
      assert.equal((created as any).tempo, null);
      assert.equal((created as any).side, null);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
