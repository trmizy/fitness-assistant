import { cycleThresholds } from "../config/cycle-thresholds.config";
import type { CycleMetricsResult } from "./cycle-metrics.engine";
import type { CycleFeedbackSummaryResult } from "./cycle-feedback-aggregator";

export type CycleDecision = "KEEP" | "PROGRESS" | "ADJUST" | "DELOAD" | "REBUILD" | "INSUFFICIENT_DATA";
export type ActionScope = "none" | "minor_adjustment" | "deload" | "full_rebuild";
export type DecisionInfluence = "none" | "minor_adjust" | "adjust" | "deload" | "rebuild_consideration";

export interface SafetyFlag {
  code: string;
  severity: "warning" | "critical";
  message: string;
}

export interface DecisionEngineResult {
  decision: CycleDecision;
  confidenceScore: number; // 0-1
  reasonCodes: string[];
  supportingMetrics: Record<string, unknown>;
  conflictingSignals: string[];
  safetyFlags: SafetyFlag[];
  recommendedActionScope: ActionScope;
  /** Phase 5 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — true only when
   * feedbackSignals were present, passed the data-quality gate, and at
   * least one feedback rule actually changed the decision/scope/reasonCodes
   * from what the metrics-only engine would have produced. */
  feedbackInfluenceApplied: boolean;
  /** Advisory summary of how much feedback moved the needle, for
   * RecommendationAudit — "none" whenever feedbackInfluenceApplied is
   * false. Never "rebuild_consideration" as an actual decision (feedback
   * alone never triggers REBUILD — see applyFeedbackInfluence). */
  decisionInfluenceFromFeedback: DecisionInfluence;
}

/** Minimal, decoupled view of ai-service's AnalyzeFeedbackOutput — this
 * engine file has no HTTP/DB dependency and must stay that way, so only the
 * fields the rules below actually read are declared here rather than
 * importing ai.client.ts's full result type. */
export interface AiFeedbackAnalysisSignal {
  complaintValidity: "supported_by_data" | "partially_supported" | "not_supported" | "insufficient_data";
  recommendedDecisionInfluence: DecisionInfluence;
  complaintCategories: string[];
  riskFlags: string[];
}

export interface FeedbackSignalsInput {
  /** Deterministic, rule-computed summary (cycle-feedback-aggregator.ts) —
   * the primary source of truth for feedback-driven rules below. */
  cycleFeedbackSummary: CycleFeedbackSummaryResult;
  /** Optional — when absent, rules fall back to the rule-based
   * majority-fraction thresholds alone instead of the AI's complaintValidity
   * gate (still conservative, just without the AI's cross-check). */
  aiFeedbackAnalysis?: AiFeedbackAnalysisSignal;
}

export type ExperienceLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "UNKNOWN";

export interface DecisionEngineInput {
  cycleDurationDays: number;
  completedSessions: number;
  metrics: CycleMetricsResult;
  /** Most-recent-first prior cycle decisions for this user's cycle lineage —
   * used only for the REBUILD "two consecutive cycles missed the goal" rule. */
  priorCycleDecisions?: CycleDecision[];
  /** Set by the caller when the user's stated goal/equipment/training-days
   * changed since the prior cycle — a REBUILD trigger the engine itself
   * cannot infer from metrics alone. */
  goalOrContextChangedSincePriorCycle?: boolean;
  /** User's training level, from UserProfile.experienceLevel. UNKNOWN/absent
   * is treated exactly like BEGINNER throughout this engine — never
   * silently upgraded to INTERMEDIATE (see docs/USER_LEVEL_PERSONALIZATION_PLAN.md §0). */
  experienceLevel?: ExperienceLevel;
  /** UserProfile.competesInSport — "professional/competitive" is modeled as
   * ADVANCED + this flag, not a 5th experienceLevel value (ACSM's
   * progression model only distinguishes 3 levels; see plan doc §0). Only
   * has an effect when experienceLevel is ADVANCED. */
  competesInSport?: boolean;
  /** Phase 5 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — optional and
   * fully backward compatible: omitting this field produces byte-identical
   * output to before this field existed (see applyFeedbackInfluence). */
  feedbackSignals?: FeedbackSignalsInput;
}

/** Pain/injury safety flags — deterministic, evaluated independently of and
 * BEFORE the decision logic below, so a high-pain signal always suppresses
 * load-increase recommendations regardless of how strong other signals
 * look. Not a diagnosis — flags + defers to a professional, per spec §10. */
