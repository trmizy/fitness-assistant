/**
 * M9.2-T2 — AI Coach bridge continuity: idempotency + conversation history. TEST FIXTURE only: in-memory fakes for the
 * idempotency store and the history repository, fake V2 executor. No model / network / DB / Redis / AWS.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/coach-v2-continuity.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { V2NotStartedError, type V2Executor, type V2RawResult } from "../services/coach-v2-bridge";
import {
  runCoachTurn, shouldRecordHistory, coachActionFingerprint, V2_ENGINE_MARKER,
  type CoachTurnDeps, type CoachTurnInput,
} from "../services/coach-v2-continuity";

const SRC = path.resolve(__dirname, "..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

import { fakeStore, fakeHistory } from "./coach-continuity-fakes";

const raw = (status: string, answer = `answer ${status}`): V2RawResult => ({ status, answer, executedAgents: ["training"], turnId: `turn-${status}`, supervisorTraceId: `trace-${status}` });

function setup(result: V2RawResult | ((q: string, u: string) => Promise<V2RawResult>) = raw("ANSWERED"), over: Partial<CoachTurnDeps> = {}, storeOver = {}, histOver = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const executor: V2Executor = { ask: async (i) => { calls.push(i as unknown as Record<string, unknown>); return typeof result === "function" ? result(i.question, i.userId) : result; } };
  const s = fakeStore(storeOver);
  const h = fakeHistory(histOver);
  let n = 0;
  const deps: CoachTurnDeps = {
    enabled: () => true, userAllowed: () => true, executor, idempotency: s.store, history: h.history,
    newSessionId: () => `00000000-0000-4000-8000-00000000000${++n}`, now: () => 1_000, ...over,
  };
  return { calls, s, h, deps };
}
const input = (o: Partial<CoachTurnInput> = {}): CoachTurnInput => ({
  capability: "CHAT_READONLY_QA", transport: "json", userId: "user-1", callerKind: "gateway_user", hasUserBearer: true,
  question: "Tuần này tôi nên tập gì?", clientRequestId: "req-00000001", ...o,
});

// ── tests ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("flag OFF / no valid key / V1-only capability: V1 handles it and NO store, history or V2 is touched", async () => {
  const cases: Array<[Partial<CoachTurnDeps>, Partial<CoachTurnInput>, string]> = [
    [{ enabled: () => false }, {}, "BRIDGE_OFF"],
    [{}, { clientRequestId: undefined }, "NO_VALID_CLIENT_REQUEST_ID"],
    [{}, { clientRequestId: "bad" }, "NO_VALID_CLIENT_REQUEST_ID"],
    [{}, { capability: "AGENT_WRITE_WORKFLOW" }, "CAPABILITY_V1_ONLY"],
    [{}, { transport: "sse" }, "CAPABILITY_V1_ONLY"],
  ];
  for (const [d, i, reason] of cases) {
    const t = setup(raw("ANSWERED"), d);
    const res = await runCoachTurn(input(i), t.deps);
    assert.deepEqual(res, { handler: "v1", reason, v2Attempted: false });
    assert.equal(t.calls.length, 0);
    assert.equal(t.s.recs.size + t.h.sessions.size + t.h.turns.length, 0, reason);
  }
});

test("continuity ports not configured: an eligible request goes to V1 and V2 never runs", async () => {
  for (const missing of ["idempotency", "history"] as const) {
    const t = setup(raw("ANSWERED"), { [missing]: undefined });
    assert.deepEqual(await runCoachTurn(input(), t.deps), { handler: "v1", reason: "CONTINUITY_NOT_CONFIGURED", v2Attempted: false });
    assert.equal(t.calls.length, 0);
  }
});

test("answered turn: V2 runs once without clientRequestId, history is written once with only honest fields", async () => {
  const t = setup(raw("ANSWERED"));
  const res = await runCoachTurn(input(), t.deps);
  assert.equal(res.handler, "v2");
  if (res.handler !== "v2") return;
  assert.deepEqual([res.kind, res.status, res.replayed, res.historyRecorded], ["answered", "ANSWERED", false, true]);
  assert.equal(t.calls.length, 1);
  assert.deepEqual(Object.keys(t.calls[0]).sort(), ["question", "sessionId", "userId"], "strict V2 input: clientRequestId (and anything else) stays at the boundary");
  assert.match(String(t.calls[0].sessionId), UUID);
  assert.equal(res.sessionId, t.calls[0].sessionId, "ChatSession.id == the session V2 used == the returned session");
  assert.equal(t.h.sessions.size, 1);
  assert.deepEqual([...t.h.sessions.values()].map((s) => [s.id, s.userId, s.title]), [[res.sessionId, "user-1", "Tuần này tôi nên tập gì?"]]);
  assert.equal(t.h.turns.length, 1);
  const turn = t.h.turns[0];
  assert.deepEqual(
    { userId: turn.userId, sessionId: turn.sessionId, clientRequestId: turn.clientRequestId, question: turn.question, answer: turn.answer, modelUsed: turn.modelUsed, traceId: turn.traceId },
    { userId: "user-1", sessionId: res.sessionId, clientRequestId: "req-00000001", question: "Tuần này tôi nên tập gì?", answer: "answer ANSWERED", modelUsed: V2_ENGINE_MARKER, traceId: "trace-ANSWERED" },
  );
  assert.deepEqual([turn.promptTokens, turn.completionTokens, turn.totalTokens, turn.cost, turn.usedFallback, turn.warningCount], [0, 0, 0, 0, false, 0]);
  for (const invented of ["structuredBlocks", "routeIntent", "responseLanguage", "relevance", "evidenceUsed", "feedback"]) assert.ok(!(invented in turn), invented);
});

test("retry of the same action: answered from the stored result — no second V2 call, no second session or turn", async () => {
  const t = setup(raw("ANSWERED"));
  const first = await runCoachTurn(input(), t.deps);
  const again = await runCoachTurn(input(), t.deps);
  const third = await runCoachTurn(input(), t.deps);
  assert.equal(t.calls.length, 1);
  assert.equal(t.h.sessions.size, 1);
  assert.equal(t.h.turns.length, 1);
  for (const r of [again, third]) {
    assert.equal(r.handler, "v2");
    if (r.handler === "v2" && first.handler === "v2") { assert.equal(r.replayed, true); assert.equal(r.answer, first.answer); assert.equal(r.sessionId, first.sessionId); assert.equal(r.traceId, first.traceId); }
  }
});

test("concurrent duplicates: exactly one V2 run; the others are told IN_PROGRESS; afterwards a retry replays", async () => {
  let release!: (r: V2RawResult) => void;
  const gate = new Promise<V2RawResult>((r) => { release = r; });
  const t = setup(() => gate);
  const burst = Promise.all(Array.from({ length: 5 }, () => runCoachTurn(input(), t.deps)));
  await new Promise((r) => setImmediate(r)); // let every request reach the claim while the first is still running
  release(raw("ANSWERED"));
  const results = await burst;
  assert.equal(t.calls.length, 1, "V2 must not run twice for one action");
  assert.equal(results.filter((r) => r.handler === "v2").length, 1);
  assert.deepEqual(results.filter((r) => r.handler === "boundary").map((r) => r.handler === "boundary" && r.outcome), Array(4).fill("IN_PROGRESS"));
  assert.equal(t.h.turns.length, 1);
  const retry = await runCoachTurn(input(), t.deps);
  assert.equal(retry.handler === "v2" && retry.replayed, true);
  assert.equal(t.calls.length, 1);
});

test("same key with different content or different session is refused (KEY_CONFLICT) and never answered or re-run", async () => {
  const t = setup(raw("ANSWERED"));
  await runCoachTurn(input(), t.deps);
  const variants: Array<Partial<CoachTurnInput>> = [{ question: "Một câu hỏi khác" }, { sessionId: "11111111-1111-4111-8111-111111111111" }, { capability: "CHAT_STREAM" }];
  for (const v of variants.slice(0, 2)) {
    const r = await runCoachTurn(input(v), t.deps);
    // a different session never reaches the claim when the session is not the caller's (SESSION_NOT_FOUND); both refuse without running V2
    assert.equal(r.handler, "boundary");
    assert.ok(r.handler === "boundary" && ["KEY_CONFLICT", "SESSION_NOT_FOUND"].includes(r.outcome));
  }
  assert.equal((await runCoachTurn(input(variants[0]), t.deps) as { outcome?: string }).outcome, "KEY_CONFLICT");
  // whitespace-only differences are the same action (V1 compares trimmed questions)
  const same = await runCoachTurn(input({ question: "  Tuần này tôi nên tập gì?  " }), t.deps);
  assert.equal(same.handler === "v2" && same.replayed, true);
  assert.equal(coachActionFingerprint(input({ question: "x" })) === coachActionFingerprint(input({ question: "x ", clientRequestId: "other-0000001" })), true, "fingerprint excludes the key itself");
  assert.equal(t.calls.length, 1);
  assert.equal(t.h.turns.length, 1);
});

test("cross-user isolation: the same key under another user is a different action; sessions of other users do not exist for you", async () => {
  const t = setup(async (_q, u) => raw("ANSWERED", `answer for ${u}`));
  const a = await runCoachTurn(input({ userId: "user-A" }), t.deps);
  const b = await runCoachTurn(input({ userId: "user-B" }), t.deps);
  assert.equal(t.calls.length, 2);
  assert.equal(a.handler === "v2" && a.answer, "answer for user-A");
  assert.equal(b.handler === "v2" && b.answer, "answer for user-B", "never user A's cached response");
  assert.equal(b.handler === "v2" && b.replayed, false);
  assert.equal(t.s.recs.size, 2);
  assert.equal(t.h.turns.length, 2);
  // B names A's session → indistinguishable from "missing": no V2, no claim, no write
  const sidA = a.handler === "v2" ? a.sessionId : undefined;
  const calls = t.calls.length;
  for (const sid of [sidA!, "99999999-9999-4999-8999-999999999999"]) {
    const r = await runCoachTurn(input({ userId: "user-B", clientRequestId: "req-00000002", sessionId: sid }), t.deps);
    assert.deepEqual(r, { handler: "boundary", outcome: "SESSION_NOT_FOUND", fallbackAllowed: false });
  }
  assert.equal(t.calls.length, calls);
  assert.equal(t.s.recs.size, 2);
  // an archived session is also "not found"
  t.h.sessions.get(sidA!)!.archivedAt = new Date();
  assert.equal(((await runCoachTurn(input({ userId: "user-A", clientRequestId: "req-00000003", sessionId: sidA }), t.deps)) as { outcome?: string }).outcome, "SESSION_NOT_FOUND");
});

test("blocked / failed outcomes: V2's decision is final — no V1, no history, no session row, and a retry replays the same decision without re-running", async () => {
  const statuses = ["SAFETY_BLOCKED", "MINOR_PROTECTED", "PROFILE_UNVERIFIED", "UNAUTHENTICATED", "SESSION_UNAVAILABLE", "ROUTING_UNDETERMINED", "BLOCKED", "OUT_OF_SCOPE", "INVALID_INPUT", "FAILED", "BUDGET_EXHAUSTED"];
  for (const status of statuses) {
    const t = setup(raw(status, `text ${status}`));
    const first = await runCoachTurn(input(), t.deps);
    const retry = await runCoachTurn(input(), t.deps);
    for (const r of [first, retry]) {
      assert.equal(r.handler, "v2", status);
      if (r.handler !== "v2") return;
      assert.equal(r.status, status); assert.equal(r.answer, `text ${status}`); assert.equal(r.historyRecorded, false); assert.equal(r.fallbackAllowed, false);
      assert.equal(r.sessionId, undefined, "no session is exposed for a turn that was not persisted");
    }
    assert.equal(retry.handler === "v2" && retry.replayed, true, status);
    assert.equal(t.calls.length, 1, status);
    assert.equal(t.h.turns.length + t.h.sessions.size, 0, `${status}: nothing may be written to history`);
  }
});

test("PARTIAL: not written by default (open decision D-P12); written once when persistPartial is set; retry never duplicates", async () => {
  const off = setup(raw("PARTIAL"));
  const r0 = await runCoachTurn(input(), off.deps);
  assert.equal(r0.handler === "v2" && r0.kind, "partial");
  assert.equal(off.h.turns.length, 0);
  const on = setup(raw("PARTIAL"), { persistPartial: true });
  const r1 = await runCoachTurn(input(), on.deps);
  await runCoachTurn(input(), on.deps);
  assert.equal(r1.handler === "v2" && r1.historyRecorded, true);
  assert.equal(on.h.turns.length, 1);
  assert.equal(on.calls.length, 1);
  assert.equal(shouldRecordHistory({ kind: "partial", answer: "x" }, false), false);
  assert.equal(shouldRecordHistory({ kind: "partial", answer: "x" }, true), true);
  assert.equal(shouldRecordHistory({ kind: "answered", answer: "  " }, true), false, "an empty answer is never recorded");
  assert.equal(shouldRecordHistory({ kind: "answered", answer: "x", thrown: true }, true), false);
  assert.equal(shouldRecordHistory({ kind: "blocked", answer: "x" }, true), false);
  assert.equal(shouldRecordHistory({ kind: "unavailable", answer: "x" }, true), false);
});

test("error thrown mid-turn: key becomes IN_DOUBT — no V1, no history, V2 is never run a second time for it", async () => {
  const t = setup(async () => { throw new Error("boom"); });
  const first = await runCoachTurn(input(), t.deps);
  assert.equal(first.handler === "v2" && first.kind, "unavailable");
  assert.equal(first.handler === "v2" && first.answer, "");
  const retry = await runCoachTurn(input(), t.deps);
  assert.deepEqual(retry, { handler: "boundary", outcome: "IN_DOUBT", fallbackAllowed: false });
  assert.equal(t.calls.length, 1);
  assert.equal(t.h.turns.length + t.h.sessions.size, 0);
  // a NEW action (new key) is a new attempt
  const t2 = setup(raw("ANSWERED"));
  t2.s.recs.set(t2.s.key("user-1", "req-00000001"), { state: "IN_DOUBT", fingerprint: coachActionFingerprint(input()) });
  assert.equal(((await runCoachTurn(input(), t2.deps)) as { outcome?: string }).outcome, "IN_DOUBT");
  assert.equal(await runCoachTurn(input({ clientRequestId: "req-00000009" }), t2.deps).then((r) => r.handler), "v2");
});

test("FAIL CLOSED: a store that cannot guarantee idempotency never lets V2 or V1 run", async () => {
  const down = setup(raw("ANSWERED"), {}, { failClaim: true });
  assert.deepEqual(await runCoachTurn(input(), down.deps), { handler: "boundary", outcome: "STORE_UNAVAILABLE", fallbackAllowed: false });
  assert.equal(down.calls.length, 0);
  const corrupt = setup(raw("ANSWERED"), {}, { corrupt: true });
  await corrupt.s.store.claim("user-1", "req-00000001", "fp"); // pre-existing record, then a corrupt read
  assert.equal(((await runCoachTurn(input(), corrupt.deps)) as { outcome?: string }).outcome, "STORE_UNAVAILABLE");
  assert.equal(corrupt.calls.length, 0);
  const histDown = setup(raw("ANSWERED"), {}, {}, { failFind: true });
  assert.equal(((await runCoachTurn(input({ sessionId: "11111111-1111-4111-8111-111111111111" }), histDown.deps)) as { outcome?: string }).outcome, "STORE_UNAVAILABLE");
  assert.equal(histDown.calls.length, 0);
  // V2 ran but the result could not be recorded: the answer is withheld, the key stays unretryable (V2 is never re-run)
  const noComplete = setup(raw("ANSWERED"), {}, { failComplete: true });
  const r = await runCoachTurn(input(), noComplete.deps);
  assert.deepEqual(r, { handler: "boundary", outcome: "STATE_RECORD_FAILED", fallbackAllowed: false });
  assert.equal(((await runCoachTurn(input(), noComplete.deps)) as { outcome?: string }).outcome, "IN_PROGRESS");
  assert.equal(noComplete.calls.length, 1);
  assert.equal(noComplete.h.turns.length, 0);
});

test("history write failure: answer withheld, nothing duplicated; retrying the SAME key re-drives the write once without re-running V2", async () => {
  const t = setup(raw("ANSWERED"), {}, {}, { failCreateTurnTimes: 1 });
  const first = await runCoachTurn(input(), t.deps);
  assert.deepEqual(first, { handler: "boundary", outcome: "HISTORY_UNAVAILABLE", fallbackAllowed: false });
  assert.equal(t.h.turns.length, 0);
  const retry = await runCoachTurn(input(), t.deps);
  assert.equal(retry.handler, "v2");
  assert.equal(retry.handler === "v2" && retry.replayed && retry.historyRecorded, true);
  assert.equal(t.calls.length, 1);
  assert.equal(t.h.turns.length, 1);
  assert.equal(t.h.sessions.size, 1);
  await runCoachTurn(input(), t.deps);
  assert.equal(t.h.turns.length, 1);
});

test("history idempotency on (user, key): an existing equal turn is not duplicated; a different one under the same key is a conflict", async () => {
  const eq = setup(raw("ANSWERED"));
  eq.h.turns.push({ id: "pre", userId: "user-1", sessionId: "00000000-0000-4000-8000-000000000001", clientRequestId: "req-00000001", question: "Tuần này tôi nên tập gì?", answer: "x", modelUsed: V2_ENGINE_MARKER, responseTime: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, usedFallback: false, usedDeterministicFallback: false, warningCount: 0 });
  const r = await runCoachTurn(input(), eq.deps);
  assert.equal(r.handler === "v2" && r.historyRecorded, true);
  assert.equal(eq.h.turns.length, 1);
  const diff = setup(raw("ANSWERED"));
  diff.h.turns.push({ ...eq.h.turns[0], question: "câu khác" });
  assert.equal(((await runCoachTurn(input(), diff.deps)) as { outcome?: string }).outcome, "HISTORY_UNAVAILABLE");
  assert.equal(diff.h.turns.length, 1);
});

test("conversation affinity: V1 history stays on V1, V2-only history continues on V2 (turns accumulate in one session), empty session is V2", async () => {
  const t = setup(raw("ANSWERED"));
  const first = await runCoachTurn(input(), t.deps);
  const sid = first.handler === "v2" ? first.sessionId! : "";
  const second = await runCoachTurn(input({ clientRequestId: "req-00000002", question: "Còn bữa ăn thì sao?", sessionId: sid }), t.deps);
  assert.equal(second.handler === "v2" && second.sessionId, sid);
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1].sessionId, sid);
  assert.deepEqual(t.h.turns.map((x) => [x.sessionId, x.question]), [[sid, "Tuần này tôi nên tập gì?"], [sid, "Còn bữa ăn thì sao?"]]);
  // a V1 turn appears in the session → from now on V1
  t.h.legacyEngines.set(sid, ["some-v1-model"]);
  const v1 = await runCoachTurn(input({ clientRequestId: "req-00000003", question: "tiếp", sessionId: sid }), t.deps);
  assert.deepEqual(v1, { handler: "v1", reason: "SESSION_ON_V1", v2Attempted: false });
  assert.equal(t.calls.length, 2);
  assert.equal(t.s.recs.has(t.s.key("user-1", "req-00000003")), false, "no claim for a request that stays on V1");
  // an existing but still empty session (e.g. created by V1 whose turn failed) is eligible
  const e = setup(raw("ANSWERED"));
  e.h.sessions.set("22222222-2222-4222-8222-222222222222", { id: "22222222-2222-4222-8222-222222222222", userId: "user-1", archivedAt: null });
  const r = await runCoachTurn(input({ sessionId: "22222222-2222-4222-8222-222222222222" }), e.deps);
  assert.equal(r.handler, "v2");
  assert.equal(e.h.sessions.size, 1, "an existing session is reused, not duplicated");
  assert.equal(e.h.turns.length, 1);
});

test("V2 that provably did not start (DISABLED / V2NotStartedError): hand over to V1 and free the claim; nothing is written", async () => {
  for (const mk of [() => raw("DISABLED"), () => { throw new V2NotStartedError(); }]) {
    const t = setup(async () => mk());
    const r = await runCoachTurn(input(), t.deps);
    assert.deepEqual(r, { handler: "v1", reason: "V2_NOT_STARTED", v2Attempted: true });
    assert.equal(t.s.recs.size, 0, "claim released");
    assert.equal(t.h.turns.length + t.h.sessions.size, 0);
  }
  const stuck = setup(raw("DISABLED"), {}, { failRelease: true });
  assert.equal((await runCoachTurn(input(), stuck.deps)).handler, "v1", "a failed release must not block the V1 hand-off");
});

test("no external network and no user data leaves the process: identical behaviour with fetch / sockets forbidden", async () => {
  const realFetch = globalThis.fetch; const realConnect = net.Socket.prototype.connect; let attempts = 0;
  globalThis.fetch = (() => { attempts++; throw new Error("network forbidden"); }) as typeof fetch;
  net.Socket.prototype.connect = function () { attempts++; throw new Error("network forbidden"); } as typeof net.Socket.prototype.connect;
  try {
    const t = setup(raw("ANSWERED"));
    assert.equal((await runCoachTurn(input(), t.deps)).handler, "v2");
    assert.equal(attempts, 0);
  } finally { globalThis.fetch = realFetch; net.Socket.prototype.connect = realConnect; }
});

test("trace carries codes only", async () => {
  const events: unknown[] = [];
  const t = setup(raw("ANSWERED"), { trace: (e) => events.push(e) });
  await runCoachTurn(input({ userId: "secret-user", question: "câu hỏi riêng tư" }), t.deps);
  assert.doesNotMatch(JSON.stringify(events), /secret-user|riêng tư/);
});

// ── static pins for the new module ───────────────────────────────────────────────────────────────────────────────────────
test("continuity module: ports only — no DB / cache / network client, no agent-v2 import, no V2 flag, no in-memory store shipped, used only by the HTTP boundary", () => {
  const src = fs.readFileSync(path.join(SRC, "services", "coach-v2-continuity.ts"), "utf8");
  assert.doesNotMatch(src, /from\s+["'][^"']*agent-v2|require\(\s*["'][^"']*agent-v2|import\(\s*["'][^"']*agent-v2/);
  assert.ok(!src.includes("AI_AGENT_V2"));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const imports = [...code.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./coach-v2-bridge", "node:crypto"]);
  assert.doesNotMatch(code, /prisma|axios|fetch\(|requestService|redis|dynamodb|Bedrock|setInterval\(|new Map\(|createInMemory/i);
  const referrers: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["node_modules", "generated", "dist", "__tests__"].includes(e.name)) walk(p); } else if (/\.ts$/.test(e.name) && /coach-v2-continuity|runCoachTurn/.test(fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))) referrers.push(path.relative(SRC, p)); } };
  walk(SRC);
  assert.deepEqual(referrers.sort(), [path.join("services", "coach-bridge.middleware.ts"), path.join("services", "coach-v2-continuity.ts")], "only the HTTP boundary uses it");
});

test("V1 idempotency / history code is untouched by this task (request-identity, rag.service, conversation repository, ask schema, controller, session routes; ai.routes.ts is pinned in coach-v2-route-http.test.ts)", () => {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const root = path.resolve(SRC, "..", "..", "..", "..");
  const files = ["services/request-identity.ts", "services/rag.service.ts", "repositories/conversation.repository.ts", "schemas/ai.schemas.ts", "controllers/ai.controller.ts", "routes/session.routes.ts"]
    .map((f) => `backend/services/ai-service/src/${f}`);
  const diff = execFileSync("git", ["diff", "--name-only", "a6b517cd", "HEAD", "--", ...files], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(diff, "");
});
