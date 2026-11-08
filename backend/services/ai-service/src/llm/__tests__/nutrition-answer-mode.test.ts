/**
 * Regression tests for the nutrition answer-quality fixes found by test/ai-quality-eval (2026-11-08, REAL HTTP/API,
 * Nova Pro): direct nutrition questions answered with the meal-plan template, unit-blind validator extraction
 * discarding correct answers, and template-instruction artefacts leaking into answers.
 * Run: npx tsx --test src/llm/__tests__/nutrition-answer-mode.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RecommendationResult } from "../types";
import { answerValidator, hasCriticalNutritionMismatch, hasCriticalStructureMismatch } from "../answer_validator";
import {
  nutritionAnswerMode, isDirectNutritionQuestion, formatDirectNutritionAnswer, stripTemplateArtifacts, nutritionTargetSource, isPersonalQuestion, directNutritionPromptLines, isPersonalDailyTargetQuestion, isCalculationExplanationQuestion, formatCalculationExplanation, parseWeightChangeGoal, formatWeightChangeAnswer, parseMealSplit, formatMealSplitAnswer, parseStatedKcalComparison, formatStatedKcalComparison, isFollowUpMacroQuestion, mealMacroTargets, singleMealPromptLines,
} from "../nutrition_answer_mode";

function rec(formula = "NutritionGoal (ACTIVE)"): RecommendationResult {
  return {
    objective: "fat_loss",
    responseIntent: "meal_plan_request",
    nutrition: { maintenanceCalories: 2788, targetCalories: 2370, proteinGrams: 145, carbsGrams: 299, fatGrams: 66, formula, confidence: "high" },
    workout: { split: "full_body", sessionsPerWeek: 3, focus: [], avoidedPatterns: [], assumptions: [] },
    meal: { template: "balanced", dailyMeals: 3, assumptions: [] },
    followUpQuestions: [], assumptions: [], missingFields: [],
  } as RecommendationResult;
}
const profile = { currentWeightKg: 85, heightCm: 175, gender: "MALE", training: { injuries: [], availableEquipment: [] } } as any;
const critical = (w: string[]) => hasCriticalNutritionMismatch(w) || hasCriticalStructureMismatch(w);

describe("nutritionAnswerMode", () => {
  for (const q of ["Một ngày tôi cần bao nhiêu calo?", "Tôi nên ăn bao nhiêu protein mỗi ngày?", "1 gram chất béo cung cấp bao nhiêu calo?",
    "Mức calo duy trì (TDEE) của tôi khoảng bao nhiêu?", "Tôi ăn chay, làm sao ăn đủ protein mỗi ngày?", "Macro mỗi ngày của tôi chia thế nào?"])
    it(`direct: ${q}`, () => assert.equal(nutritionAnswerMode(q), "direct"));
  for (const q of ["Tạo thực đơn cho tôi", "Hôm nay nên ăn gì để giảm mỡ?", "Lên thực đơn 4 bữa cho mình", "meal plan please"])
    it(`plan: ${q}`, () => assert.equal(nutritionAnswerMode(q), "plan"));
  it("'ăn gián đoạn' is not 'ăn gì' (word boundary on the folded text)", () =>
    assert.equal(nutritionAnswerMode("Nhịn ăn gián đoạn 16:8 có giảm mỡ tốt hơn ăn bình thường nếu cùng lượng calo không?"), "direct"));
  it("one meal vs a whole day", () => {
    assert.equal(nutritionAnswerMode("Tôi dị ứng hải sản, gợi ý giúp tôi một bữa trưa khoảng 600 kcal giàu protein."), "meal");
    assert.equal(nutritionAnswerMode("Bữa sáng nên ăn gì?"), "meal");
    assert.equal(nutritionAnswerMode("Tạo thực đơn 4 bữa cho mình"), "plan");
    assert.equal(nutritionAnswerMode("Gợi ý bữa trưa và bữa tối cho cả tuần"), "plan");
  });
  it("only applies to meal_plan_request", () => {
    assert.equal(isDirectNutritionQuestion("meal_plan_request", "Tôi cần bao nhiêu calo?"), true);
    assert.equal(isDirectNutritionQuestion("general_fitness_knowledge", "Tôi cần bao nhiêu calo?"), false);
  });
});

describe("answerValidator — unit-bound extraction (no false discard of correct answers)", () => {
  it("accepts a correct direct answer that also quotes maintenance, per-kg protein and per-food grams", () => {
    const answer = [
      "Mỗi ngày bạn nên ăn khoảng **2.370 kcal** (mục tiêu hiện tại của bạn); mức duy trì ước tính khoảng 2788 kcal.",
      "- Protein: 145g mỗi ngày (~1.7 g/kg).",
      "- Ví dụ: Gà nướng 150g (35g protein), trứng 2 quả (12g protein).",
      "- Đừng ăn dưới 1500 kcal/ngày; nếu cân đứng yên 2 tuần có thể giảm 100-150 kcal.",
    ].join("\n");
    const v = answerValidator.validate(answer, rec(), "vi", profile, { nutritionAnswerMode: "direct" });
    assert.equal(critical(v.warnings), false, JSON.stringify(v.warnings));
  });
  it("a direct answer is not required to contain meal-plan sections", () => {
    const v = answerValidator.validate("Bạn cần khoảng 2370 kcal mỗi ngày, protein 145 g.", rec(), "vi", profile, { nutritionAnswerMode: "direct" });
    assert.equal(v.warnings.some((w) => /Missing required section/.test(w)), false, JSON.stringify(v.warnings));
  });
  it("plan mode still requires the meal-plan sections", () => {
    const v = answerValidator.validate("Bạn cần khoảng 2370 kcal mỗi ngày, protein 145 g.", rec(), "vi", profile, { nutritionAnswerMode: "plan" });
    assert.equal(v.warnings.some((w) => /Missing required section/.test(w)), true);
  });
  it("still catches a wrong daily calorie target in a direct answer", () => {
    const v = answerValidator.validate("Mỗi ngày bạn cần khoảng 3200 kcal, protein 145g.", rec(), "vi", profile, { nutritionAnswerMode: "direct" });
    assert.equal(hasCriticalNutritionMismatch(v.warnings), true);
  });
  it("still catches a wrong daily protein target in a direct answer", () => {
    const v = answerValidator.validate("Mỗi ngày bạn cần 2370 kcal, protein: 60g.", rec(), "vi", profile, { nutritionAnswerMode: "direct" });
    assert.equal(hasCriticalNutritionMismatch(v.warnings), true);
  });
  it("a knowledge fact ('1g chất béo = 9 kcal') is not a calorie-target claim", () => {
    const v = answerValidator.validate("1 gram chất béo cung cấp 9 kcal, còn protein và carb là 4 kcal mỗi gram.", rec(), "vi", profile, { nutritionAnswerMode: "direct", personalQuestion: false });
    assert.equal(hasCriticalNutritionMismatch(v.warnings), false, JSON.stringify(v.warnings));
  });
  it("a comma list '145 g protein, 299 g carb, 66 g chất béo' attributes each number to its own macro", () => {
    const v = answerValidator.validate("Mỗi ngày bạn cần 2370 kcal, gồm 145 g protein, 299 g carb và 66 g chất béo.", rec(), "vi", profile, { nutritionAnswerMode: "direct" });
    assert.equal(hasCriticalNutritionMismatch(v.warnings), false, JSON.stringify(v.warnings));
  });
  it("'Protein: 145 g · Carb: 299 g · Béo: 66 g' on one line is read per macro", () => {
    const v = answerValidator.validate("Mục tiêu: Protein: **145 g** · Carb: **299 g** · Béo: **66 g** · 2370 kcal", rec(), "vi", profile, { nutritionAnswerMode: "direct" });
    assert.equal(hasCriticalNutritionMismatch(v.warnings), false, JSON.stringify(v.warnings));
  });
  it("a per-item figure ('1 quả trứng chứa khoảng 6 g protein') is not the daily target", () => {
    const v = answerValidator.validate("Bạn cần 145g protein mỗi ngày. Ví dụ 1 quả trứng chứa khoảng 6 g protein.", rec(), "vi", profile, { nutritionAnswerMode: "direct" });
    assert.equal(hasCriticalNutritionMismatch(v.warnings), false, JSON.stringify(v.warnings));
  });
  it("direct mode: a food-source list with per-food grams is not compared with the daily target", () => {
    const answer = ["Một số thực phẩm giàu protein dễ mua:", "- Ức gà: 100 g chứa khoảng 31 g protein", "- Trứng: 6 g protein mỗi quả", "- Đậu phụ: 8 g protein / 100 g"].join("\n");
    const v = answerValidator.validate(answer, rec(), "vi", profile, { nutritionAnswerMode: "direct" });
    assert.equal(critical(v.warnings), false, JSON.stringify(v.warnings));
  });
  it("meal mode: a 600 kcal lunch table is not compared with the 2370 kcal daily target", () => {
    const answer = ["## 🥗 Dinh Dưỡng Mục Tiêu", "| Calo | 600 kcal |", "| Đạm | 50g |", "## 🍽️ Gợi Ý Thực Đơn", "Bữa trưa: gà nướng 150g, cơm lứt 100g", "## 🔄 Cách Điều Chỉnh", "Theo dõi cân nặng hằng tuần."].join("\n");
    const meal = answerValidator.validate(answer, rec(), "vi", profile, { nutritionAnswerMode: "meal" });
    const plan = answerValidator.validate(answer, rec(), "vi", profile, { nutritionAnswerMode: "plan" });
    assert.equal(hasCriticalNutritionMismatch(meal.warnings), false, JSON.stringify(meal.warnings));
    assert.equal(hasCriticalNutritionMismatch(plan.warnings), true);
  });
  it("stating the user's own target counts as personalization", () => {
    const v = answerValidator.validate("Mục tiêu của bạn là 2370 kcal và 145 g protein mỗi ngày.", rec(), "vi", profile, { nutritionAnswerMode: "direct" });
    assert.equal(v.warnings.some((w) => /Personalization missing/.test(w)), false, JSON.stringify(v.warnings));
  });
});

describe("isPersonalQuestion", () => {
  it("personal vs impersonal", () => {
    assert.equal(isPersonalQuestion("Một ngày tôi cần bao nhiêu calo?"), true);
    assert.equal(isPersonalQuestion("Mình nên ăn bao nhiêu protein?"), true);
    assert.equal(isPersonalQuestion("1 gram chất béo cung cấp bao nhiêu calo?"), false);
  });
  it("personalization is required for a full plan, not for a direct answer (whose fallback cannot answer food-source questions)", () => {
    const direct = answerValidator.validate("Bạn nên ăn nhiều rau.", rec(), "vi", profile, { nutritionAnswerMode: "direct", personalQuestion: true });
    const plan = answerValidator.validate("Bạn nên ăn nhiều rau.", rec(), "vi", profile, { nutritionAnswerMode: "plan" });
    assert.equal(direct.warnings.some((w) => /Personalization missing/.test(w)), false);
    assert.equal(plan.warnings.some((w) => /Personalization missing/.test(w)), true);
  });
});

describe("formatDirectNutritionAnswer — labels and correctness", () => {
  it("states the PRESCRIBED target for a calorie question", () => {
    const a = formatDirectNutritionAnswer("Một ngày tôi cần bao nhiêu calo?", rec(), 85);
    assert.match(a, /2370 kcal/); assert.match(a, /mục tiêu dinh dưỡng đang áp dụng/);
    assert.equal(/Bữa sáng|Thực Đơn/.test(a), false);
  });
  it("labels an ESTIMATE as an estimate", () => {
    const r = rec("mifflin_st_jeor"); assert.equal(nutritionTargetSource(r), "ESTIMATED");
    assert.match(formatDirectNutritionAnswer("Tôi cần bao nhiêu protein?", r, 85), /ước tính/);
  });
  it("answers an energy-per-gram question with Atwater factors, not the user's targets", () => {
    const a = formatDirectNutritionAnswer("1 gram protein và 1 gram carb cung cấp bao nhiêu calo?", rec(), 85);
    assert.match(a, /1 g protein ≈ 4 kcal/); assert.match(a, /1 g chất béo ≈ 9 kcal/); assert.equal(/2370/.test(a), false);
  });
  it("answers a maintenance question with the maintenance estimate", () => {
    const a = formatDirectNutritionAnswer("Mức calo duy trì (TDEE) của tôi khoảng bao nhiêu?", rec(), 85);
    assert.match(a, /2788 kcal\/ngày/); assert.match(a, /ước tính/);
  });
  it("the deterministic direct answer passes the validator", () => {
    for (const q of ["Một ngày tôi cần bao nhiêu calo?", "Tôi nên ăn bao nhiêu protein?", "Macro của tôi chia thế nào?", "TDEE của tôi?"]) {
      const v = answerValidator.validate(formatDirectNutritionAnswer(q, rec(), 85), rec(), "vi", profile, { nutritionAnswerMode: "direct" });
      assert.equal(critical(v.warnings), false, `${q}: ${JSON.stringify(v.warnings)}`);
    }
  });
});

describe("detectNutritionLookupIntent — 'mỡ' is not 'mở'", () => {
  it("a fat-loss knowledge question is not a saved-meal lookup; an explicit lookup still is", async () => {
    const { detectNutritionLookupIntent } = await import("../nutrition_context");
    assert.equal(detectNutritionLookupIntent("Nhịn ăn gián đoạn 16:8 có giảm mỡ tốt hơn ăn bình thường nếu cùng lượng calo không?").enabled, false);
    assert.equal(detectNutritionLookupIntent("Mở thực đơn hôm nay của tôi").enabled, true);
    assert.equal(detectNutritionLookupIntent("Cho tôi xem thực đơn đã lưu hôm nay").enabled, true);
  });
});

describe("safetyGuard.minorAgeResult", () => {
  it("returns the minor-age guidance (parent + paediatrician) and the question detector still uses it", async () => {
    const { safetyGuard } = await import("../safety_guard");
    const r = safetyGuard.minorAgeResult();
    assert.equal(r.type, "minor_age_nutrition_request");
    assert.match((r as any).messageVi, /phụ huynh/); assert.match((r as any).messageVi, /bác sĩ nhi khoa/);
    assert.equal(safetyGuard.check("Tôi 15 tuổi, nên ăn bao nhiêu protein để tăng cơ?").type, "minor_age_nutrition_request");
  });
});

describe("labelLocalizer — engine assumption sentences in Vietnamese answers", () => {
  it("translates the three English assumption sentences before the single-word label pass", async () => {
    const { labelLocalizer } = await import("../label_localizer");
    const out = labelLocalizer.localize([
      "- Assumed 3 sessions per week due to missing training frequency.",
      "- No dietary preference provided; using a general mixed-food baseline template.",
      "- Nutrition targets are low-confidence because key profile metrics are missing.",
    ].join("\n"), "vi");
    assert.equal(/assumed|dietary|low-|confidence|độ tin cậy/i.test(out), false, out);
    assert.match(out, /Tạm tính 3 buổi tập\/tuần/);
  });
});

describe("stripTemplateArtifacts", () => {
  it("drops copied instruction lines and keeps content, links and numeric citations", () => {
    const out = stripTemplateArtifacts([
      "## [Một câu nhận xét cá nhân hóa về dinh dưỡng của họ]",
      "Với mục tiêu của bạn, protein rất quan trọng [1].",
      "[1–2 câu lý giải dựa trên mục tiêu của họ]",
      "[Chỉ thêm nếu hồ sơ thiếu] **Giả định:** cân nặng 70kg.",
      "Xem [hướng dẫn](https://example.org).",
    ].join("\n"));
    assert.equal(/\[Một câu|\[1–2 câu|\[Chỉ thêm/.test(out), false, out);
    assert.match(out, /protein rất quan trọng \[1\]/);
    assert.match(out, /\*\*Giả định:\*\* cân nặng 70kg/);
    assert.match(out, /\[hướng dẫn\]\(https:\/\/example\.org\)/);
  });
});

describe("what-if scenario vs saved goal (Opus judge findings WI-C1 / KN-08, 2026-11-08)", () => {
  const scenario = () => ({ ...rec("mifflin_st_jeor"), mealPlan: { whatIf: true } } as unknown as RecommendationResult);
  it("a what-if recommendation is a SCENARIO, never the prescription", () => {
    assert.equal(nutritionTargetSource(scenario()), "SCENARIO");
    assert.equal(nutritionTargetSource(rec()), "PRESCRIBED");
  });
  it("the direct prompt names the scenario AND the saved goal, which stays unchanged", () => {
    const lines = directNutritionPromptLines(scenario(), 70, { calories: 1852, protein: 112, carbs: 236, fat: 51 }).join("\n");
    assert.match(lines, /KỊCH BẢN GIẢ ĐỊNH/);
    assert.match(lines, /1852 kcal/);
    assert.match(lines, /GIỮ NGUYÊN/);
    assert.doesNotMatch(lines, /mục tiêu hiện tại của họ\)/);
  });
  it("the deterministic fallback labels a scenario as such", () =>
    assert.match(formatDirectNutritionAnswer("Nếu tôi tập nặng hơn để tăng cơ thì calo nên là bao nhiêu?", scenario(), 70), /kịch bản bạn hỏi — mục tiêu đã lưu của bạn vẫn giữ nguyên/));
  it("an impersonal knowledge question mentioning a goal is not personal (no what-if recompute)", () => {
    assert.equal(isPersonalQuestion("Nhịn ăn gián đoạn 16:8 có giảm mỡ tốt hơn ăn bình thường nếu cùng lượng calo không?"), false);
    assert.equal(isPersonalQuestion("Nếu tôi tập nặng hơn để tăng cơ thì lượng calo nên thay đổi thế nào so với hiện tại?"), true);
  });
});

describe("isPersonalDailyTargetQuestion (Opus judge PT-B3)", () => {
  for (const q of ["Chất béo mỗi ngày của mình nên là bao nhiêu gram?", "Mỗi ngày tôi nên ăn bao nhiêu chất béo?", "Một ngày mình cần bao nhiêu carb?"])
    it(`personal daily target: ${q}`, () => assert.equal(isPersonalDailyTargetQuestion(q), true));
  for (const q of ["Chất béo có hại không?", "1 gram chất béo cung cấp bao nhiêu calo?", "Người trưởng thành nên ăn bao nhiêu chất béo mỗi ngày?", "Tôi bị suy thận độ 3, có nên ăn 2g protein mỗi kg cân nặng không?"])
    it(`not a personal daily target: ${q}`, () => assert.equal(isPersonalDailyTargetQuestion(q), false));
});

describe("examiner-style questions (2026-11-08)", () => {
  it("'Tối nay ăn gì để giảm mỡ?' is one meal", () => assert.equal(nutritionAnswerMode("Tối nay ăn gì để giảm mỡ?"), "meal"));
  it("an English daily-target question is a personal daily target", () => assert.equal(isPersonalDailyTargetQuestion("What is my daily protein target?"), true));
  it("the calculation explanation shows the engine's BMR, factor, maintenance, deficit and the saved target", () => {
    assert.equal(isCalculationExplanationQuestion("Con số 2370 kcal của tôi được tính như thế nào?"), true);
    assert.equal(isCalculationExplanationQuestion("Một ngày tôi cần bao nhiêu calo?"), false);
    const a = formatCalculationExplanation({ age: 30, gender: "MALE", heightCm: 175, currentWeightKg: 85, activityLevel: "MODERATELY_ACTIVE" }, rec(),
      { bmr: 1799, formula: "mifflin_st_jeor", activityFactor: 1.55, maintenanceCalories: 2788 })!;
    assert.match(a, /BMR \(năng lượng cơ bản\) ≈ 1799 kcal/);
    assert.match(a, /1\.55/);
    assert.match(a, /2788 kcal/);
    assert.match(a, /Thâm hụt 418 kcal \(~15%\)/);
    assert.match(a, /\*\*2370 kcal\/ngày\*\*/);
  });
});

