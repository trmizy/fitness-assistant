/**
 * M8-B S1 — CROSS-SESSION MINOR SAFETY, fail-closed follow-up to M8-A2 (Codex review of e6bbaad9: 2 reproduced P1 + 1 P2).
 *
 *   P1-1  a minor statement whose restriction write FAILED was refused once, but the next personal turn was ANSWERED (nothing kept it).
 *   P1-2  a valid legacy SESSION-scoped stated-minor entry protected only its own session; s2 / no session were ANSWERED.
 *   P2    expiresAt earlier than lastReportedAt was accepted and read as EXPIRED = removal. Expiry also silently lifted the restriction.
 *
 * Evidence label: TEST FIXTURE — in-memory fake stores only (createInMemoryMinorRestrictionStore / createInMemorySessionStore, plus
 * failing / conflicting wrappers), injected clock, mock agent models, fake profile reader. The HTTP case goes through the REAL route +
 * composition root with supertest. No Redis, DynamoDB, AWS, Nova, DB or network.
 * NOT VERIFIED: any persistent backend (none implements MinorRestrictionStore); the in-process quarantine is NOT shared between instances
 * (FC-LIMIT-1 asserts that limit on purpose, so nobody can mistake it for a closed issue).
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
process.env.AI_ASK_RATE_LIMIT_MAX = "10000";
for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AGENT_V2_SESSION_STORE", "AGENT_V2_SESSION_REDIS_URL"]) delete process.env[k];

import type { MockProvider } from "./m5-benchmark/harness";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../agent-v2/supervisor";
import type { MinorRestrictionStore, MinorRestrictionRecord } from "../agent-v2/minor-restriction";
import type { AnySessionStore, ContextEntry } from "../agent-v2/session-context";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };
const MINOR_STATEMENT = "Tôi 16 tuổi.";
const PERSONAL = "Mục tiêu calo của tôi là bao nhiêu?";
const GENERAL = "Protein có vai trò gì trong phục hồi cơ?";

let hz: typeof import("./m5-benchmark/harness");
let sc: typeof import("../agent-v2/session-context");
let mr: typeof import("../agent-v2/minor-restriction");
let rt: typeof import("../agent-v2-integration/multi-agent-runtime");
let app: Express;
let blocked = 0; let llmCalls = 0;

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
  hz = await import("./m5-benchmark/harness");
  sc = await import("../agent-v2/session-context");
  mr = await import("../agent-v2/minor-restriction");
  rt = await import("../agent-v2-integration/multi-agent-runtime");
  ({ default: app } = await import("../app"));
  process.env.AI_AGENT_V2 = "on";
});
test.after(() => { rt.multiAgentRuntimeSeam.factory = null; delete process.env.AI_AGENT_V2; });

// ── fixtures (same shapes as agent-v2-minor-restriction-user-scope.test.ts) ──────────────────────────────────────────
type Fail = null | "UNAVAILABLE" | "TIMEOUT" | "CORRUPT";
/** A restriction store wrapper over a shared inner store: injectable read / write failures, a forced CAS conflict, call logs. */
function faulty(inner: MinorRestrictionStore & { raw?: Map<string, { version: number; data: string }> }) {
  const st = { readFail: null as Fail, writeFail: null as Fail, alwaysConflict: false, reads: [] as string[], writes: [] as string[] };
  const store: MinorRestrictionStore & { raw: any; st: typeof st } = {
    minorRestrictionStore: true, raw: inner.raw, st,
    async read(owner) { st.reads.push(owner); if (st.readFail) throw new sc.SessionStoreError(st.readFail); return inner.read(owner); },
    async write(owner, expected, record) {
      st.writes.push(owner);
      if (st.writeFail) throw new sc.SessionStoreError(st.writeFail);
      if (st.alwaysConflict) return false;
      return inner.write(owner, expected, record);
    },
  };
  return store;
}
type Rig = ReturnType<typeof faulty>;

