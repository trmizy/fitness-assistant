import {
  computeInitialNutritionPrescription,
  type Gender,
  type ActivityLevel,
  type ExperienceLevel,
  type Goal,
} from "./nutrition-bootstrap.engine";
import { computeFfmi, MAX_SAFE_WEEKLY_RATE_PCT, type FfmiResult } from "./fitness-diagnosis.engine";

/**
 * Gymini Roadmap Projection & Strategy Report Hardening — deterministic
 * phase-by-phase forecast engine. See
 * docs/GYMINI_ROADMAP_PROJECTION_HARDENING_DESIGN.md.
 *
 * Two independent responsibilities, deliberately kept in one file since
 * they're both pure/no-I/O/no-AI and always consumed together:
 *   1. deriveStrategyGroups() — context-aware K1/K2/K3 campaign grouping
 *      (§11 of the design doc). Presentation-level only, no persistence.
 *   2. forecastPhaseSequence() — chained body-composition/BMR-TDEE/
 *      nutrition scenario per phase (§9/§10). Every number is either
 *      reused directly from computeInitialNutritionPrescription (the one
 *      authoritative nutrition engine, never reimplemented) or a
 *      conservative, literature-referenced derivation of its own output
 *      — never a competing/independent calculation. Every field name is
 *      prefixed `projected`/`estimated` so it can never be confused with
 *      an authoritative field on TrainingCycle/NutritionGoal/InBody.
 *
 * Deliberately named "forecast" in code (not "projection") to avoid
 * colliding with fitness-roadmap.service.ts's existing, unrelated
 * getRoadmapProjection() (reloads a roadmap's current DB state after a
 * mutation) — "projection" stays the right word in the route path, UI
 * copy, and design docs, just not as a code identifier here.
 */

export type RoadmapPhaseTypeForForecast =
  | "FAT_LOSS"
  | "DIET_BREAK"
  | "MAINTENANCE"
  | "LEAN_GAIN"
  | "MINI_CUT"
  | "RECOMPOSITION"
  | "PERFORMANCE"
  | "RECOVERY";

// ── §11: context-aware strategy grouping ────────────────────────────────

export type StrategyBucket = "CUT" | "BUILD" | "STABILIZE";

export const STRATEGY_BUCKET_LABEL: Record<StrategyBucket, string> = {
  CUT: "Giảm mỡ",
  BUILD: "Tăng cơ / Hiệu suất",
  STABILIZE: "Chuyển tiếp / Duy trì",
};

export interface StrategyGroup<P> {
  key: string; // "K1", "K2", ...
  bucket: StrategyBucket;
  phases: P[];
}

/** A PRIMARY phase defines a campaign bucket on its own. A BRIDGE phase
 * (null here) is contextual — its group membership depends on its
 * neighbors, resolved in deriveStrategyGroups(). */
function primaryBucket(phaseType: RoadmapPhaseTypeForForecast): StrategyBucket | null {
  if (phaseType === "FAT_LOSS" || phaseType === "MINI_CUT") return "CUT";
  if (phaseType === "LEAN_GAIN" || phaseType === "RECOMPOSITION" || phaseType === "PERFORMANCE") return "BUILD";
  return null; // DIET_BREAK, MAINTENANCE, RECOVERY
}

/** Context-aware K1/K2/K3 campaign grouping — design doc §11. A single
 * forward pass; each run of consecutive BRIDGE phases (DIET_BREAK/
 * MAINTENANCE/RECOVERY) is resolved as one unit by comparing the bucket
 * immediately before the run to the bucket of the next PRIMARY phase
 * after it:
 *   - both known and equal      -> the whole run joins the CURRENT group
 *     (the campaign continues through it, e.g. FAT_LOSS -> DIET_BREAK ->
 *     FAT_LOSS stays one "Giảm mỡ" campaign)
 *   - both known and different  -> the whole run becomes its own
 *     standalone STABILIZE group (a genuine transition, e.g.
 *     FAT_LOSS -> MAINTENANCE -> LEAN_GAIN becomes 3 groups)
 *   - only the previous is known (trailing bridge) -> joins/closes out
 *     the previous group (e.g. MINI_CUT -> MAINTENANCE stays one group)
 *   - only the next is known (leading bridge) -> starts the next group
 *     early (e.g. DIET_BREAK -> FAT_LOSS becomes one group)
 *   - neither known (the whole list is just this run) -> standalone
 *     STABILIZE group (e.g. a lone DIET_BREAK or RECOVERY phase)
 * No RoadmapBlock/RoadmapCampaign table — pure derivation over whatever
 * phase list is already in hand (an AI draft's pre-Save phases, or a
 * persisted RoadmapPhase[] on reopen/ACTIVE view). */
