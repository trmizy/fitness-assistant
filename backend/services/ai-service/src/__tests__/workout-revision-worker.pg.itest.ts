/**
 * BACKEND INTEGRATION: the REAL processAiTaskJob (claim -> catalog fetch -> delta planning -> final invariants -> fenced commit) against a REAL
 * isolated PostgreSQL, with fitness-service replaced by a small local HTTP fake (the real requestService path) and the model replaced by
 * `llmService.callLLM` stubs. NOT a live-model / live-fitness-service test: it proves the orchestration and persistence behaviour of an
 * in-place revision, not the quality of what a real model writes.
 *
 *   NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/revision_ai_test \
 *   LLM_PROVIDER=mock LOG_LEVEL=silent node node_modules/tsx/dist/cli.mjs --test src/__tests__/workout-revision-worker.pg.itest.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

process.env.LLM_PROVIDER = "mock";
process.env.DISABLE_AI_PLAN_EVIDENCE = "true";
process.env.USER_SERVICE_URL = "http://127.0.0.1:1";
const URL_ = process.env.DATABASE_URL ?? "";
if (!/localhost:55433\/[a-z_]*_test(\?|$)/.test(URL_)) throw new Error("workout-revision-worker.pg.itest refuses to run outside localhost:55433/*_test");

let fake: http.Server;
let ops: typeof import("../services/generation-operations");
let repo: typeof import("../repositories/conversation.repository");
let svc: (typeof import("../services/conversation.service"))["conversationService"];
let worker: typeof import("../workers/ai.worker");
let llm: (typeof import("../services/llm.service"))["llmService"];
let prisma: any;
const RUN = randomUUID().slice(0, 8);
const user = (n: string) => `revw-${RUN}-${n}`;
const published: Array<{ data: any; opts?: any }> = [];
let llmCalls: Array<{ prompt: string; numPredict?: number }> = [];
let llmImpl: (prompt: string) => string = () => "{}";
let equipmentValid = true;

const CATALOG = Array.from({ length: 60 }, (_, i) => ({
  id: `cat-${String(i + 1).padStart(2, "0")}`, exerciseName: `Catalog Exercise ${i + 1}`, bodyPart: "FULL_BODY", typeOfActivity: "STRENGTH",
  typeOfEquipment: "DUMBBELL", muscleGroupsActivated: ["chest", "back", "legs"], movementPattern: "PUSH", mechanics: "COMPOUND", difficultyLevel: "BEGINNER",
  loggingMode: "REPS_LOAD", contraindications: [], equipmentRequirements: [], muscles: [],
}));
const originalIds = (d: number) => [1, 2, 3, 4].map((i) => CATALOG[(d - 1) * 4 + i - 1].id); // cat-01..cat-16 in days 1..4

test.before(async () => {
  fake = http.createServer((req, res) => {
    const send = (data: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(data)); };
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = req.url ?? "";
      if (url.startsWith("/internal/exercises/for-ai-plans")) return send({ success: true, data: { exercises: CATALOG } });
      if (url.startsWith("/internal/exercises/muscle-profiles")) return send({ data: { exercises: [] } });
      if (url.startsWith("/internal/exercises/validate-plan-equipment")) return send({ data: { valid: equipmentValid, violations: equipmentValid ? [] : [{ exerciseId: "x", dayIndex: 0, exerciseName: "x", required: [] }], skippedNoUserEquipment: true } });
      res.statusCode = 404; send({});
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  process.env.FITNESS_SERVICE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  delete process.env.FITNESS_LAMBDA_NAME;
  process.env.INTERNAL_SERVICE_SECRET = "revw-secret";

  ops = await import("../services/generation-operations");
  repo = await import("../repositories/conversation.repository");
  ({ conversationService: svc } = await import("../services/conversation.service"));
  worker = await import("../workers/ai.worker");
  ({ llmService: llm } = await import("../services/llm.service"));
  prisma = repo.prisma;
  const d = ops.generationOpsDeps;
  d.enqueue = async (_n, data, opts) => { published.push({ data, opts }); return { id: opts?.jobId ?? "m" }; };
  d.admit = async () => undefined;
  ops.jobStatusDeps.bullState = async () => null;
  (llm as any).callLLM = async (prompt: string, opts: any) => { llmCalls.push({ prompt, numPredict: opts?.numPredict }); return { answer: llmImpl(prompt), promptTokens: 1, completionTokens: 1 }; };
});
test.after(async () => {
  fake?.close();
  await prisma.workoutPlanRevision.deleteMany({ where: { userId: { startsWith: `revw-${RUN}-` } } });
  await prisma.aiGenerationOperation.deleteMany({ where: { actorUserId: { startsWith: `revw-${RUN}-` } } });
  await prisma.workoutPlan.deleteMany({ where: { userId: { startsWith: `revw-${RUN}-` } } });
  await prisma.$disconnect();
});
test.beforeEach(() => { llmCalls = []; equipmentValid = true; delete process.env.AI_PLAN_MAX_OUTPUT_TOKENS; });

const planContent = () => ({
  goal: "MUSCLE_GAIN", durationWeeks: 8, daysPerWeek: 4, exercisesPerDay: 4,
  weeklySchedule: [1, 2, 3, 4].map((d) => ({
    day: `Day ${d}`, goal: "Toàn thân", cardio: "Khởi động 5 phút",
    exercises: originalIds(d).map((id, i) => ({ exerciseId: id, order: i + 1, name: CATALOG.find((c) => c.id === id)!.exerciseName, sets: 3, reps: "8-12", restSeconds: 75, note: "ok" })),
  })),
  progressionNotes: ["Tăng dần"], recoveryNotes: ["Ngủ đủ"], nutritionSummary: "Đủ protein",
});
async function newPlan(userId: string) {
  return prisma.workoutPlan.create({ data: { userId, name: "Kế hoạch A", goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 4, plan: planContent(), status: "COMPLETED", version: 1 } });
}
/** A model that does what the delta prompt asks: for each [Day N] block pick the first `need` candidate ids. */
const cooperativeModel = (prompt: string) => {
  const days = [...prompt.matchAll(/\[Day (\d+)\][^\n]*ADD EXACTLY (\d+) NEW[^\n]*\n[^\n]*\nCandidates[^\n]*\n((?:[^\n]+\n?)+?)(?:\n\n|\nSchema|$)/g)];
  return JSON.stringify({ days: days.map((m) => ({ dayIndex: Number(m[1]) - 1, add: m[3].trim().split("\n").slice(0, Number(m[2])).map((l) => ({ exerciseId: l.split("|")[0], name: l.split("|")[1], sets: 3, reps: "10", restSeconds: 60, note: "Bổ sung" })) })) });
};
const runWorker = async () => worker.processAiTaskJob({ id: published[published.length - 1].opts?.jobId, name: "generate-plan", data: published[published.length - 1].data, attemptsMade: 0 } as any);
const opOf = (id: string) => prisma.aiGenerationOperation.findUniqueOrThrow({ where: { id } });

