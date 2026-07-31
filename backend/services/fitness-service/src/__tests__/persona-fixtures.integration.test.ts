/**
 * Exercises the four persona fixtures (persona-fixtures.ts) against the
 * REAL statsService/Prisma layer — real database, no mocking, same gated
 * convention as every other `*.integration.test.ts` in this directory.
 *
 * Each test asserts something persona-*specific*, not just "seeding didn't
 * crash" — Persona A must show sparse/near-zero numbers (not fabricated
 * activity), Persona B's numbers must reflect the exact mix of completed/
 * missed/partial sessions seeded, Persona C must show two real, distinct
 * TrainingCycle records with a genuine program change between them, and
 * Persona D must show real, distinct advanced set-logging values (multiple
 * set types, tempo, unilateral side) rather than one dataset relabeled
 * four times.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/persona-fixtures.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  seedPersonaABeginner,
  seedPersonaBIntermediate,
  seedPersonaCExperienced,
  seedPersonaDAthlete,
  deletePersonaFixtures,
} from "./fixtures/persona-fixtures";

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

const skipOpts = {
  skip: canUseIntegrationDb
    ? false
    : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.",
};

test(
  "Persona A (beginner): near-zero real numbers, never a fabricated non-zero streak/count",
  skipOpts,
  async () => {
    const { prisma: db, statsService: service } = await loadModules();
    const userId = `persona-a-${Date.now()}`;
    await deletePersonaFixtures(db, userId);
    try {
      await seedPersonaABeginner(db, userId);
      const stats = await service.getWorkoutStats(userId, 30);
      // The single seeded schedule is NOT_STARTED (never logged) — a
      // real beginner with no training history yet must show 0, not any
      // inferred/optimistic number.
      assert.equal(stats.totalWorkouts, 0);
      assert.equal(stats.weeklyWorkouts, 0);
      assert.equal(stats.currentStreakDays, 0);
    } finally {
      await deletePersonaFixtures(db, userId);
    }
  },
);

test(
  "Persona B (intermediate): stats reflect the exact seeded mix, not an inflated or deflated count",
  skipOpts,
  async () => {
    const { prisma: db, statsService: service } = await loadModules();
    const userId = `persona-b-${Date.now()}`;
    await deletePersonaFixtures(db, userId);
    try {
      const seeded = await seedPersonaBIntermediate(db, userId);
      const completedCount = seeded.schedules.filter(
        (s: any) => s.status === "COMPLETED",
      ).length;
      assert.ok(completedCount > 0, "fixture sanity: must have seeded some completed sessions");

      const stats = await service.getWorkoutStats(userId, 30);
      // Only real COMPLETED schedules count — the deliberately-seeded
      // IN_PROGRESS (partial) and NOT_STARTED (missed) rows must NOT be
      // counted as completed.
      assert.equal(stats.totalWorkouts, completedCount);
    } finally {
      await deletePersonaFixtures(db, userId);
    }
  },
);

test(
  "Persona C (experienced): two distinct real TrainingCycle records spanning a genuine program change",
  skipOpts,
  async () => {
    const { prisma: db, statsService: service } = await loadModules();
    const userId = `persona-c-${Date.now()}`;
    await deletePersonaFixtures(db, userId);
    try {
      const seeded = await seedPersonaCExperienced(db, userId);
      const cycles = await db.trainingCycle.findMany({ where: { userId } });
      assert.equal(cycles.length, 2);
      assert.notEqual(seeded.programCycle1.id, seeded.programCycle2.id);
      const statuses = cycles.map((c) => c.status).sort();
      assert.deepEqual(statuses, ["ACTIVE", "ARCHIVED"]);

      // Long enough real history (10 sessions across ~10 weeks) that a
      // 90-day stats window sees activity from both cycles, not just the
      // most recent one.
      const stats = await service.getWorkoutStats(userId, 90);
      assert.equal(stats.totalWorkouts, seeded.schedules.length);
    } finally {
      await deletePersonaFixtures(db, userId);
    }
  },
);

test(
  "Persona D (athlete): real, distinct advanced set-logging data — multiple set types, tempo, unilateral side",
  skipOpts,
  async () => {
    const { prisma: db } = await loadModules();
    const userId = `persona-d-${Date.now()}`;
    await deletePersonaFixtures(db, userId);
    try {
      const seeded = await seedPersonaDAthlete(db, userId);
      const allSets = seeded.workout.exercises.flatMap((ex: any) => ex.workoutSets);

      const setTypesUsed = new Set(allSets.map((s: any) => s.setType).filter(Boolean));
      // Must genuinely use multiple distinct set types — not the same
      // value copy-pasted across every set.
      assert.ok(setTypesUsed.has("WARMUP"));
      assert.ok(setTypesUsed.has("TOP"));
      assert.ok(setTypesUsed.has("BACKOFF"));

      const topSet = allSets.find((s: any) => s.setType === "TOP");
      assert.equal(topSet.tempo, "2-1-1-0");
      assert.equal(topSet.rangeOfMotion, "FULL");

      const sides = allSets.map((s: any) => s.side).filter(Boolean).sort();
      assert.deepEqual(sides, ["LEFT", "RIGHT"]);

      const painSet = allSets.find((s: any) => s.painScore === 2);
      assert.equal(painSet.techniqueNotes, "Slight left shoulder discomfort on final rep.");
    } finally {
      await deletePersonaFixtures(db, userId);
    }
  },
);
