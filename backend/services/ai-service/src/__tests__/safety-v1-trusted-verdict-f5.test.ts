/**
 * M9.5-T1B-F5 — TRUSTED SAFETY-VERDICT SNAPSHOT in the V1 orchestrator. The REAL V1 path over HTTP (app, auth, rate limiter, schema, aiController.ask / askStream, ragService.rag,
 * llmOrchestrator.run) with only the EXTERNAL boundaries replaced (in-memory Prisma, counted fake model, blocked embedding / fetch / Bedrock, fake profile transport).
 *
 * Evidence label: CONTROLLER INTEGRATION with fake external dependencies — NOT a REAL HTTP / REAL BROWSER run of a deployed V1.
 * Provenance: every adversarial case is [FAULT INJECTION] at the `safetyGuard.check` boundary — the REAL guard returns plain object literals with own data properties and cannot produce an
 * inherited / accessor / Proxy verdict. What is under test is that the ORCHESTRATOR does not trust the raw value at runtime: only a verdict that is parsed ONCE from OWN DATA properties of a
 * plain object into a frozen plain-data snapshot may decide anything; the raw object is never read again; getters / Proxies are never executed.
 * Pinned: (1) inherited `type` / texts / guidance; (2) accessor properties anywhere in the decision fields (probe counters prove they are NEVER executed); (3) Proxies; (4) abnormal prototypes;
 * (5) unsafe_weight_loss contract (`blocked` own boolean `true`, steps = non-empty strings); (6) mutation of the raw object after validation cannot change the decision; ⇒ JSON 503 /
 * SSE single `error`, 0 model / retrieval / agent / memory / profile / stored turn, no retry. Valid verdicts (all 19) keep their behaviour.
 * NOT claimed: the DB work ragService does BEFORE the gate (T1A-7d) and the empty session row created before the gate (T1C).
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/safety-v1-trusted-verdict-f5.test.ts
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
process.env.USER_SERVICE_URL = "http://user-service.f5.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.f5.invalid";
for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AI_COACH_V2_BRIDGE", "AI_COACH_V2_BRIDGE_USERS", "AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED", "ENABLE_TOOL_CALLING"]) delete process.env[k];

import type { FakeDb } from "./v1-real-path-fakes";
import { safetyGuard } from "../llm/safety_guard";

const USER_A = "11111111-1111-4111-8111-111111111111";
const FAKE_ANSWER = "MODEL-GENERATED-ANSWER: protein giúp xây dựng và phục hồi cơ bắp.";
const NEUTRAL_VI = "Mình không thể hỗ trợ yêu cầu này một cách an toàn";
const SECRET_DETAIL = "SECRET-INTERNAL-DETAIL-5b7e";
const memoryQuestion = (id: string) => `Mình dị ứng đậu phộng. [f5:${id}]`;

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
  const origCreateMemory = repo.createUserMemory.bind(repo); repo.createUserMemory = async (...a: any[]) => { c.memoryWrites++; return origCreateMemory(...a); };
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

let n = 0; const key = () => `f5-${++n}-00000001`;
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

// ───────────────────────────── adversarial raw verdicts (FAULT INJECTION) ─────────────────────────────
interface Probe { reads: number }
const VG = () => ({ blocked: true, reason: "REASON-F5", safeAlternative: "ALT-F5", firstWeekSteps: ["step one", "step two"] });
const acc = (target: object, k: string, probe: Probe, first: unknown, later: unknown) => Object.defineProperty(target, k, { enumerable: true, configurable: true, get() { probe.reads++; return probe.reads === 1 ? first : later; } });
const flip = (probe: Probe, firstBlocking: boolean) => ({ get type() { probe.reads++; return (probe.reads % 2 === 1) === firstBlocking ? "off_topic" : "safe"; }, messageVi: "OWN-VI", messageEn: "OWN-EN" });
const ADVERSARIAL: Array<{ name: string; mk: (p: Probe) => unknown; never?: true }> = [
  // 1 inherited fields
  { name: "inherited type (Object.create({type:'safe'}))", mk: () => Object.create({ type: "safe" }) },
  { name: "inherited blocking type with inherited texts", mk: () => Object.create({ type: "off_topic", messageVi: "INH-VI", messageEn: "INH-EN" }) },
  { name: "own type, texts ONLY on the prototype (medical_emergency)", mk: () => Object.assign(Object.create({ messageVi: "PROTO-VI", messageEn: "PROTO-EN" }), { type: "medical_emergency" }) },
  { name: "own type 'unsafe_weight_loss', guidance ONLY on the prototype", mk: () => Object.assign(Object.create({ guidance: VG() }), { type: "unsafe_weight_loss" }) },
  { name: "own guidance whose reason / alternative / steps are inherited", mk: () => ({ type: "unsafe_weight_loss", guidance: Object.assign(Object.create({ reason: "R", safeAlternative: "S", firstWeekSteps: ["a"] }), { blocked: true }) }) },
  { name: "prototype carrying a getter for type", mk: (p) => Object.create({ get type() { p.reads++; return "safe"; } }), never: true },
  // 2 own accessors (TOCTOU) — the getter must never run
  { name: "own getter `type` flipping blocking→safe between reads", mk: (p) => flip(p, true), never: true },
  { name: "own getter `type` flipping safe→blocking between reads", mk: (p) => flip(p, false), never: true },
  { name: "own getter `type` that THROWS", mk: (p) => Object.defineProperty({}, "type", { enumerable: true, get() { p.reads++; throw new Error(SECRET_DETAIL); } }), never: true },
  { name: "own getter `messageVi` (text, then empty)", mk: (p) => acc({ type: "off_topic", messageEn: "OWN-EN" }, "messageVi", p, "OWN-VI", ""), never: true },
  { name: "own getter `guidance` (valid, then blocked:false)", mk: (p) => acc({ type: "unsafe_weight_loss" }, "guidance", p, VG(), { ...VG(), blocked: false }), never: true },
  { name: "nested getter `guidance.blocked` (true, then false)", mk: (p) => ({ type: "unsafe_weight_loss", guidance: acc({ reason: "R", safeAlternative: "S", firstWeekSteps: ["a"] }, "blocked", p, true, false) }), never: true },
  { name: "nested getter `guidance.firstWeekSteps` (valid, then [])", mk: (p) => ({ type: "unsafe_weight_loss", guidance: acc({ blocked: true, reason: "R", safeAlternative: "S" }, "firstWeekSteps", p, ["a"], []) }), never: true },
  { name: "accessor element inside firstWeekSteps", mk: (p) => ({ type: "unsafe_weight_loss", guidance: { blocked: true, reason: "R", safeAlternative: "S", firstWeekSteps: Object.defineProperty(["x"], "0", { enumerable: true, get() { p.reads++; return "a"; } }) } }), never: true },
  // 3 Proxy — no trap may run
  { name: "Proxy wrapping a valid safe verdict", mk: (p) => new Proxy({ type: "safe" }, { get() { p.reads++; return "safe"; }, getOwnPropertyDescriptor() { p.reads++; throw new Error(SECRET_DETAIL); }, has() { p.reads++; return true; } }), never: true },
  { name: "Proxy as guidance", mk: (p) => ({ type: "unsafe_weight_loss", guidance: new Proxy(VG(), { get() { p.reads++; return true; }, getOwnPropertyDescriptor() { p.reads++; throw new Error(SECRET_DETAIL); } }) }), never: true },
  // 4 unsafe_weight_loss contract
  { name: "unsafe_weight_loss with blocked:false", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), blocked: false } }) },
  { name: "unsafe_weight_loss without `blocked`", mk: () => ({ type: "unsafe_weight_loss", guidance: { reason: "R", safeAlternative: "S", firstWeekSteps: ["a"] } }) },
  { name: "unsafe_weight_loss with blocked:'true' (string)", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), blocked: "true" } }) },
  { name: "unsafe_weight_loss with blocked:1", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), blocked: 1 } }) },
  { name: "firstWeekSteps:[42]", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), firstWeekSteps: [42] } }) },
  { name: "firstWeekSteps with an empty string", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), firstWeekSteps: ["ok", ""] } }) },
  { name: "firstWeekSteps with a blank string", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), firstWeekSteps: ["ok", "   "] } }) },
  { name: "firstWeekSteps with an object / null element", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), firstWeekSteps: ["ok", {}, null] } }) },
  { name: "firstWeekSteps sparse (hole)", mk: () => { const a = new Array(2); a[1] = "ok"; return { type: "unsafe_weight_loss", guidance: { ...VG(), firstWeekSteps: a } }; } },
  { name: "firstWeekSteps empty array", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), firstWeekSteps: [] } }) },
  { name: "firstWeekSteps not an array (string)", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), firstWeekSteps: "a,b" } }) },
  { name: "firstWeekSteps array-like object", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), firstWeekSteps: { length: 1, 0: "a" } } }) },
  { name: "guidance.reason empty", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), reason: "" } }) },
  { name: "guidance.safeAlternative non-string", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), safeAlternative: 7 } }) },
  { name: "guidance is an array", mk: () => ({ type: "unsafe_weight_loss", guidance: [VG()] }) },
  // 5 abnormal prototypes
  { name: "class instance with an own `type`", mk: () => new (class Verdict { type = "safe"; })() },
  { name: "null-prototype object", mk: () => Object.setPrototypeOf({ type: "safe" }, null) },
  { name: "prototype is Array.prototype", mk: () => Object.setPrototypeOf({ type: "safe" }, Array.prototype) },
  { name: "answer verdict whose texts are own but the object has a custom prototype", mk: () => Object.setPrototypeOf({ type: "off_topic", messageVi: "OWN-VI", messageEn: "OWN-EN" }, { evil: true }) },
  // 6 the F4 set (kept)
  { name: "null", mk: () => null }, { name: "{}", mk: () => ({}) }, { name: "unknown type", mk: () => ({ type: "future_blocked", messageVi: "x", messageEn: "y" }) },
  { name: "prototype-key type: constructor", mk: () => ({ type: "constructor" }) }, { name: "prototype-key type: __proto__", mk: () => ({ type: "__proto__" }) },
];

for (const [i, m] of ADVERSARIAL.entries()) {
  const q = memoryQuestion(`a${i}`);
  test(`F5-JSON [FAULT INJECTION] ${m.name} ⇒ fail closed (503, success:false), 0 model / retrieval / agent / memory / profile / stored turn${m.never ? ", the accessor / trap is NEVER executed" : ""}`, async () => {
    const probe: Probe = { reads: 0 }; injected.set(q, () => m.mk(probe));
    const r = await askJson(q);
    assert.equal(r.status, 503, `${snap()} reads=${probe.reads} ${JSON.stringify(r.body).slice(0, 140)}`); assert.equal(r.body.success, false); assert.equal(r.body.error.code, "SERVICE_UNAVAILABLE");
    const body = JSON.stringify(r.body); assert.ok(body.includes(NEUTRAL_VI), "the neutral refusal"); assert.ok(!body.includes(FAKE_ANSWER) && !body.includes(SECRET_DETAIL) && !body.includes("dị ứng"), "no model text, no exception detail, no echo");
    assert.ok(!/INH-VI|PROTO-VI|OWN-VI|REASON-F5/.test(body), "no text from an untrusted verdict is returned");
    if (m.never) assert.equal(probe.reads, 0, "no getter / Proxy trap of the untrusted verdict was executed");
    assertNothingDownstream("JSON");
  });
  test(`F5-SSE [FAULT INJECTION] ${m.name} ⇒ a single error event, never token / done, 0 model / retrieval / agent / memory / profile / stored turn`, async () => {
    const probe: Probe = { reads: 0 }; injected.set(q, () => m.mk(probe));
    const r = await askSse(q); assert.equal(r.status, 200); const ev = parseSse(r.text); const types = ev.map((e) => e.type);
    assert.ok(!types.includes("token") && !types.includes("done"), `${snap()} reads=${probe.reads} events=${types.join(",")}`);
    assert.equal(types.filter((t) => t === "error").length, 1, types.join(",")); assert.equal(types[types.length - 1], "error");
    assert.ok(!r.text.includes(FAKE_ANSWER) && !r.text.includes(SECRET_DETAIL) && !r.text.includes("dị ứng") && !/INH-VI|PROTO-VI|OWN-VI|REASON-F5/.test(r.text));
    if (m.never) assert.equal(probe.reads, 0, "no getter / Proxy trap executed");
    assertNothingDownstream("SSE");
  });
}

// ───────────────────────────── mutation AFTER validation cannot change the decision ─────────────────────────────
test("F5-MUTATION a VALID unsafe_weight_loss whose raw object is mutated right after the guard returns (type→'safe', blocked→false, steps cleared) still gets the deterministic guidance, 0 model calls", async () => {
  const q = memoryQuestion("mut1");
  injected.set(q, () => { const raw = { type: "unsafe_weight_loss", guidance: VG() } as any; queueMicrotask(() => { raw.guidance.blocked = false; raw.guidance.firstWeekSteps.length = 0; raw.guidance.reason = "MUTATED"; raw.type = "safe"; }); return raw; });
  const r = await askJson(q); assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 160)); assert.equal(c.llm, 0, `the validated verdict forbids the model: ${snap()}`);
  assert.ok(r.body.data.answer.includes("REASON-F5") && !r.body.data.answer.includes("MUTATED"), r.body.data.answer.slice(0, 200)); assert.ok(r.body.data.answer.includes("step one"));
});
test("F5-MUTATION a VALID 'off_topic' whose raw object is mutated right after validation (type→'safe', text→'') is still answered from the validated text, 0 model calls", async () => {
  const q = "Đây là câu hỏi thử nghiệm hợp lệ số năm";
  injected.set(q, () => { const raw = { type: "off_topic", messageVi: "OT-VI-F5", messageEn: "OT-EN-F5" } as any; queueMicrotask(() => { raw.type = "safe"; raw.messageVi = ""; }); return raw; });
  const r = await askJson(q); assert.equal(r.status, 200); assert.equal(r.body.data.answer, "OT-VI-F5"); assert.equal(c.llm, 0, snap());
  const s = await askSse(q); const ev = parseSse(s.text); assert.equal(ev.filter((e) => e.type === "token").map((e) => e.content).join(""), "OT-VI-F5"); assert.equal(c.llm, 0);
});

// ───────────────────────────── compatibility: all 19 verdicts ─────────────────────────────
const SAMPLE = (type: string): Record<string, unknown> => (type === "safe" ? { type } : type === "unsafe_weight_loss" ? { type, guidance: VG() } : { type, messageVi: `VI-${type}`, messageEn: `EN-${type}` });
test("F5-COMPAT every ANSWER verdict (15) keeps its semantics over JSON and SSE: HTTP 200 / tokens + done, the verdict's own text is the answer, 0 model calls", async () => {
  const { SAFETY_VERDICT_DISPOSITION } = await import("../llm/orchestrator.service");
  const answers = Object.entries(SAFETY_VERDICT_DISPOSITION).filter(([, d]) => d === "ANSWER").map(([t]) => t); assert.equal(answers.length, 15);
  for (const type of answers) {
    const q = `Đây là câu hỏi thử nghiệm hợp lệ cho ${type}`; injected.set(q, () => SAMPLE(type)); c.llm = 0;
    const j = await askJson(q); assert.equal(j.status, 200, type); assert.equal(j.body.data.answer, `VI-${type}`, type);
    const s = await askSse(q); const ev = parseSse(s.text); const types = ev.map((e) => e.type); assert.ok(types.includes("token") && types[types.length - 1] === "done" && !types.includes("error"), `${type}: ${types.join(",")}`);
    assert.equal(ev.filter((e) => e.type === "token").map((e) => e.content).join(""), `VI-${type}`, type); assert.equal(c.llm, 0, `${type}: no model call`);
  }
});
test("F5-COMPAT `safe` still reaches the model path (and the memory provenance runs); valid unsafe_weight_loss answers deterministically (0 model calls) with its guidance", async () => {
  const q = memoryQuestion("safe"); injected.set(q, () => SAMPLE("safe"));
  const r = await askJson(q); assert.equal(r.status, 200); assert.ok(c.llm >= 1 && c.memoryWrites >= 1, snap());
  c.llm = 0; const w = "Đây là câu hỏi thử nghiệm hợp lệ về cân nặng"; injected.set(w, () => SAMPLE("unsafe_weight_loss"));
  const wr = await askJson(w); assert.equal(wr.status, 200); assert.equal(c.llm, 0, snap()); assert.ok(wr.body.data.answer.includes("REASON-F5") && wr.body.data.answer.includes("ALT-F5") && wr.body.data.answer.includes("1. step one") && wr.body.data.answer.includes("2. step two"));
  const ws = await askSse(w); const ev = parseSse(ws.text); assert.ok(ev.some((e) => e.type === "token") && ev[ev.length - 1].type === "done"); assert.equal(c.llm, 0);
});
test("F5-COMPAT input_too_long still 400 VALIDATION_ERROR and emergency_unassessable still 503 SERVICE_UNAVAILABLE (JSON), single error event (SSE)", async () => {
  const a = "Đây là câu hỏi thử nghiệm hợp lệ về giới hạn"; injected.set(a, () => ({ type: "input_too_long", messageVi: NEUTRAL_VI + ".", messageEn: "x" }));
  const b = "Đây là câu hỏi thử nghiệm hợp lệ không đánh giá được"; injected.set(b, () => ({ type: "emergency_unassessable", messageVi: NEUTRAL_VI + ".", messageEn: "x", reason: "AMBIGUOUS_REFERENCE" }));
  const ra = await askJson(a); assert.equal(ra.status, 400); assert.equal(ra.body.error.code, "VALIDATION_ERROR"); const rb = await askJson(b); assert.equal(rb.status, 503); assert.equal(rb.body.error.code, "SERVICE_UNAVAILABLE");
  const sb = parseSse((await askSse(b)).text).map((e) => e.type); assert.deepEqual(sb.filter((t) => t !== "status"), ["error"]); assert.equal(c.llm, 0);
});
test("F5-COMPAT [real guard] unchanged: a valid emergency is the ANSWER, off_topic answers from the guard, the real unsafe_weight_loss answers deterministically (0 model calls), an ordinary question reaches the model", async () => {
  const em = await askJson("Tôi muốn tự tử."); assert.equal(em.status, 200); assert.ok(em.body.data.answer.includes("Mình rất tiếc khi nghe bạn")); assert.equal(c.llm, 0);
  const off = await askJson("Giá Bitcoin hôm nay bao nhiêu?"); assert.equal(off.status, 200); assert.equal(c.llm, 0);
  const wl = await askJson("Tôi muốn giảm 10kg trong 1 tuần, nên tập và ăn thế nào?"); assert.equal(wl.status, 200); assert.equal(c.llm, 0, `the REAL unsafe_weight_loss is deterministic: ${snap()}`); assert.ok(wl.body.data.answer.length > 50);
  const ok = await askJson("Protein giúp gì cho cơ bắp?"); assert.equal(ok.status, 200); assert.ok(c.llm >= 1);
});

// ───────────────────────────── the parser itself ─────────────────────────────
test("F5-UNIT classifySafetyVerdict returns a FROZEN plain-data snapshot that is independent of the raw object (every type, deep)", async () => {
  const { classifySafetyVerdict, SAFETY_VERDICT_DISPOSITION } = await import("../llm/orchestrator.service");
  for (const [type, disposition] of Object.entries(SAFETY_VERDICT_DISPOSITION)) {
    const raw: any = SAMPLE(type); if (disposition === "FAIL_CLOSED") raw.reason = "INTERNAL_ERROR";
    const r = classifySafetyVerdict(raw); assert.equal(r.ok, true, type); if (!r.ok) continue;
    assert.equal(r.disposition, disposition); assert.notStrictEqual(r.verdict, raw, `${type}: the snapshot is not the raw object`); assert.ok(Object.isFrozen(r.verdict), `${type}: frozen`);
    assert.equal(Object.getPrototypeOf(r.verdict), Object.prototype); assert.equal(r.verdict.type, type);
    const before = JSON.stringify(r.verdict);
    raw.type = "safe"; if (raw.messageVi !== undefined) raw.messageVi = "CHANGED"; if (raw.guidance) { raw.guidance.blocked = false; raw.guidance.firstWeekSteps.length = 0; raw.guidance.reason = "CHANGED"; }
    assert.equal(JSON.stringify(r.verdict), before, `${type}: later changes of the raw object do not reach the snapshot`);
    if (type === "unsafe_weight_loss") { const g = (r.verdict as any).guidance; assert.ok(Object.isFrozen(g) && Object.isFrozen(g.firstWeekSteps), "guidance and its steps are frozen"); assert.equal(g.blocked, true); assert.deepEqual(g.firstWeekSteps, ["step one", "step two"]); assert.notStrictEqual(g.firstWeekSteps, SAMPLE("unsafe_weight_loss").guidance); }
  }
});
test("F5-UNIT every adversarial value is rejected by the parser WITHOUT executing an accessor / trap and without throwing", async () => {
  const { classifySafetyVerdict } = await import("../llm/orchestrator.service");
  for (const m of ADVERSARIAL) { const probe: Probe = { reads: 0 }; const res = classifySafetyVerdict(m.mk(probe)); assert.equal(res.ok, false, m.name); if (m.never) assert.equal(probe.reads, 0, `${m.name}: accessor / trap executed`); }
  assert.equal(classifySafetyVerdict(undefined).ok, false);
});
