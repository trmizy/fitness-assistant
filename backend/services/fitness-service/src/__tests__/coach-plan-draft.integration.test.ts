/**
 * Phase 7 (docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md) integration coverage
 * for coachService.generatePlanDraft — real DB, real end-to-end call through
 * ai-service (LLM success or fallback both count, same tolerance as
 * feedback-analysis.integration.test.ts), coachDeps stubbed only for the
 * relationship-permission gate.
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/coach-plan-draft.integration.test.ts
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
  timeout: 90_000,
};

type PrismaClientLike = (typeof import("../repositories/prisma"))["prisma"];
type CoachServiceModule = typeof import("../services/coach.service");

let prisma: PrismaClientLike | undefined;
let coachModule: CoachServiceModule | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    coachModule = await import("../services/coach.service");
  }
  return { prisma: prisma!, coachService: coachModule!.coachService, coachDeps: coachModule!.coachDeps };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
  // Same real bug as coach.service.integration.test.ts's test.after: this
  // file also transitively opens a live `redis` v4 client via
  // coach.service.ts -> training-cycle.service.ts (repositories/redis.ts)
  // that nothing ever closes, keeping the process alive indefinitely.
  // See coach.service.integration.test.ts's test.after for the full
  // explanation: a short settle delay before quitting avoids racing a
  // still-connecting redis v4 socket.
  const { redisClient } = await import("../repositories/redis");
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    await redisClient.quit();
  } catch {
    // not connected / already closed — nothing to clean up
  }
  // Second open handle, found via this session's own investigation (see
  // coach.service.integration.test.ts's test.after for the full
  // explanation): workout.service.ts's `workoutQueue` (BullMQ) opens its
  // own separate ioredis connection as a module-level side effect on
  // import — closing only `redisClient` above was not enough by itself to
  // let the process exit.
  const { workoutQueue } = await import("../services/workout.service");
  try {
    await workoutQueue.close();
  } catch {
    // already closed — nothing to clean up
  }
});

test("generatePlanDraft: rejects (403) when there is no active PT-client relationship, and writes no audit row", skipOpts, async () => {
  const { prisma: db, coachService: svc, coachDeps } = await loadModules();
  const clientId = `client-${randomUUID()}`;
  const original = coachDeps.isActivePtClientRelationship;
  coachDeps.isActivePtClientRelationship = async () => false;
  try {
    await assert.rejects(
      () => svc.generatePlanDraft(`pt-${randomUUID()}`, clientId, { daysPerWeek: 2, durationWeeks: 4 }),
      (err: any) => {
        assert.equal(err.status, 403);
        return true;
      },
    );
  } finally {
    coachDeps.isActivePtClientRelationship = original;
  }

  const audits = await db.planGenerationAudit.findMany({ where: { clientUserId: clientId } });
  assert.equal(audits.length, 0);
});

test("generatePlanDraft: for an authorized PT, always returns a well-shaped draft (LLM success or fallback) and persists an audit row — never auto-assigns anything", skipOpts, async () => {
  const { prisma: db, coachService: svc, coachDeps } = await loadModules();
  const ptId = `pt-${randomUUID()}`;
  const clientId = `client-${randomUUID()}`;
  const original = coachDeps.isActivePtClientRelationship;
  coachDeps.isActivePtClientRelationship = async () => true;

  let draft: any;
  try {
    draft = await svc.generatePlanDraft(ptId, clientId, { ptNotes: "Ưu tiên thân trên", daysPerWeek: 2, durationWeeks: 4 });
  } finally {
    coachDeps.isActivePtClientRelationship = original;
  }

  assert.ok(Array.isArray(draft.days));
  assert.ok(Array.isArray(draft.dataGaps));
  assert.ok(Array.isArray(draft.warnings));
  assert.equal(typeof draft.summaryForPt, "string");
  // Every exercise in the draft (if any) must carry a resolved display name
  // (coachService maps exerciseId -> exerciseName from the real catalog).
  for (const day of draft.days) {
    for (const ex of day.exercises) {
      assert.equal(typeof ex.exerciseName, "string");
    }
  }

  // Nothing was actually assigned — draft-only, per Phase 7 spec.
  const programs = await db.workoutProgram.findMany({ where: { userId: clientId } });
  assert.equal(programs.length, 0);
  const schedules = await db.workoutSchedule.findMany({ where: { userId: clientId } });
  assert.equal(schedules.length, 0);

  const audit = await db.planGenerationAudit.findFirst({ where: { ptUserId: ptId, clientUserId: clientId } });
  assert.ok(audit);
  assert.equal(audit?.ptNotes, "Ưu tiên thân trên");
});
