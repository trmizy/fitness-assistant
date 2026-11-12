import { test } from "node:test";
import assert from "node:assert/strict";
import { answerValidator, hasCriticalStructureMismatch, hasCriticalNutritionMismatch } from "../answer_validator";

// Independent review P2 (2026-11-12) / eval B4-45: a correct, on-topic pre-workout answer that simply did not repeat the user's
// weight/height was REPLACED by a generic template because "Personalization missing" counted as a critical mismatch.
// A missing personal echo is a quality hint, not a correctness error — it must not discard the model's answer.
// Same shape as bugfix.test.ts minimalRecommendation(), timing intent.
const rec: any = {
  objective: "maintenance",
  nutrition: { targetCalories: 2000, proteinGrams: 150, carbsGrams: 220, fatGrams: 65, formula: "test", confidence: "medium" },
  workout: { split: "full_body", sessionsPerWeek: 3, focus: [], avoidedPatterns: [], assumptions: [] },
  meal: { template: "balanced", dailyMeals: 3, assumptions: [] },
  followUpQuestions: [], assumptions: [], missingFields: [],
  responseIntent: "nutrient_timing_request",
};
const profile: any = { age: 26, gender: "FEMALE", heightCm: 158, currentWeightKg: 52, training: { availableEquipment: ["dumbbell"], injuries: [], preferredTrainingDays: [] } };
const CORRECT_TIMING_ANSWER = [
  "## Trước Tập",
  "Tập lúc 6 giờ sáng: ăn nhẹ 30–60 phút trước, ví dụ một quả chuối hoặc lát bánh mì với sữa chua.",
  "",
  "## Sau Tập",
  "Trong 1–2 giờ sau tập ăn đạm và tinh bột, ví dụ trứng với cơm hoặc yến mạch với sữa.",
].join("\n");

test("validator: a correct answer that only lacks a personal echo is NOT a critical mismatch (no destructive fallback)", () => {
  const r = answerValidator.validate(CORRECT_TIMING_ANSWER, rec, "vi", profile, { personalQuestion: true });
  assert.ok(r.warnings.some((w) => /Personalization missing/.test(w)), "the hint is still reported");
  assert.equal(hasCriticalStructureMismatch(r.warnings), false);
  assert.equal(hasCriticalNutritionMismatch(r.warnings), false);
});

// V1 stabilization (2026-11-12), Priority 4: ONE meal named in a timing answer ("bữa sáng sau tập") is not a full-day plan. The
// old check fired on any single "bữa sáng/trưa/tối", which is critical → the correct answer was replaced by a template.
test("validator: a timing answer naming the post-workout BREAKFAST is not a 'full multi-meal day plan'", () => {
  const answer = [
    "## Trước Tập",
    "Tập lúc 6 giờ sáng: ăn nhẹ 30–60 phút trước, ví dụ một quả chuối.",
    "",
    "## Sau Tập",
    "Bữa sáng sau tập nên có đạm và tinh bột, ví dụ trứng với bánh mì hoặc yến mạch với sữa.",
  ].join("\n");
  const r = answerValidator.validate(answer, rec, "vi", profile);
  assert.ok(!r.warnings.some((w) => /full multi-meal day plan/.test(w)), r.warnings.join(" | "));
  assert.equal(hasCriticalStructureMismatch(r.warnings), false);
});

test("validator: a real full-day plan in a timing answer is still flagged", () => {
  const answer = [
    "## Trước Tập", "Ăn chuối trước tập.", "", "## Sau Tập", "Ăn trứng sau tập.", "",
    "- Bữa sáng: yến mạch 80g", "- Bữa trưa: cơm 200g, ức gà 150g", "- Bữa tối: cá hồi 150g, khoai lang 200g",
  ].join("\n");
  const r = answerValidator.validate(answer, rec, "vi", profile);
  assert.ok(r.warnings.some((w) => /full multi-meal day plan/.test(w)));
  assert.equal(hasCriticalStructureMismatch(r.warnings), true);
});

test("validator: real structural failures stay critical", () => {
  assert.equal(hasCriticalStructureMismatch(["Language lock violation: answer is not Vietnamese"]), true);
  assert.equal(hasCriticalStructureMismatch(["Answer includes workout content for timing-only intent."]), true);
  assert.equal(hasCriticalStructureMismatch(["Personalization missing: user profile fields were provided but not reflected in answer."]), false);
});
