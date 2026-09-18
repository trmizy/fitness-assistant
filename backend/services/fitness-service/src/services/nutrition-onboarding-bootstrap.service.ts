import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/prisma";
import { nutritionRepository } from "../repositories/nutrition.repository";
import { trainingCycleService } from "./training-cycle.service";
import { cycleThresholds } from "../config/cycle-thresholds.config";
import {
  computeInitialNutritionPrescription,
  findMissingBootstrapFields,
  type NutritionBootstrapInput,
} from "./nutrition-bootstrap.engine";
import { fetchUserProfile, fetchLatestInBodyOnOrBefore } from "../clients/user.client";
import { queueInitialNutritionPlanSafe } from "../clients/ai.client";
import { createPersistentNotification } from "../clients/notification.client";
import { nutritionBootstrapScreening } from "./nutrition-bootstrap-screening";

/** Indirection point for tests — same pattern as coach.service.ts's
 * coachDeps: a plain named-import binding can't be reassigned from a test
 * (ESM namespace properties are getter-only), so every cross-service call
 * in this file goes through this mutable object instead, letting
 * nutrition-onboarding-bootstrap.integration.test.ts stub a fake profile/
 * InBody/AI-queue response without a real user-service or ai-service
 * running. */
export const nutritionBootstrapDeps = {
  fetchUserProfile,
  fetchLatestInBodyOnOrBefore,
  queueInitialNutritionPlanSafe,
  createPersistentNotification,
};

/**
 * AI Nutrition Cycle Engine (Gymini) — spec §IV/§V/§VI/§XXXIII/§XLI.
 *
 * Triggered once, right after a user finishes onboarding (see
 * user-service's profileService.upsertProfile, which calls
 * POST /internal/onboarding/bootstrap-nutrition on the ONBOARDING
 * false→true transition). Turns "profile + optional InBody" straight into:
 *   1. An ACTIVE TrainingCycle (created here if the user has none yet, so
 *      Nutrition always has a cycle to attach to — spec §VI: nutrition must
 *      never be a standalone concept unlinked from a training cycle).
 *   2. An ACTIVE NutritionGoal (deterministic calorie/protein/carb/fat/water
 *      targets from nutrition-bootstrap.engine.ts), linked to that cycle.
 *   3. A RecommendationAudit row explaining WHY (spec §XXVII/§XXVIII),
 *      reusing the exact audit table the adaptive nutrition engine already
 *      writes to (engineVersion="nutrition-bootstrap-v1").
 *   4. A best-effort, fire-and-forget AI 7-day meal plan (ai-service's
 *      existing generator), auto-saved into a real NutritionProgram once it
 *      completes — never blocks this function, never fails onboarding if
 *      it fails (spec §LI fallback rule: the NutritionGoal from step 2
 *      alone already makes Nutrition fully usable).
 *
 * Idempotency (spec §XLIII/§XLIV): the "no active goal yet" check below is
 * a fast path, not the sole guarantee — the real safety comes from two
 * pre-existing DB-level partial unique indexes this function relies on
 * rather than re-implements: training_cycles_one_active_per_user (so a
 * race can create at most one ACTIVE cycle; the loser gets a 409 and reuses
 * the winner's cycle) and nutrition_goals_user_id_active_unique (so a race
 * can leave at most one ACTIVE goal; a loser's INSERT still lands as an
 * extra SUPERSEDED history row, never a second ACTIVE one). A page refresh
 * calling this twice therefore never produces two visible/active plans.
 */

export type NutritionBootstrapOutcome =
  | { status: "already_initialized"; goalId: string }
  | { status: "insufficient_data"; missingFields: string[] }
  | {
      status: "created";
      goalId: string;
      cycleId: string;
      cycleCreated: boolean;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      mealPlanQueued: boolean;
      professionalReviewRequired: boolean;
      safetyScreeningStatus: string;
    };

const CYCLE_NAME_BY_GOAL: Record<string, string> = {
  WEIGHT_LOSS: "Giai đoạn nền tảng - Giảm mỡ",
  MUSCLE_GAIN: "Giai đoạn nền tảng - Tăng cơ",
  MAINTENANCE: "Giai đoạn duy trì",
  ATHLETIC_PERFORMANCE: "Giai đoạn nền tảng - Hiệu suất",
};

