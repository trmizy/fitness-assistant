/**
 * M9.5-T1B-RC1 — SYNCHRONOUS SAFETY DECISION CONTRACT in the V1 orchestrator:  Raw Safety Result → Synchronous Validation → Trusted Safety Decision → Async Orchestration.
 * No raw safety verdict may pass through `await`, `Promise.resolve` or the return boundary of an `async` function before it is validated.
 *
 * The REAL V1 path over HTTP (app, auth, rate limiter, schema, aiController.ask / askStream, ragService.rag, llmOrchestrator.run) with only the EXTERNAL boundaries replaced (in-memory
 * Prisma, counted fake model, blocked embedding / fetch / Bedrock, fake profile transport whose age is controllable).
 * Evidence label: CONTROLLER INTEGRATION with fake external dependencies — NOT a REAL HTTP / REAL BROWSER run of a deployed V1.
 * Provenance: every adversarial case is [FAULT INJECTION]: a raw value injected at the `safetyGuard.check` boundary (group G) or at the `safetyGuard.minorAgeResult` boundary (group M).
 * The production guard is synchronous and returns plain object literals; these tests are NOT evidence that it ever produced a Promise / thenable / Proxy.
 * Pinned: a raw Promise (with a hostile `constructor`), an own / accessor `then`, a Promise whose verdict is mutated by a microtask, a thenable or Promise or later-mutated minor verdict from the
 * minors' producer, accessors, Proxies, malformed / unknown verdicts ⇒ fail closed (JSON 503; SSE one `error`; 0 model / retrieval / agent / memory / stored turn, no retry) and no hostile code is
 * ever executed; the minors' policy cannot be bypassed through an async boundary; valid verdicts, the real minors' triage and its failure handling keep their behaviour.
 * NOT claimed: the DB work ragService does BEFORE the gate (T1A-7d) and the empty session row created before the gate (T1C).
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/safety-v1-sync-contract-rc1.test.ts
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
process.env.USER_SERVICE_URL = "http://user-service.rc1.invalid";
process.env.FITNESS_SERVICE_URL = "http://fitness-service.rc1.invalid";
for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AI_COACH_V2_BRIDGE", "AI_COACH_V2_BRIDGE_USERS", "AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED", "ENABLE_TOOL_CALLING"]) delete process.env[k];

import type { FakeDb } from "./v1-real-path-fakes";
import { safetyGuard } from "../llm/safety_guard";

const USER_A = "11111111-1111-4111-8111-111111111111";
const FAKE_ANSWER = "MODEL-GENERATED-ANSWER: protein giúp xây dựng và phục hồi cơ bắp.";
const NEUTRAL_VI = "Mình không thể hỗ trợ yêu cầu này một cách an toàn";
const SECRET_DETAIL = "SECRET-INTERNAL-DETAIL-rc1";
const MINOR_REPLY = "Cần phụ huynh/bác sĩ nhi khoa tư vấn"; // the real minors' triage text
/** the real guard says `safe` for it, V1 reads the profile age for it, and a 16-year-old profile turns it into the minors' triage (probe, 2026-11-16) */
const minorQuestion = (id: string) => `Mình dị ứng đậu phộng. Tôi muốn giảm cân. [rc1:${id}]`;
const plainQuestion = (id: string) => `Mình dị ứng đậu phộng. [rc1:${id}]`;