function evaluateSafetyFlags(metrics: CycleMetricsResult): SafetyFlag[] {
  const t = cycleThresholds.assessment;
  const flags: SafetyFlag[] = [];

  if (metrics.averagePainScore != null && metrics.averagePainScore >= t.highPainScore) {
    flags.push({
      code: "HIGH_PAIN_SCORE",
      severity: "critical",
      message: `Average reported pain score (${metrics.averagePainScore}/10) is at or above the high-pain threshold (${t.highPainScore}). Do not increase load; recommend stopping any exercise that reproduces the pain and consulting a qualified medical/physio professional before continuing.`,
    });
  } else if (metrics.painTrend?.direction === "up") {
    flags.push({
      code: "RISING_PAIN_TREND",
      severity: "warning",
      message: "Reported pain has been trending upward across the cycle. Do not increase load on affected movements; monitor closely.",
    });
  }

  // Sudden performance drop + abnormal physical state together (not either
  // alone) — the spec explicitly says a single InBody change must not
  // trigger a medical-style warning by itself.
  const sharpDecline =
    (metrics.goalProgressScore != null && metrics.goalProgressScore < 0.2) ||
    (metrics.strengthProgressScore != null && metrics.strengthProgressScore < 0.2);
  if (sharpDecline && metrics.fatigueScore != null && metrics.fatigueScore >= 0.75) {
    flags.push({
      code: "SHARP_PERFORMANCE_DROP_WITH_HIGH_FATIGUE",
      severity: "warning",
      message: "Performance dropped sharply alongside a high fatigue signal. This combination warrants a deload and, if it persists, a check-in with a coach or medical professional — not a diagnosis of the cause.",
    });
  }

  return flags;
}

interface Gate {
  fires: boolean;
  reasonCode: string;
}

/** INSUFFICIENT_DATA gates — checked first; any one firing short-circuits
 * the rest of the decision logic. Each condition mirrors spec §5 verbatim. */
function evaluateInsufficientDataGates(input: DecisionEngineInput, isProfessional: boolean): Gate[] {
  const t = cycleThresholds.assessment;
  const { metrics } = input;
  return [
    { fires: input.cycleDurationDays < t.minimumCycleDays, reasonCode: "CYCLE_TOO_SHORT" },
    { fires: input.completedSessions < t.minimumCompletedSessions, reasonCode: "TOO_FEW_COMPLETED_SESSIONS" },
    { fires: metrics.adherenceRate < t.minimumAdherenceRate, reasonCode: "ADHERENCE_TOO_LOW_TO_JUDGE_PROGRAM" },
    {
      fires: !metrics.inBodyQuality.hasSufficientData && metrics.goalProgressScore == null,
      reasonCode: "INSUFFICIENT_COMPARABLE_DATA",
    },
    {
      fires: metrics.inBodyQuality.outlierFlags.length > 0 && metrics.inBodyQuality.comparableRecordCount === 0,
      reasonCode: "TOO_MANY_DATA_ERRORS_OR_OUTLIERS",
    },
    // Professional/competing athletes pay a higher real-world cost for a
    // wrong quantitative call — require a stronger data-quality bar than a
    // recreational ADVANCED lifter before letting any confident decision
    // through (docs/USER_LEVEL_PERSONALIZATION_PLAN.md §D).
    {
      fires: isProfessional && metrics.dataQualityScore < t.professionalMinimumDataQualityScore,
      reasonCode: "PROFESSIONAL_REQUIRES_HIGHER_DATA_QUALITY",
    },
  ];
}

/** Weighted composite progress score, -1..1. Deliberately combines several
 * independent signals (per spec §5 "không dùng một rule đơn lẻ") rather than
 * branching on any single metric. */