interface RigOptions { restriction?: Rig | MinorRestrictionStore; session?: AnySessionStore; clock?: { t: number }; profiles?: Record<string, { status: number; data?: unknown }>; }
/** One application "instance": own runners / providers / world over the SHARED fake stores. */
function instance(o: RigOptions = {}) {
  const clock = o.clock ?? { t: T0 };
  const now = () => clock.t;
  const w = hz.world(now);
  const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
  const traces: SupervisorTrace[] = [];
  const profiles = { "tok-a": { status: 200, data: { profile: { userId: USER_A, age: 30 } } }, "tok-b": { status: 200, data: { profile: { userId: USER_B, age: 30 } } }, ...(o.profiles ?? {}) };
  const runtime = rt.createMultiAgentRuntime({
    providerFor: (a) => prov[a], now, deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress },
    profileGet: async (req) => { const r = (profiles as any)[String(req.headers.Authorization).replace("Bearer ", "")] ?? { status: 401 }; if (r.status >= 400) throw Object.assign(new Error("x"), { status: r.status }); return r as any; },
    sessionStore: o.session ?? sc.createInMemorySessionStore(), restrictionStore: o.restriction, traceSink: (x) => traces.push(x),
  });
  const ask = (q: string, user: "A" | "B" = "A", sessionId?: string) => runtime.ask({ question: q, identity: { userId: user === "A" ? USER_A : USER_B, authorizationHeader: `Bearer tok-${user.toLowerCase()}` }, ...(sessionId ? { sessionId } : {}) });
  /** A personal question whose nutrition read is scripted: it only runs if the gate lets it through. */
  const askPersonal = async (user: "A" | "B" = "A", sessionId?: string) => {
    prov.nutrition.script(hz.use(hz.call("nutrition.get_target")), hz.say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày."));
    const r = await ask(PERSONAL, user, sessionId); prov.nutrition.drain(); return r;
  };
  return { ask, askPersonal, w, prov, traces, runtime, clock };
}
const sharedStores = () => ({ restriction: faulty(mr.createInMemoryMinorRestrictionStore()), session: sc.createInMemorySessionStore() });
const lastTrace = (i: { traces: SupervisorTrace[] }) => i.traces[i.traces.length - 1];
const keyOf = (owner = USER_A) => `${mr.MINOR_RESTRICTION_KEY_PREFIX}${owner}`;
const recordOf = (store: { raw: Map<string, { version: number; data: string }> }, owner = USER_A) => JSON.parse(store.raw.get(keyOf(owner))?.data ?? "null") as MinorRestrictionRecord | null;
const pendingOf = (store: MinorRestrictionStore) => mr.pendingMinorRestrictionsFor(store);
const legacyEntry = (sessionId: string, owner = USER_A, now = T0 - 60 * 60_000, turnId = "previous-turn"): ContextEntry => sc.statedMinorAgeStatement({ owner, sessionId, turnId, now });
const generalScripts = (i: ReturnType<typeof instance>) => { i.prov.nutrition.script(hz.say("Protein giúp cơ phục hồi sau tập.")); i.prov.recovery.script(hz.say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn.")); };

// ── P1-1: a failed write must not become "no restriction" ───────────────────────────────────────────────────────────
test("FC-1 write FAILURE then recovery: the statement turn is refused AND the next personal turn (no sessionId / new session) is MINOR_PROTECTED; persistence is retried and the record lands", async () => {
  for (const kind of ["UNAVAILABLE", "TIMEOUT", "CORRUPT", "CONFLICT"] as const) {
    const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
    if (kind === "CONFLICT") restriction.st.alwaysConflict = true; else restriction.st.writeFail = kind;
    const t1 = await i.ask(MINOR_STATEMENT, "A", undefined);
    assert.equal(t1.status, "SESSION_UNAVAILABLE", kind); assert.equal(restriction.raw.size, 0, kind);
    assert.equal(lastTrace(i).minorRestriction?.state, "PENDING", `${kind}: quarantined, not dropped`); assert.equal(lastTrace(i).minorRestriction?.written, kind === "CONFLICT" ? "CONFLICT" : "FAILED");
    restriction.st.writeFail = null; restriction.st.alwaysConflict = false;
    const t2 = await i.askPersonal("A", undefined);
    assert.equal(t2.status, "MINOR_PROTECTED", `${kind}: the failed write must NOT turn the next personal turn into ANSWERED`);
    assert.deepEqual(i.w.calls, [], kind); assert.deepEqual(lastTrace(i).ageGate?.minorBy, ["HISTORY"]);
    const rec = recordOf(restriction); assert.ok(rec, `${kind}: persistence was retried on the next turn and is now durable`);
    assert.equal(rec!.reportCount, 1); assert.equal(rec!.firstTurnId, t1.turnId, "the record carries the ORIGINAL statement turn"); assert.equal(pendingOf(restriction).size, 0, "pending lifted only after the durable write");
    assert.deepEqual(lastTrace(i).minorRestriction, { store: "OK", state: "ACTIVE", written: "OK" });
    const writes = restriction.st.writes.length;
    assert.equal((await i.askPersonal("A", "other-session")).status, "MINOR_PROTECTED"); assert.equal(restriction.st.writes.length, writes, "no more retries once durable");
    assert.equal((await instance({ restriction, session }).askPersonal("A", "s-new")).status, "MINOR_PROTECTED", "and the durable record serves other instances");
  }
});

test("FC-2 the write keeps failing: every later turn (new session, no session) stays MINOR_PROTECTED, general questions are general-only with the minor note, persistence is retried each turn; recovery persists exactly once", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
  restriction.st.writeFail = "UNAVAILABLE";
  assert.equal((await i.ask(MINOR_STATEMENT, "A", "s1")).status, "SESSION_UNAVAILABLE");
  let writes = restriction.st.writes.length;
  for (const sid of ["s2", undefined, "s1", "s4"]) {
    assert.equal((await i.askPersonal("A", sid)).status, "MINOR_PROTECTED", String(sid)); assert.equal(lastTrace(i).minorRestriction?.state, "PENDING");
    assert.equal(restriction.st.writes.length, ++writes, "one retry per turn while pending");
  }
  generalScripts(i);
  const g = await i.ask(GENERAL, "A", undefined);
  assert.ok(["ANSWERED", "PARTIAL"].includes(g.status), g.status); assert.equal(lastTrace(i).ageGate?.decision, "GENERAL_ONLY"); assert.match(g.answer, /Vì bạn dưới 18 tuổi/);
  for (const req of [...i.prov.nutrition.requests, ...i.prov.recovery.requests]) assert.ok(req.tools.every((t) => !/get_target|get_recent_sessions|get_training_load|get_active_state/.test(t.name)), "no personal tool offered");
  assert.deepEqual(i.w.calls, []); assert.equal(restriction.raw.size, 0);
  restriction.st.writeFail = null;
  assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED");
  assert.equal(recordOf(restriction)?.reportCount, 1, "retried turns did not each add a record"); assert.equal(pendingOf(restriction).size, 0);
});

test("FC-3 the store is completely down (read AND write fail): pending still restricts even with a verified adult profile; after recovery the restriction is durable", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session, profiles: { "tok-a": { status: 200, data: { profile: { userId: USER_A, age: 45 } } } } });
  restriction.st.readFail = "UNAVAILABLE"; restriction.st.writeFail = "UNAVAILABLE";
  assert.equal((await i.ask(MINOR_STATEMENT, "A", undefined)).status, "SESSION_UNAVAILABLE");
  for (const sid of [undefined, "x"]) {
    const r = await i.askPersonal("A", sid);
    assert.equal(r.status, "MINOR_PROTECTED", "an unreadable store + a pending restriction is NOT 'unknown': the user stated they are a minor");
    assert.equal(lastTrace(i).ageGate?.status, "MINOR"); assert.equal(lastTrace(i).minorRestriction?.state, "PENDING"); assert.equal(lastTrace(i).minorRestriction?.store, "UNAVAILABLE");
  }
  assert.deepEqual(i.w.calls, []);
  restriction.st.readFail = null; restriction.st.writeFail = null;
  assert.equal((await i.askPersonal("A", "z")).status, "MINOR_PROTECTED"); assert.equal(recordOf(restriction)?.owner, USER_A); assert.equal(pendingOf(restriction).size, 0);
});

