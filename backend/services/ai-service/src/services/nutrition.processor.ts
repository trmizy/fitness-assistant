import { Job } from "bullmq";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import axios from "axios";
import { llmService } from "./llm.service";
import {
  conversationRepository,
  PlanStatus,
} from "../repositories/conversation.repository";
import type { NutritionPlanContent } from "../schemas/nutrition-plan.schemas";
import { safeParseJsonCandidate } from "../utils/json";
import { validateNutritionPlanInvariants } from "./nutrition-plan-invariant.service";
import { repairNutritionPlanQuantities } from "./nutrition-plan-repair";
import { filterFoodsByExclusions, findExclusionViolations, isKnownExclusionKey } from "./nutrition-food-constraints";

type AiFood = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat?: number;
  fats?: number;
  // Part 6: real per-food metadata from fitness-service's Food table
  // (migration 20260819000000_add_food_serving_metadata), when available.
  // realisticServingCapG() below prefers this over its own name-keyword
  // guess.
  foodForm?: string | null;
  realisticServingMaxG?: number | null;
};

type NutritionTemplate = {
  meals: Array<{
    mealType: "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
    title: string;
    items: Array<{ foodId?: string; quantity?: number; note?: string }>;
  }>;
  nutritionNotes?: string[];
};

type VietnameseRegion = "BAC" | "TRUNG" | "NAM";

const CUISINE_LABELS: Record<string, string> = {
  VN: "Việt Nam",
  VIETNAM: "Việt Nam",
  JP: "Nhật Bản",
  JAPAN: "Nhật Bản",
  KR: "Hàn Quốc",
  KOREA: "Hàn Quốc",
  TH: "Thái Lan",
  THAILAND: "Thái Lan",
  CN: "Trung Quốc",
  CHINA: "Trung Quốc",
  US: "Mỹ",
  USA: "Mỹ",
  MEDITERRANEAN: "Địa Trung Hải",
  IT: "Ý",
  ITALY: "Ý",
};

const CUISINE_KEYWORDS: Record<string, string[]> = {
  VN: ["rice", "rice noodles", "fish sauce", "shrimp", "pork", "tofu", "catfish", "tilapia", "cucumber", "cilantro", "bean sprouts", "lime"],
  VIETNAM: ["rice", "rice noodles", "fish sauce", "shrimp", "pork", "tofu", "catfish", "tilapia", "cucumber", "cilantro", "bean sprouts", "lime"],
  JP: ["rice", "salmon", "tuna", "tofu", "soy", "miso", "seaweed", "egg", "shrimp"],
  JAPAN: ["rice", "salmon", "tuna", "tofu", "soy", "miso", "seaweed", "egg", "shrimp"],
  KR: ["rice", "beef", "pork", "chicken", "tofu", "cabbage", "spinach", "egg", "soy"],
  KOREA: ["rice", "beef", "pork", "chicken", "tofu", "cabbage", "spinach", "egg", "soy"],
  TH: ["rice", "rice noodles", "shrimp", "fish", "chicken", "lime", "coconut", "peanut"],
  THAILAND: ["rice", "rice noodles", "shrimp", "fish", "chicken", "lime", "coconut", "peanut"],
  CN: ["rice", "noodles", "pork", "chicken", "beef", "tofu", "soy", "bok choy", "egg"],
  CHINA: ["rice", "noodles", "pork", "chicken", "beef", "tofu", "soy", "bok choy", "egg"],
  US: ["chicken", "beef", "turkey", "potato", "bread", "oat", "milk", "yogurt", "cheese", "apple"],
  USA: ["chicken", "beef", "turkey", "potato", "bread", "oat", "milk", "yogurt", "cheese", "apple"],
  MEDITERRANEAN: ["fish", "salmon", "tuna", "yogurt", "cheese", "beans", "chickpea", "lentils", "tomato", "cucumber", "pasta"],
  IT: ["pasta", "tomato", "cheese", "chicken", "fish", "beans", "bread"],
  ITALY: ["pasta", "tomato", "cheese", "chicken", "fish", "beans", "bread"],
};

function normalizeCuisine(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase();
  if (/\b(VN|VIET|VIETNAM|VIET NAM)\b/.test(normalized)) return "VN";
  if (/\b(JP|JAPAN|NHAT|NHAT BAN)\b/.test(normalized)) return "JP";
  if (/\b(KR|KOREA|HAN|HAN QUOC)\b/.test(normalized)) return "KR";
  if (/\b(TH|THAI|THAI LAN|THAILAND)\b/.test(normalized)) return "TH";
  if (/\b(CN|CHINA|TRUNG QUOC|TRUNG)\b/.test(normalized)) return "CN";
  if (/\b(US|USA|AMERICAN|MY)\b/.test(normalized)) return "US";
  if (/\b(MEDITERRANEAN|DIA TRUNG HAI)\b/.test(normalized)) return "MEDITERRANEAN";
  if (/\b(IT|ITALY|Y|ITALIAN)\b/.test(normalized)) return "IT";
  return raw.slice(0, 80);
}

function cuisineLabel(value?: string | null): string | null {
  const key = normalizeCuisine(value);
  if (!key) return null;
  return CUISINE_LABELS[key] ?? key;
}

const VIETNAMESE_REGION_LABELS: Record<VietnameseRegion, string> = {
  BAC: "Miền Bắc",
  TRUNG: "Miền Trung",
  NAM: "Miền Nam",
};

const VIETNAMESE_REGION_PREP_STYLE: Record<VietnameseRegion, string> = {
  BAC: "ưu tiên vị thanh, ít ngọt, món luộc/hấp/canh, nước mắm dùng vừa phải",
  TRUNG: "ưu tiên vị đậm hơn, có thể cay nhẹ, món kho/canh/chế biến gọn",
  NAM: "ưu tiên vị mềm, dễ ăn, có thể hơi ngọt nhẹ, nhiều rau thơm/canh/chua ngọt vừa phải",
};

const VIETNAMESE_REGION_KEYWORDS: Record<VietnameseRegion, string[]> = {
  BAC: ["rice", "fish sauce", "tofu", "egg", "tilapia", "chicken", "lean pork", "greens", "cabbage"],
  TRUNG: ["rice", "fish sauce", "mackerel", "shrimp", "lean pork", "chicken", "egg", "tofu", "chili"],
  NAM: ["rice", "fish sauce", "catfish", "basa", "shrimp", "tofu", "chicken", "pineapple", "cucumber"],
};

function normalizeVietnameseRegion(value?: string | null): VietnameseRegion | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase();
  if (/\b(BAC|MIEN BAC|NORTH|NORTHERN)\b/.test(normalized)) return "BAC";
  if (/\b(TRUNG|MIEN TRUNG|CENTRAL)\b/.test(normalized)) return "TRUNG";
  if (/\b(NAM|MIEN NAM|SOUTH|SOUTHERN)\b/.test(normalized)) return "NAM";
  return null;
}

