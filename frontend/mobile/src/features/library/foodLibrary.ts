/**
 * SH-13's pure parts.
 *
 * The design's category chips ("Thịt", "Rau"…) have no data behind them: the `Food` table carries
 * no food-group column, and web says so in its own comment before offering what IS computable —
 * sorting by macro, plus source / form / supplement / has-image filters. Mobile follows the data,
 * not the mock, and keeps the design's layout for everything that does exist.
 *
 * Every number in the catalog is per 100 g.
 */

export type FoodItem = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  imageUrl: string | null;
  source: string | null;
  foodForm: string | null;
  isSupplement: boolean;
};

export type FoodSort = "name" | "protein" | "carbs" | "fats";

export const FOOD_SORTS: { value: FoodSort; label: string }[] = [
  { value: "name", label: "Tên A-Z" },
  { value: "protein", label: "Nhiều đạm" },
  { value: "carbs", label: "Nhiều tinh bột" },
  { value: "fats", label: "Nhiều béo" },
];

/** Same floor as every other search in the app: one character matches half the catalog. */
export const MIN_FOOD_QUERY = 2;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function normalizeFood(raw: any): FoodItem {
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? "Món ăn"),
    calories: num(raw?.calories),
    protein: num(raw?.protein),
    carbs: num(raw?.carbs),
    fats: num(raw?.fats ?? raw?.fat),
    imageUrl: raw?.imageUrl ?? null,
    source: raw?.source ?? null,
    foodForm: raw?.foodForm ?? null,
    isSupplement: !!raw?.isSupplement,
  };
}

/** `/food/search` answers with a bare array, `/food` with `{ foods, pagination }`. */
export function normalizeFoods(raw: any): FoodItem[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.foods) ? raw.foods : raw?.data;
  return Array.isArray(list) ? list.map(normalizeFood) : [];
}

export function foodTotalPages(raw: any, limit: number): number {
  const total = num(raw?.pagination?.total);
  if (total <= 0 || limit <= 0) return 1;
  return Math.max(1, Math.ceil(total / limit));
}

export type MacroSlice = { key: "protein" | "carbs" | "fats"; label: string; grams: number; pct: number };

/**
 * The design's macro-ratio bar. Shares are by GRAMS, matching the mock — not by calories, which
 * would make fat look twice its size and is a different claim than the bar makes.
 */
export function macroRatio(food: FoodItem): MacroSlice[] {
  const parts: { key: MacroSlice["key"]; label: string; grams: number }[] = [
    { key: "protein", label: "Đạm", grams: food.protein },
    { key: "carbs", label: "Tinh bột", grams: food.carbs },
    { key: "fats", label: "Chất béo", grams: food.fats },
  ];
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.grams), 0);
  return parts.map((part) => ({
    ...part,
    pct: total > 0 ? Math.round((Math.max(0, part.grams) / total) * 1000) / 10 : 0,
  }));
}

/** A catalog figure is a measurement, so it keeps one decimal — 16.9 g, never "17". */
export function gramLabel(value: number): string {
  return `${Math.round(value * 10) / 10}g`;
}

export function caloriesLabel(value: number): string {
  return `${Math.round(value)} kcal`;
}

/**
 * The USDA names are long and start with the brand in caps ("APPLEBEE'S, chicken tenders…").
 * Left as they are — trimming them would make two different foods look like the same one.
 */
export function foodSubtitle(food: FoodItem): string {
  const bits = [caloriesLabel(food.calories)];
  if (food.foodForm) bits.push(food.foodForm);
  if (food.isSupplement) bits.push("supplement");
  return bits.join(" · ");
}
