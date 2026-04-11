import type { ExerciseItem, FoodDetail, NutritionFacts } from '../types';

/**
 * Merges two FoodDetail records using USDA-wins precedence:
 *   - USDA macros (calories, protein, carbs, fat) are ALWAYS kept from `primary`.
 *   - Supplementary fields (barcode, brand, imageUrl, ingredients) are taken
 *     from `secondary` only when the `primary` does not have them.
 *
 * This is the central enforcement point of business rule #3:
 *   "Non-USDA datasets must never override USDA macro totals when USDA data exists."
 */
export function mergeFoodDetails(primary: FoodDetail, secondary: FoodDetail): FoodDetail {
  return {
    // Start with all secondary fields …
    ...secondary,
    // … then override with all primary fields (USDA wins on everything it has).
    ...primary,
    // Macro totals always from USDA.
    nutrition: enforceUsdaMacros(primary.nutrition, secondary.nutrition),
    // Enrichment: take from secondary only when primary field is absent.
    brand: primary.brand ?? secondary.brand,
    barcode: primary.barcode ?? secondary.barcode,
    imageUrl: primary.imageUrl ?? secondary.imageUrl,
    ingredients: primary.ingredients ?? secondary.ingredients,
  };
}

/**
 * Enforces USDA macro values, but allows secondary source to fill in
 * optional nutritional details (fiber, serving info) that USDA may omit.
 */
function enforceUsdaMacros(usda: NutritionFacts, other: NutritionFacts): NutritionFacts {
  return {
    // Core macros — always USDA.
    calories: usda.calories,
    proteinG: usda.proteinG,
    carbsG: usda.carbsG,
    fatG: usda.fatG,
    // Optional enrichment — USDA first, fall back to secondary.
    fiberG: usda.fiberG ?? other.fiberG,
    servingSize: usda.servingSize ?? other.servingSize,
    servingUnit: usda.servingUnit ?? other.servingUnit,
  };
}

/**
 * Deduplicates exercises from multiple providers.
 * First occurrence wins (callers should pass highest-priority source first).
 */
export function deduplicateExercises(items: ExerciseItem[]): ExerciseItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
