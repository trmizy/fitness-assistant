/**
 * V-T012 — AI endpoint caller policy + shared cost budget.
 *
 * Mounts the REAL ai-service `app` (real requireAuth, real routers, real requireTrustedService,
 * real createRateLimiter and the real shared buckets in middleware/ai-rate-limiters.ts). Only the
 * things that would reach a paid model, the queue or a database are replaced: the controllers /
 * service methods behind the routes are stubbed to count how many requests were ADMITTED, and a
 * tripwire on `llmService.callLLM` proves no model call was made. No network, no Bedrock.
 *
 * Limits are set small via env BEFORE the app is imported (the buckets read env at import time):
 * 3 per window for every tier.
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "3";
process.env.AI_EXPENSIVE_RATE_LIMIT_MAX = "3";
process.env.AI_INTERNAL_RATE_LIMIT_MAX = "3";
process.env.AI_ASK_RATE_LIMIT_WINDOW_SECONDS = "60";
process.env.AI_EXPENSIVE_RATE_LIMIT_WINDOW_SECONDS = "86400";
process.env.AI_INTERNAL_RATE_LIMIT_WINDOW_SECONDS = "60";
delete process.env.RATE_LIMIT_PROVIDER;

const SECRET = "test-internal-secret";

/** How many requests actually reached the (stubbed) handler behind each route. */
const reached: Record<string, number> = {};
let modelCalls = 0;
let app: Express;
let planImprovementService: any;
let prismaClient: any;
let resetRateLimiterCache: () => void;
let dynamoDeps: any;
let authServiceClientDeps: any;

const INTERNAL_ROUTES = [
  { name: "analyze-cycle", path: "/ai/analyze-cycle" },
  { name: "assess-cycle", path: "/ai/assess-cycle" },
  { name: "analyze-feedback", path: "/ai/analyze-feedback" },
  { name: "generate-client-plan-draft", path: "/ai/generate-client-plan-draft" },
  { name: "generate-roadmap-draft", path: "/ai/generate-roadmap-draft" },
  { name: "explain-exercise-progression", path: "/ai/explain-exercise-progression" },
];

/** A genuine service-to-service call: secret + originating user, NO end-user bearer. */
const svc = (userId: string) => ({ "x-internal-token": SECRET, "x-user-id": userId });
/** The Express gateway forwarding a logged-in user: it stamps the secret on every proxied request
 * AND forwards the user's bearer. */
const gw = (userId: string, role = "CUSTOMER") => ({
  ...svc(userId),
  "x-user-role": role,
  Authorization: "Bearer user-session-token",
});
/** A user hitting ai-service directly with only a JWT (verified against auth-service). */
const jwtOnly = (token: string) => ({ Authorization: `Bearer ${token}` });

const PLAN_UUID = "11111111-1111-4111-8111-111111111111";
/** Valid bodies for routes that validate BEFORE the (command-level) admission. */
const VALID_BODY: Record<string, object> = {
  "/plans/workout/generate": { goal: "STRENGTH", durationWeeks: 4, daysPerWeek: 3 },
  "/plans/nutrition/generate": { goal: "MAINTENANCE" },
  "/plans/adjust": { planId: PLAN_UUID, adjustments: "more volume please" },
};
const bodyFor = (p: string): object => VALID_BODY[p] ?? {};
let admit: (userId: string) => Promise<void>;
/** Queued-generation controllers stand in for the real commands, which call admitBillableGeneration (V-T012.1). */
const admittingStub = (name: string) => async (req: any, res: any, next: any) => {
  try {
    await admit(req.context.userId);
  } catch (err) {
    return next(err);
  }
  stub(name)(req, res);
};

const stub = (name: string) => (_req: any, res: any) => {
  reached[name] = (reached[name] ?? 0) + 1;
  res.status(200).json({ success: true, data: { handler: name } });
};

