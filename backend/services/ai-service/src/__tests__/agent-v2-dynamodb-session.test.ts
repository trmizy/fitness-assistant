/**
 * V2 Multi-Agent M7-P3.1 — DynamoDB VersionedSessionStore. The SDK is mocked at the transport boundary (`send` receives
 * the REAL lib-dynamodb GetCommand / PutCommand objects; the fake evaluates exactly the two condition expressions the
 * adapter emits, atomically). VERIFIED BY OFFLINE TEST — NOT VERIFIED BY REAL DYNAMODB. Injected clock, no sleeps;
 * no AWS, network, Redis, DB or model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "10000";
for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AGENT_V2_SESSION_STORE", "AGENT_V2_SESSION_TABLE", "AGENT_V2_SESSION_REGION"]) delete process.env[k];

import type { MockProvider } from "./m5-benchmark/harness";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../agent-v2/supervisor";
import type { ContextEntry } from "../agent-v2/session-context";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
const MIN = 60_000; const H = 60 * MIN;
const TABLE = "fitness-assistant-dev-ai-v2-session";
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };

let hz: typeof import("./m5-benchmark/harness");
let sc: typeof import("../agent-v2/session-context");
let dd: typeof import("../agent-v2-integration/dynamodb-session-store");
let rt: typeof import("../agent-v2-integration/multi-agent-runtime");
let lib: typeof import("@aws-sdk/lib-dynamodb");
let app: Express;
let blocked = 0; let llmCalls = 0; let v1AskReached = 0; let realSdkSends = 0;

test.before(async () => {
  globalThis.fetch = (async () => { blocked++; throw new Error("network blocked"); }) as typeof fetch;
  const axios = (await import("axios")).default;
  axios.defaults.adapter = async () => { blocked++; throw new Error("network blocked"); };
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  (DynamoDBClient.prototype as any).send = async () => { realSdkSends++; throw new Error("real DynamoDB blocked"); };
  const { bedrockRuntimeDeps } = await import("../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { blocked++; throw new Error("provider blocked"); }) as any;
  const { llmService } = await import("../services/llm.service");
  (llmService as any).callLLM = async () => { llmCalls++; throw new Error("TRIPWIRE"); };
  const { authServiceClientDeps } = await import("../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => {
    const id = TOKENS[token]; if (!id) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { status: 200, data: { user: { id, role: "CUSTOMER" } } };
  }) as any;
  const { aiController } = await import("../controllers/ai.controller");
  (aiController as any).ask = (_req: any, res: any) => { v1AskReached++; res.status(200).json({ success: true, data: { v1: true } }); };
  hz = await import("./m5-benchmark/harness");
  sc = await import("../agent-v2/session-context");
  dd = await import("../agent-v2-integration/dynamodb-session-store");
  rt = await import("../agent-v2-integration/multi-agent-runtime");
  lib = await import("@aws-sdk/lib-dynamodb");
  ({ default: app } = await import("../app"));
  process.env.AI_AGENT_V2 = "on";
});
test.after(() => { rt.multiAgentRuntimeSeam.factory = null; delete process.env.AI_AGENT_V2; });

// ── fake DynamoDB at the SDK transport boundary ──────────────────────────────────────────────────────────────────────
function fakeDynamo() {
  const items = new Map<string, Record<string, any>>();
  const calls: Array<{ op: string; input: any }> = [];
  const st = { failWith: null as null | string, hang: false, beforePut: null as null | (() => void), puts: 0, odd: false };
  const cond = (input: any, cur: Record<string, any> | undefined) => {
    const v = input.ExpressionAttributeValues ?? {};
    if (input.ConditionExpression === "attribute_not_exists(pk) OR expiresAt <= :now") return !cur || cur.expiresAt <= v[":now"];
    if (input.ConditionExpression === "gen = :gen AND ver = :ver AND expiresAt > :now") return !!cur && cur.gen === v[":gen"] && cur.ver === v[":ver"] && cur.expiresAt > v[":now"];
    throw Object.assign(new Error("bad condition"), { name: "ValidationException" });
  };
  const send = async (command: any, options: { abortSignal: AbortSignal }) => {
    const op = command instanceof lib.GetCommand ? "Get" : command instanceof lib.PutCommand ? "Put" : "Other";
    calls.push({ op, input: structuredClone(command.input) });
    assert.ok(options?.abortSignal instanceof AbortSignal, "every call carries an abort signal");
    if (st.hang) return new Promise(() => {});
    if (st.failWith) throw Object.assign(new Error("sdk failure"), { name: st.failWith });
    if (command.input.TableName !== TABLE) throw Object.assign(new Error("Requested resource not found"), { name: "ResourceNotFoundException" });
    if (op === "Get") { if (st.odd) return null; const it = items.get(command.input.Key.pk); return it ? { Item: structuredClone(it) } : {}; }
    if (op === "Put") {
      st.puts++; st.beforePut?.();
      const item = command.input.Item;
      if (!cond(command.input, items.get(item.pk))) throw Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
      items.set(item.pk, structuredClone(item)); return {};
    }
    throw Object.assign(new Error("unsupported"), { name: "ValidationException" });
  };
  return { items, calls, st, send };
}
const entry = (owner: string, sid: string, over: Partial<ContextEntry> = {}): ContextEntry => ({
  id: `e-${Math.random().toString(36).slice(2)}`, owner, sessionId: sid, kind: "TOOL_EVIDENCE", subject: "training.todaySchedule",
  value: { known: true, sessionCount: 1, focus: "LOWER_BODY" }, source: { producer: "training", toolIds: ["training.get_today_schedule"], turnId: "t" },
  createdAt: T0, expiresAt: T0 + 30 * MIN, verification: "VERIFIED", ...over,
});
const clockAt = (t0 = T0) => { let t = t0; return { now: () => t, advance: (ms: number) => { t += ms; } }; };
const store = (f: ReturnType<typeof fakeDynamo>, clock = clockAt(), timeoutMs?: number) => dd.createDynamoSessionStore({ tableName: TABLE, send: f.send as any, now: clock.now, ...(timeoutMs ? { timeoutMs } : {}) });

// ── unit ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DD-1 create / read / update: own table, consistent read, conditional create then version-checked put, 6 h TTL in epoch seconds", async () => {
  const f = fakeDynamo(); const c = clockAt(); const s = store(f, c);
  assert.deepEqual(await s.read(USER_A, "s1"), { entries: [], version: "0" });
  assert.equal(await sc.updateSession(s, USER_A, "s1", () => [entry(USER_A, "s1")]), "ok");
  const pk = `S#${USER_A}#s1`;
  const it = f.items.get(pk)!;
  assert.equal(it.ver, 1); assert.equal(it.schema, "agent-v2-session/1"); assert.equal(it.expiresAt, Math.ceil((T0 + 6 * H) / 1000)); assert.ok(/^[0-9a-f-]{36}$/.test(it.gen));
  const gets = f.calls.filter((x) => x.op === "Get"); assert.ok(gets.every((g) => g.input.ConsistentRead === true && g.input.TableName === TABLE && g.input.Key.pk === pk));
  const firstPut = f.calls.find((x) => x.op === "Put")!.input;
  assert.equal(firstPut.ConditionExpression, "attribute_not_exists(pk) OR expiresAt <= :now");
  c.advance(10 * MIN);
  assert.equal(await sc.updateSession(s, USER_A, "s1", (cur) => sc.mergeEntries(cur as ContextEntry[], [entry(USER_A, "s1", { subject: "nutrition.nutritionTarget", value: { status: "ACTIVE_GOAL" }, source: { producer: "nutrition", turnId: "t2" } })])), "ok");
  const second = f.calls.filter((x) => x.op === "Put")[1].input;
  assert.equal(second.ConditionExpression, "gen = :gen AND ver = :ver AND expiresAt > :now"); assert.equal(second.ExpressionAttributeValues[":ver"], 1);
  assert.equal(f.items.get(pk)!.ver, 2); assert.equal(f.items.get(pk)!.gen, it.gen, "same incarnation");
  assert.equal(f.items.get(pk)!.expiresAt, Math.ceil((T0 + 10 * MIN + 6 * H) / 1000), "sliding TTL");
  const r = await s.read(USER_A, "s1"); assert.equal(r.version, `${it.gen}.2`); assert.equal(r.entries.length, 2);
});

test("DD-2 CAS: stale version rejected; first-write race → one creates, the other re-reads and merges; bounded rounds", async () => {
  const f = fakeDynamo(); const s = store(f);
  assert.equal(await s.write(USER_A, "s2", "0", [entry(USER_A, "s2")]), true);
  assert.equal(await s.write(USER_A, "s2", "0", []), false, "a second create cannot overwrite a live session");
  const v = (await s.read(USER_A, "s2")).version;
  assert.equal(await s.write(USER_A, "s2", v, [entry(USER_A, "s2")]), true);
  assert.equal(await s.write(USER_A, "s2", v, []), false, "a writer holding the previous version is rejected");
  // first-write race through updateSession: another writer creates the session between our read and our put
  const g = fakeDynamo(); const s2 = store(g); let once = true;
  g.st.beforePut = () => { if (once) { once = false; g.items.set(`S#${USER_A}#race`, { pk: `S#${USER_A}#race`, gen: "gen-other-0001", ver: 1, schema: "agent-v2-session/1", expiresAt: Math.ceil((T0 + H) / 1000),
    data: JSON.stringify([entry(USER_A, "race", { subject: "user.statedMinorAge", kind: "USER_STATEMENT", value: { underEighteen: true }, source: { producer: "user", turnId: "y" }, expiresAt: null, verification: "USER_REPORTED" })]) }); } };
  const res = await sc.updateSession(s2, USER_A, "race", (cur) => sc.mergeEntries(sc.reusableContext(cur, USER_A, "race", T0).all, [entry(USER_A, "race")]));
  assert.equal(res, "ok");
  const merged = JSON.parse(g.items.get(`S#${USER_A}#race`)!.data) as ContextEntry[];
  assert.deepEqual(merged.map((e) => e.subject).sort(), ["training.todaySchedule", "user.statedMinorAge"], "the concurrent writer's minor restriction survived");
  g.st.beforePut = () => { const it = g.items.get(`S#${USER_A}#race`)!; g.items.set(it.pk, { ...it, ver: it.ver + 1 }); };
  g.st.puts = 0;
  assert.equal(await sc.updateSession(s2, USER_A, "race", (cur) => cur as ContextEntry[]), "conflict"); assert.equal(g.st.puts, 3, "≤ 3 conditional puts");
});

test("DD-3 expiry is enforced on read (item still physically present); a stale writer cannot touch an expired or re-created session", async () => {
  const f = fakeDynamo(); const c = clockAt(); const s = store(f, c);
  await s.write(USER_A, "s3", "0", [entry(USER_A, "s3"), entry(USER_A, "s3", { subject: "user.statedMinorAge", kind: "USER_STATEMENT", value: { underEighteen: true }, source: { producer: "user", turnId: "t" }, expiresAt: null, verification: "USER_REPORTED" })]);
  const old = (await s.read(USER_A, "s3")).version;
  c.advance(6 * H + 1_000); // past the session TTL; the TTL sweep has NOT deleted the item
  assert.ok(f.items.has(`S#${USER_A}#s3`), "item still physically present");
  assert.deepEqual(await s.read(USER_A, "s3"), { entries: [], version: "0" }, "an expired session is no live session; its entries are never returned");
  assert.equal(await s.write(USER_A, "s3", old, [entry(USER_A, "s3")]), false, "a stale writer cannot resurrect an expired session");
  assert.equal(await s.write(USER_A, "s3", "0", [entry(USER_A, "s3", { subject: "nutrition.nutritionTarget", value: { status: "ACTIVE_GOAL" }, source: { producer: "nutrition", turnId: "n" } })]), true, "a new incarnation may be created");
  const fresh = (await s.read(USER_A, "s3")).version;
  assert.notEqual(fresh.split(".")[0], old.split(".")[0], "new incarnation id");
  assert.equal(fresh.split(".")[1], "1");
  assert.equal(await s.write(USER_A, "s3", old, []), false, "even with the same ver number, the old incarnation's writer is rejected");
});

test("DD-4 schema mismatch / malformed / non-array / pk mismatch / oversize → CORRUPT (never empty, never overwritten)", async () => {
  const f = fakeDynamo(); const s = store(f); const pk = `S#${USER_A}#s4`;
  const base = { pk, gen: "gen-aaaa-0001", ver: 3, schema: "agent-v2-session/1", expiresAt: Math.ceil((T0 + H) / 1000), data: "[]" };
  for (const bad of [{ ...base, schema: "agent-v2-session/0" }, { ...base, data: "{oops" }, { ...base, data: "{}" }, { ...base, ver: "x" }, { ...base, gen: "" }, { ...base, pk: "S#other#s4" }, { ...base, expiresAt: "soon" }, { ...base, data: JSON.stringify("x".repeat(70_000)) }]) {
    f.items.set(pk, bad);
    assert.equal((await sc.readSession(s, USER_A, "s4")).status, "corrupt", JSON.stringify(bad).slice(0, 80));
    assert.equal(await sc.updateSession(s, USER_A, "s4", () => []), "corrupt");
  }
  await assert.rejects(s.write(USER_A, "s5", "0", Array.from({ length: 48 }, (_, i) => entry(USER_A, "s5", { value: { known: true, pad: "y".repeat(2_000), i } as any }))), (e: any) => e.kind === "TOO_LARGE");
  await assert.rejects(s.write(USER_A, "s5", "not-a-version", []), (e: any) => e.kind === "CONFIGURATION_ERROR");
});

test("DD-5 SDK failures are typed and never 'empty': AccessDenied, throttling, timeout, missing table, odd response, unknown", async () => {
  const f = fakeDynamo(); const s = store(f, clockAt(), 30);
  for (const [name, kind] of [["AccessDeniedException", "ACCESS_DENIED"], ["UnrecognizedClientException", "ACCESS_DENIED"], ["ProvisionedThroughputExceededException", "THROTTLED"],
    ["ThrottlingException", "THROTTLED"], ["TimeoutError", "TIMEOUT"], ["ResourceNotFoundException", "CONFIGURATION_ERROR"], ["InternalServerError", "UNAVAILABLE"]] as const) {
    f.st.failWith = name;
    await assert.rejects(s.read(USER_A, "s6"), (e: any) => e.kind === kind, name);
    await assert.rejects(s.write(USER_A, "s6", "0", []), (e: any) => e.kind === kind, name);
    assert.equal((await sc.readSession(s, USER_A, "s6")).status, "unavailable", name);
  }
  f.st.failWith = null; f.st.hang = true; const t = Date.now();
  await assert.rejects(s.read(USER_A, "s6"), (e: any) => e.kind === "TIMEOUT"); assert.ok(Date.now() - t < 2_000);
  f.st.hang = false; f.st.odd = true;
  await assert.rejects(s.read(USER_A, "s6"), (e: any) => e.kind === "INVALID_RESPONSE"); f.st.odd = false;
  const wrong = dd.createDynamoSessionStore({ tableName: "some-other-table", send: f.send as any, now: () => T0 });
  await assert.rejects(wrong.read(USER_A, "s6"), (e: any) => e.kind === "CONFIGURATION_ERROR");
  assert.throws(() => dd.createDynamoSessionStore({ tableName: "", send: f.send as any }), (e: any) => e.kind === "CONFIGURATION_ERROR");
});

test("DD-6 isolation + write allowlist: per-user partition key; foreign / forbidden entries and fields never stored", async () => {
  const f = fakeDynamo(); const s = store(f);
  await s.write(USER_A, "shared", "0", [{ ...entry(USER_A, "shared"), prompt: "SYSTEM", token: "Bearer x" } as any, entry(USER_B, "shared"), entry(USER_A, "shared", { kind: "AGENT_HYPOTHESIS", subject: "progress.bodyTrend", verification: "UNVERIFIED" })]);
  await s.write(USER_B, "shared", "0", [entry(USER_B, "shared")]);
  assert.deepEqual([...f.items.keys()].sort(), [`S#${USER_A}#shared`, `S#${USER_B}#shared`].sort());
  const a = f.items.get(`S#${USER_A}#shared`)!.data;
  for (const bad of ["SYSTEM", "Bearer", USER_B, "AGENT_HYPOTHESIS"]) assert.ok(!a.includes(bad), bad);
  assert.ok(f.calls.every((c) => c.input.TableName === TABLE), "one table only");
  assert.throws(() => dd.dynamoSessionKey(USER_A, "../x"), (e: any) => e.kind === "CONFIGURATION_ERROR");
});

// ── supervisor over two instances sharing one fake table ─────────────────────────────────────────────────────────────
function instance(f: ReturnType<typeof fakeDynamo>, clock = clockAt()) {
  const w = hz.world(clock.now);
  const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
  const traces: SupervisorTrace[] = [];
  const runtime = rt.createMultiAgentRuntime({
    providerFor: (a) => prov[a], now: clock.now, deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress },
    profileGet: async (req) => ({ status: 200, data: { profile: { userId: TOKENS[String(req.headers.Authorization).replace("Bearer ", "")], age: 30 } } }),
    sessionStore: dd.createDynamoSessionStore({ tableName: TABLE, send: f.send as any, now: clock.now, timeoutMs: 50 }), traceSink: (x) => traces.push(x),
  });
  const ask = (q: string, user: "A" | "B" = "A", sessionId = "sess-d") => runtime.ask({ question: q, identity: { userId: user === "A" ? USER_A : USER_B, authorizationHeader: `Bearer tok-${user.toLowerCase()}` }, sessionId });
  return { ask, w, prov, traces, runtime };
}
const storedOf = (f: ReturnType<typeof fakeDynamo>, user = USER_A, sid = "sess-d") => JSON.parse(f.items.get(`S#${user}#${sid}`)?.data ?? "[]") as ContextEntry[];

test("DD-7 minor claim across instances (USER_REPORTED, never a profile age); a later adult claim does not lift it; concurrent writes keep it", async () => {
  const f = fakeDynamo(); const i1 = instance(f); const i2 = instance(f);
  i2.prov.training.script(hz.use(hz.call("training.get_today_schedule")), hz.say("Hôm nay bạn có buổi Leg day."));
  await Promise.all([i1.ask("Tôi 16 tuổi."), i2.ask("Hôm nay tôi tập gì?")]);
  const st = storedOf(f);
  const minor = st.find((e) => e.subject === "user.statedMinorAge")!;
  assert.ok(minor && minor.verification === "USER_REPORTED" && minor.kind === "USER_STATEMENT" && minor.expiresAt === null);
  assert.ok(st.some((e) => e.subject === "training.todaySchedule"), "the concurrent turn's evidence was merged, not lost");
  const i3 = instance(f);
  const p = await i3.ask("Mục tiêu calo của tôi là bao nhiêu?");
  assert.equal(p.status, "MINOR_PROTECTED"); assert.equal(i3.traces[0].profileRead, "PROFILE_OK"); assert.deepEqual(i3.traces[0].ageGate?.minorBy, ["HISTORY"]);
  assert.equal((await i3.ask("À nhầm, tôi 25 tuổi rồi, mục tiêu calo của tôi là bao nhiêu?")).status, "MINOR_PROTECTED");
  assert.deepEqual(i3.w.calls, []);
  const j = fakeDynamo(); const k = instance(j);
  assert.equal((await k.ask("Em 15 tuổi, em nên ăn bao nhiêu calo?")).status, "SAFETY_BLOCKED");
  assert.ok(storedOf(j).some((e) => e.subject === "user.statedMinorAge"), "a safety-blocked turn still records the restriction");
});

test("DD-8 store failure never unlocks personal access: AccessDenied / throttling / timeout → SESSION_UNAVAILABLE; general stays general-only", async () => {
  const f = fakeDynamo(); await instance(f).ask("Tôi 16 tuổi.");
  for (const mode of ["AccessDeniedException", "ThrottlingException", "hang"] as const) {
    if (mode === "hang") { f.st.failWith = null; f.st.hang = true; } else f.st.failWith = mode;
    const i = instance(f);
    const r = await i.ask("Mục tiêu calo của tôi là bao nhiêu?");
    assert.equal(r.status, "SESSION_UNAVAILABLE", mode); assert.equal(i.traces[0].session?.store, "UNAVAILABLE"); assert.equal(i.traces[0].profileRead, "PROFILE_OK");
    assert.deepEqual(i.w.calls, []);
    i.prov.nutrition.script(hz.say("Protein giúp cơ phục hồi sau tập.")); i.prov.recovery.script(hz.say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
    await i.ask("Protein có vai trò gì trong phục hồi cơ?");
    for (const req of [...i.prov.nutrition.requests, ...i.prov.recovery.requests]) assert.ok(req.tools.every((t) => !/get_target|get_recent_sessions|get_training_load|get_active_state/.test(t.name)), mode);
    assert.deepEqual(i.w.calls, []);
    f.st.hang = false; f.st.failWith = null;
  }
  f.st.failWith = "ProvisionedThroughputExceededException";
  assert.equal((await instance(f).ask("Tôi 16 tuổi, mục tiêu calo của tôi là bao nhiêu?")).status, "SESSION_UNAVAILABLE", "a restriction that cannot be persisted refuses the turn");
  f.st.failWith = null;
});

test("DD-9 runtime config: dynamodb needs a valid table + region; production never memory, never a fallback; no SDK client unless selected", () => {
  let created = 0; const mk = () => { created++; return fakeDynamo().send as any; };
  for (const env of [{ AGENT_V2_SESSION_STORE: "dynamodb" }, { AGENT_V2_SESSION_STORE: "dynamodb", AGENT_V2_SESSION_TABLE: TABLE }, { AGENT_V2_SESSION_STORE: "dynamodb", AGENT_V2_SESSION_TABLE: TABLE, AGENT_V2_SESSION_REGION: "Singapore" },
    { AGENT_V2_SESSION_STORE: "dynamodb", AGENT_V2_SESSION_TABLE: "a b", AGENT_V2_SESSION_REGION: "ap-southeast-1" }, { NODE_ENV: "production" }, { NODE_ENV: "production", AGENT_V2_SESSION_STORE: "memory" },
    { NODE_ENV: "production", AGENT_V2_SESSION_STORE: "dynamodb", AGENT_V2_SESSION_REGION: "ap-southeast-1" }]) {
    assert.throws(() => rt.resolveSessionStore(env, undefined, mk), (e: any) => e.statusCode === 503, JSON.stringify(env));
  }
  assert.equal(created, 0, "no client is created for an invalid configuration");
  const s = rt.resolveSessionStore({ NODE_ENV: "production", AGENT_V2_SESSION_STORE: "dynamodb", AGENT_V2_SESSION_TABLE: TABLE, AGENT_V2_SESSION_REGION: "ap-southeast-1" }, undefined, mk);
  assert.equal((s as any).versioned, true); assert.equal(created, 1);
  rt.resolveSessionStore({}, undefined, mk); assert.equal(created, 1, "memory outside production creates no AWS client");
});

test("DD-10 HTTP over two instances sharing the fake table; flag OFF creates nothing; /ai/ask unchanged; no AWS / network / model call", async () => {
  process.env.AI_AGENT_V2 = "on";
  const f = fakeDynamo(); const i1 = instance(f); const i2 = instance(f);
  let n = 0; rt.multiAgentRuntimeSeam.factory = () => (n++ % 2 === 0 ? i1.runtime : i2.runtime);
  const post = (q: string) => request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question: q, sessionId: "http-d" });
  assert.equal((await post("Tôi 16 tuổi.")).status, 200);
  assert.equal((await post("Mục tiêu calo của tôi là bao nhiêu?")).body.data.status, "MINOR_PROTECTED");
  delete process.env.AI_AGENT_V2; const before = n; const callsBefore = f.calls.length;
  assert.equal((await post("Hôm nay tôi tập gì?")).status, 404); assert.equal(n, before); assert.equal(f.calls.length, callsBefore);
  const v = v1AskReached;
  assert.equal((await request(app).post("/ai/ask").set("Authorization", "Bearer tok-a").send({ question: "Hôm nay tôi tập gì?" })).status, 200); assert.equal(v1AskReached, v + 1);
  assert.equal(blocked, 0); assert.equal(llmCalls, 0); assert.equal(realSdkSends, 0, "the real DynamoDB client was never used");
  process.env.AI_AGENT_V2 = "on";
});
