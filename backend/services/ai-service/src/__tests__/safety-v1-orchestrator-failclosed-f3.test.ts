/**
 * M9.5-T1B-F3 — V1 ORCHESTRATOR FAIL-CLOSED. The REAL V1 path over HTTP (app, requireAuth, rate limiter, schema, aiController.ask / askStream, ragService.rag, llmOrchestrator.run,
 * the real Safety Guard) with only the EXTERNAL boundaries replaced (in-memory Prisma, counted fake model, blocked embedding / fetch / Bedrock, fake profile transport).
 *
 * Evidence label: CONTROLLER INTEGRATION with fake external dependencies — NOT a REAL HTTP / REAL BROWSER run of a deployed V1.
 * Verdict provenance is labelled in every test title:
 *   [REAL STATE]       the real guard + real engine produce the blocking verdict from a synthetic sentence (no injection);
 *   [FAULT INJECTION]  the verdict is injected at the `safetyGuard.check` boundary (the engine cannot be made to fail on demand) to prove the ORCHESTRATOR's behaviour independently.
 * What is pinned: a verdict that forbids coaching (`emergency_unassessable`, `input_too_long`) stops BEFORE the model, retrieval, tools, the V1 agent, profile reads and the turn write;
 * JSON answers with a structured error, SSE ends with an `error` event (never `token` / `done`); a valid emergency and an ordinary question behave exactly as before.
 * NOT pinned / NOT claimed: the DB work that ragService does BEFORE the gate (T1A-7d), the V1 session row created before the gate, the SSE wording (controller, out of scope).
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/safety-v1-orchestrator-failclosed-f3.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type express from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from "axios";

process.env.LLM_PROVIDER = "mock";
process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/never_connected";
process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "100000";
process.env.LOG_LEVEL = "silent";
process.env.USER_SERVICE_URL = "http://user-service.f3.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.f3.invalid";
for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AI_COACH_V2_BRIDGE", "AI_COACH_V2_BRIDGE_USERS", "AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED", "ENABLE_TOOL_CALLING"]) delete process.env[k];

import type { FakeDb } from "./v1-real-path-fakes";
import { safetyGuard, emergencyReplyForKind, type SafetyResult } from "../llm/safety_guard";

const USER_A = "11111111-1111-4111-8111-111111111111";
const FAKE_ANSWER = "MODEL-GENERATED-ANSWER: protein giúp xây dựng và phục hồi cơ bắp.";
const BENIGN = "Protein giúp gì cho cơ bắp?";
const AMBIGUOUS = "My friend and my colleague were running. They are overheated. He is confused."; // real engine state: AMBIGUOUS_REFERENCE
const EMERGENCY = "Tôi muốn tự tử.";
const NEUTRAL_VI = "Mình không thể hỗ trợ yêu cầu này một cách an toàn";
const CHEST_PAIN_REPLY = "Dừng tập ngay";
const SELF_HARM_REPLY = "Mình rất tiếc khi nghe bạn";

const c = { fetch: 0, bedrock: 0, llm: 0, embed: 0, agentTurns: 0, rag: 0, orch: 0, profileReads: 0, otherHttp: 0 };
let db: FakeDb; let app: express.Express; let prisma: any; let modelNames: string[]; let installFake: (typeof import("./v1-real-path-fakes"))["installFakePrisma"];
const adapter: AxiosAdapter = async (config) => {
  const url = String(config.url ?? ""); const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
  const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "").replace(/^Bearer /, "");
  const respond = (status: number, data: unknown): AxiosResponse => { const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config, request: {} }; if (!config.validateStatus || config.validateStatus(status)) return response; throw new AxiosError(`status ${status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response); };
  if (url.endsWith("/profile/me") && auth === "tok-a") { c.profileReads++; return respond(200, { profile: { userId: USER_A, age: 30, hasCompletedOnboarding: true } }); }
  c.otherHttp++; return respond(404, { error: "not mocked" });
};
const injected = new Map<string, SafetyResult>();
let origCheck: typeof safetyGuard.check;

test.before(async () => {
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { c.fetch++; throw new Error("network blocked"); }) as typeof fetch;
  const { bedrockRuntimeDeps } = await import("../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { c.bedrock++; throw new Error("provider blocked"); }) as never;
  const { authServiceClientDeps } = await import("../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => { if (token !== "tok-a") throw Object.assign(new Error("invalid"), { response: { status: 401 } }); return { status: 200, data: { user: { id: USER_A, role: "CUSTOMER" } } }; }) as never;
  ({ prisma } = await import("../repositories/conversation.repository"));
  const { Prisma } = await import("../generated/prisma");
  modelNames = Object.values(Prisma.ModelName).map((n) => n[0].toLowerCase() + n.slice(1));
  ({ installFakePrisma: installFake } = await import("./v1-real-path-fakes"));
  const { llmService } = await import("../services/llm.service");
  (llmService as any).callLLM = async () => { c.llm++; return { answer: FAKE_ANSWER, promptTokens: 5, completionTokens: 7, totalTokens: 12 }; };
  (llmService as any).generateEmbedding = async () => { c.embed++; throw new Error("embedding blocked (no Qdrant)"); };
  const { fitnessAgent } = await import("../services/fitness-agent.service");
  const origTurn = fitnessAgent.tryTurn.bind(fitnessAgent); (fitnessAgent as any).tryTurn = (...a: Parameters<typeof origTurn>) => { c.agentTurns++; return origTurn(...a); };
  const { ragService } = await import("../services/rag.service");
  const origRag = ragService.rag.bind(ragService); (ragService as any).rag = (...a: Parameters<typeof origRag>) => { c.rag++; return origRag(...a); };
  const { llmOrchestrator } = await import("../llm/orchestrator.service");
  const origRun = llmOrchestrator.run.bind(llmOrchestrator); (llmOrchestrator as any).run = (...a: Parameters<typeof origRun>) => { c.orch++; return origRun(...a); };
  origCheck = safetyGuard.check.bind(safetyGuard);
  (safetyGuard as any).check = (q: string, o?: Parameters<typeof origCheck>[1]) => injected.get(q) ?? origCheck(q, o);
  ({ default: app } = await import("../app"));
  db = installFake(prisma, modelNames);
});
test.after(() => { (safetyGuard as any).check = origCheck; });
test.beforeEach(() => { for (const k of Object.keys(c) as Array<keyof typeof c>) if (k !== "fetch" && k !== "bedrock") c[k] = 0; injected.clear(); db = installFake(prisma, modelNames); });

let n = 0; const key = () => `f3-${++n}-00000001`;
const bearer = { Authorization: "Bearer tok-a" };
const askJson = (question: string) => request(app).post("/ai/ask").set(bearer).send({ question, clientRequestId: key() });
const askSse = (question: string) => request(app).post("/ai/ask/stream").set(bearer).send({ question, clientRequestId: key() });
const parseSse = (text: string) => text.split("\n\n").map((b) => b.trim()).filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5).trim()) as { type: string } & Record<string, unknown>);

/** the model, retrieval, tools, the V1 agent, the profile and the network were not touched */
function assertNothingDownstream(label: string) {
  assert.equal(c.llm, 0, `${label}: model calls`); assert.equal(c.embed, 0, `${label}: retrieval / embedding calls`); assert.equal(c.agentTurns, 0, `${label}: V1 agent / tool turns`);
  assert.equal(c.profileReads, 0, `${label}: profile reads`); assert.equal(c.otherHttp, 0, `${label}: other service reads`); assert.equal(c.fetch + c.bedrock, 0, `${label}: network / Bedrock`);
}
/** no completed coaching turn was stored: the turn write (conversation.create) never happened, and nothing was retried (one rag call, one orchestrator run) */
function assertNoTurnStored(label: string) {
  assert.equal(db.conversations.length, 0, `${label}: stored conversation turns`); assert.ok(!db.writes.some((w) => /^conversation\.create$/.test(w)), `${label}: turn write`);
  assert.equal(c.rag, 1, `${label}: one attempt only (no retry)`); assert.equal(c.orch, 1, `${label}: one orchestrator run`);
}

