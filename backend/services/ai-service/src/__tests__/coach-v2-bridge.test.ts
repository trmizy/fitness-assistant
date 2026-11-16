/**
 * M9.2-T1 — AI Coach V1/V2 server bridge. TEST FIXTURE only: fake executor, no model / network / DB / Redis / AWS.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/coach-v2-bridge.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import {
  decideCoachRoute, runCoachBridge, isCoachBridgeEnabled, defaultCoachUserAllowlist, V2NotStartedError,
  type CoachRequestFacts, type CoachCapability, type V2Executor, type V2RawResult, type CoachBridgeDeps,
} from "../services/coach-v2-bridge";
import type { SupervisorResult } from "../agent-v2/supervisor";

const SRC = path.resolve(__dirname, "..");

const facts = (o: Partial<CoachRequestFacts> = {}): CoachRequestFacts => ({
  capability: "CHAT_READONLY_QA", transport: "json", userId: "user-1", callerKind: "gateway_user", hasUserBearer: true,
  question: "Tuần này tôi nên tập gì?", sessionAffinity: "none", clientRequestId: "req-00000001", ...o,
});

/** Harness: counts how often V2 ran and how often the caller would have run V1. */
function harness(raw: V2RawResult | (() => Promise<V2RawResult>), over: Partial<CoachBridgeDeps> = {}) {
  const calls: Array<{ question: string; userId: string; sessionId?: string }> = [];
  const executor: V2Executor = {
    ask: async (i) => { calls.push(i); return typeof raw === "function" ? raw() : raw; },
  };
  const deps: CoachBridgeDeps = { enabled: () => true, userAllowed: () => true, executor, ...over };
  return {
    calls,
    async dispatch(f: CoachRequestFacts) {
      const res = await runCoachBridge(f, deps);
      return { res, v1Runs: res.handler === "v1" ? 1 : 0 };
    },
  };
}
const ok = (status: string, answer = "câu trả lời V2"): V2RawResult => ({ status, answer, executedAgents: ["training"], turnId: "t-1", supervisorTraceId: "s-1" });

test("flag OFF (unset or any value other than exactly 'on'): V1 handles everything, V2 is never called", async () => {
  for (const v of [undefined, "", "true", "1", "ON", "on ", "off"]) {
    assert.equal(isCoachBridgeEnabled({ AI_COACH_V2_BRIDGE: v }), false, String(v));
  }
  assert.equal(isCoachBridgeEnabled({ AI_COACH_V2_BRIDGE: "on" }), true);
  assert.equal(isCoachBridgeEnabled({ AI_COACH_V2_BRIDGE: "on", NODE_ENV: "production" }), false, "production needs its own approval");
  assert.equal(isCoachBridgeEnabled({ AI_COACH_V2_BRIDGE: "on", NODE_ENV: "production", AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED: "yes" }), true);
  const h = harness(ok("ANSWERED"), { enabled: () => false });
  const { res, v1Runs } = await h.dispatch(facts());
  assert.deepEqual(res, { handler: "v1", reason: "BRIDGE_OFF", v2Attempted: false });
  assert.equal(v1Runs, 1);
  assert.equal(h.calls.length, 0);
});

test("default configuration (no env) is OFF and the default allowlist admits nobody", () => {
  assert.equal(decideCoachRoute(facts(), {}).route, "v1");
  const allow = defaultCoachUserAllowlist({});
  assert.equal(allow("user-1"), false);
  const some = defaultCoachUserAllowlist({ AI_COACH_V2_BRIDGE_USERS: " user-1 , user-2 " });
  assert.deepEqual([some("user-1"), some("user-2"), some("user-3"), some("")], [true, true, false, false]);
});

test("V1-only capabilities and the SSE transport never reach V2", async () => {
  const v1Only: CoachCapability[] = ["IMAGE_CHAT", "AGENT_WRITE_WORKFLOW", "AGENT_WORKFLOW_CONTINUATION", "INBODY_INTERPRET", "DAY_MACRO_ESTIMATE", "GENERATE_WORKOUT", "MEMORY", "FEEDBACK", "UNKNOWN", "CHAT_STREAM"];
  for (const capability of v1Only) {
    const h = harness(ok("ANSWERED"));
    const { res } = await h.dispatch(facts({ capability }));
    assert.deepEqual(res, { handler: "v1", reason: "CAPABILITY_V1_ONLY", v2Attempted: false }, capability);
    assert.equal(h.calls.length, 0, capability);
  }
  const h = harness(ok("ANSWERED"));
  assert.equal((await h.dispatch(facts({ transport: "sse" }))).res.handler, "v1", "plain Q&A over SSE is not eligible without an adapter");
  assert.equal(h.calls.length, 0);
});

