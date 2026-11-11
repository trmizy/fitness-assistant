import type { Goal } from "./schema";

/**
 * Deterministic, bounded recommendations for a MISSING value the user asked the assistant to choose ("hãy đề xuất").
 * Nothing here comes from a model: every number is derived from the user's own height / weight / goal and public-health
 * conventions (BMI bands, a safe weekly rate of change), and every result carries the inputs it used so the assistant
 * can answer "vì sao?" from data — never with invented medical certainty.
 */

// WHO adult BMI bands: 18.5–24.9 is the "normal" range. Targets never go below the lower-normal band.
const BMI_FLOOR_TARGET = 21;
const BMI_NORMAL_UPPER = 24.9;
// Conservative sustainable pace: ~0.5–0.75 % of body weight per week for loss; ~0.25 % for lean gain.
const LOSS_WEEKLY_PCT = 0.0065;
const GAIN_WEEKLY_PCT = 0.0025;

export interface TargetWeightInput {
  heightCm?: number;
  currentWeightKg?: number;
  goal?: Goal;
  gender?: string;
}

export type TargetWeightRecommendation =
  | { kind: "INSUFFICIENT"; missing: string[] }
  | {
      kind: "LOSS" | "GAIN" | "MAINTAIN" | "GAIN_NOT_ADVISED";
      /** ascending list of intermediate targets the user can work through */
      checkpoints: number[];
      recommendedKg: number;
      rangeKg: [number, number];
      bmiNow: number;
      weeklyRateKg: number;
      weeksToRecommended: number;
      inputs: { heightCm: number; currentWeightKg: number; goal?: Goal };
      note: string;
    };

const round1 = (n: number) => Math.round(n * 10) / 10;
const roundHalf = (n: number) => Math.round(n * 2) / 2;

export function recommendTargetWeight(input: TargetWeightInput): TargetWeightRecommendation {
  const missing: string[] = [];
  if (!input.heightCm) missing.push("chiều cao");
  if (!input.currentWeightKg) missing.push("cân nặng hiện tại");
  if (missing.length) return { kind: "INSUFFICIENT", missing };

  const h = input.heightCm! / 100;
  const w = input.currentWeightKg!;
  const bmiNow = round1(w / (h * h));
  const floorKg = BMI_FLOOR_TARGET * h * h;
  const upperNormalKg = BMI_NORMAL_UPPER * h * h;
  const inputs = { heightCm: input.heightCm!, currentWeightKg: w, goal: input.goal };

  if (input.goal === "MUSCLE_GAIN") {
    if (bmiNow >= 25) {
      return {
        kind: "GAIN_NOT_ADVISED", checkpoints: [], recommendedKg: w, rangeKg: [w, w], bmiNow, weeklyRateKg: 0, weeksToRecommended: 0, inputs,
        note: "Chỉ số BMI hiện tại khá cao nên mình không đề xuất tăng thêm cân; tăng cơ khi giảm mỡ (recomposition) hoặc giảm mỡ trước thường hợp lý hơn.",
      };
    }
    const c1 = roundHalf(Math.min(w * 1.02, upperNormalKg));
    const c2 = roundHalf(Math.min(w * 1.04, upperNormalKg));
    const cps = [...new Set([c1, c2].filter((x) => x > w))];
    if (!cps.length) return { kind: "MAINTAIN", checkpoints: [w], recommendedKg: w, rangeKg: [w, w], bmiNow, weeklyRateKg: 0, weeksToRecommended: 0, inputs, note: "Bạn đã ở sát ngưỡng BMI bình thường nên mình không đề xuất tăng thêm cân." };
    const rec = cps[cps.length - 1];
    const weekly = round1(w * GAIN_WEEKLY_PCT);
    return { kind: "GAIN", checkpoints: cps, recommendedKg: rec, rangeKg: [cps[0], rec], bmiNow, weeklyRateKg: weekly, weeksToRecommended: Math.ceil((rec - w) / weekly), inputs, note: "Tăng chậm (khoảng 0,25% cân nặng mỗi tuần) để ưu tiên khối cơ." };
  }

  if (input.goal === "MAINTENANCE" || input.goal === "ATHLETIC_PERFORMANCE") {
    return { kind: "MAINTAIN", checkpoints: [w], recommendedKg: w, rangeKg: [w, w], bmiNow, weeklyRateKg: 0, weeksToRecommended: 0, inputs, note: "Mục tiêu duy trì: giữ quanh cân nặng hiện tại." };
  }

  // WEIGHT_LOSS, or an unknown goal where the user is talking about coming down in weight.
  if (bmiNow < BMI_NORMAL_UPPER && bmiNow < 22.5) {
    return { kind: "MAINTAIN", checkpoints: [w], recommendedKg: w, rangeKg: [w, w], bmiNow, weeklyRateKg: 0, weeksToRecommended: 0, inputs, note: "BMI hiện tại đã ở mức thấp-bình thường nên mình không đề xuất giảm thêm cân." };
  }
  const c1 = roundHalf(Math.max(w * 0.95, floorKg));
  const c2 = roundHalf(Math.max(w * 0.9, floorKg));
  const cps = [...new Set([c1, c2].filter((x) => x < w))].sort((a, b) => b - a);
  if (!cps.length) return { kind: "MAINTAIN", checkpoints: [w], recommendedKg: w, rangeKg: [w, w], bmiNow, weeklyRateKg: 0, weeksToRecommended: 0, inputs, note: "Cân nặng hiện tại đã gần ngưỡng an toàn nên mình không đề xuất giảm thêm." };
  // Bigger recommended drop only when there is real room above the healthy band.
  const rec = bmiNow >= 25 ? cps[cps.length - 1] : cps[0];
  const weekly = round1(w * LOSS_WEEKLY_PCT);
  return {
    kind: "LOSS", checkpoints: cps, recommendedKg: rec, rangeKg: [Math.min(...cps), Math.max(...cps)], bmiNow, weeklyRateKg: weekly,
    weeksToRecommended: Math.ceil((w - rec) / weekly), inputs,
    note: "Giảm dần theo từng mốc (khoảng 0,5–0,75% cân nặng mỗi tuần) và không đi dưới ngưỡng BMI bình thường.",
  };
}