test("worker: 4x4 -> 4x7 end to end — delta of +3/day, same plan id, version 2, old exercises kept in place, ONE model call, operation COMPLETED", async () => {
  const u = user("a"); const plan = await newPlan(u);
  llmImpl = cooperativeModel;
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Tăng tất cả buổi lên 7 bài", expectedVersion: 1 });
  await runWorker();
  assert.equal(llmCalls.length, 1, "delta: one small call for all four days");
  assert.match(llmCalls[0].prompt, /ADD EXACTLY 3 NEW/);
  assert.ok((llmCalls[0].numPredict ?? 0) <= 5000, "numPredict within the provider limit");
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.id, plan.id); assert.equal(row.version, 2); assert.equal(row.status, "COMPLETED");
  const sched = (row.plan as any).weeklySchedule;
  assert.equal(sched.length, 4);
  sched.forEach((d: any, i: number) => {
    assert.equal(d.exercises.length, 7);
    assert.deepEqual(d.exercises.slice(0, 4).map((e: any) => e.exerciseId), originalIds(i + 1), "the 4 original exercises are untouched and first");
    assert.equal(new Set(d.exercises.map((e: any) => e.exerciseId)).size, 7);
    assert.ok(d.exercises.every((e: any) => CATALOG.some((c) => c.id === e.exerciseId)), "catalog ids only");
  });
  assert.equal((row.plan as any).exercisesPerDay, 7);
  assert.equal((await prisma.workoutPlan.findMany({ where: { userId: u } })).length, 1);
  assert.equal((await opOf(q.revisionJobId)).status, "COMPLETED");
  assert.equal(await prisma.workoutPlanRevision.count({ where: { planId: plan.id } }), 1);
});

