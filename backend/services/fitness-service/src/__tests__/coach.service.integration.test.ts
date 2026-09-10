/**
 * Phase 6 (docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md) integration coverage
 * for coach.service.ts — real DB, real cycle-feedback machinery, but the
 * cross-service ACTIVE-relationship check is stubbed via coachDeps (same
 * convention as ai-service's cycle-assessment.test.ts stubbing
 * llmService.callLLM/retriever.retrieveEvidence: mutate a property on a
 * plain exported object, since a bare named-import binding can't be
 * reassigned from a test — ESM namespace properties are getter-only).
 *
 * Run with (from backend/services/fitness-service):
 *   FITNESS_DATABASE_URL="postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test" \
 *     npx tsx --test src/__tests__/coach.service.integration.test.ts
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
type CoachServiceModule = typeof import("../services/coach.service");

let prisma: PrismaClientLike | undefined;
let coachModule: CoachServiceModule | undefined;
const cleanupUserIds: string[] = [];
const cleanupExerciseIds: string[] = [];

async function loadModules() {
  if (!prisma) {
    prisma = (await import("../repositories/prisma")).prisma;
    coachModule = await import("../services/coach.service");
  }
  return { prisma: prisma!, coachService: coachModule!.coachService, coachDeps: coachModule!.coachDeps };
}

test.after(async () => {
  if (prisma) {
    const staleCoachProgramDays = await prisma.workoutProgramDay.findMany({
      where: { exercises: { some: { exerciseId: { startsWith: "coach-it-ex-" } } } },
      select: { id: true, programId: true },
    });
    await prisma.workoutSchedule.deleteMany({
      where: { programDayId: { in: staleCoachProgramDays.map((day) => day.id) } },
    });
    await prisma.workoutProgram.deleteMany({
      where: { id: { in: staleCoachProgramDays.map((day) => day.programId) } },
    });
    await prisma.workoutSchedule.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.workoutProgram.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.trainingCycle.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.coachClientActionAudit.deleteMany({
      where: {
        OR: [
          { ptUserId: { in: cleanupUserIds } },
          { clientUserId: { in: cleanupUserIds } },
        ],
      },
    });
    await prisma.exercise.deleteMany({
      where: {
        OR: [
          { id: { in: cleanupExerciseIds } },
          { id: { startsWith: "coach-it-ex-" } },
        ],
      },
    });
  }
  if (prisma) await prisma.$disconnect();
  // Real bug found while investigating why this file (and
  // coach-plan-draft.integration.test.ts) hang the test-runner process
  // even after every subtest passes: coach.service.ts -> training-cycle.
  // service.ts opens a live `redis` v4 client (repositories/redis.ts) for
  // progress-cache reads, and nothing ever closes it — an open Redis
  // socket keeps Node's event loop alive indefinitely. Other test files
  // that only exercise training-cycle.service.ts code paths that never
  // touch the cache don't hit this; this file's getClientSummary/
  // createAndAssignPlan flows do.
  // The redis v4 connection can still be mid-handshake (connect() fired
  // but not yet resolved by training-cycle.service.ts's cache reads) at
  // the moment this runs — quitting too early can race a socket that
  // finishes opening a moment later and then never gets closed. A short
  // settle delay, then an unconditional quit attempt regardless of the
  // reported isOpen state, reliably closes it either way.
  const { redisClient } = await import("../repositories/redis");
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    await redisClient.quit();
  } catch {
    // not connected / already closed — nothing to clean up
  }
  // Second, previously-missed open handle found via this session's own
  // investigation (task instruction: "do not just exclude hanging tests
  // indefinitely, root-cause them"): this file imports coach.service.ts,
  // which imports workout.service.ts, whose `workoutQueue` (a BullMQ Queue)
  // opens its OWN ioredis connection as a module-level side effect the
  // moment it's imported — separate from repositories/redis.ts's
  // `redisClient` above. Closing only `redisClient` left this second
  // connection open, which alone was enough to keep Node's event loop
  // alive indefinitely (confirmed empirically: all 5 real subtests in this
  // file already pass in ~350ms combined — the "hang" was purely this
  // process never exiting afterward, not a stuck test or a deadlock).
  const { workoutQueue } = await import("../services/workout.service");
  try {
    await workoutQueue.close();
  } catch {
    // already closed — nothing to clean up
  }
});

async function seedExercise(db: PrismaClientLike, id: string) {
  cleanupExerciseIds.push(id);
  return db.exercise.upsert({
    where: { id },
    create: {
      id,
      exerciseName: `Coach Test Exercise ${id}`,
      typeOfActivity: "STRENGTH",
      typeOfEquipment: "BODYWEIGHT",
      bodyPart: "UPPER_BODY",
      type: "PUSH",
      muscleGroupsActivated: ["test"],
      instructions: "Test exercise.",
    },
    update: {},
  });
}

function onePlanDay(exerciseId: string) {
  return [{ dayNumber: 1, title: "Day A", exercises: [{ exerciseId, sets: 3, reps: 10 }] }];
}

// ── Permission gate ──────────────────────────────────────────────────────────

test("getClientSummary: rejects (403) when there is no active PT-client relationship", skipOpts, async () => {
  const { coachService: svc, coachDeps } = await loadModules();
  const original = coachDeps.isActivePtClientRelationship;
  coachDeps.isActivePtClientRelationship = async () => false;
  try {
    await assert.rejects(
      () => svc.getClientSummary(`pt-${randomUUID()}`, `client-${randomUUID()}`),
      (err: any) => {
        assert.equal(err.status, 403);
        return true;
      },
    );
  } finally {
    coachDeps.isActivePtClientRelationship = original;
  }
});

test("createAndAssignPlan: rejects (403) when there is no active PT-client relationship, and does NOT create a program", skipOpts, async () => {
  const { prisma: db, coachService: svc, coachDeps } = await loadModules();
  const clientId = `client-${randomUUID()}`;
  const exerciseId = `coach-it-ex-${randomUUID()}`;
  cleanupUserIds.push(clientId);
  await seedExercise(db, exerciseId);

  const original = coachDeps.isActivePtClientRelationship;
  coachDeps.isActivePtClientRelationship = async () => false;
  try {
    await assert.rejects(
      () =>
        svc.createAndAssignPlan(`pt-${randomUUID()}`, clientId, {
          name: "Should not be created",
          durationWeeks: 4,
          daysPerWeek: 1,
          startDate: "2026-08-17",
          selectedWeekdays: [1],
          days: onePlanDay(exerciseId),
        } as any),
      (err: any) => {
        assert.equal(err.status, 403);
        return true;
      },
    );
  } finally {
    coachDeps.isActivePtClientRelationship = original;
  }

  const programs = await db.workoutProgram.findMany({ where: { userId: clientId } });
  assert.equal(programs.length, 0);
});

// ── Happy path (relationship stubbed to active) ──────────────────────────────

test("getClientSummary: returns null activeCycle/feedbackSummary for a client with no active cycle, and still writes an audit row", skipOpts, async () => {
  const { prisma: db, coachService: svc, coachDeps } = await loadModules();
  const ptId = `pt-${randomUUID()}`;
  const clientId = `client-${randomUUID()}`;
  cleanupUserIds.push(ptId, clientId);
  const original = coachDeps.isActivePtClientRelationship;
  coachDeps.isActivePtClientRelationship = async () => true;
  try {
    const result = await svc.getClientSummary(ptId, clientId);
    assert.equal(result.activeCycle, null);
    assert.equal(result.feedbackSummary, null);
    assert.deepEqual(result.priorDecisions, []);
  } finally {
    coachDeps.isActivePtClientRelationship = original;
  }

  const audit = await db.coachClientActionAudit.findFirst({ where: { ptUserId: ptId, clientUserId: clientId } });
  assert.ok(audit);
  assert.equal(audit?.action, "VIEW_CLIENT_SUMMARY");
});

test("getClientSummary: surfaces the client's active cycle + feedback summary when one exists", skipOpts, async () => {
  const { prisma: db, coachService: svc, coachDeps } = await loadModules();
  const ptId = `pt-${randomUUID()}`;
  const clientId = `client-${randomUUID()}`;
  cleanupUserIds.push(ptId, clientId);

  const cycle = await db.trainingCycle.create({
    data: {
      userId: clientId,
      name: "Client cycle",
      goal: "MUSCLE_GAIN",
      status: "ACTIVE",
      cycleIndex: 1,
      durationDays: 28,
      startDate: new Date(Date.now() - 5 * 86_400_000),
      endDate: new Date(Date.now() + 23 * 86_400_000),
    },
  });

  const original = coachDeps.isActivePtClientRelationship;
  coachDeps.isActivePtClientRelationship = async () => true;
  try {
    const result = await svc.getClientSummary(ptId, clientId);
    assert.equal(result.activeCycle?.id, cycle.id);
    assert.ok(result.feedbackSummary);
    assert.equal((result.feedbackSummary as any).cycleId, cycle.id);
  } finally {
    coachDeps.isActivePtClientRelationship = original;
  }
});

test("createAndAssignPlan: creates a program for the CLIENT (not the PT) and writes an audit row", skipOpts, async () => {
  const { prisma: db, coachService: svc, coachDeps } = await loadModules();
  const ptId = `pt-${randomUUID()}`;
  const clientId = `client-${randomUUID()}`;
  const exerciseId = `coach-it-ex-${randomUUID()}`;
  cleanupUserIds.push(ptId, clientId);
  await seedExercise(db, exerciseId);

  const original = coachDeps.isActivePtClientRelationship;
  coachDeps.isActivePtClientRelationship = async () => true;
  let program: any;
  try {
    program = await svc.createAndAssignPlan(ptId, clientId, {
      name: "PT-assigned plan",
      durationWeeks: 4,
      daysPerWeek: 1,
      startDate: "2026-08-17",
      selectedWeekdays: [1],
      days: onePlanDay(exerciseId),
    } as any);
  } finally {
    coachDeps.isActivePtClientRelationship = original;
  }

  assert.equal(program.program.userId, clientId);
  assert.notEqual(program.program.userId, ptId);

  const ptPrograms = await db.workoutProgram.findMany({ where: { userId: ptId } });
  assert.equal(ptPrograms.length, 0); // never attributed to the PT

  const schedules = await db.workoutSchedule.findMany({ where: { userId: clientId } });
  assert.ok(schedules.length > 0); // createManualProgram's schedule-generation ran for the client

  const audit = await db.coachClientActionAudit.findFirst({ where: { ptUserId: ptId, clientUserId: clientId, action: "CREATE_AND_ASSIGN_PLAN" } });
  assert.ok(audit);
  assert.equal((audit?.metadata as any)?.programId, program.createdProgramId);
});

// ── FitnessRoadmap PT-assisted integration (Phase E) ────────────────────
// See docs/FITNESS_ROADMAP_PT_INTEGRATION_DESIGN.md.

test(
  "getClientRoadmap / createRoadmapDraftForClient: reject (403) when there is no active PT-client relationship",
  skipOpts,
  async () => {
    const { coachService: svc, coachDeps } = await loadModules();
    const original = coachDeps.isActivePtClientRelationship;
    coachDeps.isActivePtClientRelationship = async () => false;
    try {
      await assert.rejects(
        () => svc.getClientRoadmap(`pt-${randomUUID()}`, `client-${randomUUID()}`),
        (err: any) => {
          assert.equal(err.status, 403);
          return true;
        },
      );
      await assert.rejects(
        () =>
          svc.createRoadmapDraftForClient(`pt-${randomUUID()}`, `client-${randomUUID()}`, {
            name: "Should not be created",
            goalType: "WEIGHT_LOSS",
            plannedStartAt: "2026-09-10",
          } as any),
        (err: any) => {
          assert.equal(err.status, 403);
          return true;
        },
      );
    } finally {
      coachDeps.isActivePtClientRelationship = original;
    }
  },
);

test(
  "createRoadmapDraftForClient: creates a real DRAFT roadmap attributed to createdByRole=PT and owned by the CLIENT, never the PT",
  skipOpts,
  async () => {
    const { prisma: db, coachService: svc, coachDeps } = await loadModules();
    const ptId = `pt-roadmap-${randomUUID()}`;
    const clientId = `client-roadmap-${randomUUID()}`;
    const original = coachDeps.isActivePtClientRelationship;
    coachDeps.isActivePtClientRelationship = async () => true;
    try {
      const draft = await svc.createRoadmapDraftForClient(ptId, clientId, {
        name: "PT-built roadmap",
        goalType: "WEIGHT_LOSS",
        plannedStartAt: "2026-09-10",
        phases: [
          { phaseIndex: 1, name: "Fat loss", phaseType: "FAT_LOSS", plannedStartAt: "2026-09-10", plannedEndAt: "2026-10-10" },
        ],
      } as any);

      assert.equal(draft.roadmap.status, "DRAFT");
      assert.equal((draft.roadmap as any).createdByRole, "PT");

      const row = await db.fitnessRoadmap.findUniqueOrThrow({ where: { id: draft.roadmap.id } });
      assert.equal(row.userId, clientId, "the roadmap belongs to the client");
      assert.equal(row.createdByUserId, clientId, "createdByUserId is still the client, not the PT");
      assert.notEqual(row.userId, ptId);

      // A freshly-created DRAFT is not yet ACTIVE — getClientRoadmap's
      // activeRoadmap is null (no error), but pendingDraft now surfaces it
      // (PT pending-draft visibility, closure phase).
      const beforeActivate = await svc.getClientRoadmap(ptId, clientId);
      assert.equal(beforeActivate.activeRoadmap, null);
      assert.equal((beforeActivate.pendingDraft as any)?.roadmap.id, draft.roadmap.id);
      assert.equal((beforeActivate.pendingDraft as any)?.roadmap.status, "DRAFT");

      // The PT can never activate it directly — only the client's own
      // fitnessRoadmapService.activateRoadmap call can (no PT-facing
      // activate route exists; this call uses the real client-side service
      // directly, simulating the client's own action).
      const { fitnessRoadmapService } = await import("../services/fitness-roadmap.service");
      await fitnessRoadmapService.activateRoadmap(clientId, draft.roadmap.id);

      const afterActivate = await svc.getClientRoadmap(ptId, clientId);
      assert.equal((afterActivate.activeRoadmap as any)?.roadmap.id, draft.roadmap.id);
      assert.equal((afterActivate.activeRoadmap as any)?.roadmap.status, "ACTIVE");
      assert.equal(afterActivate.pendingDraft, null, "no longer a pending draft once activated");
    } finally {
      coachDeps.isActivePtClientRelationship = original;
      await db.trainingCycle.deleteMany({ where: { userId: clientId } });
      await db.roadmapPhase.deleteMany({ where: { roadmap: { userId: clientId } } }).catch(() => {});
      await db.fitnessRoadmap.deleteMany({ where: { userId: clientId } }).catch(() => {});
    }
  },
);
