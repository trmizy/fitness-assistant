import { Job } from 'bullmq';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import axios from 'axios';
import { llmService } from './llm.service';
import { conversationRepository, PlanStatus } from '../repositories/conversation.repository';
import type { NutritionPlanContent } from '../schemas/nutrition-plan.schemas';
import { safeParseJsonCandidate } from '../utils/json';

type AiFood = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat?: number;
  fats?: number;
};

type NutritionTemplate = {
  meals: Array<{
    mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';
    title: string;
    items: Array<{ foodId?: string; quantity?: number; note?: string }>;
  }>;
  nutritionNotes?: string[];
};

const NutritionPlanJobDataSchema = z.object({
  planId: z.string().uuid(),
  userId: z.string().min(1),
  goal: z.string().min(1).max(200),
  durationWeeks: z.number().int().min(1).max(1),
  mealsPerDay: z.number().int().min(1).max(6),
  dailyCaloriesTarget: z.number().int().optional(),
  dietPreference: z.string().optional(),
  budgetLevel: z.string().optional(),
  restrictions: z.array(z.string()).optional(),
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
  carbsAroundWorkout: z.boolean().optional(),
  preworkoutMeal: z.boolean().optional(),
  postworkoutMeal: z.boolean().optional(),
});

export async function processNutritionPlanJob(job: Job) {
  // 1. Validate job data
  const dataResult = NutritionPlanJobDataSchema.safeParse(job.data);
  if (!dataResult.success) {
    const reason = `Invalid job data: ${dataResult.error.errors.map((e) => e.message).join('; ')}`;
    logger.error({ jobId: job.id, data: job.data }, reason);
    throw new Error(reason);
  }
  const { planId, userId, goal, mealsPerDay, dailyCaloriesTarget, dietPreference, budgetLevel, restrictions } = dataResult.data;

  logger.info({ jobId: job.id, planId, userId }, 'Nutrition plan generation job started');

  try {
    // 2. Mark plan as PROCESSING
    await conversationRepository.updateNutritionPlanStatus(planId, PlanStatus.PROCESSING);

    // 3. Fetch allowed foods from fitness-service
    const fitnessServiceUrl = process.env.FITNESS_SERVICE_URL || 'http://localhost:3002';
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;

    let allowedFoods: any[] = [];
    try {
      const resp = await axios.get(`${fitnessServiceUrl}/internal/foods/for-ai-nutrition`, {
        timeout: 10000,
        headers: {
          'x-internal-token': internalSecret,
          'x-user-id': userId,
        },
      });
      if (resp?.data?.success && Array.isArray(resp.data.data?.foods)) {
        allowedFoods = resp.data.data.foods;
      }
    } catch (err: any) {
      logger.warn({ err: err.message, jobId: job.id }, 'Could not fetch foods for AI nutrition plan');
      await conversationRepository.updateNutritionPlanFailed(planId, 'Chưa có dữ liệu thực phẩm để tạo kế hoạch dinh dưỡng.');
      return;
    }

    if (allowedFoods.length === 0) {
      await conversationRepository.updateNutritionPlanFailed(planId, 'Chưa có dữ liệu thực phẩm để tạo kế hoạch dinh dưỡng.');
      return;
    }

    // 3b. Fetch personal user context (InBody, nutrition history) — non-critical
    let resolvedWeightKg: number | undefined;
    let resolvedBodyFatPct: number | undefined;
    let resolvedBmr: number | undefined;
    let userContextNote = '';
    try {
      const { fetchWorkerUserContext, formatWorkerContextForPrompt } = await import('../workers/worker-user-context');
      const ctx = await fetchWorkerUserContext(userId);
      if (ctx.latestInBody) {
        resolvedWeightKg  = ctx.latestInBody.weightKg;
        resolvedBodyFatPct = ctx.latestInBody.bodyFatPct;
        resolvedBmr       = ctx.latestInBody.bmr;
      }
      userContextNote = formatWorkerContextForPrompt(ctx);
      logger.info({ planId, hasInBody: !!ctx.latestInBody, nutritionDays: ctx.recentNutritionDays.length }, 'Fetched user context for nutrition plan generation');
    } catch (err) {
      logger.warn({ err, planId }, 'Could not fetch user context for nutrition plan — using provided params only');
    }

    // Merge job params with InBody data (InBody takes priority for physical metrics)
    const effectiveWeightKg   = resolvedWeightKg   ?? dataResult.data.weightKg;
    const effectiveBodyFatPct = resolvedBodyFatPct  ?? dataResult.data.bodyFatPct;

    // 4. Ask the LLM for a compact one-day meal template, then expand it with DB foods.
    // Small local models are unreliable when asked to emit 7 full days of nested JSON.
    const prompt = buildCompactNutritionTemplatePrompt({
      goal,
      mealsPerDay,
      dailyCaloriesTarget,
      dietPreference,
      budgetLevel,
      restrictions: [
        ...(restrictions ?? []),
        // Inject InBody-derived note as a soft constraint
        ...(userContextNote ? [`[Dữ liệu cá nhân]\n${userContextNote}${resolvedBmr ? `\nBMR tham khảo: ${resolvedBmr} kcal/ngày` : ''}`] : []),
      ],
      allowedFoods,
      // Pass resolved physical metrics so prompt can calculate accurate macros
      weightKg: effectiveWeightKg,
      bodyFatPct: effectiveBodyFatPct,
    });

    // 5. Call LLM with Retry Logic
    let llmResponse = await llmService.callLLM(prompt, { responseFormat: 'json', numPredict: 1200, temperature: 0.1, timeoutMs: 180000 });
    let templateResult = parseNutritionTemplate(llmResponse.answer, mealsPerDay);
    
    if (!templateResult.ok) {
      logger.warn({ jobId: job.id, planId, reason: templateResult.reason, rawLLMResponse: llmResponse.answer }, 'First LLM nutrition template attempt failed to parse, retrying...');
      const retryPrompt = `${prompt}\n\n[LỖI TRƯỚC ĐÓ]: Câu trả lời trước của bạn bị lỗi định dạng: ${templateResult.reason}.
Hãy sửa lỗi và CHỈ TRẢ VỀ DUY NHẤT 1 OBJECT JSON HỢP LỆ, không giải thích gì thêm, đóng mở ngoặc đầy đủ.`;
      
      llmResponse = await llmService.callLLM(retryPrompt, { responseFormat: 'json', numPredict: 1200, temperature: 0.1, timeoutMs: 180000 });
      templateResult = parseNutritionTemplate(llmResponse.answer, mealsPerDay);
    }

    if (!templateResult.ok) {
      logger.error({ jobId: job.id, planId, reason: templateResult.reason, rawLLMResponse: llmResponse.answer }, 'Failed to parse LLM nutrition template response after retry');
      await conversationRepository.updateNutritionPlanFailed(planId, 'AI chưa trả về đúng định dạng kế hoạch dinh dưỡng. Vui lòng thử lại.');
      return;
    }

    const content = buildNutritionPlanFromTemplate({
      goal,
      mealsPerDay,
      dailyCaloriesTarget,
      template: templateResult.template,
      allowedFoods,
    });
    if (content.durationWeeks !== 1 || content.weeklySchedule.length !== 7) {
      logger.error({ jobId: job.id, planId, days: content.weeklySchedule.length }, 'Nutrition plan failed duration/day validation');
      await conversationRepository.updateNutritionPlanFailed(planId, 'AI chưa trả về đúng định dạng kế hoạch dinh dưỡng. Vui lòng thử lại.');
      return;
    }

    const allowedFoodIds = new Set(allowedFoods.map(f => String(f.id)));
    const foodByName = new Map(allowedFoods.map(f => [normalizeFoodName(f.name), f]));
    for (const day of content.weeklySchedule) {
      if (day.meals.length !== mealsPerDay) {
        logger.error({ jobId: job.id, planId, dayNumber: day.dayNumber, meals: day.meals.length }, 'Nutrition plan failed mealsPerDay validation');
        await conversationRepository.updateNutritionPlanFailed(planId, 'AI chưa trả về đúng định dạng kế hoạch dinh dưỡng. Vui lòng thử lại.');
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

          logger.warn({ jobId: job.id, planId, foodId: item.foodId, foodName: item.name }, 'LLM generated invalid nutrition food item');
          await conversationRepository.updateNutritionPlanFailed(planId, 'AI đã chọn thực phẩm không có trong dữ liệu hệ thống. Vui lòng thử lại.');
          return;
        }
      }
    }
    // 7. Complete plan
    await conversationRepository.updateNutritionPlanCompletion(planId, content);
    logger.info({ jobId: job.id, planId, userId }, 'Nutrition plan generation completed successfully');
  } catch (err: any) {
    logger.error({ err, jobId: job.id, planId }, 'Nutrition plan generation failed unexpectedly');
    await conversationRepository.updateNutritionPlanFailed(planId, err.message || 'Unknown error');
    throw err;
  }
}