test("worker: 4x4 -> 4x8 (+4/day) — the final count is 8, never trimmed back to the old 4", async () => {
  const u = user("b"); const plan = await newPlan(u);
  llmImpl = cooperativeModel;
  await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 8 bài", expectedVersion: 1 });
  await runWorker();
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.version, 2);
  assert.ok((row.plan as any).weeklySchedule.every((d: any) => d.exercises.length === 8));
});

for (const perDay of [9, 10] as const) {
  test(`worker (fix A): 4x4 -> 4x${perDay} is accepted end to end — the stored plan passes PlanContentSchema (cap 10), keeps the 4 originals first, ids unique and from the catalog`, async () => {
    const u = user(`n${perDay}`); const plan = await newPlan(u);
    llmImpl = cooperativeModel;
    await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: `Mỗi buổi ${perDay} bài`, expectedVersion: 1 });
    await runWorker();
    const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
    assert.equal(row.version, 2); assert.equal(row.status, "COMPLETED");
    const sched = (row.plan as any).weeklySchedule;
    sched.forEach((d: any, i: number) => {
      assert.equal(d.exercises.length, perDay);
      assert.deepEqual(d.exercises.slice(0, 4).map((e: any) => e.exerciseId), originalIds(i + 1));
      assert.equal(new Set(d.exercises.map((e: any) => e.exerciseId)).size, perDay);
    });
    assert.equal((row.plan as any).exercisesPerDay, perDay);
    const { PlanContentSchema } = await import("../schemas/plan.schemas");
    assert.equal(PlanContentSchema.safeParse(row.plan).success, true, "stored content is valid under the response schema");
    assert.equal(PlanContentSchema.safeParse({ ...(row.plan as any), exercisesPerDay: 11 }).success, false, "11 is still rejected");
  });
}

test("worker B05: a model that returns TRUNCATED JSON on every attempt -> plan untouched (v1, same content), no revision row, job FAILED with a clear message", async () => {
  const u = user("c"); const plan = await newPlan(u);
  const before = JSON.stringify(plan.plan);
  llmImpl = () => '{"days":[{"dayIndex":0,"add":[{"exerciseId":"cat-17","name":"Catal';
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 1 });
  await runWorker();
  assert.equal(llmCalls.length, 2, "one retry then give up");
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.version, 1); assert.equal(row.status, "COMPLETED"); assert.equal(JSON.stringify(row.plan), before);
  assert.equal(await prisma.workoutPlanRevision.count({ where: { planId: plan.id } }), 0);
  const op = await opOf(q.revisionJobId);
  assert.equal(op.status, "FAILED");
  assert.match(op.lastError, /Kế hoạch cũ vẫn giữ nguyên/);
  const polled: any = (await ops.describeOperationJob(u, q.jobId) as any).body;
  assert.equal(polled.status, "FAILED"); assert.equal(polled.planId, plan.id);
});

