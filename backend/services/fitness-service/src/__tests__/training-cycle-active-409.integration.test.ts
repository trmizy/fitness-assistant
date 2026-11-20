import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * "An active training cycle already exists" (409) after "kết thúc chu kỳ" / "Kiểm tra tiến độ" — LOCAL FIXTURE investigation.
 * Evidence label: BACKEND INTEGRATION on an isolated *_test Postgres. This reproduces ONE proven mechanism; it does NOT prove it is
 * what happened on AWS DEV (that needs a read-only look at that user's cycle rows, which this task forbids).
 *
 * Mechanism (CODE AUDIT, fitness-roadmap.service.ts advanceRoadmap):
 *   - advanceRoadmap decides "is a cycle still running?" PHASE-scoped (`trainingCycle.findMany({ roadmapPhaseId })`), but
 *   - trainingCycleService.startCycle (which it then calls for the next cycle) guards USER-wide
 *     (`trainingCycle.findFirst({ userId, status: ACTIVE })`).
 * So an ACTIVE cycle that is NOT in this phase (a legacy/manual cycle, or one left over from another phase) passes advance's own check
 * and then trips startCycle's, surfacing the generic English 409 even though the user's phase cycle was closed correctly.
 */
const fitnessDatabaseUrl = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.FITNESS_DISABLE_REDIS = process.env.FITNESS_DISABLE_REDIS || "true";

type Prisma = (typeof import("../repositories/prisma"))["prisma"];
let prisma: Prisma;
let roadmaps: (typeof import("../services/fitness-roadmap.service"))["fitnessRoadmapService"];
let cycles: (typeof import("../services/training-cycle.service"))["trainingCycleService"];
let queue: (typeof import("../services/workout.service"))["workoutQueue"];

test.before(async () => {
  assert.match(fitnessDatabaseUrl, /(_test|postgres-test)/i, "requires an isolated *_test database");
  prisma = (await import("../repositories/prisma")).prisma;
  roadmaps = (await import("../services/fitness-roadmap.service")).fitnessRoadmapService;
  cycles = (await import("../services/training-cycle.service")).trainingCycleService;
  queue = (await import("../services/workout.service")).workoutQueue;
});
test.after(async () => {
  if (queue) await queue.close();
  if (prisma) await prisma.$disconnect();
});

async function cleanup(userId: string) {
  await prisma.recommendationAudit.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.cycleAssessment.deleteMany({ where: { cycle: { userId } } }).catch(() => {});
  await prisma.workoutSchedule.deleteMany({ where: { userId } });
  await prisma.trainingCycle.deleteMany({ where: { userId } });
  await prisma.fitnessRoadmap.deleteMany({ where: { userId } }).catch(() => {});
}

async function roadmapWithClosedFirstCycle(userId: string) {
  const created = await roadmaps.createDraftRoadmap(userId, {
    name: "409 fixture", goalType: "WEIGHT_LOSS", plannedStartAt: "2026-09-10", plannedEndAt: "2026-12-10",
    phases: [{ phaseIndex: 1, name: "Fat loss", phaseType: "FAT_LOSS", plannedStartAt: "2026-09-10", plannedEndAt: "2026-11-10", objective: { maxCycles: 3 } }],
  });
  const activated = await roadmaps.activateRoadmap(userId, created.roadmap.id);
  const first = activated.activeCycle!;
  // the user "ends the cycle": it is no longer ACTIVE and its assessment is complete and accepted
  await prisma.trainingCycle.update({ where: { id: first.id }, data: { status: "ANALYZED" } });
  await prisma.cycleAssessment.create({
    data: { cycleId: first.id, assessmentVersion: 1, status: "COMPLETED", decision: "KEEP", userDecision: "ACCEPTED", nutritionUserDecision: "ACCEPTED", reasonCodes: ["TEST_KEEP"] },
  });
  return { roadmapId: created.roadmap.id, phaseId: activated.activePhase!.id, firstId: first.id };
}

test("409-A control: with the phase cycle closed and NO other active cycle, 'Kiểm tra tiến độ' starts the next cycle (no 409)", { timeout: 60_000 }, async () => {
  const userId = `c409-ctl-${randomUUID()}`;
  try {
    const { roadmapId } = await roadmapWithClosedFirstCycle(userId);
    const advanced = await roadmaps.advanceRoadmap(userId, roadmapId);
    assert.equal(advanced.activeCycle?.sequenceInPhase, 2);
  } finally { await cleanup(userId); }
});

test("409-B reproduction: an ACTIVE cycle OUTSIDE the phase makes advance fail with the generic 409 although the phase cycle was closed properly; the failed advance leaves no partial writes", { timeout: 60_000 }, async () => {
  const userId = `c409-rep-${randomUUID()}`;
  try {
    const { roadmapId, phaseId, firstId } = await roadmapWithClosedFirstCycle(userId);
    // a stray ACTIVE cycle that belongs to no roadmap phase (legacy / manually started) — allowed by the DB: the first cycle is ANALYZED
    const stray = await cycles.startCycle(userId, null, "2026-09-20", 30, { name: "Chu kỳ lẻ" });
    assert.equal(stray.roadmapPhaseId ?? null, null);

    const auditsBefore = await prisma.recommendationAudit.count({ where: { userId } });
    await assert.rejects(
      () => roadmaps.advanceRoadmap(userId, roadmapId),
      (e: any) => e.status === 409 && e.message === "An active training cycle already exists",
      "advance surfaces startCycle's generic, untranslated message",
    );
    // transactional: nothing half-done
    assert.equal((await prisma.roadmapPhase.findUniqueOrThrow({ where: { id: phaseId } })).status, "ACTIVE");
    assert.equal(await prisma.trainingCycle.count({ where: { userId, roadmapPhaseId: phaseId } }), 1, "no second phase cycle was created");
    assert.equal((await prisma.trainingCycle.findUniqueOrThrow({ where: { id: firstId } })).status, "ANALYZED");
    assert.equal(await prisma.recommendationAudit.count({ where: { userId } }), auditsBefore, "the transition audit rolled back with the failed advance");

    // The same user can recover once the stray cycle is closed: the error is about THAT cycle, not about the closed one.
    await prisma.trainingCycle.update({ where: { id: stray.id }, data: { status: "COMPLETED" } });
    const advanced = await roadmaps.advanceRoadmap(userId, roadmapId);
    assert.equal(advanced.activeCycle?.sequenceInPhase, 2);
  } finally { await cleanup(userId); }
});

test("409-C the guard is real at DB level too: two ACTIVE cycles for one user cannot coexist (partial unique index)", { timeout: 60_000 }, async () => {
  const userId = `c409-idx-${randomUUID()}`;
  try {
    await cycles.startCycle(userId, null, "2026-09-10", 30, { name: "Một" });
    await assert.rejects(
      () => prisma.trainingCycle.create({ data: { userId, name: "Hai", status: "ACTIVE", startDate: new Date("2026-09-11"), endDate: new Date("2026-10-11"), durationDays: 30 } as any }),
    );
    await assert.rejects(() => cycles.startCycle(userId, null, "2026-09-12", 30, { name: "Ba" }), (e: any) => e.status === 409);
  } finally { await cleanup(userId); }
});