test("FC-4 users are isolated while A is pending: B is not restricted (healthy read), B on an unreadable store fails closed as UNKNOWN (not as a minor); A's pending never leaks", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
  restriction.st.writeFail = "UNAVAILABLE";
  assert.equal((await i.ask(MINOR_STATEMENT, "A", "shared")).status, "SESSION_UNAVAILABLE");
  for (const sid of ["shared", undefined]) { const b = await i.askPersonal("B", sid); assert.equal(b.status, "ANSWERED", `B ${sid}`); assert.equal(lastTrace(i).ageGate?.status, "ADULT"); assert.notEqual(lastTrace(i).minorRestriction?.state, "PENDING"); }
  assert.equal(pendingOf(restriction).has(USER_B), false); assert.equal(pendingOf(restriction).has(USER_A), true);
  restriction.st.readFail = "UNAVAILABLE";
  assert.equal((await i.askPersonal("B", "shared")).status, "SESSION_UNAVAILABLE", "B: store unknown → fail closed, but not labelled a minor"); assert.equal(lastTrace(i).minorRestriction?.state, "UNKNOWN");
  restriction.st.readFail = null; restriction.st.writeFail = null;
  assert.equal((await i.askPersonal("A", "other")).status, "MINOR_PROTECTED");
  assert.deepEqual([...restriction.raw.keys()], [keyOf(USER_A)], "only A has a record");
  assert.equal((await i.askPersonal("B", "other")).status, "ANSWERED");
});

test("FC-5 a second statement while pending does not lose or reorder the first; recovery records the ORIGINAL first report", async () => {
  const { restriction, session } = sharedStores(); const clock = { t: T0 }; const i = instance({ restriction, session, clock });
  restriction.st.writeFail = "UNAVAILABLE";
  const a = await i.ask(MINOR_STATEMENT, "A", "s1"); clock.t = T0 + 1_000;
  const b = await i.ask("Mình mới 17 tuổi thôi.", "A", "s2");
  assert.deepEqual([a.status, b.status], ["SESSION_UNAVAILABLE", "SESSION_UNAVAILABLE"]); restriction.st.writeFail = null; clock.t = T0 + 2_000;
  assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED");
  const rec = recordOf(restriction)!; assert.equal(rec.firstReportedAt, T0); assert.equal(rec.firstTurnId, a.turnId); assert.ok(rec.reportCount >= 1);
});