test("worker B06/B18: a LOW provider output limit forces chunking — several calls, each numPredict <= the configured limit, result still complete", async () => {
  process.env.AI_PLAN_MAX_OUTPUT_TOKENS = "1000";
  const u = user("d"); const plan = await newPlan(u);
  llmImpl = cooperativeModel;
  await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Tăng tất cả buổi lên 7 bài", expectedVersion: 1 });
  await runWorker();
  assert.ok(llmCalls.length > 1, `expected several chunked calls, got ${llmCalls.length}`);
  assert.ok(llmCalls.every((c) => (c.numPredict ?? 0) <= 1000), JSON.stringify(llmCalls.map((c) => c.numPredict)));
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.version, 2);
  assert.ok((row.plan as any).weeklySchedule.every((d: any) => d.exercises.length === 7));
});

test("worker: a limit too small for even one day is a specific conflict — the plan is NOT shrunk and the model is never called", async () => {
  process.env.AI_PLAN_MAX_OUTPUT_TOKENS = "300";
  const u = user("e"); const plan = await newPlan(u);
  llmImpl = cooperativeModel;
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 8 bài", expectedVersion: 1 });
  await runWorker();
  assert.equal(llmCalls.length, 0);
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).version, 1);
  assert.match((await opOf(q.revisionJobId)).lastError, /không tự giảm số bài/);
});

test("worker: the plan moved on between queueing and running -> refused BEFORE any model call (no paid call, no overwrite)", async () => {
  const u = user("f"); const plan = await newPlan(u);
  llmImpl = cooperativeModel;
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 1 });
  await prisma.workoutPlan.update({ where: { id: plan.id }, data: { version: 2, plan: { ...planContent(), progressionNotes: ["đã sửa tay"] } } });
  await runWorker();
  assert.equal(llmCalls.length, 0);
  const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(row.version, 2); assert.deepEqual((row.plan as any).progressionNotes, ["đã sửa tay"]);
  assert.match((await opOf(q.revisionJobId)).lastError, /đã được cập nhật/);
});

test("worker B07: the SAME message delivered twice -> one revision, the model is called once", async () => {
  const u = user("g"); const plan = await newPlan(u);
  llmImpl = cooperativeModel;
  await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 6 bài", expectedVersion: 1 });
  await runWorker(); await runWorker();
  assert.equal(llmCalls.length, 1);
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).version, 2);
  assert.equal(await prisma.workoutPlanRevision.count({ where: { planId: plan.id } }), 1);
});

test("worker: final equipment/invariant failure writes NOTHING (the validator is the last gate before the commit)", async () => {
  const u = user("h"); const plan = await newPlan(u);
  llmImpl = cooperativeModel; equipmentValid = false;
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 7 bài", expectedVersion: 1 });
  await runWorker();
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).version, 1);
  assert.equal(await prisma.workoutPlanRevision.count({ where: { planId: plan.id } }), 0);
  assert.equal((await opOf(q.revisionJobId)).status, "FAILED");
});

test("worker: asking for the count the plan already has changes nothing and says so (no empty revision, no model call)", async () => {
  const u = user("i"); const plan = await newPlan(u);
  llmImpl = cooperativeModel;
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 4 bài", expectedVersion: 1 });
  await runWorker();
  assert.equal(llmCalls.length, 0);
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).version, 1);
  assert.match((await opOf(q.revisionJobId)).lastError, /đúng 4 bài mỗi buổi/);
});

