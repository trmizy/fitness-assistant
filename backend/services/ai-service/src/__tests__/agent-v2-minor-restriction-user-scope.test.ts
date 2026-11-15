/**
 * M8-A2 — CROSS-SESSION MINOR SAFETY: the self-reported minor restriction is scoped to the AUTHENTICATED userId, not to a
 * client-chosen sessionId (blocker finding M7-P5A.3b §1, P1: a NEW or OMITTED sessionId lifted the restriction).
 *
 * Evidence label: TEST FIXTURE — in-memory fake stores only (createInMemoryMinorRestrictionStore / createInMemorySessionStore,
 * plus failing / corrupting / racing wrappers), injected clock, mock agent models, V1 service client replaced by a fake profile
 * reader. HTTP cases go through the REAL route + composition root with supertest. No Redis, DynamoDB, AWS, Nova, DB or network.
 * NOT VERIFIED: any persistent backend (none implements MinorRestrictionStore) — this does NOT close the issue in production.
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
  process.env.AI_AGENT_V2 = "on"; // runtime-level cases run the supervisor directly (the HTTP cases also pass the real flag gate)
});
test.after(() => { rt.multiAgentRuntimeSeam.factory = null; delete process.env.AI_AGENT_V2; });

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A restriction store wrapper: injectable failures, a hook between read and return (stale read) and before a write (race). */
function faulty(inner: MinorRestrictionStore & { raw?: Map<string, { version: number; data: string }> }) {
  const st = {
    readFail: null as null | "UNAVAILABLE" | "TIMEOUT" | "CORRUPT", writeFail: null as null | "UNAVAILABLE" | "TIMEOUT" | "CORRUPT",
    afterReadSnapshot: null as null | ((owner: string) => Promise<void>), beforeWrite: null as null | (() => Promise<void>),
    reads: [] as string[], writes: [] as string[],
  };
  const store: MinorRestrictionStore & { raw: any; st: typeof st } = {
    minorRestrictionStore: true, raw: inner.raw, st,
    async read(owner) {
      st.reads.push(owner);
      if (st.readFail) throw new sc.SessionStoreError(st.readFail);
      const snap = await inner.read(owner);
      if (st.afterReadSnapshot) { const h = st.afterReadSnapshot; st.afterReadSnapshot = null; await h(owner); }
      return snap;
    },
    async write(owner, expected, record) {
      st.writes.push(owner);
      if (st.writeFail) throw new sc.SessionStoreError(st.writeFail);
      if (st.beforeWrite) { const h = st.beforeWrite; st.beforeWrite = null; await h(); }
      return inner.write(owner, expected, record);
    },
  };
  return store;
}

interface RigOptions { restriction?: ReturnType<typeof faulty> | MinorRestrictionStore; session?: AnySessionStore; clock?: { t: number }; profiles?: Record<string, { status: number; data?: unknown }>; }
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
  /** `sessionId: undefined` = the client omitted it. */
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
const recordOf = (store: { raw: Map<string, { version: number; data: string }> }, owner = USER_A) => JSON.parse(store.raw.get(`${mr.MINOR_RESTRICTION_KEY_PREFIX}${owner}`)?.data ?? "null") as MinorRestrictionRecord | null;

// ── 1. the bypass: session switch / omitted sessionId ───────────────────────────────────────────────────────────────
test("MR-1 session switch: a minor statement in session s1 still restricts a personal ask in a NEW session s2 (and a second new one)", async () => {
  const { restriction, session } = sharedStores();
  const i = instance({ restriction, session });
  await i.ask(MINOR_STATEMENT, "A", "s1");
  const same = await i.askPersonal("A", "s1");
  assert.equal(same.status, "MINOR_PROTECTED", "same session (previous behaviour)");
  const other = await i.askPersonal("A", "s2");
  assert.equal(other.status, "MINOR_PROTECTED", "NEW sessionId must not lift the restriction");
  assert.deepEqual(lastTrace(i).ageGate?.minorBy, ["HISTORY"]); assert.deepEqual(i.w.calls, [], "no domain tool call was ever made");
  const third = await instance({ restriction, session }).askPersonal("A", "s3-another-instance");
  assert.equal(third.status, "MINOR_PROTECTED", "another application instance sharing the store");
});