const c = { fetch: 0, bedrock: 0, llm: 0, embed: 0, agentTurns: 0, rag: 0, orch: 0, profileReads: 0, otherHttp: 0, memoryWrites: 0 };
let profileAge: number | null = 30; let profileMode: "ok" | "error" = "ok";
let db: FakeDb; let app: express.Express; let prisma: any; let modelNames: string[]; let installFake: (typeof import("./v1-real-path-fakes"))["installFakePrisma"];
const adapter: AxiosAdapter = async (config) => {
  const url = String(config.url ?? ""); const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
  const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "").replace(/^Bearer /, "");
  const respond = (status: number, data: unknown): AxiosResponse => { const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config, request: {} }; if (!config.validateStatus || config.validateStatus(status)) return response; throw new AxiosError(`status ${status}`, status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, {}, response); };
  if (url.endsWith("/profile/me") && auth === "tok-a") { c.profileReads++; if (profileMode === "error") return respond(500, { error: "down" }); return respond(200, { profile: { userId: USER_A, age: profileAge, hasCompletedOnboarding: true } }); }
  c.otherHttp++; return respond(404, { error: "not mocked" });
};
const injected = new Map<string, () => unknown>();
let injectedMinor: (() => unknown) | null = null;
let origCheck: typeof safetyGuard.check; let origMinor: typeof safetyGuard.minorAgeResult; let profileExtractorRef: { invalidateCache: (id: string) => void };

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
  ({ profileExtractor: profileExtractorRef } = await import("../llm/profile_extractor") as any);
  origCheck = safetyGuard.check.bind(safetyGuard); origMinor = safetyGuard.minorAgeResult.bind(safetyGuard);
  (safetyGuard as any).check = (q: string, o?: Parameters<typeof origCheck>[1]) => { const f = injected.get(q); return f ? f() : origCheck(q, o); };
  (safetyGuard as any).minorAgeResult = () => (injectedMinor ? injectedMinor() : origMinor());
  ({ default: app } = await import("../app"));
  db = installFake(prisma, modelNames);
});
test.after(() => { (safetyGuard as any).check = origCheck; (safetyGuard as any).minorAgeResult = origMinor; });
test.beforeEach(() => { for (const k of Object.keys(c) as Array<keyof typeof c>) if (k !== "fetch" && k !== "bedrock") c[k] = 0; injected.clear(); injectedMinor = null; profileAge = 30; profileMode = "ok"; profileExtractorRef.invalidateCache(USER_A); db = installFake(prisma, modelNames); });

let n = 0; const key = () => `rc1-${++n}-00000001`;
const bearer = { Authorization: "Bearer tok-a" };
const askJson = (question: string) => request(app).post("/ai/ask").set(bearer).send({ question, clientRequestId: key() });
const askSse = (question: string) => request(app).post("/ai/ask/stream").set(bearer).send({ question, clientRequestId: key() });
const parseSse = (text: string) => text.split("\n\n").map((b) => b.trim()).filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5).trim()) as { type: string } & Record<string, unknown>);
const snap = () => `downstream={llm:${c.llm},embed:${c.embed},agentTurns:${c.agentTurns},memoryWrites:${c.memoryWrites},profileReads:${c.profileReads},stored:${db.conversations.length}}`;
const resetCounters = () => { for (const k of Object.keys(c) as Array<keyof typeof c>) if (k !== "fetch" && k !== "bedrock") c[k] = 0; profileExtractorRef.invalidateCache(USER_A); db = installFake(prisma, modelNames); };

function assertNothingDownstream(label: string, o: { allowProfileRead?: boolean } = {}) {
  assert.equal(c.llm, 0, `${label}: model calls`); assert.equal(c.embed, 0, `${label}: retrieval / embedding`); assert.equal(c.agentTurns, 0, `${label}: V1 agent / tool turns`);
  assert.equal(c.memoryWrites, 0, `${label}: memory writes`); if (!o.allowProfileRead) { assert.equal(c.profileReads, 0, `${label}: profile reads`); assert.equal(c.otherHttp, 0, `${label}: other service reads`); } // with allowProfileRead the age lookup legitimately made the profile extractor's own service reads (the guard's verdict was valid)
   assert.equal(c.fetch + c.bedrock, 0, `${label}: network / Bedrock`);
  assert.equal(db.conversations.length, 0, `${label}: stored assistant turns`); assert.ok(!db.writes.some((w) => /^conversation\.create$/.test(w)), `${label}: turn write`);
  assert.equal(c.rag, 1, `${label}: one attempt (no retry)`); assert.equal(c.orch, 1, `${label}: one orchestrator run (no retry / fallback)`);
}
interface Probe { reads: number }
const VG = () => ({ blocked: true, reason: "REASON-RC1", safeAlternative: "ALT-RC1", firstWeekSteps: ["step one", "step two"] });
const MINOR_OBJ = () => ({ type: "minor_age_nutrition_request", messageVi: "MINOR-VI-RC1", messageEn: "MINOR-EN-RC1" });

