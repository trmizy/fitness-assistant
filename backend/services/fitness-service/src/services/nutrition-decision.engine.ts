import { cycleThresholds } from "../config/cycle-thresholds.config";
import type { CycleMetricsResult } from "./cycle-metrics.engine";
import type { WeightTrendResult } from "./weight-trend.util";

/**
 * Adaptive Nutrition Decision Engine (Phase 2) — the deterministic domain
 * counterpart to cycle-decision.engine.ts (training), evaluated at the same
 * cycle-evaluation touchpoint (training-cycle.service.ts's
 * runVersionedAssessment) but reasoning over a DIFFERENT decision space —
 * see docs/body-state-and-adaptive-planning.md.
 *
 * Architectural rule (spec §3, §5, §41): this engine is the ONLY thing
 * allowed to decide `decision`/`proposedChanges`. An LLM may explain the
 * output in natural language (see ai-service's nutrition-decision
 * explanation flow) but never overrides it, and this engine never itself
 * mutates UserProfile/NutritionGoal — it only returns a recommendation;
 * the caller (training-cycle.service.ts) decides what, if anything, to
 * persist, and only after explicit confirmation (see §15/§41).
 */

export type AdaptiveNutritionDecision =
  | "KEEP_PLAN"
  | "PROPOSE_ADJUSTMENT"
  | "REQUEST_MORE_DATA"
  | "EARLY_REVIEW"
  | "ESCALATE";

export type NutritionConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface NutritionDecisionSignals {
  trendWeightKg: number | null;
  latestWeightKg: number | null;
  /** Mirrors weight-trend.util.ts's own confidence directly — that utility
   * already defines "LOW" as "fewer than minWeightSamples readings", which
   * IS the "not enough data" signal; no separate tier is needed (an earlier
   * version of this engine introduced a redundant 4th "INSUFFICIENT" state
   * that only fired for exactly zero samples and let a 1-2-sample LOW-
   * confidence trend slip through uncaught — caught by this file's own
   * test suite, fixed by removing the redundant state instead of patching
   * around it). */
  weightTrendConfidence: NutritionConfidence;
  /** kg/week, from the cycle-window regression already computed by
   * cycle-metrics.engine.ts's bodyWeightTrend — a different (longer-window,
   * whole-cycle) view than weight-trend.util.ts's short rolling average;
   * both are surfaced since they answer different questions (see
   * docs/body-state-and-adaptive-planning.md). */
  weightChangeRateKgPerWeek: number | null;
  nutritionAdherence: number | null; // 0-1, cycle-metrics.engine's nutritionConsistencyScore — calorie logging only; no protein-specific adherence data source exists in this repo yet (not fabricated).
  trainingAdherence: number; // 0-1
  recovery: number | null; // 0-1
  painOrDiscomfort: number | null; // 0-10 average session pain score
  bodyFatTrendDirection: "up" | "flat" | "down" | null;
  measurementQuality: NutritionConfidence;
}