function computeProgressScore(metrics: CycleMetricsResult): {
  score: number;
  conflictingSignals: string[];
} {
  const signals: Array<{ name: string; value: number | null; weight: number }> = [
    { name: "goalProgressScore", value: metrics.goalProgressScore, weight: 2 },
    { name: "strengthProgressScore", value: metrics.strengthProgressScore, weight: 1.5 },
    { name: "performanceConsistencyScore", value: metrics.performanceConsistencyScore, weight: 1 },
    {
      name: "volumeTrend",
      value: metrics.volumeTrendPercent == null ? null : Math.max(0, Math.min(1, 0.5 + metrics.volumeTrendPercent / 40)),
      weight: 0.75,
    },
    // Regression-based volume slope across every week of data (resists a
    // single noisy final week, unlike the naive first-vs-last volumeTrend
    // above) — a distinct, additional signal, not a replacement, since the
    // two occasionally disagreeing is itself meaningful audit information
    // (surfaced via conflictingSignals below).
    {
      name: "volumeProgressionSlope",
      value: metrics.volumeProgressionSlope == null ? null : Math.max(0, Math.min(1, 0.5 + metrics.volumeProgressionSlope / 40)),
      weight: 0.75,
    },
    { name: "newPRs", value: metrics.newPRs.length > 0 ? 1 : 0.5, weight: 0.5 },
    // Nutrition consistency — already 0..1 scaled by computeNutritionConsistencyScore.
    // A user missing their nutrition target consistently is real signal for
    // why progress may be stalling, independent of training-side metrics.
    { name: "nutritionConsistencyScore", value: metrics.nutritionConsistencyScore, weight: 1 },
  ];

  const withData = signals.filter((s) => s.value != null) as Array<{ name: string; value: number; weight: number }>;
  if (withData.length === 0) return { score: 0, conflictingSignals: [] };

  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of withData) {
    weightedSum += (s.value - 0.5) * 2 * s.weight; // rescale 0..1 -> -1..1
    totalWeight += s.weight;
  }
  const score = weightedSum / totalWeight;

  // Conflicting signals: any two weighted signals pulling in opposite
  // directions by a wide margin (one strongly positive, one strongly
  // negative) — surfaced for audit even though they still get averaged in.
  const conflictingSignals: string[] = [];
  const positive = withData.filter((s) => s.value >= 0.7);
  const negative = withData.filter((s) => s.value <= 0.3);
  for (const p of positive) {
    for (const n of negative) {
      conflictingSignals.push(`${p.name} is positive (${p.value.toFixed(2)}) while ${n.name} is negative (${n.value.toFixed(2)})`);
    }
  }

  return { score, conflictingSignals };
}

function hasTwoConsecutiveMissedCycles(priorDecisions: CycleDecision[] | undefined): boolean {
  if (!priorDecisions || priorDecisions.length < 2) return false;
  const missed: CycleDecision[] = ["ADJUST", "DELOAD"];
  return missed.includes(priorDecisions[0]) && missed.includes(priorDecisions[1]);
}

/** The original metrics-only decision logic (unchanged since before Phase
 * 5) — returns everything except the two feedback-audit fields, which
 * evaluateCycle's wrapper below always adds via applyFeedbackInfluence. */