test.before(async () => {
  // The model tripwire — any real LLM call during this suite fails the suite.
  const { llmService } = await import("../services/llm.service");
  (llmService as any).callLLM = async () => {
    modelCalls++;
    throw new Error("TRIPWIRE: a real model call was attempted");
  };

  // Stub every handler a gated route would reach. Must happen BEFORE the routers are imported
  // (a router captures `controller.method` at registration time).
  const { aiController } = await import("../controllers/ai.controller");
  const { planController } = await import("../controllers/plan.controller");
  const { cycleAnalysisController } = await import("../controllers/cycle-analysis.controller");
  const { cycleAssessmentController } = await import("../controllers/cycle-assessment.controller");
  const { feedbackAnalysisController } = await import("../controllers/feedback-analysis.controller");
  const { clientPlanDraftController } = await import("../controllers/client-plan-draft.controller");
  const { roadmapDraftController } = await import("../controllers/roadmap-draft.controller");
  const { exerciseProgressionExplanationController } = await import(
    "../controllers/exercise-progression-explanation.controller"
  );
  const { adminController } = await import("../controllers/admin.controller");
  ({ admitBillableGeneration: admit } = await import("../services/generation-admission"));

  (aiController as any).ask = stub("ask");
  (aiController as any).askStream = stub("ask-stream");
  (aiController as any).generateWorkout = stub("generate-workout");
  (planController as any).generatePlan = admittingStub("plans-workout-generate");
  (planController as any).generateNutritionPlan = admittingStub("plans-nutrition-generate");
  (planController as any).adjustPlan = admittingStub("plans-adjust");
  (planController as any).explainPlan = stub("plans-explain");
  (planController as any).explainNutritionPlan = stub("plans-nutrition-explain");
  (planController as any).adjustNutritionPlan = admittingStub("plans-nutrition-adjust");
  (cycleAnalysisController as any).analyzeCycle = stub("analyze-cycle");
  (cycleAssessmentController as any).assessCycle = stub("assess-cycle");
  (feedbackAnalysisController as any).analyzeFeedback = stub("analyze-feedback");
  (clientPlanDraftController as any).generateDraft = stub("generate-client-plan-draft");
  (roadmapDraftController as any).generateDraft = stub("generate-roadmap-draft");
  (exerciseProgressionExplanationController as any).explain = stub("explain-exercise-progression");
  (adminController as any).enqueueKnowledgePipeline = stub("admin-knowledge-job");
  (adminController as any).approveKnowledgeReviewItem = stub("admin-knowledge-approve");

  // Marketplace improvement suggestions: keep the REAL controller + REAL service (so the real
  // ownership check runs) and stub only the DB reads and the model call beneath it.
  ({ planImprovementService } = await import("../services/plan-improvement.service"));
  ({ prismaClient } = { prismaClient: (await import("../repositories/conversation.repository")).prisma });
  prismaClient.publishedPlan.findUnique = async ({ where }: any) =>
    where.id === "listing-owned-by-owner-1"
      ? { id: where.id, publisherId: "owner-1", title: "Plan", goal: "STRENGTH" }
      : null;
  prismaClient.planReview.findMany = async () => [];
  prismaClient.planImprovementSuggestion.create = async () => ({ id: "s1" });
  planImprovementService.generateSuggestions = async () => {
    reached["improvement-suggestions"] = (reached["improvement-suggestions"] ?? 0) + 1;
    return { suggestions: [] };
  };

  // Pure end-user JWT path: token -> verified user, without a reachable auth-service.
  ({ authServiceClientDeps } = await import("../clients/auth-service.client"));
  authServiceClientDeps.verify = async (token: string) => {
    const users: Record<string, { id: string; role: string }> = {
      "jwt-user-a": { id: "jwt-user-a", role: "CUSTOMER" },
      "jwt-user-b": { id: "jwt-user-b", role: "CUSTOMER" },
      "jwt-pt": { id: "jwt-pt", role: "PT" },
    };
    const user = users[token];
    if (!user) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { data: { user } };
  };

  ({ resetRateLimiterCache } = await import("../services/rate-limit/provider"));
  ({ dynamoRateLimiterDeps: dynamoDeps } = await import("../services/rate-limit/dynamodb-rate-limiter"));
  app = (await import("../app")).default;
});

test.afterEach(() => {
  delete process.env.RATE_LIMIT_PROVIDER;
  resetRateLimiterCache();
});

test.after(() => {
  assert.equal(modelCalls, 0, "TEST-15: no real model call was made anywhere in this suite");
});

