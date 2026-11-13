/**
 * V2 Multi-Agent M7-P3 — persistent, versioned session context shared by application instances.
 * A FAKE Redis client implements exactly the two commands the adapter uses (HMGET; EVAL of CAS_SCRIPT with the script's
 * semantics in JS, atomic like Lua) — VERIFIED BY OFFLINE TEST, NOT VERIFIED BY REAL REDIS. Two "instances" = two
 * independently built runtimes (own runners, model providers, caches) over ONE shared fake store. Injectable clock; no
 * sleeps. No Redis, DB, AWS, network or model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "10000";
for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AGENT_V2_SESSION_STORE", "AGENT_V2_SESSION_REDIS_URL"]) delete process.env[k];

import type { MockProvider } from "./m5-benchmark/harness";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../agent-v2/supervisor";
import type { TurnTrace } from "../agent-v2/turn-trace";
import type { ContextEntry } from "../agent-v2/session-context";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
const MIN = 60_000;
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };

let hz: typeof import("./m5-benchmark/harness");
let sc: typeof import("../agent-v2/session-context");
let rs: typeof import("../agent-v2-integration/redis-session-store");
let rt: typeof import("../agent-v2-integration/multi-agent-runtime");
let sup: typeof import("../agent-v2/supervisor");
let app: Express;
let blocked = 0; let llmCalls = 0; let v1AskReached = 0;

test.before(async () => {
  globalThis.fetch = (async () => { blocked++; throw new Error("network blocked"); }) as typeof fetch;
  const axios = (await import("axios")).default;
  axios.defaults.adapter = async () => { blocked++; throw new Error("network blocked"); };
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
  rs = await import("../agent-v2-integration/redis-session-store");
  rt = await import("../agent-v2-integration/multi-agent-runtime");
  sup = await import("../agent-v2/supervisor");
  ({ default: app } = await import("../app"));
  process.env.AI_AGENT_V2 = "on"; // runtime-level tests run the supervisor directly (MS-15 also checks the OFF path)
});
test.after(() => { rt.multiAgentRuntimeSeam.factory = null; delete process.env.AI_AGENT_V2; });

// ── fake Redis (the adapter's two commands; EVAL interprets exactly CAS_SCRIPT) ──────────────────────────────────────
function fakeRedis() {
  const hashes = new Map<string, Record<string, string>>();
  const ttl = new Map<string, number>();
  const ops: string[] = [];
  const st = { fail: null as null | "down" | "hang", beforeCas: null as null | (() => void), evals: 0 };
  return {
    hashes, ttl, ops, st,
    async hmGet(key: string, fields: string[]) {
      ops.push(`HMGET ${key}`);
      if (st.fail === "down") throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      if (st.fail === "hang") return new Promise<never>(() => {});
      const h = hashes.get(key); return fields.map((f) => h?.[f] ?? null);
    },
    async eval(script: string, o: { keys: string[]; arguments: string[] }) {
      ops.push(`EVAL ${o.keys[0]}`); st.evals++;
      if (st.fail === "down") throw new Error("connection closed");
      if (st.fail === "hang") return new Promise<never>(() => {});
      if (script !== rs.CAS_SCRIPT) throw new Error("unexpected script");
      st.beforeCas?.();
      const [expected, next, schema, data, ttlMs] = o.arguments;
      if ((hashes.get(o.keys[0])?.version ?? "0") !== expected) return 0;
      hashes.set(o.keys[0], { version: next, schema, data }); ttl.set(o.keys[0], Number(ttlMs)); return 1;
    },
  };
}
const entry = (owner: string, sid: string, over: Partial<ContextEntry> = {}): ContextEntry => ({
  id: `e-${Math.random().toString(36).slice(2)}`, owner, sessionId: sid, kind: "TOOL_EVIDENCE", subject: "training.todaySchedule",
  value: { known: true, sessionCount: 1, focus: "LOWER_BODY" }, source: { producer: "training", toolIds: ["training.get_today_schedule"], turnId: "t" },
  createdAt: T0, expiresAt: T0 + 30 * MIN, verification: "VERIFIED", ...over,
});

// ── unit: adapter + contract ─────────────────────────────────────────────────────────────────────────────────────────
test("PS-1 create / load / update: versioned, namespaced key, schema field, sliding 6 h TTL", async () => {
  const r = fakeRedis(); const store = rs.createRedisSessionStore({ client: r });
  assert.deepEqual(await store.read(USER_A, "s1"), { entries: [], version: "0" });
  assert.equal(await sc.updateSession(store, USER_A, "s1", () => [entry(USER_A, "s1")]), "ok");
  const key = `gymini:agent-v2:session:v1:${USER_A}:s1`;
  assert.equal(r.hashes.get(key)?.version, "1"); assert.equal(r.hashes.get(key)?.schema, "agent-v2-session/1");
  assert.equal(r.ttl.get(key), 6 * 60 * MIN);
  const got = await store.read(USER_A, "s1"); assert.equal(got.version, "1"); assert.equal((got.entries[0] as ContextEntry).subject, "training.todaySchedule");
  r.ttl.set(key, 1);
  assert.equal(await sc.updateSession(store, USER_A, "s1", (cur) => sc.mergeEntries(cur as ContextEntry[], [entry(USER_A, "s1", { subject: "nutrition.nutritionTarget", value: { status: "ACTIVE_GOAL" }, source: { producer: "nutrition", turnId: "t2" } })])), "ok");
  assert.equal(r.hashes.get(key)?.version, "2"); assert.equal(r.ttl.get(key), 6 * 60 * MIN, "every write refreshes the session TTL");
  r.hashes.delete(key); // Redis expired the whole session
  assert.deepEqual(await store.read(USER_A, "s1"), { entries: [], version: "0" });
  assert.ok(r.ops.every((o) => o.split(" ")[1].startsWith(rs.SESSION_KEY_PREFIX)), "only V2 session keys are ever touched");
});

test("PS-2 per-entry freshness (injected clock): tool evidence 30 min, statements 6 h, the stated-minor entry lasts the session; invalidated never reused", () => {
  const s = "s2"; const at = { owner: USER_A, sessionId: s, turnId: "t", now: T0 };
  const entries = [entry(USER_A, s), sc.userStatement("user.fatigue", { reported: true }, at), sc.statedMinorAgeStatement(at)];
  const at31 = sc.reusableContext(entries, USER_A, s, T0 + 31 * MIN);
  assert.deepEqual([...at31.reuse.freshSubjects].sort(), ["user.fatigue", "user.statedMinorAge"]); assert.deepEqual(at31.reuse.staleSubjects, ["training.todaySchedule"]);
  const at7h = sc.reusableContext(entries, USER_A, s, T0 + 7 * 60 * MIN);
  assert.deepEqual([...at7h.reuse.freshSubjects], ["user.statedMinorAge"]); assert.ok(sc.hasStatedMinorAge(at7h.all));
  const inv = sc.invalidate(entries, "training.todaySchedule");
  assert.ok(!sc.reusableContext(inv, USER_A, s, T0 + MIN).reuse.freshSubjects.has("training.todaySchedule"));
  assert.equal(sc.statedMinorAgeStatement(at).verification, "USER_REPORTED"); assert.deepEqual(sc.statedMinorAgeStatement(at).value, { underEighteen: true });
});

test("PS-3 load validation: tampered / foreign entries are dropped; bad schema, malformed JSON, non-array, oversize → CORRUPT (never 'empty')", async () => {
  const r = fakeRedis(); const store = rs.createRedisSessionStore({ client: r });
  const key = rs.sessionKey(USER_A, "s3");
  const bad = [entry(USER_A, "s3"), entry(USER_B, "s3"), entry(USER_A, "other"), { ...sc.userStatement("user.fatigue", { reported: true }, { owner: USER_A, sessionId: "s3", turnId: "t", now: T0 }), verification: "VERIFIED" },
    entry(USER_A, "s3", { kind: "TOOL_EVIDENCE", subject: "progress.measurementAvailability", source: { producer: "nutrition", turnId: "t" } })];
  r.hashes.set(key, { version: "4", schema: "agent-v2-session/1", data: JSON.stringify(bad) });
  const read = await sc.readSession(store, USER_A, "s3");
  assert.equal(read.status, "ok");
  const ctx = sc.reusableContext((read as any).raw, USER_A, "s3", T0 + MIN);
  assert.equal(ctx.reuse.counts.droppedInvalid, 4); assert.deepEqual([...ctx.reuse.freshSubjects], ["training.todaySchedule"]);
  for (const h of [{ version: "4", schema: "agent-v2-session/0", data: "[]" }, { version: "4", schema: "agent-v2-session/1", data: "{not json" }, { version: "4", schema: "agent-v2-session/1", data: "{}" },
    { version: "x", schema: "agent-v2-session/1", data: "[]" }, { version: "4", schema: "agent-v2-session/1", data: JSON.stringify("x".repeat(70_000)) }]) {
    r.hashes.set(key, h);
    assert.equal((await sc.readSession(store, USER_A, "s3")).status, "corrupt", JSON.stringify(h).slice(0, 60));
    assert.equal(await sc.updateSession(store, USER_A, "s3", () => []), "corrupt", "a corrupt session is never silently overwritten");
  }
});

test("PS-4 write allowlist: only persistable kinds and listed fields; never a hypothesis, prompt, token or arbitrary payload", async () => {
  const r = fakeRedis(); const store = rs.createRedisSessionStore({ client: r });
  const poisoned = [
    { ...entry(USER_A, "s4"), prompt: "SYSTEM PROMPT", token: "Bearer tok-a", raw: { huge: "payload" } } as any,
    entry(USER_A, "s4", { kind: "AGENT_HYPOTHESIS", subject: "progress.bodyTrend", verification: "UNVERIFIED" }),
    entry(USER_A, "s4", { kind: "VERIFIED_PROFILE_FACT", subject: "user.age", value: { age: 16 } }),
    entry(USER_B, "s4"),
  ];
  assert.equal(await store.write(USER_A, "s4", "0", poisoned), true);
  const data = r.hashes.get(rs.sessionKey(USER_A, "s4"))!.data;
  for (const bad of ["SYSTEM PROMPT", "Bearer", "payload", "AGENT_HYPOTHESIS", "VERIFIED_PROFILE_FACT", USER_B]) assert.ok(!data.includes(bad), bad);
  assert.equal(JSON.parse(data).length, 1);
  await assert.rejects(store.write(USER_A, "s4", "1", Array.from({ length: 48 }, (_, i) => entry(USER_A, "s4", { value: { known: true, pad: "x".repeat(2_000), i } as any }))), (e: any) => e.kind === "TOO_LARGE");
  assert.throws(() => rs.sessionKey(USER_A, "../../x"), (e: any) => e.kind === "CONFIGURATION_ERROR");
});

test("PS-5 concurrency: a stale write is rejected; two interleaved updates both survive; CAS rounds are bounded; no retry on a store error", async () => {
  const r = fakeRedis(); const store = rs.createRedisSessionStore({ client: r });
  assert.equal(await store.write(USER_A, "s5", "0", [entry(USER_A, "s5")]), true);
  assert.equal(await store.write(USER_A, "s5", "0", []), false, "a writer holding version 0 cannot overwrite version 1");
  // interleave: writer X is about to CAS when writer Y commits first → X re-reads and merges
  let once = true;
  r.st.beforeCas = () => { if (once) { once = false; const h = r.hashes.get(rs.sessionKey(USER_A, "s5"))!; const cur = JSON.parse(h.data);
    cur.push(entry(USER_A, "s5", { subject: "nutrition.nutritionTarget", value: { status: "ACTIVE_GOAL" }, source: { producer: "nutrition", turnId: "y" } }));
    r.hashes.set(rs.sessionKey(USER_A, "s5"), { ...h, version: String(Number(h.version) + 1), data: JSON.stringify(cur) }); } };
  const x = await sc.updateSession(store, USER_A, "s5", (cur) => sc.mergeEntries(cur as ContextEntry[], [entry(USER_A, "s5", { subject: "recovery.recentSessions", value: { known: true }, source: { producer: "recovery", turnId: "x" } })]));
  assert.equal(x, "ok");
  const subjects = (await store.read(USER_A, "s5")).entries.map((e: any) => e.subject).sort();
  assert.deepEqual(subjects, ["nutrition.nutritionTarget", "recovery.recentSessions", "training.todaySchedule"], "neither concurrent update was lost");
  r.st.beforeCas = () => { const h = r.hashes.get(rs.sessionKey(USER_A, "s5"))!; r.hashes.set(rs.sessionKey(USER_A, "s5"), { ...h, version: String(Number(h.version) + 1) }); };
  r.st.evals = 0;
  assert.equal(await sc.updateSession(store, USER_A, "s5", (cur) => cur as ContextEntry[]), "conflict"); assert.equal(r.st.evals, 3, "at most 3 CAS rounds");
  r.st.beforeCas = null; r.st.fail = "down"; r.st.evals = 0; const opsBefore = r.ops.length;
  assert.equal(await sc.updateSession(store, USER_A, "s5", (cur) => cur as ContextEntry[]), "unavailable"); assert.equal(r.ops.length - opsBefore, 1, "one attempt, no retry on an error");
});

test("PS-6 unavailable / timeout are typed and bounded; the 48-entry history bound keeps every active entry", async () => {
  const r = fakeRedis(); const store = rs.createRedisSessionStore({ client: r, readTimeoutMs: 30, writeTimeoutMs: 30 });
  r.st.fail = "down"; await assert.rejects(store.read(USER_A, "s6"), (e: any) => e.kind === "UNAVAILABLE");
  r.st.fail = "hang"; const t = Date.now();
  await assert.rejects(store.read(USER_A, "s6"), (e: any) => e.kind === "TIMEOUT"); await assert.rejects(store.write(USER_A, "s6", "0", []), (e: any) => e.kind === "TIMEOUT");
  assert.ok(Date.now() - t < 2_000); assert.equal((await sc.readSession(store, USER_A, "s6")).status, "unavailable");
  const many = Array.from({ length: 80 }, (_, i) => entry(USER_A, "s6", { createdAt: T0 + i, verification: i < 75 ? "SUPERSEDED" : "VERIFIED", subject: i < 75 ? "training.todaySchedule" : `user.x${i}` as any, kind: i < 75 ? "TOOL_EVIDENCE" : "USER_STATEMENT", source: i < 75 ? { producer: "training", turnId: "t" } : { producer: "user", turnId: "t" } }));
  const pruned = sc.pruneForStorage(many);
  assert.equal(pruned.length, 48); assert.equal(pruned.filter((e) => e.verification === "VERIFIED").length, 5, "every active entry kept");
  assert.equal(sc.MAX_REUSED_ENTRIES, 12);
});

// ── two instances over one shared store ──────────────────────────────────────────────────────────────────────────────
type Profiles = Record<string, { status: number; data?: unknown }>;
function instance(shared: ReturnType<typeof fakeRedis>, o: { profiles?: Profiles; clock?: () => number } = {}) {
  const clock = o.clock ?? (() => T0);
  const w = hz.world(clock);
  const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
  const traces: SupervisorTrace[] = []; const agentTraces: TurnTrace[] = [];
  const profiles: Profiles = { "tok-a": { status: 200, data: { profile: { userId: USER_A, age: 30 } } }, "tok-b": { status: 200, data: { profile: { userId: USER_B, age: 30 } } }, ...(o.profiles ?? {}) };
  const runtime = rt.createMultiAgentRuntime({
    providerFor: (a) => prov[a], now: clock, deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress },
    profileGet: async (req) => { const r = profiles[String(req.headers.Authorization).replace("Bearer ", "")] ?? { status: 401 }; if (r.status >= 400) throw Object.assign(new Error("x"), { status: r.status }); return r as any; },
    sessionStore: rs.createRedisSessionStore({ client: shared }), traceSink: (x) => traces.push(x), agentTraceSink: (x) => agentTraces.push(x),
  });
  const ask = (q: string, user: "A" | "B" = "A", sessionId = "sess-1") => runtime.ask({ question: q, identity: { userId: user === "A" ? USER_A : USER_B, authorizationHeader: `Bearer tok-${user.toLowerCase()}` }, sessionId });
  return { ask, w, prov, traces, agentTraces, runtime };
}
const stored = (r: ReturnType<typeof fakeRedis>, user = USER_A, sid = "sess-1") => JSON.parse(r.hashes.get(rs.sessionKey(user, sid))?.data ?? "[]") as ContextEntry[];

test("MS-1 multi-instance reuse: instance 2 reuses the schedule instance 1 read (no re-read), as a labelled session fact", async () => {
  const r = fakeRedis(); const i1 = instance(r); const i2 = instance(r);
  i1.prov.training.script(hz.use(hz.call("training.get_today_schedule")), hz.say("Hôm nay bạn có buổi Leg day với 2 bài."));
  await i1.ask("Hôm nay tôi tập gì?");
  i2.prov.nutrition.script(hz.say("Trước buổi tập nên ăn nhẹ dễ tiêu."));
  const t2 = await i2.ask("Vậy trước buổi tập nên ăn gì?");
  assert.ok(i2.traces[0].session!.loaded > 0 && i2.traces[0].session!.reused > 0 && i2.traces[0].session!.store === "OK");
  assert.ok(!i2.w.calls.includes("getTodaySchedule:A"), "instance 2 did not re-read what instance 1 stored");
  assert.ok(["ANSWERED", "PARTIAL"].includes(t2.status));
});

test("MS-2..5 corrections, forecast continuity, conflicts and no promotion of agent output — across instances", async () => {
  const r = fakeRedis(); const i1 = instance(r); const i2 = instance(r);
  i1.prov.recovery.script(hz.use(hz.call("recovery.get_recent_sessions")), hz.say("Quan sát từ dữ liệu: hôm qua bạn ghi một buổi thân dưới với RPE 8. Bạn đã hồi phục hoàn toàn."));
  i1.prov.training.script(hz.use(hz.call("training.get_today_schedule")), hz.say("Hôm nay buổi Leg day: giảm tạ khoảng 10%."));
  await i1.ask("Tôi tập chân hôm qua, hôm nay nên tập gì?");
  i2.prov.recovery.script(hz.use(hz.call("recovery.get_recent_sessions")), hz.say("Quan sát từ dữ liệu: hôm qua bạn ghi một buổi thân dưới."));
  i2.prov.training.script(hz.use(hz.call("training.get_today_schedule")), hz.say("Hôm nay tập nhẹ thân trên."));
  await i2.ask("À không, hôm qua tôi tập lưng.");
  const st = stored(r);
  const claims = st.filter((e) => e.subject === "user.trainedYesterday");
  assert.ok(claims.length >= 2 && claims.filter((e) => e.verification === "USER_REPORTED").length === 1 && claims.some((e) => e.verification === "SUPERSEDED"), JSON.stringify(claims.map((e) => [e.value, e.verification])));
  assert.ok(st.every((e) => !(e.kind === "TOOL_EVIDENCE" && e.subject.startsWith("user."))), "a user statement is never tool evidence");
  assert.ok(st.some((e) => e.kind === "CONFLICT" && e.verification !== "SUPERSEDED"), "the recorded conflict survives later writes");
  const values = JSON.stringify(st.map((e) => e.value));
  for (const sent of ["hồi phục hoàn toàn", "giảm tạ", "thân trên"]) assert.ok(!values.includes(sent), `agent text never stored: ${sent}`);
  // forecast continuity: instance 1 hears the forecast, instance 2 is asked "how much did I lose?"
  const f = fakeRedis(); const f1 = instance(f); const f2 = instance(f, { clock: () => T0 + MIN });
  f1.prov.progress.script(hz.use(hz.call("progress.get_roadmap_forecast")), hz.say("Dự báo của ứng dụng là kịch bản giảm về khoảng 70.4 kg sau 8 tuần."));
  await f1.ask("Ứng dụng dự báo tôi giảm 2 kg.");
  f2.w.state.body = "absent";
  f2.prov.progress.script(hz.use(hz.call("progress.get_body_measurements")), hz.say("Bạn đã giảm được 2 kg. Hiện chưa có số đo cân nặng nào được ghi nên chưa thể tính mức đã giảm."));
  const r2 = await f2.ask("Vậy tôi đã giảm được bao nhiêu?");
  assert.doesNotMatch(r2.answer, /đã giảm được 2 kg/); assert.match(r2.answer, /^Lưu ý: con số trong dự báo là kịch bản/);
  assert.ok(stored(f).every((e) => !(e.kind === "FORECAST" && e.verification === "VERIFIED")) && stored(f).some((e) => e.subject === "user.mentionedForecast" && e.kind === "FORECAST"));
});

test("MS-6 minor statement persists across instances: restriction applies on instance 2, a later adult claim does not lift it, general mode stays guarded", async () => {
  const r = fakeRedis(); const i1 = instance(r);
  await i1.ask("Tôi 16 tuổi.");
  assert.ok(stored(r).some((e) => e.subject === "user.statedMinorAge" && e.verification === "USER_REPORTED" && e.expiresAt === null));
  // only "under 18" is stored, never the age itself (values only: ids / timestamps are random digits)
  assert.deepEqual(stored(r).find((e) => e.subject === "user.statedMinorAge")!.value, { underEighteen: true });
  assert.ok(!JSON.stringify(stored(r).map((e) => e.value)).includes("16"));
  const i2 = instance(r);
  const p = await i2.ask("Mục tiêu calo của tôi là bao nhiêu?");
  assert.equal(p.status, "MINOR_PROTECTED"); assert.deepEqual(i2.traces[0].ageGate?.minorBy, ["HISTORY"]); assert.equal(i2.traces[0].ageGate?.conflict, true);
  assert.equal(i2.traces[0].profileRead, "PROFILE_OK", "the profile age is not changed by the statement"); assert.deepEqual(i2.w.calls, []);
  const adult = await i2.ask("À nhầm, tôi 25 tuổi rồi, mục tiêu calo của tôi là bao nhiêu?");
  assert.equal(adult.status, "MINOR_PROTECTED", "a later adult claim never lifts the restriction");
  const i3 = instance(r);
  i3.prov.nutrition.script(hz.say("Bạn 25 tuổi nên cần 2400 kcal mỗi ngày. Protein giúp cơ phục hồi sau tập."));
  i3.prov.recovery.script(hz.say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  const g = await i3.ask("Protein có vai trò gì trong phục hồi cơ?");
  assert.equal(i3.traces[0].ageGate?.decision, "GENERAL_ONLY"); assert.doesNotMatch(g.answer, /25 tuổi|2400/); assert.match(g.answer, /Vì bạn dưới 18 tuổi/);
  for (const req of [...i3.prov.nutrition.requests, ...i3.prov.recovery.requests]) assert.ok(req.tools.every((t) => !/get_target|get_recent_sessions|get_training_load|get_active_state/.test(t.name)), "agents' own gate also sees the session minor");
  assert.deepEqual(i3.w.calls, []);
  // a safety-blocked turn still records the statement
  const s = fakeRedis(); const j = instance(s);
  assert.equal((await j.ask("Em 15 tuổi, em nên ăn bao nhiêu calo?")).status, "SAFETY_BLOCKED");
  assert.ok(stored(s).some((e) => e.subject === "user.statedMinorAge"));
});

test("MS-7 store failure never bypasses a restriction: unreadable / corrupt session → personal refused (SESSION_UNAVAILABLE), general guarded; distinct from profile states", async () => {
  const r = fakeRedis(); const i1 = instance(r);
  await i1.ask("Tôi 16 tuổi.");
  for (const mode of ["down", "corrupt"] as const) {
    if (mode === "down") r.st.fail = "down"; else { r.st.fail = null; r.hashes.set(rs.sessionKey(USER_A, "sess-1"), { version: "9", schema: "agent-v2-session/1", data: "{broken" }); }
    const i2 = instance(r);
    const p = await i2.ask("Mục tiêu calo của tôi là bao nhiêu?");
    assert.equal(p.status, "SESSION_UNAVAILABLE", mode); assert.equal(i2.traces[0].profileRead, "PROFILE_OK", "profile state is separate");
    assert.equal(i2.traces[0].session?.store, mode === "down" ? "UNAVAILABLE" : "CORRUPT"); assert.notEqual(i2.traces[0].ageGate?.status, "UNKNOWN");
    assert.deepEqual(i2.w.calls, []); assert.equal(i2.traces[0].delegations.length, 0);
    i2.prov.nutrition.script(hz.say("Protein giúp cơ phục hồi sau tập.")); i2.prov.recovery.script(hz.say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
    const g = await i2.ask("Protein có vai trò gì trong phục hồi cơ?");
    assert.ok(["ANSWERED", "PARTIAL"].includes(g.status), g.status); assert.deepEqual(i2.w.calls, []);
    for (const req of [...i2.prov.nutrition.requests, ...i2.prov.recovery.requests]) assert.ok(req.tools.every((t) => !/get_target|get_recent_sessions|get_training_load/.test(t.name)));
  }
  // a minor statement that cannot be persisted: this turn is refused (the restriction is never silently dropped)
  r.st.fail = "down";
  const k = instance(r);
  assert.equal((await k.ask("Tôi 16 tuổi, mục tiêu calo của tôi là bao nhiêu?")).status, "SESSION_UNAVAILABLE");
  r.st.fail = null;
});

test("MS-8/9 AGE_UNKNOWN high-risk still fails closed; same sessionId for two users is two separate sessions", async () => {
  const r = fakeRedis();
  const u = instance(r, { profiles: { "tok-a": { status: 200, data: { profile: { userId: USER_A, age: null } } } } });
  assert.equal((await u.ask("Tôi muốn giảm 5 kg, tiến độ cân nặng của tôi thế nào?")).status, "PROFILE_UNVERIFIED");
  const x = fakeRedis(); const a = instance(x); const b = instance(x);
  await a.ask("Tôi 16 tuổi.", "A", "shared");
  b.prov.nutrition.script(hz.use(hz.call("nutrition.get_target")), hz.say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày."));
  const rb = await b.ask("Mục tiêu calo của tôi là bao nhiêu?", "B", "shared");
  assert.equal(rb.status, "ANSWERED", "B is not affected by A's statement"); assert.equal(b.traces[0].session?.loaded, 0);
  assert.ok(stored(x, USER_A, "shared").some((e) => e.subject === "user.statedMinorAge"), "A's context untouched by B's write");
  assert.ok(stored(x, USER_B, "shared").every((e) => e.owner === USER_B));
});

test("MS-10 concurrent turns of one session on two instances: both results persisted, nothing overwritten", async () => {
  const r = fakeRedis(); const i1 = instance(r); const i2 = instance(r);
  i1.prov.training.script(hz.use(hz.call("training.get_today_schedule")), hz.say("Hôm nay bạn có buổi Leg day với 2 bài."));
  i2.prov.nutrition.script(hz.use(hz.call("nutrition.get_target")), hz.say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày."));
  await Promise.all([i1.ask("Hôm nay tôi tập gì?"), i2.ask("Mục tiêu calo của tôi là bao nhiêu?")]);
  const subjects = stored(r).map((e) => e.subject).sort();
  assert.ok(subjects.includes("training.todaySchedule") && subjects.includes("nutrition.nutritionTarget"), JSON.stringify(subjects));
  assert.ok([i1.traces[0].session?.saved, i2.traces[0].session?.saved].every((s) => s === "OK"));
});

test("MS-11/12/13 budget unchanged; traces carry codes only (no key, prefix, session id, URL or stated age); no BullMQ / other key touched", async () => {
  assert.deepEqual({ ...sup.SUPERVISOR_BUDGET }, { maxWallTimeMs: 60_000, maxModelCalls: 8, maxToolCalls: 6, maxInputTokens: 60_000, maxOutputTokens: 6_000, maxCostUsd: 0.08 });
  const r = fakeRedis(); const i = instance(r);
  await i.ask("Tôi 16 tuổi.", "A", "privacy-sess");
  i.prov.training.script(hz.use(hz.call("training.get_today_schedule")), hz.say("Hôm nay bạn có buổi tập."));
  await i.ask("Hôm nay tôi tập gì?", "A", "privacy-sess");
  const json = JSON.stringify([i.traces, i.agentTraces]);
  for (const bad of ["gymini:agent-v2", "privacy-sess", "redis://", "underEighteen", "statedMinorAge", USER_A]) assert.ok(!json.includes(bad), bad);
  assert.ok(r.ops.every((o) => o.split(" ")[1].startsWith("gymini:agent-v2:session:v1:")));
  const src = readFileSync(path.join(__dirname, "..", "agent-v2-integration", "redis-session-store.ts"), "utf8");
  assert.doesNotMatch(src, /from\s+["']bullmq["']|require\(\s*["']bullmq|["'](FLUSHALL|FLUSHDB|KEYS|SCAN|DEL)["']/i, "no BullMQ import and no flush / scan / delete command in the adapter");
});

test("MS-14 runtime config: memory only outside production; production REQUIRES redis (no in-memory fallback); redis without URL → 503; client injected, never connected here", () => {
  const memory = rt.resolveSessionStore({});
  assert.equal((memory as any).versioned, undefined); assert.equal(typeof (memory as any).load, "function");
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", AGENT_V2_SESSION_STORE: "memory" }, { AGENT_V2_SESSION_STORE: "redis" }, { AGENT_V2_SESSION_STORE: "redis", AGENT_V2_SESSION_REDIS_URL: "localhost:6379" }, { AGENT_V2_SESSION_STORE: "dynamo" }]) {
    assert.throws(() => rt.resolveSessionStore(env), (e: any) => e.statusCode === 503, JSON.stringify(env));
  }
  let created = 0;
  const s = rt.resolveSessionStore({ NODE_ENV: "production", AGENT_V2_SESSION_STORE: "redis", AGENT_V2_SESSION_REDIS_URL: "redis://cache.internal:6379" }, () => { created++; return fakeRedis(); });
  assert.equal((s as any).versioned, true); assert.equal(created, 1);
});

// ── HTTP: two instances behind the real endpoint ─────────────────────────────────────────────────────────────────────
test("MS-15 HTTP multi-turn over two instances sharing the fake store; flag OFF creates nothing; /ai/ask unchanged; no network / model", async () => {
  process.env.AI_AGENT_V2 = "on";
  const r = fakeRedis(); const i1 = instance(r); const i2 = instance(r);
  let n = 0; rt.multiAgentRuntimeSeam.factory = () => (n++ % 2 === 0 ? i1.runtime : i2.runtime);
  const post = (q: string) => request(app).post("/ai/v2/ask").set("Authorization", "Bearer tok-a").send({ question: q, sessionId: "http-sess" });
  assert.equal((await post("Tôi 16 tuổi.")).status, 200);
  const t2 = await post("Mục tiêu calo của tôi là bao nhiêu?");
  assert.equal(t2.body.data.status, "MINOR_PROTECTED"); assert.equal(i2.traces[0].session?.store, "OK");
  delete process.env.AI_AGENT_V2; const before = n;
  assert.equal((await post("Hôm nay tôi tập gì?")).status, 404); assert.equal(n, before, "flag OFF: no runtime, no store");
  const v = v1AskReached;
  assert.equal((await request(app).post("/ai/ask").set("Authorization", "Bearer tok-a").send({ question: "Hôm nay tôi tập gì?" })).status, 200); assert.equal(v1AskReached, v + 1);
  assert.equal(blocked, 0); assert.equal(llmCalls, 0);
});