function normalizeFoodName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildCompactNutritionTemplatePrompt(params: {
  goal: string;
  mealsPerDay: number;
  dailyCaloriesTarget?: number;
  dietPreference?: string;
  budgetLevel?: string;
  restrictions?: string[];
  allowedFoods: AiFood[];
  weightKg?: number;
  bodyFatPct?: number;
}): string {
  const { goal, mealsPerDay, dailyCaloriesTarget, dietPreference, budgetLevel, restrictions, allowedFoods, weightKg, bodyFatPct } = params;
  const foodsForPrompt = allowedFoods.slice(0, 35).map((food) =>
    `${food.id} | ${food.name} | ${food.calories}kcal | P${food.protein} | C${food.carbs} | F${food.fat ?? food.fats ?? 0}`
  ).join('\n');

  const physicalContext = weightKg || bodyFatPct
    ? `Thông tin cơ thể thực tế: cân nặng ${weightKg ?? '?'}kg${bodyFatPct != null ? `, mỡ ${bodyFatPct}%` : ''}.`
    : '';

  // Separate user context note from other restrictions
  const userContextNotes = (restrictions ?? []).filter(r => r.startsWith('[Dữ liệu cá nhân]'));
  const realRestrictions  = (restrictions ?? []).filter(r => !r.startsWith('[Dữ liệu cá nhân]'));
  const userCtxBlock = userContextNotes.length > 0 ? userContextNotes.join('\n') : '';

  return `Bạn là chuyên gia dinh dưỡng. Hãy tạo MẪU 1 NGÀY ăn uống cho mục tiêu "${goal}".

${physicalContext}
${userCtxBlock}

Mục tiêu calo/ngày: ${dailyCaloriesTarget ?? 2200}.
Số bữa trong ngày: ${mealsPerDay}.
Sở thích/chế độ: ${dietPreference || 'không có'}.
Ngân sách: ${budgetLevel || 'bình thường'}.
Hạn chế: ${realRestrictions.join('; ') || 'không có'}.

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
        { "foodId": "${allowedFoods[0]?.id ?? ''}", "quantity": 150, "note": "Dễ chuẩn bị" }
      ]
    }
  ],
  "nutritionNotes": ["Ưu tiên đủ protein và chia đều năng lượng trong ngày."]
}`;
}

