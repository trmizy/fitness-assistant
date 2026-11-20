/**
 * BACKEND INTEGRATION against a REAL isolated PostgreSQL (docker `postgres-test`, port 55433, database `*_test`, migration
 * 20261120100000_workout_plan_revisions applied). Workstream B: in-place AI plan revisions.
 *
 * The queue, quota and model are fakes. The "worker" here runs the real withGenerationOperation (claim / lease fencing / finish) around the
 * real commitPlanRevision — what is NOT exercised is the LLM prompt/parse inside ai.worker (covered by workout-revision-planner.test.ts) and
 * the fitness-service HTTP catalog calls.
 *
 *   NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/revision_ai_test \
 *   LLM_PROVIDER=mock LOG_LEVEL=silent node node_modules/tsx/dist/cli.mjs --test src/__tests__/workout-plan-revision.pg.itest.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.LLM_PROVIDER = "mock";
const URL_ = process.env.DATABASE_URL ?? "";
if (!/localhost:55433\/[a-z_]*_test(\?|$)/.test(URL_)) {
  throw new Error(`workout-plan-revision.pg.itest refuses to run: DATABASE_URL must target localhost:55433/*_test (got "${URL_.replace(/:[^:@/]*@/, ":***@")}")`);
}

let ops: typeof import("../services/generation-operations");
let repo: typeof import("../repositories/conversation.repository");
let svc: (typeof import("../services/conversation.service"))["conversationService"];
let prisma: any;
const RUN = randomUUID().slice(0, 8);
const user = (n: string) => `rev-${RUN}-${n}`;
const published: Array<{ name: string; data: any; opts?: any }> = [];

const day = (n: number, goal: string, count: number, tag = "x") => ({
  day: `Day ${n}`, goal, cardio: "Khởi động",
  exercises: Array.from({ length: count }, (_, i) => ({ exerciseId: `${tag}${n}-${i + 1}`, order: i + 1, name: `Ex ${tag}${n}-${i + 1}`, sets: 3, reps: "8-12", restSeconds: 75, note: "ok" })),
});
const content = (perDay: number, tag = "x") => ({ goal: "MUSCLE_GAIN", durationWeeks: 8, daysPerWeek: 4, exercisesPerDay: perDay, weeklySchedule: [1, 2, 3, 4].map((n) => day(n, `Buổi ${n}`, perDay, tag)), _metadata: {} });

async function newPlan(userId: string, perDay = 4, extra: Record<string, unknown> = {}) {
  return prisma.workoutPlan.create({ data: { userId, name: "Kế hoạch A", goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 4, plan: content(perDay), status: "COMPLETED", version: 1, ...extra } });
}
const planRows = (userId: string) => prisma.workoutPlan.findMany({ where: { userId } });

/** The worker side of one published revision message: claim -> run(fn) -> finish, exactly as processAiTaskJob wraps it. */
async function workerRun(msg: { data: any; opts?: any }, fn: () => Promise<void>) {
  return ops.withGenerationOperation({ id: msg.opts?.jobId, data: msg.data }, fn);
}
const lastMsg = () => published[published.length - 1];

test.before(async () => {
  ops = await import("../services/generation-operations");
  repo = await import("../repositories/conversation.repository");
  ({ conversationService: svc } = await import("../services/conversation.service"));
  prisma = repo.prisma;
  const d = ops.generationOpsDeps;
  d.enqueue = async (name, data, opts) => { published.push({ name, data, opts }); return { id: opts?.jobId ?? "m" }; };
  d.admit = async () => undefined;
  ops.jobStatusDeps.bullState = async () => null;
});
test.after(async () => {
  await prisma.workoutPlanRevision.deleteMany({ where: { userId: { startsWith: `rev-${RUN}-` } } });
  await prisma.aiGenerationOperation.deleteMany({ where: { actorUserId: { startsWith: `rev-${RUN}-` } } });
  await prisma.workoutPlan.deleteMany({ where: { userId: { startsWith: `rev-${RUN}-` } } });
  await prisma.$disconnect();
});

