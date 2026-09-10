import {
  computeInitialNutritionPrescription,
  type Gender,
  type ActivityLevel,
  type Goal,
} from "./nutrition-bootstrap.engine";

/**
 * Gymini Guided Roadmap Creation — read-only fitness diagnosis/energy
 * calculations (docs/GYMINI_GUIDED_ROADMAP_CREATION_DESIGN.md §4/§15/§16).
 *
 * Deliberately mirrors nutrition-bootstrap.engine.ts's own architectural
 * rule: self-contained, no AI dependency, so the diagnosis screen works
 * even if ai-service/the LLM provider is down. The ONLY authoritative
 * BMR/TDEE calculation in the product is
 * computeInitialNutritionPrescription (reused directly, never
 * reimplemented here) — everything in this file is either a pure
 * arithmetic derivation of already-real inputs (FFMI) or an illustrative,
 * always-reconciled-to-the-real-total decomposition (the energy
 * breakdown's steps/training/TEF sub-lines).
 */

export interface EnergyBreakdownInput {
  weightKg: number;
  heightCm: number;
  age: number;
  gender: Gender;
  activityLevel: ActivityLevel;
  experienceLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null;
  measuredBmr?: number | null;
  /** Wizard-only, never persisted to UserProfile — see design doc §5/§12. */
  trainingDaysPerWeek?: number | null;
  dailyGoalSteps?: number | null;
}

export interface EnergyBreakdownComponent {
  label: string;
  kcal: number;
  /** true for sub-line-items that are an illustrative allocation of the
   * real (TDEE - BMR) gap, never an independently-measured number. */
  estimated: boolean;
}

export interface EnergyBreakdownResult {
  bmr: number;
  bmrFormula: "inbody_measured" | "mifflin_st_jeor";
  /** Real, authoritative — always equals bmr + sum(components[].kcal). */
  tdee: number;
  components: EnergyBreakdownComponent[];
}

/** Allocates the real (TDEE - BMR) gap across illustrative, labeled
 * components that always sum back to exactly that same real gap — never a
 * second, competing TDEE calculation (design doc §4/§7).
 *
 * Roadmap Projection Hardening fix (docs/GYMINI_ROADMAP_PROJECTION_HARDENING_DESIGN.md
 * §2/§7): a component only gets its own labeled row when the input that
 * would justify it is actually present and nonzero. There is no
 * defensible independent way to compute a TEF (thermic effect of food)
 * line from the data this wizard collects, so TEF is NOT shown as its
 * own row — it was previously a fixed 15%-of-gap "residual bucket"
 * mislabeled as a specific physiological quantity (a real bug this
 * pass fixes). Everything not attributable to a real steps/training
 * input — TEF included — folds into one honestly-named "Hoạt động &
 * tiêu hao khác" row, so the total still always reconciles exactly to
 * the real TDEE without implying false measured precision anywhere. */
