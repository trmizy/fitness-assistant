/**
 * Integration tests for statsService.getWorkoutStats' "completed sessions"
 * counting — regression coverage for two real bugs found in this session:
 *
 * 1. `totalWorkouts` previously counted raw `Workout` rows (any logged
 *    workout, even ones never tied to a completed schedule) instead of the
 *    canonical `WorkoutSchedule.status === "COMPLETED"` definition used by
 *    every other adherence/training-cycle metric — producing a materially
 *    different, larger number than what the cycle report showed for the
 *    same underlying data ("58 completed" vs "21 completed").
 * 2. `weeklyWorkouts` didn't exist at all on the backend response, so the
 *    frontend's "Tuần này" tile always rendered a hardcoded "0 / N buổi"
 *    regardless of real activity.
 *
 * Uses the same gated-real-DB convention as schedule-lock.integration.test.ts
 * (no mocking — this exercises the real Prisma layer).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/stats.service.integration.test.ts
 */
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
type StatsServiceLike = (typeof import("../services/stats.service"))["statsService"];

let prisma: PrismaClientLike | undefined;
let statsService: StatsServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const statsModule = await import("../services/stats.service");
    prisma = prismaModule.prisma;
    statsService = statsModule.statsService;
  }
  return { prisma, statsService: statsService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

// Anchored to the real current day, matching schedule-lock.integration
// .test.ts's convention, so "this week"/"last week" stay correct whenever
// this suite runs. Uses the app's own Ho_Chi_Minh-aware "today"
// (todayAsScheduleDate), not a raw UTC calendar day — the two disagree for
// ~7 hours of every 24 (UTC 17:00-23:59), which would otherwise misalign
// "this week" with what currentWeekRange() (schedule-lock.util.ts) — the
// same definition getWorkoutStats itself uses — actually considers today.
function dateOnly(offsetDays: number): Date {
  const today = todayAsScheduleDate();
  const result = new Date(today);
  result.setUTCDate(result.getUTCDate() + offsetDays);
  return result;
}

async function seedSchedule(
  db: PrismaClientLike,
  userId: string,
  date: Date,
  status: string,
) {
  await db.workoutSchedule.create({
    data: {
      userId,
      date,
      status,
      sourceType: "STATS_INTEGRATION_TEST",
    },
  });
}

async function seedRawWorkout(db: PrismaClientLike, userId: string, date: Date) {
  await db.workout.create({
    data: { userId, name: "Untied raw log", date },
  });
}

async function deleteSeed(db: PrismaClientLike, userId: string) {
  await db.workoutSchedule.deleteMany({ where: { userId } });
  await db.workout.deleteMany({ where: { userId } });
}

const skipOpts = {
  skip: canUseIntegrationDb
    ? false
    : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
};

test(
  "getWorkoutStats: totalWorkouts counts COMPLETED schedules, not raw Workout rows",
  skipOpts,
  async () => {
    const { prisma: db, statsService: service } = await loadModules();
    const userId = `stats-it-completed-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      await seedSchedule(db, userId, dateOnly(-1), "COMPLETED");
      await seedSchedule(db, userId, dateOnly(-2), "COMPLETED");
      await seedSchedule(db, userId, dateOnly(-3), "SKIPPED");
      // A raw Workout log with no completed schedule tied to it must NOT
      // inflate the count — this is exactly the previous bug's shape.
      await seedRawWorkout(db, userId, dateOnly(-1));

      const stats = await service.getWorkoutStats(userId, 30);
      assert.equal(stats.totalWorkouts, 2);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getWorkoutStats: weeklyWorkouts counts only COMPLETED schedules within the current Mon-Sun week",
  skipOpts,
  async () => {
    const { prisma: db, statsService: service } = await loadModules();
    const userId = `stats-it-weekly-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      // Today and yesterday are always within the current week's tail end
      // regardless of which day-of-week "today" happens to be, EXCEPT when
      // today is Monday (offset -1 would fall into last week) — so this
      // test seeds only `dateOnly(0)` (today, always in the current week)
      // to stay deterministic across every real run date.
      await seedSchedule(db, userId, dateOnly(0), "COMPLETED");
      // 9 days ago is always outside the current week (a week is at most
      // 7 days), so this must never be counted.
      await seedSchedule(db, userId, dateOnly(-9), "COMPLETED");

      const stats = await service.getWorkoutStats(userId, 30);
      assert.equal(stats.weeklyWorkouts, 1);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getWorkoutStats: returns 0 (not undefined/NaN) for a user with no schedules at all",
  skipOpts,
  async () => {
    const { statsService: service } = await loadModules();
    const userId = `stats-it-empty-${Date.now()}`;
    const stats = await service.getWorkoutStats(userId, 30);
    assert.equal(stats.totalWorkouts, 0);
    assert.equal(stats.weeklyWorkouts, 0);
    assert.equal(stats.currentStreakDays, 0);
  },
);

test(
  "getWorkoutStats: currentStreakDays counts real consecutive COMPLETED days, not a hardcoded placeholder",
  skipOpts,
  async () => {
    const { prisma: db, statsService: service } = await loadModules();
    const userId = `stats-it-streak-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      // Today, yesterday, day-before-yesterday all completed -> streak 3.
      await seedSchedule(db, userId, dateOnly(0), "COMPLETED");
      await seedSchedule(db, userId, dateOnly(-1), "COMPLETED");
      await seedSchedule(db, userId, dateOnly(-2), "COMPLETED");
      // A gap 3 days back must stop the streak from extending further.
      await seedSchedule(db, userId, dateOnly(-4), "COMPLETED");

      const stats = await service.getWorkoutStats(userId, 30);
      assert.equal(stats.currentStreakDays, 3);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getWorkoutStats: currentStreakDays still counts through today even if today isn't completed yet",
  skipOpts,
  async () => {
    const { prisma: db, statsService: service } = await loadModules();
    const userId = `stats-it-streak-today-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      await seedSchedule(db, userId, dateOnly(-1), "COMPLETED");
      await seedSchedule(db, userId, dateOnly(-2), "COMPLETED");
      // Nothing seeded for dateOnly(0) (today) — mid-day, not trained yet.

      const stats = await service.getWorkoutStats(userId, 30);
      assert.equal(stats.currentStreakDays, 2);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);

test(
  "getWorkoutStats: a real gap yesterday resets currentStreakDays to 0, even with older completed days",
  skipOpts,
  async () => {
    const { prisma: db, statsService: service } = await loadModules();
    const userId = `stats-it-streak-broken-${Date.now()}`;
    await deleteSeed(db, userId);
    try {
      // Yesterday is a gap (NOT_STARTED counts as no completion), so the
      // streak must be 0 even though there's older completed history.
      await seedSchedule(db, userId, dateOnly(-1), "NOT_STARTED");
      await seedSchedule(db, userId, dateOnly(-2), "COMPLETED");
      await seedSchedule(db, userId, dateOnly(-3), "COMPLETED");

      const stats = await service.getWorkoutStats(userId, 30);
      assert.equal(stats.currentStreakDays, 0);
    } finally {
      await deleteSeed(db, userId);
    }
  },
);
