/**
 * M8-C C1 — MINOR SAFETY: quarantine overflow + concurrent turns (Codex review of 0977eeb8: 2 reproduced P1, both V2).
 *
 *   P1-1  PendingMinorRestrictions.add() returned null when the registry was full: a minor statement whose write FAILED left no pending entry,
 *         the next turn read NONE and an adult-profile user was ANSWERED. FIX: a second, fixed-size tier (overflow filter) — an owner is never dropped.
 *   P1-2  a personal turn that had sampled / read the restriction BEFORE a concurrent minor statement registered kept a stale `sessionMinor=false`,
 *         reached Gate 1 + delegation (even getNutritionTargetPreview) and was ANSWERED. FIX: an in-flight watch per owner, consumed synchronously
 *         after every await that precedes a grant (see minor-restriction.ts / supervisor.ts).
 *
 * Evidence label: TEST FIXTURE — in-memory fake stores, injected clock, mock agent models, fake profile reader. Every interleaving is a CONTROLLABLE
 * schedule (deferred promises / gates injected into the fake stores, profile reader and mock model); no sleep, no timeout, no timer.
 * No Redis, DynamoDB, AWS, Nova, DB or network.
 * NOT VERIFIED: any persistent backend (none implements MinorRestrictionStore); several application instances (the quarantine, the overflow filter and
 * the watch are in-process: CC-LIMIT-2 asserts that on purpose).
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AGENT_V2_SESSION_STORE", "AGENT_V2_SESSION_REDIS_URL"]) delete process.env[k];

import type { MockProvider } from "./m5-benchmark/harness";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../agent-v2/supervisor";
import type { MinorRestrictionStore, MinorRestrictionRecord } from "../agent-v2/minor-restriction";
import type { AnySessionStore, VersionedSessionStore } from "../agent-v2/session-context";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
const MINOR_STATEMENT = "Tôi 16 tuổi.";
const PERSONAL = "Mục tiêu calo của tôi là bao nhiêu?";
const TWO_AGENTS = "Mục tiêu calo của tôi là bao nhiêu và lịch tập hôm nay của tôi thế nào?";

let hz: typeof import("./m5-benchmark/harness");
let sc: typeof import("../agent-v2/session-context");
let mr: typeof import("../agent-v2/minor-restriction");
let sup: typeof import("../agent-v2/supervisor");
let mg: typeof import("../agent-v2/minor-gate");
let rt: typeof import("../agent-v2-integration/multi-agent-runtime");
let blocked = 0; let llmCalls = 0;

test.before(async () => {
  globalThis.fetch = (async () => { blocked++; throw new Error("network blocked"); }) as typeof fetch;
  const axios = (await import("axios")).default;
  axios.defaults.adapter = async () => { blocked++; throw new Error("network blocked"); };
  const { bedrockRuntimeDeps } = await import("../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { blocked++; throw new Error("provider blocked"); }) as any;
  const { llmService } = await import("../services/llm.service");
  (llmService as any).callLLM = async () => { llmCalls++; throw new Error("TRIPWIRE"); };
  hz = await import("./m5-benchmark/harness");
  sc = await import("../agent-v2/session-context");
  mr = await import("../agent-v2/minor-restriction");
  sup = await import("../agent-v2/supervisor");
  mg = await import("../agent-v2/minor-gate");
  rt = await import("../agent-v2-integration/multi-agent-runtime");
  process.env.AI_AGENT_V2 = "on";
});
test.afterEach(() => { assert.equal(mr.watchedOwnerCount(), 0, "no in-flight watch survives a finished test (state exists only while a turn is in flight)"); });
test.after(() => { delete process.env.AI_AGENT_V2; assert.equal(blocked, 0); assert.equal(llmCalls, 0); });

// ── controllable schedule primitives (deferred promises — never a sleep) ─────────────────────────────────────────────────
interface Gate { /** call from the code under control: signals arrival, then waits for open() */ hold(): Promise<void>; /** resolves when hold() was reached */ arrived: Promise<void>; open(): void }
function gate(): Gate {
  let open!: () => void; let reached!: () => void;
  const opened = new Promise<void>((r) => { open = r; }); const arrived = new Promise<void>((r) => { reached = r; });
  return { hold: async () => { reached(); await opened; }, arrived, open };
}

