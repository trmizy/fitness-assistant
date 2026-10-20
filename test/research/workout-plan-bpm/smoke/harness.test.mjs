// SMOKE / HARNESS TESTS (no stack required). Run: node --test test/research/workout-plan-bpm/smoke/harness.test.mjs
// Evidence label: TEST FIXTURE (stateful fake database and fake HTTP) for the runner's own logic. Not application behaviour.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJsonl, appendJsonl } from "../lib/evidence.mjs";
import { percentile, summarizeLatency, scoreTurn, aggregate, pairedAnalysis } from "../lib/metrics.mjs";
import { parseOllamaGin, parseJsonLines, observeTurn, parseGoDuration } from "../lib/observe.mjs";
import { digest, assertTestOnly, diffSnapshots } from "../lib/db-snapshot.mjs";
import { runCase, loadState, readDataset, ContaminationStop, errorCaseRecord } from "../run-frozen-150.mjs";

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "gymini-harness-tests-"));
const FAMILY = new Map([["START_WORKFLOW", "WORKFLOW"], ["CONFIRM", "CONFIRMATION_BOUNDARY"], ["UNKNOWN", "UNKNOWN"], ["KNOWLEDGE_QA", "KNOWLEDGE"], ["CANCEL", "WORKFLOW"]]);
const DATASET = readDataset();
const spec = (id) => DATASET.find((c) => c.case_id === id);

/** Stateful fake of the TEST databases, scoped per user, plus a fake HTTP/log layer. */
function fakeStack({ logLines = () => "", sayError = null, crossUser = 0 } = {}) {
  const db = new Map(); // userId -> {actions, workflows, programs}
  const rowsOf = (uid) => (db.get(uid) ?? db.set(uid, { actions: [], workflows: [], programs: [] }).get(uid));
  const sorted = (a) => [...a].map((x) => ({ ...x })).sort((x, y) => (x.id < y.id ? -1 : 1));
  const deps = {
    registerUser: async (email) => ({ userId: crypto.randomUUID(), token: "fake", email }),
    seedFixture: async (u, f) => ({ fixtureId: f, putStatus: 200 }),
    snapshot: async (uid) => {
      const r = rowsOf(uid);
      const actions = sorted(r.actions), workflows = sorted(r.workflows), programs = sorted(r.programs), profile = [];
      return { userId: uid, actions, workflows, programs, profile, crossUserRows: crossUser, digests: { actions: digest(actions), workflows: digest(workflows), programs: digest(programs), profile: digest(profile) } };
    },
    say: async (u, text, sid) => {
      if (sayError) throw Object.assign(new Error("aborted by timeout"), { name: sayError });
      const r = rowsOf(u.userId);
      const sess = sid ?? "11111111-1111-4111-8111-111111111111";
      const traceId = `trace-${crypto.randomUUID()}`;
      if (/Tạo lịch/.test(text)) {
        const id = crypto.randomUUID();
        r.actions.push({ id, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", status: "PENDING", sessionId: sess, updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() });
        r.workflows.push({ id: crypto.randomUUID(), workflowType: "CREATE_WORKOUT_PLAN", status: "AWAITING_SLOT_CONFIRMATION", sessionId: sess, expectedSlot: null, slotsJson: { daysPerWeek: { value: 4 }, sessionMinutes: { value: 60 } }, pendingProfileUpdate: false, revision: 0 });
        deps._lastTrace = { traceId, route: "START_WORKFLOW", workflow: "CREATE_WORKOUT_PLAN", deterministicRoute: "START_WORKFLOW", llmCalled: false };
      } else {
        deps._lastTrace = { traceId, route: "UNKNOWN", workflow: null, deterministicRoute: "UNKNOWN", llmCalled: false };
      }
      deps._logs = [{ msg: "ci_global_trace", correlationId: traceId, time: Date.now(), ...deps._lastTrace }];
      return { status: 200, ms: 7, data: { traceId, sessionId: sess }, answer: "ok", sessionId: sess };
    },
    latestPendingAction: async (uid, sid) => {
      const a = rowsOf(uid).actions.filter((x) => x.status === "PENDING" && x.sessionId === sid).at(-1);
      return a ? a.id : null;
    },
    confirm: async (u, id) => {
      const r = rowsOf(u.userId);
      r.actions.find((x) => x.id === id).status = "COMPLETED";
      r.programs.push({ id: crypto.randomUUID(), status: "ACTIVE", agentActionId: id, sourcePlanId: null });
      r.workflows.forEach((w) => (w.status = "COMPLETED"));
      return { status: 200, ms: 4 };
    },
    dismiss: async (u, id) => { rowsOf(u.userId).actions.find((x) => x.id === id).status = "CANCELLED"; return { status: 200, ms: 4 }; },
    aiLogsSince: async () => (deps._logs ?? []).map((l) => JSON.stringify(l)).join("\n") + "\n" + logLines(),
    ollamaLogsSince: async () => "",
    ollamaOffsetMinutes: 0,
  };
  return deps;
}

test("percentile uses nearest-rank and never returns 0 for an empty sample", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 90), 5);
  assert.equal(percentile([], 50), null);
  assert.deepEqual(summarizeLatency([10, 20]).p50, 10);
});