// ── concurrency / races ─────────────────────────────────────────────────────────────────────────────────────────────
test("FC-6 concurrency: parallel statements while the write fails are all refused and quarantined once; parallel personal turns after recovery are all MINOR_PROTECTED and settle on one durable record", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
  restriction.st.writeFail = "UNAVAILABLE";
  const rs = await Promise.all([i.ask(MINOR_STATEMENT, "A", "c1"), i.ask("Tôi cũng 15 tuổi nè", "A", "c2"), i.ask(MINOR_STATEMENT, "A", undefined)]);
  assert.deepEqual(rs.map((r) => r.status), ["SESSION_UNAVAILABLE", "SESSION_UNAVAILABLE", "SESSION_UNAVAILABLE"]); assert.equal(pendingOf(restriction).size, 1, "one owner, one pending entry");
  restriction.st.writeFail = null;
  const ps = await Promise.all([i.askPersonal("A", "p1"), i.askPersonal("A", "p2"), i.askPersonal("A", undefined)]);
  assert.deepEqual(ps.map((r) => r.status), ["MINOR_PROTECTED", "MINOR_PROTECTED", "MINOR_PROTECTED"]); assert.deepEqual(i.w.calls, []);
  const rec = recordOf(restriction)!; assert.ok(rec && rec.reportCount >= 1); assert.equal(pendingOf(restriction).size, 0);
  assert.equal((await i.askPersonal("A", "after")).status, "MINOR_PROTECTED");
});

// ── P1-2: legacy session-scoped restriction → user scope ────────────────────────────────────────────────────────────
test("FC-7 legacy SESSION-scoped stated-minor entry is PROMOTED to the user store: s1 protected AND s2 / no session protected (Codex repro P1-2); promoted once, not on every turn", async () => {
  const { restriction, session } = sharedStores(); session.save(USER_A, "s1", [legacyEntry("s1")]);
  const i = instance({ restriction, session });
  const s1 = await i.askPersonal("A", "s1");
  assert.equal(s1.status, "MINOR_PROTECTED"); assert.deepEqual(lastTrace(i).minorRestriction, { store: "OK", state: "ACTIVE", written: "OK" });
  const rec = recordOf(restriction)!; assert.ok(rec, "promoted"); assert.equal(rec.owner, USER_A); assert.equal(rec.firstTurnId, "previous-turn"); assert.equal(rec.firstReportedAt, T0 - 60 * 60_000, "the ORIGINAL report time of the session entry");
  assert.deepEqual(Object.keys(rec).sort(), ["expiresAt", "firstReportedAt", "firstTurnId", "kind", "lastReportedAt", "lastTurnId", "owner", "provenance", "reportCount", "schema", "underEighteen"]);
  assert.ok(!restriction.raw.get(keyOf())!.data.includes("s1"), "no sessionId in the user-scoped record");
  const writes = restriction.st.writes.length;
  for (const sid of ["s2", undefined, "s3"]) assert.equal((await i.askPersonal("A", sid)).status, "MINOR_PROTECTED", String(sid));
  assert.equal((await i.askPersonal("A", "s1")).status, "MINOR_PROTECTED"); assert.equal(restriction.st.writes.length, writes, "an already-recorded restriction is not promoted again");
  assert.deepEqual(i.w.calls, []);
  assert.equal((await instance({ restriction, session }).askPersonal("A", "s9")).status, "MINOR_PROTECTED", "another instance");
});

test("FC-8 promotion WRITE failure fails closed: the session turn stays MINOR_PROTECTED, the owner is quarantined for every other session / no session, recovery persists it (store read error and corrupt-read variants too)", async () => {
  for (const mode of ["writeFail", "readUnavailable", "readCorrupt", "conflict"] as const) {
    const { restriction, session } = sharedStores(); session.save(USER_A, "s1", [legacyEntry("s1")]); const i = instance({ restriction, session });
    if (mode === "writeFail") restriction.st.writeFail = "UNAVAILABLE"; else if (mode === "readUnavailable") restriction.st.readFail = "UNAVAILABLE"; else if (mode === "readCorrupt") restriction.st.readFail = "CORRUPT"; else restriction.st.alwaysConflict = true;
    const s1 = await i.askPersonal("A", "s1");
    assert.equal(s1.status, "MINOR_PROTECTED", `${mode}: never ANSWERED`); assert.equal(lastTrace(i).minorRestriction?.state, "PENDING", mode); assert.equal(restriction.raw.size, 0);
    for (const sid of ["s2", undefined]) assert.equal((await i.askPersonal("A", sid)).status, "MINOR_PROTECTED", `${mode} ${sid}: the legacy session was never revisited`);
    assert.deepEqual(i.w.calls, [], mode);
    restriction.st.writeFail = null; restriction.st.readFail = null; restriction.st.alwaysConflict = false;
    assert.equal((await i.askPersonal("A", "s2")).status, "MINOR_PROTECTED", mode);
    const rec = recordOf(restriction)!; assert.ok(rec, `${mode}: durable after recovery`); assert.equal(rec.firstTurnId, "previous-turn"); assert.equal(pendingOf(restriction).size, 0);
  }
});