type Fail = null | "UNAVAILABLE" | "TIMEOUT" | "CORRUPT";
/** A restriction store over a shared inner store: failures, a forced CAS conflict, call logs, and a QUEUE of read hooks (each hook gates exactly one read). */
function faulty(inner: MinorRestrictionStore & { raw?: Map<string, { version: number; data: string }> }) {
  const st = { readFail: null as Fail, writeFail: null as Fail, alwaysConflict: false, reads: [] as string[], writes: [] as string[], readHooks: [] as Array<() => Promise<void>>, writeHooks: [] as Array<() => Promise<void>> };
  const store: MinorRestrictionStore & { raw: any; st: typeof st } = {
    minorRestrictionStore: true, raw: inner.raw, st,
    async read(owner) {
      st.reads.push(owner); if (st.readFail) throw new sc.SessionStoreError(st.readFail);
      const snapshot = await inner.read(owner); // the snapshot is taken HERE, then the (gated) await: anything written meanwhile is invisible to it
      const hook = st.readHooks.shift(); if (hook) await hook();
      return snapshot;
    },
    async write(owner, expected, record) {
      st.writes.push(owner);
      const hook = st.writeHooks.shift(); if (hook) await hook();
      if (st.writeFail) throw new sc.SessionStoreError(st.writeFail);
      if (st.alwaysConflict) return false;
      return inner.write(owner, expected, record);
    },
  };
  return store;
}
type Rig = ReturnType<typeof faulty>;

/** A versioned (async) session store whose reads can be gated. */
function gatedSessionStore() {
  const data = new Map<string, { entries: unknown[]; version: number }>(); const readHooks: Array<() => Promise<void>> = [];
  const key = (o: string, s: string) => JSON.stringify([o, s]);
  const store: VersionedSessionStore & { readHooks: typeof readHooks; data: typeof data } = {
    versioned: true, readHooks, data,
    async read(owner, sessionId) { const e = data.get(key(owner, sessionId)); const snap = { entries: structuredClone(e?.entries ?? []), version: String(e?.version ?? 0) }; const h = readHooks.shift(); if (h) await h(); return snap; },
    async write(owner, sessionId, expected, entries) { const cur = data.get(key(owner, sessionId)); if (String(cur?.version ?? 0) !== expected) return false; data.set(key(owner, sessionId), { entries: structuredClone(entries), version: (cur?.version ?? 0) + 1 }); return true; },
  };
  return store;
}

interface RigOptions { restriction?: Rig | MinorRestrictionStore; session?: AnySessionStore; clock?: { t: number }; profiles?: Record<string, { status: number; data?: unknown }>; profileHooks?: Array<() => Promise<void>>; }
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
    profileGet: async (req) => {
      const hook = o.profileHooks?.shift(); if (hook) await hook();
      const r = (profiles as any)[String(req.headers.Authorization).replace("Bearer ", "")] ?? { status: 401 }; if (r.status >= 400) throw Object.assign(new Error("x"), { status: r.status }); return r as any;
    },
    sessionStore: o.session ?? sc.createInMemorySessionStore(), restrictionStore: o.restriction, traceSink: (x) => traces.push(x),
  });
  const ask = (q: string, user: "A" | "B" = "A", sessionId?: string) => runtime.ask({ question: q, identity: { userId: user === "A" ? USER_A : USER_B, authorizationHeader: `Bearer tok-${user.toLowerCase()}` }, ...(sessionId ? { sessionId } : {}) });
  /** A personal question whose nutrition read is scripted: it only runs if the gate lets it through. */
  const askPersonal = async (user: "A" | "B" = "A", sessionId?: string, q: string = PERSONAL) => {
    prov.nutrition.script(hz.use(hz.call("nutrition.get_target")), hz.say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày."));
    const r = await ask(q, user, sessionId); prov.nutrition.drain(); return r;
  };
  return { ask, askPersonal, w, prov, traces, runtime, clock };
}
type Instance = ReturnType<typeof instance>;
const sharedStores = () => ({ restriction: faulty(mr.createInMemoryMinorRestrictionStore()), session: sc.createInMemorySessionStore() });
const lastTrace = (i: { traces: SupervisorTrace[] }) => i.traces[i.traces.length - 1];
const keyOf = (owner = USER_A) => `${mr.MINOR_RESTRICTION_KEY_PREFIX}${owner}`;
const recordOf = (store: { raw: Map<string, { version: number; data: string }> }, owner = USER_A) => JSON.parse(store.raw.get(keyOf(owner))?.data ?? "null") as MinorRestrictionRecord | null;
const pendingOf = (store: MinorRestrictionStore) => mr.pendingMinorRestrictionsFor(store);
/** Fill the EXACT tier of the store's quarantine to its cap with other owners (cheap, synchronous). */
const fillExactTier = (store: MinorRestrictionStore) => { const p = pendingOf(store); for (let n = 0; n < mr.PENDING_MINOR_RESTRICTION_MAX_OWNERS; n++) p.add(`fill-${n}`, { turnId: "fill", now: T0 }); assert.equal(p.size, mr.PENDING_MINOR_RESTRICTION_MAX_OWNERS); };
const noPersonalCalls = (i: Instance, user = "A") => assert.deepEqual(i.w.calls.filter((c) => c.endsWith(`:${user}`)), [], "no personal tool ran for this user");