function shouldApplyVietnameseRegion(cuisineCountry?: string | null): boolean {
  const cuisine = normalizeCuisine(cuisineCountry);
  return !cuisine || cuisine === "VN";
}

function vietnameseRegionPromptLine(region?: string | null, cuisineCountry?: string | null): string {
  const key = shouldApplyVietnameseRegion(cuisineCountry)
    ? normalizeVietnameseRegion(region)
    : null;
  if (!key) return "";
  return `Vùng miền món Việt ưu tiên: ${VIETNAMESE_REGION_LABELS[key]}; gợi ý chế biến: ${VIETNAMESE_REGION_PREP_STYLE[key]}. Đây là định hướng khẩu vị, không được làm lệch calorie/macro và vẫn chỉ dùng foodId thật trong danh sách.`;
}

function prioritizeFoodsForCuisine(foods: AiFood[], cuisineCountry?: string): AiFood[] {
  const key = normalizeCuisine(cuisineCountry);
  const keywords = key ? CUISINE_KEYWORDS[key] : undefined;
  if (!keywords?.length) return foods;
  const score = (food: AiFood) => {
    const name = food.name.toLowerCase();
    return keywords.reduce((total, keyword, index) => total + (name.includes(keyword) ? keywords.length - index : 0), 0);
  };
  return [...foods].sort((a, b) => score(b) - score(a));
}

function prioritizeFoodsForVietnameseRegion(
  foods: AiFood[],
  region?: string | null,
  cuisineCountry?: string | null,
): AiFood[] {
  if (!shouldApplyVietnameseRegion(cuisineCountry)) return foods;
  const key = normalizeVietnameseRegion(region);
  const keywords = key ? VIETNAMESE_REGION_KEYWORDS[key] : undefined;
  if (!keywords?.length) return foods;
  const score = (food: AiFood) => {
    const name = food.name.toLowerCase();
    return keywords.reduce(
      (total, keyword, index) => total + (name.includes(keyword) ? keywords.length - index : 0),
      0,
    );
  };
  return [...foods].sort((a, b) => score(b) - score(a));
}

export function describeVietnameseRegionPreference(
  region?: string | null,
  cuisineCountry?: string | null,
): string | null {
  const key = shouldApplyVietnameseRegion(cuisineCountry)
    ? normalizeVietnameseRegion(region)
    : null;
  return key ? VIETNAMESE_REGION_LABELS[key] : null;
}

const NutritionPlanJobDataSchema = z.object({
  planId: z.string().uuid(),
  userId: z.string().min(1),
  goal: z.string().min(1).max(200),
  durationWeeks: z.number().int().min(1).max(1),
  mealsPerDay: z.number().int().min(1).max(6),
  dailyCaloriesTarget: z.number().int().optional(),
  dietPreference: z.string().optional(),
  budgetLevel: z.string().optional(),
  cuisineCountry: z.string().optional(),
  vietnameseRegion: z.enum(["BAC", "TRUNG", "NAM"]).optional(),
  restrictions: z.array(z.string()).optional(),
  // Canonical, ENFORCED food exclusions (nutrition-food-constraints.ts) —
  // unlike `restrictions` (free text, prompt-only), these filter the food
  // pool itself and are re-checked against the final plan.
  excludedFoodKeys: z.array(z.string()).max(20).optional(),
  // Extended fields
  weightKg: z.number().optional(),
  heightCm: z.number().optional(),
  age: z.number().int().optional(),
  gender: z.string().optional(),
  bodyFatPct: z.number().optional(),
  activityLevel: z.string().optional(),
  trainingDaysPerWeek: z.number().int().optional(),
  trainingDurationMin: z.number().int().optional(),
  trainingType: z.string().optional(),
  trainingPhase: z.string().optional(),
  experienceLevel: z.string().optional(),
  primaryPriority: z.string().optional(),
  weightChangeRateKgPerWeek: z.number().optional(),
  proteinTargetG: z.number().optional(),
  carbTargetG: z.number().optional(),
  fatTargetG: z.number().optional(),
  carbsAroundWorkout: z.boolean().optional(),
  preworkoutMeal: z.boolean().optional(),
  postworkoutMeal: z.boolean().optional(),
  // AI Nutrition Cycle Engine (Gymini) — set only by
  // nutrition-onboarding-bootstrap.service.ts (fitness-service), never by
  // the frontend's manual "Generate Plan" form. When true, the finished
  // plan is pushed straight into a real NutritionProgram the moment this
  // job completes (see the autoSaveCompletedNutritionPlan call below),
  // instead of waiting for the user to review and click "Save" — see spec
  // §IV/§XXXIII: a beginner must never land on an empty Nutrition page
  // after onboarding.
  autoSaveOnComplete: z.boolean().optional(),
});