// ───────────────────── G. the guard boundary: a raw Promise / thenable is never awaited, assimilated or trusted ─────────────────────
const GUARD_CASES: Array<{ name: string; mk: (p: Probe) => unknown; never?: true }> = [
  { name: "a raw Promise (valid safe verdict) whose `constructor` is a getter — `await` / Promise.resolve would run it", mk: (p) => { const pr = Promise.resolve({ type: "safe" }); Object.defineProperty(pr, "constructor", { get() { p.reads++; return Promise; } }); return pr; }, never: true },
  { name: "a raw Promise whose `then` is an own getter", mk: (p) => { const pr = Promise.resolve({ type: "safe" }); Object.defineProperty(pr, "then", { get() { p.reads++; return Promise.prototype.then; } }); return pr; }, never: true },
  { name: "an own thenable that would resolve to `safe`", mk: (p) => ({ type: "safe", then(res: (v: unknown) => void) { p.reads++; res({ type: "safe" }); } }), never: true },
  { name: "an own ACCESSOR `then` on an otherwise valid safe verdict", mk: (p) => Object.defineProperty({ type: "safe" }, "then", { enumerable: true, get() { p.reads++; return undefined; } }), never: true },
  { name: "a raw Promise (valid safe verdict): the contract is SYNCHRONOUS — a Promise is not a verdict", mk: () => Promise.resolve({ type: "safe" }) },
  { name: "a raw Promise of a valid blocking verdict (answered only through the sync parser, never awaited)", mk: () => Promise.resolve({ type: "off_topic", messageVi: "OT-VI", messageEn: "OT-EN" }) },
  { name: "a raw Promise whose verdict is mutated by a microtask (blocking → safe)", mk: () => { const v: any = { type: "off_topic", messageVi: "OT-VI", messageEn: "OT-EN" }; const pr = Promise.resolve(v); queueMicrotask(() => { v.type = "safe"; }); return pr; } },
  { name: "a rejected raw Promise", mk: () => { const pr = Promise.reject(new Error(SECRET_DETAIL)); pr.catch(() => undefined); return pr; } },
  { name: "Proxy of a valid safe verdict", mk: (p) => new Proxy({ type: "safe" }, { get() { p.reads++; return "safe"; }, getOwnPropertyDescriptor() { p.reads++; throw new Error(SECRET_DETAIL); } }), never: true },
  { name: "own getter `type`", mk: (p) => Object.defineProperty({}, "type", { enumerable: true, get() { p.reads++; return "safe"; } }), never: true },
  { name: "malformed: {}", mk: () => ({}) }, { name: "unknown type", mk: () => ({ type: "future_blocked", messageVi: "x", messageEn: "y" }) },
  { name: "unsafe_weight_loss with blocked:false", mk: () => ({ type: "unsafe_weight_loss", guidance: { ...VG(), blocked: false } }) },
];
for (const [i, m] of GUARD_CASES.entries()) {
  const q = plainQuestion(`g${i}`);
  test(`RC1-G-JSON [FAULT INJECTION] ${m.name} ⇒ fail closed (503, success:false), 0 model / retrieval / agent / memory / profile / stored turn, hostile code never runs`, async () => {
    const probe: Probe = { reads: 0 }; injected.set(q, () => m.mk(probe));
    const r = await askJson(q);
    assert.equal(r.status, 503, `${snap()} reads=${probe.reads} ${JSON.stringify(r.body).slice(0, 140)}`); assert.equal(r.body.success, false); assert.equal(r.body.error.code, "SERVICE_UNAVAILABLE");
    const body = JSON.stringify(r.body); assert.ok(body.includes(NEUTRAL_VI)); assert.ok(!body.includes(FAKE_ANSWER) && !body.includes(SECRET_DETAIL) && !body.includes("dị ứng") && !/OT-VI/.test(body));
    if (m.never) assert.equal(probe.reads, 0, "no getter / thenable / Proxy trap of the untrusted value was executed");
    assertNothingDownstream("JSON");
  });
  test(`RC1-G-SSE [FAULT INJECTION] ${m.name} ⇒ a single error event, never token / done`, async () => {
    const probe: Probe = { reads: 0 }; injected.set(q, () => m.mk(probe));
    const r = await askSse(q); assert.equal(r.status, 200); const ev = parseSse(r.text); const types = ev.map((e) => e.type);
    assert.ok(!types.includes("token") && !types.includes("done"), `${snap()} reads=${probe.reads} events=${types.join(",")}`); assert.equal(types.filter((t) => t === "error").length, 1); assert.equal(types[types.length - 1], "error");
    assert.ok(!r.text.includes(FAKE_ANSWER) && !r.text.includes(SECRET_DETAIL) && !/OT-VI/.test(r.text)); if (m.never) assert.equal(probe.reads, 0);
    assertNothingDownstream("SSE");
  });
}

