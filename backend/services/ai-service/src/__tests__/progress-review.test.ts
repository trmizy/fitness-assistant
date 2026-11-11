/**
 * Phase 4.5 — personal progress review composed from CoachState slices
 * (docs/ai-product/phase4-5-progress-review-integration.md).
 * Pure sections = TEST FIXTURE; `tryTurn` sections run the real orchestrator + workflow DB (isolated *_test only)
 * with axios/profile stubs = BACKEND INTEGRATION. No real model is ever called.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { llmService } from "../services/llm.service";
import { classifyGlobal } from "../conversational-intelligence/global/router";
import {
  answerProgressReview,
  buildProgressReviewV0,
  classifyProgressReviewQuestion,
  progressReviewDeps,
  renderProgressReview,
  toSlice,
  validateReviewNarration,
  type ProgressReviewV0,
} from "../conversational-intelligence/global/progress-review";
import type { CoachStateV0 } from "../services/coach-state/coach-state";
import type { AuthoritativeRead } from "../services/enterprise-data/types";

const dbUrl = process.env.DATABASE_URL || process.env.AI_DATABASE_URL || "";
const canUseDb = /(_test|postgres-test)/i.test(dbUrl) && process.env.NODE_ENV === "test";
const skipDb = { skip: !canUseDb ? "needs isolated *_test Postgres + NODE_ENV=test" : false } as const;

// ── fixtures (CoachState slice shapes) ───────────────────────────────────

const trendNA = { status: "INSUFFICIENT_HISTORY" as const, dataPoints: 0 };
type Body = NonNullable<CoachStateV0["body"]>;
type Goal = NonNullable<CoachStateV0["goal"]>;

function body(over: Partial<Body> = {}): Body {
  return {
    dataQuality: "SUFFICIENT", lookbackDays: 90,
    observations: { totalOnRecord: 4, inLookback: 4, comparableInLookback: 4, firstAt: "2026-08-20T07:00:00.000Z", latestAt: "2026-10-05T07:00:00.000Z" },
    latest: { measuredAt: "2026-10-05T07:00:00.000Z", weightKg: 78, bodyFatPct: null, muscleMassKg: 33, source: "MANUAL", excludedFromTrend: false },
    previous: null, latestAgeDays: 5,
    trends: { weight: { status: "AVAILABLE", direction: "DOWN", changePerWeek: -0.6, dataPoints: 4 }, bodyFat: trendNA, muscleMass: trendNA },
    quality: { outlierCount: 0, intervalWarningCount: 0, mixedSources: false, confidenceMultiplier: 1, flags: [] },
    muscleMassSemantics: "UNRESOLVED", muscleMassProvenance: { extracted: 0, manual: 4, unknown: 0 },
    profileReportedWeight: { kg: 78, matchesLatestMeasurement: true, differenceFromLatestKg: 0 },
    ...over,
  };
}
function goal(over: Partial<Goal> = {}): Goal {
  return {
    type: "WEIGHT_LOSS",
    currentTarget: { state: "AVAILABLE", weightKg: 75, source: "PROFILE_TARGET_WEIGHT", history: "TARGET_HISTORY_UNAVAILABLE" },
    startingState: { state: "NOT_AVAILABLE", reason: "NO_ACTIVE_CYCLE" },
    profileStartingWeightKg: 86,
    gap: { state: "AVAILABLE", currentKg: 78, targetKg: 75, differenceKg: 3, absoluteKg: 3, currentSource: "MEASURED_INBODY", currentAsOf: "2026-10-05T07:00:00.000Z", alternateCurrent: null },
    trajectory: {
      observed: { state: "AVAILABLE", timeSpanDays: 46, observationCount: 4, firstWeightKg: 82, latestWeightKg: 78, observedChangeKg: -4, observedRateKgPerWeek: -0.6, directionRelativeToGap: "TOWARD_TARGET" },
      onTrack: { status: "NOT_EVALUABLE", reasons: ["NO_TARGET_DATE", "NO_STARTING_STATE"], classification: "DEFERRED" },
    },
    roadmap: { state: "NONE" }, dataQuality: "PARTIAL",
    ...over,
  };
}
const bodyGoalState = (b = body(), g = goal()): CoachStateV0 => ({ asOf: "2026-10-10T12:00:00.000Z", body: b, goal: g });

type Training = NonNullable<CoachStateV0["training"]>;
function training(over: Partial<Training> = {}): Training {
  return {
    period: { from: "2026-09-13T00:00:00.000Z", to: "2026-10-10T12:00:00.000Z", days: 28 },
    adherence: { state: "MEASURED", scheduledSessions: 9, completedSessions: 8, missedSessions: 1, completionRate: 0.89, dataQuality: "SUFFICIENT" },
    frequency: { completedPerWeek: 2.3, scheduledPerWeek: 2.3, trainingDaysLogged: 9, weeklyVolumeConsistency: 0.8, dataQuality: "SUFFICIENT" },
    volume: { totalVolumeLoadKg: 10440, byMuscleGroupKg: {}, byWeek: [], volumeTrendPercent: null, completedSetCount: 18, loadedSetCount: 18, dataQuality: "SUFFICIENT" },
    progression: { exercises: [{ exerciseId: "b", exerciseName: "Bench Press", baselineE1rmKg: 100, currentE1rmKg: 110, changePct: 10, weeksObserved: 4, dataQuality: "SUFFICIENT" }], dataQuality: "SUFFICIENT" },
    plateau: { status: "NOT_AVAILABLE", reason: "n/a" },
    effort: {
      rpe: { observedSets: 0, totalCompletedSets: 18, weeklyAvg: [], trend: null, dataQuality: "NO_DATA" },
      rir: { observedSets: 0, totalCompletedSets: 18, weeklyAvg: [], trend: null, dataQuality: "NO_DATA" },
      sessionFeedback: { feedbackCount: 0, averageSessionRpe: null, sessionRpeSource: "none", averagePainScore: null, recoveryScore: null, dataQuality: "NO_DATA" },
    },
    signals: [], dataQuality: "SUFFICIENT", ...over,
  };
}
const trainingState = (t = training()): CoachStateV0 => ({ asOf: "2026-10-10T12:00:00.000Z", training: t });

type Nutrition = NonNullable<CoachStateV0["nutrition"]>;
function nutrition(over: Partial<Nutrition> = {}): Nutrition {
  return {
    period: { from: "2026-09-13T00:00:00.000Z", to: "2026-10-10T12:00:00.000Z", days: 28 },
    activeTarget: { state: "ACTIVE_TARGET", goalId: "g1", caloriesKcal: 2000, proteinG: 150, carbsG: 200, fatG: 65, validFrom: "2026-08-01T00:00:00.000Z", triggeredBy: "ONBOARDING" },
    targetChangedInWindow: false,
    actual: {
      daysInWindow: 28, loggedDays: 24,
      calories: { averageKcal: 2000, daysUsed: 24 }, protein: { averageG: 140, daysUsed: 20, partialDays: 0 },
      carbs: { averageG: null, daysUsed: 0, partialDays: 0 }, fat: { averageG: null, daysUsed: 0, partialDays: 0 },
    },
    adherence: {
      state: "MEASURED",
      calories: { comparedDays: 24, averageTarget: 2000, averageActual: 2000, averageDelta: 0, averageAbsoluteDelta: 100 },
      protein: { comparedDays: 20, averageTarget: 150, averageActual: 140, averageDelta: -10, averageAbsoluteDelta: 10 },
      carbs: null, fat: null,
    },
    dataQuality: "SUFFICIENT", ...over,
  };
}
const nutritionState = (n = nutrition()): CoachStateV0 => ({ asOf: "2026-10-10T12:00:00.000Z", nutrition: n });

const NUTRITION_NO_DATA = nutrition({
  actual: { daysInWindow: 28, loggedDays: 0, calories: { averageKcal: null, daysUsed: 0 }, protein: { averageG: null, daysUsed: 0, partialDays: 0 }, carbs: { averageG: null, daysUsed: 0, partialDays: 0 }, fat: { averageG: null, daysUsed: 0, partialDays: 0 } },
  adherence: { state: "NOT_AVAILABLE_NO_ACTUAL", calories: null, protein: null, carbs: null, fat: null }, dataQuality: "NO_DATA",
});
const TRAINING_NO_DATA = training({
  adherence: { state: "NO_SCHEDULE", scheduledSessions: 0, completedSessions: 0, missedSessions: null, completionRate: null, dataQuality: "NO_DATA" },
  frequency: { completedPerWeek: null, scheduledPerWeek: null, trainingDaysLogged: 0, weeklyVolumeConsistency: null, dataQuality: "NO_DATA" },
  progression: { exercises: [], dataQuality: "NO_DATA" }, dataQuality: "NO_DATA",
});
const BODY_NO_DATA = body({
  dataQuality: "NO_DATA", latest: null, previous: null, latestAgeDays: null, profileReportedWeight: null,
  observations: { totalOnRecord: 0, inLookback: 0, comparableInLookback: 0, firstAt: null, latestAt: null },
});

const okRead = (s: CoachStateV0): AuthoritativeRead<CoachStateV0> => ({ status: "ok", value: s, source: "FITNESS_SERVICE", fetchedAt: 0 });
const review = (o: { b?: CoachStateV0; t?: CoachStateV0; n?: CoachStateV0; errN?: boolean } = {}): ProgressReviewV0 =>
  buildProgressReviewV0({
    asOf: new Date("2026-10-10T12:00:00.000Z"),
    bodyGoal: o.b ? { status: "ok", state: o.b } : { status: "not_requested" },
    training: o.t ? { status: "ok", state: o.t } : { status: "not_requested" },
    nutrition: o.errN ? { status: "error" } : o.n ? { status: "ok", state: o.n } : { status: "not_requested" },
  });
const FULL = () => review({ b: bodyGoalState(), t: trainingState(), n: nutritionState() });

// ── A. recognition / routing ─────────────────────────────────────────────

test("classification: personal progress questions recognised; knowledge/recommendation/action/single-domain/targets are not", () => {
  const yes: Array<[string, string]> = [
    ["Tôi dạo này có tiến triển không?", "HOLISTIC"],
    ["Tháng này tình hình của tôi thế nào?", "HOLISTIC"],
    ["Cân nặng, tập luyện và ăn uống gần đây của tôi có ổn không?", "HOLISTIC"],
    ["Tôi có đang đi đúng hướng giảm cân không?", "DIRECTION"],
    ["Tôi có đang tiến gần mục tiêu không?", "DIRECTION"],
    ["Tôi có đúng tiến độ không?", "SCHEDULE"],
    ["Tôi còn cách mục tiêu bao nhiêu kg?", "GAP"],
    ["Tôi giảm được bao nhiêu rồi?", "GAP"],
    ["Cân gần nhất của tôi là bao nhiêu?", "LATEST_WEIGHT"],
    ["Protein trung bình của tôi gần đây là bao nhiêu?", "NUTRITION_READBACK"],
  ];
  for (const [q, cls] of yes) assert.equal(classifyProgressReviewQuestion(q), cls, q);
  const no = [
    "Giảm 0.5 kg một tuần có ổn không?",          // general knowledge
    "Progressive overload là gì?",
    "InBody chính xác không?",
    "Tôi nên giảm bao nhiêu calo?",                // recommendation
    "Tôi đang không tiến triển, chỉnh lịch cho tôi.", // action
    "28 ngày qua tôi tập đều không?",              // pure training → Phase 4.2
    "Bench của tôi dạo này có tiến bộ không?",
    "Tôi tập gần đây ổn không?",
    "Macro hiện tại của tôi bao nhiêu?",           // target read, existing route
    "Protein hiện tại của tôi bao nhiêu?",
    "Cân nặng mục tiêu của tôi là bao nhiêu?",
    "Tôi đang có PT chưa?",
  ];
  for (const q of no) assert.equal(classifyProgressReviewQuestion(q), null, q);
});

test("routing: flag ON → READ_STATE/PROGRESS_REVIEW (training questions still TRAINING_PROGRESS); OFF → legacy route untouched", () => {
  const q = "Tôi dạo này có tiến triển không?";
  const on = classifyGlobal(q, { trainingCoach: true });
  assert.equal(on.route, "READ_STATE");
  assert.equal(on.topic, "PROGRESS_REVIEW");
  assert.notEqual(classifyGlobal(q, {}).topic, "PROGRESS_REVIEW");
  assert.deepEqual(classifyGlobal(q, { trainingCoach: false }), classifyGlobal(q, {}));
  assert.equal(classifyGlobal("28 ngày qua tôi tập đều không?", { trainingCoach: true }).topic, "TRAINING_PROGRESS");
  for (const k of ["Giảm 0.5 kg một tuần có ổn không?", "Macro hiện tại của tôi bao nhiêu?", "Tôi đang có PT chưa?"]) {
    assert.deepEqual(classifyGlobal(k, { trainingCoach: true }), classifyGlobal(k, {}), k);
  }
  // a question during a waiting workflow interrupts it; the value reply still answers the workflow
  const ctx = { active: { wf: "FIND_PT", slot: "budgetVnd" }, trainingCoach: true };
  assert.equal(classifyGlobal(q, ctx).topic, "PROGRESS_REVIEW");
  assert.equal(classifyGlobal(q, ctx).interrupts, true);
  assert.equal(classifyGlobal("2 triệu.", ctx).route, "SLOT_ANSWER");
});

// ── B. evidence + rendering (pure, 0 LLM) ────────────────────────────────

test("BODY ONLY: body facts, missing domains acknowledged by omission, no causal or deadline claim", () => {
  const r = review({ b: bodyGoalState() });
  assert.equal(r.overallCoverage, "PARTIAL");
  const t = renderProgressReview(r, "DIRECTION", "Tôi có đang tiến gần mục tiêu không?");
  assert.match(t, /theo hướng mục tiêu/);
  assert.match(t, /82 → 78 kg \(−4 kg\)/);
  assert.match(t, /chưa phải đánh giá tiến độ theo hạn chót/);
  assert.doesNotMatch(t, /vì|nhờ|đúng tiến độ|đang đi đúng/);
});

test("FULL review: evidence from all three domains + goal gap; descriptive; no score; domains keep their own quality", () => {
  const r = FULL();
  assert.equal(r.overallCoverage, "COMPLETE_ENOUGH_FOR_SUMMARY");
  const kinds = r.evidence.map((e) => e.kind);
  for (const k of ["LATEST_MEASURED_WEIGHT", "GAP_TO_TARGET", "OBSERVED_WEIGHT_TRAJECTORY", "SCHEDULED_ADHERENCE", "EXERCISE_E1RM_CHANGE", "AVERAGE_LOGGED_CALORIES", "AVERAGE_LOGGED_PROTEIN"]) assert.ok(kinds.includes(k), k);
  assert.deepEqual(Object.fromEntries(Object.entries(r.domains).map(([k, v]) => [k, v.quality])), { BODY: "SUFFICIENT", GOAL: "PARTIAL", TRAINING: "SUFFICIENT", NUTRITION: "SUFFICIENT" });
  assert.ok(r.evidence.every((e) => e.claimBoundary === "DESCRIPTIVE_ONLY"));
  assert.ok(!JSON.stringify(r).match(/score|ON_TRACK|IMPROVING/i));
  const t = renderProgressReview(r, "HOLISTIC", "Dạo này tình hình của tôi thế nào?");
  assert.match(t, /8\/9 buổi/);
  assert.match(t, /khoảng 3 kg/);
  assert.match(t, /khoảng 2\.000 kcal/);
  assert.match(t, /protein[^.]*140 g/i);
  assert.match(t, /không kết luận nguyên nhân/);
  assert.match(t, /chưa xác định được bạn có đúng tiến độ/);
  assert.doesNotMatch(t, /tối ưu|lý tưởng|nên giảm/);
});

test("TARGET WITHOUT DEADLINE: 'đúng tiến độ' ⇒ cannot determine; direction stays descriptive", () => {
  const t = renderProgressReview(review({ b: bodyGoalState() }), "SCHEDULE", "Tôi có đúng tiến độ không?");
  assert.match(t, /chưa xác định được bạn có đúng tiến độ/);
  assert.match(t, /theo hướng mục tiêu/);
  assert.doesNotMatch(t, /bạn đang đúng tiến độ|đúng tiến độ\./);
  const r = review({ b: bodyGoalState() });
  assert.deepEqual(r.goal.onTrack?.status, "NOT_EVALUABLE");
});

test("MOVING AWAY: factual, no shaming, no prescription", () => {
  const g = goal({ trajectory: { observed: { state: "AVAILABLE", timeSpanDays: 30, observationCount: 3, firstWeightKg: 80, latestWeightKg: 82, observedChangeKg: 2, observedRateKgPerWeek: 0.5, directionRelativeToGap: "AWAY_FROM_TARGET" }, onTrack: { status: "NOT_EVALUABLE", reasons: ["NO_TARGET_DATE"], classification: "DEFERRED" } } });
  const t = renderProgressReview(review({ b: bodyGoalState(body(), g) }), "DIRECTION", "Tôi có đang đi đúng hướng không?");
  assert.match(t, /ra xa mục tiêu/);
  assert.match(t, /\+2 kg/);
  assert.doesNotMatch(t, /nên|hãy|tệ|kém|lười/);
});

test("SINGLE MEASUREMENT: no trend inferred; other domains still summarised", () => {
  const b = body({ dataQuality: "INSUFFICIENT_HISTORY", observations: { totalOnRecord: 1, inLookback: 1, comparableInLookback: 1, firstAt: "2026-10-05T07:00:00.000Z", latestAt: "2026-10-05T07:00:00.000Z" }, trends: { weight: { status: "INSUFFICIENT_HISTORY", dataPoints: 1 }, bodyFat: trendNA, muscleMass: trendNA } });
  const g = goal({ trajectory: { observed: { state: "NOT_AVAILABLE", reasons: ["INSUFFICIENT_BODY_HISTORY"] }, onTrack: { status: "NOT_EVALUABLE", reasons: ["NO_TARGET_DATE", "INSUFFICIENT_BODY_HISTORY"], classification: "DEFERRED" } } });
  const t = renderProgressReview(review({ b: bodyGoalState(b, g), t: trainingState() }), "HOLISTIC", "Tôi có tiến triển không?");
  assert.match(t, /Mới có 1 lần đo nên chưa đủ lịch sử/);
  assert.match(t, /8\/9 buổi/);
  assert.doesNotMatch(t, /di chuyển theo hướng|ra xa mục tiêu|không đổi/);
});

test("PROFILE WEIGHT FALLBACK: wording says reported/profile value, never 'InBody'", () => {
  const b = BODY_NO_DATA;
  const g = goal({ gap: { state: "AVAILABLE", currentKg: 80, targetKg: 75, differenceKg: 5, absoluteKg: 5, currentSource: "PROFILE_REPORTED", currentAsOf: null, alternateCurrent: null }, trajectory: { observed: { state: "NOT_AVAILABLE", reasons: ["INSUFFICIENT_BODY_HISTORY"] }, onTrack: { status: "NOT_EVALUABLE", reasons: ["NO_TARGET_DATE"], classification: "DEFERRED" } } });
  const t = renderProgressReview(review({ b: bodyGoalState(b, g) }), "GAP", "Tôi còn cách mục tiêu bao nhiêu kg?");
  assert.match(t, /bạn khai trong hồ sơ/);
  assert.match(t, /không phải số đo InBody/);
  assert.doesNotMatch(t, /đo InBody gần nhất là/);
});

test("GAP: explicit current/target/difference with no judgement; no target / no weight handled", () => {
  const t = renderProgressReview(review({ b: bodyGoalState() }), "GAP", "Tôi còn cách mục tiêu bao nhiêu kg?");
  assert.match(t, /78 kg, mục tiêu 75 kg — chênh lệch khoảng 3 kg \(đang cao hơn mục tiêu\)/);
  const noT = goal({ currentTarget: { state: "NO_TARGET" }, gap: { state: "NOT_AVAILABLE", reason: "NO_TARGET" } });
  assert.match(renderProgressReview(review({ b: bodyGoalState(body(), noT) }), "GAP", "x"), /chưa đặt cân nặng mục tiêu/);
});

test("MUSCLE MASS never surfaced; body fat reported only from its own trend", () => {
  const r = FULL();
  assert.ok(!JSON.stringify(r).match(/muscle|skeletal/i));
  const withFat = body({ trends: { weight: { status: "AVAILABLE", direction: "DOWN", changePerWeek: -0.6, dataPoints: 4 }, bodyFat: { status: "AVAILABLE", direction: "DOWN", changePerWeek: -0.2, dataPoints: 3 }, muscleMass: { status: "AVAILABLE", direction: "UP", changePerWeek: 0.1, dataPoints: 3 } } });
  const t = renderProgressReview(review({ b: bodyGoalState(withFat) }), "HOLISTIC", "Tôi có tiến triển không?");
  assert.match(t, /Tỷ lệ mỡ đo được: xu hướng giảm/);
  assert.doesNotMatch(t, /cơ bắp|khối lượng cơ|cơ xương|skeletal/i);
  assert.doesNotMatch(renderProgressReview(FULL(), "HOLISTIC", "x"), /giảm mỡ|mất mỡ/);
});

test("NUTRITION PARTIAL: averages scoped to logged days", () => {
  const n = nutrition({ actual: { daysInWindow: 28, loggedDays: 10, calories: { averageKcal: 1900, daysUsed: 10 }, protein: { averageG: 120, daysUsed: 8, partialDays: 2 }, carbs: { averageG: null, daysUsed: 0, partialDays: 0 }, fat: { averageG: null, daysUsed: 0, partialDays: 0 } }, dataQuality: "PARTIAL" });
  const t = renderProgressReview(review({ n: nutritionState(n) }), "NUTRITION_READBACK", "Protein trung bình của tôi gần đây là bao nhiêu?");
  assert.match(t, /Trong các ngày có dữ liệu \(10\/28 ngày\)/);
  assert.match(t, /tính trên 8 ngày có protein/);
  assert.doesNotMatch(t, /Trong 28 ngày gần đây/);
});

test("NUTRITION TARGET CHANGED: noted, not compared as if unchanged", () => {
  const t = renderProgressReview(review({ n: nutritionState(nutrition({ targetChangedInWindow: true })) }), "NUTRITION_READBACK", "Calo trung bình của tôi gần đây?");
  assert.match(t, /đã thay đổi trong khoảng này/);
  assert.match(t, /không thể so toàn bộ khoảng với mục tiêu hiện tại/);
});

test("ONE SLICE ERROR: other domains reviewed; nutrition 'could not be read' — never 'no data'", () => {
  const r = review({ b: bodyGoalState(), t: trainingState(), errN: true });
  assert.equal(r.domains.NUTRITION.state, "ERROR");
  assert.equal(r.overallCoverage, "PARTIAL");
  const t = renderProgressReview(r, "HOLISTIC", "Tôi có tiến triển không?");
  assert.match(t, /8\/9 buổi/);
  assert.match(t, /Ăn uống: hiện mình chưa đọc được dữ liệu này/);
  assert.doesNotMatch(t, /chưa có nhật ký|chưa có dữ liệu để đánh giá/);
});

test("NO DATA ANYWHERE: truthful insufficient-data answer; nothing fabricated", () => {
  const g = goal({ currentTarget: { state: "NO_TARGET" }, gap: { state: "NOT_AVAILABLE", reason: "NO_TARGET" }, type: undefined, dataQuality: "NO_DATA" });
  const r = review({ b: bodyGoalState(BODY_NO_DATA, g), t: trainingState(TRAINING_NO_DATA), n: nutritionState(NUTRITION_NO_DATA) });
  assert.equal(r.overallCoverage, "INSUFFICIENT");
  const t = renderProgressReview(r, "HOLISTIC", "Tôi có tiến triển không?");
  assert.match(t, /chưa đủ dữ liệu để đánh giá tiến triển/);
  assert.doesNotMatch(t, /\d+ kg|\d+%|tốt|kém/);
});

// ── C. narration validation & budget ─────────────────────────────────────

test("narration validator rejects: muscle mass, causal, prescriptive, invented number, on-track, plateau, sleep", () => {
  const r = FULL();
  const bad: Array<[string, string]> = [
    ["Khối lượng cơ xương của bạn tăng.", "muscle_mass_claim"],
    ["Bạn giảm cân vì ăn đúng calorie.", "causal_claim"],
    ["Cân nặng giảm nhờ bạn tập đều.", "causal_claim"],
    ["Bạn nên giảm thêm 300 kcal mỗi ngày.", "prescriptive_claim"],
    ["Cân nặng đã giảm 6 kg.", "number_not_in_evidence"],
    ["Bạn đang đúng tiến độ.", "on_track_claim"],
    ["Bạn đang plateau.", "plateau_claim"],
    ["Bạn ngủ chưa đủ.", "unsupported_domain"],
    ["Bạn sẽ đạt mục tiêu vào tháng 12.", "number_not_in_evidence"],
    ["Bạn đang giảm mỡ rất tốt.", "fat_loss_claim_unsupported"],
  ];
  for (const [text, reason] of bad) {
    const v = validateReviewNarration(text, r);
    assert.equal(v.ok, false, text);
    if (reason !== "number_not_in_evidence" || /\d/.test(text)) assert.ok(v.reason, text);
  }
  assert.equal(validateReviewNarration("Bạn hoàn thành 8/9 buổi, cân nặng giảm 4 kg qua 46 ngày và đang di chuyển theo hướng mục tiêu. Mình chưa xác định được tiến độ theo hạn chót.", r).ok, true);
  assert.equal(validateReviewNarration("Mình chưa thể nói bạn có đúng tiến độ hay không.", r).ok, true, "a negated on-track sentence is allowed");
});

type Counters = { llm: number; narr: number };
async function withStubs(opts: { narrate?: (r: ProgressReviewV0) => Promise<string | null>; byUrl?: (url: string, auth: string) => any }, fn: (c: Counters, urls: string[]) => Promise<void>) {
  const origGet = axios.get, origCall = llmService.callLLM, origNarr = progressReviewDeps.narrate, origFlag = process.env.GYMINI_UNIFIED_AI_COACH;
  const c: Counters = { llm: 0, narr: 0 };
  const urls: string[] = [];
  (llmService as any).callLLM = async () => { c.llm++; return { answer: "{}" }; };
  progressReviewDeps.narrate = async (r) => { c.narr++; return opts.narrate ? opts.narrate(r) : null; };
  (axios as any).get = async (url: string, cfg: any) => {
    urls.push(url);
    const auth = cfg?.headers?.Authorization ?? "";
    if (opts.byUrl) { const v = opts.byUrl(url, auth); if (v !== undefined) { if (v instanceof Error) throw v; return { data: v }; } }
    if (url.includes("/stats/body-goal-state")) return { data: upstreamBodyGoal() };
    if (url.includes("/stats/training-window")) return { data: training() };
    if (url.includes("/nutrition/analytics/window")) return { data: { ...nutrition(), actual: { days: [], summary: nutrition().actual } } };
    throw new Error(`unexpected GET ${url}`);
  };
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  try { await fn(c, urls); } finally {
    axios.get = origGet; llmService.callLLM = origCall; progressReviewDeps.narrate = origNarr;
    if (origFlag === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = origFlag;
  }
}
const id = (u = "u1") => ({ userId: u, authorizationHeader: `Bearer token-${u}` }) as any;

// the real upstream shapes the reader validates (body-goal-state is flat: {asOf, lookbackDays, body, goal})
function upstreamBodyGoal() { const s = bodyGoalState(); return { asOf: "2026-10-10T12:00:00.000Z", lookbackDays: 90, body: s.body, goal: { ...s.goal } }; }
function upstreamNutrition() { const n = nutrition(); return { period: n.period, activeTarget: n.activeTarget, targetChangedInWindow: n.targetChangedInWindow, actual: { days: [], summary: n.actual }, adherence: n.adherence, dataQuality: n.dataQuality }; }
const route = (over: { body?: any; nutrition?: any; training?: any } = {}) => (url: string, _auth?: string) => {
  if (url.includes("/stats/body-goal-state")) return over.body ?? upstreamBodyGoal();
  if (url.includes("/stats/training-window")) return over.training ?? training();
  if (url.includes("/nutrition/analytics/window")) return over.nutrition ?? upstreamNutrition();
  return undefined;
};

test("CALL BUDGET: direct readbacks = 0 model calls; holistic ≤ 1; CoachState/evidence construction 0", async () => {
  await withStubs({ byUrl: route() }, async (c) => {
    for (const q of ["Tôi còn cách mục tiêu bao nhiêu kg?", "Cân gần nhất của tôi là bao nhiêu?", "Protein trung bình của tôi gần đây là bao nhiêu?", "Tôi có đúng tiến độ không?"]) {
      const a = await answerProgressReview(id(), q);
      assert.equal(a.facts.llmCalls, 0, q);
    }
    assert.equal(c.llm, 0);
    assert.equal(c.narr, 0);
    const h = await answerProgressReview(id(), "Dạo này tình hình của tôi thế nào?");
    assert.equal(h.facts.llmCalls, 1);
    assert.equal(c.narr, 1);
  });
});

test("holistic narration: valid wording used with code-appended limitations; failure/hallucination → deterministic fallback", async () => {
  const good = "Bạn hoàn thành 8/9 buổi theo lịch, cân nặng đo được giảm 4 kg và đang di chuyển theo hướng mục tiêu.";
  await withStubs({ byUrl: route(), narrate: async () => good }, async () => {
    const a = await answerProgressReview(id(), "Dạo này tình hình của tôi thế nào?");
    assert.equal(a.facts.usedNarration, true);
    assert.match(a.text, /8\/9 buổi theo lịch/);
    assert.match(a.text, /chưa xác định được bạn có đúng tiến độ/, "deadline limitation appended by code");
  });
  for (const bad of ["Bạn giảm cân vì ăn đúng calorie.", "Giảm thêm 300 kcal mỗi ngày.", "Cơ xương của bạn tăng 2 kg.", "Bạn đã giảm 6 kg."]) {
    await withStubs({ byUrl: route(), narrate: async () => bad }, async (c) => {
      const a = await answerProgressReview(id(), "Dạo này tình hình của tôi thế nào?");
      assert.equal(c.narr, 1);
      assert.equal(a.facts.usedNarration, false, bad);
      assert.equal(a.facts.fallbackUsed, true);
      assert.match(a.text, /8\/9 buổi/);
      assert.doesNotMatch(a.text, /vì ăn|300 kcal|cơ xương|6 kg/);
    });
  }
  await withStubs({ byUrl: route(), narrate: async () => { throw new Error("timeout"); } }, async () => {
    const a = await answerProgressReview(id(), "Dạo này tình hình của tôi thế nào?");
    assert.equal(a.facts.usedNarration, false);
    assert.match(a.text, /8\/9 buổi/);
  });
});

test("DEMAND-DRIVEN: only the slices a class needs are fetched, each once", async () => {
  const fetched = async (q: string) => { let u: string[] = []; await withStubs({ byUrl: route() }, async (_c, urls) => { await answerProgressReview(id(), q); u = urls; }); return u; };
  const gap = await fetched("Tôi còn cách mục tiêu bao nhiêu kg?");
  assert.deepEqual(gap.map((x) => x.replace(/^.*(\/stats\/[a-z-]+|\/nutrition\/analytics\/window).*$/, "$1")), ["/stats/body-goal-state"]);
  const nut = await fetched("Protein trung bình của tôi gần đây là bao nhiêu?");
  assert.equal(nut.length, 1);
  assert.match(nut[0], /\/nutrition\/analytics\/window$/);
  const all = await fetched("Dạo này tình hình của tôi thế nào?");
  assert.equal(all.length, 3);
  assert.equal(new Set(all).size, 3);
});

test("UPSTREAM ERROR on one slice via the real readers: partial review, error ≠ no-data", async () => {
  await withStubs({ byUrl: (url, a) => (url.includes("/nutrition/analytics/window") ? Object.assign(new Error("boom"), { response: { status: 500 } }) : route()(url, a)) }, async () => {
    const a = await answerProgressReview(id(), "Dạo này tình hình của tôi thế nào?");
    assert.match(a.text, /8\/9 buổi/);
    assert.match(a.text, /Ăn uống: hiện mình chưa đọc được/);
    assert.equal((a.facts.domains as any).NUTRITION.state, "ERROR");
  });
});

test("CROSS-USER: B's review contains none of A's metrics", async () => {
  const noBody = { asOf: "2026-10-10T12:00:00.000Z", lookbackDays: 90, body: BODY_NO_DATA, goal: { ...goal({ currentTarget: { state: "NO_TARGET" }, gap: { state: "NOT_AVAILABLE", reason: "NO_TARGET" }, type: undefined, dataQuality: "NO_DATA" }) } };
  await withStubs({
    byUrl: (url, auth) => {
      if (auth !== "Bearer token-a") {
        if (url.includes("/stats/body-goal-state")) return noBody;
        if (url.includes("/stats/training-window")) return TRAINING_NO_DATA;
        if (url.includes("/nutrition/analytics/window")) return { ...upstreamNutrition(), ...{ actual: { days: [], summary: NUTRITION_NO_DATA.actual }, adherence: NUTRITION_NO_DATA.adherence, dataQuality: "NO_DATA", activeTarget: { state: "NO_ACTIVE_TARGET" } } };
      }
      return route()(url, auth);
    },
  }, async () => {
    const a = await answerProgressReview(id("a"), "Dạo này tình hình của tôi thế nào?");
    const b = await answerProgressReview(id("b"), "Dạo này tình hình của tôi thế nào?");
    assert.match(a.text, /8\/9 buổi/);
    assert.doesNotMatch(b.text, /8\/9|78 kg|75 kg|2\.000|Bench/);
    assert.match(b.text, /chưa đủ dữ liệu/);
  });
});

// ── D. end-to-end through the real orchestrator ─────────────────────────

async function world() {
  const { fitnessAgent, fitnessAgentDeps } = await import("../services/fitness-agent.service");
  const { readerDeps } = await import("../conversational-intelligence/global/readers");
  const { prisma } = await import("../repositories/conversation.repository");
  return { fitnessAgent, fitnessAgentDeps, readerDeps, prisma };
}

test("tryTurn: pending PT workflow survives a progress review and resumes once; no business write", skipDb, async () => {
  const { fitnessAgent, fitnessAgentDeps, readerDeps, prisma } = await world();
  const saved = { ctx: fitnessAgentDeps.tools.getUserFitnessContext, upd: fitnessAgentDeps.tools.updateProfileFields, pt: fitnessAgentDeps.tools.findPTCandidates, ex: fitnessAgentDeps.profileExtractor.extract, get: readerDeps.get, ax: axios.get, ci: process.env.CONVERSATIONAL_INTELLIGENCE_V2, uc: process.env.GYMINI_UNIFIED_AI_COACH, nr: progressReviewDeps.narrate };
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; process.env.GYMINI_UNIFIED_AI_COACH = "on";
  const writes: unknown[] = []; const searches: unknown[] = [];
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "WEIGHT_LOSS", age: 22, gender: "MALE", heightCm: 173, currentWeight: 80, days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null, injuries: [], equipment: [], experience: "BEGINNER" }, coach: {} } as any);
  fitnessAgentDeps.tools.updateProfileFields = async (_i: any, f: any) => { writes.push(f); return {}; };
  fitnessAgentDeps.tools.findPTCandidates = async (_i: any, p: any) => { searches.push(p); return { candidates: [], truncated: false, historyAuditId: "h", preferences: p } as any; };
  fitnessAgentDeps.profileExtractor.extract = (async () => ({ profile: { goal: "WEIGHT_LOSS" } })) as any;
  readerDeps.get = async () => ({ status: 404, data: {} });
  progressReviewDeps.narrate = async () => null; // deterministic path
  (axios as any).get = async (url: string, cfg: any) => {
    const v = route()(url, cfg?.headers?.Authorization ?? "");
    if (v === undefined) throw new Error(`unexpected GET ${url}`);
    return { data: v };
  };
  const userId = `t45-p-${randomUUID()}`;
  const s = await prisma.chatSession.create({ data: { userId, title: "t45" } });
  const ident = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    await fitnessAgent.tryTurn("Tìm PT cho tôi.", ident, s.id);
    const before = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(before?.expectedSlot, "budgetVnd");
    const r = await fitnessAgent.tryTurn("Dạo này tình hình của tôi thế nào?", ident, s.id);
    assert.match(r!.answer, /8\/9 buổi/);
    assert.match(r!.answer, /Bạn vẫn đang tìm PT dở/);
    const after = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(after?.id, before?.id);
    assert.equal(after?.expectedSlot, "budgetVnd");
    assert.equal(writes.length, 0);
    assert.equal(searches.length, 0);
    await fitnessAgent.tryTurn("2 triệu.", ident, s.id);
    assert.equal(searches.length, 1, "workflow resumed exactly once");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: s.id } });
    Object.assign(fitnessAgentDeps.tools, { getUserFitnessContext: saved.ctx, updateProfileFields: saved.upd, findPTCandidates: saved.pt });
    fitnessAgentDeps.profileExtractor.extract = saved.ex; readerDeps.get = saved.get; axios.get = saved.ax; progressReviewDeps.narrate = saved.nr;
    if (saved.ci === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = saved.ci;
    if (saved.uc === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = saved.uc;
  }
});

test("tryTurn OFF mode / unrelated domains: no CoachState slice is fetched; legacy behaviour kept", skipDb, async () => {
  const { fitnessAgent, fitnessAgentDeps, readerDeps, prisma } = await world();
  const saved = { ctx: fitnessAgentDeps.tools.getUserFitnessContext, ex: fitnessAgentDeps.profileExtractor.extract, get: readerDeps.get, ax: axios.get, ci: process.env.CONVERSATIONAL_INTELLIGENCE_V2, uc: process.env.GYMINI_UNIFIED_AI_COACH };
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on";
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "WEIGHT_LOSS" }, coach: {} } as any);
  fitnessAgentDeps.profileExtractor.extract = (async () => ({ profile: { goal: "WEIGHT_LOSS", nutritionGoal: { calories: 2187, protein: 193, carbs: 201, fat: 68 } } })) as any;
  readerDeps.get = async (url: string) => (url.endsWith("/nutrition/goals") ? { status: 200, data: { id: "g", calories: 2187, protein: 193, carbs: 201, fat: 68, status: "ACTIVE" } } : { status: 404, data: {} });
  let coachFetches = 0;
  (axios as any).get = async (url: string) => { if (/stats\/(body-goal-state|training-window)|nutrition\/analytics/.test(url)) coachFetches++; return { data: {} }; };
  const userId = `t45-o-${randomUUID()}`;
  const s = await prisma.chatSession.create({ data: { userId, title: "t45" } });
  const ident = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    process.env.GYMINI_UNIFIED_AI_COACH = "on";
    await fitnessAgent.tryTurn("Macro hiện tại của tôi bao nhiêu?", ident, s.id);
    await fitnessAgent.tryTurn("Tôi đang có PT chưa?", ident, s.id);
    assert.equal(coachFetches, 0);
    delete process.env.GYMINI_UNIFIED_AI_COACH;
    await fitnessAgent.tryTurn("Dạo này tình hình của tôi thế nào?", ident, s.id);
    assert.equal(coachFetches, 0, "flag off never fetches CoachState");
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: s.id } });
    Object.assign(fitnessAgentDeps.tools, { getUserFitnessContext: saved.ctx });
    fitnessAgentDeps.profileExtractor.extract = saved.ex; readerDeps.get = saved.get; axios.get = saved.ax;
    if (saved.ci === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = saved.ci;
    if (saved.uc === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = saved.uc;
  }
});

test.after(async () => {
  if (canUseDb) { const { prisma } = await import("../repositories/conversation.repository"); await prisma.$disconnect(); }
});
void okRead; void toSlice;
