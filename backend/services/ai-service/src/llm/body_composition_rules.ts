/**
 * body_composition_rules.ts
 * ──────────────────────────
 * Evidence-based rule engine that interprets user body metrics and returns
 * plan adjustments + evidence retrieval queries for the LLM context.
 *
 * Rules are conservative (not medical advice):
 *  - Do not diagnose disease.
 *  - Do not recommend extreme deficits.
 *  - Always prefer InBody data over self-reported profile weight.
 *  - Note data quality issues (e.g., single InBody reading, no DXA).
 */

import type { AdjustmentReason, UserProfile } from "./types";

export interface BodyCompAnalysis {
  adjustments: AdjustmentReason[];
  safetyNotes: string[];
  evidenceQueries: string[]; // semantic queries for Qdrant retrieval
  dataQualityNotes: string[]; // e.g., "single InBody reading — avoid over-adjusting"
  planConstraints: {
    maxDeficitKcal?: number;
    minProteinGKg?: number;
    resistanceRequired: boolean;
    cardioNote?: string;
    volumeGuidance?: string;
    splitGuidance?: string;
  };
}

// ── Reference values ──────────────────────────────────────────────────────────

const BF_OBESE_M = 25; // % body fat thresholds
const BF_OBESE_F = 32;
const BF_HIGH_M = 20;
const BF_HIGH_F = 28;

const BMI_OVERWEIGHT = 25;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isHighBF(bfPct: number, gender?: string): boolean {
  const threshold = gender === "FEMALE" ? BF_OBESE_F : BF_OBESE_M;
  return bfPct >= threshold;
}

function isModerateHighBF(bfPct: number, gender?: string): boolean {
  const threshold = gender === "FEMALE" ? BF_HIGH_F : BF_HIGH_M;
  return bfPct >= threshold;
}

// Bilateral limb asymmetry thresholds, expressed as % difference relative to
// the larger side. These mirror common InBody/BIA practitioner guidance:
// <5% is normal side-to-side variation (measurement noise + natural
// handedness), 5-10% is a mild but noticeable imbalance worth a small
// training bias, >=10% is a significant imbalance worth explicit correction.
const LIMB_ASYMMETRY_MILD_PCT = 5;
const LIMB_ASYMMETRY_SIGNIFICANT_PCT = 10;

interface LimbAsymmetryResult {
  adjustment: AdjustmentReason;
  evidenceQueries: string[];
  weakerSide: "left" | "right";
}

/**
 * Compares left vs right segmental muscle mass for one limb pair (arms or
 * legs) and returns a plan adjustment when the gap is meaningful. Returns
 * null when data is missing or the sides are within normal variation.
 */
function analyzeLimbAsymmetry(
  limbLabelVi: "Tay" | "Chân",
  leftKg: number | undefined,
  rightKg: number | undefined,
): LimbAsymmetryResult | null {
  if (!leftKg || !rightKg || leftKg <= 0 || rightKg <= 0) return null;

  const larger = Math.max(leftKg, rightKg);
  const diffPct = (Math.abs(leftKg - rightKg) / larger) * 100;
  if (diffPct < LIMB_ASYMMETRY_MILD_PCT) return null;

  const weakerSide: "left" | "right" = leftKg < rightKg ? "left" : "right";
  const weakerSideVi = weakerSide === "left" ? "trái" : "phải";
  const strongerSideVi = weakerSide === "left" ? "phải" : "trái";
  const isSignificant = diffPct >= LIMB_ASYMMETRY_SIGNIFICANT_PCT;
  const limbLower = limbLabelVi === "Tay" ? "tay" : "chân";

  const unilateralExamples =
    limbLabelVi === "Tay"
      ? "Single-Arm Dumbbell Row, One-Arm Dumbbell Overhead Press, Cable Single-Arm Triceps Pushdown"
      : "Bulgarian Split Squat, Single-Leg Press, Walking Lunge";

  return {
    weakerSide,
    adjustment: {
      metric:
        limbLabelVi === "Tay" ? "segmentalMuscle_arms" : "segmentalMuscle_legs",
      observed_value: `${limbLabelVi} trái ${leftKg}kg vs ${limbLabelVi} phải ${rightKg}kg (lệch ${diffPct.toFixed(1)}%)`,
      interpretation: isSignificant
        ? `Khối lượng cơ ${limbLower} bên ${weakerSideVi} thấp hơn bên ${strongerSideVi} tới ${diffPct.toFixed(1)}% — mức lệch đáng kể, vượt ngưỡng biến động đo bình thường (~${LIMB_ASYMMETRY_MILD_PCT}%).`
        : `Khối lượng cơ ${limbLower} bên ${weakerSideVi} thấp hơn bên ${strongerSideVi} khoảng ${diffPct.toFixed(1)}% — lệch nhẹ, có thể do thuận tay/chân hoặc thói quen tập luyện.`,
      plan_adjustment: isSignificant
        ? `Ưu tiên bài tập unilateral (từng bên riêng biệt) cho ${limbLower}, ví dụ: ${unilateralExamples}. ` +
          `Tập bên ${weakerSideVi} TRƯỚC khi còn sung sức, và cân nhắc thêm 1 hiệp (set) cho bên ${weakerSideVi} so với bên ${strongerSideVi}. ` +
          "Theo dõi lại qua lần đo InBody tiếp theo để đánh giá tiến triển."
        : `Thêm 1-2 bài unilateral cho ${limbLower} (ví dụ: ${unilateralExamples}) để cân bằng dần, không cần thay đổi toàn bộ cấu trúc buổi tập.`,
    },
    evidenceQueries: isSignificant
      ? [
          "bilateral asymmetry unilateral training strength correction",
          "single limb training muscle imbalance protocol",
        ]
      : ["unilateral exercise bilateral strength balance training"],
  };
}

