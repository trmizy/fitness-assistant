import type { InBodyEntry } from "./inbodyMath";

/**
 * 14B.7 (PG-C3) — "Cân bằng cơ thể", rebuilt against published reference ranges (Ngài 5/10) instead of
 * web's radar, which divided each axis by an arbitrary constant (weight/100, muscle/50, fat/30, BMI/35,
 * BMR/2500) and so drew a shape with no meaning.
 *
 * Only metrics that HAVE a recognised reference range are rated:
 * - BMI — WHO adult bands (18.5 / 25 / 30). 25 is also ai-service's `BMI_OVERWEIGHT`.
 * - Body fat % — the normal band printed on InBody result sheets: men 10–20 %, women 18–28 %. The upper
 *   bounds and the "very high" line (25 % / 32 %) are exactly ai-service `body_composition_rules.ts`
 *   (`BF_HIGH_*`, `BF_OBESE_*`), so the app and the AI coach call the same body "high".
 * - Visceral fat level — InBody's guidance: keep it below level 10.
 * - Left/right muscle balance (arms, legs) — ai-service's limb-asymmetry thresholds: < 5 % normal
 *   variation, 5–10 % mild, ≥ 10 % significant.
 * Muscle mass and BMR are NOT rated: the stored `muscleMass` has no single population standard (InBody
 * derives its own from the machine's standard weight), and inventing one would be a fake reference.
 *
 * Display only — nothing here feeds a plan, a NutritionGoal or a CycleAssessment.
 */

export type BalanceVerdict = "low" | "normal" | "high" | "veryHigh";

export type BalanceRow = {
  key: "bmi" | "bodyFatPct" | "visceralFat" | "arms" | "legs";
  label: string;
  /** Shown big on the row, already formatted. */
  valueText: string;
  /** Position on the gauge, in the same unit as the bands. */
  value: number;
  scale: [number, number];
  /** The normal band on the gauge. */
  normal: [number, number];
  verdict: BalanceVerdict;
  verdictLabel: string;
  /** One line: the reference used, and how the value was obtained when it was not read off the sheet. */
  note: string;
};

export type BodyBalance = { rows: BalanceRow[]; missing: string[] };

const BF_RANGE = {
  MALE: { normal: [10, 20] as [number, number], veryHigh: 25, scale: [5, 35] as [number, number] },
  FEMALE: { normal: [18, 28] as [number, number], veryHigh: 32, scale: [10, 45] as [number, number] },
};
const LIMB_MILD = 5;
const LIMB_SIGNIFICANT = 10;

const one = (n: number) => Math.round(n * 10) / 10;

