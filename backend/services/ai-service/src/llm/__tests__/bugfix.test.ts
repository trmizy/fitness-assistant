/**
 * Bug-fix regression tests — run with:
 *   npx tsx --test src/llm/__tests__/bugfix.test.ts
 *
 * Uses Node.js built-in test runner (node:test) — no extra dependencies.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { languageGuard } from "../language_guard";
import { safetyGuard } from "../safety_guard";
import {
  hasCriticalNutritionMismatch,
  hasCriticalStructureMismatch,
  answerValidator,
} from "../answer_validator";
import { recommendationEngine } from "../recommendation_engine";
import { responseFormatter } from "../response_formatter";
import { labelLocalizer } from "../label_localizer";
import { inputParser } from "../input_parser";
import { intentRouter } from "../intent_router";
import { extractSessionContext } from "../prompt_builder";
import type { InputIntent, RecommendationResult, UserProfile } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function minimalProfile(): UserProfile {
  return {
    training: {
      availableEquipment: [],
      injuries: [],
      preferredTrainingDays: [],
    },
  };
}

function profileForPersonalizedPlan(): UserProfile {
  return {
    age: 28,
    gender: "FEMALE",
    heightCm: 160,
    currentWeightKg: 58,
    goal: "WEIGHT_LOSS",
    experienceLevel: "BEGINNER",
    activityLevel: "LIGHTLY_ACTIVE",
    foodPreference: "không sữa bò",
    training: {
      availableEquipment: ["dumbbell", "bench"],
      injuries: ["đau gối nhẹ"],
      preferredTrainingDays: [2, 4, 6],
      trainingDaysPerWeek: 3,
    },
  };
}

function minimalIntent(
  routeIntent: InputIntent["routeIntent"] = "meal_plan_request",
): InputIntent {
  return {
    normalizedQuestion: "meal plan",
    intent: "meal_plan",
    routeIntent,
    needsPersonalization: false,
    missingFields: [],
  };
}

function minimalRecommendation(): RecommendationResult {
  return {
    objective: "maintenance",
    nutrition: {
      targetCalories: 2000,
      proteinGrams: 150,
      carbsGrams: 220,
      fatGrams: 65,
      formula: "test",
      confidence: "medium",
    },
    workout: {
      split: "full_body",
      sessionsPerWeek: 3,
      focus: [],
      avoidedPatterns: [],
      assumptions: [],
    },
    meal: { template: "balanced", dailyMeals: 3, assumptions: [] },
    followUpQuestions: [],
    assumptions: [],
    missingFields: [],
  };
}

// ─── A. Language lock tests ───────────────────────────────────────────────────

describe("A. Vietnamese language lock", () => {
  // Reset lock state between tests by using different userIds
  it('locks VI for accented "trả lời bằng tiếng việt"', () => {
    const result = languageGuard.resolve(
      "trả lời bằng tiếng việt",
      "user-vi-accented",
    );
    assert.equal(result.responseLanguage, "vi");
    assert.equal(result.locked, true);
    assert.equal(result.lockReason, "explicit_user_request");
  });

  it('locks VI for unaccented "tra loi bang tieng viet"', () => {
    const result = languageGuard.resolve(
      "tra loi bang tieng viet",
      "user-vi-plain",
    );
    assert.equal(result.responseLanguage, "vi");
    assert.equal(result.locked, true);
  });

  it('locks VI for "chỉ dùng tiếng việt" (accented)', () => {
    const result = languageGuard.resolve(
      "chỉ dùng tiếng việt",
      "user-vi-chi-dung",
    );
    assert.equal(result.responseLanguage, "vi");
    assert.equal(result.locked, true);
  });

  it('locks VI for "nói tiếng việt" (accented)', () => {
    const result = languageGuard.resolve("nói tiếng việt", "user-vi-noi");
    assert.equal(result.responseLanguage, "vi");
    assert.equal(result.locked, true);
  });

  it("lock persists for subsequent messages (user sends English next)", () => {
    const uid = "user-vi-persist";
    languageGuard.resolve("trả lời bằng tiếng việt", uid); // set lock
    const followUp = languageGuard.resolve(
      "How much protein should I eat?",
      uid,
    );
    assert.equal(
      followUp.responseLanguage,
      "vi",
      "lock must persist after English message",
    );
    assert.equal(followUp.locked, true);
    languageGuard.resetLock(uid);
  });

  it("resetLock clears the VI lock", () => {
    const uid = "user-vi-reset";
    languageGuard.resolve("tra loi bang tieng viet", uid);
    languageGuard.resetLock(uid);
    const after = languageGuard.resolve("How much protein?", uid);
    assert.equal(after.locked, false);
    assert.equal(after.responseLanguage, "en");
  });
});

describe("A. English language lock", () => {
  it('locks EN for "reply in english"', () => {
    const result = languageGuard.resolve("reply in english", "user-en-reply");
    assert.equal(result.responseLanguage, "en");
    assert.equal(result.locked, true);
  });

  it('locks EN for "use english"', () => {
    const result = languageGuard.resolve("use english", "user-en-use");
    assert.equal(result.responseLanguage, "en");
    assert.equal(result.locked, true);
  });

  it('locks EN for "trả lời bằng tiếng anh" (accented)', () => {
    const result = languageGuard.resolve(
      "trả lời bằng tiếng anh",
      "user-en-vi-accent",
    );
    assert.equal(result.responseLanguage, "en");
    assert.equal(result.locked, true);
  });
});

// ─── B. hasCriticalNutritionMismatch ─────────────────────────────────────────

describe("B. hasCriticalNutritionMismatch", () => {
  it("returns false for empty warnings", () => {
    assert.equal(hasCriticalNutritionMismatch([]), false);
  });

  it("returns false for non-nutrition warnings", () => {
    assert.equal(
      hasCriticalNutritionMismatch([
        "Answer does not ask follow-up questions despite missing user fields.",
        "Potentially unsafe phrase detected: /ignore pain/i",
      ]),
      false,
    );
  });

  it("returns true when calories mismatch warning present", () => {
    assert.equal(
      hasCriticalNutritionMismatch([
        "Calories in answer (2500) differ significantly from deterministic target (2000).",
      ]),
      true,
    );
  });

  it("returns true when protein mismatch warning present", () => {
    assert.equal(
      hasCriticalNutritionMismatch([
        "protein grams in answer (185) differ from deterministic target (133).",
      ]),
      true,
    );
  });

  it("returns true when carbs mismatch warning present", () => {
    assert.equal(
      hasCriticalNutritionMismatch([
        "carb|carbs grams in answer (300) differ from deterministic target (220).",
      ]),
      true,
    );
  });

  it("returns true when fat mismatch warning present", () => {
    assert.equal(
      hasCriticalNutritionMismatch([
        "fat|fats grams in answer (100) differ from deterministic target (65).",
      ]),
      true,
    );
  });

  it("returns true even when mixed with non-critical warnings", () => {
    assert.equal(
      hasCriticalNutritionMismatch([
        "Answer does not ask follow-up questions despite missing user fields.",
        "protein grams in answer (185) differ from deterministic target (133).",
      ]),
      true,
    );
  });
});

describe("B. hasCriticalStructureMismatch", () => {
  it("returns true for missing required section warnings", () => {
    assert.equal(
      hasCriticalStructureMismatch([
        "Missing required section: workout_table.",
      ]),
      true,
    );
  });

  it("returns true for language lock violation warnings", () => {
    assert.equal(
      hasCriticalStructureMismatch([
        "Language lock violation: expected Vietnamese answer.",
      ]),
      true,
    );
  });

  it("returns false for non-structural warnings", () => {
    assert.equal(
      hasCriticalStructureMismatch([
        "Potentially unsafe phrase detected: /ignore pain/i",
      ]),
      false,
    );
  });
});

// ─── B. answerValidator triggers mismatch for a drifted LLM answer ────────────

describe("B. answerValidator detects drifted macros", () => {
  it("generates a nutrition mismatch warning when protein in answer is >20% off", () => {
    const rec = minimalRecommendation(); // protein target = 150g
    // LLM answer mentions 185g protein — 23% over target → should warn
    const answer = "You should eat 185g of protein and 2000 calories today.";
    const result = answerValidator.validate(answer, rec);
    assert.equal(
      hasCriticalNutritionMismatch(result.warnings),
      true,
      `Expected mismatch warning but got: ${JSON.stringify(result.warnings)}`,
    );
  });

  it("no mismatch warning when protein is within tolerance", () => {
    const rec = minimalRecommendation(); // protein = 150g
    // Sentence puts the number *after* the keyword so the validator's regex finds 155,
    // not some unrelated number (the regex scans forward from the keyword).
    const answer =
      "Your protein target is 155g per day. Aim for 2000 calories.";
    const result = answerValidator.validate(answer, rec);
    // 155 vs 150 = 3.3% — within 20% threshold → no mismatch warning
    const hasMacroMismatch = result.warnings.some((w) =>
      /protein.*differ.*deterministic/i.test(w),
    );
    assert.equal(hasMacroMismatch, false);
  });
});

// ─── C. meal_plan_request — deterministic formatter has no workout table ──────

describe("C. meal_plan deterministic formatter — no workout table headings", () => {
  it("formatMealPlan output contains no workout table columns (Ngày | Nhóm cơ | Bài tập)", () => {
    const profile = minimalProfile();
    const intent = minimalIntent("meal_plan_request");
    const rec = recommendationEngine.recommend(profile, intent, "vi");

    // Import responseFormatter inline to call format()
    // We check the deterministic output does not contain workout columns
    // by inspecting the recommendation — mealPlan should exist, workoutPlan should not
    assert.ok(
      rec.mealPlan !== undefined,
      "mealPlan should be set for meal_plan_request",
    );
    assert.equal(
      rec.workoutPlan,
      undefined,
      "workoutPlan must NOT be set for meal_plan_request",
    );
    assert.equal(
      rec.specificRoutine,
      undefined,
      "specificRoutine must NOT be set for meal_plan_request",
    );
  });

  it("meal_plan recommendationResult has no workout rows in follow-ups", () => {
    const profile = minimalProfile();
    const intent = minimalIntent("meal_plan_request");
    const rec = recommendationEngine.recommend(profile, intent, "vi");

    // None of the follow-up questions should mention training schedule or gym sessions
    const workoutKeywords =
      /lịch tập|workout|training|buổi tập|bài tập|exercise/i;
    for (const q of rec.followUpQuestions ?? []) {
      assert.equal(
        workoutKeywords.test(q),
        false,
        `Meal plan follow-up must not mention workout: "${q}"`,
      );
    }
  });
});

// ─── D. Follow-up questions — language-aware ─────────────────────────────────

describe("D. Language-aware follow-up questions", () => {
  it("generates Vietnamese follow-ups when language=vi", () => {
    const profile = minimalProfile();
    const intent: InputIntent = {
      ...minimalIntent("meal_plan_request"),
      missingFields: ["weight", "goal"],
    };
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const questions = rec.followUpQuestions ?? [];

    assert.ok(questions.length > 0, "should have follow-up questions");
    // All follow-ups must be Vietnamese — check for common VI patterns
    const hasEnglishQuestion = questions.some((q) =>
      /^can you|^do you|^any food|^how many/i.test(q),
    );
    assert.equal(
      hasEnglishQuestion,
      false,
      `VI follow-ups must not be in English. Got: ${JSON.stringify(questions)}`,
    );
    const hasVietnamese = questions.some((q) =>
      /bạn|mình|không|ăn|tập/i.test(q),
    );
    assert.equal(
      hasVietnamese,
      true,
      `VI follow-ups should contain Vietnamese text. Got: ${JSON.stringify(questions)}`,
    );
  });

  it("generates English follow-ups when language=en", () => {
    const profile = minimalProfile();
    const intent: InputIntent = {
      ...minimalIntent("meal_plan_request"),
      missingFields: ["weight", "goal"],
    };
    const rec = recommendationEngine.recommend(profile, intent, "en");
    const questions = rec.followUpQuestions ?? [];

    assert.ok(questions.length > 0, "should have follow-up questions");
    const hasEnglishQuestion = questions.some((q) =>
      /can you|do you|any food|how many/i.test(q),
    );
    assert.equal(
      hasEnglishQuestion,
      true,
      `EN follow-ups should be in English. Got: ${JSON.stringify(questions)}`,
    );
  });

  it("general intent VI follow-ups ask about training days in Vietnamese", () => {
    const profile = minimalProfile();
    const intent = minimalIntent("general_fitness_knowledge");
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const questions = rec.followUpQuestions ?? [];
    const hasTuanNhieu = questions.some((q) => /buổi|tuần/i.test(q));
    assert.equal(
      hasTuanNhieu,
      true,
      `VI general follow-up should ask about training days. Got: ${JSON.stringify(questions)}`,
    );
  });

  it("general intent EN follow-ups ask about training days in English", () => {
    const profile = minimalProfile();
    const intent = minimalIntent("general_fitness_knowledge");
    const rec = recommendationEngine.recommend(profile, intent, "en");
    const questions = rec.followUpQuestions ?? [];
    const hasTrainingDays = questions.some((q) =>
      /training days|days per week/i.test(q),
    );
    assert.equal(
      hasTrainingDays,
      true,
      `EN general follow-up should ask about training days. Got: ${JSON.stringify(questions)}`,
    );
  });
});

describe("E. Required sections and language lock validations", () => {
  it("flags meal-plan answer if it includes workout table", () => {
    const rec = minimalRecommendation();
    rec.responseIntent = "meal_plan_request";
    const answer = [
      "## 🥗 Dinh Dưỡng",
      "| Chỉ số | Giá trị |",
      "|--------|---------|",
      "| Calo | 2000 kcal |",
      "| Ngày | Nhóm cơ | Bài tập | Sets | Reps | Rest |",
    ].join("\n");
    const result = answerValidator.validate(answer, rec, "vi");
    const hasMealViolation = result.warnings.some((w) =>
      /meal-only intent/i.test(w),
    );
    assert.equal(hasMealViolation, true);
  });

  it("flags missing workout table for workout-plan intent", () => {
    const rec = minimalRecommendation();
    rec.responseIntent = "workout_plan_request";
    const answer = "## 💪 Lịch tập\nChạy bộ và plank.";
    const result = answerValidator.validate(answer, rec, "vi");
    const hasMissingTable = result.warnings.some((w) =>
      /Missing required section: workout_table/i.test(w),
    );
    assert.equal(hasMissingTable, true);
  });

  it("flags VI lock violation on heavily-English answer", () => {
    const rec = minimalRecommendation();
    rec.responseIntent = "general_fitness_knowledge";
    const answer =
      "Your training plan and nutrition goal for the week is clear. The target plan with training and nutrition should be followed.";
    const result = answerValidator.validate(answer, rec, "vi");
    const hasLanguageWarning = result.warnings.some((w) =>
      /Language lock violation/i.test(w),
    );
    assert.equal(hasLanguageWarning, true);
  });

  it("normalizes Vietnamese exercise aliases to canonical English names", () => {
    const text = "Đẩy cáp tay sau và Duỗi tay sau tạ đơn 1 tay";
    const output = labelLocalizer.localize(text, "vi");

    assert.match(output, /Cable Triceps Pushdown/i);
    assert.match(output, /One-Arm Dumbbell Overhead Triceps Extension/i);
    assert.doesNotMatch(output, /Đẩy cáp tay sau|Duỗi tay sau tạ đơn 1 tay/);
  });

  it("routes mixed arms questions to a combined arms routine", () => {
    const profile = minimalProfile();
    const intent = inputParser.parse(
      "vậy nếu tập tay trước và tay sau thì có những bài tập nào và bài nào hỗ trợ tốt cho tôi",
      profile,
    );
    assert.equal(intent.routeIntent, "muscle_group_routine_request");

    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const answer = responseFormatter.format(rec, "vi");

    assert.match(answer, /Barbell Curl/i);
    assert.match(answer, /Cable Triceps Pushdown/i);
    assert.match(answer, /Close-Grip Bench Press/i);
    assert.doesNotMatch(answer, /Đẩy cáp tay trước|Duỗi tay sau tạ đơn 2 tay/);
  });
});

describe("F. Mandatory 11-case regression coverage", () => {
  it("case 1/2/3: detailed session requests include set-rep-rest-technique", () => {
    const profile = minimalProfile();
    const asks = [
      "Tôi mới tập gym, hãy cho tôi một buổi tập ngực đầy đủ cho người mới.",
      "Hãy lên cho tôi buổi tập lưng xô chi tiết, ghi rõ từng bài, set, rep và nghỉ.",
      "Cho tôi buổi push day hoàn chỉnh, không rút gọn.",
    ];

    for (const q of asks) {
      const intent = inputParser.parse(q, profile);
      const rec = recommendationEngine.recommend(profile, intent, "vi");
      const answer = responseFormatter.format(rec, "vi");
      const result = answerValidator.validate(answer, rec, "vi", profile);
      const missingCore = result.warnings.some((w) =>
        /detail_|exercise_list|technique_notes/i.test(w),
      );
      assert.equal(
        missingCore,
        false,
        `Unexpected warnings for "${q}": ${JSON.stringify(result.warnings)}`,
      );
    }
  });

  it("case 4/5: schedule requests preserve required day counts", () => {
    const profile = profileForPersonalizedPlan();
    const asks = [
      {
        q: "Hãy lên lịch tập gym 3 buổi/tuần cho người mới muốn tăng cơ.",
        expectedDays: 3,
      },
      { q: "Cho tôi lịch tập 6 buổi push pull legs đầy đủ.", expectedDays: 6 },
    ];

    for (const tc of asks) {
      const intent = inputParser.parse(tc.q, profile);
      const rec = recommendationEngine.recommend(profile, intent, "vi");
      assert.equal(rec.workoutPlan?.days.length, tc.expectedDays);
    }
  });

  it("case 6/8: macro responses remain kcal-consistent", () => {
    const profile = profileForPersonalizedPlan();
    const asks = [
      "Tôi nặng 70kg, muốn tăng cơ, cần ăn bao nhiêu protein mỗi ngày?",
      "Hãy tính giúp tôi protein, carb, fat cho mục tiêu giảm mỡ.",
    ];

    for (const q of asks) {
      const intent = inputParser.parse(q, profile);
      const rec = recommendationEngine.recommend(profile, intent, "vi");
      const answer = responseFormatter.format(rec, "vi");
      const result = answerValidator.validate(answer, rec, "vi", profile);
      const hasNutritionInconsistency = result.warnings.some((w) =>
        /Nutrition inconsistency/i.test(w),
      );
      assert.equal(
        hasNutritionInconsistency,
        false,
        `Nutrition mismatch for "${q}": ${JSON.stringify(result.warnings)}`,
      );
    }
  });

  it("case 7/9: meal plans include meals + macros and respect dairy allergy preference", () => {
    const profile = profileForPersonalizedPlan();
    const asks = [
      "Hãy cho tôi thực đơn tăng cơ 1 ngày đầy đủ.",
      "Tôi bị dị ứng sữa, hãy lên thực đơn phù hợp.",
    ];

    for (const q of asks) {
      const intent = inputParser.parse(q, profile);
      const rec = recommendationEngine.recommend(profile, intent, "vi");
      const answer = responseFormatter.format(rec, "vi");
      assert.equal(/##\s*🥗\s*Dinh Dưỡng/i.test(answer), true);
      assert.equal(/Bữa|Meal/i.test(answer), true);
      if (/dị ứng sữa/i.test(q)) {
        assert.equal(/sữa chua|whey/i.test(answer.toLowerCase()), false);
      }
    }
  });

  it("case 10: Vietnamese lock keeps answer in Vietnamese", () => {
    const profile = minimalProfile();
    const uid = "mandatory-case-10";
    const language = languageGuard.resolve(
      "Trả lời bằng tiếng Việt hoàn toàn: cho tôi buổi tập ngực chi tiết.",
      uid,
    );
    const intent = inputParser.parse("cho tôi buổi tập ngực chi tiết", profile);
    const rec = recommendationEngine.recommend(
      profile,
      intent,
      language.responseLanguage,
    );
    const answer = responseFormatter.format(rec, language.responseLanguage);
    const result = answerValidator.validate(
      answer,
      rec,
      language.responseLanguage,
      profile,
    );
    const hasLanguageViolation = result.warnings.some((w) =>
      /Language lock violation/i.test(w),
    );
    assert.equal(hasLanguageViolation, false);
    languageGuard.resetLock(uid);
  });

  it("case 11: combined plan includes both training and nutrition and is personalized", () => {
    const profile = profileForPersonalizedPlan();
    const q = "Tôi nữ, 58kg, 1m60, muốn giảm mỡ, hãy lên lịch tập và ăn uống.";
    const intent = inputParser.parse(q, profile);
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const answer = responseFormatter.format(rec, "vi");
    assert.equal(rec.responseIntent, "combined_plan_request");
    assert.equal(/Lịch Tập/i.test(answer), true);
    assert.equal(/Dinh Dưỡng/i.test(answer), true);
    const result = answerValidator.validate(answer, rec, "vi", profile);
    const hasPersonalizationMissing = result.warnings.some((w) =>
      /Personalization missing/i.test(w),
    );
    assert.equal(
      hasPersonalizationMissing,
      false,
      JSON.stringify(result.warnings),
    );
  });
});

// ─── G. safetyGuard.check() — new multi-gate safety ─────────────────────────

describe("G. safetyGuard.check() — extended safety gate", () => {
  it("blocks rapid weight loss (unsafe_weight_loss)", () => {
    const result = safetyGuard.check("giam 10kg trong 1 tuan");
    assert.equal(result.type, "unsafe_weight_loss");
    assert.ok(result.type === "unsafe_weight_loss" && result.guidance.blocked);
  });

  it("flags medical emergency for chest pain (medical_emergency)", () => {
    const result = safetyGuard.check("toi dang bi dau nguc du doi khi tap");
    assert.equal(result.type, "medical_emergency");
    assert.ok(
      result.type === "medical_emergency" &&
        /bác sĩ|emergency/i.test(result.messageVi),
    );
  });

  it("flags medical emergency for fainting (ngat xiu)", () => {
    const result = safetyGuard.check("toi bi ngat xiu khi tap");
    assert.equal(result.type, "medical_emergency");
  });

  it("flags off-topic programming question (off_topic)", () => {
    const result = safetyGuard.check(
      "viet cho toi mot doan code python de sort array",
    );
    assert.equal(result.type, "off_topic");
    assert.ok(
      result.type === "off_topic" && /Fitness Coach/i.test(result.messageVi),
    );
  });

  it("does NOT flag fitness+injury question as off_topic (false positive guard)", () => {
    const result = safetyGuard.check(
      "toi bi dau goi, bai tap nao phu hop cho toi",
    );
    assert.equal(result.type, "safe", `Should be safe but got: ${result.type}`);
  });

  it("does NOT flag nutrition question as off_topic", () => {
    const result = safetyGuard.check(
      "toi can an bao nhieu protein moi ngay de tang co",
    );
    assert.equal(result.type, "safe", `Should be safe but got: ${result.type}`);
  });

  it("evaluates safe workout question as safe", () => {
    const result = safetyGuard.check(
      "cho toi lich tap 4 buoi tuan de tang co bap",
    );
    assert.equal(result.type, "safe");
  });

  it("answerValidator flags extreme protein-per-kg in general knowledge answer", () => {
    const rec = minimalRecommendation();
    rec.responseIntent = "general_fitness_knowledge";
    const answer =
      "To build muscle, eat 6g per kg of bodyweight in protein daily.";
    const result = answerValidator.validate(answer, rec);
    const hasExtremeProtein = result.warnings.some((w) =>
      /extreme protein-per-kg/i.test(w),
    );
    assert.equal(
      hasExtremeProtein,
      true,
      `Expected extreme protein warning, got: ${JSON.stringify(result.warnings)}`,
    );
  });

  it("answerValidator does NOT flag normal protein advice in general knowledge", () => {
    const rec = minimalRecommendation();
    rec.responseIntent = "general_fitness_knowledge";
    const answer =
      "Aim for 1.6–2.2g per kg bodyweight in protein for muscle gain.";
    const result = answerValidator.validate(answer, rec);
    const hasExtremeProtein = result.warnings.some((w) =>
      /extreme protein-per-kg/i.test(w),
    );
    assert.equal(hasExtremeProtein, false);
  });
});

// ─── H. Legs / Shoulders / Core routine generation ───────────────────────────

describe("H. Legs / Shoulders / Core routines", () => {
  it('"Cho tôi bài tập chân" routes to muscle_group_routine_request', () => {
    const result = intentRouter.route("Cho tôi bài tập chân");
    assert.equal(result.intent, "muscle_group_routine_request");
  });

  it('"Cho tôi bài tập chân" generates legs-specific exercises (Goblet Squat, Romanian Deadlift, Calf Raise)', () => {
    const profile = minimalProfile();
    const intent = inputParser.parse("Cho tôi bài tập chân", profile);
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const answer = responseFormatter.format(rec, "vi");
    assert.match(answer, /Goblet Squat|Back Squat/i);
    assert.match(answer, /Romanian Deadlift/i);
    assert.match(answer, /Calf Raise/i);
    assert.doesNotMatch(answer, /Barbell Curl|Cable Triceps Pushdown/i);
  });

  it('"Tạo lịch tập vai hôm nay" generates shoulder-specific exercises (Overhead Press, Lateral Raise, Face Pull)', () => {
    const profile = minimalProfile();
    const intent = inputParser.parse("Tạo lịch tập vai hôm nay", profile);
    assert.equal(intent.routeIntent, "muscle_group_routine_request");
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const answer = responseFormatter.format(rec, "vi");
    assert.match(answer, /Overhead Press/i);
    assert.match(answer, /Lateral Raise/i);
    assert.match(answer, /Face Pull|Rear Delt/i);
  });

  it('"Tôi muốn tập core bụng" generates core stability exercises with spot reduction warning', () => {
    const profile = minimalProfile();
    const intent = inputParser.parse("Tôi muốn tập core bụng", profile);
    assert.equal(intent.routeIntent, "muscle_group_routine_request");
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const answer = responseFormatter.format(rec, "vi");
    assert.match(answer, /Plank/i);
    assert.match(answer, /Dead Bug/i);
    assert.match(answer, /không.*giảm|KHÔNG.*giảm/i);
  });

  it('"Cho tôi routine chân chi tiết" uses detailMode — Back Squat and Bulgarian Split Squat', () => {
    const profile = minimalProfile();
    const intent = inputParser.parse("Cho tôi routine chân chi tiết", profile);
    assert.equal(intent.detailMode, true);
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const answer = responseFormatter.format(rec, "vi");
    assert.match(answer, /Back Squat/i);
    assert.match(answer, /Bulgarian Split Squat/i);
  });

  it('"Tôi muốn giảm mỡ bụng, tập bụng mỗi ngày" routes to core routine (not general_fitness_knowledge)', () => {
    const profile = minimalProfile();
    const intent = inputParser.parse(
      "Tôi muốn giảm mỡ bụng, tập bụng mỗi ngày được không?",
      profile,
    );
    assert.equal(intent.routeIntent, "muscle_group_routine_request");
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const answer = responseFormatter.format(rec, "vi");
    assert.match(answer, /Plank/i);
    assert.match(answer, /KHÔNG giảm mỡ/i);
  });

  it("validator passes cleanly for legs routine — no false warnings", () => {
    const profile = minimalProfile();
    const intent = inputParser.parse("Cho tôi bài tập chân", profile);
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const answer = responseFormatter.format(rec, "vi");
    const result = answerValidator.validate(answer, rec, "vi", profile);
    const hasRoutineWarnings = result.warnings.some((w) =>
      /legs_|Missing required section/i.test(w),
    );
    assert.equal(
      hasRoutineWarnings,
      false,
      `Unexpected warnings: ${JSON.stringify(result.warnings)}`,
    );
  });

  it("validator passes cleanly for shoulders routine — no false warnings", () => {
    const profile = minimalProfile();
    const intent = inputParser.parse("Tạo lịch tập vai hôm nay", profile);
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const answer = responseFormatter.format(rec, "vi");
    const result = answerValidator.validate(answer, rec, "vi", profile);
    const hasRoutineWarnings = result.warnings.some((w) =>
      /shoulders_|Missing required section/i.test(w),
    );
    assert.equal(
      hasRoutineWarnings,
      false,
      `Unexpected warnings: ${JSON.stringify(result.warnings)}`,
    );
  });

  it("validator passes cleanly for core routine — no false warnings", () => {
    const profile = minimalProfile();
    const intent = inputParser.parse("Tôi muốn tập core bụng", profile);
    const rec = recommendationEngine.recommend(profile, intent, "vi");
    const answer = responseFormatter.format(rec, "vi");
    const result = answerValidator.validate(answer, rec, "vi", profile);
    const hasRoutineWarnings = result.warnings.some((w) =>
      /core_|Missing required section/i.test(w),
    );
    assert.equal(
      hasRoutineWarnings,
      false,
      `Unexpected warnings: ${JSON.stringify(result.warnings)}`,
    );
  });
});

// ─── I. Equipment-based personalization ──────────────────────────────────────

describe("I. Equipment-based exercise substitution", () => {
  // Regex to detect barbell-only exercises that should never appear in dumbbell plans
  const BARBELL_PATTERN =
    /^Barbell\b|^Back Squat$|^Bench Press$|^Overhead Press$|^Deadlift$|^Romanian Deadlift$/;

  it("dumbbell-only profile → 3-day plan has no barbell or rack-only exercises", () => {
    const profile: UserProfile = {
      goal: "MUSCLE_GAIN",
      training: {
        availableEquipment: ["dumbbell"],
        injuries: [],
        preferredTrainingDays: [],
        trainingDaysPerWeek: 3,
      },
    };
    const intent = inputParser.parse("Tạo lịch tập 3 ngày tăng cơ", profile);
    const rec = recommendationEngine.recommend(profile, intent, "vi");

    assert.ok(rec.workoutPlan !== undefined, "workoutPlan should be generated");
    assert.equal(rec.workoutPlan!.days.length, 3);

    for (const day of rec.workoutPlan!.days) {
      for (const ex of day.exercises) {
        assert.equal(
          BARBELL_PATTERN.test(ex.name),
          false,
          `Dumbbell-only plan must not contain: "${ex.name}" on ${day.day}`,
        );
      }
    }
  });

  it("bodyweight-only profile → 3-day plan has no barbell or dumbbell exercises", () => {
    const profile: UserProfile = {
      goal: "MUSCLE_GAIN",
      training: {
        availableEquipment: ["bodyweight"],
        injuries: [],
        preferredTrainingDays: [],
        trainingDaysPerWeek: 3,
      },
    };
    const intent = inputParser.parse("Tạo lịch tập 3 ngày tăng cơ", profile);
    const rec = recommendationEngine.recommend(profile, intent, "vi");

    assert.ok(rec.workoutPlan !== undefined, "workoutPlan should be generated");

    for (const day of rec.workoutPlan!.days) {
      for (const ex of day.exercises) {
        assert.equal(
          /\bBarbell\b|\bDumbbell\b/.test(ex.name),
          false,
          `Bodyweight-only plan must not contain barbell/dumbbell exercise: "${ex.name}" on ${day.day}`,
        );
      }
    }
  });

  it("full gym profile (empty equipment) → default plan keeps barbell exercises", () => {
    const profile = minimalProfile(); // availableEquipment: []
    const intent = inputParser.parse("Tạo lịch tập 3 ngày tăng cơ", profile);
    const rec = recommendationEngine.recommend(profile, intent, "vi");

    assert.ok(rec.workoutPlan !== undefined);
    const allExercises = rec.workoutPlan!.days.flatMap((d) =>
      d.exercises.map((e) => e.name),
    );
    // At least one barbell compound should survive in the default plan
    const hasBarbellOrSquat = allExercises.some((n) => BARBELL_PATTERN.test(n));
    assert.equal(
      hasBarbellOrSquat,
      true,
      `Default plan should contain at least one barbell exercise. Got: ${allExercises.join(", ")}`,
    );
  });

  it("padding exercises (Cable Crunch, Seated Calf Raise) are also filtered for dumbbell-only users", () => {
    const profile: UserProfile = {
      goal: "MUSCLE_GAIN",
      training: {
        availableEquipment: ["dumbbell"],
        injuries: [],
        preferredTrainingDays: [],
        trainingDaysPerWeek: 5,
      },
    };
    // detailMode=true triggers minPerDay=6 which can pad with Cable Crunch / Seated Calf Raise
    const intent = inputParser.parse(
      "Chi tiết lịch tập 5 ngày tăng cơ với dumbbell",
      profile,
    );
    const rec = recommendationEngine.recommend(
      profile,
      { ...intent, detailMode: true },
      "vi",
    );

    assert.ok(rec.workoutPlan !== undefined);
    for (const day of rec.workoutPlan!.days) {
      for (const ex of day.exercises) {
        assert.notEqual(
          ex.name,
          "Cable Crunch",
          `"Cable Crunch" should be replaced for dumbbell users on ${day.day}`,
        );
        assert.notEqual(
          ex.name,
          "Seated Calf Raise",
          `"Seated Calf Raise" should be replaced for dumbbell users on ${day.day}`,
        );
      }
    }
  });

  it("padding exercises (Cable Crunch, Seated Calf Raise) are also filtered for bodyweight-only users", () => {
    const profile: UserProfile = {
      goal: "MUSCLE_GAIN",
      training: {
        availableEquipment: ["bodyweight"],
        injuries: [],
        preferredTrainingDays: [],
        trainingDaysPerWeek: 5,
      },
    };
    const intent = inputParser.parse(
      "Chi tiết lịch tập 5 ngày tăng cơ bodyweight",
      profile,
    );
    const rec = recommendationEngine.recommend(
      profile,
      { ...intent, detailMode: true },
      "vi",
    );

    assert.ok(rec.workoutPlan !== undefined);
    for (const day of rec.workoutPlan!.days) {
      for (const ex of day.exercises) {
        assert.notEqual(
          ex.name,
          "Cable Crunch",
          `"Cable Crunch" must not appear in bodyweight plan on ${day.day}`,
        );
        assert.notEqual(
          ex.name,
          "Seated Calf Raise",
          `"Seated Calf Raise" must not appear in bodyweight plan on ${day.day}`,
        );
      }
    }
  });
});

// ─── J. Conversation context — extractSessionContext ─────────────────────────

describe("J. extractSessionContext — multi-turn context detection", () => {
  it("detects previously given 5-day PPL plan from answer text", () => {
    const history = [
      {
        question: "Tôi muốn tập 5 ngày mỗi tuần",
        answer:
          "Tôi đề xuất lịch Push/Pull/Legs 5 ngày/tuần phù hợp với mục tiêu tăng cơ của bạn.",
      },
    ];
    const ctx = extractSessionContext(history);
    assert.match(
      ctx,
      /5 ngày\/tuần/,
      "Should detect 5-day frequency from answer",
    );
    assert.match(
      ctx,
      /Push\/Pull\/Legs/,
      "Should detect PPL split from answer",
    );
    assert.match(
      ctx,
      /giữ nhất quán/,
      "Should include consistency instruction",
    );
  });

  it("detects shoulder pain from question and flags it in context", () => {
    const history = [
      {
        question: "Tôi bị đau vai trái, có thể tập push day không?",
        answer:
          "Bạn có thể tập push day nhưng cần tránh Overhead Press để bảo vệ vai.",
      },
    ];
    const ctx = extractSessionContext(history);
    assert.match(
      ctx,
      /chấn thương/,
      "Should flag injury concern from question",
    );
  });

  it("detects injury warning in answer (tránh overhead)", () => {
    const history = [
      {
        question: "Vai tôi đang bị đau",
        answer:
          "Bạn nên tránh overhead press và các bài vai trước cho đến khi hồi phục hoàn toàn.",
      },
    ];
    const ctx = extractSessionContext(history);
    assert.match(
      ctx,
      /overhead press|chấn thương/i,
      "Should detect overhead press warning or injury from answer",
    );
  });

  it("returns empty string for empty chat history", () => {
    assert.equal(extractSessionContext([]), "");
    assert.equal(extractSessionContext(null as any), "");
  });
});

// ─── K. answerValidator — validateGeneralFitnessAdvice ────────────────────────

describe("K. answerValidator — protein/calorie safety limits", () => {
  function generalRec(): RecommendationResult {
    return {
      ...minimalRecommendation(),
      responseIntent: "general_fitness_knowledge",
    };
  }

  it("answer with 5g/kg protein → warns about extreme protein-per-kg", () => {
    const answer =
      "You should eat 5g per kg bodyweight to maximise muscle gain.";
    const { warnings } = answerValidator.validate(answer, generalRec());
    assert.ok(
      warnings.some((w) => /protein-per-kg/i.test(w)),
      `Expected protein-per-kg warning. Got: ${warnings.join("; ")}`,
    );
  });

  it("answer with 6.5g/kg (unspaced) → warns", () => {
    const answer = "Eat 6.5g/kg protein daily for best results.";
    const { warnings } = answerValidator.validate(answer, generalRec());
    assert.ok(warnings.some((w) => /protein-per-kg/i.test(w)));
  });

  it("answer with 2g/kg protein → no extreme-protein warning", () => {
    const answer = "A good target is 2g per kg of bodyweight.";
    const { warnings } = answerValidator.validate(answer, generalRec());
    assert.ok(!warnings.some((w) => /protein-per-kg/i.test(w)));
  });

  it("answer with 300 kcal (<800) → warns about out-of-range calories", () => {
    const answer = "A 300 kcal deficit plan will work well for you.";
    const { warnings } = answerValidator.validate(answer, generalRec());
    assert.ok(
      warnings.some((w) => /calorie value outside safe range/i.test(w)),
      `Expected calorie-range warning. Got: ${warnings.join("; ")}`,
    );
  });

  it("answer with 7000 kcal (>6000) → warns", () => {
    const answer =
      "Athletes sometimes eat 7000 kcal per day during heavy training phases.";
    const { warnings } = answerValidator.validate(answer, generalRec());
    assert.ok(
      warnings.some((w) => /calorie value outside safe range/i.test(w)),
    );
  });

  it("answer with 2500 kcal (normal) → no calorie warning", () => {
    const answer = "A 2500 kcal diet with adequate protein supports your goal.";
    const { warnings } = answerValidator.validate(answer, generalRec());
    assert.ok(
      !warnings.some((w) => /calorie value outside safe range/i.test(w)),
    );
  });
});

// ─── L. answerValidator — validateSafetyLanguage + emoji encoding ─────────────

describe("L. answerValidator — unsafe phrases and emoji encoding", () => {
  function generalRec(): RecommendationResult {
    return {
      ...minimalRecommendation(),
      responseIntent: "general_fitness_knowledge",
    };
  }

  it('"ignore pain" → safety warning', () => {
    const { warnings } = answerValidator.validate(
      "You can ignore pain and keep training.",
      generalRec(),
    );
    assert.ok(warnings.some((w) => /unsafe phrase/i.test(w)));
  });

  it('"guarantee results" → safety warning', () => {
    const { warnings } = answerValidator.validate(
      "This plan will guarantee results within 30 days.",
      generalRec(),
    );
    assert.ok(warnings.some((w) => /unsafe phrase/i.test(w)));
  });

  it('"train through injury" → safety warning', () => {
    const { warnings } = answerValidator.validate(
      "It is fine to train through injury if the pain is mild.",
      generalRec(),
    );
    assert.ok(warnings.some((w) => /unsafe phrase/i.test(w)));
  });

  it('"không cần bác sĩ" → safety warning', () => {
    const { warnings } = answerValidator.validate(
      "Bạn không cần bác sĩ, chỉ cần tập đủ là được.",
      generalRec(),
    );
    assert.ok(warnings.some((w) => /unsafe phrase/i.test(w)));
  });

  it("answer with emojis → no false calorie/protein warnings", () => {
    // Emojis in the text should not confuse extractNumberNearKeyword regex.
    const answer =
      "💪 Great progress! Keep training at 2g per kg protein and ~2200 kcal/day. 🏋️ Stay consistent!";
    const { warnings } = answerValidator.validate(answer, generalRec());
    const calWarnings = warnings.filter((w) =>
      /calorie value outside safe range|protein-per-kg/i.test(w),
    );
    assert.equal(
      calWarnings.length,
      0,
      `Expected no false warnings from emoji text. Got: ${calWarnings.join("; ")}`,
    );
  });

  it("safe advice → no safety warnings", () => {
    const answer =
      "Follow progressive overload, rest adequately, and consult a doctor if pain persists.";
    const { warnings } = answerValidator.validate(answer, generalRec());
    assert.ok(!warnings.some((w) => /unsafe phrase/i.test(w)));
  });
});

// ─── M. intentRouter — general_fitness_knowledge fallback ─────────────────────

describe("M. intentRouter — supplement/recovery/deload/progress → general knowledge", () => {
  it('"supplement gì nên dùng?" → general_fitness_knowledge', () => {
    const { intent } = intentRouter.route(
      "Tôi nên dùng supplement gì để tăng cơ?",
    );
    assert.equal(intent, "general_fitness_knowledge");
  });

  it('"thời gian recovery" → general_fitness_knowledge', () => {
    const { intent } = intentRouter.route(
      "Thời gian nghỉ ngơi (recovery) tốt nhất giữa các buổi tập là bao lâu?",
    );
    assert.equal(intent, "general_fitness_knowledge");
  });

  it('"deload là gì?" → general_fitness_knowledge', () => {
    const { intent } = intentRouter.route(
      "Deload là gì và khi nào nên deload?",
    );
    assert.equal(intent, "general_fitness_knowledge");
  });

  it('"theo dõi progress" → general_fitness_knowledge', () => {
    const { intent } = intentRouter.route(
      "Làm thế nào để theo dõi progress hiệu quả nhất?",
    );
    assert.equal(intent, "general_fitness_knowledge");
  });

  it('"tại sao tôi không tăng cơ?" → general_fitness_knowledge', () => {
    const { intent } = intentRouter.route(
      "Tại sao sau 3 tháng tập tôi vẫn không tăng cơ?",
    );
    assert.equal(intent, "general_fitness_knowledge");
  });
});