export async function processNutritionPlanJob(job: Job) {
  // 1. Validate job data
  const dataResult = NutritionPlanJobDataSchema.safeParse(job.data);
  if (!dataResult.success) {
    const reason = `Invalid job data: ${dataResult.error.errors.map((e) => e.message).join("; ")}`;
    logger.error({ jobId: job.id, data: job.data }, reason);
    throw new Error(reason);
  }
  const {
    planId,
    userId,
    goal,
    mealsPerDay,
    dailyCaloriesTarget,
    dietPreference,
    budgetLevel,
    cuisineCountry,
    vietnameseRegion,
    restrictions,
    excludedFoodKeys = [],
    proteinTargetG,
    carbTargetG,
    fatTargetG,
    autoSaveOnComplete,
  } = dataResult.data;

  logger.info(
    { jobId: job.id, planId, userId },
    "Nutrition plan generation job started",
  );

  try {
    // 2. Mark plan as PROCESSING
    await conversationRepository.updateNutritionPlanStatus(
      planId,
      PlanStatus.PROCESSING,
    );

    // 3. Fetch allowed foods from fitness-service
    const fitnessServiceUrl =
      process.env.FITNESS_SERVICE_URL || "http://localhost:3002";
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;

    let allowedFoods: any[] = [];
    try {
      const resp = await axios.get(
        `${fitnessServiceUrl}/internal/foods/for-ai-nutrition`,
        {
          timeout: 10000,
          headers: {
            "x-internal-token": internalSecret,
            "x-user-id": userId,
          },
        },
      );
      if (resp?.data?.success && Array.isArray(resp.data.data?.foods)) {
        allowedFoods = resp.data.data.foods;
      }
    } catch (err: any) {
      logger.warn(
        { err: err.message, jobId: job.id },
        "Could not fetch foods for AI nutrition plan",
      );
      await conversationRepository.updateNutritionPlanFailed(
        planId,
        "Chưa có dữ liệu thực phẩm để tạo kế hoạch dinh dưỡng.",
      );
      return;
    }

    const unknownExclusions = excludedFoodKeys.filter((k) => !isKnownExclusionKey(k));
    if (unknownExclusions.length > 0) {
      await conversationRepository.updateNutritionPlanFailed(
        planId,
        `Không thể đảm bảo loại trừ thực phẩm: ${unknownExclusions.join(", ")}.`,
      );
      return;
    }
    // Enforce exclusions at the SOURCE: every downstream consumer (LLM prompt
    // list, deterministic protein/carb/fat pools, name lookup, invariant
    // allowedFoodIds) sees only permitted foods, so nothing can re-add one.
    allowedFoods = filterFoodsByExclusions(allowedFoods, excludedFoodKeys);

    if (allowedFoods.length === 0) {
      await conversationRepository.updateNutritionPlanFailed(
        planId,
        "Chưa có dữ liệu thực phẩm để tạo kế hoạch dinh dưỡng.",
      );
      return;
    }

    // 3b. Fetch personal user context (InBody, nutrition history) — non-critical
    let resolvedWeightKg: number | undefined;
    let resolvedBodyFatPct: number | undefined;
    let resolvedBmr: number | undefined;
    let profileVietnameseRegion: string | undefined;
    let userContextNote = "";
    try {
      const { fetchWorkerUserContext, formatWorkerContextForPrompt } =
        await import("../workers/worker-user-context");
      const ctx = await fetchWorkerUserContext(userId);
      if (ctx.latestInBody) {
        resolvedWeightKg = ctx.latestInBody.weightKg;
        resolvedBodyFatPct = ctx.latestInBody.bodyFatPct;
        resolvedBmr = ctx.latestInBody.bmr;
      }
      profileVietnameseRegion = ctx.profile?.region;
      userContextNote = formatWorkerContextForPrompt(ctx);
      logger.info(
        {
          planId,
          hasInBody: !!ctx.latestInBody,
          nutritionDays: ctx.recentNutritionDays.length,
        },
        "Fetched user context for nutrition plan generation",
      );
    } catch (err) {
      logger.warn(
        { err, planId },
        "Could not fetch user context for nutrition plan — using provided params only",
      );
    }

    // Merge job params with InBody data (InBody takes priority for physical metrics)
    const effectiveWeightKg = resolvedWeightKg ?? dataResult.data.weightKg;
    const effectiveBodyFatPct =
      resolvedBodyFatPct ?? dataResult.data.bodyFatPct;
    const effectiveVietnameseRegion = vietnameseRegion ?? profileVietnameseRegion;

    allowedFoods = prioritizeFoodsForCuisine(allowedFoods, cuisineCountry);
    allowedFoods = prioritizeFoodsForVietnameseRegion(
      allowedFoods,
      effectiveVietnameseRegion,
      cuisineCountry,
    );

    // 4. Ask the LLM for a compact one-day meal template, then expand it with DB foods.
    // Small local models are unreliable when asked to emit 7 full days of nested JSON.
    const prompt = buildCompactNutritionTemplatePrompt({
      goal,
      mealsPerDay,
      dailyCaloriesTarget,
      dietPreference,
      budgetLevel,
      cuisineCountry,
      vietnameseRegion: effectiveVietnameseRegion,
      restrictions: [
        ...(restrictions ?? []),
        // Inject InBody-derived note as a soft constraint
        ...(userContextNote
          ? [
              `[Dữ liệu cá nhân]\n${userContextNote}${resolvedBmr ? `\nBMR tham khảo: ${resolvedBmr} kcal/ngày` : ""}`,
            ]
          : []),
      ],
      allowedFoods,
      // Pass resolved physical metrics so prompt can calculate accurate macros
      weightKg: effectiveWeightKg,
      bodyFatPct: effectiveBodyFatPct,
    });

    // 5. Call LLM with Retry Logic
    let llmResponse = await llmService.callLLM(prompt, {
      responseFormat: "json",
      numPredict: 1200,
      temperature: 0.1,
      timeoutMs: 180000,
    });
    let templateResult = parseNutritionTemplate(llmResponse.answer);

    if (!templateResult.ok) {
      logger.warn(
        {
          jobId: job.id,
          planId,
          reason: templateResult.reason,
          rawLLMResponse: llmResponse.answer,
        },
        "First LLM nutrition template attempt failed to parse, retrying...",
      );
      const retryPrompt = `${prompt}\n\n[LỖI TRƯỚC ĐÓ]: Câu trả lời trước của bạn bị lỗi định dạng: ${templateResult.reason}.
Hãy sửa lỗi và CHỈ TRẢ VỀ DUY NHẤT 1 OBJECT JSON HỢP LỆ, không giải thích gì thêm, đóng mở ngoặc đầy đủ.`;

      llmResponse = await llmService.callLLM(retryPrompt, {
        responseFormat: "json",
        numPredict: 1200,
        temperature: 0.1,
        timeoutMs: 180000,
      });
      templateResult = parseNutritionTemplate(llmResponse.answer);
    }

    if (!templateResult.ok) {
      logger.error(
        {
          jobId: job.id,
          planId,
          reason: templateResult.reason,
          rawLLMResponse: llmResponse.answer,
        },
        "Failed to parse LLM nutrition template response after retry",
      );
      await conversationRepository.updateNutritionPlanFailed(
        planId,
        "AI chưa trả về đúng định dạng kế hoạch dinh dưỡng. Vui lòng thử lại.",
      );
      return;
    }

    const content = buildNutritionPlanFromTemplate({
      goal,
      mealsPerDay,
      dailyCaloriesTarget,
      template: templateResult.template,
      allowedFoods,
      cuisineCountry,
      vietnameseRegion: effectiveVietnameseRegion,
      proteinTargetG,
      carbTargetG,
      fatTargetG,
    });
    if (content.durationWeeks !== 1 || content.weeklySchedule.length !== 7) {
      logger.error(
        { jobId: job.id, planId, days: content.weeklySchedule.length },
        "Nutrition plan failed duration/day validation",
      );
      await conversationRepository.updateNutritionPlanFailed(
        planId,
        "AI chưa trả về đúng định dạng kế hoạch dinh dưỡng. Vui lòng thử lại.",
      );
      return;
    }

    const allowedFoodIds = new Set(allowedFoods.map((f) => String(f.id)));
    const foodByName = new Map(
      allowedFoods.map((f) => [normalizeFoodName(f.name), f]),
    );
    for (const day of content.weeklySchedule) {
      if (day.meals.length !== mealsPerDay) {
        logger.error(
          {
            jobId: job.id,
            planId,
            dayNumber: day.dayNumber,
            meals: day.meals.length,
          },
          "Nutrition plan failed mealsPerDay validation",
        );
        await conversationRepository.updateNutritionPlanFailed(
          planId,
          "AI chưa trả về đúng định dạng kế hoạch dinh dưỡng. Vui lòng thử lại.",
        );
        return;
      }
      for (const meal of day.meals) {
        for (const item of meal.items) {
          if (item.foodId && allowedFoodIds.has(String(item.foodId))) {
            continue;
          }

          const matchedFood = foodByName.get(normalizeFoodName(item.name));
          if (matchedFood) {
            item.foodId = matchedFood.id;
            item.name = matchedFood.name;
            continue;
          }

          logger.warn(
            { jobId: job.id, planId, foodId: item.foodId, foodName: item.name },
            "LLM generated invalid nutrition food item",
          );
          await conversationRepository.updateNutritionPlanFailed(
            planId,
            "AI đã chọn thực phẩm không có trong dữ liệu hệ thống. Vui lòng thử lại.",
          );
          return;
        }
      }
    }
    const exclusionViolations = findExclusionViolations(content, excludedFoodKeys);
    if (exclusionViolations.length > 0) {
      logger.error({ jobId: job.id, planId, exclusionViolations }, "Nutrition plan violates declared food exclusions");
      await conversationRepository.updateNutritionPlanFailed(
        planId,
        `Kế hoạch vi phạm thực phẩm đã loại trừ: ${exclusionViolations.slice(0, 3).join(", ")}. Vui lòng thử lại.`,
      );
      return;
    }
    let finalContent = content;
    let nutritionInvariant = validateNutritionPlanInvariants({
      content,
      mealsPerDay,
      allowedFoodIds,
    });
    if (!nutritionInvariant.ok) {
      // Deterministic numeric repair (no LLM): re-size ONLY the gram quantities of the foods the plan already
      // contains so the authoritative kcal/macro targets are met. Invariants, tolerances and exclusions are
      // unchanged: the repaired plan must pass the SAME checks below, otherwise the plan still fails closed.
      const foodById = new Map(allowedFoods.map((f) => [String(f.id), f]));
      const repair = repairNutritionPlanQuantities(content, {
        foodById,
        capG: (f) => realisticServingCapG(f.name, f.realisticServingMaxG),
      });
      const repairedInvariant = repair.report.changed
        ? validateNutritionPlanInvariants({ content: repair.content, mealsPerDay, allowedFoodIds })
        : nutritionInvariant;
      const repairedExclusions = repair.report.changed ? findExclusionViolations(repair.content, excludedFoodKeys) : [];
      const repairOk = repairedInvariant.ok && repairedExclusions.length === 0;
      logger.info(
        {
          jobId: job.id,
          planId,
          repairInvoked: true,
          repairSucceeded: repairOk,
          repairedDays: repair.report.repairedDays.length,
          failedDays: repair.report.failedDays.length,
          violationsBefore: [...new Set(nutritionInvariant.violations.map((v) => v.code))],
          before: repair.report.before,
          after: repair.report.after,
          repairMs: repair.report.ms,
        },
        "[nutrition-repair] deterministic quantity repair after invariant failure",
      );
      if (repairOk) {
        finalContent = repair.content;
        nutritionInvariant = repairedInvariant;
      }
    }
    if (!nutritionInvariant.ok) {
      logger.error(
        { jobId: job.id, planId, violations: nutritionInvariant.violations },
        "Nutrition plan failed final deterministic invariants",
      );
      await conversationRepository.updateNutritionPlanFailed(
        planId,
        `Nutrition plan constraint failure: ${[...new Set(nutritionInvariant.violations.map((item) => item.code))].join(", ")}`,
      );
      return;
    }
    // 7. Complete plan
    await conversationRepository.updateNutritionPlanCompletion(planId, finalContent);
    logger.info(
      { jobId: job.id, planId, userId },
      "Nutrition plan generation completed successfully",
    );

    // 8. Best-effort auto-save (onboarding bootstrap only — see schema
    // comment above). Never throws: the plan is already successfully
    // COMPLETED at this point regardless of whether this extra step
    // succeeds, and the user's deterministic NutritionGoal already makes
    // Nutrition usable even if this fails (spec §LI fallback rule).
    if (autoSaveOnComplete) {
      await autoSaveCompletedNutritionPlan(planId, userId, goal, finalContent, fitnessServiceUrl, internalSecret);
    }
  } catch (err: any) {
    logger.error(
      { err, jobId: job.id, planId },
      "Nutrition plan generation failed unexpectedly",
    );
    await conversationRepository.updateNutritionPlanFailed(
      planId,
      err.message || "Unknown error",
    );
    throw err;
  }
}