// ───────────────────── M. the minors' producer: validated AT the producer, before any async boundary ─────────────────────
const MINOR_CASES: Array<{ name: string; mk: (p: Probe) => unknown; never?: true }> = [
  { name: "minorAgeResult returns an own thenable that resolves to `safe`", mk: (p) => ({ then(res: (v: unknown) => void) { p.reads++; res({ type: "safe" }); } }), never: true },
  { name: "minorAgeResult returns a thenable that also looks like a minor verdict", mk: (p) => ({ ...MINOR_OBJ(), then(res: (v: unknown) => void) { p.reads++; res({ type: "safe" }); } }), never: true },
  { name: "minorAgeResult returns a Promise resolving to `safe`", mk: () => Promise.resolve({ type: "safe" }) },
  { name: "minorAgeResult returns a Promise whose `constructor` is a getter", mk: (p) => { const pr = Promise.resolve(MINOR_OBJ()); Object.defineProperty(pr, "constructor", { get() { p.reads++; return Promise; } }); return pr; }, never: true },
  { name: "minorAgeResult returns an object with an accessor `type`", mk: (p) => Object.defineProperty({ messageVi: "x", messageEn: "y" }, "type", { enumerable: true, get() { p.reads++; return "safe"; } }), never: true },
  { name: "minorAgeResult returns a Proxy", mk: (p) => new Proxy(MINOR_OBJ(), { get() { p.reads++; return "safe"; }, getOwnPropertyDescriptor() { p.reads++; throw new Error(SECRET_DETAIL); } }), never: true },
  { name: "minorAgeResult returns a plain verdict that says `safe`", mk: () => ({ type: "safe" }) },
  { name: "minorAgeResult returns {} / malformed", mk: () => ({}) },
  { name: "minorAgeResult returns the minors' type without its reply texts", mk: () => ({ type: "minor_age_nutrition_request" }) },
  { name: "minorAgeResult THROWS", mk: () => { throw new Error(SECRET_DETAIL); } },
];
for (const [i, m] of MINOR_CASES.entries()) {
  const q = minorQuestion(`m${i}`);
  const setup = (probe: Probe) => { profileAge = 16; injectedMinor = () => m.mk(probe); };
  test(`RC1-M-JSON [FAULT INJECTION] ${m.name} ⇒ the minors' policy is NOT bypassed: fail closed (503), 0 model / retrieval / agent / memory / stored turn`, async () => {
    const probe: Probe = { reads: 0 }; setup(probe);
    const r = await askJson(q);
    assert.equal(r.status, 503, `${snap()} reads=${probe.reads} ${JSON.stringify(r.body).slice(0, 160)}`); assert.equal(r.body.success, false); assert.equal(r.body.error.code, "SERVICE_UNAVAILABLE");
    assert.ok(JSON.stringify(r.body).includes(NEUTRAL_VI)); assert.ok(!JSON.stringify(r.body).includes(FAKE_ANSWER) && !JSON.stringify(r.body).includes(SECRET_DETAIL));
    if (m.never) assert.equal(probe.reads, 0, "no thenable / getter / Proxy trap of the untrusted minors' verdict was executed");
    assert.equal(c.profileReads, 1, "the profile age was read exactly once (the guard's own verdict was valid)"); assertNothingDownstream("JSON", { allowProfileRead: true });
  });
  test(`RC1-M-SSE [FAULT INJECTION] ${m.name} ⇒ a single error event, never token / done`, async () => {
    const probe: Probe = { reads: 0 }; setup(probe);
    const r = await askSse(q); const ev = parseSse(r.text); const types = ev.map((e) => e.type);
    assert.ok(!types.includes("token") && !types.includes("done"), `${snap()} reads=${probe.reads} events=${types.join(",")}`); assert.equal(types.filter((t) => t === "error").length, 1); assert.equal(types[types.length - 1], "error");
    if (m.never) assert.equal(probe.reads, 0); assertNothingDownstream("SSE", { allowProfileRead: true });
  });
}
test("RC1-M-MUTATION a VALID minors' verdict that is mutated by a microtask right after minorAgeResult returns (type→'safe', text cleared) is still applied as validated: the minors' reply, 0 model calls", async () => {
  profileAge = 16; injectedMinor = () => { const v: any = MINOR_OBJ(); queueMicrotask(() => { v.type = "safe"; v.messageVi = ""; v.messageEn = ""; }); return v; };
  const r = await askJson(minorQuestion("mut")); assert.equal(r.status, 200, `${snap()} ${JSON.stringify(r.body).slice(0, 160)}`); assert.equal(r.body.data.answer, "MINOR-VI-RC1"); assert.equal(c.llm, 0, snap()); assert.equal(c.agentTurns, 0);
  resetCounters(); const s = await askSse(minorQuestion("mut2")); const ev = parseSse(s.text); assert.equal(ev.filter((e) => e.type === "token").map((e) => e.content).join(""), "MINOR-VI-RC1"); assert.equal(c.llm, 0);
});
test("RC1-M-MUTATION the guard's own VALID verdict mutated by a microtask right after `check` returns is parsed before the microtask can run (blocking verdict stays blocking)", async () => {
  const q = "Đây là câu hỏi thử nghiệm hợp lệ số một"; injected.set(q, () => { const v: any = { type: "off_topic", messageVi: "OT-VI-RC1", messageEn: "OT-EN-RC1" }; queueMicrotask(() => { v.type = "safe"; v.messageVi = ""; }); return v; });
  const r = await askJson(q); assert.equal(r.status, 200); assert.equal(r.body.data.answer, "OT-VI-RC1"); assert.equal(c.llm, 0, snap());
});

