import { cycleThresholds } from "../config/cycle-thresholds.config";
import type { CycleMetricsResult } from "./cycle-metrics.engine";

export type CycleDecision = "KEEP" | "PROGRESS" | "ADJUST" | "DELOAD" | "REBUILD" | "INSUFFICIENT_DATA";
export type ActionScope = "none" | "minor_adjustment" | "deload" | "full_rebuild";

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

export function evaluateCycle(input: DecisionEngineInput): DecisionEngineResult {
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
