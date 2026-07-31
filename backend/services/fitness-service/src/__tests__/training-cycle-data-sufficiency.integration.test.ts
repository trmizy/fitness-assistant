/**
 * Regression tests for the training-cycle bug-report fixes in this pass:
 *
 *  - §3.4 / root cause #9: completeCycle() previously had NO minimum-data
 *    check at all — a cycle closed same-day with 0 completed sessions still
 *    ran classifyProgress() (producing a confident PROGRESSING/PLATEAU/
 *    DECLINING verdict) and fired a real AI analysis + recommendation.
 *  - root cause #7/#8: computeAdherence returned 0% (not null) for a 0/0
 *    cycle, and classifyAdherence(0) read that as a decline signal.
 *  - §3.7 / root cause #11: startCycle() did a check-then-create with no DB
 *    invariant — two near-simultaneous requests could both create an ACTIVE
 *    cycle for the same user.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/training-cycle-data-sufficiency.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const fitnessDatabaseUrl =
  process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(fitnessDatabaseUrl);
if (process.env.FITNESS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
}

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type TrainingCycleServiceLike = (typeof import("../services/training-cycle.service"))["trainingCycleService"];
type ComputeAdherenceLike = (typeof import("../services/training-cycle-metrics.service"))["computeAdherence"];

let prisma: PrismaClientLike | undefined;
let trainingCycleService: TrainingCycleServiceLike | undefined;
let computeAdherence: ComputeAdherenceLike | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/training-cycle.service");
    const metricsModule = await import("../services/training-cycle-metrics.service");
    prisma = prismaModule.prisma;
    trainingCycleService = serviceModule.trainingCycleService;
    computeAdherence = metricsModule.computeAdherence;
  }
  return { prisma: prisma!, trainingCycleService: trainingCycleService!, computeAdherence: computeAdherence! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

test(
  "computeAdherence: a 0/0 cycle (no scheduled sessions at all) returns percent=null, never 0 or 100",
  { skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test" },
  async () => {
    const { computeAdherence } = await loadModules();
    const userId = randomUUID();
    const start = new Date(Date.UTC(2026, 0, 1));
    const asOf = new Date(Date.UTC(2026, 0, 15));
    const result = await computeAdherence(userId, null, start, asOf);
    assert.equal(result.total, 0);
    assert.equal(result.completed, 0);
    assert.equal(result.percent, null);
  },
);

test(
  "completeCycle: a same-day cycle with 0 scheduled sessions closes as INSUFFICIENT_DATA, never a confident PROGRESSING/PLATEAU/DECLINING verdict",
  { skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test" },
  async () => {
    const { prisma, trainingCycleService } = await loadModules();
    const userId = randomUUID();

    const cycle = await prisma.trainingCycle.create({
      data: {
        userId,
        cycleIndex: 1,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 86_400_000),
        durationDays: 30,
        status: "ACTIVE",
      },
    });

    const closed = await trainingCycleService.completeCycle(cycle.id, userId);

    assert.equal(closed.decision, "INSUFFICIENT_DATA");
    assert.equal(closed.status, "ANALYZED");
    const summary = closed.summary as any;
    assert.equal(summary.progressSignals, null, "no confident trend classification may be produced for 0/0 data");
    assert.equal((closed.aiAnalysis as any)?.insufficientData, true);
    assert.ok(
      (closed.aiAnalysis as any)?.reasonCodes?.includes("NO_SCHEDULED_SESSIONS"),
      "expected NO_SCHEDULED_SESSIONS reason code for a 0/0 cycle",
    );

    await prisma.trainingCycle.deleteMany({ where: { userId } });
  },
);

test(
  "startCycle: two concurrent requests for the same user never both succeed — exactly one ACTIVE cycle survives",
  { skip: canUseIntegrationDb ? false : "Set FITNESS_DATABASE_URL to a *_test database to run this integration test" },
  async () => {
    const { prisma, trainingCycleService } = await loadModules();
    const userId = randomUUID();

    const results = await Promise.allSettled([
      trainingCycleService.startCycle(userId, null),
      trainingCycleService.startCycle(userId, null),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one concurrent startCycle call should succeed");
    assert.equal(rejected.length, 1, "the other concurrent call must fail cleanly, not silently create a duplicate");
    assert.equal((rejected[0] as PromiseRejectedResult).reason?.status, 409);

    const activeCycles = await prisma.trainingCycle.findMany({
      where: { userId, status: "ACTIVE", archivedAt: null },
    });
    assert.equal(activeCycles.length, 1, "the DB must never end up with two ACTIVE cycles for one user");

    await prisma.trainingCycle.deleteMany({ where: { userId } });
  },
);