describe("deterministic nutrition arithmetic (expert human review 2026-11-08)", () => {
  const goalB = { calories: 1874, protein: 88, carbs: 264, fat: 52 };
  it("H10: 3 kg in 2 months = ~385 kcal/day deficit, from the engine's maintenance", () => {
    const g = parseWeightChangeGoal("Nếu tôi muốn giảm 3kg trong 2 tháng thì nên ăn thâm hụt bao nhiêu mỗi ngày?")!;
    assert.deepEqual(g, { direction: "lose", kg: 3, days: 60 });
    const a = formatWeightChangeAnswer(g, { maintenance: 1852, weightKg: 70, gender: "MALE" });
    assert.match(a, /385 kcal\/ngày/);
    assert.match(a, /1467 kcal\/ngày/);
    assert.doesNotMatch(a, /500\s*[–-]\s*700/);
  });
  it("a too-fast loss below the floor is flagged", () => {
    const a = formatWeightChangeAnswer({ direction: "lose", kg: 6, days: 30 }, { maintenance: 1800, weightKg: 60, gender: "FEMALE" });
    assert.match(a, /⚠️/);
  });
  it("EX-SAFE1: 20 kg in a month leads with 'không an toàn', a realistic timeline, and never a negative intake", () => {
    const g = parseWeightChangeGoal("Tôi muốn giảm 20kg trong 1 tháng, lên kế hoạch giúp tôi.")!;
    const a = formatWeightChangeAnswer(g, { maintenance: 2788, weightKg: 85, gender: "MALE", saved: { calories: 2370, protein: 145, carbs: 299, fat: 66 } });
    assert.match(a, /không an toàn và không thực tế/);
    assert.doesNotMatch(a, /-\d{3,4}\s*kcal/);
    assert.match(a, /24–48 tuần/);
    assert.match(a, /2288 kcal\/ngày/);
    assert.match(a, /bác sĩ|chuyên gia dinh dưỡng/);
  });
  it("H12: the per-meal split divides the SAVED goal", () => {
    assert.equal(parseMealSplit("Vậy chia ra mỗi bữa khoảng bao nhiêu nếu mình ăn 4 bữa?"), 4);
    assert.equal(parseMealSplit("Tạo thực đơn 4 bữa cho mình"), null);
    const a = formatMealSplitAnswer(4, goalB, "PRESCRIBED");
    assert.match(a, /\*\*1874 kcal\/ngày\*\*/);
    assert.match(a, /\*\*469 kcal\*\* · đạm \*\*22 g\*\*/);
    assert.doesNotMatch(a, /1400/);
  });
  it("H20: a stated intake is compared with the saved goal and the maintenance estimate", () => {
    const k = parseStatedKcalComparison("Nếu mình muốn ăn 2200 kcal thì có quá nhiều so với mục tiêu tăng cơ không?")!;
    assert.equal(k, 2200);
    const a = formatStatedKcalComparison(k, { saved: goalB, maintenance: 1673, goalType: "MUSCLE_GAIN" });
    assert.match(a, /cao hơn \*\*326 kcal\*\*/);
    assert.match(a, /thặng dư 527 kcal/);
    assert.match(a, /10–20%/);
    assert.equal(parseStatedKcalComparison("Nếu tôi muốn ăn 2000 kcal với 160g protein thì carb và fat bao nhiêu gram?"), null);
  });
  it("H22: 'Còn protein thì sao?' is a follow-up about the user's own target", () => {
    assert.equal(isFollowUpMacroQuestion("Còn protein thì sao?"), true);
    assert.equal(isFollowUpMacroQuestion("Tạo thực đơn cho tôi"), false);
  });
  it("H16: one-meal macros add up to the requested kcal (4/4/9)", () => {
    const m = mealMacroTargets(600, { calories: 2370, protein: 145, carbs: 299, fat: 66 }, true);
    assert.ok(Math.abs(m.protein * 4 + m.carbs * 4 + m.fat * 9 - 600) <= 15, JSON.stringify(m));
    assert.ok(m.protein * 4 >= 0.33 * 600);
    assert.match(singleMealPromptLines("Tôi dị ứng hải sản, gợi ý giúp tôi một bữa trưa khoảng 600 kcal giàu protein.", { calories: 2370, protein: 145, carbs: 299, fat: 66 }).join("\n"), /dùng ĐÚNG: 600 kcal · đạm 53 g/);
  });
});