function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * AI Nutrition Cycle Engine (Gymini) — auto-save path for the onboarding
 * bootstrap only (see NutritionPlanJobDataSchema's autoSaveOnComplete
 * comment). Deliberately re-implements (rather than imports) the same
 * fitness-service POST plan.controller.ts's saveNutritionPlan makes: that
 * function is bound to an Express req/res and mid-request validation flow
 * that doesn't fit a background job cleanly, and duplicating this ~20-line
 * POST is lower-risk than refactoring a already-shipped, user-facing
 * endpoint to share code with a job worker. Defaults repeatEnabled=true
 * (unlike the manual save flow, which defaults to false) — an
 * auto-generated first plan should keep feeding the user meals past day 7
 * without anyone having to notice and re-save it.
 *
 * MUST NEVER THROW: the nutrition plan above is already successfully
 * COMPLETED by the time this runs; letting an error escape here would be
 * caught by processNutritionPlanJob's outer catch and incorrectly flip an
 * already-good plan to FAILED.
 */
async function autoSaveCompletedNutritionPlan(
  planId: string,
  userId: string,
  goal: string,
  content: NutritionPlanContent,
  fitnessServiceUrl: string,
  internalSecret: string | undefined,
): Promise<void> {
  try {
    const startDate = toDateOnlyString(new Date());
    const endDateObj = new Date();
    endDateObj.setDate(endDateObj.getDate() + 6);
    const endDate = toDateOnlyString(endDateObj);

    await axios.post(
      `${fitnessServiceUrl}/nutrition/from-ai-plan`,
      {
        sourcePlanId: planId,
        sourcePlanName: `Ke hoach dinh duong - ${goal}`,
        goal: content.goal,
        durationWeeks: content.durationWeeks,
        mealsPerDay: content.mealsPerDay,
        startDate,
        endDate,
        repeatEnabled: true,
        forceArchive: false,
        weeklySchedule: content.weeklySchedule,
        dailyCaloriesTarget: content.dailyCaloriesTarget,
        proteinTargetGrams: content.proteinTargetGrams,
        carbTargetGrams: content.carbTargetGrams,
        fatTargetGrams: content.fatTargetGrams,
      },
      {
        timeout: 20000,
        headers: {
          "x-internal-token": internalSecret,
          "x-user-id": userId,
        },
      },
    );
    logger.info({ planId, userId }, "[nutrition-bootstrap] auto-saved AI plan to NutritionProgram");
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, planId, userId },
      "[nutrition-bootstrap] auto-save of completed nutrition plan failed (non-blocking)",
    );
  }
}

