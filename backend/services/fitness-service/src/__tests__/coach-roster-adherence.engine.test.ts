/**
 * Phase 4 (PT Copilot, step 1) — pure rules of the roster adherence read. No DB, no model. Every status/signal must be explainable by
 * the evidence string it carries, and "no data" must never be turned into a verdict.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRosterClient, sortRosterRows, summarizeRoster, ROSTER_THRESHOLDS, type RosterClientInput } from "../services/coach-roster-adherence.engine";

const asOf = new Date("2026-10-20T12:00:00Z");
type Over = { clientUserId?: string; windowDays?: number; workout?: Partial<RosterClientInput["workout"]>; nutrition?: Partial<RosterClientInput["nutrition"]> };
const base = (over: Over = {}): RosterClientInput => ({
  clientUserId: over.clientUserId ?? "c1", windowDays: over.windowDays ?? 14, asOf,
  workout: { scheduled: 0, completed: 0, partiallyCompleted: 0, skipped: 0, lastCompletedAt: null, ...(over.workout ?? {}) },
  nutrition: { hasActiveProgram: false, completedMeals: 0, partialMeals: 0, skippedMeals: 0, logDays: 0, lastLogDate: null, ...(over.nutrition ?? {}) },
});
const daysAgo = (n: number) => new Date(asOf.getTime() - n * 86_400_000);

test("adherence uses the existing definition: completed / scheduled; null (not 0%, not 100%) when nothing was scheduled", () => {
  assert.equal(evaluateRosterClient(base({ workout: { scheduled: 8, completed: 6, lastCompletedAt: daysAgo(1) } })).workout.adherencePercent, 75);
  assert.equal(evaluateRosterClient(base()).workout.adherencePercent, null);
  const none = evaluateRosterClient(base());
  assert.equal(none.status, "NO_DATA", "nothing to judge -> NO_DATA, never ON_TRACK or AT_RISK");
  assert.deepEqual(none.dataGaps, ["NO_SCHEDULED_SESSIONS", "NO_ACTIVE_NUTRITION_PROGRAM"]);
  assert.deepEqual(none.signals, []);
});

test("AT_RISK: zero completed of >=2 scheduled; low adherence (<50%) with >=3 scheduled — each with its own evidence", () => {
  const zero = evaluateRosterClient(base({ workout: { scheduled: 3, completed: 0, skipped: 3 } }));
  assert.equal(zero.status, "AT_RISK");
  assert.deepEqual(zero.signals.map((s) => s.code), ["NO_COMPLETED_SESSIONS"]);
  assert.match(zero.signals[0].evidence, /Chưa hoàn thành buổi nào trong 3 buổi/);
  const low = evaluateRosterClient(base({ workout: { scheduled: 6, completed: 2, lastCompletedAt: daysAgo(3) } }));
  assert.equal(low.status, "AT_RISK");
  assert.equal(low.signals[0].code, "LOW_ADHERENCE");
  assert.match(low.signals[0].evidence, /2\/6 buổi \(≈33%\)/);
});

test("NEEDS_ATTENTION: moderate adherence (50-79%) and long inactivity; ON_TRACK at >=80% with nothing else", () => {
  assert.equal(evaluateRosterClient(base({ workout: { scheduled: 4, completed: 3, lastCompletedAt: daysAgo(2) } })).signals[0].code, "MODERATE_ADHERENCE");
  assert.equal(evaluateRosterClient(base({ workout: { scheduled: 4, completed: 3, lastCompletedAt: daysAgo(2) } })).status, "NEEDS_ATTENTION");
  const inactive = evaluateRosterClient(base({ workout: { scheduled: 5, completed: 5, lastCompletedAt: daysAgo(11) } }));
  assert.deepEqual(inactive.signals.map((s) => s.code), ["INACTIVE_WORKOUT"]);
  assert.match(inactive.signals[0].evidence, /cách đây 11 ngày/);
  const good = evaluateRosterClient(base({ workout: { scheduled: 5, completed: 4, lastCompletedAt: daysAgo(1) } }));
  assert.equal(good.status, "ON_TRACK");
  assert.deepEqual(good.signals, []);
});

test("small samples are not judged: <3 scheduled with some completions raises no adherence verdict", () => {
  const r = evaluateRosterClient(base({ workout: { scheduled: 2, completed: 1, lastCompletedAt: daysAgo(1) } }));
  assert.deepEqual(r.signals, []);
  assert.equal(r.status, "ON_TRACK", "one judged domain without concerns");
  assert.equal(r.workout.adherencePercent, 50);
});

test("nutrition: not logged / skipping are signals ONLY when a program exists; no program is a data gap, not a failure", () => {
  const notLogged = evaluateRosterClient(base({ workout: { scheduled: 5, completed: 5, lastCompletedAt: daysAgo(1) }, nutrition: { hasActiveProgram: true } }));
  assert.deepEqual(notLogged.signals.map((s) => s.code), ["NUTRITION_NOT_LOGGED"]);
  assert.deepEqual(notLogged.dataGaps, ["NO_NUTRITION_LOGS"]);
  assert.equal(notLogged.status, "NEEDS_ATTENTION");
  const noProgram = evaluateRosterClient(base({ workout: { scheduled: 5, completed: 5, lastCompletedAt: daysAgo(1) } }));
  assert.deepEqual(noProgram.signals, []);
  assert.deepEqual(noProgram.dataGaps, ["NO_ACTIVE_NUTRITION_PROGRAM"]);
  const skipping = evaluateRosterClient(base({ nutrition: { hasActiveProgram: true, completedMeals: 3, skippedMeals: 7, logDays: 4 } }));
  assert.deepEqual(skipping.signals.map((s) => s.code), ["NUTRITION_SKIPPING"]);
  assert.match(skipping.signals[0].evidence, /Bỏ 7\/10 bữa/);
  const fewLogged = evaluateRosterClient(base({ nutrition: { hasActiveProgram: true, completedMeals: 1, skippedMeals: 3, logDays: 2 } }));
  assert.deepEqual(fewLogged.signals, [], "too few logged meals to judge skipping");
  assert.equal(fewLogged.status, "ON_TRACK");
});

test("a 7-day nutrition window is judged; a window shorter than the threshold is not", () => {
  assert.equal(ROSTER_THRESHOLDS.nutritionWindowDaysToJudge, 7);
  assert.deepEqual(evaluateRosterClient(base({ windowDays: 7, nutrition: { hasActiveProgram: true } })).signals.map((s) => s.code), ["NUTRITION_NOT_LOGGED"]);
});

test("sorting puts the clients who need attention first, lowest adherence first, stable by id; summary counts every status", () => {
  const rows = [
    evaluateRosterClient(base({ clientUserId: "ok", workout: { scheduled: 5, completed: 5, lastCompletedAt: daysAgo(1) } })),
    evaluateRosterClient(base({ clientUserId: "empty" })),
    evaluateRosterClient(base({ clientUserId: "risk-b", workout: { scheduled: 4, completed: 1, lastCompletedAt: daysAgo(2) } })),
    evaluateRosterClient(base({ clientUserId: "risk-a", workout: { scheduled: 5, completed: 1, lastCompletedAt: daysAgo(2) } })),
    evaluateRosterClient(base({ clientUserId: "mid", workout: { scheduled: 4, completed: 3, lastCompletedAt: daysAgo(2) } })),
  ];
  assert.deepEqual(sortRosterRows(rows).map((r) => r.clientUserId), ["risk-a", "risk-b", "mid", "empty", "ok"]);
  assert.deepEqual(summarizeRoster(rows), { totalClients: 5, AT_RISK: 2, NEEDS_ATTENTION: 1, ON_TRACK: 1, NO_DATA: 1 });
});

test("the evaluation never mutates its input and is deterministic", () => {
  const input = base({ workout: { scheduled: 6, completed: 2, lastCompletedAt: daysAgo(3) } });
  const snapshot = JSON.stringify(input);
  const a = evaluateRosterClient(input), b = evaluateRosterClient(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(a, b);
});