export function deriveStrategyGroups<P extends { phaseType: RoadmapPhaseTypeForForecast }>(
  phases: P[],
): StrategyGroup<P>[] {
  const groups: StrategyGroup<P>[] = [];
  let i = 0;
  while (i < phases.length) {
    const bucket = primaryBucket(phases[i].phaseType);
    if (bucket !== null) {
      const last = groups[groups.length - 1];
      if (last && last.bucket === bucket) {
        last.phases.push(phases[i]);
      } else {
        groups.push({ key: `K${groups.length + 1}`, bucket, phases: [phases[i]] });
      }
      i++;
      continue;
    }

    // Collect the whole run of consecutive bridge phases starting here.
    const bridgeRun: P[] = [];
    let j = i;
    while (j < phases.length && primaryBucket(phases[j].phaseType) === null) {
      bridgeRun.push(phases[j]);
      j++;
    }
    const prevBucket = groups.length > 0 ? groups[groups.length - 1].bucket : null;
    const nextBucket = j < phases.length ? primaryBucket(phases[j].phaseType) : null;

    if (prevBucket !== null && prevBucket === nextBucket) {
      groups[groups.length - 1].phases.push(...bridgeRun);
    } else if (prevBucket === null && nextBucket !== null) {
      groups.push({ key: `K${groups.length + 1}`, bucket: nextBucket, phases: [...bridgeRun] });
    } else if (prevBucket !== null && nextBucket === null) {
      groups[groups.length - 1].phases.push(...bridgeRun);
    } else {
      // Either a genuine transition (both known, different) or the
      // entire list is just this bridge run (both null) — either way, a
      // standalone STABILIZE block.
      groups.push({ key: `K${groups.length + 1}`, bucket: "STABILIZE", phases: [...bridgeRun] });
    }
    i = j;
  }
  return groups;
}

// ── §8/§9/§10: phase-by-phase forecast ──────────────────────────────────

/** design doc §8 — no MINI_CUT/RECOMPOSITION-specific nutrition constant
 * exists anywhere in this codebase; reusing the nearest already-real goal
 * is the conservative, non-fabricating choice. PERFORMANCE maps to
 * ATHLETIC_PERFORMANCE, which computeInitialNutritionPrescription's own
 * `else` branch already treats identically to MAINTENANCE — unchanged
 * existing behavior. */
export function mapPhaseTypeToNutritionGoal(phaseType: RoadmapPhaseTypeForForecast): Goal {
  switch (phaseType) {
    case "FAT_LOSS":
    case "MINI_CUT":
      return "WEIGHT_LOSS";
    case "LEAN_GAIN":
      return "MUSCLE_GAIN";
    case "PERFORMANCE":
      return "ATHLETIC_PERFORMANCE";
    case "DIET_BREAK":
    case "MAINTENANCE":
    case "RECOVERY":
    case "RECOMPOSITION":
    default:
      return "MAINTENANCE";
  }
}

// design doc §9 — a commonly-cited approximate energy density of adipose
// tissue (a first-order simplification of the same Hall et al. dynamic
// energy-balance model computeInitialNutritionPrescription already cites
// as evidenceId "hall-2011-dynamic-energy-balance" for the deficit
// fraction itself).
const KCAL_PER_KG_TISSUE = 7700;

// design doc §9 — fat/lean partition of a projected weight change.
// FAT_LOSS/MINI_CUT: most (not all) of a moderate-deficit weight change
// with adequate protein + resistance training is fat mass (garthe-2011 +
// issn-protein-2017, both already cited by the nutrition engine for this
// exact scenario). LEAN_GAIN: a surplus is never 100% lean tissue even
// in trained lifters (slater-2019, already cited for the surplus
// fraction itself) — an even split is the conservative default.
const FAT_LOSS_FAT_MASS_PARTITION = 0.8;
const MUSCLE_GAIN_LEAN_MASS_PARTITION = 0.5;

