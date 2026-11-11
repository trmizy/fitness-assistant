/**
 * V-T012.2 / V-T012.2.1 — durable generation operations: idempotency, execution incarnation (epoch), atomic
 * worker fencing, metadata reference, reservation ownership and recovery.
 *
 * TEST FIXTURE evidence only. The OperationStore is an in-memory mirror of the Prisma store's compare-and-set
 * semantics with a per-operation row lock (helpers/memory-operation-store.ts); plans live in a Map behind a
 * prisma-shaped facade; publisher, quota and clock are fakes. This proves the algorithm under the modelled
 * interleavings. It does NOT prove Postgres behaviour (unique-index races, row locks, updateMany counts),
 * the SQS transport, or DynamoDB: POSTGRESQL_INTEGRATION_ENVIRONMENT_BLOCKED (no Docker / isolated database).
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.LLM_PROVIDER = "mock";

import { createMemoryOperationStore } from "./helpers/memory-operation-store";
import { RateLimitedError, RateLimitUnavailableError } from "../errors/api-error";

let ops: typeof import("../services/generation-operations");
let lease: typeof import("../services/generation-lease-context");
let repo: any;
let memory: ReturnType<typeof createMemoryOperationStore>;
const plans = new Map<string, any>();
const published: Array<{ name: string; data: any; opts?: any }> = [];
let enqueueAttempts = 0;
const counters = { admit: 0, models: 0 };
let admitImpl: (u: string) => Promise<void>;
let publishFailures = 0;
let clock = new Date("2026-10-19T10:00:00Z");
const inject = { failPlanUpdates: 0, zeroRowPlanUpdates: 0 };
const barrier = { armed: false, entered: (): void => undefined, gate: Promise.resolve() as Promise<void> };

const table = () => ({
  async findUnique({ where }: any) { return plans.get(where.id) ?? null; },
  async updateMany({ where, data }: any) {
    const p = plans.get(where.id);
    if (!p) return { count: 0 };
    if (barrier.armed) { barrier.armed = false; barrier.entered(); await barrier.gate; }
    if (inject.failPlanUpdates > 0) { inject.failPlanUpdates--; throw new Error("injected plan update failure"); }
    if (inject.zeroRowPlanUpdates > 0) { inject.zeroRowPlanUpdates--; return { count: 0 }; }
    if (where.status?.not && p.status === where.status.not) return { count: 0 };
    if (where.status?.in && !where.status.in.includes(p.status)) return { count: 0 };
    Object.assign(p, data);
    return { count: 1 };
  },
  async update({ where, data }: any) {
    const p = plans.get(where.id);
    if (barrier.armed) { barrier.armed = false; barrier.entered(); await barrier.gate; }
    Object.assign(p, data);
    return p;
  },
});
const facade = { workoutPlan: table(), nutritionPlan: table() };

const NUTRITION = (over: Record<string, unknown> = {}) => ({
  actorUserId: "user-a",
  kind: "NUTRITION_PLAN" as const,
  idempotencyKey: "key-12345678",
  planCreate: { userId: "user-a", name: "Plan", goal: "MAINTENANCE", durationWeeks: 1, mealsPerDay: 3 },
  job: { userId: "user-a", goal: "MAINTENANCE", durationWeeks: 1, mealsPerDay: 3 },
  ...over,
});

test.before(async () => {
  ops = await import("../services/generation-operations");
  lease = await import("../services/generation-lease-context");
  const { conversationRepository, prisma } = await import("../repositories/conversation.repository");
  repo = conversationRepository;
  const make = (d: any) => { plans.set(d.id, { ...d, status: "QUEUED" }); return d; };
  repo.findNutritionPlanById = async (id: string) => plans.get(id) ?? null;
  repo.findPlanById = async (id: string) => plans.get(id) ?? null;
  repo.createNutritionPlan = async (d: any) => make(d);
  repo.createWorkoutPlan = async (d: any) => make(d);
  repo.createAdjustedPlan = async (d: any) => make(d);
  repo.updateNutritionPlanJob = async (id: string, jobId: string) => { plans.get(id).jobId = jobId; };
  repo.updatePlanJob = async (id: string, jobId: string) => { plans.get(id).jobId = jobId; };
  (prisma as any).nutritionPlan.updateMany = facade.nutritionPlan.updateMany;
  (prisma as any).workoutPlan.updateMany = facade.workoutPlan.updateMany;
});

test.beforeEach(() => {
  memory = createMemoryOperationStore({ db: facade });
  plans.clear();
  published.length = 0;
  enqueueAttempts = 0;
  counters.admit = 0;
  counters.models = 0;
  publishFailures = 0;
  barrier.armed = false;
  inject.failPlanUpdates = 0;
  inject.zeroRowPlanUpdates = 0;
  clock = new Date("2026-10-19T10:00:00Z");
  admitImpl = async () => undefined;
  const d = ops.generationOpsDeps;
  d.store = memory.store;
  d.now = () => clock;
  d.admit = async (u: string) => { counters.admit++; await admitImpl(u); };
  d.enqueue = async (name, data, opts) => {
    enqueueAttempts++;
    if (publishFailures > 0) { publishFailures--; throw new Error("simulated SQS failure"); }
    published.push({ name, data, opts });
    return { id: `msg-${published.length}` };
  };
  d.leaseMs = () => 10_000;
  d.maxAttempts = () => 3;
  d.maxPublishes = () => 3;
  d.reservingTimeoutMs = () => 60_000;
  d.admittedStaleMs = () => 60_000;
  d.publishedStaleMs = () => 900_000;
  d.publishBackoffMs = () => 0; // backoff has its own test
});

const rowOf = (id: string) => memory.rows.get(id)!;
const tick = () => new Promise((r) => setImmediate(r));
const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };
const delivered = async (over: Record<string, unknown> = {}) => {
  const r = await ops.submitGeneration(NUTRITION(over));
  return { r, data: published[published.length - 1].data };
};
const complete = (planId: string, content = "ok") => repo.updateNutritionPlanCompletion(planId, content);

// ── Identity & idempotency (V-T012.2) ──────────────────────────────────────

test("1. same operation retried: one logical operation, one charge, one job, one plan; jobId is the stable operation reference", async () => {
  const a = await ops.submitGeneration(NUTRITION());
  const b = await ops.submitGeneration(NUTRITION());
  assert.equal(a.operationId, b.operationId);
  assert.equal(a.planId, b.planId);
  assert.equal(b.reused, true);
  assert.equal(a.jobId, a.operationId, "client-facing job reference is the operation id, not a transport message id");
  assert.equal(plans.get(a.planId).jobId, a.operationId, "Plan.jobId is set at plan creation (no attach step to fail)");
  assert.equal(counters.admit, 1);
  assert.equal(published.length, 1);
  assert.equal(plans.size, 1);
  const m = published[0].data;
  assert.deepEqual({ operationId: m.operationId, epoch: m.epoch, planId: m.planId, kind: m.kind, actorUserId: m.actorUserId },
    { operationId: a.operationId, epoch: 1, planId: a.planId, kind: "NUTRITION_PLAN", actorUserId: "user-a" }, "message carries the full execution binding");
});

test("2. same key with different input is rejected and costs nothing", async () => {
  await ops.submitGeneration(NUTRITION());
  await assert.rejects(
    ops.submitGeneration(NUTRITION({ job: { userId: "user-a", goal: "BULK", durationWeeks: 1, mealsPerDay: 3 } })),
    (e: any) => e.statusCode === 409 && e.code === "IDEMPOTENCY_KEY_CONFLICT",
  );
  assert.equal(counters.admit, 1);
  assert.equal(published.length, 1);
});

test("3. a different key with the SAME payload is a distinct, separately charged operation", async () => {
  const a = await ops.submitGeneration(NUTRITION());
  const b = await ops.submitGeneration(NUTRITION({ idempotencyKey: "key-revision-2" }));
  assert.notEqual(a.operationId, b.operationId);
  assert.notEqual(a.planId, b.planId);
  assert.equal(counters.admit, 2);
  assert.equal(published.length, 2);
});

test("4. 10 concurrent identical requests converge on ONE operation: one charge, one job, one plan", async () => {
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => ops.submitGeneration(NUTRITION())));
  const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
  const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  assert.ok(ok.length >= 1);
  assert.ok(rejected.every((r) => r.reason.code === "OPERATION_IN_PROGRESS"), "losers are told to retry, never given a second operation");
  assert.equal(new Set(ok.map((r) => r.value.operationId)).size, 1);
  assert.equal(memory.rows.size, 1);
  assert.equal(counters.admit, 1);
  assert.equal(published.length, 1);
  assert.equal(plans.size, 1);
});

test("5/6. quota rejection or outage leaves no executable operation, plan or job; a later retry is charged once", async () => {
  admitImpl = async () => { throw new RateLimitedError("slow down", 5); };
  await assert.rejects(ops.submitGeneration(NUTRITION()), RateLimitedError);
  admitImpl = async () => { throw new RateLimitUnavailableError(); };
  await assert.rejects(ops.submitGeneration(NUTRITION()), RateLimitUnavailableError);
  assert.equal(memory.rows.size, 0);
  assert.equal(plans.size, 0);
  assert.equal(published.length, 0);
  admitImpl = async () => undefined;
  await ops.submitGeneration(NUTRITION());
  assert.equal(published.length, 1);
  assert.equal(counters.admit, 3);
});

test("7. retrying an ADMITTED operation never charges again", async () => {
  publishFailures = 1;
  await assert.rejects(ops.submitGeneration(NUTRITION()), (e: any) => e.statusCode === 503);
  await ops.submitGeneration(NUTRITION());
  await ops.submitGeneration(NUTRITION());
  assert.equal(counters.admit, 1);
});

test("16. keys are namespaced per verified actor; subject (PT on behalf of a client) is part of the identity", async () => {
  const a = await ops.submitGeneration(NUTRITION());
  const other = await ops.submitGeneration(NUTRITION({ actorUserId: "user-b", planCreate: { ...NUTRITION().planCreate, userId: "user-b" }, job: { ...NUTRITION().job, userId: "user-b" } }));
  assert.notEqual(a.operationId, other.operationId);
  const pt1 = await ops.submitGeneration({ ...NUTRITION({ idempotencyKey: "pt-key-12345", kind: "WORKOUT_PLAN" }), subjectUserId: "client-1" });
  await assert.rejects(ops.submitGeneration({ ...NUTRITION({ idempotencyKey: "pt-key-12345", kind: "WORKOUT_PLAN" }), subjectUserId: "client-2" }), (e: any) => e.code === "IDEMPOTENCY_KEY_CONFLICT");
  assert.equal(rowOf(pt1.operationId).actorUserId, "user-a");
  assert.equal(rowOf(pt1.operationId).subjectUserId, "client-1");
  // cross-user claim: a message re-labelled with another actor is refused
  const forged = { ...published[0].data, actorUserId: "user-b" };
  let ran = false;
  await ops.withGenerationOperation({ data: forged }, async () => { ran = true; });
  assert.equal(ran, false);
  assert.equal(rowOf(a.operationId).status, "PUBLISHED", "forged message did not claim");
});

// ── D22-R01: atomic fencing ────────────────────────────────────────────────

test("D22-R01a — barrier INSIDE the fenced write (after the ownership check, before the plan mutation): a competing claim cannot interleave; the stale-write window is closed", async () => {
  const { r, data } = await delivered();
  let enteredResolve!: () => void;
  const entered = new Promise<void>((res) => (enteredResolve = res));
  let release!: () => void;
  barrier.entered = enteredResolve;
  barrier.gate = new Promise<void>((res) => (release = res));
  barrier.armed = true;

  // Worker A: at its first plan write it passes the ownership check, then stalls before the mutation.
  const A = ops.withGenerationOperation({ data }, async () => { await repo.updateNutritionPlanStatus(r.planId, "PROCESSING"); });
  await entered;
  advance(11_000); // A's lease is now past its original expiry on the clock

  let bClaimed = false;
  const B = ops.withGenerationOperation({ data }, async () => {
    bClaimed = true;
    await complete(r.planId, "from-B");
  });
  await tick(); await tick();
  assert.equal(bClaimed, false, "B is serialized behind A's open fenced write (row lock); it cannot claim between A's check and A's write");

  release();
  await A;
  await B;
  assert.equal(bClaimed, true);
  assert.equal(plans.get(r.planId).plan, "from-B", "B's committed result is authoritative");
  assert.equal(plans.get(r.planId).status, "COMPLETED");
  assert.equal(rowOf(r.operationId).status, "COMPLETED");
});

test("D22-R01b — the exact Codex interleaving: A holds a stale claim, B takes over and completes, A resumes: A's plan write is refused and B's content survives", async () => {
  const { r, data } = await delivered();
  let releaseA!: () => void;
  const gateA = new Promise<void>((res) => (releaseA = res));
  let aWriteError: unknown = null;
  const A = ops.withGenerationOperation({ data }, async () => {
    await gateA; // A is paused somewhere before its plan mutation while its lease expires
    try { await complete(r.planId, "STALE-from-A"); } catch (e) { aWriteError = e; throw e; }
  });
  await tick();
  advance(11_000);
  await ops.withGenerationOperation({ data }, async () => { await complete(r.planId, "from-B"); });
  assert.equal(plans.get(r.planId).plan, "from-B");
  releaseA();
  await A; // StaleLeaseError is swallowed by the wrapper
  assert.ok(aWriteError instanceof lease.StaleLeaseError, "A's write was refused inside the fenced transaction");
  assert.equal(plans.get(r.planId).plan, "from-B", "B's committed content was not overwritten");
  assert.equal(plans.get(r.planId).status, "COMPLETED");
  assert.equal(rowOf(r.operationId).status, "COMPLETED");
  assert.equal(rowOf(r.operationId).attempt, 2);
});

test("D22-R01c — a stale worker cannot fail a newer attempt's plan or terminalize the operation (failure path is fenced too)", async () => {
  const { r, data } = await delivered();
  let releaseA!: () => void;
  const gateA = new Promise<void>((res) => (releaseA = res));
  const A = ops.withGenerationOperation({ data }, async () => {
    await gateA;
    await repo.updateNutritionPlanFailed(r.planId, "stale failure");
  });
  await tick();
  advance(11_000);
  await ops.withGenerationOperation({ data }, async () => { await complete(r.planId, "from-B"); });
  releaseA();
  await A;
  assert.equal(plans.get(r.planId).status, "COMPLETED");
  assert.equal(plans.get(r.planId).failReason, undefined);
  assert.equal(rowOf(r.operationId).status, "COMPLETED");
});

test("D22-R05d — crash after the plan completed but before the operation was finalized: redelivery finalizes WITHOUT a model call", async () => {
  const { r, data } = await delivered();
  const crash = new Error("process died");
  await assert.rejects(ops.withGenerationOperation({ data }, async () => { await complete(r.planId, "done"); throw crash; }), /process died/);
  assert.equal(plans.get(r.planId).status, "COMPLETED");
  let runs = 0;
  await ops.withGenerationOperation({ data }, async () => { runs++; counters.models++; });
  assert.equal(runs, 0);
  assert.equal(rowOf(r.operationId).status, "COMPLETED");
});

// ── D22-R02: execution incarnation ─────────────────────────────────────────

test("D22-R02 — FAILED old generation -> new charged execution -> delayed OLD message -> legitimate NEW message", async () => {
  const { r: r1, data: m1 } = await delivered();
  await ops.withGenerationOperation({ data: m1 }, async () => { await repo.updateNutritionPlanFailed(r1.planId, "boom"); });
  assert.equal(rowOf(r1.operationId).status, "FAILED");

  const r2 = await ops.submitGeneration(NUTRITION()); // same key: a NEW charged execution
  const m2 = published[published.length - 1].data;
  assert.equal(r2.operationId, r1.operationId);
  assert.equal(r2.epoch, 2);
  assert.notEqual(r2.planId, r1.planId);
  assert.equal(counters.admit, 2);

  let oldRan = false;
  await ops.withGenerationOperation({ data: m1 }, async () => { oldRan = true; await complete(r1.planId, "OLD"); });
  assert.equal(oldRan, false, "the delayed old message did not execute");
  assert.equal(rowOf(r2.operationId).status, "PUBLISHED", "the new execution was not claimed or terminalized by the old message");
  assert.equal(rowOf(r2.operationId).epoch, 2);
  assert.equal(plans.get(r2.planId).status, "QUEUED");
  assert.equal(counters.admit, 2, "no extra allowance consumed");

  let newRuns = 0;
  await ops.withGenerationOperation({ data: m2 }, async () => { newRuns++; await complete(r2.planId, "NEW"); });
  assert.equal(newRuns, 1);
  assert.equal(plans.get(r2.planId).plan, "NEW");
  assert.equal(rowOf(r2.operationId).status, "COMPLETED");
  // legitimate same-incarnation redelivery stays idempotent
  await ops.withGenerationOperation({ data: m2 }, async () => { newRuns++; });
  assert.equal(newRuns, 1);
  // and the old one is still refused after the new one finished
  await ops.withGenerationOperation({ data: m1 }, async () => { oldRan = true; });
  assert.equal(oldRan, false);
});

test("D22-R02 — a message whose actor, target or kind disagrees with the stored execution is refused", async () => {
  const { r, data } = await delivered();
  for (const bad of [{ actorUserId: "intruder" }, { planId: "someone-elses-plan" }, { kind: "WORKOUT_PLAN" }, { epoch: 7 }]) {
    let ran = false;
    await ops.withGenerationOperation({ data: { ...data, ...bad } }, async () => { ran = true; });
    assert.equal(ran, false, JSON.stringify(bad));
  }
  let ranIncomplete = false;
  await ops.withGenerationOperation({ data: { operationId: r.operationId } }, async () => { ranIncomplete = true; });
  assert.equal(ranIncomplete, false, "an operationId without a full binding is not trusted");
  assert.equal(rowOf(r.operationId).status, "PUBLISHED");
});

test("legacy messages (no operationId) bypass the claim; AI_GENERATION_REQUIRE_OPERATION=true is the post-drain cutoff", async () => {
  let runs = 0;
  await ops.withGenerationOperation({ data: { planId: "legacy" } }, async () => { runs++; });
  assert.equal(runs, 1);
  process.env.AI_GENERATION_REQUIRE_OPERATION = "true";
  try {
    await assert.rejects(ops.withGenerationOperation({ data: { planId: "legacy" } }, async () => { runs++; }), /rejected/);
    assert.equal(runs, 1);
  } finally { delete process.env.AI_GENERATION_REQUIRE_OPERATION; }
});

// ── D22-R03: published metadata ────────────────────────────────────────────

test("D22-R03a — publish OK + acknowledgment write fails: no new operation; the stable reference already resolves; replay re-sends the SAME binding", async () => {
  memory.hooks.failNextRecordPublish = true;
  const first = await ops.submitGeneration(NUTRITION());
  assert.equal(plans.get(first.planId).jobId, first.operationId, "pollable immediately");
  assert.equal(rowOf(first.operationId).status, "ADMITTED");
  const retry = await ops.submitGeneration(NUTRITION());
  assert.equal(retry.operationId, first.operationId);
  assert.equal(counters.admit, 1);
  assert.equal(published.length, 2);
  assert.deepEqual({ ...published[1].data, }, { ...published[0].data });
  let runs = 0;
  await ops.withGenerationOperation({ data: published[0].data }, async () => { runs++; await complete(first.planId); });
  await ops.withGenerationOperation({ data: published[1].data }, async () => { runs++; });
  assert.equal(runs, 1);
});

test("D22-R03b — the worker finishes BEFORE the publisher records the transport id: operation stays COMPLETED and the id is still stored", async () => {
  ops.generationOpsDeps.enqueue = async (name, data, opts) => {
    published.push({ name, data, opts });
    await ops.withGenerationOperation({ data }, async () => { await complete(String(data.planId), "fast"); });
    return { id: "msg-fast" };
  };
  const r = await ops.submitGeneration(NUTRITION());
  assert.equal(rowOf(r.operationId).status, "COMPLETED");
  assert.equal(rowOf(r.operationId).messageId, "msg-fast");
  assert.equal(rowOf(r.operationId).publishCount, 1);
  assert.equal(r.jobId, r.operationId);
});

test("D22-R03c — retry while PUBLISHED/COMPLETED repairs a missing Plan.jobId without publishing again", async () => {
  const r = await ops.submitGeneration(NUTRITION());
  delete plans.get(r.planId).jobId; // simulate a plan row lacking the reference
  const again = await ops.submitGeneration(NUTRITION());
  assert.equal(plans.get(again.planId).jobId, r.operationId);
  assert.equal(published.length, 1, "metadata repair never creates another paid job");
  assert.equal(counters.admit, 1);
  await ops.withGenerationOperation({ data: published[0].data }, async () => { await complete(r.planId); });
  delete plans.get(r.planId).jobId;
  await ops.submitGeneration(NUTRITION());
  assert.equal(plans.get(r.planId).jobId, r.operationId, "repaired for a COMPLETED operation too");
  assert.equal(published.length, 1);
});

test("D22-R03d — BullMQ publishes with a per-execution job id; transport id is never assumed to equal the operation id", async () => {
  const r = await ops.submitGeneration(NUTRITION());
  assert.equal(published[0].opts.jobId, ops.transportJobId(r.operationId, 1));
  assert.equal(rowOf(r.operationId).messageId, "msg-1");
  assert.notEqual(rowOf(r.operationId).messageId, r.operationId);
});

// ── Outbox recovery (V-T012.2) ─────────────────────────────────────────────

test("10. DB ok then publish failure is recoverable: same binding republished, one plan, no second charge", async () => {
  publishFailures = 1;
  await assert.rejects(ops.submitGeneration(NUTRITION()), (e: any) => e.statusCode === 503);
  const row = [...memory.rows.values()][0];
  assert.equal(row.status, "ADMITTED");
  assert.equal(plans.size, 1);
  const again = await ops.submitGeneration(NUTRITION());
  assert.equal(again.operationId, row.id);
  assert.equal(published.length, 1);
  assert.equal(published[0].data.operationId, row.id);
  assert.equal(plans.size, 1);
});

// ── Worker claim (V-T012.2) ────────────────────────────────────────────────

test("12. concurrent duplicate deliveries: only one invokes the model, the other is told to retry", async () => {
  const { data } = await delivered();
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  let runs = 0;
  const first = ops.withGenerationOperation({ data }, async () => { runs++; counters.models++; await gate; });
  await tick();
  await assert.rejects(ops.withGenerationOperation({ data }, async () => { runs++; counters.models++; }), ops.OperationInFlightError);
  release();
  await first;
  assert.equal(runs, 1);
});

test("14. redelivery of a COMPLETED execution is acknowledged without regenerating", async () => {
  const { r, data } = await delivered();
  let runs = 0;
  await ops.withGenerationOperation({ data }, async () => { runs++; await complete(r.planId); });
  await ops.withGenerationOperation({ data }, async () => { runs++; });
  await ops.withGenerationOperation({ data }, async () => { runs++; });
  assert.equal(runs, 1);
});

test("15. a repeatedly failing execution has bounded attempts, then FAILED with the plan marked FAILED", async () => {
  const { r, data } = await delivered();
  let runs = 0;
  const boom = async () => { runs++; throw new Error("transient model error"); };
  for (let i = 0; i < 3; i++) await assert.rejects(ops.withGenerationOperation({ data }, boom), /transient model error/);
  assert.equal(rowOf(r.operationId).status, "PUBLISHED");
  await ops.withGenerationOperation({ data }, boom);
  assert.equal(runs, 3);
  assert.equal(rowOf(r.operationId).status, "FAILED");
  assert.equal(plans.get(r.planId).status, "FAILED");
  assert.match(String(plans.get(r.planId).failReason), /max attempts/);
});

test("15b. a processor finishing with a FAILED plan marks the operation FAILED; the same key then reopens as a NEW charged epoch", async () => {
  const { r, data } = await delivered();
  await ops.withGenerationOperation({ data }, async () => { await repo.updateNutritionPlanFailed(r.planId, "bad"); });
  assert.equal(rowOf(r.operationId).status, "FAILED");
  const retry = await ops.submitGeneration(NUTRITION());
  assert.equal(retry.operationId, r.operationId);
  assert.equal(retry.epoch, 2);
  assert.notEqual(retry.planId, r.planId);
  assert.equal(counters.admit, 2);
  assert.equal(published.length, 2);
});

// ── D22-R05: reservation ownership & transition predicates ─────────────────

test("D22-R05a — a slow earlier reserver whose reservation was taken over cannot mark the successor's row admitted (no double execution)", async () => {
  let releaseA!: () => void;
  const gateA = new Promise<void>((res) => (releaseA = res));
  let firstCall = true;
  ops.generationOpsDeps.admit = async () => { counters.admit++; if (firstCall) { firstCall = false; await gateA; } };
  const A = ops.submitGeneration(NUTRITION());
  await tick();
  advance(61_000); // A's reservation is now stale
  const B = await ops.submitGeneration(NUTRITION()); // takes the reservation over, admits, publishes
  releaseA();
  const a = await A; // A lost: it must converge on B's execution, not create its own
  assert.equal(a.operationId, B.operationId);
  assert.equal(a.planId, B.planId);
  assert.equal(published.length, 1, "exactly one job");
  assert.equal(plans.size, 1, "exactly one plan");
  assert.equal(memory.rows.size, 1);
});

test("D22-R05b — a slow reserver refused by quota does not delete the successor's reservation", async () => {
  let releaseA!: () => void;
  const gateA = new Promise<void>((res) => (releaseA = res));
  let firstCall = true;
  ops.generationOpsDeps.admit = async () => { counters.admit++; if (firstCall) { firstCall = false; await gateA; throw new RateLimitedError("late refusal", 3); } };
  const A = ops.submitGeneration(NUTRITION());
  const Asettled = A.catch((e) => e);
  await tick();
  advance(61_000);
  const B = await ops.submitGeneration(NUTRITION());
  releaseA();
  assert.ok((await Asettled) instanceof RateLimitedError);
  assert.equal(memory.rows.size, 1, "B's row survived A's cleanup");
  assert.equal(rowOf(B.operationId).status, "PUBLISHED");
  assert.equal(published.length, 1);
});

// ── D22-R04 helper-level identity checks live in generation-admission.test.ts (real chat flow) ──

// ── Recovery runner ────────────────────────────────────────────────────────

test("recovery: stale RESERVING cleared; fresh ones untouched", async () => {
  const a = await memory.store.createReserving({ actorUserId: "u", subjectUserId: null, kind: "NUTRITION_PLAN", idempotencyKey: "k-1111111", fingerprint: "f", reservationToken: "t", now: clock });
  advance(30_000);
  assert.deepEqual(await ops.recoverPendingGenerations(), { reservationsCleared: 0, republished: 0, completedOrphans: 0, failed: 0, reconciled: 0, autoSaved: 0, errors: 0 });
  advance(10 * 60_000);
  const s = await ops.recoverPendingGenerations();
  assert.equal(s.reservationsCleared, 1);
  assert.equal(memory.rows.has(a.row.id), false);
});

test("recovery: ADMITTED unpublished is republished (same binding); PUBLISHED-but-plan-COMPLETED is finalized without a model call", async () => {
  publishFailures = 1;
  await assert.rejects(ops.submitGeneration(NUTRITION()), (e: any) => e.statusCode === 503);
  advance(120_000);
  const s1 = await ops.recoverPendingGenerations();
  assert.equal(s1.republished, 1);
  assert.equal(published.length, 1);
  // plan completed but the operation was never finalized and nothing else will touch it
  const id = published[0].data.operationId;
  plans.get(published[0].data.planId).status = "COMPLETED";
  advance(16 * 60_000);
  const s2 = await ops.recoverPendingGenerations();
  assert.equal(s2.completedOrphans, 1);
  assert.equal(rowOf(id).status, "COMPLETED");
  assert.equal(counters.models, 0);
});

test("recovery: a lost message is republished a bounded number of times, then the execution and plan are FAILED (observable)", async () => {
  const r = await ops.submitGeneration(NUTRITION());
  assert.equal(published.length, 1);
  for (let i = 0; i < 5; i++) { advance(16 * 60_000); await ops.recoverPendingGenerations(); }
  assert.equal(published.length, 3, "initial + 2 republishes = maxPublishes(3), never more");
  assert.equal(rowOf(r.operationId).status, "FAILED");
  assert.equal(plans.get(r.planId).status, "FAILED");
});

test("recovery: RUNNING with an expired lease and an incomplete plan is republished, and the claim then bounds the retries", async () => {
  const { r, data } = await delivered();
  const t = await memory.store.claim({ operationId: r.operationId, epoch: 1, planId: r.planId, kind: "NUTRITION_PLAN", actorUserId: "user-a" }, "dead-worker", 10_000, 3, clock);
  assert.equal(t.kind, "CLAIMED");
  advance(11_000);
  const s = await ops.recoverPendingGenerations();
  assert.equal(s.republished, 1);
  assert.equal(published.length, 2);
  let runs = 0;
  await ops.withGenerationOperation({ data }, async () => { runs++; await complete(r.planId); });
  assert.equal(runs, 1);
  assert.equal(rowOf(r.operationId).status, "COMPLETED");
});

test("recovery: two concurrent runners cannot multiply work beyond the claim (idempotent)", async () => {
  publishFailures = 1;
  await assert.rejects(ops.submitGeneration(NUTRITION()), (e: any) => e.statusCode === 503);
  advance(120_000);
  await Promise.all([ops.recoverPendingGenerations(), ops.recoverPendingGenerations()]);
  let runs = 0;
  await Promise.allSettled(published.map(({ data }) => ops.withGenerationOperation({ data }, async () => { runs++; await complete(data.planId); })));
  assert.equal(runs, 1);
  assert.equal(counters.admit, 1);
});

// ── Negative controls: the assertions DO fail against deliberately broken stores ──

test("negative control A — a store ignoring existing keys duplicates operations/jobs/charges", async () => {
  const real = memory.store.createReserving;
  memory.store.createReserving = async (i) => real({ ...i, idempotencyKey: i.idempotencyKey + Math.random() });
  await ops.submitGeneration(NUTRITION());
  await ops.submitGeneration(NUTRITION());
  assert.equal(published.length, 2);
  assert.equal(counters.admit, 2);
});

test("negative control B — an always-succeeding claim lets duplicate deliveries both run the model", async () => {
  const { data } = await delivered();
  const realClaim = memory.store.claim;
  memory.store.claim = async (b, token, l, m, now) => { const r = await realClaim(b, token, l, m, now); return r.kind === "IN_FLIGHT" ? { kind: "CLAIMED", row: r.row } : r; };
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  const first = ops.withGenerationOperation({ data }, async () => { runs++; await gate; });
  await tick();
  const second = ops.withGenerationOperation({ data }, async () => { runs++; });
  release();
  await Promise.all([first, second]);
  assert.equal(runs, 2);
});

test("negative control C — a claim that ignores epoch/target lets the delayed OLD message execute against the reopened execution", async () => {
  const { r: r1, data: m1 } = await delivered();
  await ops.withGenerationOperation({ data: m1 }, async () => { await repo.updateNutritionPlanFailed(r1.planId, "boom"); });
  await ops.submitGeneration(NUTRITION()); // epoch 2, new target
  const realClaim = memory.store.claim;
  memory.store.claim = async (b, token, l, m, now) => {
    const cur = rowOf(b.operationId);
    return realClaim({ ...b, epoch: cur.epoch, planId: cur.targetId! }, token, l, m, now); // epoch/target not validated
  };
  let ran = false;
  await ops.withGenerationOperation({ data: m1 }, async () => { ran = true; });
  assert.equal(ran, true, "without incarnation validation the old message claims and runs the NEW execution");
  assert.equal(rowOf(r1.operationId).epoch, 2);
});

test("negative control D — an UNFENCED plan write by a stale attempt overwrites the newer result (what the transaction prevents)", async () => {
  const { r, data } = await delivered();
  let releaseA!: () => void;
  const gateA = new Promise<void>((res) => (releaseA = res));
  const A = ops.withGenerationOperation({ data }, async () => {
    await gateA;
    plans.get(r.planId).plan = "STALE-from-A"; // direct write, bypassing runFenced
  });
  await tick();
  advance(11_000);
  await ops.withGenerationOperation({ data }, async () => { await complete(r.planId, "from-B"); });
  releaseA();
  await A;
  assert.equal(plans.get(r.planId).plan, "STALE-from-A", "without runFenced the stale write wins");
});

test("20. no real model was invoked anywhere in this suite", async () => {
  const { llmService } = await import("../services/llm.service");
  let called = 0;
  const original = llmService.callLLM;
  (llmService as any).callLLM = async () => { called++; throw new Error("TRIPWIRE"); };
  try {
    const { r, data } = await delivered();
    await ops.withGenerationOperation({ data }, async () => { await complete(r.planId); });
  } finally {
    (llmService as any).callLLM = original;
  }
  assert.equal(called, 0);
  assert.equal(counters.models, 0);
});

// ═══ V-T012.2.2 ═══════════════════════════════════════════════════════════

// ── RR-03: BullMQ transport id, validated by the ACTUAL installed BullMQ ────

test("RR-03 — the transport job id is accepted by the installed BullMQ validator; the old 'operationId:epoch' form is rejected (original defect)", async () => {
  const { Job } = await import("bullmq");
  const validate = (jobId: string) => (Job.prototype as any).validateOptions.call({ opts: { jobId } }, {});
  const r = await ops.submitGeneration(NUTRITION());
  const id = ops.transportJobId(r.operationId, r.epoch);
  assert.doesNotThrow(() => validate(id), "installed BullMQ accepts the generated id");
  assert.equal(published[0].opts.jobId, id, "this is exactly what the publisher sent");
  assert.throws(() => validate(`${r.operationId}:${r.epoch}`), /Custom Id cannot contain :/, "regression of the original RR-03 defect");
});

test("RR-03 — transport id is stable across retries, distinct per epoch, and collision-free for UUID operation ids", async () => {
  const a = ops.submitGeneration(NUTRITION());
  const first = await a;
  const again = await ops.submitGeneration(NUTRITION());
  assert.equal(ops.transportJobId(first.operationId, first.epoch), ops.transportJobId(again.operationId, again.epoch));
  assert.notEqual(ops.transportJobId(first.operationId, 1), ops.transportJobId(first.operationId, 2));
  const u1 = "11111111-1111-4111-8111-111111111111", u2 = "11111111-1111-4111-8111-111111111112";
  assert.notEqual(ops.transportJobId(u1, 12), ops.transportJobId(u2, 1));
  const { Job } = await import("bullmq");
  for (const e of [1, 2, 10, 99]) assert.doesNotThrow(() => (Job.prototype as any).validateOptions.call({ opts: { jobId: ops.transportJobId(u1, e) } }, {}));
  assert.notEqual(`${parseInt(ops.transportJobId(u1, 1), 10)}`, ops.transportJobId(u1, 1), "never a pure integer (BullMQ rejects those too)");
});

test("RR-03 — the queue adapter forwards the id to BullMQ unchanged, and the SQS path ignores it", async () => {
  const qp = await import("../workers/queue-provider");
  const calls: any[] = [];
  const realAdd = qp.bullmqPublishDeps.add;
  qp.bullmqPublishDeps.add = (async (name: string, data: any, o?: any) => { calls.push({ name, data, o }); return { id: o?.jobId ?? "x" }; }) as any;
  const prevProvider = process.env.QUEUE_PROVIDER;
  try {
    delete process.env.QUEUE_PROVIDER;
    const id = ops.transportJobId("11111111-1111-4111-8111-111111111111", 3);
    const res = await qp.enqueueAiTask("generate-plan", { a: 1 }, { jobId: id });
    assert.deepEqual(calls[0].o, { jobId: id });
    assert.equal(res.id, id);
    process.env.QUEUE_PROVIDER = "sqs";
    process.env.AI_TASKS_QUEUE_URL = "https://sqs.invalid/q";
    let body: any;
    (qp.sqsDeps as any).sendMessage = async (c: any) => { body = JSON.parse(c.input.MessageBody); return { MessageId: "m" }; };
    await qp.enqueueAiTask("generate-plan", { a: 1 }, { jobId: id });
    assert.equal(calls.length, 1, "SQS path did not touch BullMQ");
    assert.ok(!JSON.stringify(body).includes(id), "transport job id is not part of the SQS message");
  } finally {
    qp.bullmqPublishDeps.add = realAdd;
    if (prevProvider === undefined) delete process.env.QUEUE_PROVIDER; else process.env.QUEUE_PROVIDER = prevProvider;
  }
});

// ── RR-02: atomic terminal transition & reconciliation (workout + nutrition) ─

for (const kind of ["NUTRITION_PLAN", "WORKOUT_PLAN"] as const) {
  const make = (over: Record<string, unknown> = {}) => NUTRITION({ kind, idempotencyKey: `rr02-${kind}-12345`, ...over });
  const strand = async () => {
    const r = await ops.submitGeneration(make());
    advance(16 * 60_000);
    return r;
  };

  test(`RR-02 [${kind}] — exact sequence: publication limit reached, plan update fails -> operation is NOT left terminal; the next run completes the repair`, async () => {
    const r = await ops.submitGeneration(make());
    // exhaust the publication budget
    for (let i = 0; i < 2; i++) { advance(16 * 60_000); await ops.recoverPendingGenerations(); }
    assert.equal(published.length, 3);
    advance(16 * 60_000);
    inject.failPlanUpdates = 1; // the plan update inside the terminal transition throws
    const s1 = await ops.recoverPendingGenerations();
    assert.equal(s1.errors >= 1, true, "failure surfaced, not swallowed");
    assert.equal(rowOf(r.operationId).status, "PUBLISHED", "operation rolled back with the failed plan write: still recoverable");
    assert.equal(plans.get(r.planId).status, "QUEUED");
    const s2 = await ops.recoverPendingGenerations();
    assert.equal(s2.failed, 1);
    assert.equal(rowOf(r.operationId).status, "FAILED");
    assert.equal(plans.get(r.planId).status, "FAILED", "plan and operation reached the same terminal outcome");
    const s3 = await ops.recoverPendingGenerations();
    assert.equal(s3.failed + s3.completedOrphans + s3.republished + s3.reconciled, 0, "repeat run is idempotent");
  });

  test(`RR-02 [${kind}] — a genuinely COMPLETED plan is never failed by a late recovery; the operation settles COMPLETED`, async () => {
    const r = await strand();
    plans.get(r.planId).status = "COMPLETED";
    plans.get(r.planId).plan = "real-content";
    const out = await ops.generationOpsDeps.store.settleStranded(r.operationId, r.epoch, "recovery exhausted", clock);
    assert.equal(out, "COMPLETED");
    assert.equal(plans.get(r.planId).status, "COMPLETED");
    assert.equal(plans.get(r.planId).plan, "real-content");
  });

  test(`RR-02 [${kind}] — an old epoch cannot settle or modify the newer execution's plan`, async () => {
    const r1 = await ops.submitGeneration(make());
    const m1 = published[0].data;
    await ops.withGenerationOperation({ data: m1 }, async () => { await (kind === "NUTRITION_PLAN" ? repo.updateNutritionPlanFailed(r1.planId, "x") : repo.updateNutritionPlanFailed(r1.planId, "x")); });
    const r2 = await ops.submitGeneration(make());
    advance(16 * 60_000);
    assert.equal(await ops.generationOpsDeps.store.settleStranded(r1.operationId, 1, "stale epoch", clock), null, "epoch 1 is not eligible: the row is on epoch 2");
    assert.equal(plans.get(r2.planId).status, "QUEUED", "the new execution's plan was not touched");
    assert.equal(rowOf(r2.operationId).status, "PUBLISHED");
  });

  test(`RR-02 [${kind}] — concurrent recovery runners produce exactly one terminal outcome`, async () => {
    const r = await ops.submitGeneration(make());
    for (let i = 0; i < 2; i++) { advance(16 * 60_000); await ops.recoverPendingGenerations(); }
    advance(16 * 60_000);
    const [a, b] = await Promise.all([ops.recoverPendingGenerations(), ops.recoverPendingGenerations()]);
    assert.equal(a.failed + b.failed, 1);
    assert.equal(rowOf(r.operationId).status, "FAILED");
    assert.equal(plans.get(r.planId).status, "FAILED");
  });

  test(`RR-02 [${kind}] — missing plan and unexpected row counts give an explicit, safe result`, async () => {
    const r = await strand();
    inject.zeroRowPlanUpdates = 1;
    await assert.rejects(ops.generationOpsDeps.store.settleStranded(r.operationId, r.epoch, "x", clock), /affected 0 rows/);
    assert.equal(rowOf(r.operationId).status, "PUBLISHED", "unexpected count rolled the transition back");
    plans.delete(r.planId);
    assert.equal(await ops.generationOpsDeps.store.settleStranded(r.operationId, r.epoch, "x", clock), "FAILED");
    assert.equal(rowOf(r.operationId).lastError, "target plan missing");
  });

  test(`RR-02 [${kind}] — legacy/previously inconsistent terminal rows (operation FAILED, plan active) are reconciled once, boundedly`, async () => {
    const r = await ops.submitGeneration(make());
    Object.assign(rowOf(r.operationId), { status: "FAILED", lastError: "recovery exhausted" }); // a past partial write
    assert.equal(plans.get(r.planId).status, "QUEUED");
    inject.failPlanUpdates = 1;
    const s0 = await ops.recoverPendingGenerations();
    assert.equal(s0.reconciled, 0);
    assert.ok(s0.errors >= 1, "a failing repair is reported and retried, not hidden");
    const s1 = await ops.recoverPendingGenerations();
    assert.equal(s1.reconciled, 1);
    assert.equal(plans.get(r.planId).status, "FAILED");
    assert.equal(plans.get(r.planId).failReason, "recovery exhausted");
    const s2 = await ops.recoverPendingGenerations();
    assert.equal(s2.reconciled, 0, "a repaired row never matches again");
  });

  test(`RR-02 [${kind}] — claim exhaustion settles operation and plan together; an injected plan failure leaves it retryable on redelivery`, async () => {
    const { r, data } = await (async () => { const x = await ops.submitGeneration(make()); return { r: x, data: published[published.length - 1].data }; })();
    const boom = async () => { throw new Error("transient"); };
    for (let i = 0; i < 3; i++) await assert.rejects(ops.withGenerationOperation({ data }, boom));
    inject.failPlanUpdates = 1;
    await assert.rejects(ops.withGenerationOperation({ data }, boom), /injected plan update failure/);
    assert.equal(rowOf(r.operationId).status, "PUBLISHED", "not terminalized without its plan");
    await ops.withGenerationOperation({ data }, boom); // redelivery
    assert.equal(rowOf(r.operationId).status, "FAILED");
    assert.equal(plans.get(r.planId).status, "FAILED");
  });
}

test("RR-02 negative control — the old order (operation FAILED first, plan update after) strands a QUEUED plan behind a terminal row", async () => {
  const r = await ops.submitGeneration(NUTRITION());
  const row = rowOf(r.operationId);
  row.status = "FAILED"; // step 1 of the old, non-atomic sequence
  inject.failPlanUpdates = 1;
  await assert.rejects(facade.nutritionPlan.updateMany({ where: { id: r.planId }, data: { status: "FAILED" } }), /injected/); // step 2 fails
  assert.equal(rowOf(r.operationId).status, "FAILED");
  assert.equal(plans.get(r.planId).status, "QUEUED", "stranded: this is the defect the atomic settle prevents");
});

// ── publication budget is atomic ────────────────────────────────────────────

test("publication bound — concurrent claims on the same observed count: exactly one winner per increment, across runners", async () => {
  const r = await ops.submitGeneration(NUTRITION());
  assert.equal(rowOf(r.operationId).publishCount, 1, "the initial publish was claimed durably");
  const wave1 = await Promise.all(Array.from({ length: 10 }, () => memory.store.claimPublish(r.operationId, 1, 1, 3, clock)));
  assert.equal(wave1.filter(Boolean).length, 1);
  const wave2 = await Promise.all(Array.from({ length: 10 }, () => memory.store.claimPublish(r.operationId, 1, 2, 3, clock)));
  assert.equal(wave2.filter(Boolean).length, 1);
  assert.equal(await memory.store.claimPublish(r.operationId, 1, 3, 3, clock), false, "budget exhausted");
  assert.equal(await memory.store.claimPublish(r.operationId, 2, 3, 9, clock), false, "a stale epoch cannot claim");
  published.length = 0;
  advance(16 * 60_000);
  await Promise.all([ops.recoverPendingGenerations(), ops.recoverPendingGenerations(), ops.recoverPendingGenerations()]);
  assert.equal(published.length, 0, "no further message once the budget is exhausted");
  assert.equal(rowOf(r.operationId).status, "FAILED", "exhausted: settled FAILED together with its plan");
  assert.equal(plans.get(r.planId).status, "FAILED");
});

// ── fence target assertion & lease predicate ────────────────────────────────

test("fence — a worker cannot mutate a plan that is not its execution's target, and finish needs an unexpired lease", async () => {
  const mine = await ops.submitGeneration(NUTRITION());
  const other = await ops.submitGeneration(NUTRITION({ idempotencyKey: "other-key-1234" }));
  const data = published[0].data;
  await ops.withGenerationOperation({ data }, async () => { await repo.updateNutritionPlanStatus(other.planId, "FAILED"); });
  assert.equal(plans.get(other.planId).status, "QUEUED", "wrong-target write refused inside the transaction");
  assert.notEqual(rowOf(mine.operationId).status, "COMPLETED");
  // finish after expiry is refused
  const c = await memory.store.claim({ operationId: other.operationId, epoch: 1, planId: other.planId, kind: "NUTRITION_PLAN", actorUserId: "user-a" }, "tok", 1000, 3, clock);
  assert.equal(c.kind, "CLAIMED");
  advance(5000);
  assert.equal(await memory.store.finish({ operationId: other.operationId, epoch: 1, token: "tok", targetId: other.planId }, "COMPLETED", null, clock), false);
});

// ── polling is deterministic across epochs ──────────────────────────────────

test("status polling — job lookup returns the NEWEST plan when a reopened operation left two plans sharing the reference", async () => {
  const { conversationRepository, prisma } = await import("../repositories/conversation.repository");
  let captured: any;
  const realW = (prisma as any).workoutPlan.findFirst, realN = (prisma as any).nutritionPlan.findFirst;
  (prisma as any).workoutPlan.findFirst = async (a: any) => { captured = a; return null; };
  (prisma as any).nutritionPlan.findFirst = async (a: any) => { captured = { ...a, nutrition: true }; return null; };
  try {
    await conversationRepository.findPlanByJobId("op-1");
    assert.deepEqual(captured.orderBy, { createdAt: "desc" });
    await conversationRepository.findNutritionPlanByJobId("op-1");
    assert.deepEqual(captured.orderBy, { createdAt: "desc" });
    assert.equal(captured.nutrition, true);
  } finally {
    (prisma as any).workoutPlan.findFirst = realW;
    (prisma as any).nutritionPlan.findFirst = realN;
  }
});

// ═══ Release-blocker correction: R222-01 / R222-05 ═══════════════════════════

// ── R222-01: immutable idempotency binding in every state ───────────────────

const failedOperation = async (over: Record<string, unknown> = {}) => {
  const r = await ops.submitGeneration(NUTRITION(over));
  const data = published[published.length - 1].data;
  await ops.withGenerationOperation({ data }, async () => { await repo.updateNutritionPlanFailed(r.planId, "boom"); });
  assert.equal(rowOf(r.operationId).status, "FAILED");
  return r;
};

test("R222-01 — Codex's counterexample: FAILED + same key + DIFFERENT payload is rejected 409; nothing is reopened, charged or published", async () => {
  const r = await failedOperation();
  const admitBefore = counters.admit, pubBefore = published.length;
  await assert.rejects(
    ops.submitGeneration(NUTRITION({ job: { userId: "user-a", goal: "BULK", durationWeeks: 1, mealsPerDay: 3 } })),
    (e: any) => e.statusCode === 409 && e.code === "IDEMPOTENCY_KEY_CONFLICT",
  );
  assert.equal(rowOf(r.operationId).status, "FAILED");
  assert.equal(rowOf(r.operationId).epoch, 1, "epoch unchanged: not reopened");
  assert.equal(rowOf(r.operationId).fingerprint, ops.fingerprintOf({ kind: "NUTRITION_PLAN", subject: null, planCreate: NUTRITION().planCreate, job: NUTRITION().job }), "the original binding was not rewritten");
  assert.equal(counters.admit, admitBefore);
  assert.equal(published.length, pubBefore);
});

test("R222-01 — FAILED + same key + different kind or different subject is rejected (binding immutable across reopen)", async () => {
  const r = await failedOperation();
  await assert.rejects(ops.submitGeneration(NUTRITION({ kind: "WORKOUT_PLAN" })), (e: any) => e.code === "IDEMPOTENCY_KEY_CONFLICT");
  await assert.rejects(ops.submitGeneration({ ...NUTRITION(), subjectUserId: "some-client" }), (e: any) => e.code === "IDEMPOTENCY_KEY_CONFLICT");
  assert.equal(rowOf(r.operationId).kind, "NUTRITION_PLAN");
  assert.equal(rowOf(r.operationId).subjectUserId, null);
  assert.equal(rowOf(r.operationId).epoch, 1);
});

test("R222-01 — FAILED + same key + SAME payload follows the documented paid re-execution policy (new epoch, new target, charged; not exactly-once billing)", async () => {
  const r = await failedOperation();
  const again = await ops.submitGeneration(NUTRITION());
  assert.equal(again.operationId, r.operationId);
  assert.equal(again.epoch, 2);
  assert.notEqual(again.planId, r.planId);
  assert.equal(counters.admit, 2);
  assert.equal(rowOf(r.operationId).kind, "NUTRITION_PLAN");
});

test("R222-01 — a new intentional request with changed payload under a NEW key is admitted normally; another actor cannot touch the first actor's FAILED key", async () => {
  const r = await failedOperation();
  const fresh = await ops.submitGeneration(NUTRITION({ idempotencyKey: "brand-new-key-1", job: { userId: "user-a", goal: "BULK", durationWeeks: 1, mealsPerDay: 3 } }));
  assert.notEqual(fresh.operationId, r.operationId);
  const other = await ops.submitGeneration(NUTRITION({ actorUserId: "user-b", planCreate: { ...NUTRITION().planCreate, userId: "user-b" }, job: { ...NUTRITION().job, userId: "user-b" } }));
  assert.notEqual(other.operationId, r.operationId);
  assert.equal(rowOf(r.operationId).actorUserId, "user-a");
  assert.equal(rowOf(r.operationId).status, "FAILED", "unchanged by the other actor");
});

test("R222-01 negative control — the old rule (conflict ignored while FAILED) silently rewrites the binding", async () => {
  const r = await failedOperation();
  const real = memory.store.reopenFailed;
  // emulate the previous behaviour: a conflicting payload is allowed to reopen under the SAME key
  const reopened = await real(r.operationId, "tok", "a-different-fingerprint", clock);
  assert.equal(reopened!.fingerprint, "a-different-fingerprint", "this is the rewrite the immutable check now prevents before reopen is reached");
});

// ── R222-05: one durable publication budget for every state ─────────────────

test("R222-05 — Codex's counterexample: five failing ADMITTED retries publish at most 3 times, then the execution is settled FAILED with its plan", async () => {
  publishFailures = 99;
  const results: any[] = [];
  for (let i = 0; i < 4; i++) results.push(await ops.submitGeneration(NUTRITION()).catch((e) => e));
  assert.ok(results.every((r) => r.statusCode === 503));
  assert.equal(enqueueAttempts, 3, "only 3 external publish attempts although 4 requests were made");
  const row = [...memory.rows.values()][0];
  assert.equal(row.publishCount, 3);
  assert.equal(row.status, "FAILED");
  assert.equal(plans.get(row.targetId!).status, "FAILED");
  // the same request afterwards is the documented new charged execution (epoch 2), not a silent publication loop
  publishFailures = 0;
  const reopened = await ops.submitGeneration(NUTRITION());
  assert.equal(reopened.epoch, 2);
  assert.equal(enqueueAttempts, 4);
});

test("R222-05 — bounded exponential backoff: a retry inside the window is refused without claiming budget; after the window it proceeds", async () => {
  ops.generationOpsDeps.publishBackoffMs = (n) => (n <= 0 ? 0 : 5_000 * 2 ** (n - 1));
  publishFailures = 1;
  await assert.rejects(ops.submitGeneration(NUTRITION()), (e: any) => e.statusCode === 503);
  assert.equal(enqueueAttempts, 1);
  await assert.rejects(ops.submitGeneration(NUTRITION()), (e: any) => e.statusCode === 503);
  assert.equal(enqueueAttempts, 1, "no attempt and no budget used inside the backoff window");
  assert.equal([...memory.rows.values()][0].publishCount, 1);
  advance(6_000);
  await ops.submitGeneration(NUTRITION());
  assert.equal(enqueueAttempts, 2);
});

test("R222-05 — ambiguous enqueue (provider accepted, caller saw an error) is NOT refunded and cannot be republished beyond the budget", async () => {
  const d = ops.generationOpsDeps;
  d.enqueue = async (name, data, opts) => { enqueueAttempts++; published.push({ name, data, opts }); throw new Error("timeout after the broker accepted the message"); };
  for (let i = 0; i < 4; i++) await ops.submitGeneration(NUTRITION()).catch(() => undefined);
  assert.equal(enqueueAttempts, 3);
  assert.equal(published.length, 3, "at most 3 (possibly duplicate) messages, all with the same binding");
  assert.equal(new Set(published.map((m) => JSON.stringify(m.data))).size, 1);
});

test("R222-05 — enqueue success followed by an acknowledgment failure still consumed exactly one budget unit", async () => {
  memory.hooks.failNextRecordPublish = true;
  const r = await ops.submitGeneration(NUTRITION());
  assert.equal(rowOf(r.operationId).publishCount, 1);
  assert.equal(rowOf(r.operationId).status, "ADMITTED");
});

test("R222-05 — crash after the budget was claimed (before the send): the unit stays spent, the row stays recoverable, retries remain bounded", async () => {
  // the first process claims the budget and dies before enqueueing
  const r0 = await memory.store.createReserving({ actorUserId: "user-a", subjectUserId: null, kind: "NUTRITION_PLAN", idempotencyKey: "key-12345678", fingerprint: ops.fingerprintOf({ kind: "NUTRITION_PLAN", subject: null, planCreate: NUTRITION().planCreate, job: NUTRITION().job }), reservationToken: "t0", now: clock });
  await memory.store.markAdmitted(r0.row.id, 1, "t0", { targetType: "NUTRITION_PLAN", targetId: "plan-crash", payload: { planCreate: NUTRITION().planCreate, job: NUTRITION().job } }, clock);
  assert.equal(await memory.store.claimPublish(r0.row.id, 1, 0, 3, clock), true);
  assert.equal(rowOf(r0.row.id).publishCount, 1);
  advance(120_000);
  const s = await ops.recoverPendingGenerations();
  assert.equal(s.republished, 1);
  assert.equal(rowOf(r0.row.id).publishCount, 2, "the recovered attempt used the NEXT unit");
});

test("R222-05 — concurrent recovery runners over an ADMITTED row cannot oversubscribe the budget", async () => {
  publishFailures = 1;
  await assert.rejects(ops.submitGeneration(NUTRITION()), (e: any) => e.statusCode === 503);
  advance(120_000);
  const before = enqueueAttempts;
  await Promise.all(Array.from({ length: 6 }, () => ops.recoverPendingGenerations()));
  assert.equal(enqueueAttempts - before, 1, "exactly one runner won the claim and published");
  assert.ok([...memory.rows.values()][0].publishCount <= 3);
});

test("R222-05 — recovery after the plan already completed never publishes: it finalizes the operation", async () => {
  const r = await ops.submitGeneration(NUTRITION());
  assert.equal(published.length, 1);
  plans.get(r.planId).status = "COMPLETED";
  advance(16 * 60_000);
  const s = await ops.recoverPendingGenerations();
  assert.equal(s.completedOrphans, 1);
  assert.equal(published.length, 1, "no additional publication");
  assert.equal(rowOf(r.operationId).status, "COMPLETED");
});

test("R222-05 — legitimate recovery before the budget is exhausted still republishes the SAME binding", async () => {
  publishFailures = 1;
  await assert.rejects(ops.submitGeneration(NUTRITION()), (e: any) => e.statusCode === 503);
  advance(120_000);
  const s = await ops.recoverPendingGenerations();
  assert.equal(s.republished, 1);
  assert.equal(published.length, 1);
  const row = [...memory.rows.values()][0];
  assert.equal(published[0].data.operationId, row.id);
  assert.equal(published[0].data.epoch, 1);
});

test("R222-05 — a stale epoch cannot spend the new execution's budget", async () => {
  const r1 = await failedOperation();
  const r2 = await ops.submitGeneration(NUTRITION());
  assert.equal(r2.epoch, 2);
  assert.equal(await memory.store.claimPublish(r1.operationId, 1, rowOf(r1.operationId).publishCount, 3, clock), false);
  assert.equal(rowOf(r1.operationId).publishCount, 1, "epoch 2's count (reset to 0 then 1 by its own initial publish) is untouched by epoch 1");
});

// ── R222-06: canonical, epoch-aware, nutrition-aware job status ─────────────

const callStatus = async (userId: string, jobId: string) => {
  const { planController } = await import("../controllers/plan.controller");
  const out: { status: number; body: any } = { status: 200, body: null }; // Express default when res.status() is never called
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: any) { out.body = b; return res; } };
  let nextErr: unknown;
  await (planController as any).getJobStatus({ context: { userId }, params: { jobId } }, res, (e: unknown) => { nextErr = e; });
  if (nextErr) throw nextErr;
  return out;
};

for (const kind of ["NUTRITION_PLAN", "WORKOUT_PLAN"] as const) {
  test(`R222-06 [${kind}] — generic /plans/job/:jobId reports QUEUED / PROCESSING / COMPLETED / FAILED from the canonical operation (SQS mode, no BullMQ)`, async () => {
    process.env.QUEUE_PROVIDER = "sqs";
    ops.jobStatusDeps.bullState = async () => { throw new Error("BullMQ must not be touched in SQS mode"); };
    try {
      const r = await ops.submitGeneration(NUTRITION({ kind }));
      const q = await callStatus("user-a", r.jobId);
      assert.equal(q.status, 200, "this was a 404 for nutrition before");
      assert.equal(q.body.data.status, "QUEUED");
      assert.equal(q.body.data.planId, r.planId);
      assert.equal(q.body.data.kind, kind);
      plans.get(r.planId).status = "PROCESSING";
      assert.equal((await callStatus("user-a", r.jobId)).body.data.status, "PROCESSING");
      plans.get(r.planId).status = "COMPLETED"; plans.get(r.planId).plan = { ok: true };
      const done = await callStatus("user-a", r.jobId);
      assert.equal(done.body.data.status, "COMPLETED");
      assert.deepEqual(done.body.data.plan, { ok: true });
      plans.get(r.planId).status = "FAILED"; plans.get(r.planId).failReason = "boom"; plans.get(r.planId).plan = undefined;
      const failed = await callStatus("user-a", r.jobId);
      assert.equal(failed.body.data.status, "FAILED");
      assert.equal(failed.body.data.failReason, "boom");
      assert.equal(failed.body.data.plan, null);
    } finally { delete process.env.QUEUE_PROVIDER; }
  });
}

test("R222-06 — after a reopen the reference resolves to the CURRENT epoch's target, by authoritative link (not by timestamps)", async () => {
  const r1 = await failedOperation();
  const old = plans.get(r1.planId);
  const r2 = await ops.submitGeneration(NUTRITION());
  assert.equal(r2.jobId, r1.jobId);
  plans.get(r2.planId).status = "PROCESSING";
  old.createdAt = new Date(clock.getTime() + 10 * 3600_000); // the OLD plan even looks newer: a timestamp rule would pick it
  const s = await ops.describeOperationJob("user-a", r2.jobId);
  assert.equal(s.kind, "OK");
  assert.equal((s as any).body.planId, r2.planId);
  assert.equal((s as any).body.epoch, 2);
  assert.equal((s as any).body.status, "PROCESSING");
});

test("R222-06 — BullMQ enrichment looks up the deterministic transport id (operationId + epoch), never the operation id", async () => {
  delete process.env.QUEUE_PROVIDER;
  const r = await ops.submitGeneration(NUTRITION());
  const asked: string[] = [];
  ops.jobStatusDeps.bullState = async (id) => { asked.push(id); return { state: "failed", failedReason: "bull says no" }; };
  const s = await ops.describeOperationJob("user-a", r.jobId);
  assert.deepEqual(asked, [ops.transportJobId(r.operationId, r.epoch)]);
  assert.equal((s as any).body.status, "FAILED");
  assert.equal((s as any).body.failReason, "bull says no");
});

test("R222-06 — another user's reference is denied; PT/ownership behaviour is the pre-existing owner-only rule", async () => {
  const r = await ops.submitGeneration(NUTRITION());
  assert.equal((await ops.describeOperationJob("someone-else", r.jobId)).kind, "FORBIDDEN");
  const viaController = await callStatus("someone-else", r.jobId);
  assert.equal(viaController.status, 403);
  assert.equal(viaController.body.error.code, "FORBIDDEN");
});

test("R222-06 — inconsistent or missing state is reported truthfully", async () => {
  const r = await ops.submitGeneration(NUTRITION());
  Object.assign(rowOf(r.operationId), { status: "FAILED", lastError: "recovery exhausted" });
  const inconsistent = await ops.describeOperationJob("user-a", r.jobId);
  assert.equal((inconsistent as any).body.status, "FAILED", "operation FAILED beats a plan row still reading QUEUED");
  assert.equal((inconsistent as any).body.failReason, "recovery exhausted");
  plans.delete(r.planId);
  const missing = await ops.describeOperationJob("user-a", r.jobId);
  assert.equal((missing as any).body.failReason, "plan record missing");
});

test("R222-06 — legacy polling (ids that are not operations) is unchanged: NOT_OPERATION falls through to the Plan.jobId path; unknown ids stay 404", async () => {
  assert.equal((await ops.describeOperationJob("user-a", "legacy-bull-job-1")).kind, "NOT_OPERATION");
  const { conversationRepository } = await import("../repositories/conversation.repository");
  const real = (conversationRepository as any).findPlanByJobId;
  (conversationRepository as any).findPlanByJobId = async (id: string) => (id === "legacy-bull-job-1" ? { id: "p-legacy", userId: "user-a", status: "COMPLETED", plan: { legacy: true }, createdAt: clock, updatedAt: clock } : null);
  process.env.QUEUE_PROVIDER = "sqs";
  try {
    const legacy = await callStatus("user-a", "legacy-bull-job-1");
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.data.planId, "p-legacy");
    const unknown = await callStatus("user-a", "no-such-job");
    assert.equal(unknown.status, 404);
  } finally {
    (conversationRepository as any).findPlanByJobId = real;
    delete process.env.QUEUE_PROVIDER;
  }
});

// ── R222-04 durable auto-save intent (TEST FIXTURE; the SQL itself is covered by generation-operations.pg.itest.ts) ──
test("R222-04 fixture: acknowledgeAutoSave records the ack for the executing worker only; outside a lease context it is a no-op", async () => {
  const r = await ops.submitGeneration({ ...NUTRITION(), job: { userId: "user-a", autoSaveOnComplete: true } });
  const row = memory.rows.get(r.operationId)!;
  await ops.acknowledgeAutoSave(); // no lease context
  assert.equal(row.payload.autoSaveAckedAt, undefined);
  const binding = { operationId: row.id, epoch: row.epoch, planId: row.targetId!, kind: row.kind, actorUserId: row.actorUserId };
  await ops.withGenerationOperation({ id: "j", data: { ...binding } }, async () => {
    plans.get(row.targetId!).status = "COMPLETED";
    await ops.acknowledgeAutoSave();
  });
  assert.ok(row.payload.autoSaveAckedAt, "ack recorded while the worker held the lease");
  assert.equal(row.status, "COMPLETED");
});

test("R222-04 fixture: a COMPLETED execution whose save was never acknowledged is replayed by recovery, capped by attempts, and an ack stops it", async () => {
  const r = await ops.submitGeneration({ ...NUTRITION(), job: { userId: "user-a", autoSaveOnComplete: true } });
  const row = memory.rows.get(r.operationId)!;
  plans.get(row.targetId!).status = "COMPLETED";
  assert.equal(await memory.store.settleStranded(row.id, row.epoch, "x", clock), "COMPLETED");
  const calls: string[] = [];
  const d = ops.generationOpsDeps;
  const origSave = d.autoSave;
  const origMax = d.autoSaveMaxAttempts;
  let ok = false;
  d.autoSave = async (op) => { calls.push(op.id); return ok; };
  d.autoSaveMaxAttempts = () => 2;
  try {
    for (let i = 0; i < 5; i++) await ops.recoverPendingGenerations();
    assert.equal(calls.length, 2, "attempt cap holds even though every run finds it pending");
    assert.equal(row.status, "COMPLETED", "autosave failure never touches the plan/operation outcome");
    // fresh operation, then success
    ok = true;
    const r2 = await ops.submitGeneration({ ...NUTRITION({ idempotencyKey: "key-87654321" }), job: { userId: "user-a", autoSaveOnComplete: true } });
    const row2 = memory.rows.get(r2.operationId)!;
    plans.get(row2.targetId!).status = "COMPLETED";
    await memory.store.settleStranded(row2.id, row2.epoch, "x", clock);
    const s = await ops.recoverPendingGenerations();
    assert.equal(s.autoSaved, 1);
    assert.ok(row2.payload.autoSaveAckedAt);
    const before = calls.length;
    await ops.recoverPendingGenerations();
    assert.equal(calls.length, before, "acknowledged save is not replayed");
  } finally {
    d.autoSave = origSave;
    d.autoSaveMaxAttempts = origMax;
  }
});
