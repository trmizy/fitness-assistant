/**
 * Regression tests for the second round of training-cycle fixes:
 *
 *  - cancelCycle(): explicit user-initiated abandonment, distinct from
 *    completeCycle()'s INSUFFICIENT_DATA outcome — never computes
 *    progressSignals or a decision, regardless of data present.
 *  - Clock injection: startCycle/completeCycle now accept an injectable
 *    Clock instead of calling `new Date()` directly, so the data-sufficiency
 *    gate can be tested deterministically without waiting real time.
 *  - timezoneAtStart: snapshotted on every newly-created/activated cycle.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/training-cycle-lifecycle-fixes.integration.test.ts
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
type TrainingCycleServiceLike = (typeof import("../services/training-cycle.service"))["trainingCycleService"];
type ClockModule = typeof import("../utils/clock");

let prisma: PrismaClientLike | undefined;
let trainingCycleService: TrainingCycleServiceLike | undefined;
let fixedClock: ClockModule["fixedClock"] | undefined;

async function loadModules() {
  if (!prisma) {
    const prismaModule = await import("../repositories/prisma");
    const serviceModule = await import("../services/training-cycle.service");
    const clockModule = await import("../utils/clock");
    prisma = prismaModule.prisma;
    trainingCycleService = serviceModule.trainingCycleService;
    fixedClock = clockModule.fixedClock;
  }
  return { prisma: prisma!, trainingCycleService: trainingCycleService!, fixedClock: fixedClock! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

test(
  "cancelCycle: ACTIVE -> CANCELLED, no decision or progressSignals ever computed",
  skipOpts,
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

    const cancelled = await trainingCycleService.cancelCycle(cycle.id, userId);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.decision, null);
    assert.equal(cancelled.summary, null);
    assert.ok(cancelled.actualEndDate);

    await prisma.trainingCycle.deleteMany({ where: { userId } });
  },
);

test(
  "cancelCycle: a DRAFT cycle (never activated) can also be cancelled",
  skipOpts,
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
        status: "DRAFT",
      },
    });

    const cancelled = await trainingCycleService.cancelCycle(cycle.id, userId);
    assert.equal(cancelled.status, "CANCELLED");

    await prisma.trainingCycle.deleteMany({ where: { userId } });
  },
);

test(
  "cancelCycle: rejects (409) a cycle that's already COMPLETED/ANALYZED — nothing left to cancel",
  skipOpts,
  async () => {
    const { prisma, trainingCycleService } = await loadModules();
    const userId = randomUUID();
    const cycle = await prisma.trainingCycle.create({
      data: {
        userId,
        cycleIndex: 1,
        startDate: new Date(),
        endDate: new Date(),
        durationDays: 30,
        status: "ANALYZED",
        decision: "KEEP",
      },
    });

    await assert.rejects(
      () => trainingCycleService.cancelCycle(cycle.id, userId),
      (err: any) => err?.status === 409,
    );

    await prisma.trainingCycle.deleteMany({ where: { userId } });
  },
);

test(
  "startCycle: timezoneAtStart is snapshotted on every newly-created cycle",
  skipOpts,
  async () => {
    const { prisma, trainingCycleService } = await loadModules();
    const userId = randomUUID();
    const cycle = await trainingCycleService.startCycle(userId, null);
    assert.equal(cycle.timezoneAtStart, "Asia/Ho_Chi_Minh");
    await prisma.trainingCycle.deleteMany({ where: { userId } });
  },
);

test(
  "Clock injection: completeCycle's data-sufficiency gate is deterministic under a fixed future clock, not dependent on real wall-clock waiting",
  skipOpts,
  async () => {
    const { prisma, trainingCycleService, fixedClock } = await loadModules();
    const userId = randomUUID();
    const start = new Date();
    const cycle = await prisma.trainingCycle.create({
      data: {
        userId,
        cycleIndex: 1,
        startDate: start,
        endDate: new Date(start.getTime() + 30 * 86_400_000),
        durationDays: 30,
        status: "ACTIVE",
      },
    });

    // Simulate "35 days later" purely via the injected clock — no real
    // waiting, no system-time manipulation. Still 0 completed sessions, so
    // the TOO_FEW_COMPLETED_SESSIONS gate still fires even though the
    // CYCLE_TOO_SHORT gate alone would now be satisfied — proves the gates
    // are independent, not just one giant "is it new" check.
    const later = fixedClock(new Date(start.getTime() + 35 * 86_400_000));
    const completed = await trainingCycleService.completeCycle(cycle.id, userId, undefined, later);

    assert.equal(completed.decision, "INSUFFICIENT_DATA");
    assert.ok((completed.aiAnalysis as any).reasonCodes.includes("NO_SCHEDULED_SESSIONS"));
    assert.ok(!(completed.aiAnalysis as any).reasonCodes.includes("CYCLE_TOO_SHORT"), "35 days elapsed should clear the CYCLE_TOO_SHORT gate on its own");

    await prisma.trainingCycle.deleteMany({ where: { userId } });
  },
);