const BLOCKING: Array<{ name: string; question: string; inject?: SafetyResult; jsonStatus: number; jsonCode: string }> = [
  { name: "[REAL STATE] emergency_unassessable (AMBIGUOUS_REFERENCE from the real guard + engine)", question: AMBIGUOUS, jsonStatus: 503, jsonCode: "SERVICE_UNAVAILABLE" },
  { name: "[FAULT INJECTION] emergency_unassessable / INTERNAL_ERROR", question: "f3 fault internal error", inject: { type: "emergency_unassessable", messageVi: NEUTRAL_VI + ". Hãy trao đổi với bác sĩ hoặc chuyên gia.", messageEn: "I can't help with this request safely.", reason: "INTERNAL_ERROR" }, jsonStatus: 503, jsonCode: "SERVICE_UNAVAILABLE" },
  { name: "[FAULT INJECTION] input_too_long", question: "f3 fault input too long", inject: { type: "input_too_long", messageVi: NEUTRAL_VI + ". Hãy trao đổi với bác sĩ hoặc chuyên gia.", messageEn: "I can't help with this request safely.", reason: "INPUT_LIMIT" }, jsonStatus: 400, jsonCode: "VALIDATION_ERROR" },
  { name: "[FAULT INJECTION] invalid assessment → the REAL adapter's own blocking reply for an unsupported state", question: "f3 fault unsupported state", inject: emergencyReplyForKind("future_kind"), jsonStatus: 503, jsonCode: "SERVICE_UNAVAILABLE" },
];

