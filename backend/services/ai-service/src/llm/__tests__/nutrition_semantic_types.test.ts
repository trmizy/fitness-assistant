/**
 * V1 RC1 (2026-11-12) — H-13 (REAL HTTP/API, rc-verify-v1b): a brand-new user (NutritionGoal 1874 kcal / 88 g protein, no food
 * logged) was told "bạn hiện đang tiêu thụ 88g đạm/ngày". Two causes:
 *  1. /nutrition/daily-history returns a row per day with consumed = 0 for a program nobody has logged against; the prompt
 *     rendered it as "Lịch sử dinh dưỡng (7 ngày, TB: 0 kcal …)" — "not logged" became "ate nothing" history.
 *  2. Nothing told the model which figure is a TARGET and which is logged INTAKE.
 * Semantic types kept apart: TARGET (NutritionGoal / engine), LOGGED intake (diary), ESTIMATE. Oracle: hand-written.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promptBuilder } from "../prompt_builder";
import { inputParser } from "../input_parser";
import { recommendationEngine } from "../recommendation_engine";
import { planContext } from "../context_plan";
import { groundIntakeClaims } from "../intake_claim_guard";

const profile: any = { age: 26, gender: "FEMALE", heightCm: 158, currentWeightKg: 52, goal: "MUSCLE_GAIN", nutritionGoal: { calories: 1874, protein: 88, carbs: 264, fat: 52 }, training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } };
const build = (ctx: any) => {
  const q = "Ăn chay thuần có đủ protein để tăng cơ không?";
  const parsed = { ...inputParser.parse(q, profile), routeIntent: "meal_plan_request" } as any;
  const plan = planContext({ intent: "meal_plan_request", question: q, personalQuestion: true, bodyCompositionQuestion: false, mentionsInjury: false, hasSessionHistory: false });
  return promptBuilder.build(q, parsed, { profile, inBodyHistory: [], workoutHistory: [], memories: [], nutritionHistory: [], ...ctx } as any, { documents: [], isEmpty: true } as any, recommendationEngine.recommend(profile, parsed, "vi"), "vi", [], undefined, { contextPlan: plan } as any);
};
const days = (consumed: number | null) => Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, consumedCalories: consumed, consumedProtein: consumed == null ? null : 0, consumedCarbs: consumed == null ? null : 0, consumedFat: consumed == null ? null : 0 }));

test("program rows with nothing logged are 'not logged', not a 0-kcal eating history", () => {
  const p = build({ dailyConsumptionHistory: days(0) });
  assert.doesNotMatch(p, /TB: 0 kcal/);
  assert.match(p, /chưa ghi nhận/i);
});

test("real logged intake is shown as LOGGED intake, averaged over logged days only", () => {
  const d = days(0); d[0] = { ...d[0], consumedCalories: 1500, consumedProtein: 70, consumedCarbs: 180, consumedFat: 50 };
  const p = build({ dailyConsumptionHistory: d });
  assert.match(p, /đã ghi nhận/i);
  assert.match(p, /TB: 1500 kcal P70g/, "a day with no entries does not drag the average down");
});

test("intake claim equal to the TARGET with nothing logged → stated as the target, not as current intake", () => {
  const r = groundIntakeClaims("Với mục tiêu tăng cơ, bạn hiện đang tiêu thụ **88g đạm/ngày**, tương đương **1.69g/kg**.", { proteinTargetG: 88, loggedIntake: false, lang: "vi" });
  assert.doesNotMatch(r.answer, /đang tiêu thụ/);
  assert.match(r.answer, /mục tiêu/);
  assert.match(r.answer, /88g/);
  assert.equal(r.rewritten, 1);
});

test("English intake claim is grounded the same way", () => {
  const r = groundIntakeClaims("You are currently consuming 88 g of protein per day.", { proteinTargetG: 88, loggedIntake: false, lang: "en" });
  assert.doesNotMatch(r.answer, /currently consuming/);
  assert.match(r.answer, /target/i);
});

test("controls: a logged intake, advice, or a different number are never rewritten", () => {
  const logged = "Bạn hiện đang ăn khoảng 70g đạm/ngày theo nhật ký.";
  assert.equal(groundIntakeClaims(logged, { proteinTargetG: 88, loggedIntake: true, lang: "vi" }).answer, logged);
  const advice = "Bạn nên ăn khoảng 88g đạm mỗi ngày.";
  assert.equal(groundIntakeClaims(advice, { proteinTargetG: 88, loggedIntake: false, lang: "vi" }).answer, advice);
  const other = "Nếu bạn đang ăn 60g đạm thì cần tăng thêm.";
  assert.equal(groundIntakeClaims(other, { proteinTargetG: 88, loggedIntake: false, lang: "vi" }).answer, other);
});