test("MR-2 session omitted: restricted when the statement had a sessionId and the ask has none; also when NEITHER turn had a sessionId", async () => {
  {
    const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
    await i.ask(MINOR_STATEMENT, "A", "s1");
    assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED", "statement in a session, ask without one");
    assert.deepEqual(i.w.calls, []);
  }
  {
    const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
    await i.ask(MINOR_STATEMENT, "A", undefined);
    assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED", "no sessionId at all: the restriction is user-scoped");
    assert.equal((await i.askPersonal("A", "brand-new")).status, "MINOR_PROTECTED");
    assert.deepEqual(i.w.calls, []);
    assert.equal(recordOf(restriction)?.reportCount, 1);
  }
});

test("MR-3 a general-knowledge question under the restriction (new / no session) is answered GENERAL-ONLY with the minor note; no personal tool is offered", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
  await i.ask(MINOR_STATEMENT, "A", "s1");
  i.prov.nutrition.script(hz.say("Protein giúp cơ phục hồi sau tập.")); i.prov.recovery.script(hz.say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  for (const sid of ["fresh-session", undefined]) {
    const g = await i.ask(GENERAL, "A", sid);
    assert.ok(["ANSWERED", "PARTIAL"].includes(g.status), String(g.status));
    assert.equal(lastTrace(i).ageGate?.decision, "GENERAL_ONLY"); assert.match(g.answer, /Vì bạn dưới 18 tuổi/);
    i.prov.nutrition.script(hz.say("Protein giúp cơ phục hồi sau tập.")); i.prov.recovery.script(hz.say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
  }
  for (const req of [...i.prov.nutrition.requests, ...i.prov.recovery.requests]) assert.ok(req.tools.every((t) => !/get_target|get_recent_sessions|get_training_load|get_active_state/.test(t.name)), "agents' own gate also sees the restriction");
  assert.deepEqual(i.w.calls, []);
});

// ── 2. multiple users ────────────────────────────────────────────────────────────────────────────────────────────────
test("MR-4 users are isolated: A's restriction never affects B (same sessionId, no sessionId); B cannot read A's record; a foreign-owner record is CORRUPT for the reader", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
  await i.ask(MINOR_STATEMENT, "A", "shared");
  assert.equal((await i.askPersonal("A", "other")).status, "MINOR_PROTECTED");
  for (const sid of ["shared", "other", undefined]) {
    const b = await i.askPersonal("B", sid);
    assert.equal(b.status, "ANSWERED", `B with sessionId ${sid}`); assert.equal(lastTrace(i).ageGate?.status, "ADULT");
  }
  assert.deepEqual([...restriction.raw.keys()], [`${mr.MINOR_RESTRICTION_KEY_PREFIX}${USER_A}`], "only A has a record; B's reads wrote nothing");
  assert.deepEqual(await restriction.read(USER_B), { record: null, version: "0" });
  assert.equal((await mr.readMinorRestriction(restriction, USER_B, T0)).status, "NONE");
  assert.equal((await mr.readMinorRestriction(restriction, USER_A, T0)).status, "ACTIVE");
  // a record that ended up under B's key but belongs to A (a mis-keyed adapter) is never applied and never trusted
  restriction.raw.set(`${mr.MINOR_RESTRICTION_KEY_PREFIX}${USER_B}`, { version: 1, data: JSON.stringify(recordOf(restriction, USER_A)) });
  assert.equal((await mr.readMinorRestriction(restriction, USER_B, T0)).status, "CORRUPT");
  assert.equal((await i.askPersonal("B", "x")).status, "SESSION_UNAVAILABLE", "fail closed for B");
  assert.equal((await i.askPersonal("A", "y")).status, "MINOR_PROTECTED", "A unaffected");
});

