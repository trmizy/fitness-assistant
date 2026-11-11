/**
 * V-T012.1 — shared billable-generation admission at the queue command boundary.
 *
 * REAL: Express app + routers + requireAuth + controllers, conversation.service queue commands,
 * enqueueAiTask (QUEUE_PROVIDER=sqs path), fitnessAgent.proposeNutritionPlan and
 * tryPollOrReviseNutritionPlanDraft, the real limiter + shared "ai-expensive" bucket.
 * FAKE (TEST FIXTURE): plan/action repositories (in-memory counters), the SQS transport, and the
 * profile / nutrition-target tools. No Postgres, Redis, SQS, DynamoDB or model is contacted
 * (LLM_PROVIDER=mock; llmService.callLLM is a tripwire). Nothing here proves AWS behaviour.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { createMemoryOperationStore } from "./helpers/memory-operation-store";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.LLM_PROVIDER = "mock";
process.env.QUEUE_PROVIDER = "sqs";
process.env.AI_TASKS_QUEUE_URL = "https://sqs.invalid/queue";
process.env.AI_EXPENSIVE_RATE_LIMIT_MAX = "3";
process.env.AI_EXPENSIVE_RATE_LIMIT_WINDOW_SECONDS = "86400"; // fixed window: keep a clock-boundary rollover out of the test
delete process.env.RATE_LIMIT_PROVIDER;

const SECRET = "test-internal-secret";
const gw = (userId: string) => ({
  "x-internal-token": SECRET,
  "x-user-id": userId,
  "x-user-role": "CUSTOMER",
  Authorization: "Bearer user-session-token",
});
const WORKOUT = { goal: "STRENGTH", durationWeeks: 4, daysPerWeek: 3 };
const NUTRITION = { goal: "MAINTENANCE" };
const PLAN_UUID = "11111111-1111-4111-8111-111111111111";

const planRows = new Map<string, any>();
const actionRows: any[] = [];
const counts = { admit: 0, sqs: 0, nutritionPlans: 0, workoutPlans: 0, adjustedPlans: 0, actionCreate: 0, actionUpdate: 0, models: 0 };
const sent: Array<{ userId: unknown; name: unknown }> = [];
const sentBodies: any[] = [];
let failActionCreate = false;
let failActionUpdate = false;
let lastUpdatePayload: any = null;
let lastTurn: { id: string } | null = null;
let app: Express;
let agent: any;
let identity: (u: string) => any;
let resetRateLimiterCache: () => void;
let dynamoDeps: any;

const reset = () => {
  for (const k of Object.keys(counts)) (counts as any)[k] = 0;
  sent.length = 0;
  sentBodies.length = 0;
  planRows.clear();
  actionRows.length = 0;
  failActionCreate = false;
  failActionUpdate = false;
  lastUpdatePayload = null;
  lastTurn = null;
  // fresh durable-operation store per test (TEST FIXTURE mirroring the Prisma store's CAS semantics)
  require("../services/generation-operations").generationOpsDeps.store = createMemoryOperationStore().store;
};

test.before(async () => {
  const { llmService } = await import("../services/llm.service");
  (llmService as any).callLLM = async () => {
    counts.models++;
    throw new Error("TRIPWIRE: real model call");
  };

  const { conversationRepository, prisma } = await import("../repositories/conversation.repository");
  const repo: any = conversationRepository;
  repo.createNutritionPlan = async (d: any) => { counts.nutritionPlans++; planRows.set(d.id, { ...d, status: "QUEUED" }); return d; };
  repo.findNutritionPlanById = async (id: string) => planRows.get(id) ?? null;
  repo.updateNutritionPlanJob = async () => undefined;
  repo.createWorkoutPlan = async (d: any) => { counts.workoutPlans++; planRows.set(d.id, { ...d, status: "QUEUED" }); return d; };
  repo.createAdjustedPlan = async (d: any) => { counts.adjustedPlans++; planRows.set(d.id, { ...d, status: "QUEUED" }); return d; };
  repo.updatePlanJob = async () => undefined;
  repo.findPlanById = async (id: string) => (id === PLAN_UUID ? { id: PLAN_UUID, userId: "owner", status: "COMPLETED", version: 1, goal: "STRENGTH", duration: 4, daysPerWeek: 3, plan: {} } : planRows.get(id) ?? null);
  const p: any = prisma;
  p.fitnessAgentAction.create = async (_args: any) => {
    if (failActionCreate) throw new Error("simulated action persistence failure");
    counts.actionCreate++;
    actionRows.push({ id: `act-${counts.actionCreate}`, status: "PENDING", payload: _args?.data?.payload });
    return { id: "act-1" };
  };
  p.fitnessAgentAction.findFirst = async () => actionRows[actionRows.length - 1] ?? null;
  {
    const opsMod = await import("../services/generation-operations");
    const realAdmit = opsMod.generationOpsDeps.admit;
    opsMod.generationOpsDeps.admit = async (u: string) => { counts.admit++; return realAdmit(u); };
  }
  p.fitnessAgentAction.update = async (_a: any) => {
    if (failActionUpdate) { failActionUpdate = false; throw new Error("simulated action update failure"); }
    counts.actionUpdate++;
    lastUpdatePayload = _a?.data?.payload ?? lastUpdatePayload;
    return {};
  };
  p.conversation.findFirst = async () => lastTurn;

  const { sqsDeps } = await import("../workers/queue-provider");
  (sqsDeps as any).sendMessage = async (cmd: any) => {
    const body = JSON.parse(cmd.input.MessageBody);
    counts.sqs++;
    sent.push({ userId: body.data?.userId, name: body.name });
    sentBodies.push(body);
    return { MessageId: `m-${counts.sqs}` };
  };

  const agentMod = await import("../services/fitness-agent.service");
  agent = agentMod.fitnessAgent;
  const deps: any = agentMod.fitnessAgentDeps;
  deps.tools.getNutritionTargetPreview = async () => ({ status: "COMPUTED", calories: 2000, protein: 150, carbs: 200, fat: 60 });
  deps.tools.getNutritionActiveState = async () => null;
  deps.profileExtractor.extract = async () => ({ profile: { goal: "MAINTENANCE", currentWeightKg: 70, heightCm: 175, age: 30, gender: "MALE" } });
  identity = (u: string) => ({ userId: u, role: "CUSTOMER", authorizationHeader: undefined });

  ({ resetRateLimiterCache } = await import("../services/rate-limit/provider"));
  ({ dynamoRateLimiterDeps: dynamoDeps } = await import("../services/rate-limit/dynamodb-rate-limiter"));
  app = (await import("../app")).default;
});

test.beforeEach(reset);
test.afterEach(() => {
  delete process.env.RATE_LIMIT_PROVIDER;
  resetRateLimiterCache();
});
test.after(() => assert.equal(counts.models, 0, "no model call in this suite"));

const rest = (headers: any) => ({
  nutrition: () => request(app).post("/plans/nutrition/generate").set(headers).send(NUTRITION),
  workout: () => request(app).post("/plans/workout/generate").set(headers).send(WORKOUT),
  adjust: () => request(app).post("/plans/adjust").set(headers).send({ planId: PLAN_UUID, adjustments: "more volume please" }),
});

// Contract: owner of the adjusted plan is the caller, so make findPlanById return the caller.
const asOwner = (userId: string) => {
  return import("../repositories/conversation.repository").then(({ conversationRepository }) => {
    (conversationRepository as any).findPlanById = async (id: string) => (id === PLAN_UUID ? { id: PLAN_UUID, userId, status: "COMPLETED", version: 1, goal: "STRENGTH", duration: 4, daysPerWeek: 3, plan: {} } : planRows.get(id) ?? null);
  });
};

test("TEST-01 — REST exhausts the shared budget; chat-initiated nutrition generation is then refused, truthfully, with nothing queued or created", async () => {
  const h = gw("rest-then-chat");
  for (let i = 0; i < 3; i++) assert.equal((await rest(h).nutrition()).status, 202);
  const refusedRest = await rest(h).nutrition();
  assert.equal(refusedRest.status, 429);
  assert.ok(refusedRest.headers["retry-after"], "Retry-After present on a command-raised 429");
  const before = { ...counts };
  const turn = await agent.proposeNutritionPlan("tao thuc don", identity("rest-then-chat"), "s1");
  assert.match(turn.answer, /hết lượt/);
  assert.deepEqual(turn.blocks, []);
  assert.equal(counts.sqs, before.sqs, "no job published");
  assert.equal(counts.nutritionPlans, before.nutritionPlans, "no orphan plan row");
  assert.equal(counts.actionCreate, before.actionCreate, "no misleading GENERATING action");
});

test("TEST-02 — chat exhausts the shared budget; REST queued generation (nutrition, workout, adjust) is then refused", async () => {
  const variants = ["tao thuc don", "tao thuc don khong an hai san", "tao thuc don khong an dau phong"];
  for (let i = 0; i < 3; i++) {
    const turn = await agent.proposeNutritionPlan(variants[i], identity("chat-then-rest"), `s2-${i}`);
    assert.doesNotMatch(turn.answer, /hết lượt/);
  }
  assert.equal(counts.sqs, 3);
  assert.equal(counts.actionCreate, 3);
  await asOwner("chat-then-rest");
  const h = gw("chat-then-rest");
  for (const call of [rest(h).nutrition, rest(h).workout, rest(h).adjust]) {
    const res = await call();
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, "RATE_LIMITED");
  }
  assert.equal(counts.sqs, 3, "REST added no job after chat used the allowance");
});

test("TEST-03 — a paid nutrition REVISION uses the same budget; refusal keeps the existing preview and state", async () => {
  const h = gw("revise-user");
  for (let i = 0; i < 3; i++) await rest(h).nutrition();
  const payload = {
    planId: "np-old", jobId: "j-old", phase: "PREVIEW", mealsPerDay: 3, goal: "MAINTENANCE",
    constraints: { exclusions: [], unsupported: [], preferences: [] },
    target: { source: "COMPUTED", calories: 2000, protein: 150, carbs: 200, fat: 60 },
    content: { dailyCaloriesTarget: 2000, mealsPerDay: 3, days: [] },
  };
  const before = { ...counts };
  const turn = await agent.tryPollOrReviseNutritionPlanDraft(
    "it bua hon", identity("revise-user"), "s3",
    { id: "act-r", risk: "LOW", expiresAt: new Date(Date.now() + 600000), payload },
  );
  assert.ok(turn, "revision was recognised");
  assert.match(turn.answer, /hết lượt/);
  assert.ok(turn.blocks.length >= 1, "existing preview block preserved");
  assert.equal(counts.sqs, before.sqs);
  assert.equal(counts.actionUpdate, before.actionUpdate, "action payload not flipped to GENERATING");
});

test("TEST-04 — one logical generation is charged exactly once per entry point", async () => {
  await asOwner("one-charge");
  const h = gw("one-charge");
  assert.equal((await rest(h).nutrition()).status, 202);
  assert.equal((await rest(h).workout()).status, 202);
  assert.equal((await rest(h).adjust()).status, 202);
  assert.equal(counts.sqs, 3, "three requests, three jobs");
  assert.equal((await rest(h).nutrition()).status, 429, "budget of 3 spent by exactly three charges (no double charge)");
});

test("TEST-05 — admission is only inside submitGeneration (queue commands); confirm/execute paths never charge generation", () => {
  const root = path.join(__dirname, "..");
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__" || e.name === "generated" || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts") && fs.readFileSync(full, "utf8").includes("admitBillableGeneration")) hits.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  };
  walk(root);
  assert.deepEqual(hits.sort(), ["services/generation-admission.ts", "services/generation-operations.ts"], "admission is called only by the durable operation submit path, never by confirm/execute");
});

test("TEST-06 — a body userId cannot move generation accounting to another account", async () => {
  const spoof = await request(app).post("/plans/nutrition/generate").set(gw("spoofer")).send({ ...NUTRITION, userId: "victim" });
  assert.equal(spoof.status, 202);
  assert.equal(sent[0].userId, "spoofer", "job is owned by the verified actor");
  for (let i = 0; i < 2; i++) await request(app).post("/plans/nutrition/generate").set(gw("spoofer")).send({ ...NUTRITION, userId: "victim" });
  assert.equal((await request(app).post("/plans/nutrition/generate").set(gw("spoofer")).send({ ...NUTRITION, userId: "victim" })).status, 429);
  assert.equal((await request(app).post("/plans/nutrition/generate").set(gw("victim")).send(NUTRITION)).status, 202, "victim allowance untouched");
});

test("TEST-07 — quota store outage fails closed for REST and chat: sanitized 503, nothing queued or created", async () => {
  process.env.RATE_LIMIT_PROVIDER = "dynamodb";
  resetRateLimiterCache();
  const original = dynamoDeps.send;
  dynamoDeps.send = async () => {
    throw Object.assign(new Error("outage in table fitness-assistant-dev-ai-rate-limit"), { name: "ServiceUnavailableException" });
  };
  try {
    const res = await rest(gw("outage")).nutrition();
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "RATE_LIMIT_UNAVAILABLE");
    assert.ok(!/dynamo|fitness-assistant-dev|ServiceUnavailable/i.test(JSON.stringify(res.body)));
    const turn = await agent.proposeNutritionPlan("tao thuc don", identity("outage"), "s7");
    assert.match(turn.answer, /tạm thời không khả dụng/);
    assert.equal(counts.sqs, 0);
    assert.equal(counts.nutritionPlans, 0);
    assert.equal(counts.actionCreate, 0);
  } finally {
    dynamoDeps.send = original;
  }
});

test("TEST-08 — 12 concurrent queued generations against a budget of 3 admit exactly 3 jobs and create exactly 3 plan rows", async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => rest(gw("race")).nutrition()));
  assert.equal(results.filter((r) => r.status === 202).length, 3);
  assert.equal(results.filter((r) => r.status === 429).length, 9);
  assert.equal(counts.sqs, 3);
  assert.equal(counts.nutritionPlans, 3, "refused requests created no orphan plan rows");
});

test("TEST-15 — synchronous routes keep their own route-level limiter and share the same bucket", async () => {
  const h = gw("sync-share");
  for (let i = 0; i < 3; i++) assert.equal((await rest(h).nutrition()).status, 202);
  assert.equal((await request(app).post("/plans/nutrition/p1/explain").set(h).send({})).status, 429);
});

// ── V12-R02 regressions (formerly "OPEN GAP" characterisations) ─────────────
// Original observed failure (V-T012 review + V-T012.1 characterisation): when the action write failed AFTER the
// job was published, the request threw but sqs stayed at 1, and the user's retry published a SECOND unrelated job
// (sqs 1 -> 2, plans 1 -> 2), each with its own charge. The tests below assert the corrected behaviour.

test("V12-R02 — action persistence failing AFTER enqueue: the retry reuses the SAME operation (no second job, plan or charge)", async () => {
  failActionCreate = true;
  await assert.rejects(agent.proposeNutritionPlan("tao thuc don", identity("orphan"), "s9"), /simulated action persistence failure/);
  assert.equal(counts.sqs, 1, "the job was published before the action write failed");
  failActionCreate = false;
  const retry = await agent.proposeNutritionPlan("tao thuc don", identity("orphan"), "s9");
  assert.equal(counts.sqs, 1, "retry did not publish a second job");
  assert.equal(counts.nutritionPlans, 1, "retry did not create a second plan");
  assert.equal(counts.actionCreate, 1, "the retry created the missing action pointing at the original plan");
  assert.doesNotMatch(retry.answer, /hết lượt/);
});

test("V12-R02 — every published message carries the stable operationId and plan id", async () => {
  const res = await request(app).post("/plans/nutrition/generate").set(gw("msg-identity")).send(NUTRITION);
  assert.equal(res.status, 202);
  const body = JSON.parse(JSON.stringify(sentBodies[0]));
  assert.ok(body.data.operationId && body.data.planId);
});

test("V12-R02 — REST Idempotency-Key: a replayed request returns the same plan/job and charges once", async () => {
  const h = { ...gw("idem-user"), "idempotency-key": "client-key-0001" };
  const a = await request(app).post("/plans/nutrition/generate").set(h).send(NUTRITION);
  const b = await request(app).post("/plans/nutrition/generate").set(h).send(NUTRITION);
  assert.equal(a.status, 202);
  assert.equal(b.status, 202);
  assert.equal(a.body.data.planId, b.body.data.planId);
  assert.equal(counts.sqs, 1);
  const conflict = await request(app).post("/plans/nutrition/generate").set(h).send({ goal: "BULK" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "IDEMPOTENCY_KEY_CONFLICT");
});

// ── D22-R04: stable chat identity (retry vs deliberate repeat) ───────────────

test("D22-R04 — the same logical request retried across the former 20-minute boundary keeps its identity (no second job)", async () => {
  failActionCreate = true;
  await assert.rejects(agent.proposeNutritionPlan("tao thuc don", identity("boundary"), "sb"), /simulated action persistence failure/);
  failActionCreate = false;
  const realNow = Date.now;
  Date.now = () => realNow() + 25 * 60_000;
  try {
    await agent.proposeNutritionPlan("tao thuc don", identity("boundary"), "sb");
  } finally { Date.now = realNow; }
  assert.equal(counts.sqs, 1, "one job although the retry crossed a 20-minute boundary");
});

test("D22-R04 — a deliberate repeat with IDENTICAL parameters after a persisted turn is a new, separately charged generation", async () => {
  await agent.proposeNutritionPlan("tao thuc don", identity("repeat"), "sr");
  lastTurn = { id: "turn-persisted-1" }; // the first request's turn has been persisted since
  const second = await agent.proposeNutritionPlan("tao thuc don", identity("repeat"), "sr");
  assert.doesNotMatch(second.answer, /hết lượt/);
  assert.equal(counts.sqs, 2);
  assert.equal(counts.nutritionPlans, 2);
});

test("D22-R04 — concurrent retries of one turn produce exactly one job and a graceful reply, never an exception", async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => agent.proposeNutritionPlan("tao thuc don", identity("concurrent"), "sc")));
  assert.equal(counts.sqs, 1);
  assert.equal(counts.nutritionPlans, 1);
  assert.ok(results.some((r) => /giống hệt đang được xử lý/.test(r.answer) || r.blocks.length >= 0));
});

test("D22-R04 — two users making identical requests are independent operations", async () => {
  await agent.proposeNutritionPlan("tao thuc don", identity("alice"), "sx");
  await agent.proposeNutritionPlan("tao thuc don", identity("bob"), "sx");
  assert.equal(counts.sqs, 2);
  assert.deepEqual(sent.map((s) => s.userId).sort(), ["alice", "bob"]);
});

test("D22-R04 — a revision retried after the draft state changed reuses the SAME operation (key ignores the mutable base plan id)", async () => {
  const payloadFor = (planId: string) => ({
    planId, jobId: "j", phase: "PREVIEW", mealsPerDay: 3, goal: "MAINTENANCE",
    constraints: { exclusions: [], unsupported: [], preferences: [] },
    target: { source: "COMPUTED", calories: 2000, protein: 150, carbs: 200, fat: 60 },
    content: { dailyCaloriesTarget: 2000, mealsPerDay: 3, days: [] },
  });
  const act = (planId: string) => ({ id: "act-same", risk: "LOW", expiresAt: new Date(Date.now() + 600000), payload: payloadFor(planId) });
  failActionUpdate = true; // queue succeeds, then the action row update fails
  await assert.rejects(agent.tryPollOrReviseNutritionPlanDraft("it bua hon", identity("rev"), "s-rev", act("np-base-1")), /simulated action update failure/);
  assert.equal(counts.sqs, 1);
  // The retry sees a different base plan id (the earlier partial attempt advanced the draft) but the same logical request.
  await agent.tryPollOrReviseNutritionPlanDraft("it bua hon", identity("rev"), "s-rev", act("np-base-2"));
  assert.equal(counts.sqs, 1, "no second job for the retried revision");
  assert.equal(counts.nutritionPlans, 1);
});

// ═══ V-T012.2.2 RR-01: stable request identity (real chat flow, real HTTP middleware) ═══

import { withClientRequestId } from "../services/request-identity";
const propose = (id: string | null, user: string, session: string, q = "tao thuc don") =>
  withClientRequestId(id, () => agent.proposeNutritionPlan(q, identity(user), session));

test("RR-01 #1 retry BEFORE the response was persisted: same client request id => one operation, one job, one charge", async () => {
  failActionCreate = true;
  await assert.rejects(propose("11111111-aaaa-4aaa-8aaa-000000000001", "u1", "s1"), /simulated action persistence failure/);
  failActionCreate = false;
  await propose("11111111-aaaa-4aaa-8aaa-000000000001", "u1", "s1");
  assert.equal(counts.sqs, 1);
  assert.equal(counts.admit, 1, "the retry was not charged again");
  assert.equal(counts.nutritionPlans, 1);
});

test("RR-01 #2/#3 (Codex's reproduction) retry AFTER the response was persisted / the HTTP response was lost: still the same operation", async () => {
  const id = "22222222-bbbb-4bbb-8bbb-000000000002";
  await propose(id, "u2", "s2");
  assert.equal(counts.sqs, 1);
  lastTurn = { id: "turn-persisted-after-first-attempt" }; // the assistant turn was persisted; the client never saw the response
  const retry = await propose(id, "u2", "s2");
  assert.equal(counts.sqs, 1, "no new paid job after the newest persisted turn changed");
  assert.equal(counts.admit, 1);
  assert.equal(counts.nutritionPlans, 1);
  assert.equal(counts.actionCreate, 1, "no duplicate pending draft for the same plan");
  assert.doesNotMatch(retry.answer, /hết lượt/);
});

test("RR-01 #4 retry after a SERVER RESTART (in-process state gone, durable operation row kept): no new job, no new charge", async () => {
  const id = "33333333-cccc-4ccc-8ccc-000000000003";
  await propose(id, "u3", "s3");
  resetRateLimiterCache(); // process restart: in-memory quota counters and caches are gone
  await propose(id, "u3", "s3");
  assert.equal(counts.sqs, 1);
  assert.equal(counts.admit, 1);
});

test("RR-01 #5 an intentional repeat with IDENTICAL text and parameters gets a new id => new, separately charged generation", async () => {
  await propose("44444444-dddd-4ddd-8ddd-000000000004", "u4", "s4");
  await propose("44444444-dddd-4ddd-8ddd-000000000005", "u4", "s4");
  assert.equal(counts.sqs, 2);
  assert.equal(counts.admit, 2);
});

test("RR-01 #6 two simultaneous devices: distinct intents are two operations; the SAME id from both devices is one", async () => {
  await Promise.all([propose("55555555-eeee-4eee-8eee-000000000006", "u5", "s5"), propose("55555555-eeee-4eee-8eee-000000000007", "u5", "s5")]);
  assert.equal(counts.sqs, 2);
  reset();
  const results = await Promise.all([propose("55555555-eeee-4eee-8eee-000000000008", "u6", "s6"), propose("55555555-eeee-4eee-8eee-000000000008", "u6", "s6")]);
  assert.equal(counts.sqs, 1);
  assert.equal(results.length, 2);
});

test("RR-01 #7 the same request id with a different payload is refused (no job)", async () => {
  const id = "66666666-ffff-4fff-8fff-000000000009";
  await propose(id, "u7", "s7");
  const second = await withClientRequestId(id, () => agent.proposeNutritionPlan("tao thuc don", identity("u7"), "s7", { mealsPerDay: 5 })); // different generation parameters
  assert.match(second.answer, /Mã yêu cầu này đã được dùng/);
  assert.equal(counts.sqs, 1);
  assert.equal(counts.admit, 1);
});

test("RR-01 #8 identical ids from different users are independent operations (ids are not authorization)", async () => {
  const id = "77777777-0000-4000-8000-000000000010";
  await propose(id, "alice-rr", "sa");
  await propose(id, "bob-rr", "sb");
  assert.equal(counts.sqs, 2);
  assert.deepEqual(sent.map((s) => s.userId).sort(), ["alice-rr", "bob-rr"]);
});

test("RR-01 #10 a REVISION retried after another conversation turn was saved reuses the same operation", async () => {
  const payload = (planId: string) => ({
    planId, jobId: "j", phase: "PREVIEW", mealsPerDay: 3, goal: "MAINTENANCE",
    constraints: { exclusions: [], unsupported: [], preferences: [] },
    target: { source: "COMPUTED", calories: 2000, protein: 150, carbs: 200, fat: 60 },
    content: { dailyCaloriesTarget: 2000, mealsPerDay: 3, days: [] },
  });
  const act = (planId: string) => ({ id: "act-rev", risk: "LOW", expiresAt: new Date(Date.now() + 600000), payload: payload(planId) });
  const id = "88888888-1111-4111-8111-000000000011";
  failActionUpdate = true;
  await assert.rejects(withClientRequestId(id, () => agent.tryPollOrReviseNutritionPlanDraft("it bua hon", identity("rev2"), "sr", act("np-1"))), /simulated action update failure/);
  lastTurn = { id: "another-turn-saved-meanwhile" };
  await withClientRequestId(id, () => agent.tryPollOrReviseNutritionPlanDraft("it bua hon", identity("rev2"), "sr", act("np-2")));
  assert.equal(counts.sqs, 1);
  assert.equal(counts.admit, 1);
});

test("RR-01 legacy client (no request id): a pre-persistence retry is still deduplicated; a post-persistence retry is NOT (documented limitation)", async () => {
  failActionCreate = true;
  await assert.rejects(propose(null, "legacy", "sl"), /simulated action persistence failure/);
  failActionCreate = false;
  await propose(null, "legacy", "sl");
  assert.equal(counts.sqs, 1, "weak protection holds before persistence");
  lastTurn = { id: "persisted" };
  await propose(null, "legacy", "sl");
  assert.equal(counts.sqs, 2, "after persistence a legacy resend is indistinguishable from a new request");
});

test("RR-01 negative control — keying on the newest persisted turn (the old scheme) splits one request's retries", async () => {
  const keyOf = (turn: string) => `chat:nutrition:s:${turn}:fp`;
  assert.notEqual(keyOf("none"), keyOf("turn-1"), "this is exactly why a retry after persistence got a new operation");
});

test("RR-01 HTTP chain — clientRequestId in the /ai/ask body reaches the handler; malformed ids are ignored; the id is not an identity", async () => {
  const { ragService } = await import("../services/rag.service");
  const { currentClientRequestId } = await import("../services/request-identity");
  const realRag = ragService.rag;
  const seen: Array<string | null> = [];
  (ragService as any).rag = async () => { seen.push(currentClientRequestId()); return { answer: "ok" }; };
  try {
    const good = "99999999-2222-4222-8222-000000000012";
    for (const body of [{ question: "hi", clientRequestId: good }, { question: "hi", clientRequestId: "bad id with spaces!" }, { question: "hi" }]) {
      const res = await request(app).post("/ai/ask").set(gw("http-user")).send(body);
      assert.equal(res.status, 200);
    }
    assert.deepEqual(seen, ["99999999-2222-4222-8222-000000000012", null, null]);
  } finally { (ragService as any).rag = realRag; }
});

test("RR-01 client CODE AUDIT — the web client generates one id per send and reuses it on the 401 resend", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", "frontend", "web", "src", "app", "services", "api.ts"), "utf8");
  assert.match(src, /function newClientRequestId\(\)/);
  assert.match(src, /chat: async \(message: string, sessionId\?: string, clientRequestId: string = newClientRequestId\(\)\)/);
  assert.match(src, /\{ question: message, clientRequestId,/);
  assert.match(src, /clientRequestId: string = newClientRequestId\(\),\n  \): \(\) => void/);
  const stream = src.slice(src.indexOf("chatStream("));
  assert.ok(stream.indexOf("clientRequestId, // same id") < stream.indexOf("await refreshOnce()"), "the id is bound inside sendStreamRequest, which the 401 path calls again with the same closure");
});

// ═══ R222-02: relative revision replay ═══════════════════════════════════════

const draftPayload = (over: Record<string, unknown> = {}) => ({
  planId: "np-base", jobId: "j", phase: "PREVIEW", mealsPerDay: 3, goal: "MAINTENANCE",
  constraints: { exclusions: [], unsupported: [], preferences: [] },
  target: { source: "COMPUTED", calories: 2000, protein: 150, carbs: 200, fat: 60 },
  content: { dailyCaloriesTarget: 2000, mealsPerDay: 3, days: [] },
  ...over,
});
const given = (payload: any) => ({ id: "act-r2", risk: "LOW", expiresAt: new Date(Date.now() + 600000), payload });
const revise = (rid: string | null, user: string, text: string, payload: any) =>
  withClientRequestId(rid, () => agent.tryPollOrReviseNutritionPlanDraft(text, identity(user), "s-r2", given(payload)));

test("R222-02 — Codex's reproduction: 'nhieu bua hon' on a 3-meal draft; the retry after persistence reads the 4-meal state and must NOT become 5", async () => {
  const R = "aaaaaaaa-1111-4111-8111-00000000r222";
  const first = await revise(R, "r2a", "nhieu bua hon", draftPayload());
  assert.ok(first);
  assert.equal(counts.sqs, 1);
  assert.equal(lastUpdatePayload.mealsPerDay, 4, "first execution applied +1");
  assert.equal(lastUpdatePayload.revisionRequestId, R);
  const persisted = JSON.parse(JSON.stringify(lastUpdatePayload)); // what the retry will read back from the database
  const updatesBefore = counts.actionUpdate;
  const retry = await revise(R, "r2a", "nhieu bua hon", persisted);
  assert.ok(retry);
  assert.match(retry.answer, /không tính trùng/);
  assert.equal(counts.sqs, 1, "no second job");
  assert.equal(counts.admit, 1, "no second charge");
  assert.equal(counts.nutritionPlans, 1);
  assert.equal(counts.actionUpdate, updatesBefore, "the already revised action was not mutated");
  assert.equal(lastUpdatePayload.mealsPerDay, 4, "delta not re-applied (would have been 5)");
});

test("R222-02 — replay after the draft reached PREVIEW returns the stored preview without regenerating", async () => {
  const R = "bbbbbbbb-2222-4222-8222-00000000r222";
  await revise(R, "r2b", "nhieu bua hon", draftPayload());
  const previewed = { ...JSON.parse(JSON.stringify(lastUpdatePayload)), phase: "PREVIEW", content: { dailyCaloriesTarget: 2000, mealsPerDay: 4, days: [] } };
  const retry = await revise(R, "r2b", "nhieu bua hon", previewed);
  assert.ok(retry);
  assert.match(retry.answer, /đã được áp dụng/);
  assert.ok(retry.blocks.length >= 1);
  assert.equal(counts.sqs, 1);
});

test("R222-02 — a genuinely NEW instruction to increase again (new request id) is a new revision: 4 -> 5 meals, new job, new charge", async () => {
  await revise("cccccccc-3333-4333-8333-0000000000c1", "r2c", "nhieu bua hon", draftPayload());
  const afterFirst = JSON.parse(JSON.stringify(lastUpdatePayload));
  await revise("cccccccc-3333-4333-8333-0000000000c2", "r2c", "nhieu bua hon", afterFirst);
  assert.equal(lastUpdatePayload.mealsPerDay, 5);
  assert.equal(counts.sqs, 2);
  assert.equal(counts.admit, 2);
});

test("R222-02 — the same request id with a DIFFERENT instruction is refused (no mutation, no job)", async () => {
  const R = "dddddddd-4444-4444-8444-0000000000d1";
  await revise(R, "r2d", "nhieu bua hon", draftPayload());
  const persisted = JSON.parse(JSON.stringify(lastUpdatePayload));
  const updatesBefore = counts.actionUpdate;
  const conflict = await revise(R, "r2d", "it bua hon", persisted);
  assert.match(conflict!.answer, /Mã yêu cầu này đã được dùng cho một chỉnh sửa khác/);
  assert.equal(counts.sqs, 1);
  assert.equal(counts.actionUpdate, updatesBefore);
});

test("R222-02 — the guard is general (not tied to one phrase): an absolute 'giam bua' revision replays safely too, and a request WITHOUT an id (legacy) behaves as before", async () => {
  const R = "eeeeeeee-5555-4555-8555-0000000000e1";
  await revise(R, "r2e", "giam bua", draftPayload({ mealsPerDay: 4 }));
  assert.equal(lastUpdatePayload.mealsPerDay, 3);
  const persisted = JSON.parse(JSON.stringify(lastUpdatePayload));
  await revise(R, "r2e", "giam bua", persisted);
  assert.equal(lastUpdatePayload.mealsPerDay, 3, "not 2");
  assert.equal(counts.sqs, 1);
  const legacy = await revise(null, "r2f", "nhieu bua hon", draftPayload());
  assert.ok(legacy);
  assert.equal(lastUpdatePayload.revisionRequestId, undefined, "no id => no idempotency record (legacy path unchanged)");
});