// ── TEST-01 public quota enforcement ────────────────────────────────────────

test("TEST-01/13 — a public AI route admits exactly the budget (one charge per request), then 429 with Retry-After", async () => {
  const headers = gw("quota-user-1");
  const before = reached["plans-nutrition-explain"] ?? 0;
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await request(app).post("/plans/nutrition/p1/explain").set(headers).send({});
    statuses.push(res.status);
    if (res.status === 429) {
      assert.ok(res.headers["retry-after"], "Retry-After surfaced from the limiter");
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, "RATE_LIMITED");
    }
  }
  assert.deepEqual(statuses, [200, 200, 200, 429], "3 admitted, the 4th refused — never a fake 200");
  assert.equal((reached["plans-nutrition-explain"] ?? 0) - before, 3, "refused request never reached the handler");
});

test("TEST-01 — the refactor kept /ai/ask and /ai/ask/stream on their own shared 'ai-ask' bucket", async () => {
  const headers = gw("ask-user-1");
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const path = i % 2 === 0 ? "/ai/ask" : "/ai/ask/stream";
    out.push((await request(app).post(path).set(headers).send({})).status);
  }
  // validateBody rejects {} with 400 AFTER the limiter, so 400 = admitted, 429 = refused.
  assert.deepEqual(out, [400, 400, 400, 429]);
});

// ── TEST-02 alternate endpoint cannot bypass the shared budget ──────────────

test("TEST-02 — exhausting 'ai-expensive' on one route refuses every other expensive route (incl. vision + marketplace)", async () => {
  const headers = gw("bypass-user-1");
  for (let i = 0; i < 3; i++) {
    assert.equal((await request(app).post("/plans/nutrition/p1/explain").set(headers).send({})).status, 200);
  }
  const alternates: Array<[string, string]> = [
    ["POST", "/ai/generate-workout"],
    ["POST", "/plans/workout/generate"],
    ["POST", "/plans/nutrition/generate"],
    ["POST", "/plans/explain"],
    ["POST", "/plans/adjust"],
    ["POST", "/plans/nutrition/p1/adjust"],
    ["POST", "/ai/agent/goal-image"],
    ["POST", "/ai/agent/image-chat"],
    ["POST", "/marketplace/plans/listing-owned-by-owner-1/improvement-suggestions"],
  ];
  const handlerCallsBefore = JSON.stringify(reached);
  for (const [, path] of alternates) {
    const res = await request(app).post(path).set(headers).send(bodyFor(path));
    assert.equal(res.status, 429, `${path} must share the exhausted bucket`);
  }
  assert.equal(JSON.stringify(reached), handlerCallsBefore, "no refused request reached any handler / queue / model");
});

test("TEST-02 (reverse) — burning the budget through a queued route (admitted in the command) refuses the sync and other routes", async () => {
  const headers = gw("bypass-user-2");
  for (let i = 0; i < 3; i++) {
    assert.equal((await request(app).post("/plans/workout/generate").set(headers).send(bodyFor("/plans/workout/generate"))).status, 200);
  }
  assert.equal((await request(app).post("/ai/generate-workout").set(headers).send({})).status, 429);
  assert.equal((await request(app).post("/plans/nutrition/p1/explain").set(headers).send({})).status, 429);
});

test("TEST-02 — the 'ai-ask' chat budget and the 'ai-expensive' budget are separate (chat is not collateral damage)", async () => {
  const headers = gw("bypass-user-3");
  for (let i = 0; i < 3; i++) await request(app).post("/plans/nutrition/p1/explain").set(headers).send({});
  assert.equal((await request(app).post("/plans/nutrition/p1/explain").set(headers).send({})).status, 429);
  assert.equal((await request(app).post("/ai/ask").set(headers).send({})).status, 400, "ask still admitted");
});

// ── TEST-03 / TEST-04 isolation + spoofing ──────────────────────────────────

test("TEST-03 — user A exhausting a budget does not touch user B", async () => {
  for (let i = 0; i < 3; i++) await request(app).post("/plans/nutrition/p1/explain").set(gw("iso-a")).send({});
  assert.equal((await request(app).post("/plans/nutrition/p1/explain").set(gw("iso-a")).send({})).status, 429);
  assert.equal((await request(app).post("/plans/nutrition/p1/explain").set(gw("iso-b")).send({})).status, 200);
});