// ── 3. concurrency ───────────────────────────────────────────────────────────────────────────────────────────────────
test("MR-5 concurrency: two racing writers both land (CAS conflict re-reads and merges); a stale reader cannot drop a fresh restriction", async () => {
  // (a) store level: both writers read version "0"; the first write is interleaved before the second one's CAS
  const store = faulty(mr.createInMemoryMinorRestrictionStore());
  store.st.beforeWrite = async () => { assert.equal(await mr.recordMinorRestriction(store, USER_A, { turnId: "turn-competitor", now: T0 + 1_000 }), "ok"); };
  assert.equal(await mr.recordMinorRestriction(store, USER_A, { turnId: "turn-first", now: T0 }), "ok");
  const rec = recordOf(store)!;
  assert.equal(rec.reportCount, 2, "nothing lost: the loser re-read and merged"); assert.equal(rec.firstTurnId, "turn-first"); assert.equal(rec.lastTurnId, "turn-competitor");
  assert.equal(rec.firstReportedAt, T0); assert.equal(rec.lastReportedAt, T0 + 1_000);
  // a writer that keeps losing is bounded and reports "conflict" — never "ok"
  const loser = mr.createInMemoryMinorRestrictionStore();
  const always: MinorRestrictionStore = { minorRestrictionStore: true, read: (o) => loser.read(o), write: async () => false };
  assert.equal(await mr.recordMinorRestriction(always, USER_A, { turnId: "t", now: T0 }), "conflict");
  // (b) turn level: an adult turn X whose restriction READ is stale (taken before the statement landed) finishes AFTER the
  // minor statement turn Y; X's later (session) write must not drop the restriction, and the next turn is restricted.
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
  const y = instance({ restriction, session });
  restriction.st.afterReadSnapshot = async () => { await y.ask(MINOR_STATEMENT, "A", "sY"); };
  const x = await i.askPersonal("A", "sX");
  assert.equal(x.status, "ANSWERED", "X was in flight before the statement: it is linearised before it (documented residual)");
  assert.equal(recordOf(restriction)?.reportCount, 1, "Y's restriction survived X's write");
  assert.equal((await i.askPersonal("A", "sX")).status, "MINOR_PROTECTED", "the very next turn of X's own session is restricted");
  // (c) parallel turns: an adult ask and a statement racing — the restriction ends up stored exactly once, never lost
  const p = sharedStores(); const q = instance(p);
  p.restriction.st.beforeWrite = null;
  await Promise.all([q.askPersonal("A", "c1"), q.ask(MINOR_STATEMENT, "A", "c2"), q.ask("Tôi cũng 15 tuổi nè", "A", "c3")]);
  assert.equal(recordOf(p.restriction)?.reportCount, 2, "both statements recorded");
  assert.equal((await q.askPersonal("A", "c4")).status, "MINOR_PROTECTED");
});

// ── 4. fail closed ───────────────────────────────────────────────────────────────────────────────────────────────────
test("MR-6 store READ error (any kind) fails closed WITHOUT a sessionId: personal refused, 0 domain calls; general stays general-only", async () => {
  for (const kind of ["UNAVAILABLE", "TIMEOUT", "CORRUPT"] as const) {
    const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
    restriction.st.readFail = kind;
    const p = await i.askPersonal("A", undefined);
    assert.equal(p.status, "SESSION_UNAVAILABLE", kind); assert.deepEqual(i.w.calls, []); assert.equal(lastTrace(i).delegations.length, 0);
    assert.equal(lastTrace(i).minorRestriction?.store, kind === "CORRUPT" ? "CORRUPT" : "UNAVAILABLE");
    i.prov.nutrition.script(hz.say("Protein giúp cơ phục hồi sau tập.")); i.prov.recovery.script(hz.say("Ngủ đủ giấc giúp cơ phục hồi tốt hơn."));
    const g = await i.ask(GENERAL, "A", undefined);
    assert.ok(["ANSWERED", "PARTIAL"].includes(g.status), g.status); assert.deepEqual(i.w.calls, []);
    for (const req of [...i.prov.nutrition.requests, ...i.prov.recovery.requests]) assert.ok(req.tools.every((t) => !/get_target|get_recent_sessions|get_training_load/.test(t.name)));
    restriction.st.readFail = null;
    assert.equal((await i.askPersonal("A", undefined)).status, "ANSWERED", "store recovered, nothing was ever recorded for this adult");
  }
});