function computeBaseDecision(
  input: DecisionEngineInput,
): Omit<DecisionEngineResult, "feedbackInfluenceApplied" | "decisionInfluenceFromFeedback"> {
  const { metrics } = input;
  const t = cycleThresholds.assessment;
  // UNKNOWN/absent reads as BEGINNER for safety purposes throughout this
  // engine — never silently upgraded to INTERMEDIATE (plan doc §0).
  const experienceLevel = input.experienceLevel ?? "UNKNOWN";
  const isBeginner = experienceLevel === "BEGINNER" || experienceLevel === "UNKNOWN";
  const isAdvancedOrPro = experienceLevel === "ADVANCED";
  const isProfessional = isAdvancedOrPro && input.competesInSport === true;

  const safetyFlags = evaluateSafetyFlags(metrics);
  const hasCriticalSafetyFlag = safetyFlags.some((f) => f.severity === "critical");

  const gates = evaluateInsufficientDataGates(input, isProfessional);
  const firedGates = gates.filter((g) => g.fires);

  const supportingMetrics: Record<string, unknown> = {
    adherenceRate: metrics.adherenceRate,
    goalProgressScore: metrics.goalProgressScore,
    strengthProgressScore: metrics.strengthProgressScore,
    performanceConsistencyScore: metrics.performanceConsistencyScore,
    volumeTrendPercent: metrics.volumeTrendPercent,
    volumeProgressionSlope: metrics.volumeProgressionSlope,
    missedSessionCount: metrics.missedSessionCount,
    nutritionConsistencyScore: metrics.nutritionConsistencyScore,
    fatigueScore: metrics.fatigueScore,
    recoveryScore: metrics.recoveryScore,
    painTrend: metrics.painTrend,
    dataQualityScore: metrics.dataQualityScore,
    newPRsCount: metrics.newPRs.length,
    experienceLevel,
    competesInSport: input.competesInSport === true,
  };

  if (firedGates.length > 0) {
    return {
      decision: "INSUFFICIENT_DATA",
      confidenceScore: Math.round(metrics.dataQualityScore * 50) / 100, // capped low by definition
      reasonCodes: firedGates.map((g) => g.reasonCode),
      supportingMetrics,
      conflictingSignals: [],
      safetyFlags,
      recommendedActionScope: "none",
    };
  }

  const { score, conflictingSignals } = computeProgressScore(metrics);
  const reasonCodes: string[] = [];

  // DELOAD takes priority over pure performance-based decisions — recovery
  // signals override an otherwise-good score, per spec §5. Thresholds are
  // level-aware (plan doc §C/§D): beginners rarely accumulate enough real
  // fatigue to need a deload in a first block, so require a stronger signal
  // before it fires for them; advanced/professional lifters train closer to
  // their real capacity, so the engine should react earlier for this group.
  const fatigueThreshold = isBeginner
    ? t.highFatigueScoreBeginner
    : isAdvancedOrPro
      ? t.highFatigueScoreAdvanced
      : t.highFatigueScoreDefault;
  const recoveryThreshold = isBeginner
    ? t.lowRecoveryScoreBeginner
    : isAdvancedOrPro
      ? t.lowRecoveryScoreAdvanced
      : t.lowRecoveryScoreDefault;
  const fatigued = metrics.fatigueScore != null && metrics.fatigueScore >= fatigueThreshold;
  const poorRecovery = metrics.recoveryScore != null && metrics.recoveryScore <= recoveryThreshold;
  const performanceDeclining = score < -0.15;
  if ((fatigued || poorRecovery || hasCriticalSafetyFlag) && performanceDeclining && metrics.adherenceRate >= cycleThresholds.assessment.minimumAdherenceRate) {
    reasonCodes.push("PERFORMANCE_DECLINE_WITH_ELEVATED_FATIGUE_OR_PAIN", "ADHERENCE_GOOD_SO_DECLINE_NOT_JUST_MISSED_SESSIONS");
    return {
      decision: "DELOAD",
      confidenceScore: Math.round(metrics.dataQualityScore * (0.7 + Math.abs(score) * 0.3) * 100) / 100,
      reasonCodes,
      supportingMetrics,
      conflictingSignals,
      safetyFlags,
      recommendedActionScope: "deload",
    };
  }

  // REBUILD — two consecutive missed cycles despite decent data, or an
  // explicit context change the engine can't infer from metrics alone.
  // Never fires for a BEGINNER/UNKNOWN user: this decision is inherently a
  // "your last two cycles' worth of history says this" call, and a user
  // this new to training has not accumulated the cycle history the rule is
  // reasoning about (plan doc §A: "REBUILD (chưa có 'chu kỳ trước' để so
  // sánh)") — an explicit goal/context change still routes to ADJUST/KEEP
  // below instead, which is a safe, milder outcome for this group.
  if (
    !isBeginner &&
    ((hasTwoConsecutiveMissedCycles(input.priorCycleDecisions) && score < 0.1) ||
      input.goalOrContextChangedSincePriorCycle)
  ) {
    reasonCodes.push(
      input.goalOrContextChangedSincePriorCycle
        ? "GOAL_OR_CONTEXT_CHANGED"
        : "TWO_CONSECUTIVE_CYCLES_BELOW_TARGET_DESPITE_GOOD_DATA",
    );
    return {
      decision: "REBUILD",
      confidenceScore: Math.round(metrics.dataQualityScore * 0.8 * 100) / 100,
      reasonCodes,
      supportingMetrics,
      conflictingSignals,
      safetyFlags,
      recommendedActionScope: "full_rebuild",
    };
  }

  // PROGRESS — strong composite score AND room to push (RPE not already
  // pinned high/rising, which would mean the user has no headroom left).
  // Professional/competing athletes require a stronger score before the
  // engine calls them "ready to push more" — a wrong progression call costs
  // more mid competition-prep than for a recreational lifter (plan doc §D).
  const rpeHasHeadroom = metrics.rpeTrend !== "increasing";
  const progressScoreThreshold = isProfessional ? t.progressScoreThresholdProfessional : t.progressScoreThresholdDefault;
  if (score >= progressScoreThreshold && rpeHasHeadroom && metrics.adherenceRate >= cycleThresholds.assessment.minimumAdherenceRate) {
    reasonCodes.push("STRONG_COMPOSITE_PROGRESS_SCORE", "RPE_TREND_NOT_RISING_HEADROOM_AVAILABLE");
    if (isProfessional) reasonCodes.push("PROFESSIONAL_STRICTER_PROGRESS_BAR_MET");
    return {
      decision: "PROGRESS",
      confidenceScore: Math.round(metrics.dataQualityScore * (0.7 + score * 0.3) * 100) / 100,
      reasonCodes,
      supportingMetrics,
      conflictingSignals,
      safetyFlags,
      recommendedActionScope: "minor_adjustment",
    };
  }

  // KEEP — steady positive-to-neutral progress, nothing indicates a change is needed.
  if (score >= 0.05) {
    reasonCodes.push("STEADY_PROGRESS_NO_PLATEAU_SIGNAL");
    return {
      decision: "KEEP",
      confidenceScore: Math.round(metrics.dataQualityScore * (0.6 + score * 0.3) * 100) / 100,
      reasonCodes,
      supportingMetrics,
      conflictingSignals,
      safetyFlags,
      recommendedActionScope: "none",
    };
  }

  // ADJUST — plateau-ish composite score with good adherence and data:
  // the default "something isn't working, tweak it" bucket. This is where
  // a genuinely ambiguous/near-zero score with real conflicting signals
  // also lands — ADJUST (not KEEP or a coin-flip toward PROGRESS/DELOAD)
  // is the conservative default when signals disagree.
  reasonCodes.push(
    conflictingSignals.length > 0 ? "CONFLICTING_SIGNALS_DEFAULT_TO_ADJUST" : "PLATEAU_GOOD_ADHERENCE_MINOR_CHANGE_NEEDED",
  );
  return {
    decision: "ADJUST",
    confidenceScore: Math.round(metrics.dataQualityScore * (0.5 + (1 - Math.abs(score)) * 0.2) * 100) / 100,
    reasonCodes,
    supportingMetrics,
    conflictingSignals,
    safetyFlags,
    recommendedActionScope: "minor_adjustment",
  };
}