for (const [name, text, perDay] of [["B01 4x4 -> 4x7", "Tăng tất cả buổi lên 7 bài", 7], ["B02 4x4 -> 4x8", "Mỗi buổi 8 bài", 8]] as const) {
  test(`${name}: SAME plan id, version 1 -> 2 exactly once, no second plan row, plan stays COMPLETED while the revision runs`, async () => {
    const u = user(name.slice(0, 3));
    const plan = await newPlan(u);
    const queued = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: text, expectedVersion: 1 });
    assert.equal(queued.planId, plan.id, "the response carries the SAME plan id");
    assert.equal(queued.revisionJobId, queued.jobId);
    assert.equal(queued.expectedVersion, 1);
    assert.equal(queued.version, 2);
    assert.equal(lastMsg().data.exercisesPerDay, perDay, "the job carries the user's NEW count, not the old 4");
    assert.equal(lastMsg().data.baseVersion, 1);
    assert.equal((await planRows(u)).length, 1, "no placeholder / second plan row was created");

    // while queued: the plan is still the valid COMPLETED original, and the job reports QUEUED
    const during = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
    assert.equal(during.status, "COMPLETED"); assert.equal(during.version, 1);
    const polled: any = (await ops.describeOperationJob(u, queued.jobId) as any).body;
    assert.equal(polled.status, "QUEUED"); assert.equal(polled.planId, plan.id); assert.equal(polled.plan, null);

    let outcome: any;
    await workerRun(lastMsg(), async () => {
      outcome = await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: queued.revisionJobId, expectedVersion: 1, content: content(perDay, "n"), daysPerWeek: 4, adjustments: text });
    });
    assert.deepEqual(outcome, { kind: "applied", resultVersion: 2 });

    const after = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
    assert.equal(after.version, 2, "version +1 exactly once");
    assert.equal(after.status, "COMPLETED");
    assert.ok((after.plan as any).weeklySchedule.every((d: any) => d.exercises.length === perDay));
    assert.equal((await planRows(u)).length, 1, "still one plan row");
    const revs = await prisma.workoutPlanRevision.findMany({ where: { planId: plan.id } });
    assert.equal(revs.length, 1);
    assert.equal(revs[0].baseVersion, 1); assert.equal(revs[0].resultVersion, 2);
    assert.equal((revs[0].previous as any).plan.weeklySchedule[0].exercises.length, 4, "the replaced content is kept as history");

    const done: any = (await ops.describeOperationJob(u, queued.jobId) as any).body;
    assert.equal(done.status, "COMPLETED"); assert.equal(done.planId, plan.id); assert.equal(done.version, 2); assert.equal(done.resultVersion, 2);
    assert.ok(done.plan?.weeklySchedule, "COMPLETED poll still returns the plan content like before");
  });
}

test("B09 revision FAILURE keeps the original: same content, same version, COMPLETED, no copy, clear error; job reports FAILED", async () => {
  const u = user("B09");
  const plan = await newPlan(u);
  const before = JSON.stringify((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).plan);
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 8 bài", expectedVersion: 1 });
  await workerRun(lastMsg(), async () => {
    const { leaseStorage } = await import("../services/generation-lease-context");
    leaseStorage.getStore()!.failReason = "Điều chỉnh này không áp dụng được vì thiếu bài phù hợp.";
  });
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.version, 1); assert.equal(row.status, "COMPLETED"); assert.equal(JSON.stringify(row.plan), before);
  assert.equal((await planRows(u)).length, 1);
  assert.equal(await prisma.workoutPlanRevision.count({ where: { planId: plan.id } }), 0, "no history row for a failed revision");
  const polled: any = (await ops.describeOperationJob(u, q.jobId) as any).body;
  assert.equal(polled.status, "FAILED");
  assert.match(polled.failReason, /không áp dụng được/);
  assert.equal(polled.planId, plan.id);
});

test("B07 retry/redelivery is idempotent: committing the same operation twice applies ONE revision; a redelivered message regenerates nothing", async () => {
  const u = user("B07");
  const plan = await newPlan(u);
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 1 });
  const input = { planId: plan.id, userId: u, operationId: q.revisionJobId, expectedVersion: 1, content: content(7, "n"), daysPerWeek: 4, adjustments: "Mỗi buổi 7 bài" };
  const first = await repo.conversationRepository.commitPlanRevision(input);
  const again = await repo.conversationRepository.commitPlanRevision({ ...input, content: content(7, "m") });
  const race = await Promise.all([1, 2, 3, 4].map(() => repo.conversationRepository.commitPlanRevision({ ...input, content: content(7, "q") })));
  assert.equal(first.kind, "applied");
  assert.equal(again.kind, "already_applied");
  assert.ok(race.every((r) => r.kind === "already_applied"));
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.version, 2, "version moved exactly once despite 6 commits");
  assert.equal(await prisma.workoutPlanRevision.count({ where: { planId: plan.id } }), 1);
  assert.equal((row.plan as any).weeklySchedule[0].exercises[0].exerciseId, "n1-1", "the FIRST commit's content stands");

  // the queue redelivers the finished operation's message: acknowledged, run() never invoked
  let ran = false;
  await workerRun(lastMsg(), async () => { ran = true; });
  const redelivered = await prisma.aiGenerationOperation.findUniqueOrThrow({ where: { id: q.revisionJobId } });
  assert.equal(ran, false, "no second generation for a COMPLETED/applied operation");
  void redelivered;
  // the same HTTP request retried with the same Idempotency-Key reuses the operation instead of creating another
  const key = `rest:adjust:${randomUUID()}`;
  const plan2 = await newPlan(user("B07b"));
  const a = await svc.queuePlanAdjustment({ originalPlanId: plan2.id, userId: user("B07b"), adjustments: "Mỗi buổi 6 bài", idempotencyKey: key });
  const b = await svc.queuePlanAdjustment({ originalPlanId: plan2.id, userId: user("B07b"), adjustments: "Mỗi buổi 6 bài", idempotencyKey: key });
  assert.equal(b.revisionJobId, a.revisionJobId);
  assert.equal(await prisma.aiGenerationOperation.count({ where: { id: a.revisionJobId } }), 1);
});

