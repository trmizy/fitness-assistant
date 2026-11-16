/**
 * M9.3-T2 Task A — the REAL V1 AI Coach code path over HTTP, with only the EXTERNAL boundaries replaced.
 *
 * REAL (production code, not stubbed here): the ai-service `app`, requireAuth, the shared ask rate limiter, AskRequestSchema validation,
 * bindRequestIdentity, the bridge middleware (flag OFF / not eligible), `aiController.ask` / `askStream`, `ragService.rag`
 * (idempotency replay, session create, persist), `conversationRepository`, `llmOrchestrator.run` (safety gate, intent routing, the V1
 * fitness agent incl. its confirmation boundary, prompt building, validators), the session routes + controller.
 * REPLACED (external boundaries only): the Prisma client delegates (in-memory, see v1-real-path-fakes.ts; DATABASE_URL is an
 * unreachable dummy so any un-faked DB call would throw), `llmService.callLLM` (scripted text, counted), the embedding call (blocked →
 * retrieval degraded, no Qdrant), auth-token verification, the HTTP transport of the profile read (axios adapter). fetch / Bedrock are
 * blocked and counted. No database, Qdrant, model, Redis or network is touched.
 *
 * Evidence label: CONTROLLER INTEGRATION with fake external dependencies. It is not a REAL HTTP / REAL BROWSER run of a deployed V1.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/coach-v1-real-path.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import request from "supertest";
import express from "express";
import { pathToFileURL } from "node:url";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from "axios";

process.env.LLM_PROVIDER = "mock";
process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/never_connected"; // any real Prisma call fails fast
process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "10000";
process.env.LOG_LEVEL = "silent";
process.env.USER_SERVICE_URL = "http://user-service.v1real.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.v1real.invalid";
for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AI_COACH_V2_BRIDGE", "AI_COACH_V2_BRIDGE_USERS", "AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED"]) delete process.env[k];

import type { FakeDb } from "./v1-real-path-fakes";

const SRC = path.resolve(__dirname, "..");
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const Q = "Protein giúp gì cho cơ bắp?";
const FAKE_ANSWER = "Protein giúp xây dựng và phục hồi cơ bắp, nên ăn đủ đạm mỗi ngày.";

const counters = { fetch: 0, bedrock: 0, llm: 0, embed: 0, rag: 0, orch: 0 };
/** Every HTTP call the V1 path made. They all hit the FAKE transport (no socket); we assert the hosts are the two internal service names only. */
const httpCalls: string[] = [];
const llmPrompts: string[] = [];
let db: FakeDb;
let app: express.Express;
let installFake: (typeof import("./v1-real-path-fakes"))["installFakePrisma"];
let prisma: any;
let modelNames: string[];
let seam: typeof import("../services/coach-bridge.middleware")["coachBridgeSeam"];
let loaderCalls = 0;

const adapter: AxiosAdapter = async (config) => {
  const url = String(config.url ?? "");
  const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
  const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "").replace(/^Bearer /, "");
  const respond = (status: number, data: unknown): AxiosResponse => {
    const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config, request: {} };
    if (!config.validateStatus || config.validateStatus(status)) return response;
    throw new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response);
  };
  if (url.endsWith("/profile/me") && TOKENS[auth]) return respond(200, { profile: { userId: TOKENS[auth], age: 30, hasCompletedOnboarding: true } });
  httpCalls.push(url);
  return respond(404, { error: "not mocked" });
};

function resetDb(): void { db = installFake(prisma, modelNames); }