test("MR-7 store WRITE error fails closed: the minor statement cannot be persisted → this turn is refused (even its own personal question), never silently dropped", async () => {
  for (const kind of ["UNAVAILABLE", "TIMEOUT"] as const) {
    const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
    restriction.st.writeFail = kind;
    i.prov.nutrition.script(hz.use(hz.call("nutrition.get_target")), hz.say("Bạn cần 2400 kcal."));
    const r = await i.ask("Tôi 16 tuổi, mục tiêu calo của tôi là bao nhiêu?", "A", undefined);
    assert.equal(r.status, "SESSION_UNAVAILABLE", kind); assert.deepEqual(i.w.calls, []); assert.equal(lastTrace(i).minorRestriction?.written, "FAILED");
    assert.equal(restriction.raw.size, 0); restriction.st.writeFail = null;
    // M8-B S1 (Codex P1-1): the failed write is QUARANTINED, not dropped. The next personal turn (no sessionId) must NOT be answered: it retries
    // the persistence (store recovered above), which succeeds, and the user stays MINOR_PROTECTED. (Old assertion encoded the unsafe behaviour: ANSWERED.)
    assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED", kind); assert.deepEqual(i.w.calls, []); assert.equal(recordOf(restriction)?.reportCount, 1, "durably recorded by the retry");
  }
  { // the store cannot even READ the previous record while the user states a minor age (CORRUPT reported by the store, no version to CAS on): refused, not dropped
    const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
    restriction.st.readFail = "CORRUPT";
    const r = await i.ask(MINOR_STATEMENT, "A", undefined);
    assert.equal(r.status, "SESSION_UNAVAILABLE"); assert.deepEqual(lastTrace(i).minorRestriction, { store: "CORRUPT", state: "PENDING", written: "FAILED" }, "M8-B S1: the unstored statement is quarantined (trace state PENDING; was UNKNOWN before the quarantine existed)"); assert.equal(restriction.st.writes.length, 0);
    restriction.st.readFail = null; assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED", "and it is retried + still enforced on the next turn");
  }
});

test("MR-8 corrupt record → fail closed (SESSION_UNAVAILABLE, 0 domain calls): bad JSON, wrong shape, foreign owner, NaN / past expiry order, wrong provenance, underEighteen null; a fresh statement REPAIRS it", async () => {
  const good = (): MinorRestrictionRecord => mr.mergeMinorRestriction(null, USER_A, { turnId: "t-1", now: T0 });
  const bad: Array<[string, unknown]> = [
    ["not an object", "x"], ["array", []], ["wrong schema", { ...good(), schema: "other/9" }], ["owner is another user", { ...good(), owner: USER_B }],
    ["provenance VERIFIED", { ...good(), provenance: "VERIFIED" }], ["underEighteen null", { ...good(), underEighteen: null }], ["underEighteen false", { ...good(), underEighteen: false }],
    ["expiresAt NaN", { ...good(), expiresAt: Number.NaN }], ["expiresAt before first report", { ...good(), expiresAt: T0 - 1 }], ["reportCount 0", { ...good(), reportCount: 0 }],
    ["turn id with text", { ...good(), lastTurnId: "Tôi 16 tuổi, mục tiêu calo?" }], ["missing field", (({ kind: _k, ...rest }) => rest)(good())],
  ];
  for (const [name, value] of bad) {
    const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
    restriction.raw.set(`${mr.MINOR_RESTRICTION_KEY_PREFIX}${USER_A}`, { version: 3, data: JSON.stringify(value) });
    const r = await i.askPersonal("A", "s-corrupt");
    assert.equal(r.status, "SESSION_UNAVAILABLE", name); assert.deepEqual(i.w.calls, [], name); assert.equal(lastTrace(i).minorRestriction?.store, "CORRUPT", name);
  }
  { // unparsable JSON text
    const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
    restriction.raw.set(`${mr.MINOR_RESTRICTION_KEY_PREFIX}${USER_A}`, { version: 1, data: "{broken" });
    assert.equal((await i.askPersonal("A", undefined)).status, "SESSION_UNAVAILABLE"); assert.deepEqual(i.w.calls, []);
    // the user states a minor age again: the corrupt record is replaced by a valid one (strictly more restrictive) and everything works
    await i.ask(MINOR_STATEMENT, "A", undefined);
    assert.equal(recordOf(restriction)?.reportCount, 1); assert.equal((await i.askPersonal("A", "after-repair")).status, "MINOR_PROTECTED");
  }
});