test("FC-9 promotion over a CORRUPT user record repairs it with a valid (more restrictive) record; an ACTIVE record is never re-promoted", async () => {
  const { restriction, session } = sharedStores(); session.save(USER_A, "s1", [legacyEntry("s1")]);
  restriction.raw.set(keyOf(), { version: 4, data: "{broken" });
  const i = instance({ restriction, session });
  assert.equal((await i.askPersonal("A", "s1")).status, "MINOR_PROTECTED"); assert.equal(recordOf(restriction)?.owner, USER_A, "repaired");
  assert.equal((await i.askPersonal("A", "s2")).status, "MINOR_PROTECTED", "no longer fail-closed CORRUPT: a valid restriction");
  // active record already present: the legacy entry in another session does not write
  const s2 = sharedStores(); const j = instance(s2); await j.ask(MINOR_STATEMENT, "A", "s0"); s2.session.save(USER_A, "s-legacy", [legacyEntry("s-legacy")]);
  const writes = s2.restriction.st.writes.length;
  assert.equal((await j.askPersonal("A", "s-legacy")).status, "MINOR_PROTECTED"); assert.equal(s2.restriction.st.writes.length, writes);
});

test("FC-10 legacy promotion races: two legacy sessions promoted in parallel (CAS) both stay protected and settle on one record; a tampered / foreign session entry is never promoted", async () => {
  const { restriction, session } = sharedStores(); session.save(USER_A, "l1", [legacyEntry("l1")]); session.save(USER_A, "l2", [legacyEntry("l2", USER_A, T0 - 5_000, "turn-two")]);
  const i = instance({ restriction, session });
  const rs = await Promise.all([i.askPersonal("A", "l1"), i.askPersonal("A", "l2")]);
  assert.deepEqual(rs.map((r) => r.status), ["MINOR_PROTECTED", "MINOR_PROTECTED"]); const rec = recordOf(restriction)!; assert.ok(rec.reportCount >= 1);
  assert.equal(rec.firstReportedAt, T0 - 60 * 60_000, "monotonic: the earliest report is kept"); assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED");
  // a tampered stated-minor entry (value null) → corrupt session restriction (M8-A2) → fail closed, never promoted to anyone
  const t = sharedStores(); t.session.raw.set(JSON.stringify([USER_A, "bad"]), [{ ...legacyEntry("bad"), value: null as any }]);
  const k = instance(t); assert.equal((await k.askPersonal("A", "bad")).status, "SESSION_UNAVAILABLE"); assert.equal(t.restriction.raw.size, 0);
});

test("FC-11 legacy promotion is per USER: A's session entry is never applied to B (same sessionId), B gets no record; A's own record has A as owner only", async () => {
  const { restriction, session } = sharedStores(); session.save(USER_A, "shared", [legacyEntry("shared")]);
  const i = instance({ restriction, session });
  assert.equal((await i.askPersonal("B", "shared")).status, "ANSWERED"); assert.equal(restriction.raw.size, 0); assert.equal(restriction.st.writes.length, 0);
  assert.equal((await i.askPersonal("A", "shared")).status, "MINOR_PROTECTED"); assert.deepEqual([...restriction.raw.keys()], [keyOf(USER_A)]);
  assert.equal((await i.askPersonal("B", undefined)).status, "ANSWERED");
});

// ── the multi-instance limit, asserted on purpose ───────────────────────────────────────────────────────────────────
test("FC-LIMIT-1 DOCUMENTED RESIDUAL (NOT a pass for production): the quarantine is in-process. A second instance with its own memory does not know about it; the best-effort SESSION copy lets it recover only when the same sessionId comes back", async () => {
  const inner = mr.createInMemoryMinorRestrictionStore(); const w1 = faulty(inner); const w2 = faulty(inner); const session = sc.createInMemorySessionStore();
  const i1 = instance({ restriction: w1, session }); const i2 = instance({ restriction: w2, session });
  w1.st.writeFail = "UNAVAILABLE";
  assert.equal((await i1.ask(MINOR_STATEMENT, "A", "s1")).status, "SESSION_UNAVAILABLE"); assert.equal(inner.raw.size, 0);
  assert.equal(pendingOf(w1).has(USER_A), true); assert.equal(pendingOf(w2).has(USER_A), false, "pending is per process");
  // LIMIT: instance 2 (healthy store, empty memory) with a DIFFERENT session / none: nothing durable exists yet → ANSWERED. Only a persistent store closes this.
  assert.equal((await i2.askPersonal("A", "s2")).status, "ANSWERED", "known residual: instance-local quarantine");
  // mitigation: the statement turn wrote the session copy → instance 2 promotes it as soon as that session is seen
  assert.equal((await i2.askPersonal("A", "s1")).status, "MINOR_PROTECTED"); assert.ok(recordOf(inner as any), "promoted into the user store");
  for (const sid of ["s2", "s3", undefined]) assert.equal((await i2.askPersonal("A", sid)).status, "MINOR_PROTECTED", String(sid));
});

