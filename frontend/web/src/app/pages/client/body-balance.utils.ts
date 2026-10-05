/**
 * "Cân bằng cơ thể" against published reference ranges (Ngài 5/10) — replaces the radar that divided
 * each axis by an arbitrary constant (weight/100, muscle/50, fat/30, BMI/35, BMR/2500), whose shape
 * carried no meaning.
 *
 * Same ranges, wording and rules as the mobile app (`frontend/mobile/src/features/inbody/bodyBalance.ts`)
 * — keep the two identical so both clients rate the same body the same way:
 * - BMI — WHO adult bands 18.5 / 25 / 30 (25 = ai-service `BMI_OVERWEIGHT`).
 * - Body fat % — InBody result-sheet normal band: men 10–20 %, women 18–28 %; "very high" from 25 % / 32 %.
 *   Upper bounds = ai-service `body_composition_rules.ts` `BF_HIGH_*` / `BF_OBESE_*`.
 * - Visceral fat level — InBody guidance: below level 10.
 * - Left/right muscle balance — ai-service `LIMB_ASYMMETRY_*`: < 5 % normal, 5–10 % mild, ≥ 10 % significant.
 * Muscle mass and BMR are not rated: there is no simple population standard, and inventing one would be
 * a fake reference. Display only — nothing here feeds a plan, a NutritionGoal or a CycleAssessment.
 */

export type BalanceVerdict = "low" | "normal" | "high" | "veryHigh";

export type BalanceRow = {
  key: "bmi" | "bodyFatPct" | "visceralFat" | "arms" | "legs";
  label: string;
  valueText: string;
  value: number;
  scale: [number, number];
  normal: [number, number];
  verdict: BalanceVerdict;
  verdictLabel: string;
  note: string;
};

export type BodyBalance = { rows: BalanceRow[]; missing: string[] };

/** The InBody record fields this reads (`GET /inbody` rows). */
export type BalanceEntry = {
  weight?: number | null;
  height?: number | null;
  bmi?: number | null;
  bodyFat?: number | null;
  bodyFatPct?: number | null;
  visceralFat?: number | null;
  rightArmMuscle?: number | null;
  leftArmMuscle?: number | null;
  rightLegMuscle?: number | null;
  leftLegMuscle?: number | null;
};

const BF_RANGE = {
  MALE: { normal: [10, 20] as [number, number], veryHigh: 25, scale: [5, 35] as [number, number] },
  FEMALE: { normal: [18, 28] as [number, number], veryHigh: 32, scale: [10, 45] as [number, number] },
};
const LIMB_MILD = 5;
const LIMB_SIGNIFICANT = 10;

const one = (n: number) => Math.round(n * 10) / 10;
const pos = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

export function bodyBalance(
  entry: BalanceEntry | null | undefined,
  profile?: { gender?: string | null; heightCm?: number | null } | null,
): BodyBalance {
  const rows: BalanceRow[] = [];
  const missing: string[] = [];
  if (!entry) return { rows, missing };
  const weight = pos(entry.weight);

  // ── BMI ──
  const sheetHeight = pos(entry.height);
  const heightCm = sheetHeight ?? pos(profile?.heightCm);
  let bmi = pos(entry.bmi);
  let bmiNote = "Chuẩn WHO: 18,5 – 24,9";
  if (bmi == null && heightCm && weight) {
    bmi = weight / (heightCm / 100) ** 2;
    bmiNote += ` · tính từ cân nặng và chiều cao ${sheetHeight ? "trên phiếu" : "trong hồ sơ"} (${one(heightCm)} cm)`;
  }
  if (bmi != null) {
    const v = one(bmi);
    const [verdict, verdictLabel]: [BalanceVerdict, string] =
      v < 18.5 ? ["low", "Thiếu cân"] : v < 25 ? ["normal", "Bình thường"] : v < 30 ? ["high", "Thừa cân"] : ["veryHigh", "Béo phì"];
    rows.push({ key: "bmi", label: "BMI", valueText: String(v), value: v, scale: [15, 35], normal: [18.5, 25], verdict, verdictLabel, note: bmiNote });
  } else {
    missing.push("BMI — cần chiều cao (trên phiếu hoặc trong hồ sơ).");
  }

  // ── Body fat % ──
  const gender = profile?.gender === "MALE" || profile?.gender === "FEMALE" ? profile.gender : null;
  let fatPct = pos(entry.bodyFatPct);
  let fatNote = "";
  const fatKg = pos(entry.bodyFat);
  if (fatPct == null && fatKg && weight) {
    fatPct = (fatKg / weight) * 100;
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

  // ── Visceral fat level ──
  const visceral = pos(entry.visceralFat);
  if (visceral != null) {
    const v = one(visceral);
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

  // ── Left / right muscle balance ──
  const limb = (key: "arms" | "legs", label: string, rightRaw: unknown, leftRaw: unknown) => {
    const right = pos(rightRaw);
    const left = pos(leftRaw);
    if (!right || !left) return;
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
  limb("arms", "Cơ hai tay", entry.rightArmMuscle, entry.leftArmMuscle);
  limb("legs", "Cơ hai chân", entry.rightLegMuscle, entry.leftLegMuscle);

  return { rows, missing };
}

/** 0..1 position of `v` on `scale`, clamped so an extreme reading pins to the end. */
export function gaugePosition(v: number, scale: [number, number]): number {
  const [a, b] = scale;
  if (b <= a) return 0;
  return Math.min(1, Math.max(0, (v - a) / (b - a)));
}
