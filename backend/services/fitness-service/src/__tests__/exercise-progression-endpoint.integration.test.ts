import test from "node:test";
import assert from "node:assert/strict";

// Wiring test for exercise-progression.engine.ts (the engine itself is
// unit-tested exhaustively in exercise-progression.engine.test.ts — this
// proves it's actually reachable through workoutService.getExerciseProgression
// against a real database, which it was NOT until this pass: the engine
// existed, fully tested, but nothing ever called it).

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

async function seedExercise(db: PrismaClientLike, id: string, loggingMode = "REPS_LOAD") {
  return db.exercise.create({
    data: {
      id,
      exerciseName: `Progression Endpoint Exercise ${id}`,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BARBELL",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
      loggingMode,
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
      rir?: number | null;
      durationSeconds?: number | null;
      distanceMeters?: number | null;
    }>;
  },
) {
  return db.workout.create({
    data: {
      userId: options.userId,
      name: "Progression Endpoint Test Workout",
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
                rir: s.rir ?? null,
                durationSeconds: s.durationSeconds ?? null,
                distanceMeters: s.distanceMeters ?? null,
                completed: true,
              })),
            },
          },
        ],
      },
    },
  });
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.trainingCycle.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({ where: { id: { startsWith: `${userId}-ex-` } } });
}

async function seedActiveCycleWithDecision(
  db: PrismaClientLike,
  userId: string,
  decision: "KEEP" | "PROGRESS" | "ADJUST" | "DELOAD" | "REBUILD" | "INSUFFICIENT_DATA",
) {
  const cycle = await db.trainingCycle.create({
    data: {
      userId,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 0, 31)),
      status: "ACTIVE",
    },
  });
  await db.cycleAssessment.create({
    data: {
      cycleId: cycle.id,
      assessmentVersion: 1,
      status: "COMPLETED",
      decision,
    },
  });
  return cycle;
}

test(
  "getExerciseProgression returns INSUFFICIENT_DATA for a user with no history for this exercise",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `progression-endpoint-none-it-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      const result = await service.getExerciseProgression(userId, ex.id);
      assert.equal(result.status, "INSUFFICIENT_DATA");
      assert.equal(result.dataQuality, "NONE");
      assert.equal(result.exerciseId, ex.id);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getExerciseProgression proposes INCREASE_LOAD for real improving history, with no active cycle (cycleContext NONE)",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `progression-endpoint-improve-it-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 1)),
        exerciseId: ex.id,
        sets: [{ weight: 55, reps: 8, rir: 2 }],
      });
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 8)),
        exerciseId: ex.id,
        sets: [{ weight: 60, reps: 8, rir: 2 }],
      });

      const result = await service.getExerciseProgression(userId, ex.id);
      assert.equal(result.status, "INCREASE_LOAD");
      assert.equal(result.cycleContext, "NONE");
      assert.equal(result.currentPerformance?.weightKg, 60);
      assert.ok(result.reasonCodes.length > 0);
      assert.ok(result.nextTarget?.weightKg && result.nextTarget.weightKg > 60);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getExerciseProgression proposes a timed next target from real duration history",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `progression-endpoint-time-it-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const ex = await seedExercise(db, `${userId}-ex-a`, "TIME");
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 1)),
        exerciseId: ex.id,
        sets: [{ weight: null, reps: null, durationSeconds: 45 }],
      });
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 8)),
        exerciseId: ex.id,
        sets: [{ weight: null, reps: null, durationSeconds: 60 }],
      });

      const result = await service.getExerciseProgression(userId, ex.id);

      assert.equal(result.status, "INCREASE_LOAD");
      assert.equal(result.policyUsed, "TIMED_PROGRESSION");
      assert.equal(result.currentPerformance?.durationSeconds, 60);
      assert.equal(result.nextTarget?.durationSeconds, 65);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getExerciseProgression applies the active cycle DELOAD envelope from real CycleAssessment rows",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `progression-endpoint-deload-cycle-it-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      const ex = await seedExercise(db, `${userId}-ex-a`);
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 1)),
        exerciseId: ex.id,
        sets: [{ weight: 55, reps: 8, rir: 2 }],
      });
      await seedWorkoutWithSets(db, {
        userId,
        date: new Date(Date.UTC(2026, 0, 8)),
        exerciseId: ex.id,
        sets: [{ weight: 60, reps: 8, rir: 2 }],
      });
      await seedActiveCycleWithDecision(db, userId, "DELOAD");

      const result = await service.getExerciseProgression(userId, ex.id);

      assert.equal(result.cycleContext, "DELOAD");
      assert.equal(result.status, "DELOAD");
      assert.ok(result.reasonCodes.includes("CYCLE_DELOAD_OVERRIDES_LOCAL_SIGNAL"));
      assert.equal(result.nextTarget?.weightKg, 54);
      assert.notEqual(result.status, "INCREASE_LOAD");
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getExerciseProgression 404s for a nonexistent exercise id",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { workoutService: service } = await loadModules();
    await assert.rejects(
      () => service.getExerciseProgression("some-user", "00000000-0000-0000-0000-000000000000"),
      (err: any) => err?.status === 404,
    );
  },
);
