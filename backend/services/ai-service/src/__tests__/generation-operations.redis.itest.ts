/**
 * V-T012 Q-01 — BACKEND INTEGRATION against a REAL, isolated Redis (docker `redis-test`, 127.0.0.1:56379) with the real
 * BullMQ 5.x Queue/Worker and the production `enqueueAiTask` adapter, plus the isolated PostgreSQL (`*_test`, :55433)
 * for the operation rows. Quota and the model are fakes; SQS/DynamoDB/Lambda are NOT exercised here.
 *
 * Refuses to run unless Redis is 56379 and the database is localhost:55433/*_test.
 *
 * Run (from backend/services/ai-service):
 *   NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test \
 *   REDIS_HOST=127.0.0.1 REDIS_PORT=56379 LLM_PROVIDER=mock LOG_LEVEL=silent \
 *   node node_modules/tsx/dist/cli.mjs --test --test-force-exit src/__tests__/generation-operations.redis.itest.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";

process.env.LLM_PROVIDER = "mock";
if (!/localhost:55433\/[a-z_]*_test(\?|$)/.test(process.env.DATABASE_URL ?? "")) throw new Error("refusing to run: DATABASE_URL must target localhost:55433/*_test");
if (process.env.REDIS_PORT !== "56379" || !["127.0.0.1", "localhost"].includes(process.env.REDIS_HOST ?? "")) throw new Error("refusing to run: Redis must be the isolated redis-test on 127.0.0.1:56379");
delete process.env.QUEUE_PROVIDER; // BullMQ path, not SQS

let ops: typeof import("../services/generation-operations");
let qp: typeof import("../workers/queue-provider");
let prisma: any;
let aiQueue: any;
let redisConnection: any;
const RUN = randomUUID().slice(0, 8);
const actor = (n: string) => `rq-${RUN}-${n}`;
const madeJobIds = new Set<string>();
let admits = 0;

test.before(async () => {
  ops = await import("../services/generation-operations");
  qp = await import("../workers/queue-provider");
  ({ prisma } = await import("../repositories/conversation.repository"));
  ({ aiQueue, redisConnection } = await import("../workers/ai.queue"));
  ops.generationOpsDeps.admit = async () => { admits++; };
  ops.generationOpsDeps.publishBackoffMs = () => 0;
  // real Redis reachable and empty of our ids
  assert.equal(await (await aiQueue.client).ping(), "PONG");
});
test.beforeEach(() => { admits = 0; });
test.after(async () => {
  for (const id of madeJobIds) { const j = await aiQueue.getJob(id).catch(() => null); if (j) await j.remove().catch(() => undefined); }
  await prisma.aiGenerationOperation.deleteMany({ where: { actorUserId: { startsWith: `rq-${RUN}` } } });
  await prisma.nutritionPlan.deleteMany({ where: { userId: { startsWith: `rq-${RUN}` } } });
  await prisma.workoutPlan.deleteMany({ where: { userId: { startsWith: `rq-${RUN}` } } });
  await aiQueue.close();
  await prisma.$disconnect();
});

const count = async (jobId: string) => ((await aiQueue.getJob(jobId)) ? 1 : 0);

test("Redis: the BullMQ-safe transport id is accepted and a duplicate enqueue creates no second job", async () => {
  const opId = randomUUID();
  const id = ops.transportJobId(opId, 1);
  madeJobIds.add(id);
  const a = await qp.enqueueAiTask("generate-nutrition-plan", { operationId: opId, epoch: 1 }, { jobId: id });
  const b = await qp.enqueueAiTask("generate-nutrition-plan", { operationId: opId, epoch: 1 }, { jobId: id });
  assert.equal(a.id, id);
  assert.equal(b.id, id, "same custom id -> same job");
  const waiting = await aiQueue.getJobs(["waiting", "delayed", "active"]);
  assert.equal(waiting.filter((j: any) => j.id === id).length, 1, "exactly one job in Redis");
});

test("Redis: a different epoch is a distinct job; the old colon-style id is rejected by the real BullMQ validator", async () => {
  const opId = randomUUID();
  const e1 = ops.transportJobId(opId, 1), e2 = ops.transportJobId(opId, 2);
  madeJobIds.add(e1); madeJobIds.add(e2);
  await qp.enqueueAiTask("generate-plan", { operationId: opId, epoch: 1 }, { jobId: e1 });
  await qp.enqueueAiTask("generate-plan", { operationId: opId, epoch: 2 }, { jobId: e2 });
  assert.equal(await count(e1), 1);
  assert.equal(await count(e2), 1);
  assert.notEqual(e1, e2);
  await assert.rejects(() => qp.enqueueAiTask("generate-plan", {}, { jobId: `${opId}:1` }), /cannot contain :/i);
});

test("Redis: a republish REPLACES a retained failed/completed job of the same id (recovery really re-runs), but never a waiting one", async () => {
  const opId = randomUUID();
  const id = ops.transportJobId(opId, 1);
  madeJobIds.add(id);
  await qp.enqueueAiTask("generate-plan", { operationId: opId, epoch: 1 }, { jobId: id });
  // a duplicate publish while the job is still WAITING is absorbed (one job)
  await qp.enqueueAiTask("generate-plan", { operationId: opId, epoch: 1 }, { jobId: id });
  assert.equal((await aiQueue.getJobs(["waiting", "delayed", "active"])).filter((j: any) => j.id === id).length, 1);
  let processed = 0;
  let failNext = false;
  const w = new Worker("ai-tasks", async (job) => { if (job.id === id) { processed++; if (failNext) throw new Error("boom"); } return "ok"; }, { connection: redisConnection as any });
  try {
    for (let i = 0; i < 50 && processed < 1; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(processed, 1);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await (await aiQueue.getJob(id)).getState(), "completed");
    // recovery republish after the retained COMPLETED job: it must run again (not be swallowed by the retained id)
    await qp.enqueueAiTask("generate-plan", { operationId: opId, epoch: 1 }, { jobId: id });
    for (let i = 0; i < 50 && processed < 2; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(processed, 2, "the republish ran again");
    // same for a retained FAILED job
    failNext = true;
    await qp.enqueueAiTask("generate-plan", { operationId: opId, epoch: 1 }, { jobId: id });
    for (let i = 0; i < 50 && processed < 3; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(processed, 3);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await (await aiQueue.getJob(id)).getState(), "failed");
    failNext = false;
    await qp.enqueueAiTask("generate-plan", { operationId: opId, epoch: 1 }, { jobId: id });
    for (let i = 0; i < 50 && processed < 4; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(processed, 4, "a retained FAILED job no longer blocks recovery either");
  } finally {
    await w.close();
  }
});

test("Redis+PG: submitGeneration publishes the execution binding with the deterministic transport id; replays add no job; charge once", async () => {
  const a = actor("submit");
  const input = { actorUserId: a, kind: "NUTRITION_PLAN" as const, idempotencyKey: "rq-submit-0001",
    planCreate: { userId: a, name: "P", goal: "MAINTENANCE", durationWeeks: 1, mealsPerDay: 3 }, job: { userId: a, goal: "MAINTENANCE" } };
  const r1 = await ops.submitGeneration(input);
  const tid = ops.transportJobId(r1.operationId, r1.epoch);
  madeJobIds.add(tid);
  const job = await aiQueue.getJob(tid);
  assert.ok(job, "job exists under operationId-e<epoch>");
  assert.equal(job.name, "generate-nutrition-plan");
  assert.deepEqual({ ...job.data }, { userId: a, goal: "MAINTENANCE", operationId: r1.operationId, epoch: 1, planId: r1.planId, kind: "NUTRITION_PLAN", actorUserId: a });
  const r2 = await ops.submitGeneration(input);
  assert.equal(r2.operationId, r1.operationId);
  assert.equal(admits, 1);
  assert.equal((await aiQueue.getJobs(["waiting", "delayed", "active", "completed", "failed"])).filter((j: any) => j.id === tid).length, 1);
  assert.equal((await prisma.nutritionPlan.count({ where: { userId: a } })), 1);
});

test("Redis+PG: describeOperationJob sees a FAILED live BullMQ job through the epoch-derived transport id (public id never parsed)", async () => {
  const a = actor("fail");
  const r = await ops.submitGeneration({ actorUserId: a, kind: "WORKOUT_PLAN", idempotencyKey: "rq-fail-00001",
    planCreate: { userId: a, name: "W", goal: "STRENGTH", duration: 4, daysPerWeek: 3 }, job: { userId: a } });
  const tid = ops.transportJobId(r.operationId, r.epoch);
  madeJobIds.add(tid);
  const w = new Worker("ai-tasks", async (job) => { if (job.id === tid) throw new Error("model exploded"); return "ok"; }, { connection: redisConnection as any });
  try {
    for (let i = 0; i < 60; i++) { const j = await aiQueue.getJob(tid); if (j && (await j.getState()) === "failed") break; await new Promise((x) => setTimeout(x, 100)); }
    const st = await ops.describeOperationJob(a, r.operationId);
    assert.equal(st.kind, "OK");
    assert.equal((st as any).body.status, "FAILED");
    assert.match(String((st as any).body.failReason), /model exploded/);
    assert.equal((st as any).body.jobId, r.operationId);
    assert.equal((await ops.describeOperationJob("someone-else", r.operationId)).kind, "FORBIDDEN");
  } finally {
    await w.close();
  }
});