test("MR-9 corrupt SESSION-scoped stated-minor entry (Codex P2: value null) no longer silently ignored → fail closed", async () => {
  const session = sc.createInMemorySessionStore(); const { restriction } = sharedStores();
  const mk = (value: unknown): ContextEntry => ({ id: "e1", owner: USER_A, sessionId: "s-bad", kind: "USER_STATEMENT", subject: "user.statedMinorAge", value: value as any, source: { producer: "user", turnId: "t" }, createdAt: T0, expiresAt: null, verification: "USER_REPORTED" });
  for (const value of [null, { underEighteen: "yes" }, { underEighteen: false }]) {
    session.raw.set(JSON.stringify([USER_A, "s-bad"]), [mk(value)]);
    const i = instance({ restriction, session });
    assert.equal((await i.askPersonal("A", "s-bad")).status, "SESSION_UNAVAILABLE", JSON.stringify(value)); assert.deepEqual(i.w.calls, []);
  }
  // an entry that is merely superseded history stays harmless
  session.raw.set(JSON.stringify([USER_A, "s-bad"]), [{ ...mk({ underEighteen: true }), verification: "SUPERSEDED" }]);
  assert.notEqual((await instance({ restriction, session }).askPersonal("A", "s-bad")).status, "SESSION_UNAVAILABLE");
});

// ── 5. TTL ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("MR-10 TTL semantics (injected clock): 30 days SLIDING; expiry is exact; expiry is never a store error; a later report only extends, never shortens", async () => {
  assert.equal(mr.MINOR_RESTRICTION_TTL_MS, 30 * DAY);
  const { restriction, session } = sharedStores(); const clock = { t: T0 }; const i = instance({ restriction, session, clock });
  await i.ask(MINOR_STATEMENT, "A", "s1");
  assert.equal(recordOf(restriction)?.expiresAt, T0 + 30 * DAY);
  clock.t = T0 + 29 * DAY;
  assert.equal((await i.askPersonal("A", "new")).status, "MINOR_PROTECTED", "day 29");
  clock.t = T0 + 30 * DAY - 1;
  assert.equal((await mr.readMinorRestriction(restriction, USER_A, clock.t)).status, "ACTIVE", "1 ms before expiry");
  assert.equal((await mr.readMinorRestriction(restriction, USER_A, T0 + 30 * DAY)).status, "EXPIRED", "at expiresAt the restriction is over (expiresAt > now is required)");
  clock.t = T0 + 31 * DAY;
  const after = await i.askPersonal("A", "new");
  // M8-B S1: expiry is a REVIEW POINT, not permission — the clock alone never yields ADULT (old assertion encoded: ANSWERED = TTL lifts the restriction).
  assert.equal(after.status, "MINOR_PROTECTED", "an expired record still restricts (clearing is an owner policy decision, not implemented)"); assert.equal(lastTrace(i).minorRestriction?.state, "EXPIRED"); assert.equal(lastTrace(i).minorRestriction?.store, "OK"); assert.equal(lastTrace(i).ageGate?.status, "MINOR");
  // sliding: a report on day 20 extends the expiry to day 50
  const s2 = sharedStores(); const c2 = { t: T0 }; const j = instance({ restriction: s2.restriction, session: s2.session, clock: c2 });
  await j.ask(MINOR_STATEMENT, "A", undefined); c2.t = T0 + 20 * DAY; await j.ask("Mình mới 17 tuổi thôi.", "A", undefined);
  const r2 = recordOf(s2.restriction)!; assert.equal(r2.expiresAt, T0 + 50 * DAY); assert.equal(r2.firstReportedAt, T0); assert.equal(r2.lastReportedAt, T0 + 20 * DAY); assert.equal(r2.reportCount, 2);
  c2.t = T0 + 31 * DAY; assert.equal((await j.askPersonal("A", "z")).status, "MINOR_PROTECTED", "still restricted at day 31 thanks to the sliding report");
  // monotonic: a writer with an older clock can never shorten the expiry or move lastReportedAt back
  assert.equal(await mr.recordMinorRestriction(s2.restriction, USER_A, { turnId: "t-old-clock", now: T0 + 1_000 }), "ok");
  const r3 = recordOf(s2.restriction)!; assert.equal(r3.expiresAt, T0 + 50 * DAY); assert.equal(r3.lastReportedAt, T0 + 20 * DAY); assert.equal(r3.lastTurnId, r2.lastTurnId);
  // an EXPIRED record plus a new statement starts a fresh record
  const c4 = { t: T0 + 60 * DAY }; const k = instance({ restriction: s2.restriction, session: s2.session, clock: c4 });
  await k.ask(MINOR_STATEMENT, "A", undefined); const r4 = recordOf(s2.restriction)!; assert.equal(r4.firstReportedAt, T0 + 60 * DAY); assert.equal(r4.reportCount, 1);
});

