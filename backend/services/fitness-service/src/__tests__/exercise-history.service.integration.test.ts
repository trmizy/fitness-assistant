/**
 * Roadmap P3.6 "Exercise history detail page"
 * (docs/features/EXERCISE_HISTORY_DETAIL_IMPACT_ANALYSIS.md).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/exercise-history.service.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

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
type ExerciseHistoryServiceLike = (typeof import("../services/exercise-history.service"))["exerciseHistoryService"];

let prisma: PrismaClientLike | undefined;
let exerciseHistoryService: ExerciseHistoryServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    exerciseHistoryService = (await import("../services/exercise-history.service")).exerciseHistoryService;
  }
  return { prisma: prisma!, exerciseHistoryService: exerciseHistoryService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
  const { redisClient } = await import("../repositories/redis");
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    await redisClient.quit();
  } catch {}
  const { workoutQueue } = await import("../services/workout.service");
  try {
    await workoutQueue.close();
  } catch {}
});

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

const EXERCISE_ID = "f1b609bf-0994-4a70-b2d5-a22465438312"; // real seeded "Barbell Curl" (REPS_LOAD)

async function cleanup(db: PrismaClientLike, userId: string) {
  await db.workoutSet.deleteMany({ where: { workoutExercise: { workout: { userId } } } });
  await db.workoutExercise.deleteMany({ where: { workout: { userId } } });
  await db.workout.deleteMany({ where: { userId } });
}

test(
  "getExerciseHistoryDetail: composes real recent sessions, personal record, and progression for a real exercise",
  skipOpts,
  async () => {
    const { prisma: db, exerciseHistoryService: svc } = await loadModules();
    const userId = `exercise-history-it-${Date.now()}`;
    try {
      await db.workout.create({
        data: {
          userId,
          name: "Older Session",
          date: daysAgo(20),
          notes: null,
          exercises: {
            create: [{
              exerciseId: EXERCISE_ID,
              sets: 2,
              order: 0,
              notes: "Felt heavy today",
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
      await db.workout.create({
        data: {
          userId,
          name: "Newer Session",
          date: daysAgo(3),
          exercises: {
            create: [{
              exerciseId: EXERCISE_ID,
              sets: 1,
              order: 0,
              workoutSets: { create: [{ setNumber: 1, weight: 50, reps: 5, completed: true }] },
            }],
          },
        },
      });

      const result: any = await svc.getExerciseHistoryDetail(userId, EXERCISE_ID);

      assert.equal(result.exercise.id, EXERCISE_ID);
      assert.equal(result.exercise.loggingMode, "REPS_LOAD");

      // Recent sessions: 2 real sessions, newest first, with real notes on
      // the older one preserved.
      assert.equal(result.recentSessions.length, 2);
      assert.equal(result.recentSessions[0].workoutName, "Newer Session");
      assert.equal(result.recentSessions[1].workoutName, "Older Session");
      assert.equal(result.recentSessions[1].notes, "Felt heavy today");
      assert.equal(result.recentSessions[1].sets.length, 2);

      // Personal record: the newer session's 50kg x5 set has a higher
      // e1RM than the older session's 42.5kg x8 set — real math, not
      // just "most recent".
      assert.equal(result.personalRecord.metric, "e1rm");
      assert.equal(result.personalRecord.weightKg, 50);
      assert.equal(result.personalRecord.reps, 5);

      // Chart data: the same real per-session points P3.3 already proved.
      assert.equal(result.chart.sessions.length, 2);

      // Progression: fail-soft, either a real result object or null —
      // never throws/crashes the whole request.
      assert.ok(result.progression === null || typeof result.progression === "object");
    } finally {
      await cleanup(db, userId);
    }
  },
);

test(
  "getExerciseHistoryDetail: 404s for a nonexistent exercise id (reuses statsService's own visibility check)",
  skipOpts,
  async () => {
    const { exerciseHistoryService: svc } = await loadModules();
    await assert.rejects(
      () => svc.getExerciseHistoryDetail(`exercise-history-404-it-${Date.now()}`, "00000000-0000-0000-0000-000000000000"),
      (err: any) => err.status === 404,
    );
  },
);