// ═════════════════════════════════════════ P1-1: capacity / overflow ═════════════════════════════════════════════════════
test("CC-1 (Codex P1-1 repro) the exact tier is FULL and the restriction write FAILS: the statement turn is refused AND the next personal turn (no session / new session / same session) stays MINOR_PROTECTED — also with an adult profile — and no personal tool runs", async () => {
  const { restriction, session } = sharedStores();
  const i = instance({ restriction, session, profiles: { "tok-a": { status: 200, data: { profile: { userId: USER_A, age: 45 } } } } });
  fillExactTier(restriction); const pending = pendingOf(restriction);
  restriction.st.writeFail = "UNAVAILABLE";
  assert.equal((await i.ask(MINOR_STATEMENT, "A", "s1")).status, "SESSION_UNAVAILABLE");
  assert.equal(pending.has(USER_A), true, "the restriction is held (overflow tier), not dropped"); assert.equal(pending.get(USER_A), null, "...but not as an exact entry"); assert.equal(pending.inOverflow(USER_A), true); assert.equal(pending.size, mr.PENDING_MINOR_RESTRICTION_MAX_OWNERS, "the exact tier did not grow");
  assert.equal(lastTrace(i).minorRestriction?.state, "PENDING");
  restriction.st.writeFail = null;
  for (const sid of [undefined, "s2", "s1"]) { const r = await i.askPersonal("A", sid); assert.equal(r.status, "MINOR_PROTECTED", String(sid)); assert.equal(lastTrace(i).ageGate?.status, "MINOR"); assert.equal(lastTrace(i).minorRestriction?.state, "PENDING"); }
  noPersonalCalls(i); assert.equal(restriction.raw.size, 0, "nothing durable: the overflow tier keeps no report to retry (and a false positive must never be written)");
});

test("CC-2 the same overflow for every failure kind of the write (UNAVAILABLE / TIMEOUT / CORRUPT / CAS CONFLICT) and for a failing READ: always refused, never ANSWERED", async () => {
  for (const kind of ["UNAVAILABLE", "TIMEOUT", "CORRUPT", "CONFLICT", "READ-UNAVAILABLE"] as const) {
    const { restriction, session } = sharedStores(); const i = instance({ restriction, session }); fillExactTier(restriction);
    if (kind === "CONFLICT") restriction.st.alwaysConflict = true; else if (kind === "READ-UNAVAILABLE") restriction.st.readFail = "UNAVAILABLE"; else restriction.st.writeFail = kind;
    assert.equal((await i.ask(MINOR_STATEMENT, "A", undefined)).status, "SESSION_UNAVAILABLE", kind); assert.equal(pendingOf(restriction).has(USER_A), true, kind);
    restriction.st.writeFail = null; restriction.st.alwaysConflict = false; restriction.st.readFail = null;
    assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED", kind); noPersonalCalls(i);
    restriction.st.readFail = "UNAVAILABLE"; assert.equal((await i.askPersonal("A", "x")).status, "MINOR_PROTECTED", `${kind}: the store is down AND the owner is held: still a minor, not merely UNKNOWN`); assert.equal(lastTrace(i).minorRestriction?.state, "PENDING");
  }
});

test("CC-3 multiple users while the exact tier is full: A (lost to overflow) is refused on every session; B and a third user are NOT refused (their own durable read decides); no leak between them; a second overflowed owner is refused too", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session }); fillExactTier(restriction);
  restriction.st.writeFail = "UNAVAILABLE";
  assert.equal((await i.ask(MINOR_STATEMENT, "A", "shared")).status, "SESSION_UNAVAILABLE");
  restriction.st.writeFail = null;
  for (const sid of ["shared", undefined]) { assert.equal((await i.askPersonal("A", sid)).status, "MINOR_PROTECTED"); const b = await i.askPersonal("B", sid); assert.equal(b.status, "ANSWERED", `B ${sid}`); assert.equal(lastTrace(i).ageGate?.status, "ADULT"); assert.notEqual(lastTrace(i).minorRestriction?.state, "PENDING"); }
  assert.equal(pendingOf(restriction).has(USER_B), false); assert.equal(pendingOf(restriction).has("33333333-3333-4333-8333-333333333333"), false);
  // B now also states a minor age while the store is down: B is held by the overflow tier as well; A is unchanged and B's record would belong to B only
  restriction.st.writeFail = "TIMEOUT";
  assert.equal((await i.ask(MINOR_STATEMENT, "B", undefined)).status, "SESSION_UNAVAILABLE"); restriction.st.writeFail = null;
  assert.equal((await i.askPersonal("B", undefined)).status, "MINOR_PROTECTED"); assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED");
  assert.deepEqual([...restriction.raw.keys()], [], "no record was written for anyone (and none for a bystander)");
});