function parseNutritionTemplate(raw: string, mealsPerDay: number): { ok: true; template: NutritionTemplate } | { ok: false; reason: string } {
  const parsed = safeParseJsonCandidate(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'Invalid JSON template' };
  }

  const source = parsed as Record<string, any>;
  const meals = Array.isArray(source.meals) ? source.meals : [];
  if (meals.length !== mealsPerDay) {
    return { ok: false, reason: `Expected ${mealsPerDay} meals, received ${meals.length}` };
  }

  return {
    ok: true,
    template: {
      meals: meals.map((meal: any, index: number) => ({
        mealType: normalizeMealType(meal?.mealType, index),
        title: typeof meal?.title === 'string' && meal.title.trim() ? meal.title.trim() : defaultMealTitle(index),
        items: Array.isArray(meal?.items) ? meal.items.map((item: any) => ({
          foodId: typeof item?.foodId === 'string' ? item.foodId.trim() : undefined,
          quantity: Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : undefined,
          note: typeof item?.note === 'string' ? item.note : undefined,
        })) : [],
      })),
      nutritionNotes: Array.isArray(source.nutritionNotes)
        ? source.nutritionNotes.filter((note: any) => typeof note === 'string')
        : undefined,
    },
  };
}

function buildNutritionPlanFromTemplate(params: {
  goal: string;
  mealsPerDay: number;
  dailyCaloriesTarget?: number;
  template: NutritionTemplate;
  allowedFoods: AiFood[];
}): NutritionPlanContent {
  const { goal, mealsPerDay, dailyCaloriesTarget, template, allowedFoods } = params;
  const targetCalories = dailyCaloriesTarget ?? 2200;
  const allowedById = new Map(allowedFoods.map((food) => [food.id, food]));
  const proteinFoods = allowedFoods.filter((food) => food.protein >= 15);
  const carbFoods = allowedFoods.filter((food) => food.carbs >= 20);
  const fallbackFoods = allowedFoods.length > 0 ? allowedFoods : proteinFoods;

  const weeklySchedule = Array.from({ length: 7 }, (_, dayIndex) => {
    const meals = Array.from({ length: mealsPerDay }, (_, mealIndex) => {
      const templateMeal = template.meals[mealIndex] ?? template.meals[0];
      const wantedFoodId = templateMeal?.items?.[0]?.foodId;
      const primary = (wantedFoodId ? allowedById.get(wantedFoodId) : undefined)
        ?? proteinFoods[(dayIndex + mealIndex) % Math.max(1, proteinFoods.length)]
        ?? fallbackFoods[(dayIndex + mealIndex) % Math.max(1, fallbackFoods.length)];
      const secondary = carbFoods[(dayIndex * mealsPerDay + mealIndex) % Math.max(1, carbFoods.length)]
        ?? fallbackFoods[(dayIndex * mealsPerDay + mealIndex + 1) % Math.max(1, fallbackFoods.length)];

      const mealTarget = targetCalories / mealsPerDay;
      const primaryQuantity = clampQuantity(templateMeal?.items?.[0]?.quantity, primary, mealTarget * 0.55);
      const secondaryQuantity = secondary.id === primary.id ? 0 : clampQuantity(undefined, secondary, mealTarget * 0.45);
      const items = [
        buildMealItem(primary, primaryQuantity, templateMeal?.items?.[0]?.note),
        ...(secondaryQuantity > 0 ? [buildMealItem(secondary, secondaryQuantity, 'Bổ sung năng lượng và vi chất')] : []),
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
    proteinTargetGrams: Math.round(targetCalories * 0.3 / 4),
    carbTargetGrams: Math.round(targetCalories * 0.45 / 4),
    fatTargetGrams: Math.round(targetCalories * 0.25 / 9),
    weeklySchedule,
    generalNotes: template.nutritionNotes?.length
      ? template.nutritionNotes
      : ['Ưu tiên đủ protein, chia đều năng lượng trong ngày và điều chỉnh khẩu phần theo tiến độ thực tế.'],
  };
}

function buildMealItem(food: AiFood, quantity: number, notes?: string) {
  const factor = quantity / 100;
  return {
    foodId: food.id,
    name: food.name,
    quantity,
    unit: 'g',
    calories: Math.max(0, Math.round(food.calories * factor)),
    protein: roundMacro(food.protein * factor),
    carbs: roundMacro(food.carbs * factor),
    fat: roundMacro((food.fat ?? food.fats ?? 0) * factor),
    notes,
  };
}

function clampQuantity(candidate: unknown, food: AiFood, targetCalories: number): number {
  const calculated = food.calories > 0 ? (targetCalories / food.calories) * 100 : 120;
  const requested = Number(candidate);
  const boundedRequest = Number.isFinite(requested) && requested > 0 ? requested : calculated;
  const quantity = Math.abs(boundedRequest - calculated) > 80 ? calculated : boundedRequest;
  return Math.max(50, Math.min(260, Math.round(quantity)));
}

function sumItems(items: ReturnType<typeof buildMealItem>[]) {
  return items.reduce((total, item) => ({
    calories: total.calories + item.calories,
    protein: roundMacro(total.protein + item.protein),
    carbs: roundMacro(total.carbs + item.carbs),
    fat: roundMacro(total.fat + item.fat),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function sumMeals(meals: Array<{ calories: number; protein: number; carbs: number; fat: number }>) {
  return meals.reduce((total, meal) => ({
    calories: total.calories + meal.calories,
    protein: roundMacro(total.protein + meal.protein),
    carbs: roundMacro(total.carbs + meal.carbs),
    fat: roundMacro(total.fat + meal.fat),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function roundMacro(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeMealType(value: unknown, index: number): 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' {
  const normalized = typeof value === 'string' ? value.toUpperCase() : '';
  if (normalized === 'BREAKFAST' || normalized === 'LUNCH' || normalized === 'DINNER' || normalized === 'SNACK') {
    return normalized;
  }
  return (['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'SNACK', 'SNACK'] as const)[index] ?? 'SNACK';
}

function defaultMealTitle(index: number): string {
  return ['Bữa sáng', 'Bữa trưa', 'Bữa tối', 'Bữa phụ'][index] ?? `Bữa ${index + 1}`;
}
