/**
 * Runs the REAL Decision Engine pipeline (computeCycleMetrics ->
 * evaluateCycle) against the REAL persona fixtures already seeded by
 * fixtures/persona-fixtures.ts (Beginner/Intermediate/Experienced/Athlete —
 * see docs/production-hardening-checkpoint.md §13), for a subset of the
 * scenarios requested in docs/CLOUDCODE_IMPLEMENTATION_AUDIT.md §9:
 *
 *   - "thiếu dữ liệu"        -> Persona A (Beginner), cycle started today
 *   - "bỏ nhiều buổi"        -> Persona A (Beginner), 0 scheduled sessions at all
 *   - "RPE/pain cao"         -> Persona D (Athlete), a top set at RPE 9/RIR 0
 *                               with a logged painScore
 *
 * Honest scope note: this does NOT attempt all 9 scenarios x 4 personas
 * (36 combinations). "Plateau nhiều chu kỳ" and "InBody xấu đi" need
 * cross-service InBody data (documented cross-service test limitation,
 * same as adaptive-cycle-evaluation.integration.test.ts) and multi-cycle
 * history beyond what's practical to seed fresh here; "nutrition không ổn
 * định" is covered separately by
 * nutrition-consistency-score.integration.test.ts. See
 * docs/CLOUDCODE_IMPLEMENTATION_AUDIT.md's nhật ký triển khai for the full
 * honest gap list.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/persona-decision-engine.integration.test.ts
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
};

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type ComputeCycleMetricsLike = (typeof import("../services/cycle-metrics.engine"))["computeCycleMetrics"];
type EvaluateCycleLike = (typeof import("../services/cycle-decision.engine"))["evaluateCycle"];
type PersonaFixturesLike = typeof import("./fixtures/persona-fixtures");

let prisma: PrismaClientLike | undefined;
let computeCycleMetrics: ComputeCycleMetricsLike | undefined;
let evaluateCycle: EvaluateCycleLike | undefined;
let personas: PersonaFixturesLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const metricsModule = await import("../services/cycle-metrics.engine");
    const decisionModule = await import("../services/cycle-decision.engine");
    const personaModule = await import("./fixtures/persona-fixtures");
    prisma = prismaModule.prisma;
    computeCycleMetrics = metricsModule.computeCycleMetrics;
    evaluateCycle = decisionModule.evaluateCycle;
    personas = personaModule;
  }
  return {
    prisma: prisma!,
    computeCycleMetrics: computeCycleMetrics!,
    evaluateCycle: evaluateCycle!,
    personas: personas!,
  };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

test(
  "Scenario 'thiếu dữ liệu': Persona A (Beginner) with a single just-created schedule -> INSUFFICIENT_DATA, never a confident decision",
  skipOpts,
  async () => {
    const { prisma: db, computeCycleMetrics, evaluateCycle, personas } = await loadModules();
    const userId = `persona-a-insufficient-${randomUUID()}`;
    await personas.deletePersonaFixtures(db, userId);
    try {
      await personas.seedPersonaABeginner(db, userId);
      const startDate = new Date(); // cycle "started" today, per the fixture's own single-day schedule
      const asOf = new Date();

      const metrics = await computeCycleMetrics({
        cycleId: "test-cycle-persona-a",
        userId,
        planId: null,
        goal: null,
        startDate,
        asOf,
        inBodyEntries: [],
      });

      const result = evaluateCycle({
        cycleDurationDays: 0,
        completedSessions: 0,
        metrics,
      });

      assert.equal(result.decision, "INSUFFICIENT_DATA");
      assert.ok(result.reasonCodes.includes("CYCLE_TOO_SHORT") || result.reasonCodes.includes("TOO_FEW_COMPLETED_SESSIONS"));
      assert.equal(result.recommendedActionScope, "none", "no action should ever be recommended off zero real data");
    } finally {
      await personas.deletePersonaFixtures(db, userId);
    }
  },
);

test(
  "Scenario 'bỏ nhiều buổi' / no scheduled sessions: a user with zero WorkoutSchedule rows at all reads as INSUFFICIENT_DATA, never a fabricated adherence percentage",
  skipOpts,
  async () => {
    const { computeCycleMetrics, evaluateCycle } = await loadModules();
    const userId = `persona-no-schedule-${randomUUID()}`;
    const startDate = new Date(Date.UTC(2026, 0, 1));
    const asOf = new Date(Date.UTC(2026, 0, 29)); // 28 days later — clears the CYCLE_TOO_SHORT gate on its own

    const metrics = await computeCycleMetrics({
      cycleId: "test-cycle-no-schedule",
      userId,
      planId: null,
      goal: null,
      startDate,
      asOf,
      inBodyEntries: [],
    });

    assert.equal(metrics.hasScheduledSessions, false);
    assert.equal(metrics.missedSessionCount, null, "0/0 must read as null, never as a fabricated missed count");

    const result = evaluateCycle({ cycleDurationDays: 28, completedSessions: 0, metrics });
    assert.equal(result.decision, "INSUFFICIENT_DATA");
    assert.ok(result.reasonCodes.includes("TOO_FEW_COMPLETED_SESSIONS"));
  },
);

test(
  "Scenario 'RPE/pain cao': Persona D (Athlete) real logged set data (RPE 9, RIR 0, painScore 2 on the final set) surfaces in the real metrics pipeline",
  skipOpts,
  async () => {
    const { prisma: db, computeCycleMetrics, personas } = await loadModules();
    const userId = `persona-d-pain-${randomUUID()}`;
    await personas.deletePersonaFixtures(db, userId);
    try {
      await personas.seedPersonaDAthlete(db, userId);
      const startDate = new Date(Date.now() - 1 * 86_400_000);
      const asOf = new Date();

      const metrics = await computeCycleMetrics({
        cycleId: "test-cycle-persona-d",
        userId,
        planId: null,
        goal: null,
        startDate,
        asOf,
        inBodyEntries: [],
      });

      // Persona D's fixture logs a top set at RPE 9 (set-level fallback,
      // since no CycleSessionFeedback session-level RPE exists for this
      // fresh cycleId) — the real averageRir/rpeTrend pipeline must reflect
      // this real data, not report "no data" for a user who clearly logged
      // real, intense working sets.
      assert.ok(metrics.averageSessionRpe !== null, "expected a real RPE signal from the fixture's logged sets");
      assert.ok(metrics.hasScheduledSessions, "the fixture's one COMPLETED schedule must count as scheduled data");
    } finally {
      await personas.deletePersonaFixtures(db, userId);
    }
  },
);