test("a missing / malformed retry key (V1 legacy), a conversation already on V1, a non-end-user caller, a missing bearer or a non-allowlisted user stay on V1", async () => {
  const cases: Array<[Partial<CoachRequestFacts>, Partial<CoachBridgeDeps>, string]> = [
    [{ clientRequestId: undefined }, {}, "NO_VALID_CLIENT_REQUEST_ID"],
    [{ clientRequestId: "short" }, {}, "NO_VALID_CLIENT_REQUEST_ID"],
    [{ clientRequestId: "bad id with spaces!" }, {}, "NO_VALID_CLIENT_REQUEST_ID"],
    [{ clientRequestId: "x".repeat(65) }, {}, "NO_VALID_CLIENT_REQUEST_ID"],
    [{ sessionAffinity: "v1", sessionId: "11111111-1111-4111-8111-111111111111" }, {}, "SESSION_ON_V1"],
    [{ callerKind: "service" }, {}, "NOT_VERIFIED_END_USER"],
    [{ callerKind: undefined }, {}, "NOT_VERIFIED_END_USER"],
    [{ hasUserBearer: false }, {}, "NOT_VERIFIED_END_USER"],
    [{ userId: "" }, {}, "NOT_VERIFIED_END_USER"],
    [{}, { userAllowed: () => false }, "USER_NOT_ALLOWLISTED"],
  ];
  for (const [f, d, reason] of cases) {
    const h = harness(ok("ANSWERED"), d);
    const { res } = await h.dispatch(facts(f));
    assert.equal(res.handler, "v1", reason);
    assert.equal((res as { reason: string }).reason, reason);
    assert.equal(h.calls.length, 0, reason);
  }
});

test("eligible read-only question: V2 runs exactly once, V1 does not run, nothing is invented", async () => {
  const h = harness(ok("ANSWERED"));
  const { res, v1Runs } = await h.dispatch(facts({ sessionId: "sess_ok-1" }));
  assert.equal(v1Runs, 0);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], { question: "Tuần này tôi nên tập gì?", userId: "user-1", sessionId: "sess_ok-1" }, "clientRequestId never reaches the strict V2 input");
  assert.deepEqual(res, {
    handler: "v2", kind: "answered", status: "ANSWERED", answer: "câu trả lời V2", executedAgents: ["training"],
    turnId: "t-1", traceId: "s-1", fallbackAllowed: false,
  });
  for (const forbidden of ["structuredBlocks", "evidenceUsed", "safetyNotes", "conversationId", "history", "fallbackReason"]) {
    assert.ok(!(forbidden in res), `${forbidden} must not be fabricated`);
  }
  // session affinity "v2" is eligible too (an existing V2 conversation)
  const h2 = harness(ok("ANSWERED"));
  assert.equal((await h2.dispatch(facts({ sessionAffinity: "v2", sessionId: "abc" }))).res.handler, "v2");
});

test("V2 status classification: answered / partial / blocked / unavailable — and a V2 decision is final", async () => {
  const table: Array<[string, string, string?]> = [
    ["ANSWERED", "answered"], ["PARTIAL", "partial"], ["INSUFFICIENT_DATA", "partial"],
    ["SAFETY_BLOCKED", "blocked", "SAFETY"], ["MINOR_PROTECTED", "blocked", "MINOR"], ["PROFILE_UNVERIFIED", "blocked", "MINOR"],
    ["UNAUTHENTICATED", "blocked", "AUTH"], ["SESSION_UNAVAILABLE", "blocked", "PERSISTENCE"], ["ROUTING_UNDETERMINED", "blocked", "ROUTING"],
    ["BLOCKED", "blocked", "POLICY"], ["OUT_OF_SCOPE", "blocked", "POLICY"], ["INVALID_INPUT", "blocked", "INPUT"],
    ["FAILED", "unavailable"], ["BUDGET_EXHAUSTED", "unavailable"], ["SOMETHING_NEW", "unavailable"],
  ];
  for (const [status, kind, block] of table) {
    const h = harness(ok(status, `text ${status}`));
    const { res, v1Runs } = await h.dispatch(facts());
    assert.equal(res.handler, "v2", status);
    if (res.handler !== "v2") return;
    assert.equal(res.kind, kind, status);
    assert.equal(res.block, block, status);
    assert.equal(res.fallbackAllowed, false, status);
    assert.equal(res.answer, `text ${status}`);
    assert.equal(v1Runs, 0, `${status}: V1 must NOT be used to obtain an answer after V2 processed the request`);
    assert.equal(h.calls.length, 1, `${status}: V2 ran exactly once (no retry)`);
  }
});

