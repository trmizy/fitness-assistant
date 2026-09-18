/**
 * AI Nutrition Cycle Engine (Gymini) Phase 3 — InBody Reassessment Signal
 * (Production Hardening report §10/§16.2). Real DB, real
 * trainingCycleService.getActiveCycle (cross-service InBody/profile reads
 * degrade to empty data for a random test userId, exactly like every other
 * integration test in this suite that exercises getActiveCycle — never
 * thrown, matching the established fire-and-forget client convention).
 *
 * evaluateCycle and createPersistentNotification are stubbed via
 * inbodyReassessmentDeps (mutable seam, same pattern as
 * nutritionBootstrapDeps) — this file verifies the GATING/SPAM logic in
 * this service, not the Decision Engine's own output (already covered by
 * nutrition-decision.engine.test.ts / cycle-decision.engine tests).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/inbody-reassessment.integration.test.ts
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
type ReassessmentModule = typeof import("../services/inbody-reassessment.service");

let prisma: PrismaClientLike | undefined;
let reassessment: ReassessmentModule | undefined;

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    reassessment = await import("../services/inbody-reassessment.service");
  }
  return { prisma: prisma!, reassessment: reassessment! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

const COOLDOWN_DAYS_DEFAULT = 21; // cycleThresholds.assessment.plateauWindowWeeks (3) * 7

test("no active cycle -> not triggered (NO_ACTIVE_CYCLE)", skipOpts, async () => {
  const { reassessment: svc } = await loadModules();
  const userId = randomUUID();
  const result = await svc.maybeAutoTriggerInBodyReassessment(userId);
  assert.deepEqual(result, { triggered: false, reason: "NO_ACTIVE_CYCLE" });
});

test("active cycle, no prior assessment, cycle started recently -> not triggered (TOO_SOON_SINCE_LAST_REVIEW)", skipOpts, async () => {
  const { prisma: db, reassessment: svc } = await loadModules();
  const userId = randomUUID();
  try {
    await db.trainingCycle.create({
      data: {
        userId,
        startDate: new Date(), // started today
        endDate: new Date(Date.now() + 28 * 86_400_000),
        durationDays: 28,
        status: "ACTIVE",
      },
    });
    const result = await svc.maybeAutoTriggerInBodyReassessment(userId);
    assert.deepEqual(result, { triggered: false, reason: "TOO_SOON_SINCE_LAST_REVIEW" });
  } finally {
    await db.cycleAssessment.deleteMany({ where: { cycle: { userId } } });
    await db.trainingCycle.deleteMany({ where: { userId } });
  }
});

test("active cycle with a PENDING assessment -> not triggered (ASSESSMENT_ALREADY_PENDING), regardless of age", skipOpts, async () => {
  const { prisma: db, reassessment: svc } = await loadModules();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: {
        userId,
        startDate: new Date(Date.now() - 90 * 86_400_000),
        endDate: new Date(Date.now() + 28 * 86_400_000),
        durationDays: 28,
        status: "ACTIVE",
      },
    });
    await db.cycleAssessment.create({
      data: { cycleId: cycle.id, assessmentVersion: 1, status: "PENDING" },
    });
    const result = await svc.maybeAutoTriggerInBodyReassessment(userId);
    assert.deepEqual(result, { triggered: false, reason: "ASSESSMENT_ALREADY_PENDING" });
  } finally {
    await db.cycleAssessment.deleteMany({ where: { cycle: { userId } } });
    await db.trainingCycle.deleteMany({ where: { userId } });
  }
});

test("active cycle, no prior assessment, cycle started long ago -> triggered (uses cycle.startDate as reference)", skipOpts, async () => {
  const { prisma: db, reassessment: svc } = await loadModules();
  const userId = randomUUID();
  const originalDeps = { ...svc.inbodyReassessmentDeps };
  try {
    const cycle = await db.trainingCycle.create({
      data: {
        userId,
        startDate: new Date(Date.now() - (COOLDOWN_DAYS_DEFAULT + 1) * 86_400_000),
        endDate: new Date(Date.now() + 28 * 86_400_000),
        durationDays: 28,
        status: "ACTIVE",
      },
    });
    // Stub evaluateCycle so the detached background call this triggers
    // never actually runs the real (LLM-backed) pipeline during this test.
    Object.assign(svc.inbodyReassessmentDeps, {
      evaluateCycle: async () => ({ id: randomUUID(), status: "COMPLETED", decision: "KEEP", nutritionDecision: "KEEP_PLAN" }),
      createPersistentNotification: async () => {},
      claimNotification: async () => true,
    });
    const result = await svc.maybeAutoTriggerInBodyReassessment(userId);
    assert.deepEqual(result, { triggered: true, cycleId: cycle.id });
  } finally {
    Object.assign(svc.inbodyReassessmentDeps, originalDeps);
    await db.cycleAssessment.deleteMany({ where: { cycle: { userId } } });
    await db.trainingCycle.deleteMany({ where: { userId } });
  }
});

test("active cycle, last assessment COMPLETED recently -> not triggered (cooldown measured from last assessment, not cycle start)", skipOpts, async () => {
  const { prisma: db, reassessment: svc } = await loadModules();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: {
        userId,
        startDate: new Date(Date.now() - 90 * 86_400_000), // cycle itself is old
        endDate: new Date(Date.now() + 28 * 86_400_000),
        durationDays: 28,
        status: "ACTIVE",
      },
    });
    await db.cycleAssessment.create({
      data: {
        cycleId: cycle.id,
        assessmentVersion: 1,
        status: "COMPLETED",
        decision: "KEEP",
        createdAt: new Date(Date.now() - 2 * 86_400_000), // reviewed 2 days ago
      },
    });
    const result = await svc.maybeAutoTriggerInBodyReassessment(userId);
    assert.deepEqual(result, { triggered: false, reason: "TOO_SOON_SINCE_LAST_REVIEW" });
  } finally {
    await db.cycleAssessment.deleteMany({ where: { cycle: { userId } } });
    await db.trainingCycle.deleteMany({ where: { userId } });
  }
});

test("active cycle, last assessment COMPLETED past the cooldown window -> triggered", skipOpts, async () => {
  const { prisma: db, reassessment: svc } = await loadModules();
  const userId = randomUUID();
  const originalDeps = { ...svc.inbodyReassessmentDeps };
  try {
    const cycle = await db.trainingCycle.create({
      data: {
        userId,
        startDate: new Date(Date.now() - 90 * 86_400_000),
        endDate: new Date(Date.now() + 28 * 86_400_000),
        durationDays: 28,
        status: "ACTIVE",
      },
    });
    await db.cycleAssessment.create({
      data: {
        cycleId: cycle.id,
        assessmentVersion: 1,
        status: "COMPLETED",
        decision: "KEEP",
        createdAt: new Date(Date.now() - (COOLDOWN_DAYS_DEFAULT + 1) * 86_400_000),
      },
    });
    Object.assign(svc.inbodyReassessmentDeps, {
      evaluateCycle: async () => ({ id: randomUUID(), status: "COMPLETED", decision: "KEEP", nutritionDecision: "KEEP_PLAN" }),
      createPersistentNotification: async () => {},
      claimNotification: async () => true,
    });
    const result = await svc.maybeAutoTriggerInBodyReassessment(userId);
    assert.deepEqual(result, { triggered: true, cycleId: cycle.id });
  } finally {
    Object.assign(svc.inbodyReassessmentDeps, originalDeps);
    await db.cycleAssessment.deleteMany({ where: { cycle: { userId } } });
    await db.trainingCycle.deleteMany({ where: { userId } });
  }
});

// --- runReassessmentAndNotify: the "no spam" actionable-vs-not gate ---

test("runReassessmentAndNotify: KEEP + KEEP_PLAN (both non-actionable) -> does NOT notify", skipOpts, async () => {
  const { reassessment: svc } = await loadModules();
  const originalDeps = { ...svc.inbodyReassessmentDeps };
  let notified = false;
  try {
    Object.assign(svc.inbodyReassessmentDeps, {
      evaluateCycle: async () => ({ id: randomUUID(), status: "COMPLETED", decision: "KEEP", nutritionDecision: "KEEP_PLAN" }),
      createPersistentNotification: async () => {
        notified = true;
      },
      claimNotification: async () => true,
    });
    await svc.runReassessmentAndNotify(randomUUID(), randomUUID());
    assert.equal(notified, false);
  } finally {
    Object.assign(svc.inbodyReassessmentDeps, originalDeps);
  }
});

test("runReassessmentAndNotify: INSUFFICIENT_DATA + no nutrition decision (both non-actionable) -> does NOT notify", skipOpts, async () => {
  const { reassessment: svc } = await loadModules();
  const originalDeps = { ...svc.inbodyReassessmentDeps };
  let notified = false;
  try {
    Object.assign(svc.inbodyReassessmentDeps, {
      evaluateCycle: async () => ({ id: randomUUID(), status: "COMPLETED", decision: "INSUFFICIENT_DATA", nutritionDecision: null }),
      createPersistentNotification: async () => {
        notified = true;
      },
      claimNotification: async () => true,
    });
    await svc.runReassessmentAndNotify(randomUUID(), randomUUID());
    assert.equal(notified, false);
  } finally {
    Object.assign(svc.inbodyReassessmentDeps, originalDeps);
  }
});

test("runReassessmentAndNotify: training decision is actionable (ADJUST) even if nutrition is KEEP_PLAN -> notifies", skipOpts, async () => {
  const { reassessment: svc } = await loadModules();
  const originalDeps = { ...svc.inbodyReassessmentDeps };
  let notified = false;
  let notifyPayload: any = null;
  try {
    const cycleId = randomUUID();
    Object.assign(svc.inbodyReassessmentDeps, {
      evaluateCycle: async () => ({ id: randomUUID(), status: "COMPLETED", decision: "ADJUST", nutritionDecision: "KEEP_PLAN" }),
      createPersistentNotification: async (params: any) => {
        notified = true;
        notifyPayload = params;
      },
      claimNotification: async () => true,
    });
    await svc.runReassessmentAndNotify(cycleId, "some-user");
    assert.equal(notified, true);
    assert.equal(notifyPayload.eventType, "CYCLE_REASSESSMENT_READY");
    assert.equal(notifyPayload.entityId, cycleId);
  } finally {
    Object.assign(svc.inbodyReassessmentDeps, originalDeps);
  }
});

// Phase E (docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_PLAN.md) — the
// scheduled sweep reuses this exact function with trigger="SCHEDULED", and
// the notification text must never claim "based on your latest InBody"
// when nothing InBody-related actually happened.
test("runReassessmentAndNotify: trigger=SCHEDULED sends the periodic-evaluation wording, never the InBody wording", skipOpts, async () => {
  const { reassessment: svc } = await loadModules();
  const originalDeps = { ...svc.inbodyReassessmentDeps };
  let notifyPayload: any = null;
  try {
    Object.assign(svc.inbodyReassessmentDeps, {
      evaluateCycle: async () => ({ id: randomUUID(), status: "COMPLETED", decision: "ADJUST", nutritionDecision: null }),
      createPersistentNotification: async (params: any) => { notifyPayload = params; },
      claimNotification: async () => true,
    });
    await svc.runReassessmentAndNotify(randomUUID(), "some-user", "SCHEDULED");
    assert.ok(notifyPayload, "SCHEDULED trigger with an actionable decision must still notify");
    assert.ok(notifyPayload.text.includes("định kỳ"), `expected periodic-evaluation wording, got: ${notifyPayload.text}`);
    assert.ok(!notifyPayload.text.includes("InBody"), `must never claim InBody drove a SCHEDULED evaluation, got: ${notifyPayload.text}`);
  } finally {
    Object.assign(svc.inbodyReassessmentDeps, originalDeps);
  }
});

test("runReassessmentAndNotify: nutrition decision is actionable (PROPOSE_ADJUSTMENT) even if training is KEEP -> notifies", skipOpts, async () => {
  const { reassessment: svc } = await loadModules();
  const originalDeps = { ...svc.inbodyReassessmentDeps };
  let notified = false;
  try {
    Object.assign(svc.inbodyReassessmentDeps, {
      evaluateCycle: async () => ({ id: randomUUID(), status: "COMPLETED", decision: "KEEP", nutritionDecision: "PROPOSE_ADJUSTMENT" }),
      createPersistentNotification: async () => {
        notified = true;
      },
      claimNotification: async () => true,
    });
    await svc.runReassessmentAndNotify(randomUUID(), randomUUID());
    assert.equal(notified, true);
  } finally {
    Object.assign(svc.inbodyReassessmentDeps, originalDeps);
  }
});

// --- gate #2: an incomplete (not-yet-COMPLETED) assessment is never
// treated as actionable, however its null decision fields happen to read ---

test("runReassessmentAndNotify: assessment still PENDING (e.g. a concurrent race, or a manual evaluate already in flight) -> does NOT notify, even though the null decision isn't literally KEEP/KEEP_PLAN", skipOpts, async () => {
  const { reassessment: svc } = await loadModules();
  const originalDeps = { ...svc.inbodyReassessmentDeps };
  let notified = false;
  try {
    Object.assign(svc.inbodyReassessmentDeps, {
      // This is exactly the shape runVersionedAssessment's own "already
      // pending, return the existing row" short-circuit returns, and the
      // shape the LOSING side of a create()+P2002-catch race would get
      // back before the winner finishes computing: status PENDING, no
      // decision yet.
      evaluateCycle: async () => ({ id: randomUUID(), status: "PENDING", decision: null, nutritionDecision: null }),
      createPersistentNotification: async () => {
        notified = true;
      },
      claimNotification: async () => true,
    });
    await svc.runReassessmentAndNotify(randomUUID(), randomUUID());
    assert.equal(notified, false, "a PENDING assessment must never be read as actionable just because its decision is null");
  } finally {
    Object.assign(svc.inbodyReassessmentDeps, originalDeps);
  }
});

// --- gate #3: atomic notify-once claim ---

test("runReassessmentAndNotify: claimNotification returns false (a concurrent caller already claimed it) -> does NOT notify, even though this call's own decision reads as actionable", skipOpts, async () => {
  const { reassessment: svc } = await loadModules();
  const originalDeps = { ...svc.inbodyReassessmentDeps };
  let notified = false;
  let claimedAssessmentId: string | null = null;
  try {
    const assessmentId = randomUUID();
    Object.assign(svc.inbodyReassessmentDeps, {
      evaluateCycle: async () => ({ id: assessmentId, status: "COMPLETED", decision: "ADJUST", nutritionDecision: "KEEP_PLAN" }),
      createPersistentNotification: async () => {
        notified = true;
      },
      claimNotification: async (id: string) => {
        claimedAssessmentId = id;
        return false; // simulates a concurrent caller having already won the claim
      },
    });
    await svc.runReassessmentAndNotify(randomUUID(), randomUUID());
    assert.equal(notified, false, "must not notify when the atomic claim was lost to a concurrent caller");
    assert.equal(claimedAssessmentId, assessmentId, "must claim against the actual assessment id returned by evaluateCycle");
  } finally {
    Object.assign(svc.inbodyReassessmentDeps, originalDeps);
  }
});

test("claimNotification (real DB): 10 concurrent claims on the SAME assessment row -> exactly one wins", skipOpts, async () => {
  const { prisma: db, reassessment: svc } = await loadModules();
  const userId = randomUUID();
  try {
    const cycle = await db.trainingCycle.create({
      data: {
        userId,
        startDate: new Date(Date.now() - 90 * 86_400_000),
        endDate: new Date(Date.now() + 28 * 86_400_000),
        durationDays: 28,
        status: "ACTIVE",
      },
    });
    const assessment = await db.cycleAssessment.create({
      data: { cycleId: cycle.id, assessmentVersion: 1, status: "COMPLETED", decision: "ADJUST" },
    });

    // Real inbodyReassessmentDeps.claimNotification (not stubbed) — a real
    // conditional UPDATE against a real Postgres row, raced with
    // Promise.allSettled so this actually exercises DB-level concurrency,
    // not just JS logic (matches this repo's established "10 concurrent
    // requests" convention for proving an atomic-claim primitive).
    const results = await Promise.all(
      Array.from({ length: 10 }, () => svc.inbodyReassessmentDeps.claimNotification(assessment.id)),
    );
    const winners = results.filter((won) => won === true).length;
    assert.equal(winners, 1, `expected exactly 1 winner out of 10 concurrent claims, got ${winners}`);

    const finalRow = await db.cycleAssessment.findUniqueOrThrow({ where: { id: assessment.id } });
    assert.ok((finalRow as any).notifiedForReassessmentAt, "the claimed row must have notifiedForReassessmentAt set");
  } finally {
    await db.cycleAssessment.deleteMany({ where: { cycle: { userId } } });
    await db.trainingCycle.deleteMany({ where: { userId } });
  }
});
