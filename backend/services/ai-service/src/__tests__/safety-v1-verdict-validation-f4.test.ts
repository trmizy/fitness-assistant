/**
 * M9.5-T1B-F4 — RUNTIME VALIDATION OF THE SAFETY VERDICT in the V1 orchestrator. The REAL V1 path over HTTP (app, auth, rate limiter, schema, aiController.ask / askStream,
 * ragService.rag, llmOrchestrator.run) with only the EXTERNAL boundaries replaced (in-memory Prisma, counted fake model, blocked embedding / fetch / Bedrock, fake profile transport).
 *
 * Evidence label: CONTROLLER INTEGRATION with fake external dependencies — NOT a REAL HTTP / REAL BROWSER run of a deployed V1.
 * Provenance: EVERY blocking case below is [FAULT INJECTION] — a raw value injected at the `safetyGuard.check` boundary. The real guard cannot return these (its TypeScript contract forbids
 * it); what is under test is that the ORCHESTRATOR does not trust that contract at runtime: only a recognised, well-formed verdict may reach the coaching path.
 * Pinned: unknown / malformed / missing-or-wrong-typed `type` / prototype-key `type` / recognised `type` with a broken required structure / null / undefined / a throwing guard ⇒ before the
 * model, retrieval, the V1 agent / tools, the memory write and the turn write: JSON `success:false` (503), SSE a single `error` event (never token / done), no retry. Valid verdicts keep their behaviour.
 * NOT claimed: the DB work ragService does BEFORE the gate (T1A-7d), the empty session row created before the gate, the SSE wording (controller).
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/safety-v1-verdict-validation-f4.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import type express from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from "axios";

process.env.LLM_PROVIDER = "mock";
process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/never_connected";
process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "100000";
process.env.LOG_LEVEL = "silent";
process.env.USER_SERVICE_URL = "http://user-service.f4.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.f4.invalid";
for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AI_COACH_V2_BRIDGE", "AI_COACH_V2_BRIDGE_USERS", "AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED", "ENABLE_TOOL_CALLING"]) delete process.env[k];

import type { FakeDb } from "./v1-real-path-fakes";
import { safetyGuard } from "../llm/safety_guard";

const USER_A = "11111111-1111-4111-8111-111111111111";
const FAKE_ANSWER = "MODEL-GENERATED-ANSWER: protein giúp xây dựng và phục hồi cơ bắp.";
const NEUTRAL_VI = "Mình không thể hỗ trợ yêu cầu này một cách an toàn";
const SECRET_DETAIL = "SECRET-INTERNAL-DETAIL-9f3a";
/** a sentence the deterministic memory provenance WOULD persist ("Mình dị ứng đậu phộng." → ALLOW): the probe for "no memory write" */
const memoryQuestion = (id: string) => `Mình dị ứng đậu phộng. [f4:${id}]`;