test.before(async () => {
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { counters.fetch++; throw new Error("network blocked"); }) as typeof fetch;
  const { bedrockRuntimeDeps } = await import("../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { counters.bedrock++; throw new Error("provider blocked"); }) as never;
  const { authServiceClientDeps } = await import("../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => {
    const id = TOKENS[token];
    if (!id) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { status: 200, data: { user: { id, role: "CUSTOMER" } } };
  }) as never;
  ({ prisma } = await import("../repositories/conversation.repository"));
  const { Prisma } = await import("../generated/prisma");
  modelNames = Object.values(Prisma.ModelName).map((n) => n[0].toLowerCase() + n.slice(1));
  ({ installFakePrisma: installFake } = await import("./v1-real-path-fakes"));
  const { llmService } = await import("../services/llm.service");
  (llmService as any).callLLM = async (prompt: string) => { counters.llm++; llmPrompts.push(prompt); return { answer: FAKE_ANSWER, promptTokens: 5, completionTokens: 7, totalTokens: 12 }; };
  (llmService as any).generateEmbedding = async () => { counters.embed++; throw new Error("embedding blocked (no Qdrant)"); };
  // COUNT (do not replace) the real V1 entry points: they must be reached by the request
  const { ragService } = await import("../services/rag.service");
  const origRag = ragService.rag.bind(ragService);
  (ragService as any).rag = (...a: Parameters<typeof origRag>) => { counters.rag++; return origRag(...a); };
  const { llmOrchestrator } = await import("../llm/orchestrator.service");
  const origRun = llmOrchestrator.run.bind(llmOrchestrator);
  (llmOrchestrator as any).run = (...a: Parameters<typeof origRun>) => { counters.orch++; return origRun(...a); };
  ({ default: app } = await import("../app"));
  seam = (await import("../services/coach-bridge.middleware")).coachBridgeSeam;
  const loader = seam.loadExecutor;
  seam.loadExecutor = async () => { loaderCalls++; return loader!(); };
  resetDb();
});
test.after(() => { delete process.env.AI_COACH_V2_BRIDGE; delete process.env.AI_COACH_V2_BRIDGE_USERS; delete process.env.AI_AGENT_V2; seam.ports = null; seam.overrides = {}; });
test.beforeEach(() => { for (const k of Object.keys(counters) as Array<keyof typeof counters>) if (k !== "fetch" && k !== "bedrock") counters[k] = 0; llmPrompts.length = 0; loaderCalls = 0; resetDb(); });

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let n = 0;
const key = () => `v1real-${++n}-00000001`;
const ask = (t: string, body: object) => request(app).post("/ai/ask").set(bearer(t)).send(body);
const parseSse = (text: string) => text.split("\n\n").map((b) => b.trim()).filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5).trim()) as { type: string } & Record<string, unknown>);

// ── Task A.1/A.2/A.5: the request really enters the V1 controller + RAG orchestration ────────────────────────────────────────
test("V1R-1 bridge flag OFF: POST /ai/ask enters the REAL controller → ragService.rag → llmOrchestrator.run → model boundary → persisted turn; V1 response contract", async () => {
  const id = key();
  const r = await ask("tok-a", { question: Q, clientRequestId: id });
  assert.equal(r.status, 200); assert.equal(r.body.success, true);
  assert.equal(counters.rag, 1, "ragService.rag was called by the real controller"); assert.equal(counters.orch, 1, "the real orchestrator ran");
  assert.ok(counters.llm >= 1, "the orchestrator reached the (fake) model boundary"); assert.ok(llmPrompts.some((p) => p.includes(Q)), "the prompt carries the user's question");
  const d = r.body.data;
  for (const k of ["conversationId", "sessionId", "question", "answer", "modelUsed", "responseTime", "promptTokens", "completionTokens", "totalTokens", "traceId", "responseLanguage", "usedFallback", "missingFields", "validationNotes", "recommendation"]) assert.ok(k in d, `V1 field ${k}`);
  assert.equal(d.answer, FAKE_ANSWER); assert.equal(d.question, Q);
  assert.equal("engine" in d, false); assert.equal("v2" in d, false);
  assert.equal(db.sessions.length, 1); assert.equal(db.conversations.length, 1);
  assert.deepEqual([db.conversations[0].userId, db.conversations[0].sessionId, db.conversations[0].clientRequestId, db.conversations[0].question, db.conversations[0].answer], [USER_A, d.sessionId, id, Q, FAKE_ANSWER]);
  assert.equal(db.sessions[0].title, Q.slice(0, 60));
  assert.equal(loaderCalls, 0, "the V2 runtime was never loaded"); assert.equal(counters.fetch + counters.bedrock, 0, "no fetch / Bedrock call");
});

// ── Task A.3: SSE contract ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("V1R-2 POST /ai/ask/stream: SSE contract (headers, event order, token payload key, done payload keys) over the real controller + orchestrator", async () => {
  const r = await request(app).post("/ai/ask/stream").set(bearer("tok-a")).send({ question: Q, clientRequestId: key() });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/event-stream/); assert.equal(r.headers["cache-control"], "no-cache, no-transform"); assert.equal(r.headers["x-accel-buffering"], "no");
  const ev = parseSse(r.text);
  const types = ev.map((e) => e.type);
  assert.ok(types.every((t) => ["status", "token", "done"].includes(t)), `only status/token/done events: ${types.join(",")}`);
  assert.equal(types[types.length - 1], "done"); assert.equal(types.filter((t) => t === "done").length, 1);
  assert.ok(types.includes("token")); assert.ok(types.indexOf("token") < types.indexOf("done"));
  const tokens = ev.filter((e) => e.type === "token");
  for (const t of tokens) assert.equal(typeof t.content, "string", "token events carry `content`");
  assert.equal(tokens.map((t) => t.content).join(""), db.conversations[0].answer, "streamed text == the persisted answer");
  const done = ev[ev.length - 1];
  for (const k of ["conversationId", "sessionId", "evidenceUsed", "adjustmentReasons", "safetyNotes"]) assert.ok(k in done, `done.${k}`);
  // structuredBlocks is serialized only when the orchestrator produced blocks (undefined is dropped by JSON); the client defaults it to []
  assert.ok(!("structuredBlocks" in done) || Array.isArray(done.structuredBlocks));
  assert.ok(Array.isArray(done.evidenceUsed) && Array.isArray(done.adjustmentReasons) && Array.isArray(done.safetyNotes));
  assert.equal(done.sessionId, db.sessions[0].id); assert.equal("engine" in done, false);
  assert.equal(counters.rag, 1); assert.equal(counters.orch, 1);
});