export function computeEnergyBreakdown(input: EnergyBreakdownInput): EnergyBreakdownResult {
  const prescription = computeInitialNutritionPrescription({
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    age: input.age,
    gender: input.gender,
    activityLevel: input.activityLevel,
    experienceLevel: input.experienceLevel,
    measuredBmr: input.measuredBmr,
    goal: "MAINTENANCE", // goal-neutral — this screen shows current expenditure, not a target
  });

  const gap = Math.max(0, prescription.maintenanceCalories - prescription.bmr);
  const trainingDays = Math.max(0, Math.min(7, input.trainingDaysPerWeek ?? 0));
  const steps = Math.max(0, input.dailyGoalSteps ?? 0);

  // Rough relative weights, not absolute — only used to PROPORTION the
  // real gap across labeled rows the caller actually gave us evidence
  // for, never to compute an independent total.
  const stepsWeight = steps > 0 ? Math.min(1, steps / 10_000) : 0; // saturates at 10k steps
  const trainingWeight = trainingDays > 0 ? trainingDays / 7 : 0;
  const totalWeight = stepsWeight + trainingWeight;

  let stepsKcal = 0;
  let trainingKcal = 0;
  if (totalWeight > 0) {
    // Steps/training only ever get a share of the gap they can defensibly
    // claim (up to 70% combined) — the rest always stays in "Hoạt động &
    // tiêu hao khác" (BMR itself already dwarfs both; a 30km/day walker
    // still doesn't attribute 100% of their non-BMR burn to steps alone).
    const claimableShare = 0.7;
    stepsKcal = Math.round((gap * claimableShare * stepsWeight) / totalWeight);
    trainingKcal = Math.round((gap * claimableShare * trainingWeight) / totalWeight);
  }
  const otherKcal = gap - stepsKcal - trainingKcal; // reconciliation remainder, never dropped, never fabricated as TEF

  const components: EnergyBreakdownComponent[] = [];
  if (stepsKcal > 0) components.push({ label: "Bước chân hằng ngày", kcal: stepsKcal, estimated: true });
  if (trainingKcal > 0) components.push({ label: "Tập kháng lực", kcal: trainingKcal, estimated: true });
  components.push({ label: "Hoạt động & tiêu hao khác", kcal: otherKcal, estimated: true });

  return {
    bmr: prescription.bmr,
    bmrFormula: prescription.bmrFormula,
    tdee: prescription.maintenanceCalories,
    components,
  };
}

export interface FfmiResult {
  /** Fat-free mass, kg — weight * (1 - bodyFatPct/100). Standard derivation,
   * not a separately-measured value. */
  fatFreeMassKg: number;
  ffmi: number;
  /** Height-normalized FFMI (Kouri et al. 1995 convention:
   * ffmi + 6.1 * (1.8 - heightM)) — the commonly-cited "comparable across
   * heights" variant. */
  normalizedFfmi: number;
}

export function computeFfmi(weightKg: number, heightCm: number, bodyFatPct: number): FfmiResult {
  const heightM = heightCm / 100;
  const fatFreeMassKg = weightKg * (1 - bodyFatPct / 100);
  const ffmi = fatFreeMassKg / (heightM * heightM);
  const normalizedFfmi = ffmi + 6.1 * (1.8 - heightM);
  return {
    fatFreeMassKg: Math.round(fatFreeMassKg * 10) / 10,
    ffmi: Math.round(ffmi * 100) / 100,
    normalizedFfmi: Math.round(normalizedFfmi * 100) / 100,
  };
}

// Shared safety ceiling — the same constant assessTargetRealism() uses
// for its own target-timeframe sanity check AND (Roadmap Projection
// Hardening phase) fitness-roadmap-forecast.engine.ts's body-composition
// projection clamp, so a projected phase can never imply a change faster
// than the ceiling the diagnosis engine itself already warns about.
// 1%/week for fat loss, 0.25%/week for muscle gain — commonly-cited safe
// upper bounds (hall-2011-dynamic-energy-balance / garthe-2011-weight-loss-
// rate-athletes, already cited as evidenceIds by
// computeInitialNutritionPrescription for the same underlying deficit/
// surplus fractions).
export const MAX_SAFE_WEEKLY_RATE_PCT = {
  loss: 0.01,
  gain: 0.0025,
} as const;

export interface TargetRealismInput {
  currentWeightKg: number;
  targetWeightKg: number | null;
  timeframeWeeks: number | null;
  goal: Goal;
}

export interface TargetRealismResult {
  warnings: string[];
  /** A suggested minimum realistic timeframe, weeks, only set when the
   * requested timeframe is too aggressive for the requested weight change —
   * never silently substituted, only surfaced for the user to see. */
  suggestedMinTimeframeWeeks: number | null;
}

/** Deterministic, non-medical sanity check on the requested target/timeframe
 * — evidence-based safe weekly rate bounds already used elsewhere in the
 * product's own safety literature citations (nutrition-bootstrap.engine.ts's
 * hall-2011/garthe-2011 sources: roughly up to ~1% body weight/week for
 * fat loss is a commonly-cited upper bound before diminishing returns and
 * higher lean-mass-loss risk). Never a diagnosis, never blocks — only a
 * suggestion, same "warn, never hard-block" principle safety screening
 * already follows. */