test("SAFETY INVARIANT: errors thrown by V2 mid-turn (auth / persistence / anything) never fall back to V1", async () => {
  const mk = (e: unknown) => harness(async () => { throw e; });
  const authErr = Object.assign(new Error("forbidden"), { statusCode: 403 });
  const h1 = mk(authErr);
  const a = await h1.dispatch(facts());
  assert.equal(a.v1Runs, 0);
  assert.equal(a.res.handler === "v2" && a.res.kind, "blocked");
  assert.equal(a.res.handler === "v2" && a.res.block, "AUTH");
  for (const code of [401, 403]) {
    const r = await mk(Object.assign(new Error("x"), { statusCode: code })).dispatch(facts());
    assert.equal(r.v1Runs, 0);
  }
  for (const e of [Object.assign(new Error("session store down"), { statusCode: 503 }), new Error("boom"), "string error", null]) {
    const h = mk(e);
    const r = await h.dispatch(facts());
    assert.equal(r.v1Runs, 0, String(e));
    assert.equal(r.res.handler === "v2" && r.res.kind, "unavailable");
    assert.equal(r.res.handler === "v2" && r.res.answer, "", "no internal error text is passed through");
    assert.equal(h.calls.length, 1);
  }
});

test("V2 that provably did not start (DISABLED status, V2NotStartedError, no executor wired) hands over to V1", async () => {
  const d = await harness(ok("DISABLED")).dispatch(facts());
  assert.deepEqual(d.res, { handler: "v1", reason: "V2_NOT_STARTED", v2Attempted: true });
  const n = await harness(async () => { throw new V2NotStartedError(); }).dispatch(facts());
  assert.deepEqual(n.res, { handler: "v1", reason: "V2_NOT_STARTED", v2Attempted: true });
  const none = await runCoachBridge(facts(), { enabled: () => true, userAllowed: () => true });
  assert.deepEqual(none, { handler: "v1", reason: "V2_NOT_STARTED", v2Attempted: false });
});

test("trace carries codes only (no question, answer or user id)", async () => {
  const events: unknown[] = [];
  const h = harness(ok("SAFETY_BLOCKED", "riêng tư"), { trace: (e) => events.push(e) });
  await h.dispatch(facts({ userId: "secret-user", question: "câu hỏi riêng tư" }));
  assert.deepEqual(events, [{ route: "v2", reason: "ELIGIBLE_READ_ONLY", kind: "blocked" }]);
  assert.doesNotMatch(JSON.stringify(events), /secret-user|riêng tư/);
});

test("no external network: the whole suite behaves identically with fetch and raw sockets forbidden", async () => {
  const realFetch = globalThis.fetch;
  const realConnect = net.Socket.prototype.connect;
  let attempts = 0;
  globalThis.fetch = (() => { attempts++; throw new Error("network forbidden"); }) as typeof fetch;
  net.Socket.prototype.connect = function () { attempts++; throw new Error("network forbidden"); } as typeof net.Socket.prototype.connect;
  try {
    const h = harness(ok("ANSWERED"));
    assert.equal((await h.dispatch(facts())).res.handler, "v2");
    assert.equal((await harness(ok("ANSWERED"), { enabled: () => false }).dispatch(facts())).res.handler, "v1");
    assert.equal(attempts, 0);
  } finally {
    globalThis.fetch = realFetch;
    net.Socket.prototype.connect = realConnect;
  }
});

test("compile-time: the real V2 SupervisorResult is accepted as the bridge's structural V2RawResult", () => {
  const assign = (r: SupervisorResult): V2RawResult => r;
  assert.equal(typeof assign, "function");
});

// ── isolation / V1-compatibility pins for THIS module ─────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", "generated", "dist"].includes(e.name)) walk(p, out); }
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("the bridge imports nothing from agent-v2, touches no I/O and does not read the V2 endpoint's flag", () => {
  const src = fs.readFileSync(path.join(SRC, "services", "coach-v2-bridge.ts"), "utf8");
  assert.doesNotMatch(src, /from\s+["'][^"']*agent-v2|require\(\s*["'][^"']*agent-v2|import\(\s*["'][^"']*agent-v2/);
  assert.ok(!src.includes("AI_AGENT_V2"), "only src/agent-v2 may read AI_AGENT_V2");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /prisma|axios|fetch\(|requestService|express|redis|Bedrock|setInterval\(/i);
  assert.doesNotMatch(code, /^\s*import\s/m, "the bridge has no imports at all (pure module)");
});

test("V1 backward compatibility: the bridge is mounted nowhere — V1 routes, controllers and app are unaware of it", () => {
  const referrers = walk(SRC)
    .filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`))
    .filter((f) => ![path.join("services", "coach-v2-bridge.ts"), path.join("services", "coach-v2-continuity.ts")].includes(path.relative(SRC, f)))
    .filter((f) => /coach-v2-bridge|runCoachBridge|AI_COACH_V2_BRIDGE/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(referrers.map((f) => path.relative(SRC, f)), [], "wiring is a later, separately approved task (M9.2-T3)");
  for (const f of [path.join("routes", "ai.routes.ts"), path.join("controllers", "ai.controller.ts"), "app.ts"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(SRC, f), "utf8"), /coach-v2-bridge/, f);
  }
});