function reasonCodesToVietnamese(codes: string[], goal: string): string {
  const goalLabel =
    goal === "WEIGHT_LOSS"
      ? "giảm mỡ"
      : goal === "MUSCLE_GAIN"
        ? "tăng cơ"
        : goal === "ATHLETIC_PERFORMANCE"
          ? "tăng hiệu suất"
          : "duy trì vóc dáng";
  const lines: string[] = [
    `Gymini đã tính toán mục tiêu dinh dưỡng ban đầu dựa trên hồ sơ của bạn (mục tiêu: ${goalLabel}).`,
  ];
  if (codes.includes("BMR_FROM_INBODY_MEASUREMENT")) {
    lines.push("Năng lượng nền (BMR) lấy trực tiếp từ lần đo InBody gần nhất — chính xác hơn công thức ước tính.");
  } else {
    lines.push("Chưa có dữ liệu InBody nên năng lượng nền (BMR) được ước tính bằng công thức Mifflin-St Jeor.");
  }
  if (codes.includes("MAINTENANCE_ONLY_PENDING_SAFETY_SCREENING_REVIEW")) {
    lines.push("Vì bạn đã báo cáo yếu tố sức khỏe cần lưu ý, Gymini tạm thời đặt mục tiêu ở mức duy trì (không giảm/tăng calo) cho đến khi bạn hoặc chuyên gia xem xét lại.");
  } else if (codes.includes("INITIAL_DEFICIT_FOR_WEIGHT_LOSS_GOAL")) {
    lines.push("Calo mục tiêu thấp hơn mức duy trì một mức vừa phải, an toàn cho chu kỳ đầu tiên — không phải mức cắt giảm cực đoan.");
  } else if (codes.includes("INITIAL_SURPLUS_FOR_MUSCLE_GAIN_GOAL")) {
    lines.push("Calo mục tiêu cao hơn mức duy trì một mức vừa phải để hỗ trợ tăng cơ mà không tăng mỡ quá nhanh.");
  } else {
    lines.push("Calo mục tiêu được đặt bằng mức duy trì.");
  }
  lines.push("Protein được ưu tiên đủ cao để bảo vệ khối cơ trong suốt chu kỳ.");
  lines.push("Đây là mục tiêu cho Chu kỳ 1 (nền tảng) — không phải mục tiêu dài hạn cuối cùng; Gymini sẽ đánh giá lại sau mỗi chu kỳ.");
  return lines.join(" ");
}

async function ensureActiveCycle(
  userId: string,
  goal: string | null,
): Promise<{ cycleId: string; created: boolean }> {
  try {
    const active = await trainingCycleService.getActiveCycle(userId);
    return { cycleId: active.cycle.id, created: false };
  } catch (err: any) {
    if (err?.status !== 404) throw err;
  }
  try {
    const cycle = await trainingCycleService.startCycle(
      userId,
      null,
      undefined,
      cycleThresholds.nutritionBootstrap.defaultCycleDurationDays,
      { name: CYCLE_NAME_BY_GOAL[goal ?? ""] ?? "Giai đoạn nền tảng" },
    );
    return { cycleId: cycle.id, created: true };
  } catch (err: any) {
    if (err?.status === 409) {
      // Another concurrent bootstrap call won the race — reuse its cycle
      // rather than erroring (spec §XLIV concurrency requirement).
      const active = await trainingCycleService.getActiveCycle(userId);
      return { cycleId: active.cycle.id, created: false };
    }
    throw err;
  }
}