function normalizeFoodName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildCompactNutritionTemplatePrompt(params: {
  goal: string;
  mealsPerDay: number;
  dailyCaloriesTarget?: number;
  dietPreference?: string;
  budgetLevel?: string;
  cuisineCountry?: string;
  vietnameseRegion?: string;
  restrictions?: string[];
  allowedFoods: AiFood[];
  weightKg?: number;
  bodyFatPct?: number;
}): string {
  const {
    goal,
    mealsPerDay,
    dailyCaloriesTarget,
    dietPreference,
    budgetLevel,
    cuisineCountry,
    vietnameseRegion,
    restrictions,
    allowedFoods,
    weightKg,
    bodyFatPct,
  } = params;
  const foodsForPrompt = allowedFoods
    .slice(0, 35)
    .map(
      (food) =>
        `${food.id} | ${food.name} | ${food.calories}kcal | P${food.protein} | C${food.carbs} | F${food.fat ?? food.fats ?? 0}`,
    )
    .join("\n");

  const physicalContext =
    weightKg || bodyFatPct
      ? `Thông tin cơ thể thực tế: cân nặng ${weightKg ?? "?"}kg${bodyFatPct != null ? `, mỡ ${bodyFatPct}%` : ""}.`
      : "";

  // Separate user context note from other restrictions
  const userContextNotes = (restrictions ?? []).filter((r) =>
    r.startsWith("[Dữ liệu cá nhân]"),
  );
  const realRestrictions = (restrictions ?? []).filter(
    (r) => !r.startsWith("[Dữ liệu cá nhân]"),
  );
  const userCtxBlock =
    userContextNotes.length > 0 ? userContextNotes.join("\n") : "";
  const cuisine = cuisineLabel(cuisineCountry);
  const regionLine = vietnameseRegionPromptLine(vietnameseRegion, cuisineCountry);

  return `Bạn là chuyên gia dinh dưỡng. Hãy tạo MẪU 1 NGÀY ăn uống cho mục tiêu "${goal}".

${physicalContext}
${userCtxBlock}

Mục tiêu calo/ngày: ${dailyCaloriesTarget ?? 2200}.
Số bữa trong ngày: ${mealsPerDay}.
Sở thích/chế độ: ${dietPreference || "không có"}.
Quốc gia/phong cách ẩm thực ưu tiên: ${cuisine || "không có"}. Nếu có, ưu tiên tên bữa và phối món theo phong cách này nhưng chỉ dùng foodId thật trong danh sách.
${regionLine}
Ngân sách: ${budgetLevel || "bình thường"}.
Hạn chế: ${realRestrictions.join("; ") || "không có"}.

CHỈ được dùng foodId trong DB dưới đây:
${foodsForPrompt}

Yêu cầu:
- Trả về đúng ${mealsPerDay} meals.
- Mỗi meal có 1 item chính, foodId phải là id thật trong danh sách.
- Không tạo đủ 7 ngày. Chỉ tạo template 1 ngày thật ngắn.
- Chỉ trả về JSON object, không markdown.

JSON:
{
  "meals": [
    {
      "mealType": "BREAKFAST",
      "title": "Bữa sáng giàu protein",
      "items": [
        { "foodId": "${allowedFoods[0]?.id ?? ""}", "quantity": 150, "note": "Dễ chuẩn bị" }
      ]
    }
  ],
  "nutritionNotes": ["Ưu tiên đủ protein và chia đều năng lượng trong ngày."]
}`;
}

export function parseNutritionTemplate(
  raw: string,
): { ok: true; template: NutritionTemplate } | { ok: false; reason: string } {
  const parsed = safeParseJsonCandidate(raw);
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "Invalid JSON template" };
  }

  const source = parsed as Record<string, any>;
  const meals = Array.isArray(source.meals) ? source.meals : [];
  if (meals.length === 0) {
    return {
      ok: false,
      reason: "Nutrition template contains no meals",
    };
  }

  return {
    ok: true,
    template: {
      meals: meals.map((meal: any, index: number) => ({
        mealType: normalizeMealType(meal?.mealType, index),
        title:
          typeof meal?.title === "string" && meal.title.trim()
            ? meal.title.trim()
            : defaultMealTitle(index),
        items: Array.isArray(meal?.items)
          ? meal.items.map((item: any) => ({
              foodId:
                typeof item?.foodId === "string"
                  ? item.foodId.trim()
                  : undefined,
              quantity: Number.isFinite(Number(item?.quantity))
                ? Number(item.quantity)
                : undefined,
              note: typeof item?.note === "string" ? item.note : undefined,
            }))
          : [],
      })),
      nutritionNotes: Array.isArray(source.nutritionNotes)
        ? source.nutritionNotes.filter((note: any) => typeof note === "string")
        : undefined,
    },
  };
}

// ── Part 6 hardening ──────────────────────────────────────────────────────
// Root cause of the "150g soy isolate / 180g egg white powder / 162g
// Parmesan / 120g dried salmon per day" bug: proteinFoods below is sorted
// PURELY by protein-density-per-calorie, which structurally ranks
// concentrated/processed items (isolates, hard cheese, dried fish,
// powders) above whole foods (chicken, tofu, fish) every time, and the old
// clampQuantity() applied one flat 50-260g cap to every food regardless of
// category — so a top-ranked dense item could legitimately be served at
// realistic-for-chicken-breast quantities. This is a defense-in-depth fix
// on top of fitness-service's own keyword exclusion list (which already
// tries to filter out "protein powder"/"dried"/"isolate" by name but
// cannot catch every technical USDA naming variant, and does not apply any
// cap to whole-but-dense foods like hard cheese or nuts).
const SERVING_CAP_RULES: Array<{ pattern: RegExp; capG: number }> = [
  // Hard/aged cheese — realistic serving is a garnish amount, not a main.
  { pattern: /parmesan|hard cheese|cheese, ?(parmesan|romano|grana)/i, capG: 40 },
  { pattern: /\bcheese\b/i, capG: 60 },
  // Nuts/seeds — calorie- and fat-dense; realistic serving is a handful.
  { pattern: /\b(nuts?|seeds?|almond|peanut|cashew|walnut|pistachio|soy nuts?)\b/i, capG: 35 },
  // Dried/jerky meat or fish that slipped past the name-exclusion filter.
  { pattern: /\bdried\b|jerky|smoked (fish|meat|salmon|beef)/i, capG: 40 },
  // Any powder/isolate/concentrate that slipped past the exclusion filter.
  { pattern: /powder|isolate|concentrate/i, capG: 40 },
  // Oils/fats — a food-prep ingredient, not a "serving" of food.
  { pattern: /\boil\b|butter(?!milk)|ghee|lard/i, capG: 20 },
  // Egg whites (liquid/fresh) — realistic upper bound (~5-6 large eggs' worth).
  { pattern: /egg white/i, capG: 200 },
];
const DEFAULT_SERVING_CAP_G = 250;