test("CC-4 overflow + RECOVERY: the store comes back — the overflowed owner stays restricted in this process (no report to retry), but a NEW statement of that owner persists durably; other owners are unaffected throughout", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session }); fillExactTier(restriction);
  restriction.st.writeFail = "UNAVAILABLE"; await i.ask(MINOR_STATEMENT, "A", "s1"); restriction.st.writeFail = null;
  assert.equal((await i.askPersonal("A", "s9")).status, "MINOR_PROTECTED"); assert.equal(restriction.raw.size, 0);
  assert.equal((await i.askPersonal("B", "s9")).status, "ANSWERED");
  const writes = restriction.st.writes.length;
  const again = await i.ask("Mình mới 15 tuổi thôi.", "A", "s2"); assert.notEqual(again.status, "SESSION_UNAVAILABLE", "the statement is durable this time"); assert.equal(restriction.st.writes.length, writes + 1);
  const rec = recordOf(restriction); assert.ok(rec); assert.equal(rec!.owner, USER_A); assert.equal(rec!.reportCount, 1);
  assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED"); assert.equal((await instance({ restriction, session }).askPersonal("A", "other-instance")).status, "MINOR_PROTECTED", "durable: another instance reads it");
  assert.equal(pendingOf(restriction).inOverflow(USER_A), true, "the filter cannot be emptied (no clearing path)");
  noPersonalCalls(i);
});

test("CC-5 registry unit: a full exact tier never drops an owner (cap 2, 20 owners): every owner is `has`, only 2 are exact and retryable, the overflow count is exact, removal frees exact capacity but never the filter", () => {
  const p = mr.createPendingMinorRestrictions(2); const owners = Array.from({ length: 20 }, (_, n) => `owner-${n}`);
  const entries = owners.map((o) => p.add(o, { turnId: "t", now: T0 }));
  assert.equal(p.size, 2); assert.equal(p.overflowInserts, 18); assert.deepEqual(entries.map((e) => e === null), owners.map((_, n) => n >= 2));
  for (const o of owners) assert.equal(p.has(o), true, `${o} is never dropped`);
  assert.equal(p.get("owner-5"), null); assert.equal(p.inOverflow("owner-5"), true); assert.equal(p.inOverflow("owner-0"), false);
  assert.equal(p.add("owner-5", { turnId: "again", now: T0 + 1 }), null); assert.equal(p.overflowInserts, 18, "an owner already in the filter is not inserted twice");
  p.remove("owner-0", entries[0]!); assert.equal(p.size, 1); assert.equal(p.has("owner-0"), false, "exact entry removed after a durable write");
  const fresh = p.add("owner-new", { turnId: "t", now: T0 }); assert.ok(fresh, "freed exact capacity is reused by a NEW owner"); assert.equal(p.size, 2);
  p.remove("owner-5", { turnId: "t", now: T0 }); assert.equal(p.has("owner-5"), true, "remove never touches the overflow filter");
  assert.equal(p.add("a b", { turnId: "x", now: T0 }), null, "invalid owner id: nothing recorded"); assert.equal(p.has("a b"), false);
});

