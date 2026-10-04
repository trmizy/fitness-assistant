import type { MacroTotals, MealType, NutritionLogRow } from "./nutritionMath";

/**
 * 14B.3 (PG-A4, PG-C4) — the rules web's `NutritionPage` applies to today's meal plan, the day's
 * feedback lines and the 7-day chart. The server owns the plan (`NutritionProgram`, derived from the
 * `NutritionGoal`) and decides what a completion writes; this only chooses what to show and builds
 * the bodies web sends.
 */

export type MealStatus = "PENDING" | "COMPLETED" | "PARTIAL" | "SKIPPED";

export interface PlanMealItem {
  id: string;
  sourceType: "PLAN_ITEM" | "LOG_ITEM" | string;
  programMealItemId: string | null;
  logItemId: string | null;
  foodName: string;
  quantity: number | null;
  unit: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** The catalog food per 100 g, when the item came from the catalog. */
  per100g: { calories: number; protein: number; carbs: number; fat: number } | null;
}

export interface PlanMeal {
  id: string;
  mealType: string;
  title: string | null;
  items: PlanMealItem[];
  completion: { status: MealStatus; percentConsumed?: number | null } | null;
}

const PLAN_MEAL_TYPE: Record<MealType, string> = { breakfast: "BREAKFAST", lunch: "LUNCH", dinner: "DINNER", snack: "SNACK" };

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Web shows plan meals only when the program covers this date (a day exists, not out of range). */
export function planIsActiveForDate(dailyTask: any): boolean {
  return !!dailyTask?.hasProgram && !!dailyTask?.day && !dailyTask?.outOfRange;
}

function normalizeItem(raw: any): PlanMealItem {
  return {
    id: String(raw?.programMealItemId ?? raw?.logItemId ?? raw?.id ?? ""),
    sourceType: raw?.sourceType ?? "PLAN_ITEM",
    programMealItemId: raw?.programMealItemId ?? null,
    logItemId: raw?.logItemId ?? null,
    foodName: String(raw?.foodName ?? raw?.customFoodName ?? raw?.food?.name ?? "Món ăn"),
    quantity: raw?.quantity != null ? n(raw.quantity) : null,
    unit: raw?.unit ?? null,
    calories: n(raw?.calories),
    protein: n(raw?.proteinGrams ?? raw?.protein),
    carbs: n(raw?.carbGrams ?? raw?.carbs),
    fat: n(raw?.fatGrams ?? raw?.fat ?? raw?.fats),
    per100g: raw?.food && raw.food.calories != null
      ? { calories: n(raw.food.calories), protein: n(raw.food.protein), carbs: n(raw.food.carbs), fat: n(raw.food.fats ?? raw.food.fat) }
      : null,
  };
}

/**
 * The patch for a new quantity. The server only updates the fields it is sent, and web sends the
 * quantity alone — so on web the calories and macros stay at the old amount. Here they are rescaled:
 * from the catalog's per-100 g values when known, otherwise in proportion to the item's current ones.
 */
export function scaledItemPatch(item: PlanMealItem, grams: number) {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  if (item.per100g) {
    const f = grams / 100;
    return {
      quantity: grams,
      calories: Math.round(item.per100g.calories * f),
      protein: r1(item.per100g.protein * f),
      carbs: r1(item.per100g.carbs * f),
      fat: r1(item.per100g.fat * f),
    };
  }
  if (item.quantity && item.quantity > 0) {
    const f = grams / item.quantity;
    return { quantity: grams, calories: Math.round(item.calories * f), protein: r1(item.protein * f), carbs: r1(item.carbs * f), fat: r1(item.fat * f) };
  }
  return { quantity: grams };
}