export function realisticServingCapG(
  foodName: string,
  dbCapG?: number | null,
): number {
  // Prefer the real per-food value from fitness-service's Food table
  // (migration 20260819000000_add_food_serving_metadata) when available —
  // it's actual backfilled data, not a regex guessing from the name alone.
  // The name-keyword rules below remain the fallback for any food the
  // migration didn't classify (food_form/realistic_serving_max_g both
  // null) or for callers (tests, other code paths) that only have a name.
  if (dbCapG != null && Number.isFinite(dbCapG) && dbCapG > 0) return dbCapG;
  for (const rule of SERVING_CAP_RULES) {
    if (rule.pattern.test(foodName)) return rule.capG;
  }
  return DEFAULT_SERVING_CAP_G;
}

export function buildNutritionPlanFromTemplate(params: {
  goal: string;
  mealsPerDay: number;
  dailyCaloriesTarget?: number;
  template: NutritionTemplate;
  allowedFoods: AiFood[];
  cuisineCountry?: string;
  vietnameseRegion?: string;
  proteinTargetG?: number;
  carbTargetG?: number;
  fatTargetG?: number;
}): NutritionPlanContent {
  const {
    goal,
    mealsPerDay,
    dailyCaloriesTarget,
    template,
    allowedFoods,
    cuisineCountry,
    vietnameseRegion,
    proteinTargetG,
    carbTargetG,
    fatTargetG,
  } = params;
  const cuisine = cuisineLabel(cuisineCountry);
  const regionLabel = describeVietnameseRegionPreference(vietnameseRegion, cuisineCountry);
  const regionNote = regionLabel
    ? `Ưu tiên khẩu vị món Việt theo vùng miền: ${regionLabel}.`
    : null;
  const targetCalories = dailyCaloriesTarget ?? 2200;
  const allowedById = new Map(allowedFoods.map((food) => [food.id, food]));
  // realisticServingCapG()-aware selection helpers, defined up front so
  // EVERY role's candidate pool (protein/carb/fat, and the LLM's own
  // wantedFood suggestion below) can be screened by them — a food capped
  // to a tiny realistic serving (dried/smoked/powder/cheese/oil) cannot
  // deliver a meal-sized macro contribution no matter how the sizing math
  // is done, so preferring cap-friendly whole foods has to happen at
  // SELECTION time for every role, not just some of them.
  const CAP_FRIENDLY_THRESHOLD_G = 100;
  function isCapFriendly(food: AiFood): boolean {
    return (
      realisticServingCapG(food.name, food.realisticServingMaxG) >=
      CAP_FRIENDLY_THRESHOLD_G
    );
  }
  /** Picks the first tier (in preference order) that has ANY candidates.
   * Macro-target accuracy is a hard invariant (validateNutritionPlanInvariants
   * rejects the whole plan on a miss); diversity across the week is a
   * nice-to-have layered on top via the rotation index below, using
   * whatever count the chosen tier ends up with — so correctness must
   * never wait for a large candidate pool before it's allowed to apply.
   * Only when a tier is completely EMPTY does this
   * fall through to the next, laxer one, and finally to the full
   * unfiltered set so a restrictive catalog never comes up empty. */
  function preferredPool(all: AiFood[], tiers: Array<(f: AiFood) => boolean>): AiFood[] {
    for (const predicate of tiers) {
      const pool = all.filter(predicate);
      if (pool.length > 0) return pool;
    }
    return all;
  }
  // Root-cause fix, found via the REAL 13k-row USDA catalog (a curated
  // example list never surfaces this): sorting purely by protein density
  // per calorie structurally ranks concentrated/processed items (dried,
  // smoked, powder) at the very top — the same "isolate/Parmesan/dried
  // salmon" bug the whole-plan serving caps were built to stop — so even
  // the PROTEIN role's own pool must prefer cap-friendly candidates first;
  // otherwise a capped item becomes the protein bottleneck no matter how
  // correctly the rest of the sizing math accounts for it.
  const proteinFoodsAll = allowedFoods
    .filter((food) => food.protein >= 15)
    .sort(
      (a, b) =>
        b.protein / Math.max(1, b.calories) -
        a.protein / Math.max(1, a.calories),
    );
  const proteinFoods = preferredPool(proteinFoodsAll, [isCapFriendly]);
  // Sorting carb/fat role candidates PURELY by carb/fat density (with no
  // regard for how much protein they also happen to carry) regularly
  // selected foods that were substantial protein sources in their own
  // right (e.g. a fatty fish for the "fat role"), which compounds with
  // the protein-role food and overshoots the real daily protein target
  // even after the incidental-protein-subtraction fix below. Prefer
  // LOW-protein candidates for these two roles when enough exist; fall
  // back to the full density-sorted set otherwise so a restrictive
  // catalog (e.g. dairy-free) never comes up empty.
  const LOW_PROTEIN_THRESHOLD_G_PER_100G = 10;
  // calories >= 30 (not >= 100, the old threshold): a >=100kcal/100g floor
  // silently excluded common whole-food carb sources whose calorie
  // density is naturally lower than grains — banana (~89), sweet potato
  // (~90), most fruit and starchy vegetables — leaving mainly dense/
  // processed items (which also happen to rank higher on carb-density and
  // therefore trip the cap-friendly filter below) as the only real
  // candidates. Real non-foods (spices, seasonings) still get filtered by
  // the carbs >= 20 floor and DEFAULT_SERVING_CAP_G bounding any residual
  // extreme case.
  const carbFoodsAll = allowedFoods
    .filter((food) => food.carbs >= 20 && food.calories >= 30)
    .sort(
      (a, b) =>
        b.carbs / Math.max(1, b.calories) -
        a.carbs / Math.max(1, a.calories),
    );
  const carbFoods = preferredPool(carbFoodsAll, [
    (f) => f.protein < LOW_PROTEIN_THRESHOLD_G_PER_100G && isCapFriendly(f),
    (f) => f.protein < LOW_PROTEIN_THRESHOLD_G_PER_100G,
    isCapFriendly,
  ]);
  const fatFoodsAll = allowedFoods
    .filter((food) => (food.fat ?? food.fats ?? 0) >= 8)
    .sort(
      (a, b) =>
        (b.fat ?? b.fats ?? 0) / Math.max(1, b.calories) -
        (a.fat ?? a.fats ?? 0) / Math.max(1, a.calories),
    );
  const fatFoods = preferredPool(fatFoodsAll, [
    (f) => f.protein < LOW_PROTEIN_THRESHOLD_G_PER_100G && isCapFriendly(f),
    (f) => f.protein < LOW_PROTEIN_THRESHOLD_G_PER_100G,
    isCapFriendly,
  ]);
  const fallbackFoods = allowedFoods.length > 0 ? allowedFoods : proteinFoods;

  // Root-cause fix: quantities used to be sized from FIXED calorie-role
  // percentages (primary=5%, secondary=70%, tertiary=25% of meal
  // calories) regardless of the actual requested protein/carb/fat gram
  // targets. For a high-protein target (e.g. 200g protein / 3200 kcal =
  // 25% of calories from protein) this let the plan overshoot the real
  // protein target by ~45%+ — caught by validateNutritionPlanInvariants's
  // 35% tolerance and correctly rejected (status=FAILED), but that means
  // the pipeline could silently keep failing to produce a usable plan for
  // any genuinely high-protein request, exactly the muscle-gain scenario
  // this feature exists for. Quantities are now sized directly from the
  // real per-meal MACRO GRAM target (protein/carb/fat), not a calorie
  // share — the actual thing the plan is supposed to hit.
  const finalProteinTargetGrams =
    proteinTargetG ?? Math.round((targetCalories * 0.3) / 4);
  const finalCarbTargetGrams =
    carbTargetG ?? Math.round((targetCalories * 0.45) / 4);
  const finalFatTargetGrams = fatTargetG ?? Math.round((targetCalories * 0.25) / 9);
  const proteinPerMeal = finalProteinTargetGrams / mealsPerDay;
  const carbPerMeal = finalCarbTargetGrams / mealsPerDay;
  const fatPerMeal = finalFatTargetGrams / mealsPerDay;

  /** Grams of `food` needed to supply `targetGrams` of the given macro,
   * e.g. macroTargetQuantity(chicken, 30, "protein") -> how many grams of
   * chicken deliver ~30g protein. Falls back to a neutral 100g when the
   * food has none of that macro (avoids divide-by-zero / a nonsensical
   * huge quantity trying to hit a target from a food that can't supply it
   * — the category-specific fallback candidate selection above already
   * tries to avoid this case, this is just a safety floor). */
  function macroTargetQuantity(
    food: AiFood,
    targetGrams: number,
    macroField: "protein" | "carbs" | "fat",
  ): number {
    const amountPer100g =
      macroField === "fat" ? (food.fat ?? food.fats ?? 0) : food[macroField];
    const perGram = amountPer100g / 100;
    if (!Number.isFinite(perGram) || perGram <= 0) return 100;
    return targetGrams / perGram;
  }

  const weeklySchedule = Array.from({ length: 7 }, (_, dayIndex) => {
    const meals = Array.from({ length: mealsPerDay }, (_, mealIndex) => {
      const templateMeal = template.meals[mealIndex] ?? template.meals[0];
      const wantedFoodId = templateMeal?.items?.[0]?.foodId;
      const wantedFood = wantedFoodId ? allowedById.get(wantedFoodId) : undefined;
      // Part 6 hardening: cycle through a wider pool (top 6, not top 3) of
      // candidates per macro category so the SAME 2-3 protein-dense foods
      // don't repeat at every single meal for all 7 days — the original
      // 448g-protein/day bug plan was built from just 3 recurring items.
      const DIVERSITY_POOL_SIZE = 6;
      // The LLM's suggested food is only honored as primary when it can
      // actually deliver a meal-sized protein contribution — same
      // cap-friendliness screen as the deterministic proteinFoods pool
      // above, otherwise a single LLM-suggested dried/smoked/powder item
      // silently becomes the protein bottleneck for that whole meal,
      // regardless of how correctly the rest of the sizing math accounts
      // for it (the real bug this whole check exists to close).
      const wantedFoodUsable =
        wantedFood && wantedFood.protein >= 15 && isCapFriendly(wantedFood)
          ? wantedFood
          : undefined;
      const primary =
        wantedFoodUsable ??
        proteinFoods[
          (dayIndex + mealIndex) %
            Math.max(1, Math.min(DIVERSITY_POOL_SIZE, proteinFoods.length))
        ] ??
        fallbackFoods[
          (dayIndex + mealIndex) % Math.max(1, fallbackFoods.length)
        ];
      const secondary =
        carbFoods[
          (dayIndex * mealsPerDay + mealIndex) %
            Math.max(1, Math.min(DIVERSITY_POOL_SIZE, carbFoods.length))
        ] ??
        fallbackFoods[
          (dayIndex * mealsPerDay + mealIndex + 1) %
            Math.max(1, fallbackFoods.length)
        ];
      const tertiary =
        fatFoods[
          (dayIndex * mealsPerDay + mealIndex) %
            Math.max(1, Math.min(DIVERSITY_POOL_SIZE, fatFoods.length))
        ] ?? secondary;

      // Sizing order matters: secondary (carb role) and tertiary (fat
      // role) are computed FIRST, sized purely from the carb/fat targets,
      // and immediately bounded to what will ACTUALLY be served —
      // realistic-serving caps/floors applied right here, not deferred.
      // Whole foods are never pure macros though — a fat-role food like
      // salmon also carries real protein, a carb-role food may carry some
      // too — so their INCIDENTAL protein contribution is subtracted from
      // what primary (protein role) still needs to supply.
      //
      // Root-cause fix (found via the real 13k-row USDA catalog, after the
      // catalog-diversity fix above): this incidental-protein subtraction
      // must be computed from the BOUNDED (post-cap) secondary/tertiary
      // quantities, not their raw pre-cap targets. A carb-role food often
      // needs a large raw quantity to hit carbPerMeal on its own (e.g. a
      // fruit spread with modest carb density) — that raw quantity can
      // carry substantial "incidental protein" on paper, causing primary
      // to be shorted to compensate for protein that then never actually
      // gets served once the cap truncates the real portion down. The
      // previous version's final proportional-scale-down pass was a
      // symptom fix for the opposite direction (overshoot) built on the
      // same flawed raw-quantity accounting, and both the overshoot and
      // this undershoot are direct consequences of crediting a serving
      // that never makes it to the plate.
      const rawSecondaryQuantity =
        secondary.id === primary.id
          ? 0
          : macroTargetQuantity(secondary, carbPerMeal, "carbs");
      const rawTertiaryQuantity =
        tertiary.id === primary.id || tertiary.id === secondary.id
          ? 0
          : macroTargetQuantity(tertiary, fatPerMeal, "fat");
      // rawSecondaryQuantity/rawTertiaryQuantity are deliberately exactly
      // 0 when that role duplicates an already-used food (see above) —
      // applyServingBounds always bumps a quantity up to its category
      // floor, so it must NOT be called in that case, or the "skip this
      // duplicate role" intent silently breaks and the same food ends up
      // listed twice in one meal.
      const secondaryQuantity =
        rawSecondaryQuantity === 0
          ? 0
          : applyServingBounds(rawSecondaryQuantity, secondary);
      const tertiaryQuantity =
        rawTertiaryQuantity === 0
          ? 0
          : applyServingBounds(rawTertiaryQuantity, tertiary, 10);
      const incidentalProteinFromOtherRoles =
        (secondaryQuantity / 100) * secondary.protein +
        (tertiaryQuantity / 100) * tertiary.protein;
      const remainingProteinTarget = Math.max(
        0,
        proteinPerMeal - incidentalProteinFromOtherRoles,
      );
      const rawPrimaryQuantity = macroTargetQuantity(
        primary,
        remainingProteinTarget,
        "protein",
      );
      const primaryQuantity = applyServingBounds(
        rawPrimaryQuantity,
        primary,
        10,
      );
      const items = [
        buildMealItem(primary, primaryQuantity, templateMeal?.items?.[0]?.note),
        ...(secondaryQuantity > 0
          ? [
              buildMealItem(
                secondary,
                secondaryQuantity,
                "Bổ sung năng lượng và vi chất",
              ),
            ]
          : []),
        ...(tertiaryQuantity > 0
          ? [
              buildMealItem(
                tertiary,
                tertiaryQuantity,
                "Bổ sung chất béo và năng lượng theo mục tiêu macro",
              ),
            ]
          : []),
      ];

      const totals = sumItems(items);
      return {
        mealType: normalizeMealType(templateMeal?.mealType, mealIndex),
        title: templateMeal?.title || defaultMealTitle(mealIndex),
        calories: totals.calories,
        protein: totals.protein,
        carbs: totals.carbs,
        fat: totals.fat,
        items,
      };
    });

    const totals = sumMeals(meals);
    return {
      dayNumber: dayIndex + 1,
      title: `Ngày ${dayIndex + 1}`,
      totalCalories: totals.calories,
      protein: totals.protein,
      carbs: totals.carbs,
      fat: totals.fat,
      meals,
    };
  });

  return {
    goal,
    durationWeeks: 1,
    mealsPerDay,
    dailyCaloriesTarget: targetCalories,
    proteinTargetGrams: finalProteinTargetGrams,
    carbTargetGrams: finalCarbTargetGrams,
    fatTargetGrams: finalFatTargetGrams,
    weeklySchedule,
    generalNotes: template.nutritionNotes?.length
      ? [
          ...template.nutritionNotes,
          ...(regionNote ? [regionNote] : []),
          ...(cuisine ? [`Ưu tiên phong cách ẩm thực: ${cuisine}.`] : []),
        ]
      : [
          ...(regionNote ? [regionNote] : []),
          ...(cuisine ? [`Ưu tiên phong cách ẩm thực: ${cuisine}.`] : []),
          "Ưu tiên đủ protein, chia đều năng lượng trong ngày và điều chỉnh khẩu phần theo tiến độ thực tế.",
        ],
  };
}