export interface PhaseForecastPhaseInput {
  phaseIndex: number;
  phaseType: RoadmapPhaseTypeForForecast;
  name: string;
  plannedStartAt: string;
  plannedEndAt: string;
}

export interface ForecastContext {
  heightCm: number;
  age: number;
  gender: Gender;
  activityLevel: ActivityLevel;
  experienceLevel: ExperienceLevel | null;
  startWeightKg: number;
  /** null when no body-fat baseline exists — every phase's body-
   * composition/FFMI fields then stay null (never fabricated). */
  startBodyFatPct: number | null;
  /** Real InBody-measured BMR for TODAY's actual state only — never
   * applied past phase 0, since a future body state was never measured. */
  measuredBmr?: number | null;
  // Adaptive Forecast Reconciliation additions (design doc §8) — feed
  // computeForecastConfidence(). All optional so existing callers
  // (Roadmap Projection Hardening's own getPhaseForecast, unchanged)
  // keep working with confidence simply defaulting to its most
  // conservative reading (no body-fat source, zero cycle history).
  bodyFatMethod?: "manual" | "visual_reference" | "inbody" | null;
  /** ISO date of the InBody entry backing startBodyFatPct — only
   * meaningful when bodyFatMethod === "inbody". */
  bodyFatMeasuredAt?: string | null;
  completedCycleCount?: number;
  /** CycleAssessment.dataQualityScore (0-1) from the most recent
   * completed cycle, when available — blended into confidence, never
   * re-derived (design doc §4/§8). */
  latestCycleDataQualityScore?: number | null;
  /** "as of" instant confidence/recency should be measured against —
   * defaults to now(); callers reconciling HISTORICAL phases pass the
   * phase's own actualEndAt so recency reads correctly for that point
   * in time (temporal correctness, design doc §16). */
  asOf?: Date;
}

// ── Adaptive Forecast Reconciliation — confidence & ranges (design doc §7/§8) ──

export type ForecastConfidenceTier = "HIGH" | "MEDIUM" | "LOW";

export interface ForecastConfidence {
  tier: ForecastConfidenceTier;
  score: number; // 0-1, same scale CycleAssessment.dataQualityScore already uses
  reasonCodes: string[];
}

export interface ForecastRange {
  low: number;
  expected: number;
  high: number;
}

const STALE_INBODY_DAYS = 90;

/** Deterministic, reused-inputs-only forecast confidence (design doc §8).
 * Never an AI confidence score — every input is something the product
 * already computes elsewhere (InBody recency/method, completed cycle
 * count, CycleAssessment.dataQualityScore). Computed ONCE per forecast
 * call (not per phase) — per-phase degradation for farther phases is
 * applied separately via applyDistanceCap(), a simple discrete tier
 * cap rather than a fabricated numeric widening formula. */
