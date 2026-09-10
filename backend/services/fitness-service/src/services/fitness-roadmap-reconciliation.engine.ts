/**
 * Gymini Adaptive Forecast Reconciliation — deterministic, pure module
 * comparing a completed phase's ORIGINAL forecast against what actually
 * happened. See docs/GYMINI_ADAPTIVE_FORECAST_RECONCILIATION_DESIGN.md §10.
 *
 * Architectural boundary (design doc §10 / master task §13): this module
 * answers "what happened relative to forecast?" — it has ZERO knowledge
 * of CycleAssessment.decision (KEEP/PROGRESS/ADJUST/DELOAD/REBUILD) and
 * never influences it. CycleAssessment (cycle-decision.engine.ts,
 * unchanged, untouched) remains the sole authority for "what should we
 * do next?" This module takes plain data in and returns plain data out —
 * no Prisma client, no I/O, no AI call.
 */

import type { PhaseForecastResult } from "./fitness-roadmap-forecast.engine";

export type ReconciliationStatus = "ON_TRACK" | "AHEAD_OF_FORECAST" | "BEHIND_FORECAST" | "INSUFFICIENT_DATA";

export interface ActualPhaseOutcome {
  weightKg: number | null;
  bodyFatPct: number | null;
  /** ISO date of the actual measurement used — null if none found. */
  measuredAt: string | null;
  /** 0-1, from the phase's own (most recent) TrainingCycle.latestAssessment.computedMetrics — reused, never re-derived. */
  adherenceRate: number | null;
  /** 0-1, same source. */
  strengthProgressScore: number | null;
}

export interface ReconciliationMetricComparison {
  expected: number;
  actual: number;
  delta: number;
}

export interface PhaseReconciliationResult {
  phaseIndex: number;
  weight: ReconciliationMetricComparison | null;
  bodyFat: ReconciliationMetricComparison | null;
  adherenceRate: number | null;
  strengthProgressScore: number | null;
  status: ReconciliationStatus;
  reasonCodes: string[];
}