test("CC-6 overflow filter is one-directional: NO false negative over 5 000 inserted owners (cap 0); the false-positive rate on 5 000 other owners is far below 1 %; a saturated filter refuses everyone (the safe direction)", () => {
  const p = mr.createPendingMinorRestrictions(0); const ins = Array.from({ length: 5_000 }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  for (const o of ins) assert.equal(p.add(o, { turnId: "t", now: T0 }), null);
  assert.equal(ins.filter((o) => !p.has(o)).length, 0, "no active restriction is ever lost"); assert.equal(p.size, 0);
  const others = Array.from({ length: 5_000 }, (_, n) => `ffffffff-0000-4000-8000-${String(n).padStart(12, "0")}`); const fp = others.filter((o) => p.has(o)).length;
  assert.ok(fp / others.length < 0.01, `false positives: ${fp}/5000`);
  const tiny = mr.createPendingMinorRestrictions(0, 64); for (let n = 0; n < 200; n++) tiny.add(`user-${n}`, { turnId: "t", now: T0 });
  assert.equal(others.every((o) => tiny.has(o)), true, "a saturated filter reports everyone pending = refuse personal advice (fail closed), never fail open");
});

test("CC-7 persistMinorRestriction with the exact tier full: failure → {unavailable, quarantined:true} (was quarantined:false); a successful write is durable AND the owner stays held; a retry-only call for an overflow-only owner never claims 'ok' and never touches the store", async () => {
  const inner = mr.createInMemoryMinorRestrictionStore(); let writes = 0; let fail = true;
  const store: MinorRestrictionStore = { minorRestrictionStore: true, read: (o) => inner.read(o), write: async (o, v, r) => { writes++; if (fail) throw new sc.SessionStoreError("UNAVAILABLE"); return inner.write(o, v, r); } };
  const full = mr.createPendingMinorRestrictions(0);
  assert.deepEqual(await mr.persistMinorRestriction(store, full, USER_A, { turnId: "t", now: T0 }), { outcome: "unavailable", quarantined: true });
  writes = 0; assert.deepEqual(await mr.persistMinorRestriction(store, full, USER_A, null), { outcome: "unavailable", quarantined: true }); assert.equal(writes, 0, "nothing to retry");
  fail = false; assert.deepEqual(await mr.persistMinorRestriction(store, full, USER_B, { turnId: "t2", now: T0 }), { outcome: "ok", quarantined: true }); assert.equal(JSON.parse(inner.raw.get(keyOf(USER_B))!.data).owner, USER_B);
  assert.equal(inner.raw.has(keyOf(USER_A)), false, "the overflow-only owner was never written from the filter");
  // exact entries drain on recovery while the overflow owner stays held, and the freed capacity is used by the next failing owner
  const cap1 = mr.createPendingMinorRestrictions(1); fail = true;
  await mr.persistMinorRestriction(store, cap1, "ex-1", { turnId: "t", now: T0 }); await mr.persistMinorRestriction(store, cap1, "ov-2", { turnId: "t", now: T0 });
  assert.equal(cap1.get("ex-1")?.turnId, "t"); assert.equal(cap1.inOverflow("ov-2"), true);
  fail = false; assert.deepEqual(await mr.persistMinorRestriction(store, cap1, "ex-1", null), { outcome: "ok", quarantined: false }); assert.equal(cap1.size, 0);
  assert.deepEqual(await mr.persistMinorRestriction(store, cap1, "ov-2", null), { outcome: "unavailable", quarantined: true }, "overflow-only owner stays restricted");
  fail = true; await mr.persistMinorRestriction(store, cap1, "ex-3", { turnId: "t", now: T0 }); assert.ok(cap1.get("ex-3"), "capacity freed by the drained owner is exact again");
});

// ═════════════════════════════════════════ P1-2: concurrent turns ═════════════════════════════════════════════════════════
test("CC-8 (Codex P1-2 repro) a personal turn suspended in its restriction READ; a minor statement registers its quarantine (write fails); the personal turn is released → MINOR_PROTECTED, no personal tool, no answer", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session }); const g = gate();
  restriction.st.readHooks.push(g.hold);
  const personal = i.askPersonal("A", undefined); await g.arrived;
  restriction.st.writeFail = "UNAVAILABLE";
  assert.equal((await i.ask(MINOR_STATEMENT, "A", undefined)).status, "SESSION_UNAVAILABLE"); assert.equal(pendingOf(restriction).has(USER_A), true);
  g.open(); const r = await personal;
  assert.equal(r.status, "MINOR_PROTECTED"); noPersonalCalls(i); assert.equal(i.prov.nutrition.requests.length, 0, "no model call either"); assert.ok(!r.answer.includes("2400"));
  assert.equal(lastTrace(i).minorRestriction?.state, "PENDING");
  restriction.st.writeFail = null; assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED", "retry after recovery: still restricted, now durable"); assert.ok(recordOf(restriction)); assert.equal(pendingOf(restriction).size, 0);
});