// ── expiry ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test("FC-12 EXPIRY IS NOT PERMISSION: a record past its 30-day review point still restricts (new session / no session / adult profile / years later); expiry never yields ADULT and never rewrites the record", async () => {
  const { restriction, session } = sharedStores(); const clock = { t: T0 }; const i = instance({ restriction, session, clock });
  await i.ask(MINOR_STATEMENT, "A", "s1"); const before = restriction.raw.get(keyOf())!.data; const writes = restriction.st.writes.length;
  for (const t of [T0 + 31 * DAY, T0 + 400 * DAY, T0 + 3650 * DAY]) {
    clock.t = t;
    assert.equal((await mr.readMinorRestriction(restriction, USER_A, t)).status, "EXPIRED", "the review point passed");
    for (const sid of ["fresh", undefined]) {
      assert.equal((await i.askPersonal("A", sid)).status, "MINOR_PROTECTED", `${t - T0}ms ${sid}`); assert.equal(lastTrace(i).ageGate?.status, "MINOR"); assert.deepEqual(lastTrace(i).ageGate?.minorBy, ["HISTORY"]);
      assert.deepEqual(lastTrace(i).minorRestriction, { store: "OK", state: "EXPIRED" });
    }
  }
  assert.equal(restriction.raw.get(keyOf())!.data, before, "reading an expired record never mutates it"); assert.equal(restriction.st.writes.length, writes);
  assert.deepEqual(i.w.calls, []);
  const adult = instance({ restriction, session, clock, profiles: { "tok-a": { status: 200, data: { profile: { userId: USER_A, age: 45 } } } } });
  assert.equal((await adult.askPersonal("A", "x")).status, "MINOR_PROTECTED", "a verified adult profile does not turn an expired restriction into ADULT"); assert.equal(lastTrace(adult).ageGate?.conflict, true);
  generalScripts(i); const g = await i.ask(GENERAL, "A", "gen"); assert.ok(["ANSWERED", "PARTIAL"].includes(g.status)); assert.equal(lastTrace(i).ageGate?.decision, "GENERAL_ONLY"); assert.match(g.answer, /Vì bạn dưới 18 tuổi/);
  // a fresh statement after expiry refreshes the record (still restricted, sliding review point restarts)
  await i.ask(MINOR_STATEMENT, "A", "again"); const rec = recordOf(restriction)!; assert.equal(rec.expiresAt > clock.t, true); assert.equal((await mr.readMinorRestriction(restriction, USER_A, clock.t)).status, "ACTIVE");
});

test("FC-13 inconsistent timestamps are CORRUPT (fail closed), never 'expired': expiresAt < / == lastReportedAt (Codex repro), lastReportedAt < firstReportedAt, expiresAt <= firstReportedAt, non-integers; a fresh statement repairs", async () => {
  const good = (): MinorRestrictionRecord => mr.mergeMinorRestriction(null, USER_A, { turnId: "t-1", now: T0 });
  const bad: Array<[string, unknown]> = [
    ["expiresAt before lastReportedAt (Codex repro)", { ...good(), lastReportedAt: T0 + 1_000, expiresAt: T0 + 1 }],
    ["expiresAt == lastReportedAt", { ...good(), lastReportedAt: T0 + 5_000, expiresAt: T0 + 5_000 }],
    ["lastReportedAt before firstReportedAt", { ...good(), lastReportedAt: T0 - 1 }],
    ["expiresAt <= firstReportedAt", { ...good(), expiresAt: T0 }],
    ["fractional expiresAt", { ...good(), expiresAt: T0 + 0.5 + MINOR_TTL() }], ["string expiresAt", { ...good(), expiresAt: String(T0 + MINOR_TTL()) }],
    ["negative firstReportedAt", { ...good(), firstReportedAt: -1 }],
  ];
  function MINOR_TTL() { return mr.MINOR_RESTRICTION_TTL_MS; }
  for (const [name, value] of bad) {
    const store = mr.createInMemoryMinorRestrictionStore(); store.raw.set(keyOf(), { version: 3, data: JSON.stringify(value) });
    for (const at of [T0 + 2_000, T0 + 40 * DAY]) assert.equal((await mr.readMinorRestriction(store, USER_A, at)).status, "CORRUPT", `${name} @${at - T0}`);
    const { restriction, session } = sharedStores(); restriction.raw.set(keyOf(), { version: 3, data: JSON.stringify(value) }); const clock = { t: T0 + 40 * DAY }; const i = instance({ restriction, session, clock });
    assert.equal((await i.askPersonal("A", undefined)).status, "SESSION_UNAVAILABLE", name); assert.deepEqual(i.w.calls, [], name); assert.equal(lastTrace(i).minorRestriction?.store, "CORRUPT", name);
    await i.ask(MINOR_STATEMENT, "A", undefined); assert.equal((await mr.readMinorRestriction(restriction, USER_A, clock.t)).status, "ACTIVE", `${name}: repaired by a fresh statement`);
    assert.equal((await i.askPersonal("A", "after")).status, "MINOR_PROTECTED", name);
  }
  // a consistent record produced by the merge always satisfies the validator (sliding, older clock)
  let r = good(); r = mr.mergeMinorRestriction(r, USER_A, { turnId: "t-2", now: T0 + 10 * DAY }); r = mr.mergeMinorRestriction(r, USER_A, { turnId: "t-3", now: T0 + 5 * DAY });
  assert.equal(mr.isValidMinorRestriction(r, USER_A), true); assert.ok(r.expiresAt > r.lastReportedAt);
});

