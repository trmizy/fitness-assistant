/**
 * V-T012 R222-04 — REAL HTTP/API chain: ai-service processor -> HTTP -> the REAL fitness-service Express app -> PostgreSQL.
 *
 * Real: operation rows (ai test DB), `processNutritionPlanJob` (real builder/repair/invariants), the food catalog fetch and the
 * autosave POST over HTTP to a running fitness-service app (internal-token auth, importAiPlan, fitness test DB), recovery replay.
 * Faked: ONLY the LLM call (golden template answer from a captured fixture) and the queue publisher. A thin forwarding proxy in
 * front of fitness-service injects failures on the autosave endpoint to reproduce "autosave lost".
 *
 * Prerequisites (see report): fitness-service app on 127.0.0.1:39002 against `gymcoach_fitness_test`, INTERNAL_SERVICE_SECRET set,
 * FITNESS_APP_URL=http://127.0.0.1:39002, FITNESS_DB_CONTAINER=gymcoach-test-postgres-test-1. Refuses anything else.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

process.env.LLM_PROVIDER = "mock";
const REAL = process.env.FITNESS_APP_URL ?? "";
const SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "";
const CONTAINER = process.env.FITNESS_DB_CONTAINER ?? "";
if (!/localhost:55433\/[a-z_]*_test(\?|$)/.test(process.env.DATABASE_URL ?? "")) throw new Error("refusing: DATABASE_URL must target localhost:55433/*_test");
if (!/^http:\/\/127\.0\.0\.1:39002$/.test(REAL) || !SECRET || CONTAINER !== "gymcoach-test-postgres-test-1") throw new Error("refusing: needs FITNESS_APP_URL=http://127.0.0.1:39002, INTERNAL_SERVICE_SECRET and FITNESS_DB_CONTAINER=gymcoach-test-postgres-test-1");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "nutrition-30b-4meal-valid.json"), "utf8"));
const RUN = randomUUID().slice(0, 8);
const actor = (n: string) => `http-${RUN}-${n}`;

let ops: typeof import("../services/generation-operations");
let proc: typeof import("../services/nutrition.processor");
let prisma: any;
let llm: any;
let proxy: http.Server;
let proxyUrl = "";
const proxyState = { failSave: false, saveCalls: 0, otherCalls: 0 };
const published: any[] = [];
let llmCalls = 0;

const fitnessSql = (sql: string) =>
  execFileSync("docker", ["exec", CONTAINER, "psql", "-U", "gymcoach_test", "-d", "gymcoach_fitness_test", "-tAc", sql], { encoding: "utf8" }).trim();
const programCount = (userId: string) => Number(fitnessSql(`select count(*) from nutrition_programs where user_id='${userId}'`));

test.before(async () => {
  ops = await import("../services/generation-operations");
  proc = await import("../services/nutrition.processor");
  ({ prisma } = await import("../repositories/conversation.repository"));
  llm = (await import("../services/llm.service")).llmService;
  llm.callLLM = async () => { llmCalls++; return { answer: fixture.llmTemplateAnswer }; };
  ops.generationOpsDeps.admit = async () => undefined;
  ops.generationOpsDeps.publishBackoffMs = () => 0;
  ops.generationOpsDeps.enqueue = async (name, data, opts) => { published.push({ name, data, opts }); return { id: opts?.jobId ?? "m" }; };
  await prisma.aiGenerationOperation.deleteMany({ where: { actorUserId: { startsWith: "http-" } } });
  await prisma.nutritionPlan.deleteMany({ where: { userId: { startsWith: "http-" } } });

  proxy = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const isSave = req.method === "POST" && req.url === "/nutrition/from-ai-plan";
    if (isSave) {
      proxyState.saveCalls++;
      if (proxyState.failSave) { res.statusCode = 503; res.end(JSON.stringify({ error: "injected outage" })); return; }
    } else proxyState.otherCalls++;
    const r = await fetch(REAL + req.url, { method: req.method, headers: req.headers as any, body: chunks.length ? Buffer.concat(chunks) : undefined });
    res.statusCode = r.status;
    r.headers.forEach((v, k) => { if (!["transfer-encoding", "content-encoding", "content-length"].includes(k)) res.setHeader(k, v); });
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
  proxyUrl = `http://127.0.0.1:${(proxy.address() as any).port}`;
  process.env.FITNESS_SERVICE_URL = proxyUrl;
});
test.beforeEach(() => { published.length = 0; llmCalls = 0; proxyState.failSave = false; proxyState.saveCalls = 0; proxyState.otherCalls = 0; });
test.after(async () => {
  try { fitnessSql(`delete from nutrition_programs where user_id like 'http-${RUN}%'`); } catch { /* best effort */ }
  await prisma.aiGenerationOperation.deleteMany({ where: { actorUserId: { startsWith: `http-${RUN}` } } });
  await prisma.nutritionPlan.deleteMany({ where: { userId: { startsWith: `http-${RUN}` } } });
  await new Promise((r) => proxy.close(() => r(undefined)));
  await prisma.$disconnect();
});