test("B08 concurrent revisions from the SAME version: exactly one wins, the other is a version conflict that writes nothing", async () => {
  const u = user("B08");
  const plan = await newPlan(u);
  const results = await Promise.all(["op-a", "op-b", "op-c"].map((op, i) => repo.conversationRepository.commitPlanRevision({
    planId: plan.id, userId: u, operationId: `${op}-${RUN}`, expectedVersion: 1, content: content(5 + i, `c${i}`), daysPerWeek: 4, adjustments: op,
  })));
  assert.equal(results.filter((r) => r.kind === "applied").length, 1, JSON.stringify(results.map((r) => r.kind)));
  assert.equal(results.filter((r) => r.kind === "version_conflict").length, 2);
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.version, 2);
  assert.equal(await prisma.workoutPlanRevision.count({ where: { planId: plan.id } }), 1, "no lost update, no duplicate history");
  await prisma.workoutPlanRevision.deleteMany({ where: { operationId: { endsWith: RUN } } });
});

test("B08 at submit: a stale expectedVersion is 409 VERSION_CONFLICT and queues nothing; a second request while one runs is 409 REVISION_IN_PROGRESS", async () => {
  const u = user("B08s");
  const plan = await newPlan(u, 4, { version: 3 });
  const n = published.length;
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 2 }), (e: any) => e.statusCode === 409 && e.code === "VERSION_CONFLICT");
  assert.equal(published.length, n, "nothing queued");
  const ok = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 3 });
  assert.equal(ok.expectedVersion, 3); assert.equal(ok.version, 4);
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 8 bài", expectedVersion: 3 }), (e: any) => e.statusCode === 409 && e.code === "REVISION_IN_PROGRESS");
});

test("stale commit: the plan moved on while the AI was working -> version_conflict, nothing written (no overwrite of the newer plan)", async () => {
  const u = user("stale");
  const plan = await newPlan(u);
  await prisma.workoutPlan.update({ where: { id: plan.id }, data: { version: 2, plan: content(5, "newer") } });
  const r = await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: `stale-${RUN}`, expectedVersion: 1, content: content(8, "late"), daysPerWeek: 4 });
  assert.equal(r.kind, "version_conflict");
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.version, 2); assert.equal((row.plan as any).weeklySchedule[0].exercises[0].exerciseId, "newer1-1");
  assert.equal(await prisma.workoutPlanRevision.count({ where: { planId: plan.id } }), 0);
});

test("outcomes for unusable plans: archived / not owned / not completed are refused without writing", async () => {
  const u = user("unusable");
  const archived = await newPlan(u, 4, { archivedAt: new Date() });
  const queued = await newPlan(u, 4, { status: "QUEUED" });
  const mine = await newPlan(u);
  const c = repo.conversationRepository;
  assert.equal((await c.commitPlanRevision({ planId: archived.id, userId: u, operationId: null, expectedVersion: 1, content: content(5), daysPerWeek: 4 })).kind, "plan_archived");
  assert.equal((await c.commitPlanRevision({ planId: queued.id, userId: u, operationId: null, expectedVersion: 1, content: content(5), daysPerWeek: 4 })).kind, "plan_not_ready");
  assert.equal((await c.commitPlanRevision({ planId: mine.id, userId: "someone-else", operationId: null, expectedVersion: 1, content: content(5), daysPerWeek: 4 })).kind, "plan_missing");
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: mine.id } })).version, 1);
});

test("B13 a legacy PT review recorded on the plan is reset by a revision: an approval never carries over to new content", async () => {
  const u = user("B13");
  const plan = await newPlan(u, 4, { ptUserId: "pt-1", ptReviewStatus: "PT_APPROVED", ptNote: "ok", ptReviewedAt: new Date() });
  await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: null, expectedVersion: 1, content: content(7, "n"), daysPerWeek: 4 });
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.ptReviewStatus, "PENDING_PT_REVIEW"); assert.equal(row.ptNote, null); assert.equal(row.ptReviewedAt, null);
});