function buildMealItem(food: AiFood, quantity: number, notes?: string) {
  const factor = quantity / 100;
  return {
    foodId: food.id,
    name: food.name,
    quantity,
    unit: "g",
    calories: Math.max(0, Math.round(food.calories * factor)),
    protein: roundMacro(food.protein * factor),
    carbs: roundMacro(food.carbs * factor),
    fat: roundMacro((food.fat ?? food.fats ?? 0) * factor),
    notes,
  };
}

/** Applies the category-aware realistic-serving bounds (Part 6) to a raw
 * quantity, regardless of how that quantity was computed. minimumQuantity
 * is itself clamped to the cap first so a tightly-capped category (e.g.
 * oil at 20g) can never be forced back up to a generic 50g floor. */
export function applyServingBounds(
  quantity: number,
  food: AiFood,
  minimumQuantity = 50,
): number {
  const cap = realisticServingCapG(food.name, food.realisticServingMaxG);
  const floor = Math.min(minimumQuantity, cap);
  return Math.max(floor, Math.min(cap, Math.round(quantity)));
}

export function clampQuantity(
  candidate: unknown,
  food: AiFood,
  targetCalories: number,
  minimumQuantity = 50,
): number {
  const calculated =
    food.calories > 0 ? (targetCalories / food.calories) * 100 : 120;
  const requested = Number(candidate);
  const boundedRequest =
    Number.isFinite(requested) && requested > 0 ? requested : calculated;
  const quantity =
    Math.abs(boundedRequest - calculated) > 80 ? calculated : boundedRequest;
  return applyServingBounds(quantity, food, minimumQuantity);
}