// ── Task A.4: session / history contract ───────────────────────────────────────────────────────────────────────────────────────
test("V1R-3 session/history contract: sidebar list, messages, per-user ownership, second turn appended to the same session", async () => {
  const first = await ask("tok-a", { question: Q, clientRequestId: key() });
  const sid = first.body.data.sessionId as string;
  const second = await ask("tok-a", { question: "Còn creatine thì sao?", clientRequestId: key(), sessionId: sid });
  assert.equal(second.status, 200); assert.equal(second.body.data.sessionId, sid);
  const list = await request(app).get("/ai/sessions").set(bearer("tok-a"));
  assert.equal(list.status, 200); assert.deepEqual(list.body.data.sessions.map((s: { id: string }) => s.id), [sid]);
  assert.equal(list.body.data.sessions[0].title, Q.slice(0, 60));
  const msgs = await request(app).get(`/ai/sessions/${sid}/messages`).set(bearer("tok-a"));
  assert.equal(msgs.status, 200); assert.deepEqual(msgs.body.data.messages.map((m: { question: string }) => m.question), [Q, "Còn creatine thì sao?"]);
  for (const m of msgs.body.data.messages) { assert.equal(typeof m.answer, "string"); assert.ok(m.id); assert.equal(m.modelUsed !== undefined, true, "history rows carry modelUsed"); }
  assert.equal((await request(app).get(`/ai/sessions/${sid}/messages`).set(bearer("tok-b"))).status, 403);
  assert.equal((await request(app).get("/ai/sessions/99999999-9999-4999-8999-999999999999/messages").set(bearer("tok-a"))).status, 404);
  assert.deepEqual((await request(app).get("/ai/sessions").set(bearer("tok-b"))).body.data.sessions, [], "another user sees none of it");
  assert.equal(db.conversations.length, 2);
});

// ── Task A.5: a valid V1-only case through the real fitness agent (no model call) ─────────────────────────────────────────────
test("V1R-4 V1-only capability: a bare confirmation is answered by the REAL V1 fitness-agent confirmation boundary (no model), also when the bridge is ON and the user is eligible", async () => {
  const run = async () => ask("tok-a", { question: "Xác nhận", clientRequestId: key() });
  const off = await run();
  assert.equal(off.status, 200); assert.equal(counters.rag, 1); assert.equal(counters.orch, 1);
  assert.equal(counters.llm, 0, "answered deterministically by the agent, not the model"); assert.ok(off.body.data.answer.length > 0); assert.equal("engine" in off.body.data, false);
  // bridge ON + allowlisted + ports present → still V1 (V1-only capability); V2 runtime never loaded
  const { fakeStore, fakeHistory } = await import("./coach-continuity-fakes");
  process.env.AI_COACH_V2_BRIDGE = "on"; process.env.AI_COACH_V2_BRIDGE_USERS = USER_A; process.env.AI_AGENT_V2 = "on";
  seam.ports = { idempotency: fakeStore().store, history: fakeHistory().history };
  counters.rag = 0; counters.orch = 0;
  try {
    const on = await run();
    assert.equal(on.status, 200); assert.equal(counters.rag, 1); assert.equal(counters.orch, 1); assert.equal(loaderCalls, 0); assert.equal("engine" in on.body.data, false);
    assert.equal(counters.llm, 0);
  } finally { delete process.env.AI_COACH_V2_BRIDGE; delete process.env.AI_COACH_V2_BRIDGE_USERS; delete process.env.AI_AGENT_V2; seam.ports = null; }
});

// ── V1's own idempotency (must be untouched) ────────────────────────────────────────────────────────────────────────────────────
test("V1R-5 V1 idempotency over the real chain: same id replays (one model run, one turn), different message → 409, another user is separate", async () => {
  const id = key();
  const a = await ask("tok-a", { question: Q, clientRequestId: id });
  const llm1 = counters.llm;
  const again = await ask("tok-a", { question: Q, clientRequestId: id });
  assert.equal(again.status, 200); assert.equal(again.body.data.answer, a.body.data.answer); assert.equal(again.body.data.conversationId, a.body.data.conversationId); assert.equal(again.body.data.sessionId, a.body.data.sessionId);
  assert.equal(counters.llm, llm1, "no second model call"); assert.equal(db.conversations.length, 1); assert.equal(db.sessions.length, 1);
  const conflict = await ask("tok-a", { question: "Một câu hoàn toàn khác", clientRequestId: id });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, "IDEMPOTENCY_KEY_CONFLICT");
  const other = await ask("tok-b", { question: Q, clientRequestId: id });
  assert.equal(other.status, 200); assert.notEqual(other.body.data.conversationId, a.body.data.conversationId); assert.equal(db.conversations.length, 2);
});