// ── Main analysis function ────────────────────────────────────────────────────

export function analyzeBodyComposition(profile: UserProfile): BodyCompAnalysis {
  const analysis: BodyCompAnalysis = {
    adjustments: [],
    safetyNotes: [],
    evidenceQueries: [],
    dataQualityNotes: [],
    planConstraints: {
      resistanceRequired: true,
    },
  };

  const ib = profile.inBody;
  const goal = profile.goal?.toLowerCase() ?? "";
  const gender = profile.gender;
  const experience = profile.experienceLevel;
  const bfPct = ib?.bodyFatPct;
  const muscleMassKg = ib?.skeletalMuscleKg;
  const weightKg = profile.currentWeightKg;
  const heightCm = profile.heightCm;
  const injuries = profile.training?.injuries ?? [];

  // ── BMI calculation ───────────────────────────────────────────────────────
  let bmi: number | undefined;
  if (weightKg && heightCm && heightCm > 0) {
    bmi = Math.round((weightKg / Math.pow(heightCm / 100, 2)) * 10) / 10;
  }

  // ── Data quality notes ────────────────────────────────────────────────────
  if (!ib) {
    analysis.dataQualityNotes.push(
      "No InBody/DXA data available. Using self-reported profile weight. " +
        "Body composition estimates will be less accurate. Recommend measuring InBody for better personalization.",
    );
  } else {
    const measuredAt = ib.measuredAt;
    if (measuredAt) {
      const daysSinceMeasure = Math.round(
        (Date.now() - new Date(measuredAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceMeasure > 30) {
        analysis.dataQualityNotes.push(
          `InBody measured ${daysSinceMeasure} days ago. Consider re-measuring for more accurate targets. ` +
            "Body composition can change meaningfully over 4+ weeks of training.",
        );
      }
    }
    if (!bfPct) {
      analysis.dataQualityNotes.push(
        "InBody data does not include body fat %. Plans estimated from weight and goal only.",
      );
    }
  }

  // ── Rule A: High body fat + fat loss goal ─────────────────────────────────
  if (
    bfPct &&
    isModerateHighBF(bfPct, gender) &&
    /fat_loss|weight_loss|giam_mo|cutting/.test(goal)
  ) {
    const isVeryHigh = isHighBF(bfPct, gender);
    analysis.adjustments.push({
      metric: "bodyFatPct",
      observed_value: `${bfPct}%`,
      interpretation: isVeryHigh
        ? `Body fat ${bfPct}% is in the obese range for ${gender === "FEMALE" ? "women" : "men"} (≥${gender === "FEMALE" ? BF_OBESE_F : BF_OBESE_M}%). Reducing fat mass is a priority.`
        : `Body fat ${bfPct}% is moderately elevated. A moderate deficit with preserved resistance training is appropriate.`,
      plan_adjustment: isVeryHigh
        ? "Moderate caloric deficit (300–500 kcal below TDEE). High protein (≥1.8 g/kg) to preserve muscle. 3–4 resistance sessions + 2–3 cardio sessions per week. Avoid extreme deficit (>750 kcal) to prevent muscle loss."
        : "Moderate deficit (200–400 kcal). Maintain current resistance volume. Add 1–2 light cardio sessions. Monitor trend over 4 weeks before adjusting.",
    });

    analysis.planConstraints.maxDeficitKcal = isVeryHigh ? 500 : 400;
    analysis.planConstraints.minProteinGKg = 1.8;
    analysis.planConstraints.resistanceRequired = true;
    analysis.planConstraints.cardioNote = isVeryHigh
      ? "2–3 moderate-intensity cardio sessions (30–45 min) per week for additional energy expenditure"
      : "1–2 light cardio sessions to complement resistance training";
    analysis.planConstraints.volumeGuidance =
      "3–5 sets per muscle group, 8–15 rep range for fat loss while preserving muscle";

    analysis.evidenceQueries.push(
      "high body fat calorie deficit resistance training protein fat loss",
      "body fat percentage goal fat loss training volume",
      "protein intake fat loss muscle preservation",
    );
  }

  // ── Rule B: Low lean mass + beginner ──────────────────────────────────────
  if (muscleMassKg && experience === "BEGINNER") {
    const expectedLeanMin =
      gender === "FEMALE"
        ? (weightKg ?? 60) * 0.45 // rough lower bound female
        : (weightKg ?? 80) * 0.55; // rough lower bound male

    if (muscleMassKg < expectedLeanMin) {
      analysis.adjustments.push({
        metric: "skeletalMuscleKg",
        observed_value: `${muscleMassKg} kg`,
        interpretation: `Skeletal muscle mass (${muscleMassKg} kg) is below expected range for body weight. This indicates low muscle base typical of a beginner.`,
        plan_adjustment:
          "Prioritize full-body or upper/lower split (3–4 days/week). Low–moderate volume. " +
          "Emphasize compound movements (squat, deadlift, press, row). " +
          "Progressive overload with small weekly increments. " +
          "Avoid 5–6 day specialization splits until base strength is established.",
      });

      analysis.planConstraints.splitGuidance =
        "Full body (3 days) or Upper/Lower (4 days) — not PPL until intermediate level";
      analysis.planConstraints.volumeGuidance =
        "2–3 sets per exercise, 8–12 reps, focus on technique over load";

      analysis.evidenceQueries.push(
        "beginner resistance training low lean mass compound movements",
        "training frequency beginner progressive overload full body",
        "muscle building beginner volume frequency guidelines",
      );
    }
  }

  // ── Rule C: High BMI but muscle mass also high — avoid BMI-only judgment ──
  if (
    bmi &&
    bmi >= BMI_OVERWEIGHT &&
    muscleMassKg &&
    bfPct &&
    !isModerateHighBF(bfPct, gender)
  ) {
    analysis.adjustments.push({
      metric: "bmi_vs_body_composition",
      observed_value: `BMI=${bmi}, BF%=${bfPct}%, muscle=${muscleMassKg}kg`,
      interpretation:
        `BMI ${bmi} appears overweight/obese, but body fat % (${bfPct}%) and muscle mass (${muscleMassKg}kg) indicate predominantly lean physique. ` +
        "This is common in athletic or muscular individuals — BMI overestimates fatness in high-muscle populations.",
      plan_adjustment:
        "Do NOT treat as fat-loss priority based on BMI alone. " +
        "Use body fat % and waist circumference as primary metrics. " +
        "Plan should focus on performance/maintenance or lean muscle gain as appropriate for stated goal.",
    });

    analysis.evidenceQueries.push(
      "BMI high muscle mass athletic population body fat interpretation",
      "bioelectrical impedance InBody BMI limitation athletic",
    );
  }

  // ── Rule D: No InBody or single reading — measurement quality note ─────────
  if (!ib || !bfPct) {
    analysis.evidenceQueries.push(
      "body composition measurement InBody BIA accuracy limitation",
      "waist circumference BMI body fat estimation",
    );
  } else {
    analysis.evidenceQueries.push(
      "bioelectrical impedance InBody hydration measurement standardization",
    );
  }

  // ── Rule F: Injuries ──────────────────────────────────────────────────────
  if (injuries.length > 0) {
    const injuryList = injuries.join(", ");
    analysis.safetyNotes.push(
      `User reports injuries/limitations: ${injuryList}. ` +
        "The plan must avoid exercises that directly load these areas. " +
        "Substitute with pain-free alternatives. " +
        "If symptoms worsen, consult a qualified physiotherapist. " +
        "This is not medical advice.",
    );
    analysis.evidenceQueries.push(
      `exercise modification ${injuryList} safe alternative low impact`,
    );
  }

  // ── Rule G: Goal-based protein minimum ───────────────────────────────────
  if (/muscle_gain|tang_co|hypertrophy|bulking/.test(goal)) {
    if (!analysis.planConstraints.minProteinGKg) {
      analysis.planConstraints.minProteinGKg = 1.6;
    }
    analysis.evidenceQueries.push(
      "protein intake muscle gain hypertrophy resistance training",
      "protein synthesis muscle building leucine timing",
    );
  }

  // ── Rule H: Left/right segmental muscle asymmetry ─────────────────────────
  // InBody reports per-limb skeletal muscle mass (kg). A meaningful bilateral
  // gap is a well-known, correctable training signal (limb dominance, injury
  // history, unilateral sport background) — bias volume/exercise selection
  // toward the weaker side rather than always training both sides identically.
  const segMuscle = ib?.segmentalMuscle;
  if (segMuscle) {
    const armCase = analyzeLimbAsymmetry(
      "Tay",
      segMuscle.leftArm,
      segMuscle.rightArm,
    );
    if (armCase) {
      analysis.adjustments.push(armCase.adjustment);
      analysis.evidenceQueries.push(...armCase.evidenceQueries);
    }

    const legCase = analyzeLimbAsymmetry(
      "Chân",
      segMuscle.leftLeg,
      segMuscle.rightLeg,
    );
    if (legCase) {
      analysis.adjustments.push(legCase.adjustment);
      analysis.evidenceQueries.push(...legCase.evidenceQueries);
    }

    // ── Rule I: Same-side dominance across both limbs ───────────────────────
    // If the SAME side (e.g. right arm AND right leg) is weaker in both
    // cases, this points to a whole-body dominant-side pattern (handedness,
    // stance sport, old injury) rather than two unrelated imbalances — call
    // it out explicitly so the plan can bias overall exercise order/volume,
    // not just isolated arm/leg accessory work.
    if (armCase && legCase && armCase.weakerSide === legCase.weakerSide) {
      const side = armCase.weakerSide === "left" ? "trái" : "phải";
      analysis.adjustments.push({
        metric: "segmentalMuscle_sameSideDominance",
        observed_value: `Bên ${side} yếu hơn ở cả tay và chân`,
        interpretation:
          `Cả tay và chân bên ${side} đều có khối lượng cơ thấp hơn bên đối diện. ` +
          "Đây thường là dấu hiệu của thuận tay/chân, thói quen vận động một bên, hoặc chấn thương cũ — không chỉ là lệch cục bộ một nhóm cơ.",
        plan_adjustment:
          `Cân nhắc bắt đầu buổi tập bằng các bài unilateral cho bên ${side} khi còn sung sức, ` +
          "và rà soát thói quen sinh hoạt/thể thao một bên (ví dụ mang vác, đá bóng) có thể là nguyên nhân gốc rễ. " +
          "Nếu lệch rõ rệt và kéo dài, khuyến nghị tham khảo huấn luyện viên hoặc chuyên gia vật lý trị liệu để đánh giá thêm.",
      });
      analysis.evidenceQueries.push(
        "limb dominance handedness unilateral sport muscle asymmetry",
      );
    }
  }

  // ── Generic evidence queries always useful ────────────────────────────────
  analysis.evidenceQueries.push(
    "training frequency weekly volume evidence guidelines",
  );

  // Deduplicate queries
  analysis.evidenceQueries = Array.from(
    new Set(analysis.evidenceQueries),
  ).slice(0, 8);

  return analysis;
}

/** Format body comp analysis as a compact text block for LLM context. */
export function formatBodyCompAnalysis(analysis: BodyCompAnalysis): string {
  const parts: string[] = [];

  if (analysis.dataQualityNotes.length > 0) {
    parts.push("[Chất lượng dữ liệu đo]");
    analysis.dataQualityNotes.forEach((n) => parts.push(`  - ${n}`));
  }

  if (analysis.adjustments.length > 0) {
    parts.push("[Điều chỉnh kế hoạch dựa trên chỉ số cơ thể]");
    analysis.adjustments.forEach((a) => {
      parts.push(`  Chỉ số: ${a.metric} = ${a.observed_value}`);
      parts.push(`  Phân tích: ${a.interpretation}`);
      parts.push(`  Điều chỉnh: ${a.plan_adjustment}`);
    });
  }

  if (analysis.planConstraints) {
    const c = analysis.planConstraints;
    const constraints: string[] = [];
    if (c.maxDeficitKcal)
      constraints.push(`Caloric deficit tối đa: ${c.maxDeficitKcal} kcal`);
    if (c.minProteinGKg)
      constraints.push(`Protein tối thiểu: ${c.minProteinGKg} g/kg/ngày`);
    if (c.splitGuidance) constraints.push(`Split phù hợp: ${c.splitGuidance}`);
    if (c.volumeGuidance)
      constraints.push(`Volume guidance: ${c.volumeGuidance}`);
    if (c.cardioNote) constraints.push(`Cardio: ${c.cardioNote}`);
    if (constraints.length > 0) {
      parts.push("[Ràng buộc kế hoạch]");
      constraints.forEach((c) => parts.push(`  - ${c}`));
    }
  }

  if (analysis.safetyNotes.length > 0) {
    parts.push("[Safety notes - bắt buộc đề cập trong response]");
    analysis.safetyNotes.forEach((n) => parts.push(`  - ${n}`));
  }

  return parts.join("\n");
}