export interface ActiveNutritionPrescription {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface NutritionDecisionInput {
  /** UserProfile.goal — real backend enum values only (no fabricated
   * "RECOMPOSITION" goal; that's an ai-service chat-only concept, not a
   * persisted value — see profile_extractor.ts). */
  goal: "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE" | null;
  targetWeightKg: number | null;
  weightTrend: WeightTrendResult;
  metrics: CycleMetricsResult;
  activeNutritionGoal: ActiveNutritionPrescription | null;
  cycleDurationDaysSoFar: number;
}

export interface NutritionDecisionResult {
  decision: AdaptiveNutritionDecision;
  confidence: NutritionConfidence;
  evaluatedWindowDays: number;
  signals: NutritionDecisionSignals;
  proposedChanges: Partial<ActiveNutritionPrescription> | null;
  reasonCodes: string[];
  /** Real ids from data/processed/evidence/_index.json only — never
   * invented. See docs/research/fitness-nutrition-evidence.md. */
  evidenceIds: string[];
  requiresConfirmation: boolean;
}

function measurementQualityFrom(metrics: CycleMetricsResult, weightTrend: WeightTrendResult): NutritionConfidence {
  // No InBody data comparable at all — cannot judge measurement quality
  // above LOW, regardless of how the weight-trend rolling average looks.
  if (!metrics.inBodyQuality.hasSufficientData) return "LOW";
  if (metrics.dataQualityScore >= 0.75 && weightTrend.confidence === "HIGH") return "HIGH";
  if (metrics.dataQualityScore >= 0.4 || weightTrend.confidence !== "LOW") return "MEDIUM";
  return "LOW";
}

function buildSignals(input: NutritionDecisionInput): NutritionDecisionSignals {
  const { metrics, weightTrend } = input;
  return {
    trendWeightKg: weightTrend.trendWeight,
    latestWeightKg: weightTrend.latestWeight,
    weightTrendConfidence: weightTrend.confidence,
    weightChangeRateKgPerWeek: metrics.bodyWeightTrend?.changePerWeek ?? null,
    nutritionAdherence: metrics.nutritionConsistencyScore,
    trainingAdherence: metrics.adherenceRate,
    recovery: metrics.recoveryScore,
    painOrDiscomfort: metrics.averagePainScore,
    bodyFatTrendDirection: metrics.bodyFatTrend?.direction ?? null,
    measurementQuality: measurementQualityFrom(metrics, weightTrend),
  };
}

/**
 * Redistributes a calorie change into macros WITHOUT scaling protein
 * proportionally (spec §13 explicitly forbids "calories -10% => protein
 * -10%"). Protein is held at (or raised to, never lowered below) the
 * current prescription, clamped into the NUTRITION-001 (Jäger et al. 2017)
 * evidence-supported 1.4-2.0 g/kg/day range; fat is held stable; carbs
 * absorb the remaining calorie budget. currentWeightKg is required to
 * anchor the g/kg range — callers must not invoke this without a resolved
 * weight (see evaluateNutritionAdaptive's gating above).
 */
function redistributeMacros(
  active: ActiveNutritionPrescription,
  newCalories: number,
  currentWeightKg: number,
): Partial<ActiveNutritionPrescription> {
  const t = cycleThresholds.nutritionAdaptive;
  const proteinFloorG = Math.round(currentWeightKg * t.proteinFloorGPerKg);
  const proteinCeilingG = Math.round(currentWeightKg * t.proteinCeilingGPerKg);
  const proposedProteinG = Math.min(proteinCeilingG, Math.max(proteinFloorG, active.protein));
  const proposedFatG = active.fat;
  const nonCarbKcal = proposedProteinG * 4 + proposedFatG * 9;
  const carbKcal = Math.max(0, newCalories - nonCarbKcal);
  const proposedCarbsG = Math.round(carbKcal / 4);
  return {
    calories: newCalories,
    protein: proposedProteinG,
    fat: proposedFatG,
    carbs: proposedCarbsG,
  };
}

function clampCalorieDelta(deltaKcal: number): number {
  const t = cycleThresholds.nutritionAdaptive;
  const magnitude = Math.min(t.maxCalorieAdjustmentKcal, Math.max(t.minCalorieAdjustmentKcal, Math.abs(deltaKcal)));
  return deltaKcal < 0 ? -magnitude : magnitude;
}

export function evaluateNutritionAdaptive(input: NutritionDecisionInput): NutritionDecisionResult {
  const t = cycleThresholds.nutritionAdaptive;
  const at = cycleThresholds.assessment;
  const { metrics } = input;
  const signals = buildSignals(input);
  const evaluatedWindowDays = input.cycleDurationDaysSoFar;

  // ── 1. Safety gate — checked FIRST, unconditionally overrides everything
  // below (mirrors cycle-decision.engine.ts's evaluateSafetyFlags ordering).
  // Never a diagnosis (spec §21/§52) — just defers to a professional /
  // triggers earlier human review instead of proposing a more aggressive
  // calorie cut on top of an active pain signal.
  const severePain = signals.painOrDiscomfort != null && signals.painOrDiscomfort >= at.highPainScore + 2;
  const highPain = signals.painOrDiscomfort != null && signals.painOrDiscomfort >= at.highPainScore;
  const risingPain = metrics.painTrend?.direction === "up";
  if (severePain) {
    return {
      decision: "ESCALATE",
      confidence: "HIGH",
      evaluatedWindowDays,
      signals,
      proposedChanges: null,
      reasonCodes: ["SEVERE_PAIN_OR_DISCOMFORT_REPORTED"],
      evidenceIds: [],
      requiresConfirmation: true,
    };
  }
  if (highPain || risingPain) {
    return {
      decision: "EARLY_REVIEW",
      confidence: "MEDIUM",
      evaluatedWindowDays,
      signals,
      proposedChanges: null,
      reasonCodes: [highPain ? "ELEVATED_PAIN_OR_DISCOMFORT" : "RISING_PAIN_TREND"],
      evidenceIds: [],
      requiresConfirmation: true,
    };
  }

  // ── 2. Data-quality / confidence gate (spec §8, §10) — never let a
  // single reading or a thin data window drive a decision.
  if (signals.weightTrendConfidence === "LOW" || signals.measurementQuality === "LOW") {
    return {
      decision: "REQUEST_MORE_DATA",
      confidence: "LOW",
      evaluatedWindowDays,
      signals,
      proposedChanges: null,
      reasonCodes: ["INSUFFICIENT_WEIGHT_SAMPLES"],
      evidenceIds: ["hall-2011-dynamic-energy-balance"],
      requiresConfirmation: false,
    };
  }
  if (signals.nutritionAdherence == null) {
    return {
      decision: "REQUEST_MORE_DATA",
      confidence: "LOW",
      evaluatedWindowDays,
      signals,
      proposedChanges: null,
      reasonCodes: ["NO_NUTRITION_LOGGING_IN_WINDOW"],
      evidenceIds: [],
      requiresConfirmation: false,
    };
  }

  // ── 3. Adherence gate — a plateau while NOT actually following the
  // prescribed calories is a behavior problem, not evidence the calorie
  // TARGET itself is wrong. Never propose a numeric change here; KEEP_PLAN
  // with a distinct reason code so the explanation layer can say so.
  if (signals.nutritionAdherence < t.minAdherenceForAdjustment) {
    return {
      decision: "KEEP_PLAN",
      confidence: "MEDIUM",
      evaluatedWindowDays,
      signals,
      proposedChanges: null,
      reasonCodes: ["LOW_NUTRITION_ADHERENCE_ADDRESS_BEHAVIOR_NOT_TARGET"],
      evidenceIds: [],
      requiresConfirmation: false,
    };
  }

  // No active prescription or no resolvable current weight — cannot safely
  // compute macro-safe proposedChanges even if the trend looks off; ask for
  // more data rather than guessing.
  const currentWeightKg = signals.trendWeightKg ?? signals.latestWeightKg;
  if (!input.activeNutritionGoal || currentWeightKg == null) {
    return {
      decision: "REQUEST_MORE_DATA",
      confidence: "LOW",
      evaluatedWindowDays,
      signals,
      proposedChanges: null,
      reasonCodes: ["NO_ACTIVE_PRESCRIPTION_OR_UNRESOLVED_WEIGHT"],
      evidenceIds: [],
      requiresConfirmation: false,
    };
  }

  // Reaching here means the step-2 gate above already ruled out
  // measurementQuality === "LOW" (it would have returned REQUEST_MORE_DATA).
  const confidence: NutritionConfidence = signals.measurementQuality;
  const enoughWindow = evaluatedWindowDays >= at.plateauWindowWeeks * 7;
  const rateKgPerWeek = signals.weightChangeRateKgPerWeek;
  const pctPerWeek =
    rateKgPerWeek != null && currentWeightKg > 0 ? (Math.abs(rateKgPerWeek) / currentWeightKg) * 100 : null;

  // ── 4. Goal-specific evaluation — never driven off weight alone;
  // requires the plateau/off-pace condition to have persisted for the same
  // window used by the training decision engine (plateauWindowWeeks),
  // otherwise this is "not enough time to judge yet", not KEEP vs ADJUST.
  if (!enoughWindow) {
    return {
      decision: "KEEP_PLAN",
      confidence: "MEDIUM",
      evaluatedWindowDays,
      signals,
      proposedChanges: null,
      reasonCodes: ["EVALUATION_WINDOW_TOO_SHORT_FOR_A_CONFIDENT_CALL"],
      evidenceIds: ["hall-2011-dynamic-energy-balance"],
      requiresConfirmation: false,
    };
  }

  const goal = input.goal;
  let offTarget = false;
  let direction: "increase" | "decrease" | null = null;
  const reasonCodes: string[] = [];
  const evidenceIds: string[] = ["hall-2011-dynamic-energy-balance"];

  if (goal === "WEIGHT_LOSS") {
    const losing = rateKgPerWeek != null && rateKgPerWeek < 0;
    if (!losing || (pctPerWeek != null && pctPerWeek < t.weightLossPaceSlowPctPerWeek)) {
      offTarget = true;
      direction = "decrease";
      reasonCodes.push("WEIGHT_LOSS_PLATEAUED_OR_TOO_SLOW");
    } else if (pctPerWeek != null && pctPerWeek > t.weightLossPaceFastPctPerWeek) {
      offTarget = true;
      direction = "increase";
      reasonCodes.push("WEIGHT_LOSS_FASTER_THAN_REFERENCE_PACE_LEAN_MASS_RISK");
      evidenceIds.push("garthe-2011-weight-loss-rate-athletes");
    }
  } else if (goal === "MUSCLE_GAIN") {
    const gaining = rateKgPerWeek != null && rateKgPerWeek > 0;
    if (!gaining) {
      offTarget = true;
      direction = "increase";
      reasonCodes.push("MUSCLE_GAIN_PLATEAUED_NO_WEIGHT_INCREASE");
    } else if (
      pctPerWeek != null &&
      pctPerWeek > t.weightLossPaceFastPctPerWeek &&
      signals.bodyFatTrendDirection === "up"
    ) {
      offTarget = true;
      direction = "decrease";
      reasonCodes.push("WEIGHT_GAIN_TOO_FAST_WITH_RISING_BODY_FAT");
      evidenceIds.push("brewer-2021-inbody-validation");
    }
  } else {
    // MAINTENANCE / ATHLETIC_PERFORMANCE — weight should stay within a
    // tolerance band; not chasing either direction.
    if (rateKgPerWeek != null && Math.abs(rateKgPerWeek) > t.maintenanceToleranceKgPerWeek) {
      offTarget = true;
      direction = rateKgPerWeek > 0 ? "decrease" : "increase";
      reasonCodes.push("MAINTENANCE_GOAL_WEIGHT_DRIFTING_OUTSIDE_TOLERANCE_BAND");
    }
  }

  if (!offTarget || !direction) {
    return {
      decision: "KEEP_PLAN",
      confidence,
      evaluatedWindowDays,
      signals,
      proposedChanges: null,
      reasonCodes: ["TREND_ON_TARGET_FOR_GOAL", "GOOD_ADHERENCE_NO_ADJUSTMENT_NEEDED"],
      evidenceIds: ["hall-2011-dynamic-energy-balance"],
      requiresConfirmation: false,
    };
  }

  // ── 5. Propose adjustment — bounded, evidence-informed macro
  // redistribution, never auto-applied (requiresConfirmation=true; the
  // caller must persist this as a NEW NutritionGoal version only after
  // explicit user/PT confirmation — see §14/§15/§41).
  const rawDelta = direction === "decrease" ? -t.calorieAdjustmentStepKcal : t.calorieAdjustmentStepKcal;
  const delta = clampCalorieDelta(rawDelta);
  const newCalories = Math.max(t.minPrescriptionCalories, input.activeNutritionGoal.calories + delta);
  const proposedChanges = redistributeMacros(input.activeNutritionGoal, newCalories, currentWeightKg);
  reasonCodes.push("GOOD_ADHERENCE_SUFFICIENT_DATA_TREND_OFF_TARGET");
  evidenceIds.push("tinsley-2022-bodycomp-standardization");

  return {
    decision: "PROPOSE_ADJUSTMENT",
    confidence,
    evaluatedWindowDays,
    signals,
    proposedChanges,
    reasonCodes,
    evidenceIds: Array.from(new Set(evidenceIds)),
    requiresConfirmation: true,
  };
}