const c = { fetch: 0, bedrock: 0, llm: 0, embed: 0, agentTurns: 0, rag: 0, orch: 0, profileReads: 0, otherHttp: 0, memoryWrites: 0 };
let db: FakeDb; let app: express.Express; let prisma: any; let modelNames: string[]; let installFake: (typeof import("./v1-real-path-fakes"))["installFakePrisma"];
const adapter: AxiosAdapter = async (config) => {
  const url = String(config.url ?? ""); const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
  const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "").replace(/^Bearer /, "");
  const respond = (status: number, data: unknown): AxiosResponse => { const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config, request: {} }; if (!config.validateStatus || config.validateStatus(status)) return response; throw new AxiosError(`status ${status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response); };
  if (url.endsWith("/profile/me") && auth === "tok-a") { c.profileReads++; return respond(200, { profile: { userId: USER_A, age: 30, hasCompletedOnboarding: true } }); }
  c.otherHttp++; return respond(404, { error: "not mocked" });
};
const injected = new Map<string, () => unknown>();
let origCheck: typeof safetyGuard.check;
let origCreateMemory: (...a: any[]) => Promise<unknown>;

test.before(async () => {
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { c.fetch++; throw new Error("network blocked"); }) as typeof fetch;
  const { bedrockRuntimeDeps } = await import("../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { c.bedrock++; throw new Error("provider blocked"); }) as never;
  const { authServiceClientDeps } = await import("../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => { if (token !== "tok-a") throw Object.assign(new Error("invalid"), { response: { status: 401 } }); return { status: 200, data: { user: { id: USER_A, role: "CUSTOMER" } } }; }) as never;
  const repoMod = await import("../repositories/conversation.repository");
  prisma = repoMod.prisma;
  const { Prisma } = await import("../generated/prisma");
  modelNames = Object.values(Prisma.ModelName).map((n) => n[0].toLowerCase() + n.slice(1));
  ({ installFakePrisma: installFake } = await import("./v1-real-path-fakes"));
  const repo = repoMod.conversationRepository as any;
  origCreateMemory = repo.createUserMemory.bind(repo); repo.createUserMemory = async (...a: any[]) => { c.memoryWrites++; return origCreateMemory(...a); };
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
  (safetyGuard as any).check = (q: string, o?: Parameters<typeof origCheck>[1]) => { const f = injected.get(q); return f ? f() : origCheck(q, o); };
  ({ default: app } = await import("../app"));
  db = installFake(prisma, modelNames);
});
test.after(() => { (safetyGuard as any).check = origCheck; });
test.beforeEach(() => { for (const k of Object.keys(c) as Array<keyof typeof c>) if (k !== "fetch" && k !== "bedrock") c[k] = 0; injected.clear(); db = installFake(prisma, modelNames); });

let n = 0; const key = () => `f4-${++n}-00000001`;
const bearer = { Authorization: "Bearer tok-a" };
const askJson = (question: string) => request(app).post("/ai/ask").set(bearer).send({ question, clientRequestId: key() });
const askSse = (question: string) => request(app).post("/ai/ask/stream").set(bearer).send({ question, clientRequestId: key() });
const parseSse = (text: string) => text.split("\n\n").map((b) => b.trim()).filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5).trim()) as { type: string } & Record<string, unknown>);
const snap = () => `downstream={llm:${c.llm},embed:${c.embed},agentTurns:${c.agentTurns},memoryWrites:${c.memoryWrites},profileReads:${c.profileReads},stored:${db.conversations.length}}`;

function assertNothingDownstream(label: string) {
  assert.equal(c.llm, 0, `${label}: model calls`); assert.equal(c.embed, 0, `${label}: retrieval / embedding`); assert.equal(c.agentTurns, 0, `${label}: V1 agent / tool turns`);
  assert.equal(c.memoryWrites, 0, `${label}: memory writes`); assert.equal(c.profileReads, 0, `${label}: profile reads`); assert.equal(c.otherHttp, 0, `${label}: other service reads`); assert.equal(c.fetch + c.bedrock, 0, `${label}: network / Bedrock`);
  assert.equal(db.conversations.length, 0, `${label}: stored assistant turns`); assert.ok(!db.writes.some((w) => /^conversation\.create$/.test(w)), `${label}: turn write`);
  assert.equal(c.rag, 1, `${label}: one attempt (no retry)`); assert.equal(c.orch, 1, `${label}: one orchestrator run (no retry / fallback)`);
}

const VALID_GUIDANCE = { blocked: true, reason: "r", safeAlternative: "s", firstWeekSteps: ["a"] };
const MALFORMED: Array<{ name: string; raw: () => unknown }> = [
  { name: "{} (no type)", raw: () => ({}) }, { name: "unknown type: future_blocked", raw: () => ({ type: "future_blocked", messageVi: "x", messageEn: "y" }) },
  { name: "type missing, other fields present", raw: () => ({ messageVi: "x", messageEn: "y" }) }, { name: "type is the empty string", raw: () => ({ type: "" }) },
  { name: "type is a number", raw: () => ({ type: 42 }) }, { name: "type is an array containing 'safe'", raw: () => ({ type: ["safe"] }) }, { name: "type is an object", raw: () => ({ type: { safe: true } }) },
  { name: "type is a prototype key: constructor", raw: () => ({ type: "constructor" }) }, { name: "type is a prototype key: __proto__", raw: () => ({ type: "__proto__" }) }, { name: "type is a prototype key: toString", raw: () => ({ type: "toString" }) },
  { name: "type is 'SAFE' (case differs)", raw: () => ({ type: "SAFE" }) }, { name: "type is ' safe' (whitespace)", raw: () => ({ type: " safe" }) },
  { name: "recognised type 'medical_emergency' without its reply texts", raw: () => ({ type: "medical_emergency" }) }, { name: "recognised type 'off_topic' with empty reply texts", raw: () => ({ type: "off_topic", messageVi: "", messageEn: "" }) },
  { name: "recognised type 'off_topic' with non-string reply texts", raw: () => ({ type: "off_topic", messageVi: 5, messageEn: {} }) }, { name: "recognised type 'unsafe_weight_loss' without guidance", raw: () => ({ type: "unsafe_weight_loss" }) },
  { name: "recognised type 'unsafe_weight_loss' with an empty guidance object", raw: () => ({ type: "unsafe_weight_loss", guidance: {} }) },
  { name: "null", raw: () => null }, { name: "undefined", raw: () => undefined }, { name: "a string 'safe'", raw: () => "safe" }, { name: "a number", raw: () => 1 }, { name: "an array", raw: () => [{ type: "safe" }] },
  { name: "the guard THROWS (message carries internal detail)", raw: () => { throw new Error(SECRET_DETAIL); } },
];

for (const [i, m] of MALFORMED.entries()) {
  const q = memoryQuestion(`m${i}`);
  test(`F4-JSON [FAULT INJECTION] ${m.name} ⇒ fail closed: 503 SERVICE_UNAVAILABLE (success:false), model / retrieval / agent / memory / stored turn = 0, no retry, no leak`, async () => {
    injected.set(q, m.raw);
    const r = await askJson(q);
    assert.equal(r.status, 503, `${snap()} ${JSON.stringify(r.body).slice(0, 140)}`); assert.equal(r.body.success, false); assert.equal(r.body.error.code, "SERVICE_UNAVAILABLE");
    const body = JSON.stringify(r.body); assert.ok(body.includes(NEUTRAL_VI), "the neutral refusal"); assert.ok(!body.includes(FAKE_ANSWER) && !body.includes(SECRET_DETAIL), "no model text, no exception detail"); assert.ok(!body.includes("dị ứng"), "the question is not echoed");
    assert.ok(!/Dừng tập ngay|Mình rất tiếc khi nghe bạn|sốc nhiệt/.test(body), "no emergency template for a technical state");
    assertNothingDownstream("JSON");
  });
  test(`F4-SSE [FAULT INJECTION] ${m.name} ⇒ a single error event, never token / done; model / retrieval / agent / memory / stored turn = 0, no retry`, async () => {
    injected.set(q, m.raw);
    const r = await askSse(q); assert.equal(r.status, 200); const ev = parseSse(r.text); const types = ev.map((e) => e.type);
    assert.ok(!types.includes("token") && !types.includes("done"), `${snap()} events=${types.join(",")}`);
    assert.equal(types.filter((t) => t === "error").length, 1, types.join(",")); assert.equal(types[types.length - 1], "error");
    assert.ok(!r.text.includes(FAKE_ANSWER) && !r.text.includes(SECRET_DETAIL) && !r.text.includes("dị ứng"), "no model text, no exception detail, no echo");
    assertNothingDownstream("SSE");
  });
}

// ── valid verdicts keep their behaviour (injection of WELL-FORMED raw values) ──
test("F4-CTRL [valid safe] a well-formed {type:'safe'} still reaches the model path (and the memory provenance runs: the memory probe CAN detect a write)", async () => {
  const q = memoryQuestion("safe"); injected.set(q, () => ({ type: "safe" }));
  const r = await askJson(q); assert.equal(r.status, 200); assert.equal(r.body.success, true); assert.ok(c.llm >= 1, snap()); assert.ok(c.memoryWrites >= 1, `the probe sentence is persisted on the normal path: ${snap()}`); assert.equal(db.conversations.length, 1);
});
test("F4-CTRL [valid safe] SSE: tokens then done, model answer", async () => {
  const q = memoryQuestion("safe-sse"); injected.set(q, () => ({ type: "safe" }));
  const r = await askSse(q); const ev = parseSse(r.text); const types = ev.map((e) => e.type);
  assert.ok(types.includes("token") && types[types.length - 1] === "done" && !types.includes("error"), types.join(",")); assert.equal(ev.filter((e) => e.type === "token").map((e) => e.content).join(""), FAKE_ANSWER);
});
test("F4-CTRL [valid answer verdict] a well-formed 'off_topic' keeps the V1 contract: HTTP 200, the verdict's own text is the answer, 0 model calls", async () => {
  const q = "Đây là câu hỏi thử nghiệm hợp lệ số một"; injected.set(q, () => ({ type: "off_topic", messageVi: "OT-VI-TEXT", messageEn: "OT-EN-TEXT" }));
  const r = await askJson(q); assert.equal(r.status, 200); assert.equal(r.body.data.answer, "OT-VI-TEXT"); assert.equal(c.llm, 0); assert.equal(c.agentTurns, 0);
  const s = await askSse(q); const types = parseSse(s.text).map((e) => e.type); assert.ok(types.includes("token") && types[types.length - 1] === "done");
});
test("F4-CTRL [valid continue verdict] a well-formed 'unsafe_weight_loss' still CONTINUES down the normal V1 pipeline (retrieval + agent turn run; the answer is built from its guidance, not necessarily by the model)", async () => {
  const q = "Đây là câu hỏi thử nghiệm hợp lệ số hai"; injected.set(q, () => ({ type: "unsafe_weight_loss", guidance: VALID_GUIDANCE }));
  const r = await askJson(q); assert.equal(r.status, 200); assert.ok(c.agentTurns >= 1 && c.embed >= 1, `the pipeline continued: ${snap()}`); assert.equal(db.conversations.length, 1);
});
test("F4-CTRL [real guard] legacy verdicts are unchanged: off_topic and post_exercise_symptoms answer from the guard (0 model calls); unsafe_weight_loss continues down the pipeline; a valid emergency is the answer", async () => {
  c.agentTurns = 0; const off = await askJson("Giá Bitcoin hôm nay bao nhiêu?"); assert.equal(off.status, 200); assert.equal(c.llm, 0);
  const post = await askJson("Tập xong hay bị chóng mặt thì nên ăn gì?"); assert.equal(post.status, 200); assert.equal(c.llm, 0);
  const em = await askJson("Tôi muốn tự tử."); assert.equal(em.status, 200); assert.ok(em.body.data.answer.includes("Mình rất tiếc khi nghe bạn")); assert.equal(c.llm, 0);
  const wl = await askJson("Tôi muốn giảm 10kg trong 1 tuần, nên tập và ăn thế nào?"); assert.equal(wl.status, 200); assert.ok(c.agentTurns >= 1 && c.embed >= 1, `unsafe_weight_loss continues down the pipeline: ${snap()}`);
});
test("F4-CTRL [F3 kept] emergency_unassessable and input_too_long still fail closed (503 / 400), 0 model calls", async () => {
  const a = "f4 f3 unassessable"; injected.set(a, () => ({ type: "emergency_unassessable", messageVi: NEUTRAL_VI + ".", messageEn: "x" }));
  const b = "f4 f3 too long"; injected.set(b, () => ({ type: "input_too_long", messageVi: NEUTRAL_VI + ".", messageEn: "x" }));
  const ra = await askJson(a); assert.equal(ra.status, 503); const rb = await askJson(b); assert.equal(rb.status, 400); assert.equal(c.llm, 0);
});

// ── the runtime registry cannot drift from the TypeScript contract ──
test("F4-REGISTRY the orchestrator's verdict registry covers EXACTLY the members of the SafetyResult contract in safety_guard.ts", async () => {
  const { SAFETY_VERDICT_DISPOSITION } = await import("../llm/orchestrator.service");
  const src = readFileSync(join(__dirname, "../llm/safety_guard.ts"), "utf8");
  const a = src.indexOf("export type SafetyUnassessable"), b = src.indexOf("// ── Public API"); assert.ok(a > 0 && b > a);
  const region = src.slice(a, b); const declared = new Set<string>();
  for (const m of region.matchAll(/type:\s*((?:"[a-z_]+"(?:\s*\|\s*)?)+)/g)) for (const t of m[1].match(/"([a-z_]+)"/g)!) declared.add(t.slice(1, -1));
  assert.deepEqual([...declared].sort(), Object.keys(SAFETY_VERDICT_DISPOSITION).sort(), "every contract member has a declared disposition and nothing else is recognised");
  assert.ok(declared.size >= 19);
});
test("F4-UNIT classifySafetyVerdict: a valid sample of EVERY recognised type is accepted with its declared disposition; every malformed value is rejected", async () => {
  const { classifySafetyVerdict, SAFETY_VERDICT_DISPOSITION } = await import("../llm/orchestrator.service");
  for (const [type, disposition] of Object.entries(SAFETY_VERDICT_DISPOSITION)) {
    const sample = type === "safe" ? { type } : type === "unsafe_weight_loss" ? { type, guidance: VALID_GUIDANCE } : { type, messageVi: "vi", messageEn: "en" };
    const r = classifySafetyVerdict(sample); assert.equal(r.ok, true, type); if (r.ok) assert.equal(r.disposition, disposition, type);
  }
  for (const m of MALFORMED) { const v = (() => { try { return m.raw(); } catch { return undefined; } })(); assert.equal(classifySafetyVerdict(v).ok, false, m.name); }
  assert.deepEqual(Object.values(SAFETY_VERDICT_DISPOSITION).filter((d, i, all) => all.indexOf(d) === i).sort(), ["ANSWER", "CONTINUE", "FAIL_CLOSED"]);
  assert.deepEqual(Object.entries(SAFETY_VERDICT_DISPOSITION).filter(([, d]) => d === "CONTINUE").map(([t]) => t).sort(), ["safe", "unsafe_weight_loss"]);
  assert.deepEqual(Object.entries(SAFETY_VERDICT_DISPOSITION).filter(([, d]) => d === "FAIL_CLOSED").map(([t]) => t).sort(), ["emergency_unassessable", "input_too_long"]);
});
