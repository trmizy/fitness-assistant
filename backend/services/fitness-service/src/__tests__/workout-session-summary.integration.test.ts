import test from "node:test";
import assert from "node:assert/strict";

// Gate 8/9 (workout logger completeness audit) — "kết thúc workout → hiển
// thị PR và tiến độ" was confirmed missing: the completion screen showed
// generic stats only, and the one PR-shaped signal that existed (cycle-level
// newPRs) never fires per-session. This covers the new
// workoutService.getSessionSummary that backs the completion screen's PR/
// volume block (see WorkoutLogPage.tsx's `completionSummary`).

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
      exerciseName: `Session Summary Exercise ${id}`,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
    },
  });
}

// Creates a Workout directly through Prisma (bypassing
// workoutService.createWorkout's schedule-date lock, same pattern used by
// this suite's sibling integration tests) — the lock is a UX rule about
// what a real user session can edit, not something getSessionSummary itself
// needs to care about, and prior-history rows legitimately live outside the
// current week.
async function seedWorkout(
  db: PrismaClientLike,
  options: {
    userId: string;
    date: Date;
    exercises: Array<{
      exerciseId: string;
      weight?: number;
      reps?: number;
      sets: number;
    }>;
  },
) {
  return db.workout.create({
    data: {
      userId: options.userId,
      name: "Session Summary Test Workout",
      date: options.date,
      exercises: {
        create: options.exercises.map((ex, index) => ({
          exerciseId: ex.exerciseId,
          weight: ex.weight ?? null,
          reps: ex.reps ?? null,
          sets: ex.sets,
          order: index,
        })),
      },
    },
    include: { exercises: true },
  });
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workout.deleteMany({ where: { userId } });
  await db.exercise.deleteMany({
    where: { id: { startsWith: `${userId}-ex-` } },
  });
}

test(
  "getSessionSummary flags a new PR by estimated 1RM, ignores unweighted exercises for PR/volume, and excludes the current workout's own rows from prior history",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `session-summary-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const exA = await seedExercise(db, `${userId}-ex-a`);
      const exB = await seedExercise(db, `${userId}-ex-b`);
      const exC = await seedExercise(db, `${userId}-ex-c`);

      // Prior session: A at 80kg x5 (e1RM ≈ 93.3) is the record to beat.
      const priorDate = new Date(Date.UTC(2020, 0, 1));
      await seedWorkout(db, {
        userId,
        date: priorDate,
        exercises: [{ exerciseId: exA.id, weight: 80, reps: 5, sets: 3 }],
      });

      // Today's session: A improves to 90kg x5 (e1RM=105 > 93.3 → PR); B has
      // no prior record at all (first time → NOT a PR); C is a bodyweight
      // exercise with no weight logged (excluded from PR/volume entirely).
      const current = await seedWorkout(db, {
        userId,
        date: new Date(),
        exercises: [
          { exerciseId: exA.id, weight: 90, reps: 5, sets: 3 },
          { exerciseId: exB.id, weight: 50, reps: 10, sets: 2 },
          { exerciseId: exC.id, sets: 4 },
        ],
      });

      const summary = await service.getSessionSummary(userId, current.id);

      assert.equal(summary.workoutId, current.id);
      assert.equal(summary.exerciseCount, 3);
      assert.equal(summary.totalSets, 3 + 2 + 4);
      // Volume = A(90*5*3=1350) + B(50*10*2=1000); C contributes nothing.
      assert.equal(summary.totalVolumeKg, 2350);

      assert.equal(summary.prs.length, 1);
      assert.equal(summary.prs[0].exerciseId, exA.id);
      assert.equal(summary.prs[0].weightKg, 90);
      assert.equal(summary.prs[0].reps, 5);
      assert.equal(summary.prs[0].previousBestWeightKg, 80);
      assert.ok(summary.prs[0].estimated1RmKg > summary.prs[0].previousBestEstimated1RmKg);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getSessionSummary treats same weight + more reps as a PR (estimated-1RM improvement, not just raw weight)",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `session-summary-reps-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const exA = await seedExercise(db, `${userId}-ex-a`);

      await seedWorkout(db, {
        userId,
        date: new Date(Date.UTC(2020, 0, 1)),
        exercises: [{ exerciseId: exA.id, weight: 60, reps: 5, sets: 3 }],
      });
      const current = await seedWorkout(db, {
        userId,
        date: new Date(),
        exercises: [{ exerciseId: exA.id, weight: 60, reps: 8, sets: 3 }],
      });

      const summary = await service.getSessionSummary(userId, current.id);

      assert.equal(summary.prs.length, 1);
      assert.equal(summary.prs[0].weightKg, 60);
      assert.equal(summary.prs[0].reps, 8);
      assert.equal(summary.prs[0].previousBestWeightKg, 60);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getSessionSummary reports no PRs on a user's very first-ever weighted session (nothing to have beaten yet)",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `session-summary-first-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const exA = await seedExercise(db, `${userId}-ex-a`);
      const current = await seedWorkout(db, {
        userId,
        date: new Date(),
        exercises: [{ exerciseId: exA.id, weight: 40, reps: 10, sets: 3 }],
      });

      const summary = await service.getSessionSummary(userId, current.id);

      assert.equal(summary.prs.length, 0);
      assert.equal(summary.totalVolumeKg, 40 * 10 * 3);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getSessionSummary rejects a workout id that does not belong to the requesting user",
  {
    skip: canUseIntegrationDb
      ? false
      : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  },
  async () => {
    const { prisma: db, workoutService: service } = await loadModules();
    const userId = `session-summary-owner-it-${Date.now()}`;
    await deleteSeed(db, userId);

    try {
      const exA = await seedExercise(db, `${userId}-ex-a`);
      const current = await seedWorkout(db, {
        userId,
        date: new Date(),
        exercises: [{ exerciseId: exA.id, weight: 40, reps: 10, sets: 3 }],
      });

      await assert.rejects(
        () => service.getSessionSummary("someone-else", current.id),
        (err: any) => err?.status === 404,
      );
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
