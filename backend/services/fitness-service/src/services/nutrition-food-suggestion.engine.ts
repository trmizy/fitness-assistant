import { foodRepository } from "../repositories/food.repository";
import {
  orderByRegionPriority,
  REGION_PREP_STYLE_VI,
  type VietnameseRegion,
} from "../config/vietnamese-region-food.config";

/**
 * AI Nutrition Cycle Engine (Gymini) — spec §XII (food-first UX: translate
 * remaining macros into real food, not just numbers) and §XIII (low-budget
 * Vietnamese-first food preference). Deterministic — no LLM call (spec §L:
 * a beginner opening the Nutrition dashboard must never trigger an LLM call
 * just to see "what should I eat next").
 *
 * Reuses the existing `Food` catalog + its curated Vietnamese alias layer
 * (prisma/data/food_aliases.vi.json — confirmed to already cover every
 * term used below) via foodRepository.searchByName, rather than a new food
 * database or hard-coded nutrition numbers.
 *
 * Region personalization (Smart Substitute follow-up) reorders these SAME
 * budget-gated pools by the user's region (see
 * vietnamese-region-food.config.ts) — it never bypasses the budget tier,
 * it only changes which affordable option comes first.
 */

export type BudgetLevel = "LOW" | "NORMAL" | "FLEXIBLE";

// Deliberately common, inexpensive, widely-available Vietnamese staples for
// LOW; NORMAL/FLEXIBLE progressively add higher-cost options (salmon, beef,
// shrimp) per spec §XIII's explicit "không mặc định recommend salmon/
// avocado/whey" rule for LOW budget.
export const PROTEIN_QUERIES: Record<BudgetLevel, string[]> = {
  LOW: ["trứng", "đậu hũ", "ức gà", "thịt heo nạc", "cá basa"],
  NORMAL: ["ức gà", "trứng", "thịt heo nạc", "cá basa", "đậu hũ"],
  FLEXIBLE: ["ức gà", "cá hồi", "thịt bò nạc", "tôm", "trứng"],
};
export const CARB_QUERIES: Record<BudgetLevel, string[]> = {
  LOW: ["cơm trắng", "khoai lang", "khoai tây"],
  NORMAL: ["cơm trắng", "khoai lang", "yến mạch"],
  FLEXIBLE: ["cơm gạo lứt", "yến mạch", "khoai lang"],
};
// Smart Substitute "chay" (vegetarian/vegan) pool — lacto-ovo includes
// trứng/sữa-derived items, vegan excludes them entirely. Same catalog, no
// new data source: every term here is already in food_aliases.vi.json.
export const VEGETARIAN_QUERIES = {
  LACTO_OVO: ["đậu hũ", "trứng", "đậu đen", "đậu xanh", "nấm", "đậu nành"],
  VEGAN: ["đậu hũ", "đậu đen", "đậu xanh", "nấm", "đậu nành", "đậu lăng"],
} as const;
const VEG_LABEL = "rau xanh tùy thích (rau muống, cải, bông cải xanh...)";

const MAX_OPTIONS = 3;
const DEFAULT_REALISTIC_MAX_G = 300;
const MIN_ITEM_QUANTITY_G = 30;

/** "Ăn chay (có trứng/sữa)" / "Thuần chay" from UserProfile.dietaryPreference
 * (ProfilePage.tsx's own option list) — substring match, case/diacritic-
 * sensitive but tolerant of the exact two labels already in production. */
export function dietaryPreferenceToVegetarianMode(
  dietaryPreference: string | null | undefined,
): "LACTO_OVO" | "VEGAN" | null {
  if (!dietaryPreference) return null;
  const v = dietaryPreference.toLowerCase();
  if (v.includes("thuần chay")) return "VEGAN";
  if (v.includes("chay")) return "LACTO_OVO";
  return null;
}