test("W001 (START_WORKFLOW -> CONFIRM_LAST_ACTION) through the observation path is fully correct and writes exactly once", async () => {
  const deps = fakeStack();
  const rec = await runCase({ spec: spec("W001"), config: "B", attempt: 1, runId: "T1", familyOf: FAMILY, deps });
  assert.equal(rec.status, "COMPLETED");
  assert.equal(rec.turns[0].observed.route, "START_WORKFLOW");
  assert.equal(rec.turns[0].observed.write, "PENDING_ONLY");
  assert.equal(rec.turns[0].observed.endState, "IN_PROGRESS");
  assert.equal(rec.turns[1].observed.write, "AUTHORIZED_WRITE");
  assert.equal(rec.turns[1].observed.endState, "END_A");
  assert.equal(rec.duplicateWriteInfo.duplicateWrite, 0);
  assert.equal(rec.caseCorrect, true);
  assert.equal(rec.isolation.baselineRows, 0, "fresh user must start with zero observed rows");
});

test("isolation X -> X+1: the second case's user starts empty even though the first case wrote rows", async () => {
  const deps = fakeStack();
  const a = await runCase({ spec: spec("W001"), config: "B", attempt: 1, runId: "T2", familyOf: FAMILY, deps });
  const b = await runCase({ spec: spec("W002"), config: "B", attempt: 1, runId: "T2", familyOf: FAMILY, deps });
  assert.notEqual(a.userId, b.userId);
  assert.equal(b.isolation.baselineRows, 0);
  assert.equal(b.isolation.crossUserRows, 0);
});

test("a cross-user row in any snapshot is a hard isolation violation, never silently scored", async () => {
  const deps = fakeStack({ crossUser: 1 });
  await assert.rejects(runCase({ spec: spec("W001"), config: "B", attempt: 1, runId: "T3", familyOf: FAMILY, deps }), /ISOLATION_VIOLATION/);
});

test("HTTP timeout is recorded, stays in the denominator, and makes the case incorrect", async () => {
  const deps = fakeStack({ sayError: "TimeoutError" });
  const rec = await runCase({ spec: spec("W001"), config: "B", attempt: 1, runId: "T4", familyOf: FAMILY, deps });
  assert.equal(rec.turns[0].http.timedOut, true);
  assert.ok(rec.caseErrors.some((e) => e.reason === "HTTP_TIMEOUT"));
  assert.equal(rec.turnScores.length, spec("W001").turns.length, "timed-out turns still count in the denominator");
  assert.equal(rec.caseCorrect, false);
});

test("Config A stops on any typed semantic-fallback event (contamination guard)", async () => {
  const deps = fakeStack({ logLines: () => "" });
  // Force an LLM-called trace for the first TEXT turn.
  const origSay = deps.say;
  deps.say = async (...args) => { const r = await origSay(...args); deps._logs = deps._logs.map((l) => ({ ...l, llmCalled: true })); return r; };
  await assert.rejects(runCase({ spec: spec("W001"), config: "A", attempt: 1, runId: "T5", familyOf: FAMILY, deps }), (e) => e instanceof ContaminationStop);
});