function sumItems(items: ReturnType<typeof buildMealItem>[]) {
  return items.reduce(
    (total, item) => ({
      calories: total.calories + item.calories,
      protein: roundMacro(total.protein + item.protein),
      carbs: roundMacro(total.carbs + item.carbs),
      fat: roundMacro(total.fat + item.fat),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function sumMeals(
  meals: Array<{
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>,
) {
  return meals.reduce(
    (total, meal) => ({
      calories: total.calories + meal.calories,
      protein: roundMacro(total.protein + meal.protein),
      carbs: roundMacro(total.carbs + meal.carbs),
      fat: roundMacro(total.fat + meal.fat),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function roundMacro(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeMealType(
  value: unknown,
  index: number,
): "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK" {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  if (
    normalized === "BREAKFAST" ||
    normalized === "LUNCH" ||
    normalized === "DINNER" ||
    normalized === "SNACK"
  ) {
    return normalized;
  }
  return (
    (["BREAKFAST", "LUNCH", "DINNER", "SNACK", "SNACK", "SNACK"] as const)[
      index
    ] ?? "SNACK"
  );
}

function defaultMealTitle(index: number): string {
  return (
    ["Bữa sáng", "Bữa trưa", "Bữa tối", "Bữa phụ"][index] ?? `Bữa ${index + 1}`
  );
}
