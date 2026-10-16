/**
 * Phase 4.1 — CoachStateV0.training (docs/ai-product/phase4-1-training-coach-state.md).
 * Unit-level: stubs axios.get at the HTTP boundary (training reader) and
 * profileExtractor.extract (goal). 0 LLM calls are possible here: nothing in
 * the path imports an LLM client.
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { profileExtractor } from "../llm/profile_extractor";
import { getTrainingAnalytics } from "../services/enterprise-data/training.reader";
import { assembleContext } from "../services/context-assembler";
import { buildCoachStateV0, getCoachStateV0 } from "../services/coach-state/coach-state";
import type { TrainingAnalyticsWindow } from "../services/enterprise-data/types";

const originalGet = axios.get;
const originalExtract = profileExtractor.extract;
test.afterEach(() => {
  axios.get = originalGet;
  profileExtractor.extract = originalExtract;
});

const q = (dataQuality: any) => dataQuality;

function window(over: Partial<TrainingAnalyticsWindow> = {}): TrainingAnalyticsWindow {
  return {
    period: { from: "2026-09-13T00:00:00.000Z", to: "2026-10-10T12:00:00.000Z", days: 28 },
    adherence: { state: "MEASURED", scheduledSessions: 12, completedSessions: 9, missedSessions: 3, completionRate: 0.75, dataQuality: q("SUFFICIENT") },
    frequency: { completedPerWeek: 2.3, scheduledPerWeek: 3, trainingDaysLogged: 9, weeklyVolumeConsistency: 0.8, dataQuality: q("SUFFICIENT") },
    volume: { totalVolumeLoadKg: 12000, byMuscleGroupKg: { chest: 5000 }, byWeek: [], volumeTrendPercent: 5, completedSetCount: 90, loadedSetCount: 88, dataQuality: q("SUFFICIENT") },
    progression: {
      exercises: [{ exerciseId: "ex-bench", exerciseName: "Bench Press", baselineE1rmKg: 100, currentE1rmKg: 105, changePct: 5, weeksObserved: 4, dataQuality: q("SUFFICIENT") }],
      dataQuality: q("SUFFICIENT"),
    },
    plateau: { status: "NOT_AVAILABLE", reason: "no standalone rolling-window classifier" },
    effort: {
      rpe: { observedSets: 10, totalCompletedSets: 90, weeklyAvg: [7, 8, 8, 8], trend: "stable", dataQuality: q("PARTIAL") },
      rir: { observedSets: 0, totalCompletedSets: 90, weeklyAvg: [], trend: null, dataQuality: q("NO_DATA") },
      sessionFeedback: { feedbackCount: 0, averageSessionRpe: 8, sessionRpeSource: "set_rpe_fallback", averagePainScore: null, recoveryScore: null, dataQuality: q("NO_DATA") },
    },
    signals: [],
    dataQuality: q("SUFFICIENT"),
    ...over,
  };
}

const identity = (id = "user-a") => ({ userId: id, authorizationHeader: `Bearer token-${id}` });

function stubGoal(goal: string | undefined) {
  profileExtractor.extract = (async () => ({
    profile: goal ? { goal } : {},
    inBodyHistory: [], workoutHistory: [], nutritionHistory: [],
  })) as any;
}

// ── reader ────────────────────────────────────────────────────────────────

test("reader: ok, forwards only the caller's Authorization (no userId param) and days", async () => {
  let seen: any;
  (axios as any).get = async (url: string, cfg: any) => { seen = { url, cfg }; return { data: window() }; };
  const r = await getTrainingAnalytics(identity("user-a"), { days: 28 });
  assert.equal(r.status, "ok");
  assert.match(seen.url, /\/stats\/training-window$/);
  assert.equal(seen.cfg.headers.Authorization, "Bearer token-user-a");
  assert.deepEqual(seen.cfg.params, { days: 28 });
  assert.ok(!("userId" in (seen.cfg.params ?? {})));
});

test("reader: upstream failure → error (NOT absent / NO_DATA / empty)", async () => {
  (axios as any).get = async () => { throw new Error("ECONNREFUSED"); };
  const r = await getTrainingAnalytics(identity());
  assert.equal(r.status, "error");
  assert.match((r as any).message, /ECONNREFUSED/);
});

test("reader: HTTP 500 → error; 404 → absent; malformed body → error", async () => {
  (axios as any).get = async () => { throw Object.assign(new Error("boom"), { response: { status: 500 } }); };
  assert.equal((await getTrainingAnalytics(identity())).status, "error");
  (axios as any).get = async () => { throw Object.assign(new Error("nf"), { response: { status: 404 } }); };
  assert.equal((await getTrainingAnalytics(identity())).status, "absent");
  (axios as any).get = async () => ({ data: { hello: "world" } });
  assert.equal((await getTrainingAnalytics(identity())).status, "error");
});

// ── assembler: demand-driven ──────────────────────────────────────────────

test("assembler: training analytics are fetched ONLY when TRAINING_COACH_STATE is requested", async () => {
  let calls = 0;
  (axios as any).get = async () => { calls++; return { data: window() }; };
  stubGoal("MUSCLE_GAIN");
  const none = await assembleContext(identity(), ["FITNESS_GOAL"]);
  assert.equal(calls, 0);
  assert.equal(none.trainingAnalytics, undefined);
  const withTraining = await assembleContext(identity(), ["TRAINING_COACH_STATE"], { trainingWindowDays: 14 });
  assert.equal(calls, 1);
  assert.equal(withTraining.trainingAnalytics?.status, "ok");
});

// ── CoachStateV0 ──────────────────────────────────────────────────────────

test("coach state: goal.type from the profile goal source; training passed through unchanged (no recomputation)", async () => {
  const w = window({ signals: [{ code: "TRAINING_ADHERENCE_LOW", basis: { completionPct: 40, thresholdPct: 60 } }] });
  (axios as any).get = async () => ({ data: w });
  stubGoal("WEIGHT_LOSS");
  const r = await getCoachStateV0(identity(), { days: 28, now: new Date("2026-10-10T12:00:00.000Z") });
  assert.equal(r.status, "ok");
  const s = (r as any).value;
  assert.equal(s.asOf, "2026-10-10T12:00:00.000Z");
  assert.deepEqual(s.goal, { type: "WEIGHT_LOSS" });
  assert.deepEqual(s.training.adherence, w.adherence);
  assert.deepEqual(s.training.progression, w.progression);
  assert.deepEqual(s.training.signals, w.signals);
  assert.equal(s.training.dataQuality, "SUFFICIENT");
  assert.equal(s.training.plateau.status, "NOT_AVAILABLE");
  // only goal + training exist in V0 — no placeholder nutrition/body/recovery fields
  assert.deepEqual(Object.keys(s).sort(), ["asOf", "goal", "training"]);
});

test("coach state: quality states survive mapping (NO_SCHEDULE / NO_DATA / STALE stay as-is)", async () => {
  const empty = window({
    adherence: { state: "NO_SCHEDULE", scheduledSessions: 0, completedSessions: 0, missedSessions: null, completionRate: null, dataQuality: q("NO_DATA") },
    dataQuality: q("STALE"),
    progression: { exercises: [], dataQuality: q("NO_DATA") },
  });
  (axios as any).get = async () => ({ data: empty });
  stubGoal(undefined);
  const r = await getCoachStateV0(identity());
  assert.equal(r.status, "ok");
  const s = (r as any).value;
  assert.equal(s.training.dataQuality, "STALE");
  assert.equal(s.training.adherence.state, "NO_SCHEDULE");
  assert.equal(s.training.adherence.completionRate, null);
  assert.equal(s.goal, undefined, "no goal in profile → goal omitted, not invented");
});

test("coach state: upstream training failure → AuthoritativeRead.error, never an empty/NO_DATA state", async () => {
  (axios as any).get = async () => { throw new Error("fitness down"); };
  stubGoal("MUSCLE_GAIN");
  const r = await getCoachStateV0(identity());
  assert.equal(r.status, "error");
  assert.ok(!("value" in r));
});

test("coach state: buildCoachStateV0 without the training read is an error, not an empty state", () => {
  const r = buildCoachStateV0({});
  assert.equal(r.status, "error");
});

test("cross-user: B's read carries B's credential and never contains A's metrics", async () => {
  const aWindow = window({
    progression: { exercises: [{ exerciseId: "ex-A-secret", exerciseName: "Secret Lift", baselineE1rmKg: 200, currentE1rmKg: 210, changePct: 5, weeksObserved: 4, dataQuality: q("SUFFICIENT") }], dataQuality: q("SUFFICIENT") },
  });
  const bWindow = window({
    adherence: { state: "NO_SCHEDULE", scheduledSessions: 0, completedSessions: 0, missedSessions: null, completionRate: null, dataQuality: q("NO_DATA") },
    volume: { totalVolumeLoadKg: 0, byMuscleGroupKg: {}, byWeek: [], volumeTrendPercent: null, completedSetCount: 0, loadedSetCount: 0, dataQuality: q("NO_DATA") },
    progression: { exercises: [], dataQuality: q("NO_DATA") },
    dataQuality: q("NO_DATA"),
  });
  (axios as any).get = async (_u: string, cfg: any) => ({
    data: cfg.headers.Authorization === "Bearer token-user-a" ? aWindow : bWindow,
  });
  stubGoal("MAINTENANCE");
  const a = await getCoachStateV0(identity("user-a"));
  const b = await getCoachStateV0(identity("user-b"));
  assert.ok(JSON.stringify(a).includes("ex-A-secret"));
  assert.ok(!JSON.stringify(b).includes("ex-A-secret"));
  assert.equal((b as any).value.training.dataQuality, "NO_DATA");
  assert.equal((b as any).value.training.volume.totalVolumeLoadKg, 0);
});
