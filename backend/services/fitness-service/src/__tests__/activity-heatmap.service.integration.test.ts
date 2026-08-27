import test from "node:test";
import assert from "node:assert/strict";

/**
 * Roadmap P3.2 "Activity heatmap"
 * (docs/features/ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md).
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
  // Same open-handle cleanup this session's other tests importing
  // workout.service.ts already document in full (BullMQ/Redis
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

const EXERCISE_ID = "f1b609bf-0994-4a70-b2d5-a22465438312"; // real seeded "Barbell Curl"

async function cleanup(db: PrismaClientLike, userId: string) {
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workoutSet.deleteMany({ where: { workoutExercise: { workout: { userId } } } });
  await db.workoutExercise.deleteMany({ where: { workout: { userId } } });
  await db.workout.deleteMany({ where: { userId } });
}

test(
  "getActivityHeatmap: classifies all 5 real day states correctly from real seeded WorkoutSchedule rows",
  skipOpts,
  async () => {
    const { prisma: db, statsService: svc } = await loadModules();
    const userId = `activity-heatmap-it-${Date.now()}`;
    try {
      const completedDate = daysAgo(10);
      const partialDate = daysAgo(9);
      const missedDate = daysAgo(8);
      const restDate = daysAgo(7);
      const rescheduledFromDate = daysAgo(6);
      const rescheduledToDate = daysAgo(5); // where the session actually now lives

      const workout = await db.workout.create({
        data: {
          userId,
          name: "Activity Heatmap Test Workout",
          date: completedDate,
          duration: 45,
          exercises: {
            create: [{
              exerciseId: EXERCISE_ID,
              sets: 2,
              order: 0,
              workoutSets: {
                create: [
                  { setNumber: 1, weight: 50, reps: 10, rpe: 8, completed: true },
                  { setNumber: 2, weight: 52.5, reps: 8, rpe: 9, completed: true },
                ],
              },
            }],
          },
        },
      });

      await db.workoutSchedule.create({ data: { userId, date: completedDate, status: "COMPLETED", workoutId: workout.id } });
      await db.workoutSchedule.create({ data: { userId, date: partialDate, status: "PARTIALLY_COMPLETED" } });
      await db.workoutSchedule.create({ data: { userId, date: missedDate, status: "SKIPPED" } });
      // restDate: deliberately no schedule row at all.
      await db.workoutSchedule.create({
        data: {
          userId,
          date: rescheduledToDate, // the CURRENT date this session lives at
          status: "NOT_STARTED",
          originalPlannedDate: rescheduledFromDate, // where it moved AWAY from
          rescheduledAt: new Date(),
        },
      });

      const result = await svc.getActivityHeatmap(userId, daysAgo(11), daysAgo(4));
      const byDate = new Map(result.days.map((d: any) => [d.date, d.state]));

      const label = (d: Date) => d.toISOString().slice(0, 10);
      assert.equal(byDate.get(label(completedDate)), "completed");
      assert.equal(byDate.get(label(partialDate)), "partial");
      assert.equal(byDate.get(label(missedDate)), "missed");
      assert.equal(byDate.get(label(restDate)), "rest");
      assert.equal(byDate.get(label(rescheduledFromDate)), "rescheduled");
      // The date the session moved TO shows its own real current status
      // (NOT_STARTED, in the past -> missed), never "rescheduled" itself.
      assert.equal(byDate.get(label(rescheduledToDate)), "missed");
    } finally {
      await cleanup(db, userId);
    }
  },
);

test(
  "getActivityDayDetail: a completed day returns real volume/duration/RPE, reusing getSessionSummary's real PR output; a rest day returns no workout",
  skipOpts,
  async () => {
    const { prisma: db, statsService: svc } = await loadModules();
    const userId = `activity-detail-it-${Date.now()}`;
    try {
      const completedDate = daysAgo(10);
      const restDate = daysAgo(7);

      const workout = await db.workout.create({
        data: {
          userId,
          name: "Activity Detail Test Workout",
          date: completedDate,
          duration: 45,
          notes: "Felt strong",
          exercises: {
            create: [{
              exerciseId: EXERCISE_ID,
              sets: 2,
              order: 0,
              workoutSets: {
                create: [
                  { setNumber: 1, weight: 50, reps: 10, rpe: 8, completed: true },
                  { setNumber: 2, weight: 52.5, reps: 8, rpe: 9, completed: true },
                ],
              },
            }],
          },
        },
      });
      await db.workoutSchedule.create({ data: { userId, date: completedDate, status: "COMPLETED", workoutId: workout.id } });

      const dateLabel = completedDate.toISOString().slice(0, 10);
      const detail: any = await svc.getActivityDayDetail(userId, dateLabel);
      assert.equal(detail.state, "completed");
      assert.equal(detail.workout.name, "Activity Detail Test Workout");
      assert.equal(detail.durationMinutes, 45);
      assert.equal(detail.notes, "Felt strong");
      assert.equal(detail.volumeKg, 50 * 10 + 52.5 * 8);
      assert.equal(detail.rpeAverage, 8.5);
      assert.ok(Array.isArray(detail.prs), "prs must be a real array, reused from getSessionSummary");

      const restDateLabel = restDate.toISOString().slice(0, 10);
      const restDetail: any = await svc.getActivityDayDetail(userId, restDateLabel);
      assert.equal(restDetail.state, "rest");
      assert.equal(restDetail.workout, null);
    } finally {
      await cleanup(db, userId);
    }
  },
);