test("revert in place: content returns, id stays, version still moves FORWARD, the undo is recorded; history is ordered", async () => {
  const u = user("revert");
  const plan = await newPlan(u);
  await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: null, expectedVersion: 1, content: content(7, "n"), daysPerWeek: 4, adjustments: "Mỗi buổi 7 bài" });
  const r = await repo.conversationRepository.revertPlanRevisionInPlace(plan.id, u, 2);
  assert.deepEqual(r, { kind: "ok", resultVersion: 3 });
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.id, plan.id); assert.equal(row.version, 3);
  assert.ok((row.plan as any).weeklySchedule.every((d: any) => d.exercises.length === 4));
  const hist = await repo.conversationRepository.listPlanRevisions(plan.id, u);
  assert.deepEqual(hist.map((h) => [h.kind, h.resultVersion]), [["REVERT", 3], ["ADJUST", 2]]);
  assert.equal((await repo.conversationRepository.revertPlanRevisionInPlace(plan.id, u, 1)).kind, "version_conflict");
  assert.equal((await repo.conversationRepository.revertPlanRevisionInPlace("00000000-0000-4000-8000-000000000000", u)).kind, "not_found");
  assert.equal((await repo.conversationRepository.revertPlanRevisionInPlace(plan.id, "other-user")).kind, "not_found");
});

test("B2 at the API boundary: an ambiguous or out-of-range request is refused with a question and queues nothing", async () => {
  const u = user("amb");
  const plan = await newPlan(u);
  const n = published.length;
  for (const text of ["tăng số bài", "Buổi 1 và 3 lên 6 bài", "Mỗi buổi 15 bài"]) {
    await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: text }), (e: any) => e.statusCode === 422 && /NEEDS_CLARIFICATION|VALIDATION_ERROR/.test(e.code), text);
  }
  assert.equal(published.length, n);
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).version, 1);
});

test("a stranded revision (lost message / exhausted attempts) settles FAILED without touching the plan; one that DID commit settles COMPLETED", async () => {
  const u = user("strand");
  const plan = await newPlan(u);
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài" });
  const op = await prisma.aiGenerationOperation.findUniqueOrThrow({ where: { id: q.revisionJobId } });
  const settled = await ops.generationOpsDeps.store.settleStranded(op.id, op.epoch, "max attempts exhausted", new Date());
  assert.equal(settled, "FAILED");
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.status, "COMPLETED"); assert.equal(row.version, 1);
  const polled: any = (await ops.describeOperationJob(u, q.jobId) as any).body;
  assert.equal(polled.status, "FAILED");
  assert.match(polled.failReason, /AI chưa điều chỉnh được/, "a technical reason is shown as the friendly message");

  const plan2 = await newPlan(user("strand2"));
  const q2 = await svc.queuePlanAdjustment({ originalPlanId: plan2.id, userId: user("strand2"), adjustments: "Mỗi buổi 7 bài" });
  await repo.conversationRepository.commitPlanRevision({ planId: plan2.id, userId: user("strand2"), operationId: q2.revisionJobId, expectedVersion: 1, content: content(7, "n"), daysPerWeek: 4 });
  const op2 = await prisma.aiGenerationOperation.findUniqueOrThrow({ where: { id: q2.revisionJobId } });
  assert.equal(await ops.generationOpsDeps.store.settleStranded(op2.id, op2.epoch, "late", new Date()), "COMPLETED");
});

test("B11 existing polling clients stay compatible: the poll body keeps jobId/planId/status/plan/failReason/createdAt/updatedAt/kind, ownership is enforced", async () => {
  const u = user("B11");
  const plan = await newPlan(u);
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài" });
  assert.ok(["jobId", "planId", "version", "status"].every((k) => k in q), "POST /plans/adjust response keeps jobId/planId/version/status");
  assert.equal(q.status, "QUEUED");
  const body: any = (await ops.describeOperationJob(u, q.jobId) as any).body;
  for (const k of ["jobId", "planId", "status", "plan", "failReason", "createdAt", "updatedAt", "kind"]) assert.ok(k in body, `poll body lacks ${k}`);
  assert.equal(body.kind, "WORKOUT_PLAN");
  assert.equal((await ops.describeOperationJob("intruder", q.jobId) as any).kind, "FORBIDDEN");
});

test("legacy plans created by the replace-by-new-row model are untouched: the old repository functions still work", async () => {
  const u = user("legacy");
  const original = await newPlan(u);
  const draft = await repo.conversationRepository.createAdjustedPlan({ userId: u, originalPlanId: original.id, goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 4, adjustments: "x", version: 2, name: original.name });
  assert.equal(repo.readRevisionPreviousPlanId(draft.plan), original.id);
  await repo.conversationRepository.updatePlanCompletion(draft.id, content(5, "n") as any);
  const reverted = await repo.conversationRepository.revertToPreviousVersion(draft.id, u);
  assert.deepEqual(reverted, { kind: "ok", restoredPlanId: original.id });
});

