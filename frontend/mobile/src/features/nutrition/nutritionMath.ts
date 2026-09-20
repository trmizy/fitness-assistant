/**
 * The arithmetic behind CL-03/CL-19, kept out of the screens so it can be tested without a
 * renderer — and because every number here has a backend rule behind it that is easy to get
 * subtly wrong:
 *
 * - The API stores and returns **`fats`**, not `fat` (Prisma `NutritionLog.fats`). Web's page reads
 *   `log.fat` when it sums a day, which is `undefined` for every row — so its fat total is always 0.
 *   Verified against the real API on 2026-09-16 (POST /nutrition then GET /nutrition returns
 *   `fats`). Mobile reads `fats` and keeps `fat` only as a fallback.
 * - `POST /nutrition` validates macros with `z.number().positive()`, so a **0 is rejected**, not
 *   stored as zero. A payload therefore omits a macro rather than sending 0.
 * - `PUT /nutrition/goals` refuses a goal whose macros do not add up to its own calories, using
 *   Atwater 4/4/9 with a ±50 kcal tolerance (`nutrition-goal-macro-validator.ts`). The same check
 *   runs here so the user is told before the round trip, with the same numbers in the message.
 * - Catalog foods are per 100 g: scale = grams / 100, calories rounded to a whole number and macros
 *   to one decimal — identical to web's add-food modal, so both clients log the same row.
 */

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Bữa sáng",
  lunch: "Bữa trưa",
  dinner: "Bữa tối",
  snack: "Bữa phụ",
};

export type NutritionLogRow = {
  id: string;
  date: string;
  mealType: MealType;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  notes: string | null;
};

export type MacroTotals = { calories: number; protein: number; carbs: number; fat: number };

/** kcal per gram. Same constants the backend validator uses. */
export const ATWATER = { protein: 4, carb: 4, fat: 9 } as const;

/** Backend's own slack for a goal's macros vs its calories — one gram-rounding slip, not medicine. */
export const MACRO_CALORIE_TOLERANCE_KCAL = 50;

/** Web's limits for one logged portion, mirrored so both clients reject the same input. */
export const MIN_GRAMS = 1;
export const MAX_GRAMS = 5000;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function asMealType(raw: unknown): MealType {
  return MEAL_TYPES.includes(raw as MealType) ? (raw as MealType) : "snack";
}

export function normalizeLog(raw: any): NutritionLogRow {
  return {
    id: String(raw?.id ?? ""),
    date: String(raw?.date ?? ""),
    mealType: asMealType(raw?.mealType),
    foodName: String(raw?.foodName ?? "Món ăn"),
    calories: num(raw?.calories),
    protein: num(raw?.protein),
    carbs: num(raw?.carbs),
    // `fats` is what the API returns; `fat` is only here for a hand-written row or a future rename.
    fat: num(raw?.fats ?? raw?.fat),
    notes: raw?.notes ?? null,
  };
}

/** The list endpoint returns a bare array, but every other endpoint wraps — accept both. */
export function normalizeLogs(raw: any): NutritionLogRow[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.logs) ? raw.logs : raw?.data;
  return Array.isArray(list) ? list.map(normalizeLog) : [];
}

export function sumTotals(logs: NutritionLogRow[]): MacroTotals {
  return logs.reduce<MacroTotals>(
    (total, log) => ({
      calories: total.calories + log.calories,
      protein: total.protein + log.protein,
      carbs: total.carbs + log.carbs,
      fat: total.fat + log.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function groupByMeal(logs: NutritionLogRow[]): Record<MealType, NutritionLogRow[]> {
  const groups: Record<MealType, NutritionLogRow[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };
  for (const log of logs) groups[log.mealType].push(log);
  return groups;
}

export type ScaledFood = { calories: number; protein: number; carbs: number; fats: number };

/** A catalog food's macros at `grams`, rounded the way web rounds them. */
export function scaleFood(food: any, grams: number): ScaledFood {
  const scale = num(grams) / 100;
  const one = (value: unknown) => Math.round(num(value) * scale * 10) / 10;
  return {
    calories: Math.round(num(food?.calories) * scale),
    protein: one(food?.protein),
    carbs: one(food?.carbs),
    fats: one(food?.fats ?? food?.fat),
  };
}

export function isValidQuantity(grams: number): boolean {
  return Number.isFinite(grams) && grams >= MIN_GRAMS && grams <= MAX_GRAMS;
}

/**
 * The body for `POST /nutrition`. Zero macros are left out entirely: the endpoint's schema demands
 * a positive number, so sending `protein: 0` fails the whole save with a 400 — and a food with no
 * protein is a fact about the food, not an error the user should have to resolve.
 */
export function buildLogPayload(input: {
  mealType: MealType;
  foodName: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  notes?: string;
  date?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    mealType: input.mealType,
    foodName: input.foodName.trim(),
    calories: Math.max(1, Math.round(num(input.calories))),
  };
  if (num(input.protein) > 0) payload.protein = num(input.protein);
  if (num(input.carbs) > 0) payload.carbs = num(input.carbs);
  if (num(input.fats) > 0) payload.fats = num(input.fats);
  if (input.notes?.trim()) payload.notes = input.notes.trim();
  if (input.date) payload.date = input.date;
  return payload;
}

export type MacroCheck = {
  statedCalories: number;
  computedCalories: number;
  discrepancyKcal: number;
  consistent: boolean;
};

/** The client-side twin of the backend's goal validator, constants and tolerance included. */
export function macroConsistency(
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
  toleranceKcal: number = MACRO_CALORIE_TOLERANCE_KCAL,
): MacroCheck {
  const computed = num(protein) * ATWATER.protein + num(carbs) * ATWATER.carb + num(fat) * ATWATER.fat;
  const discrepancyKcal = Math.round(computed - num(calories));
  return {
    statedCalories: num(calories),
    computedCalories: Math.round(computed),
    discrepancyKcal,
    consistent: Math.abs(discrepancyKcal) <= toleranceKcal,
  };
}

/** How the day's calories split across macros — the ring's three arcs. */
export function macroCalories(totals: MacroTotals): { protein: number; carbs: number; fat: number } {
  return {
    protein: Math.round(totals.protein * ATWATER.protein),
    carbs: Math.round(totals.carbs * ATWATER.carb),
    fat: Math.round(totals.fat * ATWATER.fat),
  };
}

/** Never above 1: a day over its target fills the ring, it does not wrap around it. */
export function goalProgress(consumed: number, goal: number): number {
  if (!Number.isFinite(goal) || goal <= 0) return 0;
  return Math.min(1, Math.max(0, consumed / goal));
}