const DECISION_SEVERITY: Record<CycleDecision, number> = {
  INSUFFICIENT_DATA: -1, // not on the escalation ladder at all — feedback never pulls a cycle out of this
  KEEP: 0,
  PROGRESS: 1,
  ADJUST: 2,
  DELOAD: 3,
  REBUILD: 4,
};

function scopeForDecision(decision: CycleDecision): ActionScope {
  switch (decision) {
    case "DELOAD":
      return "deload";
    case "REBUILD":
      return "full_rebuild";
    case "PROGRESS":
    case "ADJUST":
      return "minor_adjustment";
    default:
      return "none";
  }
}

/** Phase 5 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — session feedback
 * is a SIGNAL the Decision Engine weighs alongside metrics, never a
 * standalone decision. Every rule below only ESCALATES caution (moves
 * toward ADJUST/DELOAD) or nudges a genuinely plateau-ish/room-to-grow case
 * toward PROGRESS — it never invents a REBUILD (that stays exclusively the
 * metrics-side two-consecutive-cycles/goal-change rule) and never overrides
 * a safety-critical DELOAD/REBUILD the base engine already produced.
 *
 * Fully backward compatible: when input.feedbackSignals is undefined, this
 * returns `base` completely unchanged (feedbackInfluenceApplied=false,
 * decisionInfluenceFromFeedback="none") — byte-identical to the engine's
 * behavior before this function existed. */