export function computeForecastConfidence(context: ForecastContext): ForecastConfidence {
  const reasonCodes: string[] = [];
  const asOf = context.asOf ?? new Date();

  let bodyFatSourceScore: number;
  if (context.bodyFatMethod === "inbody") {
    const ageDays = context.bodyFatMeasuredAt
      ? (asOf.getTime() - new Date(context.bodyFatMeasuredAt).getTime()) / 86_400_000
      : Infinity;
    if (ageDays <= STALE_INBODY_DAYS) {
      bodyFatSourceScore = 1.0;
      reasonCodes.push("RECENT_INBODY_MEASUREMENT");
    } else {
      bodyFatSourceScore = 0.6;
      reasonCodes.push("STALE_INBODY_MEASUREMENT");
    }
  } else if (context.bodyFatMethod === "manual") {
    bodyFatSourceScore = 0.4;
    reasonCodes.push("MANUAL_BODY_FAT_ESTIMATE");
  } else if (context.bodyFatMethod === "visual_reference") {
    bodyFatSourceScore = 0.25;
    reasonCodes.push("VISUAL_REFERENCE_BODY_FAT_ESTIMATE");
  } else {
    bodyFatSourceScore = 0.1;
    reasonCodes.push("NO_BODY_FAT_DATA");
  }

  const completedCycleCount = context.completedCycleCount ?? 0;
  let cycleHistoryAdjustment: number;
  if (completedCycleCount === 0) {
    cycleHistoryAdjustment = -0.2;
    reasonCodes.push("NO_COMPLETED_CYCLES_YET");
  } else if (completedCycleCount === 1) {
    cycleHistoryAdjustment = -0.1;
    reasonCodes.push("LIMITED_CYCLE_HISTORY");
  } else {
    cycleHistoryAdjustment = 0;
    reasonCodes.push("SUFFICIENT_CYCLE_HISTORY");
  }

  let score = Math.max(0, Math.min(1, bodyFatSourceScore + cycleHistoryAdjustment));

  if (context.latestCycleDataQualityScore != null) {
    score = (score + Math.max(0, Math.min(1, context.latestCycleDataQualityScore))) / 2;
    reasonCodes.push(
      context.latestCycleDataQualityScore >= 0.7
        ? "CYCLE_DATA_QUALITY_HIGH"
        : context.latestCycleDataQualityScore >= 0.4
          ? "CYCLE_DATA_QUALITY_MEDIUM"
          : "CYCLE_DATA_QUALITY_LOW",
    );
  }

  score = Math.round(score * 100) / 100;
  const tier: ForecastConfidenceTier = score >= 0.7 ? "HIGH" : score >= 0.4 ? "MEDIUM" : "LOW";
  return { tier, score, reasonCodes };
}

const TIER_ORDER: ForecastConfidenceTier[] = ["LOW", "MEDIUM", "HIGH"];

/** Never lets a farther-future phase appear MORE confident than a
 * nearer one — design doc §7/§27's "near-term narrower/higher
 * confidence, far-future wider/lower" via a simple, defensible,
 * discrete cap (not a fabricated numeric formula). phasePosition is
 * 0-based position within the sequence being forecast (0 = the very
 * next phase). */
function applyDistanceCap(base: ForecastConfidenceTier, phasePosition: number): ForecastConfidenceTier {
  const cap: ForecastConfidenceTier = phasePosition === 0 ? "HIGH" : phasePosition === 1 ? "MEDIUM" : "LOW";
  const baseIdx = TIER_ORDER.indexOf(base);
  const capIdx = TIER_ORDER.indexOf(cap);
  return TIER_ORDER[Math.min(baseIdx, capIdx)];
}

const RANGE_WIDTH_PCT: Record<ForecastConfidenceTier, number> = { HIGH: 0.02, MEDIUM: 0.04, LOW: 0.08 };
const MIN_RANGE_HALF_WIDTH_KG = 0.2;

/** A categorical uncertainty band tied to confidence tier — explicitly
 * NOT a statistical confidence interval (design doc §7: no defensible
 * per-distance statistical model exists in this codebase, so this is
 * presented as an illustrative range, never fake precision). low <=
 * expected <= high always, by construction. */
function computeForecastRange(expected: number, deltaMagnitude: number, tier: ForecastConfidenceTier, decimals: number): ForecastRange {
  const halfWidth = Math.max(Math.abs(deltaMagnitude) * RANGE_WIDTH_PCT[tier], decimals === 1 ? MIN_RANGE_HALF_WIDTH_KG : 0.3);
  return {
    low: roundTo(expected - halfWidth, decimals),
    expected: roundTo(expected, decimals),
    high: roundTo(expected + halfWidth, decimals),
  };
}

export interface PhaseForecastMacro {
  proteinGrams: number;
  carbGrams: number;
  fatGrams: number;
}

export interface PhaseForecastResult {
  phaseIndex: number;
  phaseType: RoadmapPhaseTypeForForecast;
  name: string;
  plannedStartAt: string;
  plannedEndAt: string;
  durationWeeks: number;

  projectedStartWeightKg: number;
  projectedEndWeightKg: number;
  projectedStartBodyFatPct: number | null;
  projectedEndBodyFatPct: number | null;
  projectedStartFfmi: FfmiResult | null;
  projectedEndFfmi: FfmiResult | null;

