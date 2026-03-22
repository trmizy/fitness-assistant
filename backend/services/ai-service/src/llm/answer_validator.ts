import type { RecommendationResult, ValidationResult } from './types';

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

export const answerValidator = {
  validate(answer: string, recommendation: RecommendationResult): ValidationResult {
    const warnings: string[] = [];
    const nutrition = recommendation.nutrition;

    warnings.push(...validateCalories(answer, nutrition.targetCalories || 0));
    warnings.push(...validateMacro(answer, 'protein', nutrition.proteinGrams || 0));
    warnings.push(...validateMacro(answer, 'carb|carbs', nutrition.carbsGrams || 0));
    warnings.push(...validateMacro(answer, 'fat|fats', nutrition.fatGrams || 0));
    warnings.push(...validateSafetyLanguage(answer));

    if (recommendation.missingFields.length > 0) {
      const asksFollowup = /follow-up|follow up|can you share|please provide|could you tell/i.test(answer);
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