async function submitAndRun(a: string, key: string) {
  const job = {
    userId: a, goal: "WEIGHT_LOSS", durationWeeks: 1, mealsPerDay: fixture.mealsPerDay,
    dailyCaloriesTarget: fixture.dailyCaloriesTarget, proteinTargetG: fixture.proteinTargetG, carbTargetG: fixture.carbTargetG, fatTargetG: fixture.fatTargetG,
    excludedFoodKeys: fixture.excludedFoodKeys, autoSaveOnComplete: true,
  };
  const r = await ops.submitGeneration({
    actorUserId: a, kind: "NUTRITION_PLAN", idempotencyKey: key,
    planCreate: { userId: a, name: "bootstrap", goal: "WEIGHT_LOSS", durationWeeks: 1, mealsPerDay: fixture.mealsPerDay }, job,
  });
  assert.equal(published.length, 1);
  await proc.processNutritionPlanJob({ id: published[0].opts.jobId, name: published[0].name, data: published[0].data } as any);
  return { r, op: () => prisma.aiGenerationOperation.findUnique({ where: { id: r.operationId } }), plan: () => prisma.nutritionPlan.findUnique({ where: { id: r.planId } }) };
}

test("REAL HTTP: processor completes the plan and the autosave reaches the real fitness-service -> exactly one NutritionProgram; ack recorded; replay is a no-op", async () => {
  const a = actor("ok");
  const { op, plan } = await submitAndRun(a, "http-key-000001");
  assert.equal((await plan()).status, "COMPLETED", String((await plan()).failReason));
  assert.equal((await op()).status, "COMPLETED");
  assert.equal(llmCalls, 1);
  assert.equal(proxyState.saveCalls, 1, "autosave went over HTTP");
  assert.ok((await op()).payload.autoSaveAckedAt, "success acknowledged on the operation");
  assert.equal(programCount(a), 1);
  const row = fitnessSql(`select source_plan_id, source_type, status, meals_per_day, (select count(*) from nutrition_program_days d where d.program_id=p.id) from nutrition_programs p where user_id='${a}'`).split("|");
  assert.equal(row[0], (await plan()).id, "program is bound to this execution's plan id");
  assert.deepEqual(row.slice(1), ["AI_PLAN", "ACTIVE", String(fixture.mealsPerDay), "7"]);
  const before = proxyState.saveCalls;
  const s = await ops.recoverPendingGenerations({ limit: 100 });
  assert.equal(s.errors, 0, JSON.stringify(s));
  assert.equal(proxyState.saveCalls, before, "acknowledged save is never replayed");
  assert.equal(programCount(a), 1);
});

test("REAL HTTP: fitness-service outage during autosave -> plan stays COMPLETED, no program, no ack; recovery replays after the outage and creates exactly one program", async () => {
  const a = actor("lost");
  proxyState.failSave = true;
  const { op, plan } = await submitAndRun(a, "http-key-000002");
  assert.equal((await plan()).status, "COMPLETED", "autosave trouble must not fail the plan");
  assert.equal((await op()).status, "COMPLETED");
  assert.equal(proxyState.saveCalls, 1);
  assert.equal(programCount(a), 0, "the save was lost");
  assert.equal((await op()).payload.autoSaveAckedAt, undefined);

  // outage continues: bounded, nothing created
  await ops.recoverPendingGenerations({ limit: 100 });
  assert.equal(programCount(a), 0);
  assert.equal((await op()).payload.autoSaveAttempts, 1);

  // outage over: the next recovery run saves it through the real endpoint
  proxyState.failSave = false;
  const s = await ops.recoverPendingGenerations({ limit: 100 });
  assert.equal(s.errors, 0, JSON.stringify(s));
  assert.ok(s.autoSaved >= 1);
  assert.equal(programCount(a), 1);
  assert.ok((await op()).payload.autoSaveAckedAt);
  assert.equal(fitnessSql(`select source_plan_id from nutrition_programs where user_id='${a}'`), (await plan()).id);

  const saves = proxyState.saveCalls;
  await ops.recoverPendingGenerations({ limit: 100 });
  assert.equal(proxyState.saveCalls, saves, "no further replay after the ack");
  assert.equal(programCount(a), 1);
});

test("REAL HTTP: a concurrent worker autosave and a recovery replay of the same plan race on the real endpoint -> still one program", async () => {
  const a = actor("race");
  proxyState.failSave = true;
  const { op, plan } = await submitAndRun(a, "http-key-000003");
  proxyState.failSave = false;
  const row = await op();
  const results = await Promise.all(Array.from({ length: 6 }, () => proc.replayCompletedNutritionAutoSave(row)));
  assert.ok(results.every((x) => x === true), "every racing save is acknowledged (created or alreadyExists), none errors");
  assert.equal(programCount(a), 1);
  assert.equal((await plan()).status, "COMPLETED");
});

test("REAL HTTP: the internal endpoint refuses a caller without the internal token (identity is never taken from the body)", async () => {
  const r = await fetch(`${REAL}/nutrition/from-ai-plan`, { method: "POST", headers: { "content-type": "application/json", "x-user-id": "victim" }, body: JSON.stringify({ sourcePlanId: randomUUID(), weeklySchedule: [] }) });
  assert.equal(r.status, 401);
});
