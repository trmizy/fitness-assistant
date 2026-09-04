/**
 * Detects when a user's active NutritionProgram (the actual meal plan) has
 * drifted from their active NutritionGoal (the macro target) — real gap
 * found in docs/audit/nutrition-ai-current-flow-audit.md (câu 6):
 * NutritionGoal (versioned ACTIVE/SUPERSEDED, nutrition.repository.ts) and
 * NutritionProgram (versioned ACTIVE/ARCHIVED, nutrition.service.ts) are
 * two completely independent code paths with zero synchronization. If a
 * user changes their goal without regenerating their plan, the old plan
 * stays ACTIVE with the old macros and nothing tells the user it's stale.
 *
 * Deliberately does NOT auto-archive/auto-regenerate anything — this is a
 * read-only detector. The caller (controller/UI) decides what to do with
 * the result.
 *
 * The comparison uses NutritionProgram's OWN embedded target fields
 * (dailyCaloriesTarget/proteinTargetGrams/carbTargetGrams/fatTargetGrams)
 * against the currently-ACTIVE NutritionGoal — not a separate snapshot
 * table — so this works identically for brand-new programs AND legacy
 * programs created before NutritionProgram.sourceGoalId existed (per the
 * spec's own explicit fallback requirement: "Existing program thiếu field
 * vẫn phải hoạt động, dùng macro compare fallback").
 */
import { nutritionRepository } from "../repositories/nutrition.repository";

export type GoalPlanConsistencyStatus =
  | "NO_ACTIVE_GOAL"
  | "NO_ACTIVE_PROGRAM"
  | "MATCHED"
  | "STALE_GOAL_CHANGED"
  | "MACRO_MISMATCH"
  | "LOW_CONFIDENCE";

export interface MacroFieldMismatch {
  field: "calories" | "protein" | "carbs" | "fat";
  planValue: number;
  goalValue: number;
  diff: number;
  toleranceUsed: number;
  exceedsTolerance: boolean;
}

export interface GoalPlanConsistencyResult {
  status: GoalPlanConsistencyStatus;
  activeGoal: {
    id: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    goalMode: string;
    validFrom?: Date;
  } | null;
  activeProgram: {
    id: string;
    name: string;
    dailyCaloriesTarget: number | null;
    proteinTargetGrams: number | null;
    carbTargetGrams: number | null;
    fatTargetGrams: number | null;
    sourceGoalId: string | null;
    createdAt: Date;
  } | null;
  mismatches: MacroFieldMismatch[];
  recommendedAction: string;
}

// "kcal lệch quá 5% hoặc quá 100 kcal, lấy ngưỡng nào lớn hơn" — the LARGER
// of the two computed thresholds is used as the actual tolerance (more
// lenient on high-calorie targets where 5% is a bigger absolute number,
// while the fixed floor still protects low-calorie targets from being
// over-sensitive). Same interpretation applied to protein/carb/fat below.
function toleranceFor(goalValue: number, pct: number, floor: number): number {
  return Math.max(goalValue * pct, floor);
}

function compareMacroField(
  field: MacroFieldMismatch["field"],
  planValue: number | null,
  goalValue: number,
  pct: number,
  floor: number,
): MacroFieldMismatch | null {
  if (planValue === null) return null;
  const diff = Math.abs(planValue - goalValue);
  const toleranceUsed = toleranceFor(goalValue, pct, floor);
  const exceedsTolerance = diff > toleranceUsed;
  if (!exceedsTolerance) return null;
  return { field, planValue, goalValue, diff: Math.round(diff * 10) / 10, toleranceUsed: Math.round(toleranceUsed * 10) / 10, exceedsTolerance };
}

function recommendedActionFor(
  status: GoalPlanConsistencyStatus,
  mismatches: MacroFieldMismatch[],
): string {
  switch (status) {
    case "NO_ACTIVE_GOAL":
      return "Bạn chưa có mục tiêu dinh dưỡng nào đang hoạt động — hãy tạo một mục tiêu trước.";
    case "NO_ACTIVE_PROGRAM":
      return "Bạn chưa có thực đơn nào đang áp dụng — hãy tạo hoặc nhập một thực đơn.";
    case "MACRO_MISMATCH": {
      const fields = mismatches.map((m) => m.field).join(", ");
      return `Thực đơn hiện tại không còn khớp mục tiêu dinh dưỡng (lệch ở: ${fields}). Bạn có thể tạo lại thực đơn theo mục tiêu mới, hoặc tiếp tục dùng thực đơn hiện tại.`;
    }
    case "STALE_GOAL_CHANGED":
      return "Mục tiêu dinh dưỡng đã đổi kể từ khi thực đơn này được tạo. Số liệu hiện vẫn khớp, nhưng bạn nên kiểm tra lại để chắc chắn.";
    case "LOW_CONFIDENCE":
      return "Thực đơn hiện tại thiếu thông tin mục tiêu calo/macro để so sánh chính xác — không thể xác nhận có khớp mục tiêu hay không.";
    case "MATCHED":
    default:
      return "Thực đơn hiện tại khớp với mục tiêu dinh dưỡng đang áp dụng.";
  }
}