for (const b of BLOCKING) {
  test(`F3-JSON ${b.name}: HTTP error contract, model / retrieval / tools / agent / profile = 0, no turn stored, no retry`, async () => {
    if (b.inject) injected.set(b.question, b.inject);
    assert.ok(["emergency_unassessable", "input_too_long"].includes((safetyGuard.check(b.question) as any).type), "the guard really returns a blocking verdict for this input");
    const r = await askJson(b.question);
    assert.equal(r.status, b.jsonStatus, `downstream={llm:${c.llm},embed:${c.embed},agentTurns:${c.agentTurns},profileReads:${c.profileReads}} ${JSON.stringify(r.body).slice(0, 160)}`); assert.equal(r.body.success, false); assert.equal(r.body.error.code, b.jsonCode);
    assert.ok(String(r.body.error.message).length > 0); assert.ok(!JSON.stringify(r.body).includes(FAKE_ANSWER), "no model text"); assert.ok(!("data" in r.body) || !r.body.data?.answer, "not an answer");
    assert.ok(!String(r.body.error.message).includes(CHEST_PAIN_REPLY) && !String(r.body.error.message).includes(SELF_HARM_REPLY), "no emergency template for a technical state");
    assert.ok(!JSON.stringify(r.body).includes(b.question.slice(0, 20)), "the question is not echoed");
    assertNothingDownstream("JSON"); assertNoTurnStored("JSON");
  });
  test(`F3-SSE ${b.name}: ends with an error event — never token, never done —, model / retrieval / tools / agent / profile = 0, no turn stored, no retry`, async () => {
    if (b.inject) injected.set(b.question, b.inject);
    const r = await askSse(b.question);
    assert.equal(r.status, 200, "an SSE response commits its 200 before the work: the failure is an `error` event"); assert.match(r.headers["content-type"], /text\/event-stream/);
    const ev = parseSse(r.text); const types = ev.map((e) => e.type);
    assert.ok(!types.includes("token"), `no token: downstream={llm:${c.llm},embed:${c.embed},agentTurns:${c.agentTurns},profileReads:${c.profileReads}} events=${types.join(",")}`); assert.ok(!types.includes("done"), `no done: ${types.join(",")}`);
    assert.equal(types.filter((t) => t === "error").length, 1, types.join(",")); assert.equal(types[types.length - 1], "error", "the stream terminates with the error event");
    assert.ok(!r.text.includes(FAKE_ANSWER), "no model text"); assert.ok(typeof ev[ev.length - 1].message === "string");
    assertNothingDownstream("SSE"); assertNoTurnStored("SSE");
  });
}

// ── controls: behaviour that must NOT change ──
test("F3-CTRL-JSON a VALID emergency keeps its reply as the ANSWER (HTTP 200, guard text, 0 model calls) — emergency precedence is untouched", async () => {
  const r = await askJson(EMERGENCY); assert.equal(r.status, 200); assert.equal(r.body.success, true);
  assert.ok(r.body.data.answer.includes(SELF_HARM_REPLY), "the self-harm reply is the answer"); assert.ok(!r.body.data.answer.includes(CHEST_PAIN_REPLY));
  assert.equal(c.llm, 0); assert.equal(c.embed, 0); assert.equal(c.agentTurns, 0); assert.equal(db.conversations.length, 1, "the safety-gate reply is stored as before");
});
test("F3-CTRL-SSE a VALID emergency streams its reply as tokens + done, as before", async () => {
  const r = await askSse(EMERGENCY); const ev = parseSse(r.text); const types = ev.map((e) => e.type);
  assert.ok(types.includes("token") && types[types.length - 1] === "done" && !types.includes("error"), types.join(","));
  assert.ok(ev.filter((e) => e.type === "token").map((e) => e.content).join("").includes(SELF_HARM_REPLY)); assert.equal(c.llm, 0);
});
test("F3-CTRL-JSON an ordinary question is answered by the model exactly as at baseline (session + conversation stored)", async () => {
  const r = await askJson(BENIGN); assert.equal(r.status, 200); assert.equal(r.body.data.answer, FAKE_ANSWER); assert.ok(c.llm >= 1);
  assert.equal(db.sessions.length, 1); assert.equal(db.conversations.length, 1); assert.equal(db.conversations[0].answer, FAKE_ANSWER);
});
test("F3-CTRL-SSE an ordinary question streams tokens then done, with the model's answer", async () => {
  const r = await askSse(BENIGN); const ev = parseSse(r.text); const types = ev.map((e) => e.type);
  assert.ok(types.includes("token") && types[types.length - 1] === "done" && !types.includes("error"), types.join(","));
  assert.equal(ev.filter((e) => e.type === "token").map((e) => e.content).join(""), FAKE_ANSWER); assert.ok(c.llm >= 1); assert.equal(db.conversations.length, 1);
});
test("F3-CTRL-LIMIT a payload over 2 000 UTF-16 units is still refused by the schema before the model (HTTP 400 VALIDATION_ERROR; the orchestrator is not reached); 2 000 passes", async () => {
  const long = await askJson("a".repeat(2001)); assert.equal(long.status, 400); assert.equal(long.body.error.code, "VALIDATION_ERROR"); assert.equal(c.rag, 0); assert.equal(c.orch, 0); assert.equal(c.llm, 0);
  const sse = await askSse("a".repeat(2001)); assert.equal(sse.status, 400); assert.equal(c.llm, 0);
  const edge = await askJson("a".repeat(2000)); assert.notEqual(edge.status, 400, "exactly the limit is accepted by the schema");
});