const fullPlanAnswer = (prompt: string): string => {
  const num = (re: RegExp, d: number) => Number(re.exec(prompt)?.[1] ?? d);
  const days = num(/DaysPerWeek: (\d+)/, 4), per = num(/ExercisesPerDay: (\d+)/, 4);
  const blocks = [...prompt.matchAll(/\[Day (\d+)\] ([^\n]*)\n((?:[^\n\[][^\n]*\n?)+)/g)];
  return JSON.stringify({ goal: "MUSCLE_GAIN", durationWeeks: 8, daysPerWeek: days, exercisesPerDay: per,
    weeklySchedule: Array.from({ length: days }, (_, i) => { const b = blocks.find((x) => Number(x[1]) === i + 1) ?? blocks[0]; const lines = (b?.[3] ?? "").trim().split("\n").filter((l) => l.includes("|"));
      return { day: `Day ${i + 1}`, goal: (b?.[2] ?? "Toàn thân").trim(), cardio: "Khởi động", exercises: lines.slice(0, per).map((l, k) => ({ exerciseId: l.split("|")[0], order: k + 1, name: l.split("|")[1], sets: 3, reps: "8-12", restSeconds: 75, note: "ok" })) }; }),
    progressionNotes: ["x"], recoveryNotes: ["y"], nutritionSummary: "z" });
};

test("VERSION SKEW (old API -> NEW worker): a message produced before in-place revisions (target WORKOUT_PLAN, no baseVersion) still runs through the legacy plan-row lifecycle and completes", async () => {
  const u = user("skewA"); const original = await newPlan(u);
  const draftId = randomUUID(), opId = randomUUID();
  await repo.conversationRepository.createAdjustedPlan({ id: draftId, jobId: opId, userId: u, originalPlanId: original.id, goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: 4, adjustments: "Mỗi buổi 5 bài", version: 2, name: original.name } as any);
  const job = { userId: u, goal: "MUSCLE_GAIN", durationWeeks: 8, daysPerWeek: 4, exercisesPerDay: 5, adjustmentContext: "Mỗi buổi 5 bài", previousPlan: [] };
  await prisma.aiGenerationOperation.create({ data: { id: opId, actorUserId: u, kind: "PLAN_ADJUSTMENT", idempotencyKey: `legacy-${opId}`, fingerprint: "legacy", status: "PUBLISHED", epoch: 1, publishCount: 1, targetType: "WORKOUT_PLAN", targetId: draftId, payload: { planCreate: {}, job } } });
  llmImpl = fullPlanAnswer;
  await worker.processAiTaskJob({ id: `${opId}-e1`, name: "generate-plan", data: { ...job, operationId: opId, epoch: 1, planId: draftId, kind: "PLAN_ADJUSTMENT", actorUserId: u }, attemptsMade: 0 } as any);
  const draft = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: draftId } });
  assert.equal(draft.status, "COMPLETED"); assert.equal(draft.version, 2);
  assert.ok((draft.plan as any).weeklySchedule.every((d: any) => d.exercises.length === 5));
  assert.equal((await opOf(opId)).status, "COMPLETED");
  assert.equal(await prisma.workoutPlanRevision.count({ where: { userId: u } }), 0, "the legacy path never writes revision history");
  assert.ok((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: original.id } })).archivedAt, "legacy behaviour: the replaced plan is archived");
  assert.equal(((await ops.describeOperationJob(u, opId)) as any).body.status, "COMPLETED", "the legacy job is polled exactly as before");
});

test("VERSION SKEW (NEW API -> old worker): an operation marked COMPLETED with NO committed revision is reported FAILED, never as a successful adjustment", async () => {
  const u = user("skewB"); const plan = await newPlan(u);
  const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 8 bài", expectedVersion: 1 });
  // what the previous worker does with this message: sees a COMPLETED plan, runs nothing and finishes the operation
  await prisma.aiGenerationOperation.update({ where: { id: q.revisionJobId }, data: { status: "COMPLETED", completedAt: new Date() } });
  const polled: any = ((await ops.describeOperationJob(u, q.jobId)) as any).body;
  assert.equal(polled.status, "FAILED");
  assert.match(polled.failReason, /AI chưa điều chỉnh được/);
  assert.equal((await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } })).version, 1);
});