test("CC-9 the STALE-READ variant that a pending re-check cannot catch: the statement's write SUCCEEDS and the pending entry is already removed while the personal turn still holds an older NONE snapshot → still MINOR_PROTECTED", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session }); const g = gate();
  restriction.st.readHooks.push(g.hold);
  const personal = i.askPersonal("A", "p"); await g.arrived;
  assert.notEqual((await i.ask(MINOR_STATEMENT, "A", "s")).status, "SESSION_UNAVAILABLE"); assert.ok(recordOf(restriction), "durable"); assert.equal(pendingOf(restriction).has(USER_A), false, "pending already removed: only the in-flight watch still knows");
  g.open(); const r = await personal; assert.equal(r.status, "MINOR_PROTECTED"); noPersonalCalls(i);
});

test("CC-10 await point: PROFILE read — a statement registers while the personal turn's profile read is suspended → MINOR_PROTECTED before any personal tool", async () => {
  for (const writeFails of [true, false]) {
    const { restriction, session } = sharedStores(); const g = gate(); const i = instance({ restriction, session, profileHooks: [g.hold] });
    const personal = i.askPersonal("A", "p"); await g.arrived;
    restriction.st.writeFail = writeFails ? "UNAVAILABLE" : null; await i.ask(MINOR_STATEMENT, "A", "s"); restriction.st.writeFail = null;
    g.open(); const r = await personal; assert.equal(r.status, "MINOR_PROTECTED", `writeFails=${writeFails}`); noPersonalCalls(i); assert.equal(i.prov.nutrition.requests.length, 0);
  }
});

test("CC-11 await point: SESSION read — a statement registers (other session) while the personal turn's session read is suspended → MINOR_PROTECTED", async () => {
  const restriction = faulty(mr.createInMemoryMinorRestrictionStore()); const session = gatedSessionStore(); const g = gate(); const i = instance({ restriction, session });
  session.readHooks.push(g.hold);
  const personal = i.askPersonal("A", "sess-gated"); await g.arrived;
  await i.ask(MINOR_STATEMENT, "A", "other-session"); assert.ok(recordOf(restriction));
  g.open(); const r = await personal; assert.equal(r.status, "MINOR_PROTECTED"); noPersonalCalls(i);
});

test("CC-12 await point: the user-scoped store reads NONE, the statement arrives on a turn WITHOUT any session / without a restriction record being written (write fails) while the personal turn awaits its profile read", async () => {
  const { restriction, session } = sharedStores(); const g = gate(); const i = instance({ restriction, session, profileHooks: [g.hold] });
  const personal = i.askPersonal("A", undefined); await g.arrived;
  restriction.st.alwaysConflict = true; assert.equal((await i.ask("Mình 14 tuổi.", "A", undefined)).status, "SESSION_UNAVAILABLE"); restriction.st.alwaysConflict = false;
  g.open(); assert.equal((await personal).status, "MINOR_PROTECTED"); noPersonalCalls(i);
});

test("CC-13 during an AGENT run (the model step is suspended): the statement arrives → the personal answer is WITHHELD (MINOR_PROTECTED, no results / provenance / personal text). The tool already ran BEFORE the statement was registered: that is the documented linearisation, not hidden", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session }); const g = gate();
  i.prov.nutrition.script(hz.use(hz.call("nutrition.get_target")), async () => { await g.hold(); return hz.say("Mục tiêu hiện tại của bạn là 2400 kcal mỗi ngày."); });
  const personal = i.ask(PERSONAL, "A", undefined); await g.arrived;
  assert.deepEqual(i.w.calls.filter((c) => c.endsWith(":A")), ["getNutritionTargetPreview:A"], "the read was issued before the statement existed");
  restriction.st.writeFail = "UNAVAILABLE"; assert.equal((await i.ask(MINOR_STATEMENT, "A", undefined)).status, "SESSION_UNAVAILABLE");
  g.open(); const r = await personal; i.prov.nutrition.drain();
  assert.equal(r.status, "MINOR_PROTECTED"); assert.ok(!r.answer.includes("2400")); assert.deepEqual(r.results, []); assert.deepEqual(r.provenance, []); assert.deepEqual(r.executedAgents, []);
  assert.equal(lastTrace(i).ageGate?.decision, "BLOCK_RESTRICTION_REGISTERED_DURING_TURN"); assert.ok(lastTrace(i).delegations.length >= 1, "what ran stays in the trace (codes only)");
});