function roundTo(value: number, decimals: number) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Ahead/on-track/behind thresholds, applied to the RATIO of actual
 * progress to expected progress (design doc §10). Deliberately never
 * classifies from weight alone — the adherence/strength escape hatches
 * below guarantee "weight behind but adherence/strength strong" is never
 * auto-labeled a failure (master task §12's own worked example). */
const AHEAD_RATIO_THRESHOLD = 1.15;
const ON_TRACK_RATIO_FLOOR = 0.85;
const STRONG_ADHERENCE_THRESHOLD = 0.85;
const STRONG_PERFORMANCE_THRESHOLD = 0.5;
/** Below this, an expected delta is treated as "no real directional
 * expectation" (a MAINTENANCE/DIET_BREAK/RECOMPOSITION phase) — status
 * is judged as stable-as-expected rather than dividing by ~0. */
const NEGLIGIBLE_EXPECTED_DELTA_KG = 0.3;

export function reconcilePhase(
  original: Pick<PhaseForecastResult, "phaseIndex" | "projectedStartWeightKg" | "projectedEndWeightKg" | "projectedStartBodyFatPct" | "projectedEndBodyFatPct">,
  actual: ActualPhaseOutcome,
): PhaseReconciliationResult {
  const reasonCodes: string[] = [];

  if (actual.weightKg == null) {
    return {
      phaseIndex: original.phaseIndex,
      weight: null,
      bodyFat: null,
      adherenceRate: actual.adherenceRate,
      strengthProgressScore: actual.strengthProgressScore,
      status: "INSUFFICIENT_DATA",
      reasonCodes: ["NO_ACTUAL_MEASUREMENT_AVAILABLE"],
    };
  }

  const weight: ReconciliationMetricComparison = {
    expected: original.projectedEndWeightKg,
    actual: actual.weightKg,
    delta: roundTo(actual.weightKg - original.projectedEndWeightKg, 1),
  };

  const bodyFat: ReconciliationMetricComparison | null =
    original.projectedEndBodyFatPct != null && actual.bodyFatPct != null
      ? {
          expected: original.projectedEndBodyFatPct,
          actual: actual.bodyFatPct,
          delta: roundTo(actual.bodyFatPct - original.projectedEndBodyFatPct, 1),
        }
      : null;

  const expectedDeltaKg = original.projectedEndWeightKg - original.projectedStartWeightKg;
  const actualDeltaKg = actual.weightKg - original.projectedStartWeightKg;

  let status: ReconciliationStatus;
  if (Math.abs(expectedDeltaKg) < NEGLIGIBLE_EXPECTED_DELTA_KG) {
    // A maintenance-style phase expected roughly no change — judge by
    // how close the actual result stayed to the expected end weight,
    // not a ratio (which is meaningless near zero).
    status = Math.abs(weight.delta) <= NEGLIGIBLE_EXPECTED_DELTA_KG * 2 ? "ON_TRACK" : "BEHIND_FORECAST";
    reasonCodes.push("MAINTENANCE_STYLE_PHASE_COMPARISON");
  } else {
    const ratio = actualDeltaKg / expectedDeltaKg;
    if (ratio >= AHEAD_RATIO_THRESHOLD) {
      status = "AHEAD_OF_FORECAST";
      reasonCodes.push("WEIGHT_CHANGE_EXCEEDED_FORECAST");
    } else if (ratio >= ON_TRACK_RATIO_FLOOR) {
      status = "ON_TRACK";
      reasonCodes.push("WEIGHT_CHANGE_MATCHED_FORECAST");
    } else if (actual.adherenceRate != null && actual.adherenceRate >= STRONG_ADHERENCE_THRESHOLD) {
      status = "ON_TRACK";
      reasonCodes.push("WEIGHT_BEHIND_BUT_ADHERENCE_STRONG");
    } else if (actual.strengthProgressScore != null && actual.strengthProgressScore >= STRONG_PERFORMANCE_THRESHOLD) {
      status = "ON_TRACK";
      reasonCodes.push("WEIGHT_BEHIND_BUT_PERFORMANCE_STRONG");
    } else {
      status = "BEHIND_FORECAST";
      reasonCodes.push("WEIGHT_CHANGE_BEHIND_FORECAST");
    }
  }

  return {
    phaseIndex: original.phaseIndex,
    weight,
    bodyFat,
    adherenceRate: actual.adherenceRate,
    strengthProgressScore: actual.strengthProgressScore,
    status,
    reasonCodes,
  };
}

// ── Deterministic Vietnamese explanation for why a forecast changed
// (master task §23) — template-based, never raw AI reasoning. ──

export type ForecastChangeReasonCode =
  | "FORECAST_UPDATED_FROM_NEW_WEIGHT"
  | "BODY_FAT_MEASUREMENT_UPDATED"
  | "ADHERENCE_BELOW_EXPECTED"
  | "ROADMAP_REBUILT"
  | "MEASUREMENT_STALE";

const FORECAST_CHANGE_REASON_LABEL: Record<ForecastChangeReasonCode, string> = {
  FORECAST_UPDATED_FROM_NEW_WEIGHT: "cân nặng thực tế khác với kịch bản ban đầu",
  BODY_FAT_MEASUREMENT_UPDATED: "có số đo tỷ lệ mỡ mới",
  ADHERENCE_BELOW_EXPECTED: "mức tuân thủ tập luyện thấp hơn dự kiến",
  ROADMAP_REBUILT: "lộ trình đã được xây dựng lại",
  MEASUREMENT_STALE: "dữ liệu cơ thể gần nhất đã khá lâu",
};

/** Deterministic, template-based — never the model's own free-text
 * reasoning (master task §23/§24: never blames the user, always frames
 * this as a data/forecast comparison). */
export function buildForecastChangeExplanation(codes: ForecastChangeReasonCode[]): string {
  if (codes.length === 0) return "";
  const parts = codes.map((c) => FORECAST_CHANGE_REASON_LABEL[c]);
  return `Dự báo được cập nhật vì ${parts.join(", ")}.`;
}