  /** Additive uncertainty bands around the point estimates above — see
   * computeForecastRange's own doc comment for why these are explicitly
   * categorical, not statistical confidence intervals. */
  projectedEndWeightRangeKg: ForecastRange;
  projectedEndBodyFatPctRange: ForecastRange | null;
  /** Confidence for THIS phase specifically — distance-capped from the
   * sequence's base confidence (design doc §7/§27), never higher than a
   * nearer phase's own confidence. */
  confidence: ForecastConfidence;

  estimatedStartBmr: number;
  estimatedStartTdee: number;
  estimatedEndBmr: number;
  estimatedEndTdee: number;
  bmrFormula: "inbody_measured" | "mifflin_st_jeor";

  /** The phase's actionable nutrition target — computed from its own
   * START state, the number relevant the moment the phase begins. */
  projectedCalories: number;
  projectedDeficitOrSurplusKcal: number;
  /** Signed, relative to that phase's own start TDEE — negative for a
   * deficit, positive for a surplus, null when TDEE is 0 (never happens
   * in practice, guarded defensively). */
  projectedDeficitOrSurplusPercent: number | null;
  projectedMacros: PhaseForecastMacro;

  dataCompleteness: { bodyComposition: boolean };
  assumptions: string[];
}

function roundTo(value: number, decimals: number) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function durationWeeksBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(1, Math.round((end - start) / (7 * 86_400_000)));
}

/** Chains a phase sequence's projected body state / BMR-TDEE / nutrition
 * scenario forward — design doc §9/§10/§12. Phase N's start state is
 * ALWAYS phase N-1's projected end state (never re-derived from the
 * original starting point). Zero AI, zero DB write, zero persistence —
 * pure function over already-real inputs. */