// ── registry / persist unit level ───────────────────────────────────────────────────────────────────────────────────
test("FC-14 pending registry: per owner, idempotent, bounded, identity-checked removal, minimal content (turn id + time only)", () => {
  const p = mr.createPendingMinorRestrictions(2);
  const a1 = p.add(USER_A, { turnId: "turn-a1", now: T0 })!; const a2 = p.add(USER_A, { turnId: "turn-a2", now: T0 + 1 })!;
  assert.equal(a1, a2, "an owner already pending keeps its EARLIER entry"); assert.equal(a1.turnId, "turn-a1"); assert.deepEqual(Object.keys(a1).sort(), ["now", "turnId"]); assert.ok(Object.isFrozen(a1));
  const b = p.add(USER_B, { turnId: "Tôi 16 tuổi, mục tiêu calo?", now: T0 })!; assert.equal(b.turnId, "unknown", "a turn id with text is never stored");
  assert.equal(p.add("33333333-3333-4333-8333-333333333333", { turnId: "x", now: T0 }), null, "bounded: a new owner beyond the cap cannot be added"); assert.equal(p.size, 2);
  p.remove(USER_A, { turnId: "turn-a1", now: T0 }); assert.equal(p.has(USER_A), true, "removal needs the CURRENT entry object");
  p.remove(USER_A, a1); assert.equal(p.has(USER_A), false); assert.equal(p.has(USER_B), true); assert.equal(p.get("nobody"), null);
  assert.equal(p.add("a b", { turnId: "x", now: T0 }), null, "invalid owner id");
});

test("FC-15 persistMinorRestriction: old pending is retried first; a new report is registered BEFORE its write (write-ahead); failure keeps it; a full registry is reported (quarantined=false), never 'ok'", async () => {
  const inner = mr.createInMemoryMinorRestrictionStore(); let writes = 0; let failOn = new Set<number>();
  const store: MinorRestrictionStore = { minorRestrictionStore: true, read: (o) => inner.read(o), write: async (o, v, r) => { writes++; if (failOn.has(writes)) throw new sc.SessionStoreError("UNAVAILABLE"); return inner.write(o, v, r); } };
  const pending = mr.createPendingMinorRestrictions();
  // write-ahead: during the write attempt the report is already pending
  let seenDuringWrite = false; const spy: MinorRestrictionStore = { ...store, write: async (o, v, r) => { seenDuringWrite = pending.has(o); return store.write(o, v, r); } };
  assert.deepEqual(await mr.persistMinorRestriction(spy, pending, USER_A, { turnId: "t-one", now: T0 }), { outcome: "ok", quarantined: false }); assert.equal(seenDuringWrite, true); assert.equal(pending.size, 0);
  // an old pending entry flushes first, then the new report fails → the NEW one stays quarantined
  pending.add(USER_B, { turnId: "old-b", now: T0 }); writes = 0; failOn = new Set([2]);
  assert.deepEqual(await mr.persistMinorRestriction(store, pending, USER_B, { turnId: "new-b", now: T0 + 10 }), { outcome: "unavailable", quarantined: true });
  assert.equal(pending.get(USER_B)?.turnId, "new-b"); assert.equal(JSON.parse(inner.raw.get(keyOf(USER_B))!.data).reportCount, 1, "the old entry was durably flushed");
  failOn = new Set(); assert.deepEqual(await mr.persistMinorRestriction(store, pending, USER_B, null), { outcome: "ok", quarantined: false }); assert.equal(JSON.parse(inner.raw.get(keyOf(USER_B))!.data).reportCount, 2);
  // an old entry that still fails short-circuits (the new report is not written, the owner stays quarantined with the OLD entry)
  pending.add(USER_A, { turnId: "stuck", now: T0 }); writes = 0; failOn = new Set([1]); const before = JSON.stringify([...inner.raw.entries()]);
  assert.deepEqual(await mr.persistMinorRestriction(store, pending, USER_A, { turnId: "later", now: T0 + 1 }), { outcome: "unavailable", quarantined: true }); assert.equal(pending.get(USER_A)?.turnId, "stuck"); assert.equal(JSON.stringify([...inner.raw.entries()]), before);
  // full registry
  failOn = new Set([1]); writes = 0; const full = mr.createPendingMinorRestrictions(0);
  assert.deepEqual(await mr.persistMinorRestriction(store, full, USER_B, { turnId: "t", now: T0 }), { outcome: "unavailable", quarantined: false });
  // nothing to do → no store call
  const quiet = mr.createPendingMinorRestrictions(); writes = 0; assert.deepEqual(await mr.persistMinorRestriction(store, quiet, USER_B, null), { outcome: "ok", quarantined: false }); assert.equal(writes, 0);
});

