import type { FoodDetail, FoodSearchItem, NutritionFacts, SourceAttribution } from '../../types';

// USDA FoodData Central nutrient IDs (stable across data types)
const NUTRIENT_ID = {
  energy: 1008,    // Energy (kcal)
  protein: 1003,   // Protein
  fat: 1004,       // Total lipid (fat)
  carbs: 1005,     // Carbohydrate, by difference
  fiber: 1079,     // Fiber, total dietary
} as const;

const USDA_SOURCE: SourceAttribution = {
  providerName: 'USDA FoodData Central',
  sourceUrl: 'https://fdc.nal.usda.gov',
  authoritative: true,
  level: 'authoritative',
};

// ─── Internal USDA API shapes ─────────────────────────────────────────────────

interface UsdaNutrient {
  nutrientId?: number;
  nutrientNumber?: string;
  nutrientName?: string;
  unitName?: string;
  value?: number;
  amount?: number;
}

export interface UsdaSearchFood {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  foodCategory?: string;
  foodNutrients?: UsdaNutrient[];
  servingSize?: number;
  servingSizeUnit?: string;
}

export interface UsdaFoodDetail {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  foodCategory?: { description?: string } | string;
  foodNutrients?: UsdaNutrient[];
  servingSize?: number;
  servingSizeUnit?: string;
  ingredients?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNutrientValue(nutrients: UsdaNutrient[], id: number): number | null {
  const n = nutrients.find(
    (x) =>
      x.nutrientId === id ||
      Number(x.nutrientNumber) === id,
  );
  const val = n?.value ?? n?.amount ?? null;
  return val !== null && Number.isFinite(val) ? val : null;
}

function categoryString(raw: UsdaFoodDetail['foodCategory']): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  return raw.description;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

export function mapUsdaSearchFood(food: UsdaSearchFood): FoodSearchItem {
  return {
    id: String(food.fdcId),
    name: food.description,
    brand: food.brandOwner ?? food.brandName,
    category: food.foodCategory,
    dataType: food.dataType,
    source: USDA_SOURCE,
  };
}

export function mapUsdaFoodDetail(food: UsdaFoodDetail): FoodDetail {
  const nutrients = food.foodNutrients ?? [];
  const nutrition: NutritionFacts = {
    calories: getNutrientValue(nutrients, NUTRIENT_ID.energy),
    proteinG: getNutrientValue(nutrients, NUTRIENT_ID.protein),
    carbsG: getNutrientValue(nutrients, NUTRIENT_ID.carbs),
    fatG: getNutrientValue(nutrients, NUTRIENT_ID.fat),
    fiberG: getNutrientValue(nutrients, NUTRIENT_ID.fiber),
    servingSize: food.servingSize ?? null,
    servingUnit: food.servingSizeUnit ?? null,
  };

  return {
    id: String(food.fdcId),
    name: food.description,
    brand: food.brandOwner ?? food.brandName,
    category: categoryString(food.foodCategory),
    dataType: food.dataType,
    nutrition,
    ingredients: food.ingredients,
    source: USDA_SOURCE,
  };
}
