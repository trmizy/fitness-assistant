/**
 * Phase 4.4 — CoachStateV0.body / CoachStateV0.goal expansion (docs/ai-product/phase4-4-body-goal-trajectory.md).
 * TEST FIXTURE level: axios stubbed at the HTTP boundary; no LLM client on this path.
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { llmService } from "../services/llm.service";
import { profileExtractor } from "../llm/profile_extractor";
import { getBodyGoalState } from "../services/enterprise-data/body-goal.reader";
import { getCoachStateV0 } from "../services/coach-state/coach-state";
import type { BodyGoalStateWindow, NutritionAnalyticsWindow, TrainingAnalyticsWindow } from "../services/enterprise-data/types";

const origGet = axios.get;
const origExtract = profileExtractor.extract;
const origCall = llmService.callLLM;
test.afterEach(() => {
  axios.get = origGet;
  profileExtractor.extract = origExtract;
  llmService.callLLM = origCall;
});
const identity = (id = "user-a") => ({ userId: id, authorizationHeader: `Bearer token-${id}` });

const trendNA = { status: "INSUFFICIENT_HISTORY" as const, dataPoints: 0 };
function bodyGoal(over: Partial<BodyGoalStateWindow> = {}): BodyGoalStateWindow {
  return {
    asOf: "2026-10-10T12:00:00.000Z",
    lookbackDays: 90,
    body: {
      dataQuality: "SUFFICIENT",
      observations: { totalOnRecord: 4, inLookback: 4, comparableInLookback: 4, firstAt: "2026-08-20T07:00:00.000Z", latestAt: "2026-10-05T07:00:00.000Z" },
      latest: { measuredAt: "2026-10-05T07:00:00.000Z", weightKg: 82, bodyFatPct: 20, muscleMassKg: 33, source: "MANUAL", excludedFromTrend: false },
      previous: { measuredAt: "2026-09-20T07:00:00.000Z", weightKg: 83.2, bodyFatPct: 20.5, muscleMassKg: 33, source: "MANUAL", excludedFromTrend: false },
      latestAgeDays: 5,
      trends: { weight: { status: "AVAILABLE", direction: "DOWN", changePerWeek: -0.6, dataPoints: 4 }, bodyFat: trendNA, muscleMass: trendNA },
      quality: { outlierCount: 0, intervalWarningCount: 0, mixedSources: false, confidenceMultiplier: 1, flags: [] },
      muscleMassSemantics: "UNRESOLVED",
      muscleMassProvenance: { extracted: 0, manual: 4, unknown: 0 },
      profileReportedWeight: { kg: 80, matchesLatestMeasurement: false, differenceFromLatestKg: -2 },
    },
    goal: {
      type: "WEIGHT_LOSS",
      currentTarget: { state: "AVAILABLE", weightKg: 75, source: "PROFILE_TARGET_WEIGHT", history: "TARGET_HISTORY_UNAVAILABLE" },
      startingState: { state: "NOT_AVAILABLE", reason: "NO_ACTIVE_CYCLE" },
      profileStartingWeightKg: 86,
      gap: { state: "AVAILABLE", currentKg: 82, targetKg: 75, differenceKg: 7, absoluteKg: 7, currentSource: "MEASURED_INBODY", currentAsOf: "2026-10-05T07:00:00.000Z", alternateCurrent: { source: "PROFILE_REPORTED", kg: 80, differenceKg: -2 } },
      trajectory: {
        observed: { state: "AVAILABLE", timeSpanDays: 46, observationCount: 4, firstWeightKg: 86, latestWeightKg: 82, observedChangeKg: -4, observedRateKgPerWeek: -0.6, directionRelativeToGap: "TOWARD_TARGET" },
        onTrack: { status: "NOT_EVALUABLE", reasons: ["NO_TARGET_DATE", "NO_STARTING_STATE"], classification: "DEFERRED" },
      },
      roadmap: { state: "NONE" },
      dataQuality: "PARTIAL",
    },
    ...over,
  };
}
const training = (): TrainingAnalyticsWindow => ({
  period: { from: "2026-09-13T00:00:00.000Z", to: "2026-10-10T12:00:00.000Z", days: 28 },
  adherence: { state: "NO_SCHEDULE", scheduledSessions: 0, completedSessions: 0, missedSessions: null, completionRate: null, dataQuality: "NO_DATA" },
  frequency: { completedPerWeek: null, scheduledPerWeek: null, trainingDaysLogged: 0, weeklyVolumeConsistency: null, dataQuality: "NO_DATA" },
  volume: { totalVolumeLoadKg: 0, byMuscleGroupKg: {}, byWeek: [], volumeTrendPercent: null, completedSetCount: 0, loadedSetCount: 0, dataQuality: "NO_DATA" },
  progression: { exercises: [], dataQuality: "NO_DATA" },
  plateau: { status: "NOT_AVAILABLE", reason: "n/a" },
  effort: {
    rpe: { observedSets: 0, totalCompletedSets: 0, weeklyAvg: [], trend: null, dataQuality: "NO_DATA" },
    rir: { observedSets: 0, totalCompletedSets: 0, weeklyAvg: [], trend: null, dataQuality: "NO_DATA" },
    sessionFeedback: { feedbackCount: 0, averageSessionRpe: null, sessionRpeSource: "none", averagePainScore: null, recoveryScore: null, dataQuality: "NO_DATA" },
  },
  signals: [], dataQuality: "NO_DATA",
});
const nutrition = (): NutritionAnalyticsWindow => ({
  period: { from: "2026-09-13T00:00:00.000Z", to: "2026-10-10T12:00:00.000Z", days: 28 },
  activeTarget: { state: "NO_ACTIVE_TARGET" }, targetChangedInWindow: false,
  actual: { days: [], summary: { daysInWindow: 28, loggedDays: 0, calories: { averageKcal: null, daysUsed: 0 }, protein: { averageG: null, daysUsed: 0, partialDays: 0 }, carbs: { averageG: null, daysUsed: 0, partialDays: 0 }, fat: { averageG: null, daysUsed: 0, partialDays: 0 } } },
  adherence: { state: "NOT_AVAILABLE_NO_ACTUAL", calories: null, protein: null, carbs: null, fat: null },
  dataQuality: "NO_DATA",
});

function stubHttp(byAuth?: (auth: string) => BodyGoalStateWindow) {
  const calls: string[] = [];
  (axios as any).get = async (url: string, cfg: any) => {
    calls.push(url);
    const auth = cfg?.headers?.Authorization ?? "";
    if (url.includes("/stats/body-goal-state")) return { data: byAuth ? byAuth(auth) : bodyGoal() };
    if (url.includes("/stats/training-window")) return { data: training() };
    if (url.includes("/nutrition/analytics/window")) return { data: nutrition() };
    throw new Error(`unexpected GET ${url}`);
  };
  return calls;
}
const count = (calls: string[], frag: string) => calls.filter((u) => u.includes(frag)).length;
const profileCalls = { n: 0 };
function stubProfile() {
  profileCalls.n = 0;
  profileExtractor.extract = (async () => { profileCalls.n++; return { profile: { goal: "MUSCLE_GAIN" }, inBodyHistory: [], workoutHistory: [], nutritionHistory: [] }; }) as any;
}
const BODY_ONLY = { includeTraining: false, includeBody: true, includeGoal: false } as const;

test("reader: ok; caller's Authorization only; lookbackDays param; no userId", async () => {
  let seen: any;
  (axios as any).get = async (url: string, cfg: any) => { seen = { url, cfg }; return { data: bodyGoal() }; };
  const r = await getBodyGoalState(identity("user-a"), { lookbackDays: 120 });
  assert.equal(r.status, "ok");
  assert.match(seen.url, /\/stats\/body-goal-state$/);
  assert.equal(seen.cfg.headers.Authorization, "Bearer token-user-a");
  assert.deepEqual(seen.cfg.params, { lookbackDays: 120 });
});

test("reader: NO_DATA body is an ok read; 502/transport = error; 404 absent; malformed error", async () => {
  const nd = bodyGoal();
  nd.body = { ...nd.body, dataQuality: "NO_DATA", latest: null, previous: null, latestAgeDays: null, observations: { totalOnRecord: 0, inLookback: 0, comparableInLookback: 0, firstAt: null, latestAt: null } };
  (axios as any).get = async () => ({ data: nd });
  const ok = await getBodyGoalState(identity());
  assert.equal(ok.status, "ok");
  (axios as any).get = async () => { throw Object.assign(new Error("bad gateway"), { response: { status: 502 } }); };
  assert.equal((await getBodyGoalState(identity())).status, "error");
  (axios as any).get = async () => { throw new Error("ECONNREFUSED"); };
  assert.equal((await getBodyGoalState(identity())).status, "error");
  (axios as any).get = async () => { throw Object.assign(new Error("nf"), { response: { status: 404 } }); };
  assert.equal((await getBodyGoalState(identity())).status, "absent");
  (axios as any).get = async () => ({ data: { body: {} } });
  assert.equal((await getBodyGoalState(identity())).status, "error");
});

test("DEMAND-DRIVEN: training-only / nutrition-only never fetch body; body-only never fetches training/nutrition; combined = once each", async () => {
  stubProfile();
  let calls = stubHttp();
  await getCoachStateV0(identity(), { includeGoal: false });                                  // training-only (4.1 default)
  assert.equal(count(calls, "/stats/body-goal-state"), 0);

  calls = stubHttp();
  await getCoachStateV0(identity(), { includeTraining: false, includeNutrition: true, includeGoal: false });
  assert.equal(count(calls, "/stats/body-goal-state"), 0);
  assert.equal(count(calls, "/stats/training-window"), 0);

  calls = stubHttp();
  const b = await getCoachStateV0(identity(), BODY_ONLY);
  assert.equal(b.status, "ok");
  assert.equal(count(calls, "/stats/body-goal-state"), 1);
  assert.equal(count(calls, "/stats/training-window"), 0);
  assert.equal(count(calls, "/nutrition/analytics/window"), 0);

  calls = stubHttp();
  const all = await getCoachStateV0(identity(), { includeNutrition: true, includeBody: true, includeGoalState: true, includeGoal: false });
  assert.equal(all.status, "ok");
  assert.equal(count(calls, "/stats/body-goal-state"), 1, "body + goal-state share one upstream read");
  assert.equal(count(calls, "/stats/training-window"), 1);
  assert.equal(count(calls, "/nutrition/analytics/window"), 1);
});

test("goal-state slice takes goal.type from the same read: no profile fetch", async () => {
  stubProfile();
  stubHttp();
  const r = await getCoachStateV0(identity(), { includeTraining: false, includeGoalState: true });
  assert.equal(r.status, "ok");
  assert.equal(profileCalls.n, 0);
  const s = (r as any).value;
  assert.equal(s.goal.type, "WEIGHT_LOSS");
  assert.equal(s.goal.gap.differenceKg, 7);
  assert.equal(s.goal.gap.currentSource, "MEASURED_INBODY");
  assert.ok(!("body" in s), "goal-only does not include the body slice");
});

test("body slice: summary + trend, provenance, weight sources kept apart; no raw series; no placeholders", async () => {
  stubHttp();
  const r = await getCoachStateV0(identity(), BODY_ONLY);
  const s = (r as any).value;
  assert.deepEqual(Object.keys(s).sort(), ["asOf", "body"]);
  assert.equal(s.body.latest.weightKg, 82);
  assert.equal(s.body.profileReportedWeight.kg, 80, "profile weight stays a separate value");
  assert.equal(s.body.muscleMassSemantics, "UNRESOLVED");
  assert.ok(!JSON.stringify(s).match(/skeletalMuscle/i));
  assert.ok(!("history" in s.body) && !("series" in s.body));
  assert.equal(s.body.lookbackDays, 90);
});

test("trajectory contract passes through unchanged; on-track stays NOT_EVALUABLE / DEFERRED", async () => {
  stubHttp();
  const r = await getCoachStateV0(identity(), { includeTraining: false, includeGoalState: true });
  const g = (r as any).value.goal;
  assert.equal(g.trajectory.observed.observedChangeKg, -4);
  assert.deepEqual(g.trajectory.onTrack, { status: "NOT_EVALUABLE", reasons: ["NO_TARGET_DATE", "NO_STARTING_STATE"], classification: "DEFERRED" });
  assert.equal(g.currentTarget.history, "TARGET_HISTORY_UNAVAILABLE");
});

test("no body data: NO_DATA passes through; target kept; gap unavailable — nothing zero-filled", async () => {
  const s = bodyGoal();
  s.body = { ...s.body, dataQuality: "NO_DATA", latest: null, previous: null, latestAgeDays: null, observations: { totalOnRecord: 0, inLookback: 0, comparableInLookback: 0, firstAt: null, latestAt: null }, profileReportedWeight: null };
  s.goal = { ...s.goal, gap: { state: "NOT_AVAILABLE", reason: "NO_CURRENT_WEIGHT" } };
  stubHttp(() => s);
  const r = await getCoachStateV0(identity(), { includeTraining: false, includeBody: true, includeGoalState: true });
  const v = (r as any).value;
  assert.equal(v.body.dataQuality, "NO_DATA");
  assert.equal(v.body.latest, null);
  assert.equal(v.goal.currentTarget.weightKg, 75);
  assert.deepEqual(v.goal.gap, { state: "NOT_AVAILABLE", reason: "NO_CURRENT_WEIGHT" });
});

test("upstream failure → error (not NO_DATA / no target / zero gap)", async () => {
  (axios as any).get = async () => { throw Object.assign(new Error("bad gateway"), { response: { status: 502 } }); };
  const r = await getCoachStateV0(identity(), { includeTraining: false, includeBody: true, includeGoalState: true, includeGoal: false });
  assert.equal(r.status, "error");
  assert.ok(!("value" in r));
});

test("cross-user: B's credential is forwarded; A's measurement/target/roadmap never appear in B's state", async () => {
  const a = bodyGoal();
  a.goal = { ...a.goal, roadmap: { state: "ACTIVE", roadmapId: "roadmap-A-secret", name: "A plan", goalType: "WEIGHT_LOSS", plannedStartAt: "2026-09-01T00:00:00.000Z", plannedEndAt: null, currentPhase: null } };
  const b = bodyGoal();
  b.body = { ...b.body, dataQuality: "NO_DATA", latest: null, previous: null, latestAgeDays: null, observations: { totalOnRecord: 0, inLookback: 0, comparableInLookback: 0, firstAt: null, latestAt: null }, profileReportedWeight: null };
  b.goal = { ...b.goal, type: null, currentTarget: { state: "NO_TARGET" }, gap: { state: "NOT_AVAILABLE", reason: "NO_TARGET" }, roadmap: { state: "NONE" }, profileStartingWeightKg: null };
  stubHttp((auth) => (auth === "Bearer token-user-a" ? a : b));
  const ra = await getCoachStateV0(identity("user-a"), { includeTraining: false, includeBody: true, includeGoalState: true });
  const rb = await getCoachStateV0(identity("user-b"), { includeTraining: false, includeBody: true, includeGoalState: true });
  assert.ok(JSON.stringify(ra).includes("roadmap-A-secret"));
  assert.ok(!JSON.stringify(rb).includes("roadmap-A-secret"));
  assert.ok(!JSON.stringify(rb).includes('"weightKg":75'));
  assert.equal((rb as any).value.goal.gap.reason, "NO_TARGET");
});

test("0 LLM calls on the body/goal foundation path", async () => {
  let llm = 0;
  (llmService as any).callLLM = async () => { llm++; return { answer: "{}" }; };
  stubProfile();
  stubHttp();
  await getCoachStateV0(identity(), { includeBody: true, includeGoalState: true, includeNutrition: true });
  assert.equal(llm, 0);
});