// ───────────────────── controls: the minors' policy and every valid behaviour are unchanged ─────────────────────
test("RC1-CTRL the REAL minors' triage: a 16-year-old profile gets the triage (200, 0 model, 0 agent); an adult profile is not triaged; a profile-service failure keeps the question-only result", async () => {
  profileAge = 16; const minor = await askJson(minorQuestion("c1")); assert.equal(minor.status, 200); assert.ok(minor.body.data.answer.includes(MINOR_REPLY), minor.body.data.answer.slice(0, 120)); assert.equal(c.llm, 0); assert.equal(c.agentTurns, 0); assert.equal(c.profileReads, 1);
  const ms = await askSse(minorQuestion("c1s")); assert.ok(parseSse(ms.text).filter((e) => e.type === "token").map((e) => e.content).join("").includes(MINOR_REPLY));
  resetCounters(); profileAge = 30; const adult = await askJson(minorQuestion("c2")); assert.equal(adult.status, 200); assert.ok(!adult.body.data.answer.includes(MINOR_REPLY)); assert.ok(c.agentTurns >= 1 || c.llm >= 1, `the adult goes down the normal pipeline: ${snap()}`);
  resetCounters(); profileMode = "error"; const down = await askJson(minorQuestion("c3")); assert.equal(down.status, 200, JSON.stringify(down.body).slice(0, 140)); assert.ok(!down.body.data.answer.includes(MINOR_REPLY), "a failed lookup keeps the question-only verdict (existing behaviour)");
});
test("RC1-CTRL a VALID injected minors' verdict is the answer; a valid `safe`, `unsafe_weight_loss` and ANSWER verdict keep their behaviour", async () => {
  profileAge = 16; injectedMinor = MINOR_OBJ; const m = await askJson(minorQuestion("c4")); assert.equal(m.status, 200); assert.equal(m.body.data.answer, "MINOR-VI-RC1"); assert.equal(c.llm, 0);
  profileAge = 30; injectedMinor = null; // the next steps are about an ADULT profile
  resetCounters(); const q1 = plainQuestion("c5"); injected.set(q1, () => ({ type: "safe" })); const s = await askJson(q1); assert.equal(s.status, 200); assert.ok(c.llm >= 1 && c.memoryWrites >= 1, snap());
  resetCounters(); const q2 = "Đây là câu hỏi thử nghiệm hợp lệ về cân nặng"; injected.set(q2, () => ({ type: "unsafe_weight_loss", guidance: VG() })); const w = await askJson(q2); assert.equal(w.status, 200); assert.equal(c.llm, 0); assert.ok(w.body.data.answer.includes("REASON-RC1") && w.body.data.answer.includes("1. step one"));
  resetCounters(); const q3 = "Đây là câu hỏi thử nghiệm hợp lệ số hai"; injected.set(q3, () => ({ type: "off_topic", messageVi: "OT-VI-RC1", messageEn: "OT-EN-RC1" })); const a = await askJson(q3); assert.equal(a.status, 200); assert.equal(a.body.data.answer, "OT-VI-RC1"); assert.equal(c.llm, 0);
  resetCounters(); const e = await askJson("Tôi muốn tự tử."); assert.equal(e.status, 200); assert.ok(e.body.data.answer.includes("Mình rất tiếc khi nghe bạn")); assert.equal(c.llm, 0);
});