export type CountRecommendation = { value: number; reason: string };

/** sessions per week: bounded by goal and (if known) what the user already said about availability. */
export function recommendSessionsPerWeek(input: { goal?: Goal; experience?: string; availableDays?: number }): CountRecommendation {
  const exp = (input.experience ?? "").toUpperCase();
  let value = exp === "BEGINNER" || exp === "" ? 3 : exp === "INTERMEDIATE" ? 4 : 4;
  if (input.goal === "ATHLETIC_PERFORMANCE") value = Math.max(value, 4);
  if (input.availableDays) value = Math.min(value, input.availableDays);
  return { value, reason: exp === "BEGINNER" || exp === "" ? "người mới nên bắt đầu vừa sức để duy trì đều" : "mức này đủ kích thích mà vẫn đủ ngày phục hồi" };
}

export function recommendMealsPerDay(input: { goal?: Goal }): CountRecommendation {
  return input.goal === "MUSCLE_GAIN" ? { value: 4, reason: "dễ chia đều lượng đạm và năng lượng trong ngày" } : { value: 3, reason: "gọn, dễ theo dõi và dễ duy trì" };
}

export type GoalRecommendation =
  | { kind: "INSUFFICIENT"; missing: string[] }
  | { kind: "DIRECTIONAL"; recommended: Goal; bmi: number; inputs: { heightCm: number; currentWeightKg: number }; reason: string }
  | { kind: "USER_CHOICE"; bmi: number; inputs: { heightCm: number; currentWeightKg: number }; reason: string };

/** cut vs bulk from the user's OWN height/weight: only a clear BMI signal gives a direction; otherwise the choice is theirs. */
export function recommendGoal(input: { heightCm?: number; currentWeightKg?: number }): GoalRecommendation {
  const missing: string[] = [];
  if (!input.heightCm) missing.push("chiều cao");
  if (!input.currentWeightKg) missing.push("cân nặng hiện tại");
  if (missing.length) return { kind: "INSUFFICIENT", missing };
  const h = input.heightCm! / 100;
  const bmi = round1(input.currentWeightKg! / (h * h));
  const inputs = { heightCm: input.heightCm!, currentWeightKg: input.currentWeightKg! };
  if (bmi >= 25) return { kind: "DIRECTIONAL", recommended: "WEIGHT_LOSS", bmi, inputs, reason: "BMI đang cao hơn khoảng bình thường (18,5–24,9), nên giảm mỡ (cut) trước rồi mới tăng cơ thường hợp lý hơn" };
  if (bmi < 18.5) return { kind: "DIRECTIONAL", recommended: "MUSCLE_GAIN", bmi, inputs, reason: "BMI đang thấp hơn khoảng bình thường, nên tăng cân theo hướng tăng cơ (bulk) thường hợp lý hơn" };
  return { kind: "USER_CHOICE", bmi, inputs, reason: "BMI đang trong khoảng bình thường nên cả hai hướng đều ổn: giảm mỡ nếu bạn muốn gọn/săn hơn, tăng cơ nếu bạn muốn to và khỏe hơn" };
}
