import { prisma } from "../repositories/prisma";
import { fetchUserProfile } from "../clients/user.client";
import { findFoodSubstitute, type SubstituteMode } from "./nutrition-food-substitution.engine";
import { dietaryPreferenceToVegetarianMode, type BudgetLevel } from "./nutrition-food-suggestion.engine";
import { isVietnameseRegion } from "../config/vietnamese-region-food.config";
import { normalizeVietnamese } from "../utils/normalizeVietnamese";
import { nutritionService } from "./nutrition.service";

/**
 * AI Coach nutrition actions (2026-09-07, docs/agentic-fitness/
 * 01_NUTRITION_AGENT_TOOLS_PLAN.md) — the concrete example: "tôi muốn ăn cá
 * hồi thay ức gà vào buổi nào đó". Resolves a spoken food name against the
 * user's ACTIVE NutritionProgram (never guesses which food catalog entry
 * the user meant against the whole 13k-row catalog — only against food
 * names actually present in their own current plan), then reuses
 * nutrition-food-substitution.engine.ts's calorie-equivalent math and
 * nutrition.service.ts's updateMealItem (now rollup-safe, see
 * recomputeMealAndDayTotals) to persist the swap.
 *
 * Deliberately does NOT go through the prepare()/confirm()/execute() agent-
 * action flow ai-service's fitness-agent.service.ts uses for PT/program
 * actions — confirmed with the product owner: this is LOW risk (free,
 * reversible, nutrient-equivalent by construction, never touches the
 * calorie/macro TARGET, only which food fills it), so it applies directly
 * in one turn. Ambiguity (which meal, which item) is never silently
 * guessed — always returns a disambiguation response instead (product
 * owner's explicit choice), which the caller must resolve into a second,
 * narrower call rather than this function picking for them.
 */

export type SubstituteMealItemInput = {
  currentFoodMention: string;
  desiredFoodMention?: string | null;
  mode?: SubstituteMode;
  /** Optional narrowing hint ("bữa trưa", "ngày 2") — filters candidate
   * meals BEFORE the ambiguity check, but never bypasses it: if more than
   * one meal still matches after filtering, still asks. */
  mealHint?: string | null;
  /** Set on the SECOND call, after the caller resolved an AMBIGUOUS
   * response by picking one of its `candidates[].mealId` — skips
   * resolution entirely and targets that exact meal. */
  resolvedMealId?: string | null;
};

const MEAL_TYPE_LABEL_VI: Record<string, string> = {
  BREAKFAST: "Bữa sáng",
  LUNCH: "Bữa trưa",
  DINNER: "Bữa tối",
  SNACK: "Bữa phụ",
};

function mealLabel(dayNumber: number, mealType: string): string {
  return `${MEAL_TYPE_LABEL_VI[mealType] ?? mealType} — Ngày ${dayNumber}`;
}

type ItemMatch = { item: any; meal: any; day: any };

