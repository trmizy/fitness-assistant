import type { FoodDetail, FoodSearchItem, NutritionFacts, SourceAttribution } from '../../types';

const OFF_SOURCE: SourceAttribution = {
  providerName: 'Open Food Facts',
  sourceUrl: 'https://world.openfoodfacts.org',
  authoritative: false,
  level: 'supplementary',
};

// ─── Internal OFF API shapes ──────────────────────────────────────────────────

export interface OffNutriments {
  'energy-kcal_100g'?: number;
  'energy-kcal_serving'?: number;
  proteins_100g?: number;
  proteins_serving?: number;
  carbohydrates_100g?: number;
  carbohydrates_serving?: number;
  fat_100g?: number;
  fat_serving?: number;
  fiber_100g?: number;
}

export interface OffProduct {
  _id?: string;
  code?: string;
  product_name?: string;
  brands?: string;
  categories?: string;
  ingredients_text?: string;
  nutriments?: OffNutriments;
  serving_size?: string;
  image_url?: string;
  url?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseServingSize(raw?: string): { size: number | null; unit: string | null } {
  if (!raw) return { size: null, unit: null };
  const match = raw.match(/^([\d.]+)\s*([a-zA-Z]*)/);
  if (!match) return { size: null, unit: raw };
  return { size: Number(match[1]) || null, unit: match[2] || null };
}

function mapNutrition(n: OffNutriments | undefined, serving: string | undefined): NutritionFacts {
  if (!n) {
    return { calories: null, proteinG: null, carbsG: null, fatG: null };
  }
  const { size, unit } = parseServingSize(serving);
  return {
    calories: n['energy-kcal_100g'] ?? n['energy-kcal_serving'] ?? null,
    proteinG: n.proteins_100g ?? n.proteins_serving ?? null,
    carbsG: n.carbohydrates_100g ?? n.carbohydrates_serving ?? null,
    fatG: n.fat_100g ?? n.fat_serving ?? null,
    fiberG: n.fiber_100g ?? null,
    servingSize: size,
    servingUnit: unit,
  };
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

export function mapOffProductToSearchItem(p: OffProduct): FoodSearchItem {
  return {
    id: p._id ?? p.code ?? crypto.randomUUID(),
    name: p.product_name ?? 'Unknown',
    brand: p.brands,
    category: p.categories?.split(',')[0]?.trim(),
    source: OFF_SOURCE,
  };
}

export function mapOffProductToDetail(p: OffProduct): FoodDetail {
  return {
    id: p._id ?? p.code ?? crypto.randomUUID(),
    name: p.product_name ?? 'Unknown',
    brand: p.brands,
    category: p.categories?.split(',')[0]?.trim(),
    nutrition: mapNutrition(p.nutriments, p.serving_size),
    barcode: p.code,
    ingredients: p.ingredients_text,
    imageUrl: p.image_url,
    source: OFF_SOURCE,
  };
}