export const nutritionGoalPlanConsistencyService = {
  async compute(userId: string): Promise<GoalPlanConsistencyResult> {
    const { prisma } = await import("../repositories/prisma");

    const [goalRow, programRow] = await Promise.all([
      nutritionRepository.findGoalByUserId(userId),
      prisma.nutritionProgram.findFirst({
        where: { userId, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const activeGoal = goalRow
      ? {
          id: goalRow.id,
          calories: goalRow.calories,
          protein: goalRow.protein,
          carbs: goalRow.carbs,
          fat: goalRow.fat,
          goalMode: goalRow.goalMode ?? "RECOMMENDED",
          validFrom: goalRow.validFrom,
        }
      : null;

    const activeProgram = programRow
      ? {
          id: programRow.id,
          name: programRow.name,
          dailyCaloriesTarget: programRow.dailyCaloriesTarget,
          proteinTargetGrams: programRow.proteinTargetGrams,
          carbTargetGrams: programRow.carbTargetGrams,
          fatTargetGrams: programRow.fatTargetGrams,
          sourceGoalId: programRow.sourceGoalId,
          createdAt: programRow.createdAt,
        }
      : null;

    if (!activeGoal) {
      return {
        status: "NO_ACTIVE_GOAL",
        activeGoal: null,
        activeProgram,
        mismatches: [],
        recommendedAction: recommendedActionFor("NO_ACTIVE_GOAL", []),
      };
    }

    if (!activeProgram) {
      return {
        status: "NO_ACTIVE_PROGRAM",
        activeGoal,
        activeProgram: null,
        mismatches: [],
        recommendedAction: recommendedActionFor("NO_ACTIVE_PROGRAM", []),
      };
    }

    const hasAnyTarget =
      activeProgram.dailyCaloriesTarget !== null ||
      activeProgram.proteinTargetGrams !== null ||
      activeProgram.carbTargetGrams !== null ||
      activeProgram.fatTargetGrams !== null;
    if (!hasAnyTarget) {
      return {
        status: "LOW_CONFIDENCE",
        activeGoal,
        activeProgram,
        mismatches: [],
        recommendedAction: recommendedActionFor("LOW_CONFIDENCE", []),
      };
    }

    const mismatches: MacroFieldMismatch[] = [];
    const caloriesMismatch = compareMacroField(
      "calories",
      activeProgram.dailyCaloriesTarget,
      activeGoal.calories,
      0.05,
      100,
    );
    if (caloriesMismatch) mismatches.push(caloriesMismatch);
    const proteinMismatch = compareMacroField(
      "protein",
      activeProgram.proteinTargetGrams,
      activeGoal.protein,
      0.1,
      10,
    );
    if (proteinMismatch) mismatches.push(proteinMismatch);
    const carbsMismatch = compareMacroField(
      "carbs",
      activeProgram.carbTargetGrams,
      activeGoal.carbs,
      0.1,
      10,
    );
    if (carbsMismatch) mismatches.push(carbsMismatch);
    const fatMismatch = compareMacroField(
      "fat",
      activeProgram.fatTargetGrams,
      activeGoal.fat,
      0.1,
      5,
    );
    if (fatMismatch) mismatches.push(fatMismatch);

    if (mismatches.length > 0) {
      return {
        status: "MACRO_MISMATCH",
        activeGoal,
        activeProgram,
        mismatches,
        recommendedAction: recommendedActionFor("MACRO_MISMATCH", mismatches),
      };
    }

    // Numbers are within tolerance, but if we KNOW (via sourceGoalId) this
    // program was built from a goal version that has since been
    // superseded, still flag it — the association is broken even though
    // the numbers happen to still line up.
    if (activeProgram.sourceGoalId && activeProgram.sourceGoalId !== activeGoal.id) {
      return {
        status: "STALE_GOAL_CHANGED",
        activeGoal,
        activeProgram,
        mismatches: [],
        recommendedAction: recommendedActionFor("STALE_GOAL_CHANGED", []),
      };
    }

    return {
      status: "MATCHED",
      activeGoal,
      activeProgram,
      mismatches: [],
      recommendedAction: recommendedActionFor("MATCHED", []),
    };
  },
};
