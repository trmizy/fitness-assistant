/**
 * Roadmap P3.4 "Training consistency and adherence"
 * (docs/features/TRAINING_CONSISTENCY_ADHERENCE_IMPACT_ANALYSIS.md).
 *
 * Proves getCycleReport's new `workouts.breakdown`/`rescheduledSessions`
 * against a real seeded cycle with all 5 real states, INCLUDING a genuine
 * reschedule (the exact case the pre-existing `completed`/`missed`/
 * `upcoming`/`completionRate` fields could never make visible — a
 * rescheduled session's row just moves to its new date and silently
 * reappears there with zero trace of the reschedule).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/cycle-adherence-breakdown.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}
const skipOpts = {
  skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test",
  timeout: 60_000,
};

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type TrainingCycleServiceLike = (typeof import("../services/training-cycle.service"))["trainingCycleService"];

let prisma: PrismaClientLike | undefined;
let trainingCycleService: TrainingCycleServiceLike | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    trainingCycleService = (await import("../services/training-cycle.service")).trainingCycleService;
  }
  return { prisma: prisma!, trainingCycleService: trainingCycleService! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
function daysFromNow(n: number): Date {
  return daysAgo(-n);
}

test(
  "getCycleReport: breakdown correctly separates rescheduled/planned from completed/missed, where the old fields conflate reschedules invisibly",
  skipOpts,
  async () => {
    const { prisma: db, trainingCycleService: svc } = await loadModules();
    const userId = randomUUID();

    const cycle = await db.trainingCycle.create({
      data: {
        userId,
        cycleIndex: 1,
        startDate: daysAgo(10),
        endDate: daysFromNow(10),
        durationDays: 20,
        status: "ACTIVE",
      },
    });

    try {
      // Day -8: a real completed session.
      await db.workoutSchedule.create({
        data: { userId, date: daysAgo(8), status: "COMPLETED", trainingCycleId: cycle.id },
      });
      // Day -6: partially completed.
      await db.workoutSchedule.create({
        data: { userId, date: daysAgo(6), status: "PARTIALLY_COMPLETED", trainingCycleId: cycle.id },
      });
      // Day -4: skipped outright.
      await db.workoutSchedule.create({
        data: { userId, date: daysAgo(4), status: "SKIPPED", trainingCycleId: cycle.id },
      });
      // A session originally planned for day -2, rescheduled to day +2
      // (still pending there) — the row now lives at day +2, with
      // originalPlannedDate pointing back at day -2. Old fields would show
      // this ONLY as "upcoming" at day +2, with day -2 showing nothing at
      // all — no trace a reschedule ever happened.
      await db.workoutSchedule.create({
        data: {
          userId,
          date: daysFromNow(2),
          status: "NOT_STARTED",
          trainingCycleId: cycle.id,
          originalPlannedDate: daysAgo(2),
          rescheduledAt: new Date(),
        },
      });
      // Day +5: a genuinely upcoming, never-touched planned session.
      await db.workoutSchedule.create({
        data: { userId, date: daysFromNow(5), status: "NOT_STARTED", trainingCycleId: cycle.id },
      });

      const report: any = await svc.getCycleReport(cycle.id, userId);

      // New breakdown: completed=1, partial=1, missed=1, rescheduled=1
      // (day -2, the ORIGINAL date), planned=2 (day +2 AND day +5).
      assert.equal(report.workouts.breakdown.completed, 1);
      assert.equal(report.workouts.breakdown.partial, 1);
      assert.equal(report.workouts.breakdown.missed, 1);
      assert.equal(report.workouts.breakdown.rescheduled, 1);
      assert.equal(report.workouts.breakdown.planned, 2);
      // adherencePct = completed / (completed+partial+missed+rescheduled) = 1/4 = 25%.
      assert.equal(report.workouts.breakdown.adherencePct, 25);

      assert.equal(report.workouts.rescheduledSessions.length, 1);
      assert.equal(report.workouts.rescheduledSessions[0].status, "NOT_STARTED");

      // Pre-existing fields are UNCHANGED and still internally consistent
      // under their OWN (older, reschedule-blind) definition: missed =
      // day -6 (partial, in the past) + day -4 (skipped) = 2; upcoming =
      // day +2 (the rescheduled-to date) + day +5 = 2; completionRate =
      // 1/(1+2) = 33%. This is DIFFERENT from the new adherencePct (25%)
      // — the doc comment on workouts.breakdown explains why (reschedule
      // visibility), a deliberate, disclosed divergence, not a bug.
      assert.equal(report.workouts.completed, 1);
      assert.equal(report.workouts.missed, 2);
      assert.equal(report.workouts.upcoming, 2);
      assert.equal(report.workouts.completionRate, 33);
    } finally {
      await db.workoutSchedule.deleteMany({ where: { userId } });
      await db.trainingCycle.deleteMany({ where: { userId } });
    }
  },
);