test("FC-16 privacy: the quarantine holds a turn id and a time only; traces carry codes only; the durable record after a retry has no text / age / session id", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session }); const secret = "Tôi 16 tuổi, mục tiêu calo của tôi là bao nhiêu?";
  restriction.st.writeFail = "UNAVAILABLE"; await i.ask(secret, "A", "sess-secret-123");
  const entry = pendingOf(restriction).get(USER_A)!; assert.deepEqual(Object.keys(entry).sort(), ["now", "turnId"]); assert.ok(!JSON.stringify(entry).includes("calo")); assert.ok(!JSON.stringify(entry).includes("sess-secret-123")); assert.ok(!/16/.test(JSON.stringify(entry)));
  restriction.st.writeFail = null; await i.askPersonal("A", "other");
  const stored = restriction.raw.get(keyOf())!.data; assert.ok(!/16/.test(stored)); for (const bad of ["calo", "sess-secret-123", "tok-a", "Bearer", "mục tiêu"]) assert.ok(!stored.includes(bad), bad);
  const tj = JSON.stringify(i.traces); for (const bad of [USER_A, "sess-secret-123", mr.MINOR_RESTRICTION_KEY_PREFIX, "underEighteen", "SELF_REPORTED", "calo"]) assert.ok(!tj.includes(bad), bad);
  assert.ok(i.traces.some((t) => t.minorRestriction?.state === "PENDING"), "the pending state is traced as a code");
});

test("FC-17 the quarantine follows the store object (one registry per store = per process); another store object starts empty", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
  restriction.st.writeFail = "UNAVAILABLE"; await i.ask(MINOR_STATEMENT, "A", undefined);
  assert.equal(pendingOf(restriction), mr.pendingMinorRestrictionsFor(restriction), "one registry per store object");
  assert.equal(mr.pendingMinorRestrictionsFor(faulty(mr.createInMemoryMinorRestrictionStore())).size, 0, "another store object (another process) has its own, empty one");
});

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const BODY_KEYS = ["agents", "answer", "status", "traceId", "turnId"];
function httpRig() {
  process.env.AI_AGENT_V2 = "on";
  const stores = sharedStores(); const i = instance(stores); rt.multiAgentRuntimeSeam.factory = () => i.runtime;
  const post = (q: string, o: { token?: string; sessionId?: string } = {}) => request(app).post("/ai/v2/ask").set("Authorization", `Bearer ${o.token ?? "tok-a"}`).send({ question: q, ...(o.sessionId ? { sessionId: o.sessionId } : {}) });
  const personal = async (o: { token?: string; sessionId?: string } = {}) => { i.prov.nutrition.script(hz.use(hz.call("nutrition.get_target")), hz.say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày.")); const r = await post(PERSONAL, o); i.prov.nutrition.drain(); return r; };
  return { ...stores, i, post, personal };
}

test("FC-H1 HTTP: a minor statement whose write fails → 200 SESSION_UNAVAILABLE; the next personal ask WITHOUT sessionId (and with a new one) → 200 MINOR_PROTECTED; after recovery still protected, record durable; public body unchanged (no quarantine / restriction wording)", async () => {
  const h = httpRig(); h.restriction.st.writeFail = "UNAVAILABLE";
  const first = await h.post(MINOR_STATEMENT, { sessionId: "s1" }); assert.equal(first.status, 200); assert.equal(first.body.data.status, "SESSION_UNAVAILABLE");
  for (const o of [{}, { sessionId: "s2" }]) {
    const r = await h.personal(o); assert.equal(r.status, 200); assert.equal(r.body.data.status, "MINOR_PROTECTED", JSON.stringify(o)); assert.deepEqual(r.body.data.agents, []); assert.deepEqual(Object.keys(r.body.data).sort(), BODY_KEYS);
    for (const bad of ["PENDING", "minorRestriction", "quarantine", "pending"]) assert.ok(!JSON.stringify(r.body).includes(bad), bad);
  }
  h.restriction.st.writeFail = null; assert.equal((await h.personal({ sessionId: "s3" })).body.data.status, "MINOR_PROTECTED"); assert.equal(recordOf(h.restriction)?.owner, USER_A);
  assert.equal((await h.personal({ token: "tok-b" })).body.data.status, "ANSWERED", "another account is unaffected");
  assert.deepEqual(h.i.w.calls.filter((c) => c.endsWith(":A")), []); assert.equal(blocked, 0); assert.equal(llmCalls, 0);
});

test("FC-H2 HTTP: legacy session-scoped restriction promoted over the real route — s1, a new session and no session are all MINOR_PROTECTED", async () => {
  const h = httpRig(); h.session.save(USER_A, "legacy-1", [legacyEntry("legacy-1")]);
  for (const o of [{ sessionId: "legacy-1" }, { sessionId: "other" }, {}]) { const r = await h.personal(o); assert.equal(r.status, 200); assert.equal(r.body.data.status, "MINOR_PROTECTED", JSON.stringify(o)); assert.deepEqual(Object.keys(r.body.data).sort(), BODY_KEYS); }
  assert.equal(recordOf(h.restriction)?.owner, USER_A); assert.deepEqual(h.i.w.calls, []);
});