export function bodyBalance(entry: InBodyEntry | null, profile?: { gender?: string | null; heightCm?: number | null } | null): BodyBalance {
  const rows: BalanceRow[] = [];
  const missing: string[] = [];
  if (!entry) return { rows, missing };

  // ── BMI ──────────────────────────────────────────────────────────────────────────────
  const heightCm = entry.height ?? (Number(profile?.heightCm) > 0 ? Number(profile!.heightCm) : null);
  let bmi = entry.bmi && entry.bmi > 0 ? entry.bmi : null;
  let bmiNote = "Chuẩn WHO: 18,5 – 24,9";
  if (bmi == null && heightCm && entry.weight > 0) {
    bmi = entry.weight / (heightCm / 100) ** 2;
    bmiNote += ` · tính từ cân nặng và chiều cao ${entry.height ? "trên phiếu" : "trong hồ sơ"} (${one(heightCm)} cm)`;
  }
  if (bmi != null) {
    const v = one(bmi);
    const [verdict, verdictLabel]: [BalanceVerdict, string] =
      v < 18.5 ? ["low", "Thiếu cân"] : v < 25 ? ["normal", "Bình thường"] : v < 30 ? ["high", "Thừa cân"] : ["veryHigh", "Béo phì"];
    rows.push({ key: "bmi", label: "BMI", valueText: String(v), value: v, scale: [15, 35], normal: [18.5, 25], verdict, verdictLabel, note: bmiNote });
  } else {
    missing.push("BMI — cần chiều cao (trên phiếu hoặc trong hồ sơ).");
  }

  // ── Body fat % ───────────────────────────────────────────────────────────────────────
  const gender = profile?.gender === "MALE" || profile?.gender === "FEMALE" ? profile.gender : null;
  let fatPct = entry.bodyFatPct && entry.bodyFatPct > 0 ? entry.bodyFatPct : null;
  let fatNote = "";
  if (fatPct == null && entry.bodyFat > 0 && entry.weight > 0) {
    fatPct = (entry.bodyFat / entry.weight) * 100;
    fatNote = " · tính từ mỡ (kg) ÷ cân nặng";
  }
  if (fatPct != null && gender) {
    const r = BF_RANGE[gender];
    const v = one(fatPct);
    const [verdict, verdictLabel]: [BalanceVerdict, string] =
      v < r.normal[0] ? ["low", "Thấp"] : v <= r.normal[1] ? ["normal", "Bình thường"] : v < r.veryHigh ? ["high", "Cao"] : ["veryHigh", "Rất cao"];
    rows.push({
      key: "bodyFatPct",
      label: "% mỡ cơ thể",
      valueText: `${v}%`,
      value: v,
      scale: r.scale,
      normal: r.normal,
      verdict,
      verdictLabel,
      note: `Chuẩn InBody cho ${gender === "MALE" ? "nam" : "nữ"}: ${r.normal[0]} – ${r.normal[1]}%${fatNote}`,
    });
  } else if (fatPct != null) {
    missing.push("% mỡ — cần giới tính trong hồ sơ (khoảng chuẩn của nam và nữ khác nhau).");
  }

  // ── Visceral fat level ───────────────────────────────────────────────────────────────
  if (entry.visceralFat != null && entry.visceralFat > 0) {
    const v = one(entry.visceralFat);
    rows.push({
      key: "visceralFat",
      label: "Mỡ nội tạng",
      valueText: `Mức ${v}`,
      value: v,
      scale: [1, 20],
      normal: [1, 9.99],
      verdict: v < 10 ? "normal" : "high",
      verdictLabel: v < 10 ? "Bình thường" : "Cao",
      note: "Chuẩn InBody: dưới mức 10",
    });
  }

  // ── Left / right muscle balance ──────────────────────────────────────────────────────
  const limb = (key: "arms" | "legs", label: string, right: number | null, left: number | null) => {
    if (!right || !left || right <= 0 || left <= 0) return;
    const diff = one((Math.abs(right - left) / Math.max(right, left)) * 100);
    const weaker = left < right ? "trái" : "phải";
    const [verdict, verdictLabel]: [BalanceVerdict, string] =
      diff < LIMB_MILD ? ["normal", "Cân bằng"] : diff < LIMB_SIGNIFICANT ? ["high", "Lệch nhẹ"] : ["veryHigh", "Lệch rõ"];
    rows.push({
      key,
      label,
      valueText: diff < LIMB_MILD ? `Lệch ${diff}%` : `Bên ${weaker} kém ${diff}%`,
      value: diff,
      scale: [0, 20],
      normal: [0, LIMB_MILD],
      verdict,
      verdictLabel,
      note: `Phải ${one(right)} kg · trái ${one(left)} kg — dưới ${LIMB_MILD}% là chênh lệch bình thường`,
    });
  };
  limb("arms", "Cơ hai tay", entry.segmental.rightArmMuscle, entry.segmental.leftArmMuscle);
  limb("legs", "Cơ hai chân", entry.segmental.rightLegMuscle, entry.segmental.leftLegMuscle);

  return { rows, missing };
}

/** 0..1 position of `v` on `scale`, clamped so an extreme reading pins to the end instead of overflowing. */
export function gaugePosition(v: number, scale: [number, number]): number {
  const [a, b] = scale;
  if (b <= a) return 0;
  return Math.min(1, Math.max(0, (v - a) / (b - a)));
}
