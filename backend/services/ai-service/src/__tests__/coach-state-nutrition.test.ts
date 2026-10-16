/**
 * Phase 4.3 — CoachStateV0.nutrition (docs/ai-product/phase4-3-nutrition-coach-state.md).
 * TEST FIXTURE level: axios stubbed at the HTTP boundary; no LLM client is imported on this path.
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { llmService } from "../services/llm.service";
import { profileExtractor } from "../llm/profile_extractor";
import { getNutritionAnalytics } from "../services/enterprise-data/nutrition-analytics.reader";
import { assembleContext } from "../services/context-assembler";
import { buildCoachStateV0, getCoachStateV0 } from "../services/coach-state/coach-state";
import type { NutritionAnalyticsWindow, TrainingAnalyticsWindow } from "../services/enterprise-data/types";

const origGet = axios.get;
const origExtract = profileExtractor.extract;
const origCall = llmService.callLLM;
test.afterEach(() => {
  axios.get = origGet;
  profileExtractor.extract = origExtract;
  llmService.callLLM = origCall;
});

const identity = (id = "user-a") => ({ userId: id, authorizationHeader: `Bearer token-${id}` });

function nutrition(over: Partial<NutritionAnalyticsWindow> = {}): NutritionAnalyticsWindow {
  return {
    period: { from: "2026-09-13T00:00:00.000Z", to: "2026-10-10T12:00:00.000Z", days: 28 },
    activeTarget: { state: "ACTIVE_TARGET", goalId: "g1", caloriesKcal: 2000, proteinG: 150, carbsG: 200, fatG: 65, validFrom: "2026-08-01T00:00:00.000Z", triggeredBy: "ONBOARDING" },
    targetChangedInWindow: false,
    actual: {
      days: [],
      summary: {
        daysInWindow: 28, loggedDays: 20,
        calories: { averageKcal: 1950, daysUsed: 20 },
        protein: { averageG: 140, daysUsed: 15, partialDays: 5 },
        carbs: { averageG: null, daysUsed: 0, partialDays: 0 },
        fat: { averageG: null, daysUsed: 0, partialDays: 0 },
      },
    },
    adherence: {
      state: "MEASURED",
      calories: { comparedDays: 20, averageTarget: 2000, averageActual: 1950, averageDelta: -50, averageAbsoluteDelta: 120 },
      protein: { comparedDays: 15, averageTarget: 150, averageActual: 140, averageDelta: -10, averageAbsoluteDelta: 18 },
      carbs: null, fat: null,
    },
    dataQuality: "SUFFICIENT",
    ...over,
  };
}
const NO_DATA = nutrition({
  actual: {
    days: [],
    summary: {
      daysInWindow: 28, loggedDays: 0,
      calories: { averageKcal: null, daysUsed: 0 }, protein: { averageG: null, daysUsed: 0, partialDays: 0 },
      carbs: { averageG: null, daysUsed: 0, partialDays: 0 }, fat: { averageG: null, daysUsed: 0, partialDays: 0 },
    },
  },
  adherence: { state: "NOT_AVAILABLE_NO_ACTUAL", calories: null, protein: null, carbs: null, fat: null },
  dataQuality: "NO_DATA",
});
const training = (): TrainingAnalyticsWindow => ({
  period: { from: "2026-09-13T00:00:00.000Z", to: "2026-10-10T12:00:00.000Z", days: 28 },
  adherence: { state: "MEASURED", scheduledSessions: 9, completedSessions: 8, missedSessions: 1, completionRate: 0.89, dataQuality: "SUFFICIENT" },
  frequency: { completedPerWeek: 2.3, scheduledPerWeek: 2.3, trainingDaysLogged: 9, weeklyVolumeConsistency: 0.8, dataQuality: "SUFFICIENT" },
  volume: { totalVolumeLoadKg: 10440, byMuscleGroupKg: {}, byWeek: [], volumeTrendPercent: null, completedSetCount: 18, loadedSetCount: 18, dataQuality: "SUFFICIENT" },
  progression: { exercises: [], dataQuality: "NO_DATA" },
  plateau: { status: "NOT_AVAILABLE", reason: "n/a" },
  effort: {
    rpe: { observedSets: 0, totalCompletedSets: 18, weeklyAvg: [], trend: null, dataQuality: "NO_DATA" },
    rir: { observedSets: 0, totalCompletedSets: 18, weeklyAvg: [], trend: null, dataQuality: "NO_DATA" },
    sessionFeedback: { feedbackCount: 0, averageSessionRpe: null, sessionRpeSource: "none", averagePainScore: null, recoveryScore: null, dataQuality: "NO_DATA" },
  },
  signals: [], dataQuality: "SUFFICIENT",
});

function stubGoal() {
  profileExtractor.extract = (async () => ({ profile: { goal: "WEIGHT_LOSS" }, inBodyHistory: [], workoutHistory: [], nutritionHistory: [] })) as any;
}
function stubHttp(byAuth?: (auth: string) => { nutrition?: NutritionAnalyticsWindow; training?: TrainingAnalyticsWindow }) {
  const calls: string[] = [];
  (axios as any).get = async (url: string, cfg: any) => {
    calls.push(url);
    const auth = cfg?.headers?.Authorization ?? "";
    const pick = byAuth?.(auth) ?? {};
    if (url.includes("/nutrition/analytics/window")) return { data: pick.nutrition ?? nutrition() };
    if (url.includes("/stats/training-window")) return { data: pick.training ?? training() };
    throw new Error(`unexpected GET ${url}`);
  };
  return calls;
}
const count = (calls: string[], frag: string) => calls.filter((u) => u.includes(frag)).length;

test("reader: ok; forwards only the caller's Authorization; no userId parameter", async () => {
  let seen: any;
  (axios as any).get = async (url: string, cfg: any) => { seen = { url, cfg }; return { data: nutrition() }; };
  const r = await getNutritionAnalytics(identity("user-a"), { days: 28 });
  assert.equal(r.status, "ok");
  assert.match(seen.url, /\/nutrition\/analytics\/window$/);
  assert.equal(seen.cfg.headers.Authorization, "Bearer token-user-a");
  assert.deepEqual(seen.cfg.params, { days: 28 });
});

test("reader: NO_DATA window is an ok read (truthful), failures are errors, 404 absent, malformed error", async () => {
  (axios as any).get = async () => ({ data: NO_DATA });
  const nd = await getNutritionAnalytics(identity());
  assert.equal(nd.status, "ok");
  assert.equal((nd as any).value.dataQuality, "NO_DATA");
  (axios as any).get = async () => { throw new Error("ECONNREFUSED"); };
  assert.equal((await getNutritionAnalytics(identity())).status, "error");
  (axios as any).get = async () => { throw Object.assign(new Error("boom"), { response: { status: 500 } }); };
  assert.equal((await getNutritionAnalytics(identity())).status, "error");
  (axios as any).get = async () => { throw Object.assign(new Error("nf"), { response: { status: 404 } }); };
  assert.equal((await getNutritionAnalytics(identity())).status, "absent");
  (axios as any).get = async () => ({ data: { nope: true } });
  assert.equal((await getNutritionAnalytics(identity())).status, "error");
});

test("demand-driven: training-only never fetches nutrition; nutrition-only never fetches training; both fetch once each", async () => {
  stubGoal();
  let calls = stubHttp();
  await getCoachStateV0(identity(), { includeGoal: false });
  assert.equal(count(calls, "/stats/training-window"), 1);
  assert.equal(count(calls, "/nutrition/analytics/window"), 0);

  calls = stubHttp();
  const n = await getCoachStateV0(identity(), { includeTraining: false, includeNutrition: true, includeGoal: false });
  assert.equal(n.status, "ok");
  assert.equal(count(calls, "/stats/training-window"), 0);
  assert.equal(count(calls, "/nutrition/analytics/window"), 1);

  calls = stubHttp();
  const both = await getCoachStateV0(identity(), { includeNutrition: true, includeGoal: false });
  assert.equal(both.status, "ok");
  assert.equal(count(calls, "/stats/training-window"), 1);
  assert.equal(count(calls, "/nutrition/analytics/window"), 1);

  // assembler: no nutrition fetch unless the need is requested
  calls = stubHttp();
  await assembleContext(identity(), ["FITNESS_GOAL"]);
  assert.equal(calls.length, 0);
});

test("nutrition slice: target and actual stay separate; values pass through; no signals; no placeholders", async () => {
  const calls = stubHttp();
  stubGoal();
  const r = await getCoachStateV0(identity(), { includeTraining: false, includeNutrition: true, now: new Date("2026-10-10T12:00:00.000Z") });
  assert.equal(r.status, "ok");
  const s = (r as any).value;
  assert.equal(count(calls, "/stats/training-window"), 0);
  assert.deepEqual(Object.keys(s).sort(), ["asOf", "goal", "nutrition"]);
  assert.deepEqual(s.goal, { type: "WEIGHT_LOSS" });
  assert.equal(s.nutrition.activeTarget.caloriesKcal, 2000);
  assert.equal(s.nutrition.actual.calories.averageKcal, 1950);
  assert.equal(s.nutrition.adherence.calories.averageDelta, -50);
  assert.equal(s.nutrition.adherence.carbs, null, "unavailable stays unavailable");
  assert.ok(!("signals" in s.nutrition));
  assert.ok(!("days" in s.nutrition.actual), "summary only, no per-day history in the coach slice");
});

test("target only / no actual: adherence not calculated, nothing zero-filled", async () => {
  stubHttp(() => ({ nutrition: NO_DATA }));
  const r = await getCoachStateV0(identity(), { includeTraining: false, includeNutrition: true, includeGoal: false });
  const n = (r as any).value.nutrition;
  assert.equal(n.activeTarget.state, "ACTIVE_TARGET");
  assert.equal(n.actual.loggedDays, 0);
  assert.equal(n.actual.calories.averageKcal, null);
  assert.equal(n.adherence.state, "NOT_AVAILABLE_NO_ACTUAL");
  assert.equal(n.dataQuality, "NO_DATA");
});

test("no data at all: no target, no actual — represented as such (no fake nutrition)", async () => {
  stubHttp(() => ({ nutrition: { ...NO_DATA, activeTarget: { state: "NO_ACTIVE_TARGET" } } }));
  const r = await getCoachStateV0(identity(), { includeTraining: false, includeNutrition: true, includeGoal: false });
  const n = (r as any).value.nutrition;
  assert.equal(n.activeTarget.state, "NO_ACTIVE_TARGET");
  assert.equal(n.dataQuality, "NO_DATA");
  assert.ok(!JSON.stringify(n).includes('"caloriesKcal":0'));
});

test("STALE passes through unchanged", async () => {
  stubHttp(() => ({ nutrition: { ...NO_DATA, dataQuality: "STALE" } }));
  const r = await getCoachStateV0(identity(), { includeTraining: false, includeNutrition: true, includeGoal: false });
  assert.equal((r as any).value.nutrition.dataQuality, "STALE");
});

test("upstream nutrition failure → AuthoritativeRead.error (not NO_DATA / 0 kcal / 0 g); training success is not mistaken for it", async () => {
  stubGoal();
  (axios as any).get = async (url: string) => {
    if (url.includes("/nutrition/analytics/window")) throw Object.assign(new Error("boom"), { response: { status: 500 } });
    return { data: training() };
  };
  const nutOnly = await getCoachStateV0(identity(), { includeTraining: false, includeNutrition: true, includeGoal: false });
  assert.equal(nutOnly.status, "error");
  assert.ok(!("value" in nutOnly));
  const both = await getCoachStateV0(identity(), { includeNutrition: true, includeGoal: false });
  assert.equal(both.status, "error", "a requested slice that failed is never silently dropped");
});

test("buildCoachStateV0: requested-but-unfetched nutrition is an error, not an empty slice", () => {
  assert.equal(buildCoachStateV0({}, new Date(), { includeTraining: false, includeNutrition: true }).status, "error");
});

test("cross-user: B's credential is forwarded; A's nutrition facts never appear in B's state", async () => {
  const a = nutrition({ activeTarget: { state: "ACTIVE_TARGET", goalId: "goal-A-secret", caloriesKcal: 2222, proteinG: 150, carbsG: 200, fatG: 65, validFrom: "2026-08-01T00:00:00.000Z", triggeredBy: null } });
  stubHttp((auth) => (auth === "Bearer token-user-a" ? { nutrition: a } : { nutrition: NO_DATA }));
  const ra = await getCoachStateV0(identity("user-a"), { includeTraining: false, includeNutrition: true, includeGoal: false });
  const rb = await getCoachStateV0(identity("user-b"), { includeTraining: false, includeNutrition: true, includeGoal: false });
  assert.ok(JSON.stringify(ra).includes("goal-A-secret"));
  assert.ok(!JSON.stringify(rb).includes("goal-A-secret"));
  assert.ok(!JSON.stringify(rb).includes("2222"));
});

test("0 LLM calls on the whole nutrition foundation path", async () => {
  let llm = 0;
  (llmService as any).callLLM = async () => { llm++; return { answer: "{}" }; };
  stubHttp();
  stubGoal();
  await getCoachStateV0(identity(), { includeNutrition: true });
  assert.equal(llm, 0);
});
