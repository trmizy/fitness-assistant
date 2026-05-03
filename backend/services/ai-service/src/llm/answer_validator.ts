import type { RecommendationResult, ResponseLanguage, UserProfile, ValidationResult } from './types';

function extractNumberNearKeyword(text: string, keyword: string): number | null {
  const regex = new RegExp(`${keyword}[^\\d]{0,20}(\\d{2,5})`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function validateCalories(text: string, expected: number): string[] {
  const warnings: string[] = [];
  if (!expected) return warnings;
  const found = extractNumberNearKeyword(text, 'calories|kcal');
  if (found === null) return warnings;

  const diffRatio = Math.abs(found - expected) / Math.max(1, expected);
  if (diffRatio > 0.12) {
    warnings.push(
      `Calories in answer (${found}) differ significantly from deterministic target (${expected}).`,
    );
  }

  return warnings;
}

function validateMacro(text: string, label: string, expected: number): string[] {
  const warnings: string[] = [];
  if (!expected) return warnings;
  const found = extractNumberNearKeyword(text, label);
  if (found === null) return warnings;

  const diffRatio = Math.abs(found - expected) / Math.max(1, expected);
  if (diffRatio > 0.2) {
    warnings.push(`${label} grams in answer (${found}) differ from deterministic target (${expected}).`);
  }

  return warnings;
}

function validateSafetyLanguage(text: string): string[] {
  const warnings: string[] = [];
  const riskyPatterns = [
    /guarantee[d]?\s+results?/i,
    /no need to consult/i,
    /ignore pain/i,
    /train through injury/i,
  ];

  riskyPatterns.forEach((pattern) => {
    if (pattern.test(text)) {
      warnings.push(`Potentially unsafe phrase detected: ${pattern.toString()}`);
    }
  });

  return warnings;
}

function requireSection(answer: string, sectionPatterns: RegExp[], sectionLabel: string): string[] {
  const exists = sectionPatterns.some((pattern) => pattern.test(answer));
  return exists ? [] : [`Missing required section: ${sectionLabel}.`];
}

function validateRequiredSections(answer: string, recommendation: RecommendationResult): string[] {
  const warnings: string[] = [];
  const intent = recommendation.responseIntent;

  if (intent === 'meal_plan_request') {
    warnings.push(...requireSection(answer, [/ðŸ¥—|dinh dưỡng|nutrition/i], 'nutrition'));
    warnings.push(...requireSection(answer, [/meal|bữa|thực đơn/i], 'meal_examples'));
    warnings.push(...requireSection(answer, [/điều chỉnh|adjust/i], 'adjustment'));
    if (/(bài tập|exercise|workout)/i.test(answer)) {
      warnings.push('Answer includes workout content for meal-only intent.');
    }
  }

  if (
    intent === 'workout_plan_request' ||
    intent === 'body_recomposition_request' ||
    intent === 'frequency_change_request' ||
    intent === 'combined_plan_request'
  ) {
    warnings.push(...requireSection(answer, [/day|ngày|tuần|week/i], 'workout_table'));
    warnings.push(...requireSection(answer, [/calo|kcal/i, /ðŸ¥—/i, /dinh|nutri/i], 'nutrition_summary'));
    warnings.push(...requireSection(answer, [/sets?|hiệp/i], 'sets'));
    warnings.push(...requireSection(answer, [/reps?|lặp/i], 'reps'));
    warnings.push(...requireSection(answer, [/rest|nghỉ/i], 'rest'));
  }

  if (intent === 'specific_exercise_request' || intent === 'muscle_group_routine_request') {
    warnings.push(...requireSection(answer, [/exercise|bài tập/i], 'exercise_list'));
    warnings.push(...requireSection(answer, [/technique|kỹ thuật/i], 'technique_notes'));
    warnings.push(...requireSection(answer, [/safety|an toàn/i], 'safety_notes'));
  }

  if (recommendation.detailMode) {
    warnings.push(...requireSection(answer, [/set|hiệp/i], 'detail_sets'));
    warnings.push(...requireSection(answer, [/rep|lặp/i], 'detail_reps'));
    warnings.push(...requireSection(answer, [/rest|nghỉ/i], 'detail_rest'));
    warnings.push(...requireSection(answer, [/technique|kỹ thuật/i], 'detail_technique'));
  }

  return warnings;
}

function validateNutritionConsistency(recommendation: RecommendationResult): string[] {
  const n = recommendation.nutrition;
  if (!n.targetCalories || !n.proteinGrams || !n.carbsGrams || !n.fatGrams) return [];
  const kcalFromMacro = n.proteinGrams * 4 + n.carbsGrams * 4 + n.fatGrams * 9;
  const diff = Math.abs(kcalFromMacro - n.targetCalories);
  if (diff > 120) {
    return [`Nutrition inconsistency: macro-derived kcal (${kcalFromMacro}) differs from target (${n.targetCalories}).`];
  }
  return [];
}

function validatePersonalization(answer: string, profile: UserProfile | undefined): string[] {
  if (!profile) return [];

  const requiredSignals: string[] = [];
  if (profile.currentWeightKg || profile.inBody?.weightKg) requiredSignals.push(String(profile.currentWeightKg || profile.inBody?.weightKg));
  if (profile.heightCm) requiredSignals.push(String(profile.heightCm));
  if (profile.gender === 'FEMALE') requiredSignals.push('nữ');
  if (profile.gender === 'MALE') requiredSignals.push('nam');
  if (profile.training.injuries.length > 0) requiredSignals.push('chấn thương');
  if (profile.training.availableEquipment.length > 0) requiredSignals.push('thiết bị');

  if (requiredSignals.length < 2) return [];
  const answerNorm = answer.toLowerCase();
  const hitCount = requiredSignals.filter((s) => answerNorm.includes(s.toLowerCase())).length;
  if (hitCount === 0) {
    return ['Personalization missing: user profile fields were provided but not reflected in answer.'];
  }
  return [];
}

function validateLanguageLock(answer: string, language: ResponseLanguage): string[] {
  if (language !== 'vi') return [];
  const warnings: string[] = [];
  const hasVietnameseSignal = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệóòỏõọốồổỗộớờởỡợúùủũụứừửữựíìỉĩị]/i.test(answer)
    || /(bạn|mục tiêu|lịch tập|dinh dưỡng|hành động|tuần|bài tập|nghỉ)/i.test(answer);
  const englishSignalCount = (answer.match(/\b(the|and|your|with|training|nutrition|goal|week|plan|target)\b/gi) || []).length;
  if (!hasVietnameseSignal && englishSignalCount >= 4) {
    warnings.push('Language lock violation: expected Vietnamese answer.');
  }
  return warnings;
}

/**
 * Returns true when at least one validation warning indicates that a calorie
 * or macro number in the LLM answer differs materially from the deterministic
 * target.  Used by the orchestrator to decide whether to fall back.
 */
export function hasCriticalNutritionMismatch(warnings: string[]): boolean {
  return warnings.some((w) => /differ.*from deterministic target/i.test(w));
}

export function hasCriticalStructureMismatch(warnings: string[]): boolean {
  return warnings.some((w) => /Missing required section|Language lock violation|meal-only intent|Nutrition inconsistency|Personalization missing/i.test(w));
}

export const answerValidator = {
  validate(
    answer: string,
    recommendation: RecommendationResult,
    language: ResponseLanguage = 'en',
    profile?: UserProfile,
  ): ValidationResult {
    const warnings: string[] = [];
    const nutrition = recommendation.nutrition;

    warnings.push(...validateCalories(answer, nutrition.targetCalories || 0));
    warnings.push(...validateMacro(answer, 'protein', nutrition.proteinGrams || 0));
    warnings.push(...validateMacro(answer, 'carb|carbs', nutrition.carbsGrams || 0));
    warnings.push(...validateMacro(answer, 'fat|fats', nutrition.fatGrams || 0));
    warnings.push(...validateSafetyLanguage(answer));
    warnings.push(...validateRequiredSections(answer, recommendation));
    warnings.push(...validateLanguageLock(answer, language));
    warnings.push(...validateNutritionConsistency(recommendation));
    warnings.push(...validatePersonalization(answer, profile));

    if (recommendation.missingFields.length > 0) {
      const asksFollowup =
        /follow-up|follow up|can you share|please provide|could you tell|ban co the cho minh biet|ban vui long cung cap|cho minh xin them thong tin|cau hoi de ca nhan hoa/i.test(
          answer,
        );
      if (!asksFollowup) {
        warnings.push('Answer does not ask follow-up questions despite missing user fields.');
      }
    }

    return {
      valid: warnings.length === 0,
      warnings,
    };
  },
};