test("a plan LISTED on the marketplace (SUBMITTED/APPROVED) is never edited in place: refused at submit AND at commit, nothing written", async () => {
  const u = user("listed");
  const plan = await newPlan(u);
  const listing = await prisma.publishedPlan.create({ data: { sourcePlanId: plan.id, publisherId: u, title: "Bản đăng", goal: "MUSCLE_GAIN", moderationStatus: "APPROVED" } });
  const n = published.length;
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài" }), (e: any) => e.statusCode === 409 && /chợ/.test(e.message));
  assert.equal(published.length, n);
  const r = await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: null, expectedVersion: 1, content: content(7, "n"), daysPerWeek: 4 });
  assert.equal(r.kind, "plan_published");
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).version, 1);
  // a DRAFT listing (not yet submitted) does not block
  await prisma.publishedPlan.update({ where: { id: listing.id }, data: { moderationStatus: "DRAFT" } });
  assert.equal((await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: null, expectedVersion: 1, content: content(7, "n"), daysPerWeek: 4 })).kind, "applied");
  await prisma.publishedPlan.deleteMany({ where: { sourcePlanId: plan.id } });
});

test("B11 compat flag: an in-place revision keeps plan._metadata.revision.previousPlanId (web shows its Undo button from it); it is never treated as a draft", async () => {
  const u = user("flag");
  const plan = await newPlan(u);
  await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: null, expectedVersion: 1, content: content(7, "n"), daysPerWeek: 4 });
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(repo.readRevisionPreviousPlanId(row.plan), plan.id);
  assert.equal(row.status, "COMPLETED", "web hides a plan only when status != COMPLETED AND the flag is set");
  // the legacy replace-model undo must never see a plan as its own predecessor
  assert.deepEqual(await repo.conversationRepository.revertToPreviousVersion(plan.id, u), { kind: "no_previous" });
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).archivedAt, null);
  // the in-place undo works and the restored content carries no stale flag
  assert.equal((await repo.conversationRepository.revertPlanRevisionInPlace(plan.id, u)).kind, "ok");
  assert.equal(repo.readRevisionPreviousPlanId((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).plan), null);
});

test("RETRY after a client/gateway timeout: the same Idempotency-Key is answered from the ORIGINAL operation even though the plan has since moved to a newer version (no misleading VERSION_CONFLICT); a different text under the key is a conflict", async () => {
  const u = user("retry");
  const plan = await newPlan(u);
  const key = `rest:adjust:${plan.id}:${randomUUID()}`;
  const first = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 1, idempotencyKey: key });
  await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: first.revisionJobId, expectedVersion: 1, content: content(7, "n"), daysPerWeek: 4 });
  await prisma.aiGenerationOperation.update({ where: { id: first.revisionJobId }, data: { status: "COMPLETED" } });
  const n = published.length;
  const retry: any = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 1, idempotencyKey: key });
  assert.equal(retry.revisionJobId, first.revisionJobId, "same operation");
  assert.equal(retry.expectedVersion, 1);
  assert.equal(published.length, n, "nothing re-queued");
  assert.equal(await prisma.aiGenerationOperation.count({ where: { actorUserId: u } }), 1);
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).version, 2);
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 8 bài", expectedVersion: 1, idempotencyKey: key }), (e: any) => e.statusCode === 409 && e.code === "IDEMPOTENCY_KEY_CONFLICT");
  // WITHOUT a key a stale expectedVersion is still a conflict
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1 }), (e: any) => e.code === "VERSION_CONFLICT");
  // same key + same text but a DIFFERENT expectedVersion / explicit structured parameter is a different request
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 2, idempotencyKey: key }), (e: any) => e.code === "IDEMPOTENCY_KEY_CONFLICT");
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 1, exercisesPerDay: 9, idempotencyKey: key }), (e: any) => e.code === "IDEMPOTENCY_KEY_CONFLICT");
  assert.equal(published.length, n, "conflicts queue nothing");
});

test("REVIEW R1/R2: undo is NOT repeatable (a second undo/double click leaves the plan alone) and never rewrites a plan LISTED on the marketplace", async () => {
  const u = user("undo-guards");
  const plan = await newPlan(u);
  await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: null, expectedVersion: 1, content: content(7, "n"), daysPerWeek: 4, adjustments: "Mỗi buổi 7 bài" });
  assert.equal((await repo.conversationRepository.revertPlanRevisionInPlace(plan.id, u)).kind, "ok");
  const afterFirst = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(afterFirst.version, 3);
  // second undo (client retry / double click): refused, the adjusted content does NOT come back, no extra history row
  assert.equal((await repo.conversationRepository.revertPlanRevisionInPlace(plan.id, u)).kind, "no_previous");
  const afterSecond = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(afterSecond.version, 3);
  assert.deepEqual(afterSecond.plan, afterFirst.plan);
  assert.equal(await prisma.workoutPlanRevision.count({ where: { planId: plan.id } }), 2);
  // a new adjustment makes undo available again
  await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: null, expectedVersion: 3, content: content(6, "m"), daysPerWeek: 4 });
  // ...but not while the plan is listed on the marketplace
  await prisma.publishedPlan.create({ data: { sourcePlanId: plan.id, publisherId: u, title: "Bản đăng", goal: "MUSCLE_GAIN", moderationStatus: "APPROVED" } });
  const before = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal((await repo.conversationRepository.revertPlanRevisionInPlace(plan.id, u)).kind, "plan_published");
  const after = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(after.version, before.version); assert.deepEqual(after.plan, before.plan);
});