test("a write on a TEXT turn is a confirmation bypass and an unauthorized write when the gold says NO_WRITE", () => {
  const gold = { route: "UNKNOWN", route_family: "UNKNOWN", intent: null, write: "NO_WRITE", slots: {}, end_state: null };
  const s = scoreTurn({ gold, action: "TEXT", obs: { route: "UNKNOWN", write: "AUTHORIZED_WRITE", persistedWorkout: true, persistedWorkoutCount: 1 }, familyOf: FAMILY });
  assert.equal(s.unauthorizedWrite, true);
  assert.equal(s.confirmationBypass, true);
  assert.equal(s.turnCorrect, false);
});

test("control turns are excluded from route accuracy but included in write accuracy", () => {
  const gold = { route: "CONFIRM", route_family: "CONFIRMATION_BOUNDARY", intent: "CONFIRM", write: "AUTHORIZED_WRITE", slots: {}, end_state: "END_A" };
  const s = scoreTurn({ gold, action: "CONFIRM_LAST_ACTION", obs: { route: null, write: "AUTHORIZED_WRITE", persistedWorkout: true, endState: "END_A" }, familyOf: FAMILY });
  assert.equal(s.routeCorrect, null);
  assert.equal(s.writeCorrect, true);
  assert.equal(s.isText, false);
});

test("an errored case keeps every gold turn in the aggregate denominator", () => {
  const s = spec("W001");
  const rec = errorCaseRecord({ spec: s, config: "B", attempt: 1, reason: "REGISTRATION_INCOMPLETE", familyOf: FAMILY });
  const agg = aggregate([{ ...rec, status: "ERROR" }]);
  assert.equal(agg.turnsTotal, s.turns.length);
  assert.equal(agg.casesCorrect, 0);
});

test("interrupted attempt is detected on resume; a checkpointed case is not re-run", () => {
  const dir = path.join(SCRATCH, `resume-${Date.now()}`);
  fs.mkdirSync(path.join(dir, "config-B"), { recursive: true });
  appendJsonl(path.join(dir, "config-B", "attempts.jsonl"), { config: "B", case_id: "W001", attempt: 1, status: "STARTED" });
  let st = loadState(dir, "B");
  assert.deepEqual([...st.done], []);
  assert.equal(st.interrupted.length, 1, "STARTED without terminal row = interrupted");
  appendJsonl(path.join(dir, "config-B", "checkpoint.jsonl"), { config: "B", case_id: "W001", attempt: 2, status: "COMPLETED" });
  appendJsonl(path.join(dir, "config-B", "attempts.jsonl"), { config: "B", case_id: "W001", attempt: 2, status: "COMPLETED" });
  st = loadState(dir, "B");
  assert.ok(st.done.has("W001"));
  assert.equal(st.interrupted.length, 0);
});

test("partial last JSONL line (crash mid-append) is tolerated and reported", () => {
  const f = path.join(SCRATCH, `partial-${Date.now()}.jsonl`);
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(f, '{"a":1}\n{"a":2}\n{"a":');
  const r = readJsonl(f);
  assert.equal(r.rows.length, 2);
  assert.equal(r.partialTail, true);
});

test("Ollama GIN lines parse to paths and durations (µs, ms, s)", () => {
  const text = [
    '[GIN] 2026/10/03 - 05:52:16 | 200 |   1.5s | 127.0.0.1 | POST     "/api/chat"',
    '[GIN] 2026/10/03 - 05:52:17 | 200 |  250.0ms | 127.0.0.1 | POST     "/api/embed"',
    '[GIN] 2026/10/03 - 05:52:18 | 200 |  900µs | 127.0.0.1 | GET     "/api/tags"',
  ].join("\n");
  const calls = parseOllamaGin(text, 0);
  assert.deepEqual(calls.map((c) => c.path), ["/api/chat", "/api/embed", "/api/tags"]);
  assert.equal(calls[0].durationMs, 1500);
  assert.equal(calls[2].durationMs, 0.9);
});