// ── A1: token-budget guard of the whole-plan regeneration path, with real plan sizes (deterministic model stub, no provider) ──────────────────
const bigPlanContent = (counts: number[]) => ({
  goal: "MUSCLE_GAIN", durationWeeks: 8, daysPerWeek: counts.length, exercisesPerDay: Math.max(...counts),
  weeklySchedule: counts.map((c, d) => ({
    day: `Day ${d + 1}`, goal: "Toàn thân", cardio: "Khởi động",
    exercises: Array.from({ length: c }, (_, i) => { const cat = CATALOG[(counts.slice(0, d).reduce((a, b) => a + b, 0) + i) % CATALOG.length]; return { exerciseId: cat.id, order: i + 1, name: cat.exerciseName, sets: 3, reps: "8-12", restSeconds: 75, note: "ok" }; }),
  })),
  progressionNotes: ["x"], recoveryNotes: ["y"], nutritionSummary: "z",
});
const newBigPlan = (userId: string, counts: number[]) => prisma.workoutPlan.create({ data: { userId, name: "Kế hoạch lớn", goal: "MUSCLE_GAIN", duration: 8, daysPerWeek: counts.length, plan: bigPlanContent(counts), status: "COMPLETED", version: 1 } });
/** A model that answers the FULL-regeneration prompt: per [Day N] block, the first `ExercisesPerDay` candidate lines. */
const fullModel = (prompt: string) => {
  const num = (re: RegExp, d: number) => Number(re.exec(prompt)?.[1] ?? d);
  const days = num(/DaysPerWeek: (\d+)/, 4), per = num(/ExercisesPerDay: (\d+)/, 4);
  const blocks = [...prompt.matchAll(/\[Day (\d+)\] ([^\n]*)\n((?:[^\n\[][^\n]*\n?)+)/g)];
  return JSON.stringify({ goal: "MUSCLE_GAIN", durationWeeks: 8, daysPerWeek: days, exercisesPerDay: per,
    weeklySchedule: Array.from({ length: days }, (_, i) => { const b = blocks.find((x) => Number(x[1]) === i + 1) ?? blocks[0]; const lines = (b?.[3] ?? "").trim().split("\n").filter((l) => l.includes("|"));
      return { day: `Day ${i + 1}`, goal: (b?.[2] ?? "Toàn thân").trim(), cardio: "Khởi động", exercises: lines.slice(0, per).map((l, k) => ({ exerciseId: l.split("|")[0], order: k + 1, name: l.split("|")[1], sets: 3, reps: "8-12", restSeconds: 75, note: "ok" })) };
    }), progressionNotes: ["x"], recoveryNotes: ["y"], nutritionSummary: "z" });
};
const withProvider = async (provider: string, fn: () => Promise<void>) => { const prev = process.env.LLM_PROVIDER; process.env.LLM_PROVIDER = provider; try { await fn(); } finally { process.env.LLM_PROVIDER = prev; } };

for (const [days, per] of [[5, 5], [4, 7], [5, 6]] as const) {
  test(`A1 worker: a ${days}x${per} = ${days * per}-exercise plan regenerated through the FULL path on a hosted 5000-token provider is NOT refused (600 + 140/exercise = ${600 + days * per * 140} <= 5000); the model is called, the plan is revised in place`, async () => {
    await withProvider("bedrock", async () => {
      const u = user(`a1-${days}x${per}`); const plan = await newBigPlan(u, Array(days).fill(per));
      llmImpl = fullModel;
      // an exclusion makes this a non-count-only edit => the whole-plan regeneration path
      const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: `Mỗi buổi ${per} bài, bỏ plank`, expectedVersion: 1 });
      await runWorker();
      assert.equal(llmCalls.length, 1, "the guard let it through");
      assert.ok((llmCalls[0].numPredict ?? 0) <= 5000);
      const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
      assert.equal(row.version, 2, (await opOf(q.revisionJobId)).lastError ?? ""); assert.equal(row.status, "COMPLETED");
      const sched = (row.plan as any).weeklySchedule;
      assert.equal(sched.length, days); assert.ok(sched.every((d: any) => d.exercises.length === per && d.exercises.length <= 10));
      assert.equal((await opOf(q.revisionJobId)).status, "COMPLETED");
    });
  });
}