test("C3: a FAILED revision is answered consistently under its key — same key + same action returns the ORIGINAL failed operation (never silently restarted); a changed action is a conflict; a NEW key makes a fresh attempt that re-validates the current version", async () => {
  const u = user("c3");
  const plan = await newPlan(u);
  const key = `rest:adjust:${plan.id}:${randomUUID()}`;
  const first = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1, idempotencyKey: key });
  await prisma.aiGenerationOperation.update({ where: { id: first.revisionJobId }, data: { status: "FAILED", lastError: "model down" } });
  const n = published.length;

  const again: any = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1, idempotencyKey: key });
  assert.equal(again.replayed, true); assert.equal(again.status, "FAILED", "the real status is reported");
  assert.equal(again.revisionJobId, first.revisionJobId, "the ORIGINAL operation");
  const row = await prisma.aiGenerationOperation.findUniqueOrThrow({ where: { id: first.revisionJobId } });
  assert.equal(row.epoch, 1, "NOT reopened as a new epoch"); assert.equal(row.status, "FAILED");
  assert.equal(published.length, n, "no new worker message");
  assert.equal(await prisma.aiGenerationOperation.count({ where: { actorUserId: u } }), 1);
  // whitespace/case differences are the SAME action
  const same: any = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "  mỗi   BUỔI 6 bài ", expectedVersion: 1, idempotencyKey: key });
  assert.equal(same.revisionJobId, first.revisionJobId);
  // a different action under the same key is an explicit conflict
  for (const other of [{ adjustments: "Mỗi buổi 7 bài", expectedVersion: 1 }, { adjustments: "Mỗi buổi 6 bài", expectedVersion: 2 }, { adjustments: "Mỗi buổi 6 bài", expectedVersion: 1, exercisesPerDay: 9 }, { adjustments: "Mỗi buổi 6 bài", expectedVersion: 1, daysPerWeek: 3 }]) {
    await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, idempotencyKey: key, ...other }), (e: any) => e.code === "IDEMPOTENCY_KEY_CONFLICT" && e.statusCode === 409);
  }
  // the plan moves on; the old failure is STILL reported as that failure (no misleading conflict / success)
  await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: randomUUID(), expectedVersion: 1, content: content(7, "m"), daysPerWeek: 4 });
  const later: any = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1, idempotencyKey: key });
  assert.equal(later.replayed, true); assert.equal(later.status, "FAILED");
  // an explicit NEW attempt (new key) revalidates the version: stale expectedVersion -> VERSION_CONFLICT; the current one is accepted
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1, idempotencyKey: `rest:adjust:${plan.id}:${randomUUID()}` }), (e: any) => e.code === "VERSION_CONFLICT");
  const fresh = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 6 bài", expectedVersion: 2, idempotencyKey: `rest:adjust:${plan.id}:${randomUUID()}` });
  assert.notEqual(fresh.revisionJobId, first.revisionJobId);
});