test("CC-14 BETWEEN two delegations: the statement arrives while the first agent runs → the second agent is NEVER called and nothing personal is returned", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session }); const g = gate();
  // control: without a statement BOTH agents are called for this question (the scenario below is meaningful only then)
  const ctl = instance({ restriction: faulty(mr.createInMemoryMinorRestrictionStore()) });
  for (const a of ["nutrition", "training"] as const) ctl.prov[a].script(hz.say(`Phản hồi từ ${a}.`));
  await ctl.ask(TWO_AGENTS, "A", undefined); assert.ok(ctl.prov.nutrition.requests.length >= 1 && ctl.prov.training.requests.length >= 1, "the planner delegates to two agents");
  // whichever agent the planner runs first, hold ITS model step; the other agent's model must see no request
  const held = { who: "" };
  for (const a of ["nutrition", "training"] as const) i.prov[a].script(async () => { if (!held.who) { held.who = a; await g.hold(); } return hz.say(`Phản hồi từ ${a}: 2400 kcal, Leg day.`); });
  const personal = i.ask(TWO_AGENTS, "A", undefined); await g.arrived;
  restriction.st.writeFail = "UNAVAILABLE"; await i.ask(MINOR_STATEMENT, "A", undefined);
  g.open(); const r = await personal;
  const other = held.who === "nutrition" ? "training" : "nutrition";
  assert.equal(r.status, "MINOR_PROTECTED"); assert.equal(i.prov[other].requests.length, 0, `the second agent (${other}) was not granted anything`); assert.deepEqual(r.results, []); assert.ok(!/2400|Leg day/.test(r.answer));
  i.prov.nutrition.drain(); i.prov.training.drain();
});

test("CC-15 different USERS: A's statement registers while B's personal turn is suspended → B is ANSWERED (the watch is per owner); then B's statement does not restrict a suspended A turn", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session }); const g = gate();
  restriction.st.readHooks.push(g.hold);
  const bTurn = i.askPersonal("B", undefined); await g.arrived;
  restriction.st.writeFail = "UNAVAILABLE"; await i.ask(MINOR_STATEMENT, "A", undefined); restriction.st.writeFail = null;
  g.open(); assert.equal((await bTurn).status, "ANSWERED"); assert.equal(lastTrace(i).ageGate?.status, "ADULT");
  // reverse direction on a fresh store pair: A suspended, B states a minor age
  const g2 = gate(); const store2 = faulty(mr.createInMemoryMinorRestrictionStore()); const k = instance({ restriction: store2, session: sc.createInMemorySessionStore() }); store2.st.readHooks.push(g2.hold);
  const aTurn = k.askPersonal("A", undefined); await g2.arrived; await k.ask(MINOR_STATEMENT, "B", undefined); g2.open();
  assert.equal((await aTurn).status, "ANSWERED"); assert.equal(recordOf(store2, USER_B)?.owner, USER_B); assert.equal(recordOf(store2, USER_A), null);
});

test("CC-16 DIFFERENT sessions / no session / parallel statements: two statements in parallel (one with a session, one without) while two personal turns (new session, no session) are suspended in different awaits → all four outcomes are consistent and the record settles", async () => {
  const { restriction, session } = sharedStores(); const gp = gate(); const gr = gate(); const i = instance({ restriction, session, profileHooks: [gp.hold] });
  restriction.st.readHooks.push(gr.hold);
  const p1 = i.askPersonal("A", "pa"); await gr.arrived;           // p1 is inside the restriction read (it is the first reader)
  const p2 = i.askPersonal("A", undefined);                        // p2 reads the store (healthy) and then waits in its profile read
  await gp.arrived;
  const [s1, s2] = await Promise.all([i.ask(MINOR_STATEMENT, "A", "sa"), i.ask("Tôi cũng 15 tuổi nè", "A", undefined)]);
  assert.deepEqual([s1.status, s2.status].map((s) => s === "SESSION_UNAVAILABLE"), [false, false], "both statements persisted");
  gp.open(); gr.open(); const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual([r1.status, r2.status], ["MINOR_PROTECTED", "MINOR_PROTECTED"]); noPersonalCalls(i);
  assert.ok(recordOf(restriction)!.reportCount >= 1); assert.equal(pendingOf(restriction).size, 0);
});

test("CC-17 control: the watch does not over-refuse — without a concurrent statement the personal turn is ANSWERED; a statement of ANOTHER user never reaches A; B is restricted only after B's own statement", async () => {
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session });
  assert.equal((await i.askPersonal("A", "x")).status, "ANSWERED"); assert.equal((await i.askPersonal("B", "x")).status, "ANSWERED"); await i.ask(MINOR_STATEMENT, "B", "x");
  assert.equal((await i.askPersonal("A", "y")).status, "ANSWERED", "B's statement never reaches A"); assert.equal((await i.askPersonal("B", "y")).status, "MINOR_PROTECTED");
});