test("A1 worker: 4x8 = 32 exercises exceeds a hosted 5000-token output (5080) — refused BEFORE any model call, the plan is untouched and the message says it will not shrink the plan", async () => {
  await withProvider("bedrock", async () => {
    const u = user("a1-32"); const plan = await newBigPlan(u, [8, 8, 8, 8]);
    const before = JSON.stringify(plan.plan);
    llmImpl = fullModel;
    const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 8 bài, bỏ plank", expectedVersion: 1 });
    await runWorker();
    assert.equal(llmCalls.length, 0);
    const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
    assert.equal(row.version, 1); assert.equal(JSON.stringify(row.plan), before);
    const op = await opOf(q.revisionJobId);
    assert.equal(op.status, "FAILED"); assert.match(op.lastError, /5080 token/); assert.match(op.lastError, /không tự giảm số bài/);
  });
});

test("A1 worker: TRUNCATED output on the full path writes NOTHING (25-exercise plan stays byte-identical, no history row, job FAILED)", async () => {
  await withProvider("bedrock", async () => {
    const u = user("a1-trunc"); const plan = await newBigPlan(u, [5, 5, 5, 5, 5]);
    const before = JSON.stringify(plan.plan);
    llmImpl = () => '{"goal":"MUSCLE_GAIN","weeklySchedule":[{"day":"Day 1","goal":"x","exercises":[{"exerciseId":"cat-01","order":1,"na';
    const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 5 bài, bỏ plank", expectedVersion: 1 });
    await runWorker();
    assert.ok(llmCalls.length >= 1);
    const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
    assert.equal(row.version, 1); assert.equal(JSON.stringify(row.plan), before);
    assert.equal(await prisma.workoutPlanRevision.count({ where: { planId: plan.id } }), 0);
    assert.equal((await opOf(q.revisionJobId)).status, "FAILED");
  });
});

test("A1 worker: a 31-exercise 7-day plan raised to 10/day (the per-day maximum) is CHUNKED by day on a hosted provider, every call within 5000, the final plan has exactly 10 per day, originals first, schema-valid", async () => {
  await withProvider("bedrock", async () => {
    const u = user("a1-31"); const plan = await newBigPlan(u, [4, 4, 4, 4, 5, 5, 5]);
    llmImpl = cooperativeModel;
    const q = await svc.queuePlanAdjustment({ originalPlanId: plan.id, userId: u, adjustments: "Mỗi buổi 10 bài", expectedVersion: 1 });
    await runWorker();
    assert.ok(llmCalls.length > 1, `chunked into ${llmCalls.length} calls`);
    assert.ok(llmCalls.every((c) => (c.numPredict ?? 0) <= 5000), JSON.stringify(llmCalls.map((c) => c.numPredict)));
    const row = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
    assert.equal(row.version, 2, (await opOf(q.revisionJobId)).lastError ?? "");
    const sched = (row.plan as any).weeklySchedule; const orig = bigPlanContent([4, 4, 4, 4, 5, 5, 5]).weeklySchedule;
    assert.ok(sched.every((d: any) => d.exercises.length === 10));
    sched.forEach((d: any, i: number) => assert.deepEqual(d.exercises.slice(0, orig[i].exercises.length).map((e: any) => e.exerciseId), orig[i].exercises.map((e: any) => e.exerciseId)));
    const { PlanContentSchema } = await import("../schemas/plan.schemas");
    assert.equal(PlanContentSchema.safeParse(row.plan).success, true);
  });
});