export function forecastPhaseSequence(
  context: ForecastContext,
  phases: PhaseForecastPhaseInput[],
): PhaseForecastResult[] {
  const results: PhaseForecastResult[] = [];
  let cursorWeightKg = context.startWeightKg;
  let cursorBodyFatPct = context.startBodyFatPct;
  const baseConfidence = computeForecastConfidence(context);

  phases.forEach((phase, idx) => {
    const durationWeeks = durationWeeksBetween(phase.plannedStartAt, phase.plannedEndAt);
    const startWeightKg = cursorWeightKg;
    const startBodyFatPct = cursorBodyFatPct;
    const isFirstPhase = idx === 0;

    const nutritionGoal = mapPhaseTypeToNutritionGoal(phase.phaseType);
    const startPrescription = computeInitialNutritionPrescription({
      weightKg: startWeightKg,
      heightCm: context.heightCm,
      age: context.age,
      gender: context.gender,
      activityLevel: context.activityLevel,
      experienceLevel: context.experienceLevel,
      measuredBmr: isFirstPhase ? context.measuredBmr : null,
      goal: nutritionGoal,
    });

    const assumptions: string[] = [];
    let totalDeltaKg = 0;
    if (phase.phaseType === "FAT_LOSS" || phase.phaseType === "MINI_CUT" || phase.phaseType === "LEAN_GAIN") {
      const direction = phase.phaseType === "LEAN_GAIN" ? "gain" : "loss";
      const rawWeeklyDeltaKg = (startPrescription.deficitOrSurplusKcal * 7) / KCAL_PER_KG_TISSUE;
      const maxWeeklyDeltaKg = startWeightKg * MAX_SAFE_WEEKLY_RATE_PCT[direction];
      const clampedWeeklyDeltaKg =
        Math.sign(rawWeeklyDeltaKg) * Math.min(Math.abs(rawWeeklyDeltaKg), maxWeeklyDeltaKg);
      totalDeltaKg = clampedWeeklyDeltaKg * durationWeeks;
      if (Math.abs(rawWeeklyDeltaKg) > maxWeeklyDeltaKg) {
        assumptions.push(
          "Tốc độ thay đổi cân nặng đã được giới hạn theo mức an toàn khuyến nghị, không phản ánh chính xác 100% mức thâm hụt/thặng dư calo.",
        );
      }
    } else if (phase.phaseType === "RECOMPOSITION") {
      assumptions.push(
        "Tái cấu trúc cơ thể có thể vừa giảm mỡ vừa tăng cơ cùng lúc — Gymini chưa đủ mô hình để tách rõ hai xu hướng này, nên cân nặng dự kiến được giữ ổn định (ước tính thận trọng).",
      );
    } else {
      assumptions.push("Giai đoạn này được giả định giữ cân nặng ổn định (ước tính thận trọng).");
    }

    const endWeightKg = roundTo(startWeightKg + totalDeltaKg, 1);

    let endBodyFatPct: number | null = null;
    if (startBodyFatPct != null) {
      if (totalDeltaKg !== 0) {
        const partition =
          phase.phaseType === "LEAN_GAIN" ? MUSCLE_GAIN_LEAN_MASS_PARTITION : FAT_LOSS_FAT_MASS_PARTITION;
        const fatShare = phase.phaseType === "LEAN_GAIN" ? 1 - partition : partition;
        const startFatMassKg = startWeightKg * (startBodyFatPct / 100);
        const endFatMassKg = startFatMassKg + totalDeltaKg * fatShare;
        endBodyFatPct = roundTo((endFatMassKg / endWeightKg) * 100, 1);
        assumptions.push(
          phase.phaseType === "LEAN_GAIN"
            ? "Giả định khoảng 50% cân nặng tăng thêm là khối nạc, phần còn lại là mỡ — không phải toàn bộ là cơ."
            : "Giả định khoảng 80% cân nặng giảm là mỡ, 20% là khối nạc — không phải toàn bộ là mỡ.",
        );
      } else {
        endBodyFatPct = startBodyFatPct;
      }
    }

    const endPrescription = computeInitialNutritionPrescription({
      weightKg: endWeightKg,
      heightCm: context.heightCm,
      age: context.age,
      gender: context.gender,
      activityLevel: context.activityLevel,
      experienceLevel: context.experienceLevel,
      measuredBmr: null, // a future/end-of-phase state is never a real measurement
      goal: nutritionGoal,
    });

    const startFfmi = startBodyFatPct != null ? computeFfmi(startWeightKg, context.heightCm, startBodyFatPct) : null;
    const endFfmi = endBodyFatPct != null ? computeFfmi(endWeightKg, context.heightCm, endBodyFatPct) : null;

    const phaseTier = applyDistanceCap(baseConfidence.tier, idx);
    const phaseConfidence: ForecastConfidence = { ...baseConfidence, tier: phaseTier };
    const weightRange = computeForecastRange(endWeightKg, totalDeltaKg, phaseTier, 1);
    const bodyFatRange =
      endBodyFatPct != null ? computeForecastRange(endBodyFatPct, endBodyFatPct - (startBodyFatPct ?? endBodyFatPct), phaseTier, 1) : null;

    results.push({
      phaseIndex: phase.phaseIndex,
      phaseType: phase.phaseType,
      name: phase.name,
      plannedStartAt: phase.plannedStartAt,
      plannedEndAt: phase.plannedEndAt,
      durationWeeks,
      projectedStartWeightKg: roundTo(startWeightKg, 1),
      projectedEndWeightKg: endWeightKg,
      projectedStartBodyFatPct: startBodyFatPct,
      projectedEndBodyFatPct: endBodyFatPct,
      projectedStartFfmi: startFfmi,
      projectedEndFfmi: endFfmi,
      projectedEndWeightRangeKg: weightRange,
      projectedEndBodyFatPctRange: bodyFatRange,
      confidence: phaseConfidence,
      estimatedStartBmr: startPrescription.bmr,
      estimatedStartTdee: startPrescription.maintenanceCalories,
      estimatedEndBmr: endPrescription.bmr,
      estimatedEndTdee: endPrescription.maintenanceCalories,
      bmrFormula: startPrescription.bmrFormula,
      projectedCalories: startPrescription.targetCalories,
      projectedDeficitOrSurplusKcal: startPrescription.deficitOrSurplusKcal,
      projectedDeficitOrSurplusPercent:
        startPrescription.maintenanceCalories > 0
          ? roundTo(startPrescription.deficitOrSurplusKcal / startPrescription.maintenanceCalories, 3)
          : null,
      projectedMacros: {
        proteinGrams: startPrescription.proteinGrams,
        carbGrams: startPrescription.carbGrams,
        fatGrams: startPrescription.fatGrams,
      },
      dataCompleteness: { bodyComposition: startBodyFatPct != null },
      assumptions,
    });

    cursorWeightKg = endWeightKg;
    cursorBodyFatPct = endBodyFatPct;
  });

  return results;
}