export function assessTargetRealism(input: TargetRealismInput): TargetRealismResult {
  const warnings: string[] = [];
  let suggestedMinTimeframeWeeks: number | null = null;

  if (input.targetWeightKg != null && input.timeframeWeeks != null && input.timeframeWeeks > 0) {
    const deltaKg = Math.abs(input.currentWeightKg - input.targetWeightKg);
    const maxSafeRatePctPerWeek = input.goal === "MUSCLE_GAIN" ? MAX_SAFE_WEEKLY_RATE_PCT.gain : MAX_SAFE_WEEKLY_RATE_PCT.loss;
    const maxSafeKgPerWeek = input.currentWeightKg * maxSafeRatePctPerWeek;
    const minRealisticWeeks = maxSafeKgPerWeek > 0 ? Math.ceil(deltaKg / maxSafeKgPerWeek) : null;
    if (minRealisticWeeks != null && minRealisticWeeks > input.timeframeWeeks) {
      suggestedMinTimeframeWeeks = minRealisticWeeks;
      warnings.push(
        `Thời gian mong muốn (${input.timeframeWeeks} tuần) có thể quá ngắn cho mức thay đổi cân nặng này. Gymini đề xuất khoảng ${minRealisticWeeks} tuần trở lên để an toàn và bền vững hơn.`,
      );
    }
  }

  return { warnings, suggestedMinTimeframeWeeks };
}

export function buildDiagnosisReasoning(args: {
  goal: Goal;
  currentBodyFatPct: number | null;
  targetBodyFatPct: number | null;
  currentFfmi: number | null;
  targetRealismWarnings: string[];
  safetyReviewRequired: boolean;
}): string {
  const lines: string[] = [];
  if (args.safetyReviewRequired) {
    lines.push(
      "Hồ sơ sức khỏe của bạn có yếu tố Gymini khuyên nên được xem xét thêm — lộ trình đề xuất sẽ ưu tiên an toàn hơn tốc độ.",
    );
  }
  if (args.currentBodyFatPct != null && args.targetBodyFatPct != null) {
    if (args.currentBodyFatPct > args.targetBodyFatPct) {
      lines.push(
        `Tỷ lệ mỡ hiện tại (${args.currentBodyFatPct}%) đang cao hơn mục tiêu (${args.targetBodyFatPct}%)${
          args.currentFfmi != null ? `, trong khi khối nạc đang ở mức FFMI ${args.currentFfmi}` : ""
        } — Gymini đề xuất ưu tiên một giai đoạn giảm mỡ trước.`,
      );
    } else if (args.currentBodyFatPct < args.targetBodyFatPct) {
      lines.push("Tỷ lệ mỡ hiện tại đã thấp hơn mục tiêu — lộ trình có thể ưu tiên tăng cơ có kiểm soát.");
    } else {
      lines.push("Tỷ lệ mỡ hiện tại đã gần với mục tiêu — lộ trình có thể tập trung vào duy trì và cải thiện vóc dáng.");
    }
  } else {
    lines.push("Chưa đủ dữ liệu tỷ lệ mỡ cơ thể để so sánh chi tiết — lộ trình dựa trên mục tiêu bạn đã chọn.");
  }
  lines.push(...args.targetRealismWarnings);
  // Deliberately does NOT append the permanent adaptive-Gymini messaging
  // ("Lộ trình này không cố định...") here — the wizard's Step 4 renders
  // that as its own always-visible, separate UI element (never
  // conditional on diagnosis content), per the master task's explicit
  // distinction between "Nhận định lộ trình" reasoning and a "permanent"
  // adaptive-messaging block. Keeping them apart here avoids the same
  // sentence being duplicated verbatim on screen.
  return lines.join(" ");
}
