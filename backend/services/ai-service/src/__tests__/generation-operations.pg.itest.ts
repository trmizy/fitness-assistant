/**
 * V-T012 PG-01 — BACKEND INTEGRATION against a REAL, isolated PostgreSQL (docker `postgres-test`, port 55433,
 * database `gymcoach_ai_test`, both V-T012 migrations applied with `prisma migrate deploy`).
 *
 * Exercises the production `prismaOperationStore` and the real WorkoutPlan/NutritionPlan tables: unique-index races,
 * conditional updateMany counts, SELECT ... FOR UPDATE, trigger-injected rollback, epoch reopen, takeover, recovery.
 * The publisher (queue), quota and model are fakes; this is NOT Redis/SQS/DynamoDB/browser evidence.
 *
 * Refuses to run unless DATABASE_URL points at a `*_test` database on localhost:55433 (never the dev DB).
 *
 * Run (from backend/services/ai-service):
 *   NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test \
 *   LLM_PROVIDER=mock LOG_LEVEL=silent node node_modules/tsx/dist/cli.mjs --test src/__tests__/generation-operations.pg.itest.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.LLM_PROVIDER = "mock";
const URL_ = process.env.DATABASE_URL ?? "";
if (!/localhost:55433\/[a-z_]*_test(\?|$)/.test(URL_)) {
  throw new Error(`generation-operations.pg.itest refuses to run: DATABASE_URL must target localhost:55433/*_test (got "${URL_.replace(/:[^:@/]*@/, ":***@")}")`);
}

let ops: typeof import("../services/generation-operations");
let lease: typeof import("../services/generation-lease-context");
let prisma: any;
const store = () => ops.generationOpsDeps.store;
const RUN = randomUUID().slice(0, 8);
const actor = (n: string) => `pg-${RUN}-${n}`;
const published: Array<{ name: string; data: any; opts?: any }> = [];
let admits = 0;
let publishFailures = 0;

const NUTRITION = (a: string, key: string, meals = 3) => ({
  actorUserId: a,
  kind: "NUTRITION_PLAN" as const,
  idempotencyKey: key,
  planCreate: { userId: a, name: "Plan", goal: "MAINTENANCE", durationWeeks: 1, mealsPerDay: meals },
  job: { userId: a, goal: "MAINTENANCE", durationWeeks: 1, mealsPerDay: meals },
});
const WORKOUT = (a: string, key: string) => ({
  actorUserId: a,
  kind: "WORKOUT_PLAN" as const,
  idempotencyKey: key,
  planCreate: { userId: a, name: "W", goal: "STRENGTH", duration: 4, daysPerWeek: 3 },
  job: { userId: a, goal: "STRENGTH" },
});

test.before(async () => {
  ops = await import("../services/generation-operations");
  lease = await import("../services/generation-lease-context");
  ({ prisma } = await import("../repositories/conversation.repository"));
  const d = ops.generationOpsDeps;
  d.enqueue = async (name, data, opts) => {
    if (publishFailures > 0) { publishFailures--; throw new Error("injected queue failure"); }
    published.push({ name, data, opts });
    return { id: opts?.jobId ?? "m" };
  };
  d.admit = async () => { admits++; };
  d.publishBackoffMs = () => 0;
  d.admittedStaleMs = () => 0;
  d.publishedStaleMs = () => 0;
  // prove we are on a real database with the migrations applied
  const [{ n }] = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "ai_generation_operations"`;
  assert.equal(typeof n, "number");
  // leftovers of an aborted earlier run would be picked up by the recovery scan
  await prisma.aiGenerationOperation.deleteMany({ where: { actorUserId: { startsWith: "pg-" } } });
  await prisma.nutritionPlan.deleteMany({ where: { userId: { startsWith: "pg-" } } });
  await prisma.workoutPlan.deleteMany({ where: { userId: { startsWith: "pg-" } } });
});

test.beforeEach(() => { published.length = 0; admits = 0; publishFailures = 0; });

test.after(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS pg_test_block_plan_update ON nutrition_plans`).catch(() => undefined);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS pg_test_block_plan_update()`).catch(() => undefined);
  await prisma.aiGenerationOperation.deleteMany({ where: { actorUserId: { startsWith: `pg-${RUN}` } } });
  await prisma.nutritionPlan.deleteMany({ where: { userId: { startsWith: `pg-${RUN}` } } });
  await prisma.workoutPlan.deleteMany({ where: { userId: { startsWith: `pg-${RUN}` } } });
  await prisma.$disconnect();
});

const opRow = (id: string) => prisma.aiGenerationOperation.findUnique({ where: { id } });
const nutPlan = (id: string) => prisma.nutritionPlan.findUnique({ where: { id } });
const wrkPlan = (id: string) => prisma.workoutPlan.findUnique({ where: { id } });

// ── 1. unique-index race ────────────────────────────────────────────────────────────────────────────
test("PG: 12 concurrent submits of the same (actor,key) -> exactly one row, one charge, one plan, one publish", async () => {
  const a = actor("race");
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => ops.submitGeneration(NUTRITION(a, "race-key-0001"))));
  const rows = await prisma.aiGenerationOperation.findMany({ where: { actorUserId: a } });
  assert.equal(rows.length, 1, "unique (actor,key) must hold under a real race");
  assert.equal(admits, 1, "exactly one quota charge");
  const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
  assert.ok(ok.length >= 1);
  for (const r of ok) assert.equal(r.value.operationId, rows[0].id);
  // let the winner finish, then a sequential retry must be a pure replay (no extra charge/plan)
  const again = await ops.submitGeneration(NUTRITION(a, "race-key-0001"));
  assert.equal(again.operationId, rows[0].id);
  assert.equal(admits, 1);
  assert.equal(await prisma.nutritionPlan.count({ where: { userId: a } }), 1, "exactly one plan row");
  assert.ok(published.length >= 1 && published.length <= ops.generationOpsDeps.maxPublishes());
  const fresh = await opRow(rows[0].id);
  assert.ok(["PUBLISHED", "ADMITTED"].includes(fresh.status));
  assert.equal(fresh.publishCount, published.length, "durable publish count equals actual sends");
});

test("PG: same key + different payload -> 409 conflict (every status), different actor same key -> independent operation", async () => {
  const a = actor("conf");
  const r1 = await ops.submitGeneration(NUTRITION(a, "conf-key-0001", 3));
  await assert.rejects(() => ops.submitGeneration(NUTRITION(a, "conf-key-0001", 5)), /different input|IDEMPOTENCY/i);
  const b = actor("conf2");
  const r2 = await ops.submitGeneration(NUTRITION(b, "conf-key-0001", 3));
  assert.notEqual(r1.operationId, r2.operationId);
  // FAILED then different payload is still refused
  await prisma.aiGenerationOperation.update({ where: { id: r1.operationId }, data: { status: "FAILED" } });
  await assert.rejects(() => ops.submitGeneration(NUTRITION(a, "conf-key-0001", 5)), /different input|IDEMPOTENCY/i);
  assert.equal((await opRow(r1.operationId)).epoch, 1, "conflict must not reopen");
});

// ── 2. publication budget CAS ──────────────────────────────────────────────────────────────────────
test("PG: claimPublish — 10 concurrent claimants on the same observed count -> exactly one wins; budget never exceeded", async () => {
  const a = actor("cas");
  const r = await ops.submitGeneration(NUTRITION(a, "cas-key-00001"));
  const before = (await opRow(r.operationId)).publishCount;
  const wins = await Promise.all(Array.from({ length: 10 }, () => store().claimPublish(r.operationId, 1, before, 3, new Date())));
  assert.equal(wins.filter(Boolean).length, 1);
  // drain the budget: nobody can pass max
  for (let i = 0; i < 6; i++) {
    const cur = (await opRow(r.operationId)).publishCount;
    await Promise.all(Array.from({ length: 5 }, () => store().claimPublish(r.operationId, 1, cur, 3, new Date())));
  }
  assert.equal((await opRow(r.operationId)).publishCount, 3);
  assert.equal(await store().claimPublish(r.operationId, 1, 3, 3, new Date()), false);
  assert.equal(await store().claimPublish(r.operationId, 2, 3, 99, new Date()), false, "wrong epoch cannot spend budget");
});

test("PG: ADMITTED publish failures are bounded per epoch (3 failing sends, then FAILED+plan FAILED); only a later same-key retry opens a new charged epoch", async () => {
  const a = actor("adm");
  publishFailures = 99;
  let sendAttempts = 0;
  const realEnqueue = ops.generationOpsDeps.enqueue;
  ops.generationOpsDeps.enqueue = async (...args) => { sendAttempts++; return realEnqueue(...args); };
  try {
    // submits 1..3 each spend one publication attempt of epoch 1 (all fail); submit 4 finds the budget spent and settles.
    for (let i = 0; i < 4; i++) await ops.submitGeneration(NUTRITION(a, "adm-key-00001")).then(() => "ok", (e) => e);
    const row = (await prisma.aiGenerationOperation.findMany({ where: { actorUserId: a } }))[0];
    assert.equal(row.epoch, 1);
    assert.equal(row.publishCount, 3, "publishCount stops at the configured max");
    assert.equal(sendAttempts, 3, "no more than max external sends for the epoch");
    assert.equal(admits, 1, "retries within an epoch never charge again");
    assert.equal(row.status, "FAILED", "exhausted budget settles the operation");
    assert.equal((await nutPlan(row.targetId)).status, "FAILED", "and its plan, atomically");
    // documented policy: the same request after FAILED is a NEW charged epoch with a fresh budget
    await ops.submitGeneration(NUTRITION(a, "adm-key-00001")).then(() => "ok", (e) => e);
    const again = (await prisma.aiGenerationOperation.findMany({ where: { actorUserId: a } }))[0];
    assert.equal(again.epoch, 2);
    assert.equal(admits, 2);
    assert.equal(sendAttempts, 4);
  } finally {
    ops.generationOpsDeps.enqueue = realEnqueue;
  }
});

// ── 3. worker claim / lease ────────────────────────────────────────────────────────────────────────
async function admitted(a: string, key: string, kind: "N" | "W" = "N") {
  const r = await ops.submitGeneration(kind === "N" ? NUTRITION(a, key) : WORKOUT(a, key));
  const row = await opRow(r.operationId);
  const binding = { operationId: row.id, epoch: row.epoch, planId: row.targetId, kind: row.kind, actorUserId: row.actorUserId };
  return { row, binding };
}

test("PG: 10 concurrent worker claims of one execution -> exactly one CLAIMED, rest IN_FLIGHT; wrong binding is MISMATCH", async () => {
  const { binding } = await admitted(actor("claim"), "claim-key-001");
  const res = await Promise.all(Array.from({ length: 10 }, () => store().claim(binding, randomUUID(), 60_000, 3, new Date())));
  assert.equal(res.filter((x) => x.kind === "CLAIMED").length, 1);
  assert.equal(res.filter((x) => x.kind === "IN_FLIGHT").length, 9);
  const bad = await store().claim({ ...binding, actorUserId: "someone-else" }, randomUUID(), 60_000, 3, new Date());
  assert.equal(bad.kind, "MISMATCH");
});

test("PG: runFenced — owner writes inside one transaction; stale token / expired lease / other plan are refused and write nothing", async () => {
  const { row, binding } = await admitted(actor("fence"), "fence-key-001");
  const token = randomUUID();
  const c = await store().claim(binding, token, 60_000, 3, new Date());
  assert.equal(c.kind, "CLAIMED");
  const ctx = { operationId: row.id, epoch: row.epoch, token, targetId: row.targetId } as any;
  await store().runFenced(ctx, row.targetId, 60_000, new Date(), (db: any) => db.nutritionPlan.update({ where: { id: row.targetId }, data: { status: "PROCESSING" } }));
  assert.equal((await nutPlan(row.targetId)).status, "PROCESSING");
  // stale owner
  await assert.rejects(() => store().runFenced({ ...ctx, token: randomUUID() }, row.targetId, 60_000, new Date(), (db: any) => db.nutritionPlan.update({ where: { id: row.targetId }, data: { status: "COMPLETED" } })), lease.StaleLeaseError);
  // wrong plan id
  await assert.rejects(() => store().runFenced(ctx, randomUUID(), 60_000, new Date(), async () => "x"), lease.StaleLeaseError);
  assert.equal((await nutPlan(row.targetId)).status, "PROCESSING", "refused fenced writes changed nothing");
  // exception inside fn rolls the plan write back
  await assert.rejects(() => store().runFenced(ctx, row.targetId, 60_000, new Date(), async (db: any) => { await db.nutritionPlan.update({ where: { id: row.targetId }, data: { status: "COMPLETED" } }); throw new Error("boom"); }), /boom/);
  assert.equal((await nutPlan(row.targetId)).status, "PROCESSING", "fn failure rolls back its own write");
  // expired lease refuses
  await prisma.aiGenerationOperation.update({ where: { id: row.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(() => store().runFenced(ctx, row.targetId, 60_000, new Date(), async () => "x"), lease.StaleLeaseError);
});

test("PG: takeover — after lease expiry a new claimant wins; the old owner can no longer write, renew or finish", async () => {
  const { row, binding } = await admitted(actor("take"), "take-key-0001");
  const tA = randomUUID(), tB = randomUUID();
  assert.equal((await store().claim(binding, tA, 60_000, 3, new Date())).kind, "CLAIMED");
  await prisma.aiGenerationOperation.update({ where: { id: row.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await store().claim(binding, tB, 60_000, 3, new Date())).kind, "CLAIMED");
  const ctxA = { operationId: row.id, epoch: row.epoch, token: tA, targetId: row.targetId } as any;
  assert.equal(await store().renew(ctxA, 60_000, new Date()), false);
  assert.equal(await store().finish(ctxA, "COMPLETED", null, new Date()), false);
  await assert.rejects(() => store().runFenced(ctxA, row.targetId, 60_000, new Date(), async () => "x"), lease.StaleLeaseError);
  const ctxB = { ...ctxA, token: tB };
  assert.equal(await store().finish(ctxB, "COMPLETED", null, new Date()), true);
  assert.equal((await opRow(row.id)).status, "COMPLETED");
});

// ── 4. atomic terminal settle + trigger-injected rollback ──────────────────────────────────────────
test("PG: settleStranded — plan not COMPLETED -> operation and plan both FAILED in one transaction", async () => {
  const { row } = await admitted(actor("settle"), "settle-key-01");
  assert.equal(await store().settleStranded(row.id, row.epoch, "unit", new Date()), "FAILED");
  assert.equal((await opRow(row.id)).status, "FAILED");
  assert.equal((await nutPlan(row.targetId)).status, "FAILED");
  assert.equal(await store().settleStranded(row.id, row.epoch, "again", new Date()), null, "idempotent: terminal rows are not eligible");
});

test("PG: settleStranded — a COMPLETED plan is preserved (operation -> COMPLETED), never failed", async () => {
  const { row } = await admitted(actor("settle2"), "settle-key-02");
  await prisma.nutritionPlan.update({ where: { id: row.targetId }, data: { status: "COMPLETED", plan: { ok: true } } });
  assert.equal(await store().settleStranded(row.id, row.epoch, "x", new Date()), "COMPLETED");
  assert.equal((await nutPlan(row.targetId)).status, "COMPLETED");
  assert.equal((await opRow(row.id)).status, "COMPLETED");
});

test("PG: settleStranded — stale epoch is a no-op", async () => {
  const { row } = await admitted(actor("settle3"), "settle-key-03");
  assert.equal(await store().settleStranded(row.id, row.epoch + 1, "x", new Date()), null);
  assert.equal((await opRow(row.id)).status, "PUBLISHED");
});

test("PG: ROLLBACK — if the plan write throws inside settleStranded the operation is NOT left FAILED (both or neither)", async () => {
  const { row } = await admitted(actor("rb"), "rb-key-000001");
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION pg_test_block_plan_update() RETURNS trigger AS $$ BEGIN IF NEW.id = '${row.targetId}' AND NEW.status = 'FAILED' THEN RAISE EXCEPTION 'injected plan failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS pg_test_block_plan_update ON nutrition_plans`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER pg_test_block_plan_update BEFORE UPDATE ON nutrition_plans FOR EACH ROW EXECUTE FUNCTION pg_test_block_plan_update()`);
  try {
    await assert.rejects(() => store().settleStranded(row.id, row.epoch, "x", new Date()), /injected plan failure/);
    const after = await opRow(row.id);
    assert.equal(after.status, "PUBLISHED", "operation rolled back with the failed plan write");
    assert.equal((await nutPlan(row.targetId)).status, "QUEUED");
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS pg_test_block_plan_update ON nutrition_plans`);
  }
  // after the fault clears, the next recovery completes the pair
  assert.equal(await store().settleStranded(row.id, row.epoch, "x", new Date()), "FAILED");
  assert.equal((await nutPlan(row.targetId)).status, "FAILED");
});

test("PG: settleStranded vs a concurrent live worker — row lock serialises; exactly one terminal outcome, never contradictory", async () => {
  const { row, binding } = await admitted(actor("lock"), "lock-key-0001");
  const token = randomUUID();
  await store().claim(binding, token, 60_000, 3, new Date());
  const ctx = { operationId: row.id, epoch: row.epoch, token, targetId: row.targetId } as any;
  // lease is live -> settle must refuse (RUNNING with unexpired lease is not eligible) even when racing a fenced write
  const [fenced, settled] = await Promise.all([
    store().runFenced(ctx, row.targetId, 60_000, new Date(), (db: any) => db.nutritionPlan.update({ where: { id: row.targetId }, data: { status: "COMPLETED", plan: { ok: 1 } } })).then(() => "written", () => "refused"),
    store().settleStranded(row.id, row.epoch, "race", new Date()),
  ]);
  assert.equal(fenced, "written");
  assert.equal(settled, null);
  assert.equal((await nutPlan(row.targetId)).status, "COMPLETED");
});

// ── 5. epoch reopen ────────────────────────────────────────────────────────────────────────────────
test("PG: FAILED + same payload -> new epoch, new target plan, charged again; a message of the old epoch is STALE_MESSAGE", async () => {
  const a = actor("epoch");
  const { row, binding } = await admitted(a, "epoch-key-0001");
  await store().settleStranded(row.id, row.epoch, "x", new Date());
  const r2 = await ops.submitGeneration(NUTRITION(a, "epoch-key-0001"));
  assert.equal(r2.epoch, 2);
  assert.equal(r2.operationId, row.id);
  assert.notEqual(r2.planId, row.targetId);
  assert.equal(admits, 2, "documented policy: a reopened execution is a new charged epoch");
  const stale = await store().claim(binding, randomUUID(), 60_000, 3, new Date());
  assert.equal(stale.kind, "STALE_MESSAGE");
  assert.equal((await nutPlan(row.targetId)).status, "FAILED", "old epoch plan is untouched");
  const st = await ops.describeOperationJob(a, row.id);
  assert.equal((st as any).body.epoch, 2);
  assert.equal((st as any).body.planId, r2.planId);
  assert.equal((await ops.describeOperationJob("intruder", row.id)).kind, "FORBIDDEN");
});

test("PG: two concurrent reopen attempts of one FAILED operation -> exactly one epoch bump", async () => {
  const a = actor("reopen2");
  const { row } = await admitted(a, "reopen2-key-1");
  await store().settleStranded(row.id, row.epoch, "x", new Date());
  const rs = await Promise.all([store().reopenFailed(row.id, randomUUID(), row.fingerprint, new Date()), store().reopenFailed(row.id, randomUUID(), row.fingerprint, new Date())]);
  assert.equal(rs.filter(Boolean).length, 1);
  assert.equal((await opRow(row.id)).epoch, 2);
});

// ── 6. reservation ownership ───────────────────────────────────────────────────────────────────────
test("PG: takeOverReserving CAS — two takers of one stale RESERVING row -> one wins; the loser's token can no longer admit or delete", async () => {
  const a = actor("resv");
  const t0 = randomUUID();
  const { row } = await store().createReserving({ actorUserId: a, subjectUserId: null, kind: "NUTRITION_PLAN", idempotencyKey: "resv-key-0001", fingerprint: "f", reservationToken: t0, now: new Date() });
  const seen = (await opRow(row.id)).updatedAt;
  const [tA, tB] = [randomUUID(), randomUUID()];
  const rs = await Promise.all([store().takeOverReserving(row.id, seen, tA, new Date(Date.now() + 5)), store().takeOverReserving(row.id, seen, tB, new Date(Date.now() + 10))]);
  assert.equal(rs.filter(Boolean).length, 1);
  assert.equal(await store().deleteIfReserving(row.id, 1, t0), false, "original owner lost the reservation");
  assert.equal(await store().markAdmitted(row.id, 1, t0, { targetType: "NUTRITION_PLAN", targetId: randomUUID(), payload: {} }, new Date()), false);
  const winner = rs[0] ? tA : tB;
  assert.equal(await store().markAdmitted(row.id, 1, winner, { targetType: "NUTRITION_PLAN", targetId: randomUUID(), payload: {} }, new Date()), true);
  // synthetic row (empty payload is impossible via submitGeneration): remove it so the recovery scan below only sees real executions
  await prisma.aiGenerationOperation.delete({ where: { id: row.id } });
});

// ── 7. recovery + reconciliation (raw SQL) ─────────────────────────────────────────────────────────
test("PG: recoverPendingGenerations — stranded ADMITTED republishes within budget; exhausted PUBLISHED settles FAILED; reconciliation repairs FAILED-op/QUEUED-plan; second run is a no-op", async () => {
  const a = actor("rec");
  // (a) ADMITTED whose first publish failed
  publishFailures = 1;
  await ops.submitGeneration(NUTRITION(a, "rec-key-adm-01")).catch(() => undefined);
  const admittedRow = (await prisma.aiGenerationOperation.findMany({ where: { actorUserId: a, idempotencyKey: "rec-key-adm-01" } }))[0];
  // (b) PUBLISHED with exhausted attempts
  const pub = await admitted(a, "rec-key-pub-01");
  await prisma.aiGenerationOperation.update({ where: { id: pub.row.id }, data: { attempt: 3, publishCount: 3 } });
  // (c) FAILED operation with plan still QUEUED (past partial write)
  const bad = await admitted(a, "rec-key-bad-01");
  await prisma.aiGenerationOperation.update({ where: { id: bad.row.id }, data: { status: "FAILED", completedAt: new Date(), lastError: "past partial write" } });

  const s1 = await ops.recoverPendingGenerations({ limit: 200 });
  assert.equal(s1.errors, 0, JSON.stringify(s1));
  assert.ok(s1.republished >= 1 || (await opRow(admittedRow.id)).publishCount >= 1);
  assert.equal((await opRow(pub.row.id)).status, "FAILED");
  assert.equal((await nutPlan(pub.row.targetId)).status, "FAILED");
  assert.equal((await nutPlan(bad.row.targetId)).status, "FAILED", "reconciliation repaired the inconsistent pair");
  assert.ok((await opRow(admittedRow.id)).publishCount <= 3);

  const before = published.length;
  const s2 = await ops.recoverPendingGenerations({ limit: 200 });
  assert.equal(s2.errors, 0);
  assert.equal(s2.reconciled, 0);
  assert.equal(s2.failed, 0);
  // settled work is never re-published or re-failed; unrelated live PUBLISHED rows of earlier tests may legitimately be
  // republished (stale threshold is 0 here) but only within their per-epoch budget.
  const settledIds = new Set([pub.row.id, bad.row.id]);
  assert.equal(published.slice(before).filter((m) => settledIds.has(m.data.operationId)).length, 0, "settled operations are not re-published");
  assert.equal((await opRow(pub.row.id)).status, "FAILED");
  const over = await prisma.aiGenerationOperation.count({ where: { actorUserId: { startsWith: `pg-${RUN}` }, publishCount: { gt: 3 } } });
  assert.equal(over, 0, "no row ever exceeds the publication budget");
});

test("PG: withGenerationOperation end-to-end on real rows — one processor run per execution, redelivery acknowledged, COMPLETED recorded", async () => {
  const { row, binding } = await admitted(actor("wrap"), "wrap-key-0001");
  let runs = 0;
  const run = async () => {
    runs++;
    const c = lease.leaseStorage.getStore()!;
    await store().runFenced(c, row.targetId, 60_000, new Date(), (db: any) => db.nutritionPlan.update({ where: { id: row.targetId }, data: { status: "COMPLETED", plan: { meals: [] } } }));
  };
  await Promise.all(Array.from({ length: 6 }, () => ops.withGenerationOperation({ id: "j", data: { ...binding } }, run).catch((e) => (e instanceof ops.OperationInFlightError ? undefined : Promise.reject(e)))));
  assert.equal(runs, 1, "only one worker ran the model/processor");
  assert.equal((await opRow(row.id)).status, "COMPLETED");
  await ops.withGenerationOperation({ id: "j2", data: { ...binding } }, run);
  assert.equal(runs, 1, "redelivery of a finished execution does not re-run");
});

// ── 8. durability across a second connection ───────────────────────────────────────────────────────
test("PG: durability — a second, independent PrismaClient (separate connection pool) sees the committed row and plan", async () => {
  const a = actor("dur");
  const r = await ops.submitGeneration(WORKOUT(a, "dur-key-00001"));
  const { PrismaClient } = await import("../generated/prisma");
  const other = new PrismaClient();
  try {
    const row = await other.aiGenerationOperation.findUnique({ where: { id: r.operationId } });
    assert.equal(row?.actorUserId, a);
    assert.equal(row?.targetId, r.planId);
    assert.equal(row?.status, "PUBLISHED");
    const plan = await other.workoutPlan.findUnique({ where: { id: r.planId } });
    assert.equal(plan?.jobId, r.operationId, "Plan.jobId is the stable operation reference");
  } finally {
    await other.$disconnect();
  }
  assert.ok((await wrkPlan(r.planId)));
});

// ── 9. R222-04 durable auto-save intent (raw jsonb SQL) ─────────────────────────────────────────────
async function completedNutrition(a: string, key: string, autoSave: boolean) {
  const r = await ops.submitGeneration({
    ...NUTRITION(a, key),
    job: { userId: a, goal: "MAINTENANCE", ...(autoSave ? { autoSaveOnComplete: true } : {}) },
  });
  const row = await opRow(r.operationId);
  await prisma.nutritionPlan.update({ where: { id: row.targetId }, data: { status: "COMPLETED", plan: { weeklySchedule: [{ meals: [] }] } } });
  assert.equal(await store().settleStranded(row.id, row.epoch, "x", new Date()), "COMPLETED");
  await prisma.aiGenerationOperation.update({ where: { id: row.id }, data: { completedAt: new Date() } });
  return opRow(row.id);
}

test("PG R222-04: unacknowledged COMPLETED autoSave execution is listed; ack is idempotent and removes it; flag-less / non-nutrition / other-epoch never match", async () => {
  const a = actor("as1");
  const wanted = await completedNutrition(a, "as-key-000001", true);
  const noFlag = await completedNutrition(a, "as-key-000002", false);
  const since = new Date(Date.now() - 3600_000);
  let list = (await store().listPendingAutoSave(since, 5, 100)).map((r) => r.id);
  assert.ok(list.includes(wanted.id));
  assert.ok(!list.includes(noFlag.id), "only executions that asked for autoSaveOnComplete carry an intent");
  assert.equal(await store().ackAutoSave(wanted.id, wanted.epoch + 1, new Date()), false, "wrong epoch cannot acknowledge");
  assert.equal(await store().ackAutoSave(wanted.id, wanted.epoch, new Date()), true);
  assert.equal(await store().ackAutoSave(wanted.id, wanted.epoch, new Date()), false, "second ack is a no-op");
  list = (await store().listPendingAutoSave(since, 5, 100)).map((r) => r.id);
  assert.ok(!list.includes(wanted.id), "acknowledged intent is no longer pending");
  assert.ok((await opRow(wanted.id)).payload.job.autoSaveOnComplete === true, "ack does not clobber the stored job payload");
  assert.equal(await store().claimAutoSaveAttempt(wanted.id, wanted.epoch, 5, new Date()), false, "no replay after ack");
});

test("PG R222-04: 10 concurrent attempt-claims win at most `max` times in total, never more", async () => {
  const a = actor("as2");
  const row = await completedNutrition(a, "as-key-000003", true);
  const res = await Promise.all(Array.from({ length: 10 }, () => store().claimAutoSaveAttempt(row.id, row.epoch, 3, new Date())));
  assert.equal(res.filter(Boolean).length, 3);
  assert.equal((await opRow(row.id)).payload.autoSaveAttempts, 3);
  assert.ok(!(await store().listPendingAutoSave(new Date(Date.now() - 3600_000), 3, 100)).some((r) => r.id === row.id), "exhausted attempts drop out of the scan");
});

test("PG R222-04: ack from the executing worker (RUNNING) is accepted; ack is refused while ADMITTED/FAILED", async () => {
  const { row, binding } = await admitted(actor("as3"), "as-key-000004");
  assert.equal(await store().ackAutoSave(row.id, row.epoch, new Date()), false, "PUBLISHED is not an executing worker");
  assert.equal((await store().claim(binding, randomUUID(), 60_000, 3, new Date())).kind, "CLAIMED");
  // admitted() uses a job without the flag; ack itself is flag-independent but kind/epoch/status bound
  assert.equal(await store().ackAutoSave(row.id, row.epoch, new Date()), true);
  await prisma.aiGenerationOperation.update({ where: { id: row.id }, data: { status: "FAILED" } });
  assert.equal(await store().ackAutoSave(row.id, row.epoch + 1, new Date()), false);
});

test("PG R222-04: recovery replays a lost autosave (worker died after COMPLETED), bounded; success acks; later runs do nothing; failures stop at max attempts", async () => {
  const a = actor("as4");
  const lost = await completedNutrition(a, "as-key-000005", true);
  const stuck = await completedNutrition(a, "as-key-000006", true);
  const calls: string[] = [];
  const d = ops.generationOpsDeps;
  const orig = d.autoSave;
  d.autoSave = async (op) => { calls.push(op.id); return op.id === lost.id; }; // fitness-service up for `lost`, down for `stuck`
  const origMax = d.autoSaveMaxAttempts;
  d.autoSaveMaxAttempts = () => 3;
  try {
    const s1 = await ops.recoverPendingGenerations({ limit: 200 });
    assert.equal(s1.errors, 0, JSON.stringify(s1));
    assert.ok(calls.includes(lost.id) && calls.includes(stuck.id));
    assert.ok((await opRow(lost.id)).payload.autoSaveAckedAt, "success is acknowledged durably");
    for (let i = 0; i < 6; i++) await ops.recoverPendingGenerations({ limit: 200 });
    assert.equal(calls.filter((c) => c === lost.id).length, 1, "an acknowledged save is never replayed");
    assert.equal(calls.filter((c) => c === stuck.id).length, 3, "a persistently failing save stops at the attempt cap");
    assert.equal((await opRow(stuck.id)).payload.autoSaveAttempts, 3);
    assert.equal((await opRow(stuck.id)).status, "COMPLETED", "autosave trouble never flips a COMPLETED plan/operation");
    assert.equal((await nutPlan(stuck.targetId)).status, "COMPLETED");
  } finally {
    d.autoSave = orig;
    d.autoSaveMaxAttempts = origMax;
  }
});

test("PG R222-04: replay window — an old COMPLETED execution outside the window is not replayed", async () => {
  const a = actor("as5");
  const old = await completedNutrition(a, "as-key-000007", true);
  await prisma.aiGenerationOperation.update({ where: { id: old.id }, data: { completedAt: new Date(Date.now() - 10 * 24 * 3600_000) } });
  const calls: string[] = [];
  const d = ops.generationOpsDeps;
  const orig = d.autoSave;
  d.autoSave = async (op) => { calls.push(op.id); return true; };
  try {
    await ops.recoverPendingGenerations({ limit: 200 });
    assert.ok(!calls.includes(old.id));
  } finally {
    d.autoSave = orig;
  }
});

test("PG R222-04: replayCompletedNutritionAutoSave sends ONLY the operation's own COMPLETED, actor-owned plan, identity from the stored plan, and never for anything else", async () => {
  const http = await import("node:http");
  const { replayCompletedNutritionAutoSave } = await import("../services/nutrition.processor");
  const a = actor("rp");
  const row = await completedNutrition(a, "rp-key-0000001", true);
  const posts: Array<{ url?: string; headers: any; body: any }> = [];
  let respond = 200;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { posts.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || "{}") }); res.statusCode = respond; res.setHeader("content-type", "application/json"); res.end("{}"); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const prevUrl = process.env.FITNESS_SERVICE_URL;
  process.env.FITNESS_SERVICE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    await prisma.nutritionPlan.update({ where: { id: row.targetId }, data: { status: "PROCESSING" } });
    assert.equal(await replayCompletedNutritionAutoSave(row), false, "plan not COMPLETED -> nothing sent");
    await prisma.nutritionPlan.update({ where: { id: row.targetId }, data: { status: "COMPLETED" } });
    assert.equal(await replayCompletedNutritionAutoSave({ ...row, actorUserId: "someone-else" }), false, "foreign actor -> nothing sent");
    await prisma.nutritionPlan.update({ where: { id: row.targetId }, data: { plan: {} } });
    assert.equal(await replayCompletedNutritionAutoSave(row), false, "no content -> nothing sent");
    assert.equal(posts.length, 0);
    await prisma.nutritionPlan.update({ where: { id: row.targetId }, data: { plan: { weeklySchedule: [{ meals: [] }], goal: "MAINTENANCE", durationWeeks: 1, mealsPerDay: 3 } } });
    assert.equal(await replayCompletedNutritionAutoSave(row), true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "/nutrition/from-ai-plan");
    assert.equal(posts[0].body.sourcePlanId, row.targetId, "its own execution plan");
    assert.equal(posts[0].headers["x-user-id"], a, "owner comes from the stored plan/actor");
    assert.equal(posts[0].body.startDate, new Date().toISOString().slice(0, 10), "the program window starts when it is SAVED, never in the past because the replay ran days after completion");
    respond = 500; // fitness-service failing -> stays unacknowledged (false), bounded by the attempt counter
    assert.equal(await replayCompletedNutritionAutoSave(row), false);
  } finally {
    if (prevUrl === undefined) delete process.env.FITNESS_SERVICE_URL; else process.env.FITNESS_SERVICE_URL = prevUrl;
    await new Promise((r) => server.close(() => r(undefined)));
  }
});