// ───────────────────── U. the contract itself ─────────────────────
test("RC1-UNIT the synchronous boundary is synchronous: guardVerdict / classifySafetyVerdict are not async, never return a Promise, and refuse a Promise / thenable WITHOUT touching it", async () => {
  const { guardVerdict, classifySafetyVerdict } = await import("../llm/orchestrator.service");
  for (const f of [guardVerdict, classifySafetyVerdict]) assert.notEqual(f.constructor.name, "AsyncFunction", `${f.name} is not an async function`);
  const probe: Probe = { reads: 0 };
  const hostile = [() => Promise.resolve({ type: "safe" }), () => { const p = Promise.resolve({ type: "safe" }); Object.defineProperty(p, "constructor", { get() { probe.reads++; return Promise; } }); return p; },
    () => ({ type: "safe", then() { probe.reads++; } }), () => Object.defineProperty({ type: "safe" }, "then", { get() { probe.reads++; return undefined; } })];
  for (const mk of hostile) { const r = guardVerdict(mk); assert.equal(typeof (r as unknown as { then?: unknown }).then, "undefined", "the result is plain data, not a Promise"); assert.equal(r.ok, false); }
  assert.equal(probe.reads, 0, "no hostile code ran"); assert.equal(guardVerdict(() => { throw new Error(SECRET_DETAIL); }).ok, false);
});
test("RC1-UNIT resolveProfileAwareSafety (exported, kept for compatibility) now takes a verdict, awaits only the profile AGE, and only a trusted frozen snapshot crosses its async return boundary — a thenable minors' producer cannot turn the minors' triage into `safe`", async () => {
  const { resolveProfileAwareSafety } = await import("../llm/orchestrator.service");
  const q = minorQuestion("u1"); const ageOf = (a: number) => async () => a;
  const minor = await resolveProfileAwareSafety(q, safetyGuard.check(q), ageOf(16)); assert.equal(minor.type, "minor_age_nutrition_request"); assert.ok(Object.isFrozen(minor)); assert.equal(typeof (minor as unknown as { then?: unknown }).then, "undefined");
  assert.equal((await resolveProfileAwareSafety(q, safetyGuard.check(q), ageOf(30))).type, "safe");
  injectedMinor = () => ({ then(res: (v: unknown) => void) { res({ type: "safe" }); } });
  const thenable = await resolveProfileAwareSafety(q, safetyGuard.check(q), ageOf(16)); assert.notEqual(thenable.type, "safe", "the minors' triage cannot become safe"); assert.equal(thenable.type, "emergency_unassessable");
  injectedMinor = null; const bad = await resolveProfileAwareSafety(q, Promise.resolve({ type: "safe" }) as never, ageOf(16)); assert.equal(bad.type, "emergency_unassessable", "an invalid input verdict fails closed instead of being trusted");
});