test("TEST-04 — a body userId or a spoofed x-user-id cannot move quota onto (or off) another account", async () => {
  // Verified JWT user A, no internal token: identity comes from the verified token, and a forged
  // x-user-id naming user B is ignored.
  for (let i = 0; i < 3; i++) {
    const res = await request(app)
      .post("/plans/nutrition/p1/explain")
      .set({ ...jwtOnly("jwt-user-a"), "x-user-id": "jwt-user-b" })
      .send({ userId: "jwt-user-b" });
    assert.equal(res.status, 200);
  }
  const exhausted = await request(app)
    .post("/plans/nutrition/p1/explain")
    .set({ ...jwtOnly("jwt-user-a"), "x-user-id": "jwt-user-b" })
    .send({ userId: "jwt-user-b" });
  assert.equal(exhausted.status, 429, "A is charged for A's own requests despite claiming to be B");
  const victim = await request(app).post("/plans/nutrition/p1/explain").set(jwtOnly("jwt-user-b")).send({});
  assert.equal(victim.status, 200, "B's allowance is untouched");
});

// ── TEST-05 / 06 / 07 service-only endpoints ────────────────────────────────

test("TEST-05 — an ordinary end-user JWT is refused (403) on every service-only route and nothing runs", async () => {
  for (const r of INTERNAL_ROUTES) {
    const before = reached[r.name] ?? 0;
    const res = await request(app).post(r.path).set(jwtOnly("jwt-user-a")).send({ userId: "jwt-user-a" });
    assert.equal(res.status, 403, `${r.path}`);
    assert.equal(reached[r.name] ?? 0, before, `${r.path} handler must not run`);
  }
});

test("TEST-05 — a PT-role JWT is not a service either", async () => {
  const res = await request(app).post("/ai/generate-client-plan-draft").set(jwtOnly("jwt-pt")).send({});
  assert.equal(res.status, 403);
});

test("TEST-05 — a user coming through the gateway (secret stamped + user's bearer forwarded) is refused too", async () => {
  for (const r of INTERNAL_ROUTES) {
    const res = await request(app).post(r.path).set(gw("gateway-user-1")).send({ userId: "someone-else" });
    assert.equal(res.status, 403, `${r.path} via gateway must be refused`);
  }
});

test("TEST-06 — a genuine service call (secret + x-user-id, no bearer) still reaches every route", async () => {
  // One originating user per route: the six routes share ONE 'ai-internal' budget per user (the
  // next test proves that), so reusing a single user here would trip the suite's tiny limit of 3.
  for (const r of INTERNAL_ROUTES) {
    const before = reached[r.name] ?? 0;
    const user = `svc-user-ok-${r.name}`;
    const res = await request(app).post(r.path).set(svc(user)).send({ userId: user });
    assert.equal(res.status, 200, `${r.path}`);
    assert.equal((reached[r.name] ?? 0) - before, 1);
  }
});

test("TEST-07 — forged service identity is rejected", async () => {
  const a = await request(app).post("/ai/analyze-cycle").set({ "x-internal-token": "wrong", "x-user-id": "u" }).send({});
  assert.equal(a.status, 401, "wrong secret, no bearer");
  const b = await request(app)
    .post("/ai/analyze-cycle")
    .set({ "x-internal-token": "wrong", "x-user-id": "u", "x-user-role": "ADMIN", ...jwtOnly("jwt-user-a") })
    .send({});
  assert.equal(b.status, 403, "wrong secret + valid JWT is a plain user, header claims ignored");
  const c = await request(app).post("/ai/analyze-cycle").set({ "x-user-id": "u", "x-user-role": "ADMIN" }).send({});
  assert.equal(c.status, 401, "identity headers alone prove nothing when a secret is configured");
  const d = await request(app).post("/ai/analyze-cycle").set({ "x-service-name": "fitness-service", "x-user-id": "u" }).send({});
  assert.equal(d.status, 401, "an invented service-name header is not a credential");
});