function applyFeedbackInfluence(
  base: Omit<DecisionEngineResult, "feedbackInfluenceApplied" | "decisionInfluenceFromFeedback">,
  input: DecisionEngineInput,
): DecisionEngineResult {
  const unchanged: DecisionEngineResult = { ...base, feedbackInfluenceApplied: false, decisionInfluenceFromFeedback: "none" };

  const signals = input.feedbackSignals;
  if (!signals) return unchanged;
  const fb = signals.cycleFeedbackSummary;
  const ai = signals.aiFeedbackAnalysis;

  // Never let feedback pull a fundamentally-insufficient-data cycle into a
  // confident call, and never second-guess a metrics-only decision that
  // itself already had no real signal to work with.
  if (base.decision === "INSUFFICIENT_DATA") return unchanged;

  const experienceLevel = input.experienceLevel ?? "UNKNOWN";
  const isBeginner = experienceLevel === "BEGINNER" || experienceLevel === "UNKNOWN";
  const isProfessional = experienceLevel === "ADVANCED" && input.competesInSport === true;

  const ft = cycleThresholds.feedback;
  const at = cycleThresholds.assessment;

  // "Missing feedback => no strong change" — below this data-quality bar,
  // feedback (rule-based or AI) is not trusted enough to move anything.
  // Professionals require a stronger bar, mirroring the metrics-side gate.
  const requiredDataQuality = isProfessional ? ft.professionalMinimumDataQualityScore : ft.minimumDataQualityScore;
  if (fb.dataQualityScore < requiredDataQuality) {
    if (fb.feedbackSubmittedCount > 0) {
      // Some feedback exists but isn't trustworthy enough yet — worth a
      // reason code for audit transparency, but still no decision change.
      return {
        ...base,
        reasonCodes: [...base.reasonCodes, "FEEDBACK_DATA_QUALITY_TOO_LOW_NO_INFLUENCE"],
        feedbackInfluenceApplied: false,
        decisionInfluenceFromFeedback: "none",
      };
    }
    return unchanged;
  }

  // An AI complaintValidity of not_supported/insufficient_data means the
  // complaint contradicts or isn't confirmed by real data — per spec, a
  // user's complaint is never automatically treated as correct. When no AI
  // analysis was provided at all, fall back to trusting the rule-based
  // majority-fraction thresholds alone (still a real pattern bar, just
  // without the AI's cross-check against computedMetrics).
  const complaintSupported =
    !ai || ai.complaintValidity === "supported_by_data" || ai.complaintValidity === "partially_supported";

  const metrics = input.metrics;
  const tooHardComplaint =
    fb.feedbackSubmittedCount > 0 && fb.sessionsMarkedTooHard / fb.feedbackSubmittedCount >= ft.tooHardMajorityFraction;
  const tooEasyComplaint =
    fb.feedbackSubmittedCount > 0 && fb.sessionsMarkedTooEasy / fb.feedbackSubmittedCount >= ft.tooEasyMajorityFraction;
  const risingPain = metrics.painTrend?.direction === "up" || (fb.averagePain != null && fb.averagePain >= at.highPainScore);
  const severePain = fb.averagePain != null && fb.averagePain >= at.highPainScore + 2;
  const highRpe = metrics.rpeTrend === "increasing";
  const stableVolume = metrics.volumeTrendPercent == null || Math.abs(metrics.volumeTrendPercent) < 5;
  const equipmentComplaint =
    fb.equipmentMismatchFlags.length > 0 || (ai?.complaintCategories.includes("equipment_mismatch") ?? false);
  const boredom =
    fb.motivationOrBoredomFlags.includes("REPEATED_BOREDOM_REPORTS") ||
    (ai?.complaintCategories.includes("boredom_or_motivation") ?? false);
  const praiseButHighPain =
    fb.feedbackSentimentByRules === "positive" &&
    (risingPain || fb.safetyFlags.includes("HIGH_PAIN_REPORTED") || (ai?.riskFlags.includes("POSITIVE_FEEDBACK_BUT_HIGH_PAIN") ?? false));

  let decision: CycleDecision = base.decision;
  const reasonCodes = [...base.reasonCodes];
  const safetyFlags = [...base.safetyFlags];
  let influence: DecisionInfluence = "none";

  function escalateTo(next: CycleDecision, code: string, newInfluence: DecisionInfluence) {
    if (DECISION_SEVERITY[next] > DECISION_SEVERITY[decision]) {
      decision = next;
    }
    reasonCodes.push(code);
    // Keep the strongest influence seen across every rule that fired, not
    // just the last one — a later softer rule (e.g. boredom) must not
    // overwrite an earlier stronger one (e.g. praise-but-high-pain).
    const rank: Record<DecisionInfluence, number> = { none: 0, minor_adjust: 1, adjust: 2, deload: 3, rebuild_consideration: 4 };
    if (rank[newInfluence] > rank[influence]) influence = newInfluence;
  }

  // Rule 1 (highest priority, safety) — a cycle read as positive overall
  // but with a real pain signal must never be left at KEEP/PROGRESS just
  // because the general sentiment was good.
  if (praiseButHighPain) {
    safetyFlags.push({
      code: "FEEDBACK_POSITIVE_SENTIMENT_BUT_HIGH_PAIN",
      severity: severePain ? "critical" : "warning",
      message:
        "Overall session feedback reads positive, but reported pain is high. Do not let positive sentiment override the pain signal — treat this like any other high-pain case.",
    });
    escalateTo(severePain ? "DELOAD" : "ADJUST", "FEEDBACK_PRAISE_BUT_HIGH_PAIN_SAFETY_OVERRIDE", severePain ? "deload" : "adjust");
  }

  // Rule 2 (safety) — "chê nặng" (too_hard) confirmed by a majority of
  // feedback AND corroborated by rising pain and/or a rising RPE trend
  // (not just the subjective complaint alone).
  if (tooHardComplaint && complaintSupported && (risingPain || highRpe)) {
    const bothSignals = risingPain && highRpe;
    escalateTo(
      bothSignals ? "DELOAD" : "ADJUST",
      "FEEDBACK_TOO_HARD_WITH_RISING_PAIN_OR_RPE",
      bothSignals ? "deload" : "adjust",
    );
  }

  // Rule 3 (moderate) — equipment mismatch is an exercise-selection problem,
  // not a load/volume one; nudge toward ADJUST for substitution rather than
  // leaving the plan as-is, but never escalate past what safety already set.
  if (equipmentComplaint && complaintSupported) {
    escalateTo("ADJUST", "FEEDBACK_EQUIPMENT_MISMATCH_NEEDS_SUBSTITUTION", "minor_adjust");
  }

  // Rule 4 (progression) — "chê dễ" (too_easy) confirmed by a majority,
  // with real headroom (adherence high, RPE not rising, volume stable) —
  // only from a KEEP/ADJUST base (never downgrades an already-stronger
  // PROGRESS/DELOAD/REBUILD call), and only if no safety rule above fired
  // for this cycle already. Professionals require the AI's strictest
  // validity tier; beginners require extra adherence margin.
  const safetyRuleFired = praiseButHighPain || (tooHardComplaint && complaintSupported && (risingPain || highRpe));
  const requiredAdherence = at.minimumAdherenceRate + (isBeginner ? ft.beginnerProgressExtraAdherence : 0);
  const professionalGateOk = !isProfessional || ai?.complaintValidity === "supported_by_data";
  if (
    !safetyRuleFired &&
    tooEasyComplaint &&
    complaintSupported &&
    professionalGateOk &&
    !highRpe &&
    stableVolume &&
    metrics.adherenceRate >= requiredAdherence &&
    (decision === "KEEP" || decision === "ADJUST")
  ) {
    escalateTo("PROGRESS", "FEEDBACK_TOO_EASY_WITH_GOOD_ADHERENCE_LOW_RPE_STABLE_VOLUME", "minor_adjust");
  }

  // Rule 5 (softest, lowest priority) — boredom with otherwise-good
  // progress doesn't change the decision, just nudges the action scope
  // toward "at least suggest exercise variation" if nothing else already
  // called for a bigger change.
  if (boredom && (decision === "KEEP" || decision === "PROGRESS") && influence === "none") {
    reasonCodes.push("FEEDBACK_BOREDOM_SUGGESTS_EXERCISE_VARIATION");
    influence = "minor_adjust";
  }

  const feedbackInfluenceApplied = decision !== base.decision || influence !== "none" || reasonCodes.length !== base.reasonCodes.length;
  const recommendedActionScope =
    decision !== base.decision
      ? scopeForDecision(decision)
      : influence === "minor_adjust" && base.recommendedActionScope === "none"
        ? "minor_adjustment"
        : base.recommendedActionScope;

  return {
    ...base,
    decision,
    reasonCodes,
    safetyFlags,
    recommendedActionScope,
    feedbackInfluenceApplied,
    decisionInfluenceFromFeedback: influence,
  };
}

export function evaluateCycle(input: DecisionEngineInput): DecisionEngineResult {
  const base = computeBaseDecision(input);
  return applyFeedbackInfluence(base, input);
}