// ───────────────────── S. the architecture is locked statically too (CODE AUDIT of this file's own source; the behaviour above is the runtime evidence) ─────────────────────
test("RC1-STATIC the safety gate region has exactly ONE await — the profile-AGE lookup — and no boundary function around a raw verdict is async or uses Promise assimilation", async () => {
  const { readFileSync } = await import("node:fs"); const { join } = await import("node:path");
  const src = readFileSync(join(__dirname, "../llm/orchestrator.service.ts"), "utf8");
  const a = src.indexOf("// RC1: raw → snapshot in ONE synchronous step"), b = src.indexOf("const safetyCheck: SafetyVerdict = gate.verdict;"); assert.ok(a > 0 && b > a, "gate region markers");
  const region = src.slice(a, b).replace(/\/\/.*$/gm, ""); const awaits = region.match(/\bawait\b/g) ?? []; // code only (comments stripped)
  assert.equal(awaits.length, 2, `the gate region has exactly two awaits, both of the profile-AGE lookup (I/O data, never a verdict): ${region.replace(/\s+/g, " ").slice(0, 600)}`);
  assert.ok(/await lookupProfileAge\(/.test(region) && /await profileExtractor\.extract\(/.test(region), "…the lookup and the profile read it wraps");
  for (const fn of ["guardVerdict", "classifySafetyVerdict", "applyProfileAge", "needsProfileAge", "isSafeVerdict", "parseGuidance", "ownData"]) assert.ok(!new RegExp(`async\s+(function\s+)?${fn}\b|${fn}\s*=\s*async`).test(src), `${fn} must not be async`);
  assert.ok(!/isPromise\(/.test(src) && !/Promise\.resolve\([^)]*verdict/i.test(src), "no Promise assimilation of a verdict anywhere in the orchestrator");
  const profileFn = src.slice(src.indexOf("export async function resolveProfileAwareSafety"), src.indexOf("/** Minor prompt note + supervision line"));
  assert.ok(profileFn.indexOf("classifySafetyVerdict(safetyCheck)") > 0 && profileFn.indexOf("classifySafetyVerdict(safetyCheck)") < profileFn.indexOf("await "), "the compatibility entry parses its input verdict BEFORE its first await");
  assert.ok(!/return\s+safetyGuard\.minorAgeResult\(\)/.test(src), "the minors' producer result is never returned raw");
});