test("TEST-07 — the 'internal' bucket is keyed on the verified originating user, never the body userId", async () => {
  // Exhaust service user S through one route while the body claims a different victim.
  for (let i = 0; i < 3; i++) {
    const r = INTERNAL_ROUTES[i % INTERNAL_ROUTES.length];
    assert.equal((await request(app).post(r.path).set(svc("svc-s")).send({ userId: "svc-victim" })).status, 200);
  }
  // Any other service route is now refused for S (one shared 'ai-internal' budget)...
  assert.equal(
    (await request(app).post("/ai/explain-exercise-progression").set(svc("svc-s")).send({ userId: "svc-victim" })).status,
    429,
  );
  // ...and the body-named victim was never charged.
  assert.equal((await request(app).post("/ai/analyze-cycle").set(svc("svc-victim")).send({})).status, 200);
});

// ── TEST-08 PT / ownership at the owning boundary ───────────────────────────

test("TEST-08 — marketplace improvement suggestions: only the publisher passes the ownership check (and no model call otherwise)", async () => {
  const path = "/marketplace/plans/listing-owned-by-owner-1/improvement-suggestions";
  const before = reached["improvement-suggestions"] ?? 0;
  const other = await request(app).post(path).set(gw("not-the-owner", "PT")).send({});
  assert.equal(other.status, 403);
  assert.equal(other.body.error.code, "PUBLISHED_PLAN_FORBIDDEN");
  assert.equal(reached["improvement-suggestions"] ?? 0, before, "the model is never invoked for a non-owner");
  const owner = await request(app).post(path).set(gw("owner-1", "PT")).send({});
  assert.equal(owner.status, 201);
  assert.equal((reached["improvement-suggestions"] ?? 0) - before, 1);
});

// ── TEST-09 limiter outage ──────────────────────────────────────────────────

test("TEST-09 — a quota-store outage fails CLOSED (sanitized 503) on public, service-only and marketplace routes", async () => {
  process.env.RATE_LIMIT_PROVIDER = "dynamodb";
  resetRateLimiterCache();
  const originalSend = dynamoDeps.send;
  dynamoDeps.send = async () => {
    throw Object.assign(new Error("simulated DynamoDB outage in table fitness-assistant-dev-ai-rate-limit"), {
      name: "ServiceUnavailableException",
    });
  };
  try {
    const snapshot = JSON.stringify(reached);
    const targets: Array<[string, any]> = [
      ["/plans/workout/generate", gw("outage-user")],
      ["/plans/nutrition/p1/explain", gw("outage-user")],
      ["/ai/generate-workout", gw("outage-user")],
      ["/ai/analyze-cycle", svc("outage-user")],
      ["/marketplace/plans/listing-owned-by-owner-1/improvement-suggestions", gw("owner-1", "PT")],
    ];
    for (const [path, headers] of targets) {
      const res = await request(app).post(path).set(headers).send(bodyFor(path));
      assert.equal(res.status, 503, path);
      assert.equal(res.body.error.code, "RATE_LIMIT_UNAVAILABLE");
      assert.ok(!/dynamo|fitness-assistant-dev|ServiceUnavailable/i.test(JSON.stringify(res.body)), "no infra detail leaks");
    }
    assert.equal(JSON.stringify(reached), snapshot, "an outage never turns into unmetered model access");
  } finally {
    dynamoDeps.send = originalSend;
  }
});

// ── TEST-10 parallel requests ───────────────────────────────────────────────

test("TEST-10 — 12 parallel requests against a budget of 3 admit exactly 3 (memory provider)", async () => {
  const before = reached["plans-nutrition-explain"] ?? 0;
  const results = await Promise.all(
    Array.from({ length: 12 }, () => request(app).post("/plans/nutrition/p1/explain").set(gw("race-mem")).send({})),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 3);
  assert.equal(results.filter((r) => r.status === 429).length, 9);
  assert.equal((reached["plans-nutrition-explain"] ?? 0) - before, 3);
});