test("observation ignores non-JSON framework lines and reports UNOBSERVED without a trace", () => {
  const events = parseJsonLines("tsx watch restarted\n{\"msg\":\"ci_global_trace\",\"correlationId\":\"x\",\"route\":\"KNOWLEDGE_QA\"}\n");
  assert.equal(events.length, 1);
  const obs = observeTurn({ aiEvents: events, traceId: null, t0: 0, t1: 1, ollamaCalls: [] });
  assert.equal(obs.route, "UNOBSERVED");
});

test("safety guard: test-only databases and UUID-only user scoping", () => {
  assert.equal(assertTestOnly(), true);
  const d = diffSnapshots({ actions: [], workflows: [], programs: [], digests: { profile: "p" } }, { actions: [{ id: "a", status: "PENDING", kind: "k" }], workflows: [], programs: [], digests: { profile: "p" } });
  assert.equal(d.newActions.length, 1);
  assert.equal(d.profileChanged, false);
});

test("paired analysis separates the four cells and does not drop unpaired cases silently", () => {
  const a = [{ case_id: "W1", category: "C", status: "COMPLETED", caseCorrect: false }, { case_id: "W2", category: "C", status: "COMPLETED", caseCorrect: true }, { case_id: "W3", category: "C", status: "COMPLETED", caseCorrect: true }];
  const b = [{ case_id: "W1", category: "C", status: "COMPLETED", caseCorrect: true }, { case_id: "W2", category: "C", status: "COMPLETED", caseCorrect: false }, { case_id: "W3", category: "C", status: "ERROR", caseCorrect: false }];
  const p = pairedAnalysis(a, b);
  assert.deepEqual(p.cells["A wrong→B correct"].caseIds, ["W1"]);
  assert.deepEqual(p.cells["A correct→B wrong"].caseIds, ["W2"]);
  assert.deepEqual(p.unpaired, ["W3"]);
});

test("Go-style compound durations parse; slow (>=1 min) calls are NOT dropped (regression for the 2m50s parser defect)", () => {
  assert.equal(parseGoDuration("2m50s"), 170000);
  assert.equal(parseGoDuration("1h2m3.5s"), 3723500);
  assert.equal(parseGoDuration("250ms"), 250);
  assert.equal(parseGoDuration("900µs"), 0.9);
  assert.equal(parseGoDuration("12x"), null, "unknown unit must not be guessed");
  const slow = '[GIN] 2026/10/03 - 06:27:03 | 500 |         2m50s |      172.18.0.1 | POST     "/api/chat"';
  const calls = parseOllamaGin(slow, 0);
  assert.equal(calls.length, 1, "a 2m50s /api/chat line must be parsed, not silently dropped");
  assert.equal(calls[0].durationMs, 170000);
  assert.equal(calls[0].status, 500);
});

test("Ollama embeddings endpoint is classified as embedding, not generation", () => {
  const calls = parseOllamaGin('[GIN] 2026/10/03 - 06:24:22 | 200 |  245.480722ms |      172.18.0.1 | POST     "/api/embeddings"', 0);
  const obs = observeTurn({ aiEvents: [], traceId: null, t0: Date.UTC(2026, 9, 3, 6, 24, 21), t1: Date.UTC(2026, 9, 3, 6, 24, 30), ollamaCalls: calls });
  assert.equal(obs.embedCalls, 1);
  assert.equal(obs.qwenChatCalls, 0);
});

test("Config A guard stops on a Qwen generation call even when NO CI semantic-fallback event exists", async () => {
  const deps = fakeStack();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const gin = `[GIN] ${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())} - ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} | 500 |         2m50s |      172.18.0.1 | POST     "/api/chat"`;
  deps.ollamaLogsSince = async () => gin;
  await assert.rejects(runCase({ spec: spec("W001"), config: "A", attempt: 1, runId: "T6", familyOf: FAMILY, deps }), (e) => e instanceof ContaminationStop && /Qwen invocation/.test(e.message) && e.detail.qwenChatCalls === 1);
});