// ── Task A.6: controlled comparison with the baseline V1 route chain ──────────────────────────────────────────────────────────
const BASE = "a6b517cd";
const BASELINE_FILE = path.join(SRC, "routes", "__baseline_ai_routes.tmp.ts");
const normalize = (body: any) => {
  const copy = JSON.parse(JSON.stringify(body));
  const d = copy?.data ?? copy;
  for (const k of ["responseTime", "timing", "traceId"]) if (d && typeof d === "object") delete d[k];
  return JSON.parse(JSON.stringify(copy).replace(UUID, "<uuid>"));
};
test("V1R-6 baseline comparison: the SAME requests through the current app (bridge OFF and bridge ON-but-ineligible) and through the route chain of the pre-bridge baseline commit give identical normalized V1 responses (JSON + SSE)", async () => {
  const root = path.resolve(SRC, "..", "..", "..", "..");
  const rel = "backend/services/ai-service/src/routes/ai.routes.ts";
  const src = execFileSync("git", ["show", `${BASE}:${rel}`], { cwd: root, encoding: "utf8" });
  assert.doesNotMatch(src, /coachBridge|coach-bridge/, "the baseline route chain has no bridge");
  fs.writeFileSync(BASELINE_FILE, src);
  try {
    const router = (await import(pathToFileURL(BASELINE_FILE).href)).default as express.Router;
    const baseline = express(); baseline.use(express.json()); baseline.use("/ai", router);
    const bodies = [
      { question: Q, clientRequestId: "cmp-1-00000001" },
      { question: "Tôi nên ăn gì trước khi tập?", clientRequestId: "cmp-2-00000001" },
      { question: "Xác nhận", clientRequestId: "cmp-3-00000001" },
    ];
    const collect = async (target: express.Express, headers: Record<string, string>) => {
      resetDb();
      const out: unknown[] = [];
      for (const b of bodies) { const r = await request(target).post("/ai/ask").set(bearer("tok-a")).set(headers).send(b); out.push({ status: r.status, body: normalize(r.body) }); }
      const s = await request(target).post("/ai/ask/stream").set(bearer("tok-a")).send({ question: Q, clientRequestId: "cmp-4-00000001" });
      const ev = parseSse(s.text);
      out.push({ status: s.status, types: ev.map((e) => e.type), text: ev.filter((e) => e.type === "token").map((e) => e.content).join(""), doneKeys: Object.keys(ev[ev.length - 1]).sort() });
      out.push({ rows: db.conversations.map((c) => [c.question, c.answer, c.modelUsed, c.usedFallback, c.routeIntent ?? null, c.responseLanguage ?? null]) });
      return out;
    };
    const base = await collect(baseline, {});
    const current = await collect(app, {});
    assert.deepEqual(current, base, "bridge OFF: identical to the baseline chain");
    process.env.AI_COACH_V2_BRIDGE = "on"; process.env.AI_COACH_V2_BRIDGE_USERS = USER_B; // ON, but user A is not on the list
    try { assert.deepEqual(await collect(app, {}), base, "bridge ON but not eligible: identical to the baseline chain"); }
    finally { delete process.env.AI_COACH_V2_BRIDGE; delete process.env.AI_COACH_V2_BRIDGE_USERS; }
    assert.equal((base[0] as { status: number }).status, 200);
  } finally { fs.rmSync(BASELINE_FILE, { force: true }); }
});

// ── Task A.7 / invariants ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("V1R-7 nothing external was used and no un-faked DB call happened: only counted fakes; the dummy DATABASE_URL was never needed", () => {
  assert.equal(counters.fetch, 0); assert.equal(counters.bedrock, 0);
  assert.ok(httpCalls.length > 0, "the V1 path does read user/fitness data (through the fake transport)");
  const hosts = new Set(httpCalls.map((u) => new URL(u).host));
  assert.deepEqual([...hosts].sort(), ["fitness-service.v1real.invalid", "user-service.v1real.invalid"].filter((h) => hosts.has(h)), "only the two internal service names, all on the .invalid TLD → nothing resolvable, no socket");
  assert.equal(fs.existsSync(BASELINE_FILE), false, "the temporary baseline route file was removed");
});