/** The plan meal for a meal type (server items already include that meal's logged foods). */
export function planMealFor(dailyTask: any, meal: MealType): PlanMeal | null {
  if (!planIsActiveForDate(dailyTask) || !Array.isArray(dailyTask?.meals)) return null;
  const raw = dailyTask.meals.find((m: any) => String(m?.mealType ?? "").toUpperCase() === PLAN_MEAL_TYPE[meal]);
  if (!raw?.id) return null;
  return {
    id: String(raw.id),
    mealType: String(raw.mealType),
    title: raw.title ?? null,
    items: Array.isArray(raw.items) ? raw.items.map(normalizeItem) : [],
    completion: raw.completion?.status ? { status: raw.completion.status, percentConsumed: raw.completion.percentConsumed ?? null } : null,
  };
}

export function mealTotals(items: { calories: number; protein: number; carbs: number; fat: number }[]): MacroTotals {
  return items.reduce<MacroTotals>(
    (t, i) => ({ calories: t.calories + i.calories, protein: t.protein + i.protein, carbs: t.carbs + i.carbs, fat: t.fat + i.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function mealStatusOf(meal: PlanMeal | null): MealStatus {
  return meal?.completion?.status ?? "PENDING";
}

/** A meal with real eaten data (COMPLETED / PARTIAL) can neither be deleted nor edited — web's rule. */
export function mealLocked(status: MealStatus): boolean {
  return status === "COMPLETED" || status === "PARTIAL";
}

export function canDeletePlanMeal(status: MealStatus): boolean {
  return !mealLocked(status);
}

export interface PartialPreview {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** "Theo phần trăm": what X% of the planned meal amounts to (web's preview). */
export function partialPreview(planned: MacroTotals, pct: number): PartialPreview {
  const p = Math.max(1, pct || 50);
  const r1 = (v: number) => Math.round(((v * p) / 100) * 10) / 10;
  return { calories: Math.round((planned.calories * p) / 100), protein: r1(planned.protein), carbs: r1(planned.carbs), fat: r1(planned.fat) };
}

export type CompletionBody = {
  status: "COMPLETED" | "PARTIAL";
  pct: number;
  overrideCalories?: number;
  overrideProtein?: number;
  overrideCarbs?: number;
  overrideFat?: number;
};

/** Percent mode: exactly 100 is a full completion, anything else is partial (web). */
export function percentCompletion(pctInput: string): CompletionBody {
  const pct = Math.max(1, parseFloat(pctInput.replace(",", ".")) || 50);
  return { status: pct === 100 ? "COMPLETED" : "PARTIAL", pct };
}

/**
 * Amount mode: the calories actually eaten (required) plus optional macros. The percent sent along is
 * eaten ÷ planned; 100% or more counts as completed (web). Null when calories are missing.
 */
export function amountCompletion(
  plannedCalories: number,
  input: { calories: string; protein: string; carbs: string; fat: string },
): CompletionBody | null {
  const v = (s: string) => parseFloat(s.replace(",", ".")) || 0;
  const cal = v(input.calories);
  if (!cal) return null;
  const pct = plannedCalories > 0 ? Math.round((cal / plannedCalories) * 100) : 0;
  return {
    status: pct >= 100 ? "COMPLETED" : "PARTIAL",
    pct,
    overrideCalories: cal,
    overrideProtein: v(input.protein) || undefined,
    overrideCarbs: v(input.carbs) || undefined,
    overrideFat: v(input.fat) || undefined,
  };
}

/** A catalog food added to a plan meal, scaled from per-100 g the way web scales it. */
export function planItemPayload(food: any, grams: number) {
  const f = grams / 100;
  return {
    foodId: String(food.id),
    quantity: grams,
    unit: "g",
    calories: Math.round(n(food.calories) * f),
    protein: Math.round(n(food.protein) * f * 10) / 10,
    carbs: Math.round(n(food.carbs) * f * 10) / 10,
    fat: Math.round(n(food.fats ?? food.fat) * f * 10) / 10,
  };
}

export interface LogEditForm {
  mealType: MealType;
  foodName: string;
  quantity: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  notes: string;
}

export function logEditForm(log: NutritionLogRow & { quantity?: number | null }): LogEditForm {
  return {
    mealType: log.mealType,
    foodName: log.foodName,
    quantity: log.quantity != null ? String(log.quantity) : "",
    calories: String(log.calories),
    protein: String(log.protein),
    carbs: String(log.carbs),
    fat: String(log.fat),
    notes: log.notes ?? "",
  };
}

/** Web's checks and body for `PATCH /nutrition/:id` (internal `fat` → API `fats`). */
export function logEditPayload(form: LogEditForm): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const v = (s: string) => Number(s.replace(",", "."));
  if (!form.foodName.trim()) return { ok: false, error: "Tên thực phẩm không được để trống" };
  const calories = v(form.calories);
  if (!Number.isFinite(calories) || calories < 0 || form.calories.trim() === "") return { ok: false, error: "Calories không hợp lệ" };
  const macros = [form.protein, form.carbs, form.fat].map(v);
  if (macros.some((m) => !Number.isFinite(m) || m < 0)) return { ok: false, error: "Giá trị macro phải >= 0" };
  const quantity = form.quantity.trim() ? v(form.quantity) : undefined;
  return {
    ok: true,
    body: {
      mealType: form.mealType,
      foodName: form.foodName.trim(),
      quantity: quantity != null && Number.isFinite(quantity) ? quantity : undefined,
      unit: "g",
      calories,
      protein: macros[0],
      carbs: macros[1],
      fats: macros[2],
      notes: form.notes.trim() || undefined,
    },
  };
}

export type DayFeedback = { tone: "warning" | "success"; text: string };

/** Web's rule-based day feedback (at most 2 lines), from today's LOGGED totals against the goal. */
export function dayFeedback(goal: { calories: number; protein: number; fat: number } | null | undefined, logged: MacroTotals, hasLogs: boolean): DayFeedback[] {
  if (!goal || !hasLogs || !goal.calories || !goal.protein || !goal.fat) return [];
  const out: DayFeedback[] = [];
  const cal = logged.calories / goal.calories;
  const prot = logged.protein / goal.protein;
  const fat = logged.fat / goal.fat;
  if (cal > 1.1) out.push({ tone: "warning", text: "Bạn đã vượt mục tiêu calories hôm nay, nên cân nhắc giảm khẩu phần ở các bữa còn lại." });
  if (prot < 0.8 && out.length < 2) out.push({ tone: "warning", text: "Protein hôm nay còn thấp, bạn nên bổ sung thêm thực phẩm giàu protein." });
  if (out.length === 0 && cal < 0.8) out.push({ tone: "warning", text: "Bạn còn thiếu năng lượng so với mục tiêu hôm nay." });
  if (out.length < 2 && fat > 1.1) out.push({ tone: "warning", text: "Lượng chất béo hôm nay hơi cao, nên ưu tiên món ít dầu mỡ hơn." });
  if (out.length === 0 && cal >= 0.8 && cal <= 1.1 && prot >= 0.8) out.push({ tone: "success", text: "Dinh dưỡng hôm nay khá ổn so với mục tiêu của bạn." });
  return out;
}

const WEEK_DAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Calories logged on each of the last 7 local days, oldest first (web's chart data). */
export function weeklyCalories(logs: NutritionLogRow[], now = new Date()): { key: string; day: string; calories: number }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { key, day: WEEK_DAYS[d.getDay()], calories: Math.round(logs.filter((l) => l.date.startsWith(key)).reduce((s, l) => s + l.calories, 0)) };
  });
}

/** Field names of `NutritionGoalPlanConsistency.mismatches` in Vietnamese. */
export const MISMATCH_FIELD_LABEL: Record<string, string> = {
  calories: "Calo",
  protein: "Đạm",
  carbs: "Tinh bột",
  fat: "Chất béo",
};