export async function bootstrapNutritionForUser(
  userId: string,
): Promise<NutritionBootstrapOutcome> {
  const existingGoal = await nutritionRepository.findGoalByUserId(userId);
  if (existingGoal) {
    return { status: "already_initialized", goalId: existingGoal.id };
  }

  const profile = await nutritionBootstrapDeps.fetchUserProfile(userId);
  const screening = nutritionBootstrapScreening(profile);
  const candidateInput: Partial<Record<keyof NutritionBootstrapInput, unknown>> = {
    weightKg: profile?.currentWeight ?? profile?.startingWeight ?? null,
    heightCm: profile?.heightCm ?? null,
    age: profile?.age ?? null,
    gender: profile?.gender ?? null,
    goal: profile?.goal ?? null,
    activityLevel: profile?.activityLevel ?? null,
  };
  const missingFields = findMissingBootstrapFields(candidateInput);
  if (missingFields.length > 0) {
    logger.info(
      { userId, missingFields },
      "[nutrition-bootstrap] insufficient profile data — skipping initial plan generation",
    );
    return { status: "insufficient_data", missingFields };
  }

  const latestInBody = await nutritionBootstrapDeps.fetchLatestInBodyOnOrBefore(userId, new Date());

  const input: NutritionBootstrapInput = {
    weightKg: candidateInput.weightKg as number,
    heightCm: candidateInput.heightCm as number,
    age: candidateInput.age as number,
    gender: candidateInput.gender as NutritionBootstrapInput["gender"],
    goal: candidateInput.goal as NutritionBootstrapInput["goal"],
    activityLevel: candidateInput.activityLevel as NutritionBootstrapInput["activityLevel"],
    experienceLevel: (profile?.experienceLevel as NutritionBootstrapInput["experienceLevel"]) ?? null,
    measuredBmr: latestInBody?.bmr ?? null,
    // Safety hardening (Phase 2, §I.4): a flagged user gets a maintenance-
    // level target, never the full deficit/surplus, until a human reviews
    // it — see nutrition-bootstrap.engine.ts's useMaintenanceOnly doc
    // comment for why this is a real numeric change, not just a warning
    // string attached to the same aggressive number.
    useMaintenanceOnly: screening.professionalReviewRequired,
  };

  const prescription = computeInitialNutritionPrescription(input);

  const { cycleId, created: cycleCreated } = await ensureActiveCycle(userId, input.goal);

  // Race check: if a concurrent bootstrap call already created a goal while
  // we were computing/fetching the cycle above, don't create a second one.
  const raceCheckGoal = await nutritionRepository.findGoalByUserId(userId);
  if (raceCheckGoal) {
    return { status: "already_initialized", goalId: raceCheckGoal.id };
  }

  const goal = await nutritionRepository.upsertGoal(
    userId,
    {
      calories: prescription.targetCalories,
      protein: prescription.proteinGrams,
      carbs: prescription.carbGrams,
      fat: prescription.fatGrams,
      waterMl: prescription.waterMl,
      goalMode: "RECOMMENDED",
    },
    {
      // The consultation sentence is already produced by
      // reasonCodesToVietnamese via prescription.reasonCodes'
      // MAINTENANCE_ONLY_PENDING_SAFETY_SCREENING_REVIEW code (set above,
      // input.useMaintenanceOnly) — no separate suffix needed here, which
      // would otherwise say it twice.
      reason: reasonCodesToVietnamese(prescription.reasonCodes, input.goal),
      triggeredBy: "ONBOARDING",
      trainingCycleId: cycleId,
    },
  );

  try {
    await prisma.recommendationAudit.create({
      data: {
        userId,
        cycleId,
        engineVersion: "nutrition-bootstrap-v1",
        decision: "INITIAL_PLAN_CREATED",
        reasonCodes: [
          ...prescription.reasonCodes,
          ...(screening.professionalReviewRequired ? ["SAFETY_SCREENING_PROFESSIONAL_REVIEW_REQUIRED"] : []),
        ],
        metricsSnapshot: {
          input,
          ...screening,
          bmr: prescription.bmr,
          bmrFormula: prescription.bmrFormula,
          maintenanceCalories: prescription.maintenanceCalories,
          deficitOrSurplusKcal: prescription.deficitOrSurplusKcal,
          evidenceIds: prescription.evidenceIds,
        } as any,
        aiSummary: goal.reason ?? null,
      },
    });
  } catch (err) {
    // Audit-write failure must never block the (already-persisted) goal
    // from being usable — same tolerance as every other RecommendationAudit
    // write in this codebase (see coach.service.ts, training-cycle.service.ts).
    logger.warn({ err: (err as Error).message, userId }, "[nutrition-bootstrap] audit write failed");
  }

  // Best-effort async 7-day AI meal plan — never blocks/fails the response
  // above; the deterministic NutritionGoal already makes Nutrition usable.
  let mealPlanQueued = false;
  try {
    const queued = await nutritionBootstrapDeps.queueInitialNutritionPlanSafe(userId, {
      goal: input.goal,
      durationWeeks: 1,
      mealsPerDay: 3,
      dailyCaloriesTarget: prescription.targetCalories,
      proteinTargetG: prescription.proteinGrams,
      carbTargetG: prescription.carbGrams,
      fatTargetG: prescription.fatGrams,
      budgetLevel: profile?.nutritionBudgetLevel ?? undefined,
      weightKg: input.weightKg,
      heightCm: input.heightCm,
      age: input.age,
      gender: input.gender,
      activityLevel: input.activityLevel,
      experienceLevel: input.experienceLevel ?? undefined,
      bodyFatPct: latestInBody?.bodyFatPct ?? undefined,
    });
    mealPlanQueued = queued != null;
  } catch (err) {
    logger.warn({ err: (err as Error).message, userId }, "[nutrition-bootstrap] meal plan queue failed");
  }

  await nutritionBootstrapDeps.createPersistentNotification({
    userId,
    text: "Gymini đã chuẩn bị mục tiêu dinh dưỡng đầu tiên cho bạn. Xem ngay trong mục Dinh dưỡng.",
    eventType: "NUTRITION_PLAN_READY",
    entityId: goal.id,
    link: "/client/nutrition",
  });

  return {
    status: "created",
    ...screening,
    goalId: goal.id,
    cycleId,
    cycleCreated,
    calories: prescription.targetCalories,
    protein: prescription.proteinGrams,
    carbs: prescription.carbGrams,
    fat: prescription.fatGrams,
    mealPlanQueued,
  };
}