// ── 6. nothing clears it ─────────────────────────────────────────────────────────────────────────────────────────────
test("MR-11 neither 'tôi 30 tuổi' nor a verified adult profile age clears an active self-reported restriction (conservative; clearing is an owner policy decision)", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
  await i.ask(MINOR_STATEMENT, "A", "s1");
  const before = JSON.stringify(recordOf(restriction));
  const adult = await i.ask("À nhầm, tôi 30 tuổi rồi, mục tiêu calo của tôi là bao nhiêu?", "A", "s-adult-claim");
  assert.equal(adult.status, "MINOR_PROTECTED"); assert.equal(lastTrace(i).ageGate?.status, "MINOR"); assert.equal(lastTrace(i).ageGate?.conflict, true, "profile 30 vs active restriction is a reported conflict, not an override");
  assert.equal(lastTrace(i).profileRead, "PROFILE_OK");
  assert.equal(JSON.stringify(recordOf(restriction)), before, "an adult claim does not touch the record");
  assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED");
  assert.equal((await instance({ restriction, session, profiles: { "tok-a": { status: 200, data: { profile: { userId: USER_A, age: 45 } } } } }).askPersonal("A", "yet-another")).status, "MINOR_PROTECTED", "verified adult profile");
  // a user who never reported a minor age is unaffected by the adult statements
  const clean = instance({ restriction: faulty(mr.createInMemoryMinorRestrictionStore()), session: sc.createInMemorySessionStore() });
  assert.equal((await clean.ask("Tôi 30 tuổi, mục tiêu calo của tôi là bao nhiêu?", "A", undefined)).status === "MINOR_PROTECTED", false);
  assert.equal((clean as any).traces.length, 1);
});

// ── 7. provenance / privacy / non-statements ────────────────────────────────────────────────────────────────────────
test("MR-12 provenance: USER_REPORTED + times + turn ids only — no question text, no age, no sessionId, no profile data; traces carry codes only", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
  const secret = "Tôi 16 tuổi, mục tiêu calo của tôi là bao nhiêu?";
  await i.ask(secret, "A", "sess-secret-123");
  const rec = recordOf(restriction)!;
  assert.deepEqual(Object.keys(rec).sort(), ["expiresAt", "firstReportedAt", "firstTurnId", "kind", "lastReportedAt", "lastTurnId", "owner", "provenance", "reportCount", "schema", "underEighteen"]);
  assert.equal(rec.provenance, "USER_REPORTED"); assert.equal(rec.owner, USER_A); assert.equal(rec.firstTurnId, lastTrace(i).turnId, "which turn");
  const stored = restriction.raw.get(`${mr.MINOR_RESTRICTION_KEY_PREFIX}${USER_A}`)!.data;
  // '16' as a bare token (a stored age), not as a substring: the record holds random UUID turn ids whose hex digits can contain "16" (pre-existing ~13% flake)
  assert.ok(!/16/.test(stored), "age"); for (const bad of ["calo", "sess-secret-123", "tok-a", "Bearer", "mục tiêu"]) assert.ok(!stored.includes(bad), bad);
  const tj = JSON.stringify(i.traces);
  for (const bad of [USER_A, "sess-secret-123", mr.MINOR_RESTRICTION_KEY_PREFIX, "underEighteen", "SELF_REPORTED"]) assert.ok(!tj.includes(bad), bad);
  assert.deepEqual(lastTrace(i).minorRestriction, { store: "OK", state: "ACTIVE", written: "OK" }, "codes only");
});

