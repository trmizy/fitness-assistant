import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * Workstream B <-> fitness-service: an AI plan REVISED IN PLACE (same WorkoutPlan.id, higher version) re-saved into the WorkoutProgram that is
 * being trained. Evidence label: BACKEND INTEGRATION on an isolated *_test Postgres (skipped, not failed, without one).
 *
 * Invariants proven here:
 *  - WorkoutProgram.id is stable; sourcePlanId keeps pointing at the AI plan; no second program is created;
 *  - the program FOLLOWS the revised plan, and WorkoutProgram.version moves up exactly once per real content change (atomic with the edit);
 *  - an identical re-save does NOT bump the version (a PT approval is not invalidated by a no-op);
 *  - a PT approval recorded for the old content is never "current" for the revised one, including A -> B -> A;
 *  - completed workout history is byte-for-byte unchanged;
 *  - a rejected sync (day count changed, unknown exercise) writes nothing.
 */
const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(url);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.FITNESS_DISABLE_REDIS = process.env.FITNESS_DISABLE_REDIS || "true";
const skipOpts = { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.", timeout: 120_000 };

const RUN = randomUUID().slice(0, 8);
const CLIENT = `sync-client-${RUN}`, PT = `sync-pt-${RUN}`;
let prisma: (typeof import("../repositories/prisma"))["prisma"];
let workoutService: (typeof import("../services/workout.service"))["workoutService"];
let workoutQueue: (typeof import("../services/workout.service"))["workoutQueue"];
let planReview: (typeof import("../services/plan-review"))["planReviewService"];
let ids: string[] = [];

const client = { id: CLIENT, role: "CUSTOMER" }, pt = { id: PT, role: "PT" };
const exerciseRow = (id: string, i: number) => ({ exerciseId: id, order: i + 1, name: `Sync ${id.slice(0, 6)}`, sets: 3, reps: "10", restSeconds: 75, note: "ok" });
const planInput = (sourcePlanId: string, version: number, perDay: number, days = 2, offset = 0) => ({
  sourcePlanId, sourcePlanVersion: version, sourcePlanName: "Kế hoạch đồng bộ", goal: "MUSCLE_GAIN", durationWeeks: 1, daysPerWeek: days,
  weeklySchedule: Array.from({ length: days }, (_, d) => ({ day: `Day ${d + 1}`, goal: `Buổi ${d + 1}`, cardio: "Khởi động", exercises: Array.from({ length: perDay }, (_, i) => exerciseRow(ids[offset + d * 4 + i], i)) })),
} as any);

const program = (id: string) => prisma.workoutProgram.findUniqueOrThrow({ where: { id }, include: { days: { orderBy: { dayNumber: "asc" }, include: { exercises: { orderBy: { order: "asc" } } } } } });
const ex = (p: any) => p.days.map((d: any) => d.exercises.map((e: any) => e.exerciseId));

test.before(async () => {
  if (!canUseIntegrationDb) return;
  prisma = (await import("../repositories/prisma")).prisma;
  const ws = await import("../services/workout.service");
  workoutService = ws.workoutService; workoutQueue = ws.workoutQueue;
  const pr = await import("../services/plan-review");
  planReview = pr.planReviewService;
  pr.planReviewDeps.fetchActiveClientIds = async (p) => (p === PT ? [CLIENT] : []);
  pr.planReviewDeps.notify = null;
  // The shared catalog is also written by other test files that run in parallel (rows with NO movementPattern that they delete again afterwards).
  // Real catalog rows always carry a movementPattern (movement-pattern.test.ts), so only those are stable fixtures for this file.
  ids = (await prisma.exercise.findMany({ where: { status: "PUBLISHED", movementPattern: { not: null } }, orderBy: { exerciseName: "asc" }, take: 40, select: { id: true } })).map((e: any) => e.id);
  assert.ok(ids.length >= 20, "needs the seeded exercise catalog");
});
test.after(async () => {
  if (!canUseIntegrationDb) return;
  await prisma.planReviewRequest.deleteMany({ where: { clientUserId: CLIENT } });
  await prisma.workout.deleteMany({ where: { userId: CLIENT } });
  await prisma.workoutSchedule.deleteMany({ where: { userId: CLIENT } });
  await prisma.workoutProgram.deleteMany({ where: { userId: CLIENT } });
  if (workoutQueue) await workoutQueue.close();
  await prisma.$disconnect();
});

test("B12/B13/B14/B15 revised AI plan -> SAME program id, version up once per real change, history intact, PT approval never carries over (incl. A -> B -> A)", skipOpts, async () => {
  const planId = randomUUID();
  const first: any = await workoutService.importAiPlanToSchedule(CLIENT, planInput(planId, 1, 2));
  const programId: string = first.createdProgramId;
  let p = await program(programId);
  assert.equal(p.version, 1); assert.equal(p.sourcePlanId, planId); assert.equal(p.aiPlanVersion, 1);
  const originalRows = p.days.map((d: any) => d.exercises.map((e: any) => e.id));
  const contentA = ex(p);

  // a completed workout logged against the program (history)
  const wk = await prisma.workout.create({ data: { userId: CLIENT, name: "Đã tập", exercises: { create: [{ exerciseId: p.days[0].exercises[0].exerciseId, programExerciseId: p.days[0].exercises[0].id, sets: 3, reps: 10, weight: 40, order: 1 }] } } });
  const historyBefore = JSON.stringify(await prisma.workout.findUniqueOrThrow({ where: { id: wk.id }, include: { exercises: true } }));

  // PT approves version 1
  const req = (await planReview.submit(client, { ptUserId: PT })).request;
  assert.equal(req.subjectVersion, 1);
  const approved = (await planReview.approve(pt, req.id, { note: "ok" })).request;
  assert.equal(approved.effectiveState, "APPROVED_CURRENT");

  // AI revises the plan in place (same planId, version 2: 4 exercises per day, the 2 originals kept)
  const v2: any = await workoutService.importAiPlanToSchedule(CLIENT, planInput(planId, 2, 4));
  assert.equal(v2.createdProgramId, programId, "same program id");
  assert.equal(v2.alreadyExists, true); assert.equal(v2.contentSynced, true); assert.equal(v2.previousAiPlanVersion, 1); assert.equal(v2.programVersion, 2);
  assert.equal(await prisma.workoutProgram.count({ where: { userId: CLIENT } }), 1, "no second program");
  p = await program(programId);
  assert.equal(p.version, 2); assert.equal(p.aiPlanVersion, 2); assert.equal(p.sourcePlanId, planId);
  assert.ok(p.days.every((d: any) => d.exercises.length === 4), "the program follows the revised plan");
  assert.deepEqual(p.days.map((d: any) => d.exercises.slice(0, 2).map((e: any) => e.id)), originalRows, "surviving exercises keep their row ids");
  assert.equal(JSON.stringify(await prisma.workout.findUniqueOrThrow({ where: { id: wk.id }, include: { exercises: true } })), historyBefore, "B14: completed workout history untouched");
  assert.equal((await planReview.get(client, req.id)).effectiveState, "APPROVED_OUTDATED", "B13: the approval does not apply to the revised content");

  // idempotent: the SAME revised plan saved again changes nothing and does not bump the version
  const again: any = await workoutService.importAiPlanToSchedule(CLIENT, planInput(planId, 2, 4));
  assert.equal(again.contentSynced, false); assert.equal(again.programVersion, 2);
  // a newer plan version with IDENTICAL content only records the plan version (a no-op must not invalidate approvals)
  const noop: any = await workoutService.importAiPlanToSchedule(CLIENT, planInput(planId, 3, 4));
  assert.equal(noop.contentSynced, false); assert.equal(noop.programVersion, 2);
  assert.equal((await program(programId)).aiPlanVersion, 3);

  // B15: revised back to EXACTLY the original content (plan version 4): program version 3, content equals A, the v1 approval is still not current
  const back: any = await workoutService.importAiPlanToSchedule(CLIENT, planInput(planId, 4, 2));
  assert.equal(back.programVersion, 3);
  p = await program(programId);
  assert.deepEqual(ex(p), contentA, "content is byte-identical to the approved plan");
  const view = await planReview.get(client, req.id);
  assert.equal(view.effectiveState, "APPROVED_OUTDATED", "A -> B -> A does not revive the old approval");
  const fresh = (await planReview.submit(client, { ptUserId: PT })).request;
  assert.equal(fresh.subjectVersion, 3); assert.equal(fresh.contentHash, req.contentHash);
  assert.notEqual(fresh.id, req.id);
});

test("a sync that cannot be applied (unknown exercise) is refused and writes NOTHING (a changed day count is now APPLIED: see ai-plan-days-sync.integration.test.ts)", skipOpts, async () => {
  const planId = randomUUID();
  const created: any = await workoutService.importAiPlanToSchedule(CLIENT, planInput(planId, 1, 2, 2, 8));
  const programId: string = created.createdProgramId;
  const before = JSON.stringify(await program(programId));
  const bad = planInput(planId, 2, 3, 2, 8);
  bad.weeklySchedule[0].exercises[0].exerciseId = "00000000-0000-4000-8000-00000000dead";
  await assert.rejects(workoutService.importAiPlanToSchedule(CLIENT, bad), (e: any) => e.status === 400);
  assert.equal(JSON.stringify(await program(programId)), before, "program (content + version + aiPlanVersion) unchanged");
});

test("an OLDER plan version never rolls the program back", skipOpts, async () => {
  const planId = randomUUID();
  const created: any = await workoutService.importAiPlanToSchedule(CLIENT, planInput(planId, 5, 3, 2, 16));
  const programId: string = created.createdProgramId;
  const stale: any = await workoutService.importAiPlanToSchedule(CLIENT, planInput(planId, 4, 2, 2, 16));
  assert.equal(stale.contentSynced, false);
  assert.ok((await program(programId)).days.every((d: any) => d.exercises.length === 3), "stale client cannot shrink the program");
});
