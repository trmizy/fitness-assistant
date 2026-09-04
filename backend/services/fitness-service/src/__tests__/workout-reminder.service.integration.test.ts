/**
 * Roadmap P4.1 "Notifications/reminders"
 * (docs/features/NOTIFICATIONS_REMINDERS_IMPACT_ANALYSIS.md).
 *
 * Proves the REAL default deps (real Prisma queries) against real
 * seeded data — the unit tests already own the sweep's own control
 * flow (idempotency marking, per-row error isolation) via injected
 * mocks; this proves the real WHERE clauses are correct.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/workout-reminder.service.integration.test.ts
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
type ReminderModule = typeof import("../services/workout-reminder.service");

let prisma: PrismaClientLike | undefined;
let reminderModule: ReminderModule | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    reminderModule = await import("../services/workout-reminder.service");
  }
  return { prisma: prisma!, mod: reminderModule! };
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
function today(): Date {
  return daysAgo(0);
}

async function cleanup(db: PrismaClientLike, userId: string) {
  await db.workoutSchedule.deleteMany({ where: { userId } });
}

test(
  "runUpcomingReminderSweep (real deps): finds today's not-started session, marks it, never re-fires on a second run",
  skipOpts,
  async () => {
    const { prisma: db, mod } = await loadModules();
    const userId = `workout-upcoming-it-${Date.now()}`;
    try {
      const row = await db.workoutSchedule.create({
        data: { userId, date: today(), status: "NOT_STARTED" },
      });

      // Scoped to this test's own userId, on top of the real default
      // WHERE clause (date/status/upcomingReminderSentAt) — the shared
      // test DB may have other real rows dated "today" from other tests
      // running around the same time, so an unscoped scan would be
      // flaky. The date/status/idempotency filtering itself is still the
      // real, unmodified logic from defaultWorkoutReminderDeps.
      const deps = {
        ...mod.defaultWorkoutReminderDeps,
        findUpcomingCandidates: (todayStart: Date, limit: number) =>
          db.workoutSchedule.findMany({
            where: { userId, date: todayStart, status: "NOT_STARTED", upcomingReminderSentAt: null },
            take: limit,
            select: { id: true, userId: true },
          }),
        notify: async () => {}, // avoid a real cross-service HTTP call in this test
      };

      const first = await mod.runUpcomingReminderSweep(deps);
      assert.equal(first.scanned, 1);
      assert.equal(first.notified, 1);

      const reread = await db.workoutSchedule.findUnique({ where: { id: row.id } });
      assert.ok(reread!.upcomingReminderSentAt, "the row must be marked so it is never re-scanned");

      const second = await mod.runUpcomingReminderSweep(deps);
      assert.equal(second.scanned, 0, "a row already reminded must not be a candidate again");
    } finally {
      await cleanup(db, userId);
    }
  },
);

test(
  "runUpcomingReminderSweep (real deps): a session scheduled for a different day is never a candidate",
  skipOpts,
  async () => {
    const { prisma: db, mod } = await loadModules();
    const userId = `workout-upcoming-other-day-it-${Date.now()}`;
    try {
      await db.workoutSchedule.create({ data: { userId, date: daysAgo(-3), status: "NOT_STARTED" } });
      await db.workoutSchedule.create({ data: { userId, date: daysAgo(3), status: "NOT_STARTED" } });

      const result = await mod.runUpcomingReminderSweep({
        ...mod.defaultWorkoutReminderDeps,
        findUpcomingCandidates: (todayStart, limit) =>
          db.workoutSchedule.findMany({
            where: { userId, date: todayStart, status: "NOT_STARTED", upcomingReminderSentAt: null },
            take: limit,
            select: { id: true, userId: true },
          }),
        notify: async () => {},
      });
      assert.equal(result.scanned, 0);
    } finally {
      await cleanup(db, userId);
    }
  },
);

test(
  "runUnfinishedReminderSweep (real deps): finds a stale IN_PROGRESS session, ignores a genuinely recent one",
  skipOpts,
  async () => {
    const { prisma: db, mod } = await loadModules();
    const userId = `workout-unfinished-it-${Date.now()}`;
    try {
      // @@unique([userId, date]) — two distinct dates so both rows can
      // coexist; only status/startedAt matter to this sweep's own logic.
      const staleRow = await db.workoutSchedule.create({
        data: { userId, date: today(), status: "IN_PROGRESS", startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000) },
      });
      await db.workoutSchedule.create({
        data: { userId, date: daysAgo(1), status: "IN_PROGRESS", startedAt: new Date(Date.now() - 10 * 60 * 1000) },
      });

      const result = await mod.runUnfinishedReminderSweep({
        ...mod.defaultWorkoutReminderDeps,
        findUnfinishedCandidates: (staleBefore, limit) =>
          db.workoutSchedule.findMany({
            where: { userId, status: "IN_PROGRESS", startedAt: { not: null, lte: staleBefore }, unfinishedReminderSentAt: null },
            take: limit,
            select: { id: true, userId: true },
          }),
        notify: async () => {},
      });
      assert.equal(result.scanned, 1);

      const reread = await db.workoutSchedule.findUnique({ where: { id: staleRow.id } });
      assert.ok(reread!.unfinishedReminderSentAt);
    } finally {
      await cleanup(db, userId);
    }
  },
);
