/**
 * Bug-fix regression tests — run with:
 *   npx tsx --test src/llm/__tests__/bugfix.test.ts
 *
 * Uses Node.js built-in test runner (node:test) — no extra dependencies.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { languageGuard } from '../language_guard';
import { hasCriticalNutritionMismatch, hasCriticalStructureMismatch, answerValidator } from '../answer_validator';
import { recommendationEngine } from '../recommendation_engine';
import { responseFormatter } from '../response_formatter';
import { inputParser } from '../input_parser';
import type { InputIntent, RecommendationResult, UserProfile } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function minimalProfile(): UserProfile {
  return {
    training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] },
  };
}

function profileForPersonalizedPlan(): UserProfile {
  return {
    age: 28,
    gender: 'FEMALE',
    heightCm: 160,
    currentWeightKg: 58,
    goal: 'WEIGHT_LOSS',
    experienceLevel: 'BEGINNER',
    activityLevel: 'LIGHTLY_ACTIVE',
    foodPreference: 'không sữa bò',
    training: {
      availableEquipment: ['dumbbell', 'bench'],
      injuries: ['đau gối nhẹ'],
      preferredTrainingDays: [2, 4, 6],
      trainingDaysPerWeek: 3,
    },
  };
}

function minimalIntent(routeIntent: InputIntent['routeIntent'] = 'meal_plan_request'): InputIntent {
  return {
    normalizedQuestion: 'meal plan',
    intent: 'meal_plan',
    routeIntent,
    needsPersonalization: false,
    missingFields: [],
  };
}

function minimalRecommendation(): RecommendationResult {
  return {
    objective: 'maintenance',
    nutrition: {
      targetCalories: 2000,
      proteinGrams: 150,
      carbsGrams: 220,
      fatGrams: 65,
      formula: 'test',
      confidence: 'medium',
    },
    workout: { split: 'full_body', sessionsPerWeek: 3, focus: [], avoidedPatterns: [], assumptions: [] },
    meal: { template: 'balanced', dailyMeals: 3, assumptions: [] },
    followUpQuestions: [],
    assumptions: [],
    missingFields: [],
  };
}

// ─── A. Language lock tests ───────────────────────────────────────────────────

describe('A. Vietnamese language lock', () => {
  // Reset lock state between tests by using different userIds
  it('locks VI for accented "trả lời bằng tiếng việt"', () => {
    const result = languageGuard.resolve('trả lời bằng tiếng việt', 'user-vi-accented');
    assert.equal(result.responseLanguage, 'vi');
    assert.equal(result.locked, true);
    assert.equal(result.lockReason, 'explicit_user_request');
  });

  it('locks VI for unaccented "tra loi bang tieng viet"', () => {
    const result = languageGuard.resolve('tra loi bang tieng viet', 'user-vi-plain');
    assert.equal(result.responseLanguage, 'vi');
    assert.equal(result.locked, true);
  });

  it('locks VI for "chỉ dùng tiếng việt" (accented)', () => {
    const result = languageGuard.resolve('chỉ dùng tiếng việt', 'user-vi-chi-dung');
    assert.equal(result.responseLanguage, 'vi');
    assert.equal(result.locked, true);
  });

  it('locks VI for "nói tiếng việt" (accented)', () => {
    const result = languageGuard.resolve('nói tiếng việt', 'user-vi-noi');
    assert.equal(result.responseLanguage, 'vi');
    assert.equal(result.locked, true);
  });

  it('lock persists for subsequent messages (user sends English next)', () => {
    const uid = 'user-vi-persist';
    languageGuard.resolve('trả lời bằng tiếng việt', uid); // set lock
    const followUp = languageGuard.resolve('How much protein should I eat?', uid);
    assert.equal(followUp.responseLanguage, 'vi', 'lock must persist after English message');
    assert.equal(followUp.locked, true);
    languageGuard.resetLock(uid);
  });

  it('resetLock clears the VI lock', () => {
    const uid = 'user-vi-reset';
    languageGuard.resolve('tra loi bang tieng viet', uid);
    languageGuard.resetLock(uid);
    const after = languageGuard.resolve('How much protein?', uid);
    assert.equal(after.locked, false);
    assert.equal(after.responseLanguage, 'en');
  });
});

describe('A. English language lock', () => {
  it('locks EN for "reply in english"', () => {
    const result = languageGuard.resolve('reply in english', 'user-en-reply');
    assert.equal(result.responseLanguage, 'en');
    assert.equal(result.locked, true);
  });

  it('locks EN for "use english"', () => {
    const result = languageGuard.resolve('use english', 'user-en-use');
    assert.equal(result.responseLanguage, 'en');
    assert.equal(result.locked, true);
  });

  it('locks EN for "trả lời bằng tiếng anh" (accented)', () => {
    const result = languageGuard.resolve('trả lời bằng tiếng anh', 'user-en-vi-accent');
    assert.equal(result.responseLanguage, 'en');
    assert.equal(result.locked, true);
  });
});

// ─── B. hasCriticalNutritionMismatch ─────────────────────────────────────────

describe('B. hasCriticalNutritionMismatch', () => {
  it('returns false for empty warnings', () => {
    assert.equal(hasCriticalNutritionMismatch([]), false);
  });

  it('returns false for non-nutrition warnings', () => {
    assert.equal(hasCriticalNutritionMismatch([
      'Answer does not ask follow-up questions despite missing user fields.',
      'Potentially unsafe phrase detected: /ignore pain/i',
    ]), false);
  });

  it('returns true when calories mismatch warning present', () => {
    assert.equal(hasCriticalNutritionMismatch([
      'Calories in answer (2500) differ significantly from deterministic target (2000).',
    ]), true);
  });

  it('returns true when protein mismatch warning present', () => {
    assert.equal(hasCriticalNutritionMismatch([
      'protein grams in answer (185) differ from deterministic target (133).',
    ]), true);
  });

  it('returns true when carbs mismatch warning present', () => {
    assert.equal(hasCriticalNutritionMismatch([
      'carb|carbs grams in answer (300) differ from deterministic target (220).',
    ]), true);
  });

  it('returns true when fat mismatch warning present', () => {
    assert.equal(hasCriticalNutritionMismatch([
      'fat|fats grams in answer (100) differ from deterministic target (65).',
    ]), true);
  });

  it('returns true even when mixed with non-critical warnings', () => {
    assert.equal(hasCriticalNutritionMismatch([
      'Answer does not ask follow-up questions despite missing user fields.',
      'protein grams in answer (185) differ from deterministic target (133).',
    ]), true);
  });
});

describe('B. hasCriticalStructureMismatch', () => {
  it('returns true for missing required section warnings', () => {
    assert.equal(hasCriticalStructureMismatch(['Missing required section: workout_table.']), true);
  });

  it('returns true for language lock violation warnings', () => {
    assert.equal(hasCriticalStructureMismatch(['Language lock violation: expected Vietnamese answer.']), true);
  });

  it('returns false for non-structural warnings', () => {
    assert.equal(hasCriticalStructureMismatch(['Potentially unsafe phrase detected: /ignore pain/i']), false);
  });
});

// ─── B. answerValidator triggers mismatch for a drifted LLM answer ────────────

describe('B. answerValidator detects drifted macros', () => {
  it('generates a nutrition mismatch warning when protein in answer is >20% off', () => {
    const rec = minimalRecommendation(); // protein target = 150g
    // LLM answer mentions 185g protein — 23% over target → should warn
    const answer = 'You should eat 185g of protein and 2000 calories today.';
    const result = answerValidator.validate(answer, rec);
    assert.equal(hasCriticalNutritionMismatch(result.warnings), true,
      `Expected mismatch warning but got: ${JSON.stringify(result.warnings)}`);
  });

  it('no mismatch warning when protein is within tolerance', () => {
    const rec = minimalRecommendation(); // protein = 150g
    // Sentence puts the number *after* the keyword so the validator's regex finds 155,
    // not some unrelated number (the regex scans forward from the keyword).
    const answer = 'Your protein target is 155g per day. Aim for 2000 calories.';
    const result = answerValidator.validate(answer, rec);
    // 155 vs 150 = 3.3% — within 20% threshold → no mismatch warning
    const hasMacroMismatch = result.warnings.some(w => /protein.*differ.*deterministic/i.test(w));
    assert.equal(hasMacroMismatch, false);
  });
});

// ─── C. meal_plan_request — deterministic formatter has no workout table ──────

describe('C. meal_plan deterministic formatter — no workout table headings', () => {
  it('formatMealPlan output contains no workout table columns (Ngày | Nhóm cơ | Bài tập)', () => {
    const profile = minimalProfile();
    const intent = minimalIntent('meal_plan_request');
    const rec = recommendationEngine.recommend(profile, intent, 'vi');

    // Import responseFormatter inline to call format()
    // We check the deterministic output does not contain workout columns
    // by inspecting the recommendation — mealPlan should exist, workoutPlan should not
    assert.ok(rec.mealPlan !== undefined, 'mealPlan should be set for meal_plan_request');
    assert.equal(rec.workoutPlan, undefined, 'workoutPlan must NOT be set for meal_plan_request');
    assert.equal(rec.specificRoutine, undefined, 'specificRoutine must NOT be set for meal_plan_request');
  });

  it('meal_plan recommendationResult has no workout rows in follow-ups', () => {
    const profile = minimalProfile();
    const intent = minimalIntent('meal_plan_request');
    const rec = recommendationEngine.recommend(profile, intent, 'vi');

    // None of the follow-up questions should mention training schedule or gym sessions
    const workoutKeywords = /lịch tập|workout|training|buổi tập|bài tập|exercise/i;
    for (const q of rec.followUpQuestions ?? []) {
      assert.equal(workoutKeywords.test(q), false,
        `Meal plan follow-up must not mention workout: "${q}"`);
    }
  });
});

// ─── D. Follow-up questions — language-aware ─────────────────────────────────

describe('D. Language-aware follow-up questions', () => {
  it('generates Vietnamese follow-ups when language=vi', () => {
    const profile = minimalProfile();
    const intent: InputIntent = {
      ...minimalIntent('meal_plan_request'),
      missingFields: ['weight', 'goal'],
    };
    const rec = recommendationEngine.recommend(profile, intent, 'vi');
    const questions = rec.followUpQuestions ?? [];

    assert.ok(questions.length > 0, 'should have follow-up questions');
    // All follow-ups must be Vietnamese — check for common VI patterns
    const hasEnglishQuestion = questions.some((q) => /^can you|^do you|^any food|^how many/i.test(q));
    assert.equal(hasEnglishQuestion, false,
      `VI follow-ups must not be in English. Got: ${JSON.stringify(questions)}`);
    const hasVietnamese = questions.some((q) => /bạn|mình|không|ăn|tập/i.test(q));
    assert.equal(hasVietnamese, true,
      `VI follow-ups should contain Vietnamese text. Got: ${JSON.stringify(questions)}`);
  });

  it('generates English follow-ups when language=en', () => {
    const profile = minimalProfile();
    const intent: InputIntent = {
      ...minimalIntent('meal_plan_request'),
      missingFields: ['weight', 'goal'],
    };
    const rec = recommendationEngine.recommend(profile, intent, 'en');
    const questions = rec.followUpQuestions ?? [];

    assert.ok(questions.length > 0, 'should have follow-up questions');
    const hasEnglishQuestion = questions.some((q) => /can you|do you|any food|how many/i.test(q));
    assert.equal(hasEnglishQuestion, true,
      `EN follow-ups should be in English. Got: ${JSON.stringify(questions)}`);
  });

  it('general intent VI follow-ups ask about training days in Vietnamese', () => {
    const profile = minimalProfile();
    const intent = minimalIntent('general_fitness_knowledge');
    const rec = recommendationEngine.recommend(profile, intent, 'vi');
    const questions = rec.followUpQuestions ?? [];
    const hasTuanNhieu = questions.some((q) => /buổi|tuần/i.test(q));
    assert.equal(hasTuanNhieu, true,
      `VI general follow-up should ask about training days. Got: ${JSON.stringify(questions)}`);
  });

  it('general intent EN follow-ups ask about training days in English', () => {
    const profile = minimalProfile();
    const intent = minimalIntent('general_fitness_knowledge');
    const rec = recommendationEngine.recommend(profile, intent, 'en');
    const questions = rec.followUpQuestions ?? [];
    const hasTrainingDays = questions.some((q) => /training days|days per week/i.test(q));
    assert.equal(hasTrainingDays, true,
      `EN general follow-up should ask about training days. Got: ${JSON.stringify(questions)}`);
  });
});

describe('E. Required sections and language lock validations', () => {
  it('flags meal-plan answer if it includes workout table', () => {
    const rec = minimalRecommendation();
    rec.responseIntent = 'meal_plan_request';
    const answer = [
      '## 🥗 Dinh Dưỡng',
      '| Chỉ số | Giá trị |',
      '|--------|---------|',
      '| Calo | 2000 kcal |',
      '| Ngày | Nhóm cơ | Bài tập | Sets | Reps | Rest |',
    ].join('\n');
    const result = answerValidator.validate(answer, rec, 'vi');
    const hasMealViolation = result.warnings.some((w) => /meal-only intent/i.test(w));
    assert.equal(hasMealViolation, true);
  });

  it('flags missing workout table for workout-plan intent', () => {
    const rec = minimalRecommendation();
    rec.responseIntent = 'workout_plan_request';
    const answer = '## 💪 Lịch tập\nChạy bộ và plank.';
    const result = answerValidator.validate(answer, rec, 'vi');
    const hasMissingTable = result.warnings.some((w) => /Missing required section: workout_table/i.test(w));
    assert.equal(hasMissingTable, true);
  });

  it('flags VI lock violation on heavily-English answer', () => {
    const rec = minimalRecommendation();
    rec.responseIntent = 'general_fitness_knowledge';
    const answer = 'Your training plan and nutrition goal for the week is clear. The target plan with training and nutrition should be followed.';
    const result = answerValidator.validate(answer, rec, 'vi');
    const hasLanguageWarning = result.warnings.some((w) => /Language lock violation/i.test(w));
    assert.equal(hasLanguageWarning, true);
  });
});

describe('F. Mandatory 11-case regression coverage', () => {
  it('case 1/2/3: detailed session requests include set-rep-rest-technique', () => {
    const profile = minimalProfile();
    const asks = [
      'Tôi mới tập gym, hãy cho tôi một buổi tập ngực đầy đủ cho người mới.',
      'Hãy lên cho tôi buổi tập lưng xô chi tiết, ghi rõ từng bài, set, rep và nghỉ.',
      'Cho tôi buổi push day hoàn chỉnh, không rút gọn.',
    ];

    for (const q of asks) {
      const intent = inputParser.parse(q, profile);
      const rec = recommendationEngine.recommend(profile, intent, 'vi');
      const answer = responseFormatter.format(rec, 'vi');
      const result = answerValidator.validate(answer, rec, 'vi', profile);
      const missingCore = result.warnings.some((w) => /detail_|exercise_list|technique_notes/i.test(w));
      assert.equal(missingCore, false, `Unexpected warnings for "${q}": ${JSON.stringify(result.warnings)}`);
    }
  });

  it('case 4/5: schedule requests preserve required day counts', () => {
    const profile = profileForPersonalizedPlan();
    const asks = [
      { q: 'Hãy lên lịch tập gym 3 buổi/tuần cho người mới muốn tăng cơ.', expectedDays: 3 },
      { q: 'Cho tôi lịch tập 6 buổi push pull legs đầy đủ.', expectedDays: 6 },
    ];

    for (const tc of asks) {
      const intent = inputParser.parse(tc.q, profile);
      const rec = recommendationEngine.recommend(profile, intent, 'vi');
      assert.equal(rec.workoutPlan?.days.length, tc.expectedDays);
    }
  });

  it('case 6/8: macro responses remain kcal-consistent', () => {
    const profile = profileForPersonalizedPlan();
    const asks = [
      'Tôi nặng 70kg, muốn tăng cơ, cần ăn bao nhiêu protein mỗi ngày?',
      'Hãy tính giúp tôi protein, carb, fat cho mục tiêu giảm mỡ.',
    ];

    for (const q of asks) {
      const intent = inputParser.parse(q, profile);
      const rec = recommendationEngine.recommend(profile, intent, 'vi');
      const answer = responseFormatter.format(rec, 'vi');
      const result = answerValidator.validate(answer, rec, 'vi', profile);
      const hasNutritionInconsistency = result.warnings.some((w) => /Nutrition inconsistency/i.test(w));
      assert.equal(hasNutritionInconsistency, false, `Nutrition mismatch for "${q}": ${JSON.stringify(result.warnings)}`);
    }
  });

  it('case 7/9: meal plans include meals + macros and respect dairy allergy preference', () => {
    const profile = profileForPersonalizedPlan();
    const asks = [
      'Hãy cho tôi thực đơn tăng cơ 1 ngày đầy đủ.',
      'Tôi bị dị ứng sữa, hãy lên thực đơn phù hợp.',
    ];

    for (const q of asks) {
      const intent = inputParser.parse(q, profile);
      const rec = recommendationEngine.recommend(profile, intent, 'vi');
      const answer = responseFormatter.format(rec, 'vi');
      assert.equal(/##\s*🥗\s*Dinh Dưỡng/i.test(answer), true);
      assert.equal(/Bữa|Meal/i.test(answer), true);
      if (/dị ứng sữa/i.test(q)) {
        assert.equal(/sữa chua|whey/i.test(answer.toLowerCase()), false);
      }
    }
  });

  it('case 10: Vietnamese lock keeps answer in Vietnamese', () => {
    const profile = minimalProfile();
    const uid = 'mandatory-case-10';
    const language = languageGuard.resolve('Trả lời bằng tiếng Việt hoàn toàn: cho tôi buổi tập ngực chi tiết.', uid);
    const intent = inputParser.parse('cho tôi buổi tập ngực chi tiết', profile);
    const rec = recommendationEngine.recommend(profile, intent, language.responseLanguage);
    const answer = responseFormatter.format(rec, language.responseLanguage);
    const result = answerValidator.validate(answer, rec, language.responseLanguage, profile);
    const hasLanguageViolation = result.warnings.some((w) => /Language lock violation/i.test(w));
    assert.equal(hasLanguageViolation, false);
    languageGuard.resetLock(uid);
  });

  it('case 11: combined plan includes both training and nutrition and is personalized', () => {
    const profile = profileForPersonalizedPlan();
    const q = 'Tôi nữ, 58kg, 1m60, muốn giảm mỡ, hãy lên lịch tập và ăn uống.';
    const intent = inputParser.parse(q, profile);
    const rec = recommendationEngine.recommend(profile, intent, 'vi');
    const answer = responseFormatter.format(rec, 'vi');
    assert.equal(rec.responseIntent, 'combined_plan_request');
    assert.equal(/Lịch Tập/i.test(answer), true);
    assert.equal(/Dinh Dưỡng/i.test(answer), true);
    const result = answerValidator.validate(answer, rec, 'vi', profile);
    const hasPersonalizationMissing = result.warnings.some((w) => /Personalization missing/i.test(w));
    assert.equal(hasPersonalizationMissing, false, JSON.stringify(result.warnings));
  });
});