test("C4: replay is bound to the ACTION (not free text alone): every kind of request is replayed after success and conflicts when the action differs", async () => {
  const actions = ["Đổi bài barbell bench press thành dumbbell bench press", "Tăng mỗi buổi lên 7 bài", "Thêm 2 bài mỗi buổi", "Giảm còn 3 bài", "Mỗi buổi 9 bài, bỏ squat"];
  for (const [i, text] of actions.entries()) {
    const u = user(`c4-${i}`);
    const plan = await newPlan(u);
    const key = `rest:adjust:${plan.id}:${randomUUID()}`;
    const first = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: text, expectedVersion: 1, idempotencyKey: key });
    await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: first.revisionJobId, expectedVersion: 1, content: content(7, "z"), daysPerWeek: 4 });
    await prisma.aiGenerationOperation.update({ where: { id: first.revisionJobId }, data: { status: "COMPLETED" } });
    const n = published.length;
    const retry: any = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: text.toUpperCase(), expectedVersion: 1, idempotencyKey: key }); // plan moved to v2 meanwhile; same action
    assert.equal(retry.replayed, true, text); assert.equal(retry.status, "COMPLETED"); assert.equal(retry.revisionJobId, first.revisionJobId);
    assert.equal(published.length, n, "nothing re-queued");
    await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: `${text} và bỏ plank`, expectedVersion: 1, idempotencyKey: key }), (e: any) => e.code === "IDEMPOTENCY_KEY_CONFLICT", text);
  }
  // another user's / another plan's reuse of a key can never read or replay someone else's operation
  const a = user("c4-iso-a"), b = user("c4-iso-b");
  const pa = await newPlan(a), pb = await newPlan(b);
  const k = `rest:adjust:${pa.id}:${randomUUID()}`;
  const qa = await svc.queuePlanAdjustment({ originalPlanId: pa.id, userId: a, adjustments: "Mỗi buổi 6 bài", idempotencyKey: k });
  const qb = await svc.queuePlanAdjustment({ originalPlanId: pb.id, userId: b, adjustments: "Mỗi buổi 6 bài", idempotencyKey: k });
  assert.notEqual(qa.revisionJobId, qb.revisionJobId, "the key is scoped to the actor");
  const pa2 = await newPlan(a);
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: pa2.id, userId: a, adjustments: "Mỗi buổi 6 bài", idempotencyKey: k }), (e: any) => e.code === "IDEMPOTENCY_KEY_CONFLICT", "the same key on another plan of the same user is a conflict");
});

test("C4 (controller): a swap request retried after it SUCCEEDED is answered from its operation — before 'X' (now gone from the plan) is resolved and before the LLM health probe", async () => {
  const { planController } = await import("../controllers/plan.controller");
  const u = user("c4-swap");
  const plan = await newPlan(u);
  const text = "Đổi bài barbell bench press thành dumbbell bench press";
  const key = `rest:adjust:${plan.id}:${randomUUID()}`;
  const first = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: text, expectedVersion: 1, idempotencyKey: key });
  await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: first.revisionJobId, expectedVersion: 1, content: content(4, "swapped"), daysPerWeek: 4 });
  await prisma.aiGenerationOperation.update({ where: { id: first.revisionJobId }, data: { status: "COMPLETED" } });
  const call = async (body: any, k: string) => {
    let code = 0, payload: any;
    const res: any = { status(c: number) { code = c; return this; }, json(b: any) { payload = b; return this; }, setHeader() { return this; } };
    const req: any = { context: { userId: u, role: "CUSTOMER" }, body, headers: {}, header: (h: string) => (h.toLowerCase() === "idempotency-key" ? k : undefined) };
    await planController.adjustPlan(req, res, (e: any) => { throw e; });
    return { code, payload };
  };
  const n = published.length;
  const r = await call({ planId: plan.id, adjustments: text, expectedVersion: 1 }, key.replace(/^rest:adjust:[^:]+:/, ""));
  assert.equal(r.code, 202, JSON.stringify(r.payload)); assert.equal(r.payload.data.replayed, true); assert.equal(r.payload.data.revisionJobId, first.revisionJobId);
  assert.equal(published.length, n);
  const conflict = await call({ planId: plan.id, adjustments: "Đổi bài barbell bench press thành cable fly", expectedVersion: 1 }, key.replace(/^rest:adjust:[^:]+:/, ""));
  assert.equal(conflict.code, 409); assert.equal(conflict.payload.error.code, "IDEMPOTENCY_KEY_CONFLICT");
});

test("C1-01/02/03: two concurrent submissions with DIFFERENT keys for the same plan and expectedVersion — exactly ONE is admitted; the loser gets a clear 409, leaves no operation and publishes nothing (so no model call)", async () => {
  const u = user("c1-race");
  const plan = await newPlan(u);
  for (let round = 0; round < 5; round++) {
    const before = published.length;
    const mk = () => svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: `Mỗi buổi ${5 + round} bài`, expectedVersion: 1, idempotencyKey: `rest:adjust:${plan.id}:${randomUUID()}` });
    const settled = await Promise.allSettled([mk(), mk(), mk()]);
    const ok = settled.filter((s) => s.status === "fulfilled");
    const bad = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
    assert.equal(ok.length, 1, `round ${round}: exactly one admission (got ${ok.length})`);
    assert.ok(bad.every((b) => b.reason?.code === "REVISION_IN_PROGRESS" && b.reason?.statusCode === 409), `round ${round}: every loser is a clear REVISION_IN_PROGRESS`);
    assert.equal(published.length - before, 1, "ONE queue message in total => the model can only be invoked once");
    const live = await prisma.aiGenerationOperation.findMany({ where: { actorUserId: u, targetId: plan.id, status: { in: ["ADMITTED", "PUBLISHED", "RUNNING"] } } });
    assert.equal(live.length, 1);
    assert.equal(await prisma.aiGenerationOperation.count({ where: { actorUserId: u, status: "RESERVING" } }), 0, "no reservation leaked by the losers");
    // C1-06: the plan stays COMPLETED and usable while the revision is in flight
    assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).status, "COMPLETED");
    // finish this one so the next round can run
    await prisma.aiGenerationOperation.update({ where: { id: live[0].id }, data: { status: "FAILED", lastError: "round done" } });
  }
});