test("CC-18 the watch itself: report/consume per owner, an owner's own report does not flag its own turn, a foreign report flags it once, release deletes the state (bounded by in-flight turns), release is idempotent", () => {
  assert.equal(mr.watchedOwnerCount(), 0);
  const a1 = mr.watchOwnerRestriction("watch-A"); const a2 = mr.watchOwnerRestriction("watch-A"); const b = mr.watchOwnerRestriction("watch-B"); assert.equal(mr.watchedOwnerCount(), 2);
  assert.equal(a1.consume(), false); a1.report(); assert.equal(a1.consume(), false, "own report is not a surprise to its own turn"); assert.equal(a2.consume(), true, "but another in-flight turn of the same owner sees it"); assert.equal(a2.consume(), false, "once");
  assert.equal(b.consume(), false, "another owner is unaffected");
  a2.report(); assert.equal(a1.consume(), true);
  a2.report(); a1.report(); assert.equal(a1.consume(), true, "an unobserved foreign report is not swallowed by an own report");
  a1.release(); a1.release(); a2.release(); b.release(); assert.equal(mr.watchedOwnerCount(), 0);
});

test("CC-19 the watch is released also when the turn THROWS (no unbounded growth)", async () => {
  const before = mr.watchedOwnerCount();
  await assert.rejects(sup.runSupervisorTurn({ question: PERSONAL, context: { userId: USER_A } } as any, { enabled: true, runners: null as any, profileReader: async () => ({ status: "PROFILE_UNAVAILABLE" }) } as any));
  assert.equal(mr.watchedOwnerCount(), before);
});

// ═════════════════════════════════════════ policy / limits ════════════════════════════════════════════════════════════════
test("CC-20 NO clearing path: the module exports nothing that clears / deletes / lifts a restriction, the in-memory store exposes only read / write, and a later adult statement + adult profile + new session never lifts it", async () => {
  assert.deepEqual(Object.keys(mr).filter((k) => /clear|delete|lift|revoke|reset|erase|purge/i.test(k)), [], "no clearing export");
  const s = mr.createInMemoryMinorRestrictionStore(); assert.deepEqual(Object.keys(s).sort(), ["minorRestrictionStore", "raw", "read", "write"]);
  const { restriction, session } = sharedStores(); const i = instance({ restriction, session, profiles: { "tok-a": { status: 200, data: { profile: { userId: USER_A, age: 45 } } } } });
  await i.ask(MINOR_STATEMENT, "A", "s1"); await i.ask("Thực ra tôi 30 tuổi.", "A", "s1");
  assert.equal((await i.askPersonal("A", "s2")).status, "MINOR_PROTECTED"); assert.equal((await i.askPersonal("A", undefined)).status, "MINOR_PROTECTED"); assert.ok(recordOf(restriction));
});

test("CC-21 OPEN OWNER ITEM (characterisation, behaviour unchanged): statesMinorAge counts a HYPOTHETICAL first-person age as a statement (V1 extraction rules); the policy says a hypothetical is not a self-report — reported, not changed here", () => {
  const hypothetical = mg.statesMinorAge("Nếu tôi 16 tuổi thì nên tập thế nào?");
  console.log(`CHARACTERISATION statesMinorAge(hypothetical)=${hypothetical}`);
  assert.equal(hypothetical, true, "PINNED CURRENT BEHAVIOUR — change this assertion together with the owner's decision on hypothetical ages, not silently");
});

test("CC-LIMIT-2 DOCUMENTED RESIDUAL (NOT a pass for production): the overflow filter and the in-flight watch are in-process like the quarantine. A second registry (another instance) does not know an owner held by the first; only a persistent shared store closes it", async () => {
  const inner = mr.createInMemoryMinorRestrictionStore(); const w1 = faulty(inner); const w2 = faulty(inner); const session = sc.createInMemorySessionStore();
  const i1 = instance({ restriction: w1, session }); const i2 = instance({ restriction: w2, session }); fillExactTier(w1);
  w1.st.writeFail = "UNAVAILABLE"; assert.equal((await i1.ask(MINOR_STATEMENT, "A", "s1")).status, "SESSION_UNAVAILABLE"); assert.equal(pendingOf(w1).inOverflow(USER_A), true);
  assert.equal(pendingOf(w2).has(USER_A), false, "the overflow tier is per process");
  assert.equal((await i2.askPersonal("A", "s2")).status, "ANSWERED", "known residual: instance-local quarantine (the watch is process-wide, but this is a second PROCESS in production)");
});