export interface FoodSuggestionItem {
  foodId: string;
  foodName: string;
  quantityG: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodSuggestionOption {
  label: string;
  items: FoodSuggestionItem[];
  sideNote: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// Found while seeding real USDA data for the first time in this
// environment (2026-09-07): `searchByName`'s plain alphabetical order
// regularly surfaces a branded restaurant item or an infant-food entry
// ahead of the plain generic ingredient — e.g. "cá basa" (catfish)
// alphabetically led with "CRACKER BARREL, farm raised catfish platter"
// before any plain "Fish, catfish, ..." row, and "trứng" (egg) with
// "Babyfood, cereal, egg yolks and bacon, junior". Neither is a
// reasonable "here's an egg" or "here's a piece of fish" suggestion.
// USDA's own naming convention makes both reliably detectable: branded
// items are ALL-CAPS before the first comma, infant food starts with
// "Baby"/"Babyfood". Composite dishes that merely CONTAIN the query
// ingredient (not as their primary category) also skew long — "Beef,
// tofu, and vegetables excluding carrots, broccoli, and dark-green
// leafy; no potatoes, soy-based sauce" for "đậu hũ" — so among whatever
// survives the two exclusions, the SHORTEST name is preferred, which in
// practice is reliably the plain single-ingredient entry.
function isBrandedOrInfantFood(name: string): boolean {
  if (/^baby/i.test(name)) return true;
  const firstSegment = (name.split(",")[0] ?? name).trim();
  const hasLowercase = /[a-z]/.test(firstSegment);
  const upperCount = firstSegment.match(/[A-Z]/g)?.length ?? 0;
  // No lowercase letters at all AND at least 2 uppercase ones — USDA's own
  // branded-product convention ("CRACKER BARREL, ...", "HORMEL ALWAYS
  // TENDER, ..."). A plain category word like "Beef"/"Fish"/"Egg" always
  // has lowercase letters after its capital, so this never false-flags it.
  return !hasLowercase && upperCount >= 2;
}

function pickBestCandidate(candidates: any[]): any[] {
  const usable = candidates.filter((f) => f.isSupplement !== true && !isBrandedOrInfantFood(f.name ?? ""));
  const pool = usable.length > 0 ? usable : candidates.filter((f) => f.isSupplement !== true);
  return [...pool].sort((a, b) => {
    // Prefer USDA's own "NFS" (Not Further Specified) marker — its
    // explicit generic-representative-of-this-category entry — before
    // falling back to plain shortest name. Matches
    // prisma/seed_food_aliases.ts's identical ranking, which decides
    // which up-to-50 rows even become aliases in the first place.
    const aNfs = /,\s*NFS$/i.test(a.name ?? "") ? 0 : 1;
    const bNfs = /,\s*NFS$/i.test(b.name ?? "") ? 0 : 1;
    if (aNfs !== bNfs) return aNfs - bNfs;
    return (a.name?.length ?? 0) - (b.name?.length ?? 0);
  });
}

// A Vietnamese alias term can have up to 50 real Food rows linked to it
// (see MAX_ALIASES_PER_TERM in seed_food_aliases.ts); fetching fewer than
// that here would silently truncate the pool BEFORE this file's own
// ranking ever sees the best candidates — alphabetical order (searchByName's
// own orderBy) has no reason to put the best one in the first N.
const CANDIDATE_FETCH_LIMIT = 100;

export async function firstUsableFood(query: string, exclude?: Set<string>): Promise<any | null> {
  const results = await foodRepository.searchByName(query, CANDIDATE_FETCH_LIMIT);
  const ranked = pickBestCandidate(results);
  return ranked.find((f: any) => !exclude?.has(f.id)) ?? null;
}

/** All usable candidates for a query (branded/infant-food excluded, best
 * — NFS then shortest plain-ingredient-looking name — first), e.g. to
 * sort by protein density for the "higher protein" substitute —
 * firstUsableFood only ever returns the single top match. */
export async function usableFoodCandidates(query: string): Promise<any[]> {
  const results = await foodRepository.searchByName(query, CANDIDATE_FETCH_LIMIT);
  return pickBestCandidate(results);
}

export function macrosForQuantity(food: any, quantityG: number) {
  const factor = quantityG / 100;
  return {
    calories: Math.round((food.calories ?? 0) * factor),
    protein: Math.round((food.protein ?? 0) * factor * 10) / 10,
    carbs: Math.round((food.carbs ?? 0) * factor * 10) / 10,
    fat: Math.round((food.fats ?? 0) * factor * 10) / 10,
  };
}

/**
 * Builds up to MAX_OPTIONS concrete food combos that roughly cover a user's
 * remaining calories/protein for the day — never just "you have 450 kcal
 * and 35g protein left" (spec §XII). Each option pairs one protein source
 * with one carb source, sized to the remaining targets and clamped to a
 * realistic single-meal serving.
 *
 * `region` (optional, UserProfile.region) reorders the protein pool by
 * regional preference (see vietnamese-region-food.config.ts) — it never
 * changes WHICH foods are eligible for the budget tier, only which
 * affordable one comes first, and adds a short regional prep-style note.
 * `vegetarianMode` (from UserProfile.dietaryPreference) swaps the whole
 * protein pool for the vegetarian/vegan one when the user has that set —
 * previously dead data, never read by this engine before.
 */
export async function buildFoodSuggestions(
  remainingCalories: number,
  remainingProtein: number,
  budgetLevel: BudgetLevel = "NORMAL",
  region?: VietnameseRegion | null,
  vegetarianMode?: "LACTO_OVO" | "VEGAN" | null,
): Promise<FoodSuggestionOption[]> {
  if (remainingCalories <= 50) return [];

  const basProteinQueries = vegetarianMode
    ? [...VEGETARIAN_QUERIES[vegetarianMode]]
    : PROTEIN_QUERIES[budgetLevel] ?? PROTEIN_QUERIES.NORMAL;
  const proteinQueries = orderByRegionPriority(basProteinQueries, region);
  const carbQueries = CARB_QUERIES[budgetLevel] ?? CARB_QUERIES.NORMAL;
  const includeProteinItem = remainingProtein > 5;

  const options: FoodSuggestionOption[] = [];
  const usedProteinFoodIds = new Set<string>();

  for (let i = 0; i < MAX_OPTIONS && proteinQueries.length > 0; i++) {
    const proteinQuery = proteinQueries[i % proteinQueries.length];
    const carbQuery = carbQueries[i % carbQueries.length];

    const [proteinFood, carbFood] = await Promise.all([
      includeProteinItem ? firstUsableFood(proteinQuery) : Promise.resolve(null),
      firstUsableFood(carbQuery),
    ]);

    if (includeProteinItem && (!proteinFood || usedProteinFoodIds.has(proteinFood.id))) continue;
    if (!carbFood) continue;
    if (proteinFood) usedProteinFoodIds.add(proteinFood.id);

    const items: FoodSuggestionItem[] = [];
    let caloriesUsedByProtein = 0;

    if (proteinFood && proteinFood.protein > 0) {
      const targetProteinG = remainingProtein * 0.85;
      const rawQtyG = (targetProteinG / proteinFood.protein) * 100;
      const maxQtyG = proteinFood.realisticServingMaxG ?? 250;
      const proteinQtyG = roundTo(Math.min(Math.max(rawQtyG, MIN_ITEM_QUANTITY_G), maxQtyG), 10);
      const proteinMacros = macrosForQuantity(proteinFood, proteinQtyG);
      caloriesUsedByProtein = proteinMacros.calories;
      items.push({
        foodId: proteinFood.id,
        foodName: proteinFood.name,
        quantityG: proteinQtyG,
        ...proteinMacros,
      });
    }

    if (carbFood.calories > 0) {
      const remainingCalForCarb = Math.max(0, remainingCalories - caloriesUsedByProtein);
      const rawQtyG = (remainingCalForCarb / carbFood.calories) * 100;
      const maxQtyG = carbFood.realisticServingMaxG ?? DEFAULT_REALISTIC_MAX_G;
      const carbQtyG = roundTo(Math.min(Math.max(rawQtyG, MIN_ITEM_QUANTITY_G), maxQtyG), 10);
      items.push({
        foodId: carbFood.id,
        foodName: carbFood.name,
        quantityG: carbQtyG,
        ...macrosForQuantity(carbFood, carbQtyG),
      });
    }

    if (items.length === 0) continue;

    const totals = items.reduce(
      (acc, item) => ({
        calories: acc.calories + item.calories,
        protein: acc.protein + item.protein,
        carbs: acc.carbs + item.carbs,
        fat: acc.fat + item.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );

    options.push({
      label: `Phương án ${String.fromCharCode(65 + options.length)}`,
      items,
      sideNote: region ? `${VEG_LABEL} — gợi ý ${REGION_PREP_STYLE_VI[region]}` : VEG_LABEL,
      totalCalories: Math.round(totals.calories),
      totalProtein: Math.round(totals.protein * 10) / 10,
      totalCarbs: Math.round(totals.carbs * 10) / 10,
      totalFat: Math.round(totals.fat * 10) / 10,
    });
  }

  return options;
}
