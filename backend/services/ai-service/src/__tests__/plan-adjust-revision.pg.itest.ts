/**
 * BACKEND INTEGRATION against the REAL isolated PostgreSQL (docker `postgres-test`, port 55433, database `*_test`).
 * Covers the "Điều chỉnh" revision model: an adjusted plan REPLACES the plan it adjusts (which is archived, not deleted),
 * keeps its name, a failed adjustment hides itself and leaves the original untouched, and revert restores the original.
 *
 * Refuses to run unless DATABASE_URL points at a `*_test` database on localhost:55433.
 * Run (from backend/services/ai-service):
 *   NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test \
 *   LLM_PROVIDER=mock LOG_LEVEL=silent node node_modules/tsx/dist/cli.mjs --test src/__tests__/plan-adjust-revision.pg.itest.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.LLM_PROVIDER = "mock";
const URL_ = process.env.DATABASE_URL ?? "";
if (!/localhost:55433\/[a-z_]*_test(\?|$)/.test(URL_)) {
  throw new Error(`plan-adjust-revision.pg.itest refuses to run: DATABASE_URL must target localhost:55433/*_test (got "${URL_.replace(/:[^:@/]*@/, ":***@")}")`);
}

let repo: typeof import("../repositories/conversation.repository");
const RUN = randomUUID().slice(0, 8);
const user = (n: string) => `rev-${RUN}-${n}`;

test.before(async () => {
  repo = await import("../repositories/conversation.repository");
});
test.after(async () => {
  await repo.prisma.workoutPlan.deleteMany({ where: { userId: { startsWith: `rev-${RUN}-` } } });
  await repo.prisma.$disconnect();
});

const CONTENT = (tag: string) => ({ goal: "MUSCLE_GAIN", durationWeeks: 8, daysPerWeek: 5, weeklySchedule: [{ day: "Day 1", goal: tag }], _metadata: {} }) as any;

async function completedOriginal(userId: string, name = "MUSCLE_GAIN Plan") {
  const created = await repo.prisma.workoutPlan.create({
    data: { userId, name, goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 5, plan: CONTENT("original"), status: "COMPLETED", version: 1 },
  });
  return created;
}

test("adjusted plan keeps the name, replaces the original on success, and the original is archived (not deleted)", async () => {
  const u = user("ok");
  const original = await completedOriginal(u);
  const draft = await repo.conversationRepository.createAdjustedPlan({
    userId: u, originalPlanId: original.id, goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 6, adjustments: "tăng 1 buổi tập từ 5 lên 6 buổi", version: 2, name: original.name,
  });
  assert.equal(draft.name, "MUSCLE_GAIN Plan", "no '(v2)' suffix, no raw enum name");
  assert.ok(!/Adjusted from plan|[0-9a-f]{8}-[0-9a-f]{4}/.test(draft.description ?? ""), "description must not leak the internal plan id");
  assert.equal(repo.readRevisionPreviousPlanId(draft.plan), original.id, "in-flight draft is marked as a draft of the original");

  // While the draft is processing the original is still the visible COMPLETED plan.
  const during = await repo.conversationRepository.findPlansByUser(u, undefined, 10);
  assert.deepEqual(during.filter((p) => p.status === "COMPLETED").map((p) => p.id), [original.id]);

  await repo.conversationRepository.updatePlanCompletion(draft.id, CONTENT("adjusted"));

  const after = await repo.conversationRepository.findPlansByUser(u, undefined, 10);
  assert.deepEqual(after.map((p) => p.id), [draft.id], "exactly one visible plan after the adjustment");
  const done: any = after[0];
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.name, "MUSCLE_GAIN Plan");
  assert.equal(done.plan._metadata.revision.previousPlanId, original.id, "revision marker survives into the completed content");
  assert.equal(done.plan.weeklySchedule[0].goal, "adjusted");
  const archivedOriginal = await repo.prisma.workoutPlan.findUnique({ where: { id: original.id } });
  assert.ok(archivedOriginal?.archivedAt, "original archived");
  assert.equal((archivedOriginal!.plan as any).weeklySchedule[0].goal, "original", "original content untouched");
});

test("a failed adjustment hides itself and leaves the original plan exactly as it was", async () => {
  const u = user("fail");
  const original = await completedOriginal(u);
  const draft = await repo.conversationRepository.createAdjustedPlan({
    userId: u, originalPlanId: original.id, goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 6, adjustments: "x", version: 2, name: original.name,
  });
  await repo.conversationRepository.updatePlanFailed(draft.id, "AI chưa điều chỉnh được");

  const visible = await repo.conversationRepository.findPlansByUser(u, undefined, 10);
  assert.deepEqual(visible.map((p) => p.id), [original.id], "no failed plan litters the list");
  const failed = await repo.conversationRepository.findPlanById(draft.id);
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.failReason, "AI chưa điều chỉnh được", "job polling (by id) can still read the failure reason");
  const orig = await repo.conversationRepository.findPlanById(original.id);
  assert.equal(orig?.archivedAt, null);
  assert.equal(orig?.status, "COMPLETED");
});

test("a normal (non-adjustment) failed plan stays visible as FAILED", async () => {
  const u = user("plain-fail");
  const p = await repo.prisma.workoutPlan.create({
    data: { userId: u, name: "Plan", goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 4, plan: {}, status: "QUEUED" },
  });
  await repo.conversationRepository.updatePlanFailed(p.id, "boom");
  const visible = await repo.conversationRepository.findPlansByUser(u, undefined, 10);
  assert.deepEqual(visible.map((x) => [x.id, x.status]), [[p.id, "FAILED"]]);
});

test("revert restores the original and archives the adjusted plan; it is owner-scoped and repeatable down the chain", async () => {
  const u = user("revert");
  const v1 = await completedOriginal(u);
  const d2 = await repo.conversationRepository.createAdjustedPlan({ userId: u, originalPlanId: v1.id, goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 6, adjustments: "a", version: 2, name: v1.name });
  await repo.conversationRepository.updatePlanCompletion(d2.id, CONTENT("v2"));
  const d3 = await repo.conversationRepository.createAdjustedPlan({ userId: u, originalPlanId: d2.id, goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 6, adjustments: "b", version: 3, name: v1.name });
  await repo.conversationRepository.updatePlanCompletion(d3.id, CONTENT("v3"));
  assert.deepEqual((await repo.conversationRepository.findPlansByUser(u, undefined, 10)).map((p) => p.id), [d3.id]);

  // Another user can neither see nor revert it.
  assert.deepEqual(await repo.conversationRepository.revertToPreviousVersion(d3.id, user("someone-else")), { kind: "not_found" });

  const r1 = await repo.conversationRepository.revertToPreviousVersion(d3.id, u);
  assert.deepEqual(r1, { kind: "ok", restoredPlanId: d2.id });
  assert.deepEqual((await repo.conversationRepository.findPlansByUser(u, undefined, 10)).map((p) => p.id), [d2.id]);

  const r2 = await repo.conversationRepository.revertToPreviousVersion(d2.id, u);
  assert.deepEqual(r2, { kind: "ok", restoredPlanId: v1.id });
  assert.deepEqual((await repo.conversationRepository.findPlansByUser(u, undefined, 10)).map((p) => p.id), [v1.id]);
  const restored: any = await repo.conversationRepository.findPlanById(v1.id);
  assert.equal(restored.plan.weeklySchedule[0].goal, "original");

  // The first version has no previous one.
  assert.deepEqual(await repo.conversationRepository.revertToPreviousVersion(v1.id, u), { kind: "no_previous" });
});