test("MR-13 only an EXPLICIT first-person under-18 statement records a restriction (ambiguous / third-party / adult / negated ones write nothing)", async () => {
  for (const q of ["Chào anh em mười lăm tuổi, squat là bài tập gì?", "Con tôi 15 tuổi, squat là bài tập gì?", "Tôi 30 tuổi, squat là bài tập gì?", "Tôi không phải 15 tuổi, squat là bài tập gì?", "Squat là bài tập gì?"]) {
    const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
    await i.ask(q, "A", "s1");
    assert.equal(restriction.raw.size, 0, q); assert.equal(restriction.st.writes.length, 0, q);
  }
});

// ── 8. runtime composition ───────────────────────────────────────────────────────────────────────────────────────────
test("MR-14 composition root: a restriction store is ALWAYS present — in-memory outside production (single process), production has NO implementation → 503, never a silent fallback", async () => {
  // default (no injection, non-production): user scope still works across sessions
  const w = hz.world(() => T0);
  const prov = hz.mockProvider("nutrition");
  const runtime = rt.createMultiAgentRuntime({ providerFor: () => prov, now: () => T0, deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress }, profileGet: async () => ({ status: 200, data: { profile: { userId: USER_A, age: 30 } } } as any), env: {} } as any);
  const id = { userId: USER_A, authorizationHeader: "Bearer tok-a" };
  await runtime.ask({ question: MINOR_STATEMENT, identity: id, sessionId: "d1" });
  assert.equal((await runtime.ask({ question: PERSONAL, identity: id, sessionId: "d2" })).status, "MINOR_PROTECTED");
  assert.equal((await runtime.ask({ question: PERSONAL, identity: id })).status, "MINOR_PROTECTED");
  // the resolver
  const mem = rt.resolveMinorRestrictionStore({}); assert.equal(mem.minorRestrictionStore, true);
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", AGENT_V2_SESSION_STORE: "redis", AGENT_V2_SESSION_REDIS_URL: "redis://cache.internal:6379" }, { NODE_ENV: "production", AGENT_V2_SESSION_STORE: "dynamodb" }]) {
    assert.throws(() => rt.resolveMinorRestrictionStore(env), (e: any) => e.statusCode === 503, JSON.stringify(env));
  }
  // production runtime without an injected restriction store cannot be created (no persistent implementation exists)
  assert.throws(() => rt.createMultiAgentRuntime({ providerFor: () => prov, now: () => T0, deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress }, sessionStore: sc.createInMemorySessionStore(), env: { NODE_ENV: "production" } } as any), (e: any) => e.statusCode === 503);
});

test("MR-15 the adapters are not claimed to implement the interface: neither the Redis nor the DynamoDB session store is a MinorRestrictionStore", async () => {
  const rs = await import("../agent-v2-integration/redis-session-store"); const ds = await import("../agent-v2-integration/dynamodb-session-store");
  const calls: string[] = [];
  const fakeRedis = { hmGet: async () => { calls.push("r"); return [null, null, null]; }, eval: async () => { calls.push("e"); return 1; } } as any;
  for (const s of [rs.createRedisSessionStore({ client: fakeRedis }), ds.createDynamoSessionStore({ tableName: "tbl-test", send: (async () => { calls.push("d"); return {}; }) as any })] as any[]) assert.equal(s.minorRestrictionStore, undefined);
});

