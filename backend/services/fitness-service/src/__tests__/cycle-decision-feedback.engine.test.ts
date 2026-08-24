/**
 * Phase 5 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — feedback-driven
 * rules in cycle-decision.engine.ts's applyFeedbackInfluence. Mirrors the
 * fixture style of cycle-decision.engine.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCycle, type DecisionEngineInput, type FeedbackSignalsInput, type AiFeedbackAnalysisSignal } from "../services/cycle-decision.engine";
import type { CycleMetricsResult } from "../services/cycle-metrics.engine";
import type { InBodyQualityResult } from "../services/inbody-quality.evaluator";
import type { CycleFeedbackSummaryResult } from "../services/cycle-feedback-aggregator";

function baseInBodyQuality(overrides: Partial<InBodyQualityResult> = {}): InBodyQualityResult {
  return {
    recordCount: 3,
    comparableRecordCount: 3,
    hasSufficientData: true,
    outlierFlags: [],
    intervalWarnings: [],
    deviceConsistencyWarning: null,
    weightWaterConflict: false,
    confidenceMultiplier: 1,
    qualityFlags: [],
    comparablePoints: [],
    ...overrides,
  };
}

function baseMetrics(overrides: Partial<CycleMetricsResult> = {}): CycleMetricsResult {
  return {
    adherenceRate: 0.85,
    completionRate: 0.85,
    hasScheduledSessions: true,
    workoutsPerWeek: 4,
    weeklyVolumeByMuscleGroup: [],
    volumeTrendPercent: 3,
    volumeProgressionSlope: 2.5,
    missedSessionCount: 2,
    nutritionConsistencyScore: 0.8,
    exerciseProgression: [],
    estimated1RmTrend: [],
    strengthProgressScore: 0.55,
    performanceConsistencyScore: 0.8,
    averageSessionRpe: 7,
    rpeTrend: "stable",
    averageRir: null,
    rirTrend: "stable",
    painTrend: null,
    averagePainScore: null,
    fatigueScore: 0.4,
    recoveryScore: 0.7,
    bodyWeightTrend: null,
    skeletalMuscleTrend: null,
    bodyFatTrend: null,
    goalProgressScore: 0.6,
    dataCompletenessScore: 0.9,
    dataQualityScore: 0.9,
    newPRs: [],
    inBodyQuality: baseInBodyQuality(),
    ...overrides,
  };
}

function baseInput(overrides: Partial<DecisionEngineInput> = {}): DecisionEngineInput {
  return {
    cycleDurationDays: 30,
    completedSessions: 12,
    metrics: baseMetrics(),
    ...overrides,
  };
}

function feedbackSummary(overrides: Partial<CycleFeedbackSummaryResult> = {}): CycleFeedbackSummaryResult {
  return {
    cycleId: "cycle-1",
    totalSessions: 10,
    completedSessions: 8,
    partialSessions: 0,
    skippedSessions: 1,
    cancelledSessions: 1,
    feedbackSubmittedCount: 6,
    feedbackMissingCount: 4,
    feedbackCompletionRate: 0.6,
    averageSessionRating: 3,
    averageDifficultyScore: 0.5,
    averageEnjoymentScore: 0.5,
    averageFatigue: 5,
    averagePain: 2,
    mostCommonIssues: [],
    mostLikedExercises: [],
    mostDislikedExercises: [],
    exercisesWithPainReports: [],
    sessionsMarkedTooHard: 0,
    sessionsMarkedTooEasy: 0,
    sessionsUserWouldNotRepeat: 0,
    positiveFeedbackCount: 0,
    negativeFeedbackCount: 0,
    neutralFeedbackCount: 6,
    mixedFeedbackCount: 0,
    feedbackSentimentByRules: "neutral",
    dataQualityScore: 0.6,
    safetyFlags: [],
    equipmentMismatchFlags: [],
    adherenceRelatedComplaintFlags: [],
    motivationOrBoredomFlags: [],
    ...overrides,
  };
}

function aiSignal(overrides: Partial<AiFeedbackAnalysisSignal> = {}): AiFeedbackAnalysisSignal {
  return {
    complaintValidity: "supported_by_data",
    recommendedDecisionInfluence: "adjust",
    complaintCategories: [],
    riskFlags: [],
    ...overrides,
  };
}

// ── Backward compatibility ───────────────────────────────────────────────────

test("feedbackSignals omitted -> byte-identical to the pre-Phase-5 engine (feedbackInfluenceApplied=false)", () => {
  const withoutFeedback = evaluateCycle(baseInput());
  assert.equal(withoutFeedback.feedbackInfluenceApplied, false);
  assert.equal(withoutFeedback.decisionInfluenceFromFeedback, "none");
});

// ── "chê nặng" + high RPE + rising pain -> ADJUST/DELOAD ────────────────────

test("too_hard complaint + rising pain + increasing RPE -> escalates KEEP to DELOAD", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ rpeTrend: "increasing", painTrend: { direction: "up", weeklyAverages: [] } as any }),
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ sessionsMarkedTooHard: 4, feedbackSubmittedCount: 6 }),
        aiFeedbackAnalysis: aiSignal(),
      },
    }),
  );
  assert.equal(result.decision, "DELOAD");
  assert.equal(result.decisionInfluenceFromFeedback, "deload");
  assert.ok(result.reasonCodes.includes("FEEDBACK_TOO_HARD_WITH_RISING_PAIN_OR_RPE"));
  assert.equal(result.feedbackInfluenceApplied, true);
});

test("too_hard complaint with only ONE corroborating signal (RPE, no pain) -> escalates to ADJUST, not all the way to DELOAD", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ rpeTrend: "increasing" }),
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ sessionsMarkedTooHard: 4, feedbackSubmittedCount: 6 }),
      },
    }),
  );
  assert.equal(result.decision, "ADJUST");
  assert.equal(result.decisionInfluenceFromFeedback, "adjust");
});

// ── "chê dễ" + high adherence + low RPE + stable volume -> PROGRESS ─────────

test("too_easy complaint + high adherence + stable RPE/volume -> upgrades KEEP to PROGRESS", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ adherenceRate: 0.95, rpeTrend: "stable", volumeTrendPercent: 2 }),
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ sessionsMarkedTooEasy: 4, feedbackSubmittedCount: 6 }),
        aiFeedbackAnalysis: aiSignal({ complaintValidity: "supported_by_data" }),
      },
    }),
  );
  assert.equal(result.decision, "PROGRESS");
  assert.equal(result.decisionInfluenceFromFeedback, "minor_adjust");
});

test("too_easy complaint does NOT downgrade an already-DELOAD decision", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({
        adherenceRate: 0.95,
        fatigueScore: 0.9,
        recoveryScore: 0.1,
        goalProgressScore: 0.1,
        strengthProgressScore: 0.1,
      }),
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ sessionsMarkedTooEasy: 4, feedbackSubmittedCount: 6 }),
      },
    }),
  );
  assert.equal(result.decision, "DELOAD"); // metrics-driven DELOAD stands; feedback never downgrades it
});

// ── Equipment complaint -> ADJUST for exercise substitution ─────────────────

test("equipment mismatch complaint escalates KEEP to ADJUST", () => {
  const result = evaluateCycle(
    baseInput({
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ equipmentMismatchFlags: ["REPEATED_EQUIPMENT_UNAVAILABLE"] }),
      },
    }),
  );
  assert.equal(result.decision, "ADJUST");
  assert.ok(result.reasonCodes.includes("FEEDBACK_EQUIPMENT_MISMATCH_NEEDS_SUBSTITUTION"));
});

// ── Boredom + good progress -> MINOR_ADJUST scope only, decision unchanged ──

test("boredom complaint with otherwise-good progress keeps PROGRESS decision but bumps action scope to minor_adjustment", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ goalProgressScore: 0.9, strengthProgressScore: 0.9, performanceConsistencyScore: 0.9, volumeTrendPercent: 15 }),
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ motivationOrBoredomFlags: ["REPEATED_BOREDOM_REPORTS"] }),
      },
    }),
  );
  assert.equal(result.decision, "PROGRESS"); // decision itself doesn't change
  assert.equal(result.decisionInfluenceFromFeedback, "minor_adjust");
  assert.ok(result.reasonCodes.includes("FEEDBACK_BOREDOM_SUGGESTS_EXERCISE_VARIATION"));
});

// ── Praise but high pain -> safety override ──────────────────────────────────

test("positive overall sentiment but high average pain forces ADJUST, not left at KEEP", () => {
  const result = evaluateCycle(
    baseInput({
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ feedbackSentimentByRules: "positive", averagePain: 8, safetyFlags: ["HIGH_PAIN_REPORTED"] }),
      },
    }),
  );
  assert.equal(result.decision, "ADJUST");
  assert.ok(result.safetyFlags.some((f) => f.code === "FEEDBACK_POSITIVE_SENTIMENT_BUT_HIGH_PAIN"));
});

test("positive overall sentiment but SEVERE average pain escalates all the way to DELOAD", () => {
  const result = evaluateCycle(
    baseInput({
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ feedbackSentimentByRules: "positive", averagePain: 9.5, safetyFlags: ["HIGH_PAIN_REPORTED"] }),
      },
    }),
  );
  assert.equal(result.decision, "DELOAD");
  assert.ok(result.safetyFlags.some((f) => f.code === "FEEDBACK_POSITIVE_SENTIMENT_BUT_HIGH_PAIN" && f.severity === "critical"));
});

// ── Missing / low-quality feedback -> no strong change ──────────────────────

test("feedback below the data-quality bar does not influence the decision at all", () => {
  const withoutFeedback = evaluateCycle(baseInput());
  const withWeakFeedback = evaluateCycle(
    baseInput({
      feedbackSignals: {
        // Only 1 submission, low dataQualityScore -> below the trust bar,
        // even though it superficially "complains too hard."
        cycleFeedbackSummary: feedbackSummary({ sessionsMarkedTooHard: 1, feedbackSubmittedCount: 1, dataQualityScore: 0.1 }),
      },
    }),
  );
  assert.equal(withWeakFeedback.decision, withoutFeedback.decision);
  assert.equal(withWeakFeedback.decisionInfluenceFromFeedback, "none");
});

test("zero feedback submitted at all -> unchanged decision, no spurious reason codes", () => {
  const result = evaluateCycle(
    baseInput({
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ feedbackSubmittedCount: 0, dataQualityScore: 0 }),
      },
    }),
  );
  assert.equal(result.feedbackInfluenceApplied, false);
});

// ── AI complaintValidity gate — a complaint is never automatically trusted ──

test("AI complaintValidity=not_supported suppresses an otherwise-majority too_hard complaint", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ rpeTrend: "increasing" }),
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ sessionsMarkedTooHard: 4, feedbackSubmittedCount: 6 }),
        aiFeedbackAnalysis: aiSignal({ complaintValidity: "not_supported" }),
      },
    }),
  );
  assert.equal(result.decision, "KEEP"); // complaint not trusted -> base decision stands
  assert.equal(result.decisionInfluenceFromFeedback, "none");
});

// ── Beginner safety margin ────────────────────────────────────────────────────

test("beginner needs a higher adherence bar than an advanced lifter before a too_easy complaint upgrades to PROGRESS", () => {
  const marginalAdherence = 0.75; // above the base 0.7 bar, below beginner's 0.7+0.1=0.8 bar
  const feedback: FeedbackSignalsInput = {
    cycleFeedbackSummary: feedbackSummary({ sessionsMarkedTooEasy: 4, feedbackSubmittedCount: 6 }),
  };

  const beginnerResult = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ adherenceRate: marginalAdherence, rpeTrend: "stable", volumeTrendPercent: 2 }),
      experienceLevel: "BEGINNER",
      feedbackSignals: feedback,
    }),
  );
  const advancedResult = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ adherenceRate: marginalAdherence, rpeTrend: "stable", volumeTrendPercent: 2 }),
      experienceLevel: "ADVANCED",
      feedbackSignals: feedback,
    }),
  );

  assert.equal(beginnerResult.decision, "KEEP"); // margin not met for a beginner
  assert.equal(advancedResult.decision, "PROGRESS"); // margin met for a non-beginner
});

// ── Professional stricter feedback data-quality gate ─────────────────────────

test("professional (ADVANCED + competesInSport) requires higher feedback dataQualityScore than a recreational lifter", () => {
  const feedback: FeedbackSignalsInput = {
    cycleFeedbackSummary: feedbackSummary({ sessionsMarkedTooHard: 4, feedbackSubmittedCount: 6, dataQualityScore: 0.5 }),
  };

  const recreationalResult = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ rpeTrend: "increasing" }),
      experienceLevel: "ADVANCED",
      competesInSport: false,
      feedbackSignals: feedback,
    }),
  );
  const professionalResult = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ rpeTrend: "increasing" }),
      experienceLevel: "ADVANCED",
      competesInSport: true,
      feedbackSignals: feedback,
    }),
  );

  assert.equal(recreationalResult.decisionInfluenceFromFeedback, "adjust"); // 0.5 clears the 0.34 bar
  assert.equal(professionalResult.decisionInfluenceFromFeedback, "none"); // 0.5 does NOT clear the 0.6 professional bar
});

test("professional requires the AI's strictest supported_by_data tier (not partially_supported) for the PROGRESS-from-feedback rule", () => {
  const feedback: FeedbackSignalsInput = {
    cycleFeedbackSummary: feedbackSummary({ sessionsMarkedTooEasy: 4, feedbackSubmittedCount: 6, dataQualityScore: 0.9 }),
    aiFeedbackAnalysis: aiSignal({ complaintValidity: "partially_supported" }),
  };
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ adherenceRate: 0.95, rpeTrend: "stable", volumeTrendPercent: 2 }),
      experienceLevel: "ADVANCED",
      competesInSport: true,
      feedbackSignals: feedback,
    }),
  );
  assert.equal(result.decision, "KEEP"); // partially_supported isn't enough for a professional's PROGRESS call
});

// ── Never fabricates REBUILD from feedback alone ─────────────────────────────

test("feedback never escalates a decision all the way to REBUILD by itself, even with AI rebuild_consideration", () => {
  const result = evaluateCycle(
    baseInput({
      metrics: baseMetrics({ rpeTrend: "increasing", painTrend: { direction: "up", weeklyAverages: [] } as any }),
      feedbackSignals: {
        cycleFeedbackSummary: feedbackSummary({ sessionsMarkedTooHard: 4, feedbackSubmittedCount: 6 }),
        aiFeedbackAnalysis: aiSignal({ recommendedDecisionInfluence: "rebuild_consideration" }),
      },
    }),
  );
  assert.notEqual(result.decision, "REBUILD");
  assert.equal(result.decision, "DELOAD"); // the worst feedback rules can do is DELOAD
});
