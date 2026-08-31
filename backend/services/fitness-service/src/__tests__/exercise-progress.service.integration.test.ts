import test from "node:test";
import assert from "node:assert/strict";

/**
 * Roadmap P3.3 "Exercise progress charts"
 * (docs/features/EXERCISE_PROGRESS_CHARTS_IMPACT_ANALYSIS.md).
 */

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
  timeout: 60_000,
};

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type StatsServiceModule = typeof import("../services/stats.service");

let prisma: PrismaClientLike | undefined;
let statsModule: StatsServiceModule | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    statsModule = await import("../services/stats.service");
  }
  return { prisma: prisma!, statsService: statsModule!.statsService };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
  // Same open-handle cleanup this session's other integration tests
  // importing workout.service.ts already document in full (BullMQ/Redis
  // module-level connections that otherwise keep the process alive).
  const { redisClient } = await import("../repositories/redis");
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    await redisClient.quit();
  } catch {
    // not connected / already closed
  }
  const { workoutQueue } = await import("../services/workout.service");
  try {
    await workoutQueue.close();
  } catch {
    // already closed
  }
});

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
const label = (d: Date) => d.toISOString().slice(0, 10);

const EXERCISE_ID = "f1b609bf-0994-4a70-b2d5-a22465438312"; // real seeded "Barbell Curl" (REPS_LOAD)

async function cleanup(db: PrismaClientLike, userId: string) {
  await db.workoutSet.deleteMany({ where: { workoutExercise: { workout: { userId } } } });
  await db.workoutExercise.deleteMany({ where: { workout: { userId } } });
  await db.workout.deleteMany({ where: { userId } });
}

test(
  "getExerciseProgress: real chronological series, merging two WorkoutExercise rows in one workout into a single session point",
  skipOpts,
  async () => {
    const { prisma: db, statsService: svc } = await loadModules();
    const userId = `exercise-progress-it-${Date.now()}`;
    try {
      const olderDate = daysAgo(20);
      const newerDate = daysAgo(5);

      await db.workout.create({
        data: {
          userId,
          name: "Older Session",
          date: olderDate,
          exercises: {
            create: [{
              exerciseId: EXERCISE_ID,
              sets: 2,
              order: 0,
              workoutSets: {
                create: [
                  { setNumber: 1, weight: 40, reps: 10, completed: true },
                  { setNumber: 2, weight: 42.5, reps: 8, completed: true },
                ],
              },
            }],
          },
        },
      });

      // Newer session: the same exercise logged via TWO separate
      // WorkoutExercise rows in the same workout — must merge into one
      // session point, not split into two.
      const newerWorkout = await db.workout.create({
        data: { userId, name: "Newer Session", date: newerDate },
      });
      await db.workoutExercise.create({
        data: {
          workoutId: newerWorkout.id,
          exerciseId: EXERCISE_ID,
          sets: 1,
          order: 0,
          workoutSets: { create: [{ setNumber: 1, weight: 50, reps: 5, completed: true }] },
        },
      });
      await db.workoutExercise.create({
        data: {
          workoutId: newerWorkout.id,
          exerciseId: EXERCISE_ID,
          sets: 1,
          order: 1,
          workoutSets: { create: [{ setNumber: 1, weight: 45, reps: 12, completed: true }] },
        },
      });

      const result: any = await svc.getExerciseProgress(userId, EXERCISE_ID, {});
      assert.equal(result.exerciseId, EXERCISE_ID);
      assert.equal(result.loggingMode, "REPS_LOAD");
      assert.equal(result.sessions.length, 2, "two real calendar sessions, not three");

      // Oldest-to-newest order.
      assert.equal(result.sessions[0].date, label(olderDate));
      assert.equal(result.sessions[1].date, label(newerDate));

      assert.equal(result.sessions[0].maxWeightKg, 42.5);
      assert.equal(result.sessions[0].maxReps, 10);

      // Newer session merged both WorkoutExercise rows: heaviest set is
      // 50kg (from the first row), highest reps is 12 (from the second).
      assert.equal(result.sessions[1].maxWeightKg, 50);
      assert.equal(result.sessions[1].maxReps, 12);
    } finally {
      await cleanup(db, userId);
    }
  },
);

test(
  "getExerciseProgress: from/to narrows the range to real sessions within it",
  skipOpts,
  async () => {
    const { prisma: db, statsService: svc } = await loadModules();
    const userId = `exercise-progress-range-it-${Date.now()}`;
    try {
      const insideDate = daysAgo(10);
      const outsideDate = daysAgo(60);

      for (const d of [insideDate, outsideDate]) {
        await db.workout.create({
          data: {
            userId,
            name: `Session ${label(d)}`,
            date: d,
            exercises: {
              create: [{
                exerciseId: EXERCISE_ID,
                sets: 1,
                order: 0,
                workoutSets: { create: [{ setNumber: 1, weight: 30, reps: 10, completed: true }] },
              }],
            },
          },
        });
      }

      const result: any = await svc.getExerciseProgress(userId, EXERCISE_ID, {
        from: label(daysAgo(15)),
        to: label(daysAgo(1)),
      });
      assert.equal(result.sessions.length, 1);
      assert.equal(result.sessions[0].date, label(insideDate));
    } finally {
      await cleanup(db, userId);
    }
  },
);

test(
  "getExerciseProgress: 404s for a nonexistent exercise id and for another user's private USER_CUSTOM exercise",
  skipOpts,
  async () => {
    const { prisma: db, statsService: svc } = await loadModules();
    const userId = `exercise-progress-vis-it-${Date.now()}`;
    const ownerId = `exercise-progress-owner-it-${Date.now()}`;

    await assert.rejects(
      () => svc.getExerciseProgress(userId, "00000000-0000-0000-0000-000000000000", {}),
      (err: any) => err.status === 404,
    );

    const customExercise = await db.exercise.create({
      data: {
        exerciseName: "Private Custom Exercise (progress-chart test)",
        typeOfActivity: "STRENGTH",
        typeOfEquipment: "BODYWEIGHT",
        bodyPart: "UPPER_BODY",
        type: "PUSH",
        muscleGroupsActivated: [],
        instructions: "test",
        loggingMode: "REPS_LOAD",
        source: "USER_CUSTOM",
        ownerId,
      },
    });
    try {
      await assert.rejects(
        () => svc.getExerciseProgress(userId, customExercise.id, {}),
        (err: any) => err.status === 404,
        "a private USER_CUSTOM exercise owned by someone else must 404, never leak existence",
      );
      // The real owner CAN see it (even with zero logged sessions).
      const ownResult: any = await svc.getExerciseProgress(ownerId, customExercise.id, {});
      assert.equal(ownResult.exerciseId, customExercise.id);
      assert.deepEqual(ownResult.sessions, []);
    } finally {
      await db.exercise.delete({ where: { id: customExercise.id } });
    }
  },
);