test("TEST-10 — 12 parallel requests admit exactly 3 against an atomic DynamoDB-style counter, across routes", async () => {
  process.env.RATE_LIMIT_PROVIDER = "dynamodb";
  resetRateLimiterCache();
  const items = new Map<string, number>();
  const originalSend = dynamoDeps.send;
  // Same atomic increment-and-read the real UpdateItem performs (see rate-limit.test.ts).
  dynamoDeps.send = async (command: any) => {
    const key = command.input.Key.key as string;
    const count = (items.get(key) ?? 0) + 1;
    items.set(key, count);
    return { Attributes: { count, expiresAt: command.input.ExpressionAttributeValues[":expiresAt"] } };
  };
  try {
    const paths = ["/plans/nutrition/p1/explain", "/plans/nutrition/p1/adjust", "/plans/explain", "/plans/adjust"];
    const before = (reached["plans-nutrition-explain"] ?? 0) + (reached["plans-nutrition-adjust"] ?? 0);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        request(app).post(paths[i % 2]).set(gw("race-ddb")).send({}),
      ),
    );
    assert.equal(results.filter((r) => r.status === 200).length, 3);
    assert.equal(results.filter((r) => r.status === 429).length, 9);
    const after = (reached["plans-nutrition-explain"] ?? 0) + (reached["plans-nutrition-adjust"] ?? 0);
    assert.equal(after - before, 3);
    assert.deepEqual([...items.keys()].map((k) => k.replace(/:\d+$/, "")), ["ai-expensive:race-ddb"], "one shared counter, keyed by the verified user");
  } finally {
    dynamoDeps.send = originalSend;
  }
});

// ── TEST-12 async / queued work ─────────────────────────────────────────────

test("TEST-12 — queue-enqueueing routes are behind the shared budget: a refused request creates no job and no plan row", async () => {
  const headers = gw("async-user");
  for (let i = 0; i < 3; i++) await request(app).post("/plans/nutrition/p1/adjust").set(headers).send({});
  const snapshot = JSON.stringify(reached);
  for (const path of ["/plans/workout/generate", "/plans/nutrition/generate", "/plans/adjust", "/plans/nutrition/p1/adjust"]) {
    assert.equal((await request(app).post(path).set(headers).send(bodyFor(path))).status, 429, path);
  }
  assert.equal(JSON.stringify(reached), snapshot, "no controller (which would create the plan row and enqueue) ran");
});

// ── TEST-14 admin / background ──────────────────────────────────────────────

test("TEST-14 — non-admins cannot trigger knowledge ingestion / embedding; an admin can", async () => {
  const before = reached["admin-knowledge-job"] ?? 0;
  const approveBefore = reached["admin-knowledge-approve"] ?? 0;
  for (const headers of [gw("cust-1", "CUSTOMER"), gw("pt-1", "PT"), jwtOnly("jwt-user-a"), svc("svc-no-role")]) {
    assert.equal((await request(app).post("/admin/ai/knowledge/jobs/local").set(headers).send({})).status, 403);
    assert.equal((await request(app).post("/admin/ai/knowledge/review/r1/approve").set(headers).send({})).status, 403);
  }
  assert.equal(reached["admin-knowledge-job"] ?? 0, before);
  assert.equal(reached["admin-knowledge-approve"] ?? 0, approveBefore);
  assert.equal((await request(app).post("/admin/ai/knowledge/jobs/local").set(gw("admin-1", "ADMIN")).send({})).status, 200);
  assert.equal((await request(app).post("/admin/ai/knowledge/review/r1/approve").set(gw("admin-1", "ADMIN")).send({})).status, 200);
});

test("TEST-14 — /internal/* stays secret-gated and unmetered by design (no user quota)", async () => {
  const anon = await request(app).post("/internal/knowledge/anything").send({});
  assert.ok([401, 403, 404].includes(anon.status), `unauthenticated internal call refused (got ${anon.status})`);
});

// ── TEST-11 existing flows unaffected ───────────────────────────────────────

test("TEST-11 — routes that must stay open to authorized callers still respond (non-billable GETs unmetered)", async () => {
  const headers = gw("flow-user");
  for (let i = 0; i < 6; i++) {
    const res = await request(app).get("/plans/llm-health").set(headers);
    assert.notEqual(res.status, 429, "llm-health is NO_BILLABLE_INFERENCE and must never be throttled");
  }
});