test("C1-04: a duplicate delivery of the SAME message is one logical job (the loser of a race is not a second job either)", async () => {
  const u = user("c1-dup");
  const plan = await newPlan(u);
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 1 });
  const msg = lastMsg();
  let runs = 0;
  const run = async () => { runs++; await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: q.revisionJobId, expectedVersion: 1, content: content(7, "d"), daysPerWeek: 4 }); };
  await workerRun(msg, run);
  await workerRun(msg, run); // redelivery of the same message
  assert.equal(runs, 1, "the second delivery is acknowledged without work");
  assert.equal(await prisma.aiGenerationOperation.count({ where: { actorUserId: u } }), 1);
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).version, 2);
});

test("C1-05: a STUCK revision (no progress, lease expired) does not lock the plan forever — it is settled FAILED and the new request is admitted; a FRESH one still blocks", async () => {
  const u = user("c1-stuck");
  const plan = await newPlan(u);
  const stuck = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1 });
  // fresh in-flight revision: blocks
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 1 }), (e: any) => e.code === "REVISION_IN_PROGRESS");
  // it dies silently: RUNNING with an expired lease, last touched 2 hours ago
  const old = new Date(Date.now() - 2 * 3600_000);
  await prisma.aiGenerationOperation.update({ where: { id: stuck.revisionJobId }, data: { status: "RUNNING", attempt: 1, leaseOwner: "dead", leaseExpiresAt: old, updatedAt: old } });
  const n = published.length;
  const next = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 1 });
  assert.notEqual(next.revisionJobId, stuck.revisionJobId); assert.equal(published.length, n + 1);
  const dead = await prisma.aiGenerationOperation.findUniqueOrThrow({ where: { id: stuck.revisionJobId } });
  assert.equal(dead.status, "FAILED", "the stuck one was settled");
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).status, "COMPLETED", "the plan was never touched");
  // queue failure must not leave a permanent lock: an ADMITTED op whose publish failed is recovered/settled by the existing recovery
  const u2 = user("c1-queuefail"); const p2 = await newPlan(u2);
  const realEnqueue = ops.generationOpsDeps.enqueue;
  ops.generationOpsDeps.enqueue = async () => { throw new Error("queue down"); };
  try { await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: p2.id, userId: u2, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1 })); } finally { ops.generationOpsDeps.enqueue = realEnqueue; }
  const stranded = await prisma.aiGenerationOperation.findFirstOrThrow({ where: { actorUserId: u2 } });
  const old2 = new Date(Date.now() - 2 * 3600_000);
  await prisma.aiGenerationOperation.update({ where: { id: stranded.id }, data: { updatedAt: old2 } });
  const after = await svc.queuePlanAdjustment({ originalPlanId: p2.id, userId: u2, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1 });
  assert.ok(after.revisionJobId, "the plan is revisable again after a queue failure + stale window");
});

test("C1: the CAS at commit is untouched — a revision that lost the base version still cannot overwrite the plan", async () => {
  const u = user("c1-cas");
  const plan = await newPlan(u);
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1 });
  await prisma.workoutPlan.update({ where: { id: plan.id }, data: { version: 2 } }); // someone else moved the plan
  const r = await repo.conversationRepository.commitPlanRevision({ planId: plan.id, userId: u, operationId: q.revisionJobId, expectedVersion: 1, content: content(6, "c"), daysPerWeek: 4 });
  assert.equal(r.kind, "version_conflict");
});

test("review C3-F1: a double tap whose first request is still RESERVING is not a key conflict (same payload -> already being processed; different payload -> conflict)", async () => {
  const u = user("c3-reserving");
  const plan = await newPlan(u);
  const key = `rest:adjust:${plan.id}:${randomUUID()}`;
  // the first request created its reservation but has not been admitted yet (no target, no payload)
  await prisma.aiGenerationOperation.create({ data: { actorUserId: u, kind: "PLAN_ADJUSTMENT", idempotencyKey: key, fingerprint: "pending", status: "RESERVING", reservationToken: randomUUID() } });
  const n = published.length;
  await assert.rejects(svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1, idempotencyKey: key }), (e: any) => e.statusCode === 409 && e.code !== "VERSION_CONFLICT");
  assert.equal(published.length, n, "nothing queued by the second tap");
  assert.equal(await prisma.aiGenerationOperation.count({ where: { actorUserId: u } }), 1);
});