// ── 9. HTTP ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const BODY_KEYS = ["agents", "answer", "status", "traceId", "turnId"];
function httpRig() {
  process.env.AI_AGENT_V2 = "on";
  const stores = sharedStores();
  const i = instance(stores);
  rt.multiAgentRuntimeSeam.factory = () => i.runtime;
  const post = (q: string, o: { token?: string; sessionId?: string } = {}) => request(app).post("/ai/v2/ask").set("Authorization", `Bearer ${o.token ?? "tok-a"}`).send({ question: q, ...(o.sessionId ? { sessionId: o.sessionId } : {}) });
  const personal = async (o: { token?: string; sessionId?: string } = {}) => {
    i.prov.nutrition.script(hz.use(hz.call("nutrition.get_target")), hz.say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày.")); const r = await post(PERSONAL, o); i.prov.nutrition.drain(); return r;
  };
  return { ...stores, i, post, personal };
}

test("MR-H1 HTTP: POST /ai/v2/ask — minor statement with sessionId s1, then a NEW sessionId and NO sessionId: both MINOR_PROTECTED (200, public body unchanged, 0 domain calls)", async () => {
  const h = httpRig();
  assert.equal((await h.post(MINOR_STATEMENT, { sessionId: "s1" })).status, 200);
  for (const o of [{ sessionId: "s1" }, { sessionId: "s2" }, {}]) {
    const r = await h.personal(o);
    assert.equal(r.status, 200); assert.equal(r.body.data.status, "MINOR_PROTECTED", JSON.stringify(o)); assert.deepEqual(r.body.data.agents, []);
    assert.deepEqual(Object.keys(r.body.data).sort(), BODY_KEYS); assert.ok(!JSON.stringify(r.body).includes("minorRestriction"));
  }
  assert.deepEqual(h.i.w.calls, []); assert.equal(blocked, 0); assert.equal(llmCalls, 0);
});

test("MR-H2 HTTP: another account (token B) is not restricted by A's statement; A stays restricted with a fresh session", async () => {
  const h = httpRig();
  await h.post(MINOR_STATEMENT, { sessionId: "shared" });
  const b = await h.personal({ token: "tok-b", sessionId: "shared" });
  assert.equal(b.body.data.status, "ANSWERED"); assert.deepEqual(b.body.data.agents, ["nutrition"]);
  assert.equal((await h.personal({ token: "tok-b" })).body.data.status, "ANSWERED");
  assert.equal((await h.personal({ token: "tok-a", sessionId: "fresh" })).body.data.status, "MINOR_PROTECTED");
  assert.deepEqual([...h.restriction.raw.keys()], [`${mr.MINOR_RESTRICTION_KEY_PREFIX}${USER_A}`]);
});

test("MR-H3 HTTP: store down / corrupt → 200 SESSION_UNAVAILABLE for a personal ask without sessionId, 0 domain calls; a minor statement that cannot be stored is refused", async () => {
  const h = httpRig();
  h.restriction.st.readFail = "UNAVAILABLE";
  let r = await h.personal(); assert.equal(r.status, 200); assert.equal(r.body.data.status, "SESSION_UNAVAILABLE"); assert.deepEqual(r.body.data.agents, []);
  h.restriction.st.readFail = null; h.restriction.raw.set(`${mr.MINOR_RESTRICTION_KEY_PREFIX}${USER_A}`, { version: 2, data: JSON.stringify({ owner: USER_A, underEighteen: null }) });
  r = await h.personal({ sessionId: "z" }); assert.equal(r.body.data.status, "SESSION_UNAVAILABLE");
  h.restriction.raw.clear(); h.restriction.st.writeFail = "UNAVAILABLE";
  r = await h.post("Tôi 16 tuổi, mục tiêu calo của tôi là bao nhiêu?"); assert.equal(r.body.data.status, "SESSION_UNAVAILABLE");
  assert.deepEqual(h.i.w.calls, []);
});

test("MR-H4 HTTP: flag OFF → 404 and the restriction store is never touched; 'tôi 30 tuổi' over HTTP does not lift the restriction", async () => {
  const h = httpRig();
  await h.post(MINOR_STATEMENT);
  const adult = await h.post("Tôi 30 tuổi, mục tiêu calo của tôi là bao nhiêu?", { sessionId: "new-adult-claim" });
  assert.equal(adult.body.data.status, "MINOR_PROTECTED");
  delete process.env.AI_AGENT_V2; const ops = h.restriction.st.reads.length + h.restriction.st.writes.length;
  assert.equal((await h.post(PERSONAL)).status, 404); assert.equal(h.restriction.st.reads.length + h.restriction.st.writes.length, ops);
});
