/**
 * WB-14 — the beginner summary + "Smart Substitute" card, as pure functions.
 *
 * Every number here is the server's: `dailySummary` comes from fitness-service's buildDailySummary
 * (signed remaining* — negative means the target was passed), suggestions and substitutes from its
 * deterministic engines. Nothing is recomputed on the phone; this only turns those numbers into
 * the plain sentences web's `BeginnerNutritionSummary.tsx` shows, word for word.
 */
import type {
  FoodSuggestionItem,
  FoodSuggestionOption,
  NutritionBudgetLevel,
  NutritionDailySummary,
  NutritionRegion,
  SubstituteMode,
} from "../../services/api";

export const SUBSTITUTE_MODES: readonly SubstituteMode[] = ["REPLACE", "CHEAPER", "HIGHER_PROTEIN", "VEGETARIAN"];

export const SUBSTITUTE_MODE_LABEL: Record<SubstituteMode, string> = {
  REPLACE: "Món khác",
  CHEAPER: "Rẻ hơn",
  HIGHER_PROTEIN: "Nhiều đạm hơn",
  VEGETARIAN: "Món chay",
};

export const BUDGET_OPTIONS: readonly { value: NutritionBudgetLevel; label: string; hint: string }[] = [
  { value: "LOW", label: "Tiết kiệm", hint: "Trứng, đậu hũ, gà, heo nạc, cá phổ thông, gạo, khoai" },
  { value: "NORMAL", label: "Bình thường", hint: "Cân bằng giữa chi phí và đa dạng món ăn" },
  { value: "FLEXIBLE", label: "Thoải mái", hint: "Cá hồi, thịt bò, tôm... không giới hạn ngân sách" },
];

export const REGION_OPTIONS: readonly { value: NutritionRegion; label: string; hint: string }[] = [
  { value: "BAC", label: "Miền Bắc", hint: "Đậu hũ, trứng, cá nước ngọt — thanh đạm, ít cay" },
  { value: "TRUNG", label: "Miền Trung", hint: "Hải sản, cay đậm đà — mắm ruốc, mắm nêm" },
  { value: "NAM", label: "Miền Nam", hint: "Cá basa, tôm — vị ngọt, nước dừa" },
];

export function normalizeBudgetLevel(value: unknown): NutritionBudgetLevel {
  return value === "LOW" || value === "FLEXIBLE" ? value : "NORMAL";
}

export function normalizeRegion(value: unknown): NutritionRegion | null {
  return value === "BAC" || value === "TRUNG" || value === "NAM" ? value : null;
}

/**
 * `PUT /profile/me` validates region with `z.enum([...]).optional()` — a `null` is a 400, verified
 * live 2026-09-18. Web sends null when the selected region is tapped again, and that request
 * fails. Until the backend accepts null (GAP-12), a region can be changed but not cleared, so
 * tapping the current one is a no-op instead of a request that is known to fail.
 * Returns the region to send, or null when there is nothing to send.
 */
export function regionToSend(current: NutritionRegion | null, tapped: NutritionRegion): NutritionRegion | null {
  return current === tapped ? null : tapped;
}

function ratio(consumed: number, target: number): number {
  return target > 0 ? Math.min(1, Math.max(0, consumed / target)) : 0;
}

export function summaryProgress(summary: NutritionDailySummary) {
  return {
    calories: ratio(summary.consumedCalories, summary.targetCalories),
    protein: ratio(summary.consumedProtein, summary.targetProtein),
    overCalories: summary.remainingCalories < 0,
    overProtein: summary.remainingProtein < 0,
  };
}

/** Web's sentence under the bars, including its quirk of appending the protein clause either way. */
export function remainingSentence(summary: NutritionDailySummary): string {
  const overCalories = summary.remainingCalories < 0;
  const overProtein = summary.remainingProtein < 0;
  const head = overCalories
    ? "Bạn đã đạt mục tiêu calories hôm nay 🎉"
    : `Bạn còn khoảng ${Math.round(summary.remainingCalories).toLocaleString("vi-VN")} kcal`;
  const tail =
    !overProtein && summary.remainingProtein > 5
      ? ` và thiếu khoảng ${Math.round(summary.remainingProtein)}g protein.`
      : ".";
  return head + tail;
}

/** Suggestions are only offered while there is room left — same gate as web. */
export function canSuggest(summary: NutritionDailySummary): boolean {
  return summary.remainingCalories >= 0;
}

export function itemKey(optionLabel: string, index: number): string {
  return `${optionLabel}::${index}`;
}

/** What the card renders AND what "Thêm bữa này" submits: the server's items with any picks on top. */
export function effectiveItems(
  option: FoodSuggestionOption,
  overrides: Record<string, FoodSuggestionItem>,
): FoodSuggestionItem[] {
  return option.items.map((item, i) => overrides[itemKey(option.label, i)] ?? item);
}

export function itemLine(item: FoodSuggestionItem): { name: string; meta: string } {
  return {
    name: `${Math.round(item.quantityG)}g ${item.foodName}`,
    meta: `${item.calories} kcal · ${Math.round(item.protein)}g đạm`,
  };
}