export const nutritionAgentService = {
  async substituteMealItem(userId: string, input: SubstituteMealItemInput) {
    const mention = input.currentFoodMention?.trim();
    if (!mention) return { status: "INVALID_INPUT" as const, message: "Thiếu tên món ăn cần đổi." };
    const mode: SubstituteMode = input.mode ?? "REPLACE";

    const program = await prisma.nutritionProgram.findFirst({
      where: { userId, status: "ACTIVE" },
      include: { days: { include: { meals: { include: { items: { include: { food: true } } } } } } },
    });
    if (!program) {
      return { status: "NO_ACTIVE_PROGRAM" as const, message: "Bạn chưa có thực đơn nào đang áp dụng để đổi món." };
    }

    let matches: ItemMatch[];
    if (input.resolvedMealId) {
      matches = [];
      for (const day of program.days) {
        for (const meal of day.meals) {
          if (meal.id !== input.resolvedMealId) continue;
          for (const item of meal.items) {
            const name = normalizeVietnamese(item.customFoodName || item.food?.name || "");
            const normalizedMention = normalizeVietnamese(mention);
            if (name.includes(normalizedMention) || normalizedMention.includes(name)) matches.push({ item, meal, day });
          }
        }
      }
    } else {
      const normalizedMention = normalizeVietnamese(mention);
      matches = [];
      for (const day of program.days) {
        for (const meal of day.meals) {
          for (const item of meal.items) {
            const name = normalizeVietnamese(item.customFoodName || item.food?.name || "");
            if (name.includes(normalizedMention) || normalizedMention.includes(name)) matches.push({ item, meal, day });
          }
        }
      }
      if (input.mealHint?.trim()) {
        const hint = normalizeVietnamese(input.mealHint);
        const narrowed = matches.filter((m) => normalizeVietnamese(mealLabel(m.day.dayNumber, m.meal.mealType)).includes(hint));
        if (narrowed.length > 0) matches = narrowed; // only narrow if the hint actually matched something — never discard all candidates on a hint typo
      }
    }

    if (matches.length === 0) {
      return { status: "NOT_FOUND" as const, message: `Không tìm thấy món "${mention}" trong thực đơn hiện tại của bạn.` };
    }

    // Exclude meals already locked by a COMPLETED/PARTIAL completion — same
    // rule nutrition.service.ts's updateMealItem itself enforces; keeping
    // candidates consistent with what's actually editable avoids offering
    // a choice that would then 409 on the follow-up call.
    const mealIds = [...new Set(matches.map((m) => m.meal.id))];
    const lockedMealIds = new Set(
      (
        await prisma.nutritionMealCompletion.findMany({
          where: { userId, mealId: { in: mealIds }, status: { in: ["COMPLETED", "PARTIAL"] } },
          select: { mealId: true },
        })
      ).map((c: any) => c.mealId),
    );
    matches = matches.filter((m) => !lockedMealIds.has(m.meal.id));
    if (matches.length === 0) {
      return {
        status: "LOCKED" as const,
        message: `Tìm thấy "${mention}" nhưng bữa ăn đó đã được đánh dấu hoàn thành, không thể chỉnh sửa nữa.`,
      };
    }

    const byMeal = new Map<string, ItemMatch[]>();
    for (const m of matches) {
      const arr = byMeal.get(m.meal.id) ?? [];
      arr.push(m);
      byMeal.set(m.meal.id, arr);
    }

    if (byMeal.size > 1) {
      const candidates = [...byMeal.entries()].map(([mealId, ms]) => ({
        mealId,
        label: mealLabel(ms[0].day.dayNumber, ms[0].meal.mealType),
        itemName: ms[0].item.customFoodName || ms[0].item.food?.name,
      }));
      return {
        status: "AMBIGUOUS_MEAL" as const,
        message: `Có ${candidates.length} bữa trong thực đơn có món "${mention}". Bạn muốn đổi ở bữa nào?`,
        candidates,
      };
    }

    const mealMatches = [...byMeal.values()][0];
    if (mealMatches.length > 1) {
      return {
        status: "AMBIGUOUS_ITEM" as const,
        message: `Bữa này có nhiều món khớp với "${mention}". Bạn muốn đổi món nào?`,
        candidates: mealMatches.map((m) => ({
          itemId: m.item.id,
          itemName: m.item.customFoodName || m.item.food?.name,
          quantity: m.item.quantity,
        })),
      };
    }

    const { item, meal, day } = mealMatches[0];
    const profile = await fetchUserProfile(userId);
    const budgetLevel = (
      ["LOW", "NORMAL", "FLEXIBLE"].includes((profile?.nutritionBudgetLevel ?? "").toUpperCase())
        ? (profile!.nutritionBudgetLevel as string).toUpperCase()
        : "NORMAL"
    ) as BudgetLevel;
    const region = isVietnameseRegion(profile?.region) ? profile!.region : null;
    const vegetarianMode = dietaryPreferenceToVegetarianMode(profile?.dietaryPreference);
    const originalName = item.customFoodName || item.food?.name || mention;

    const substitution = await findFoodSubstitute({
      currentFoodId: item.foodId ?? null,
      currentFoodName: originalName,
      currentQuantityG: item.quantity,
      currentCalories: item.calories ?? 0,
      currentProtein: item.proteinGrams ?? 0,
      mode,
      budgetLevel,
      region,
      vegetarianMode,
      desiredFoodName: input.desiredFoodMention ?? null,
    });
    if (substitution.candidates.length === 0) {
      return { status: "NO_CANDIDATE" as const, message: substitution.note };
    }
    const chosen = substitution.candidates[0];

    await nutritionService.updateMealItem(item.id, userId, {
      foodId: chosen.foodId,
      customFoodName: null,
      quantity: chosen.quantityG,
      unit: "g",
      calories: chosen.calories,
      protein: chosen.protein,
      carbs: chosen.carbs,
      fat: chosen.fat,
    });

    return {
      status: "APPLIED" as const,
      message: `Đã đổi "${originalName}" thành "${chosen.foodName}" (${chosen.quantityG}g, ${chosen.calories} kcal) trong ${mealLabel(day.dayNumber, meal.mealType)}. ${substitution.note}`,
      itemId: item.id,
      mealId: meal.id,
      previousFoodName: originalName,
      newFood: chosen,
    };
  },
};
