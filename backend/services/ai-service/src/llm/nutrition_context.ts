import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { conversationRepository, PlanStatus } from '../repositories/conversation.repository';
import type { ResponseLanguage } from './types';

const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'http://fitness-service:3002'
    : 'http://localhost:3002');

const TZ = 'Asia/Ho_Chi_Minh';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'all';
export type NutritionScheduleSource =
  | 'nutrition_log'
  | 'meal_plan'
  | 'generated_plan_json'
  | 'nutrition_goal'
  | 'none';

export interface NutritionLookupIntent {
  enabled: boolean;
  rawMessage?: string;
  normalizedMessage?: string;
  inheritedIntent?: boolean;
  targetDate?: string;
  mealType: MealType;
  reason?: string;
}

export interface NutritionFood {
  name: string;
  quantity?: number | string | null;
  unit?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  notes?: string | null;
}

export interface NutritionMeal {
  mealType: MealType;
  title?: string | null;
  foods: NutritionFood[];
  totals?: {
    calories?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
  };
  notes?: string | null;
}

export interface NutritionScheduleContext {
  targetDate?: string;
  mealType: MealType;
  nutritionPlanName?: string;
  dailyCaloriesTarget?: number | null;
  proteinTarget?: number | null;
  carbTarget?: number | null;
  fatTarget?: number | null;
  plannedMealsFound: boolean;
  meals: NutritionMeal[];
  source: NutritionScheduleSource;
  message?: string;
}

function authHeaders(authorizationHeader?: string): Record<string, string> | undefined {
  if (!authorizationHeader) return undefined;
  return { Authorization: authorizationHeader };
}

function unwrap<T>(res: { data: any }): T {
  return (res.data?.data ?? res.data) as T;
}

export function normalizeNutritionText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDateInTz(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateFromDateOnly(dateOnly: string): Date {
  return new Date(`${dateOnly}T12:00:00+07:00`);
}

function addDays(dateOnly: string, days: number): string {
  const d = dateFromDateOnly(dateOnly);
  d.setDate(d.getDate() + days);
  return formatDateInTz(d);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function parseExplicitDate(q: string, today: string): string | undefined {
  const currentYear = Number(today.slice(0, 4));
  const numeric = q.match(/\b(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : currentYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const vi = q.match(/\b(?:ngay\s*)?(\d{1,2})\s*thang\s*(\d{1,2})(?:\s*nam\s*(\d{2,4}))?\b/);
  if (vi) {
    const day = Number(vi[1]);
    const month = Number(vi[2]);
    const year = vi[3] ? Number(vi[3].length === 2 ? `20${vi[3]}` : vi[3]) : currentYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const monthNumbers: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  const en = q.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{1,2})(?:,?\s*(\d{2,4}))?\b/);
  if (en) {
    const month = monthNumbers[en[1]];
    const day = Number(en[2]);
    const year = en[3] ? Number(en[3].length === 2 ? `20${en[3]}` : en[3]) : currentYear;
    if (month && day >= 1 && day <= 31) return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  return undefined;
}

function detectMealType(q: string): MealType {
  if (/\b(bua\s*sang|sang\s*mai|breakfast)\b/.test(q)) return 'breakfast';
  if (/\b(bua\s*trua|trua\s*mai|lunch)\b/.test(q)) return 'lunch';
  if (/\b(bua\s*toi|toi\s*mai|dinner)\b/.test(q)) return 'dinner';
  if (/\b(bua\s*phu|snack)\b/.test(q)) return 'snack';
  return 'all';
}

function hasNutritionSignal(q: string): boolean {
  return /\b(an|uong|thuc\s*don|bua|meal|meal\s*plan|nutrition|diet|calo|calories|macro|protein|carb|fat|dam|chat\s*beo|dinh\s*duong)\b/.test(q);
}

function hasWorkoutSignal(q: string): boolean {
  return /\b(tap|lich\s*tap|buoi\s*tap|workout|training|exercise|gym|sets?|reps?)\b/.test(q);
}

function hasDateSignal(q: string): boolean {
  return /\b(hom\s*nay|ngay\s*mai|mai|today|tomorrow|ngay\s+\d{1,2}|thang\s+\d{1,2}|\d{1,2}\s*[/-]\s*\d{1,2})\b/.test(q);
}

function isNutritionConversation(chatHistory?: any[]): boolean {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return false;
  return chatHistory.slice(0, 4).some((entry) => {
    const text = normalizeNutritionText(`${entry?.question ?? ''} ${entry?.answer ?? ''}`);
    return /(thuc\s*don|bua|an\s*gi|nutrition|meal|calo|macro|protein|carb|fat|dinh\s*duong)/.test(text);
  });
}

export function detectNutritionLookupIntent(question: string, chatHistory?: any[]): NutritionLookupIntent {
  const q = normalizeNutritionText(question);
  const today = formatDateInTz(new Date());
  const inheritedIntent = isNutritionConversation(chatHistory);
  const explicitDate = parseExplicitDate(q, today);
  const mealType = detectMealType(q);
  const nutritionSignal = hasNutritionSignal(q);
  const dateSignal = hasDateSignal(q) || explicitDate !== undefined;
  const shortFollowUp = /^(con|vay|thi\s*sao|ngay\s*mai|mai|hom\s*nay|today|tomorrow|ngay|\d{1,2}\s*[/-])/.test(q);

  const workoutSignal = hasWorkoutSignal(q);
  const enabled = nutritionSignal || (inheritedIntent && !workoutSignal && (dateSignal || shortFollowUp));
  if (!enabled) {
    return {
      enabled: false,
      rawMessage: question,
      normalizedMessage: q,
      inheritedIntent,
      mealType,
    };
  }

  const targetDate = explicitDate
    ?? (/\b(ngay\s*mai|mai|tomorrow)\b/.test(q) ? addDays(today, 1) : today);

  return {
    enabled: true,
    rawMessage: question,
    normalizedMessage: q,
    inheritedIntent,
    targetDate,
    mealType,
    reason: nutritionSignal ? 'nutrition_keyword' : 'nutrition_follow_up_context',
  };
}

function mealLabel(mealType: MealType, language: ResponseLanguage): string {
  if (language !== 'vi') {
    return {
      breakfast: 'breakfast',
      lunch: 'lunch',
      dinner: 'dinner',
      snack: 'snack',
      all: 'all meals',
    }[mealType];
  }
  return {
    breakfast: 'bữa sáng',
    lunch: 'bữa trưa',
    dinner: 'bữa tối',
    snack: 'bữa phụ',
    all: 'các bữa',
  }[mealType];
}

export function nutritionSourceLabel(source: NutritionScheduleSource, language: ResponseLanguage = 'vi'): string {
  if (language !== 'vi') {
    return {
      nutrition_log: 'Nutrition log',
      meal_plan: 'Saved nutrition plan',
      generated_plan_json: 'Saved AI plan',
      nutrition_goal: 'Saved nutrition goal',
      none: 'No stored data',
    }[source];
  }
  return {
    nutrition_log: 'Nhật ký dinh dưỡng',
    meal_plan: 'Kế hoạch dinh dưỡng đã lưu',
    generated_plan_json: 'Kế hoạch AI đã lưu',
    nutrition_goal: 'Mục tiêu dinh dưỡng đã lưu',
    none: 'Không có dữ liệu',
  }[source];
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapLogToMeal(logs: any[], mealType: MealType): NutritionMeal {
  const foods = logs.map((log) => ({
    name: String(log.foodName ?? log.name ?? 'Món ăn'),
    quantity: log.quantity ?? null,
    unit: log.unit ?? null,
    calories: numberOrNull(log.calories),
    protein: numberOrNull(log.protein),
    carbs: numberOrNull(log.carbs),
    fat: numberOrNull(log.fats ?? log.fat),
    notes: log.notes ?? null,
  }));
  return {
    mealType,
    foods,
    totals: foods.reduce(
      (sum, food) => ({
        calories: Number(sum.calories ?? 0) + Number(food.calories ?? 0),
        protein: Number(sum.protein ?? 0) + Number(food.protein ?? 0),
        carbs: Number(sum.carbs ?? 0) + Number(food.carbs ?? 0),
        fat: Number(sum.fat ?? 0) + Number(food.fat ?? 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    ),
  };
}

function mapProgramMeal(meal: any): NutritionMeal {
  const mealType = String(meal.mealType ?? '').toLowerCase() as MealType;
  const foods = (Array.isArray(meal.items) ? meal.items : []).map((item: any) => ({
    name: String(item.foodName ?? item.customFoodName ?? item.food?.name ?? item.name ?? 'Món ăn'),
    quantity: item.quantity ?? null,
    unit: item.unit ?? null,
    calories: numberOrNull(item.calories),
    protein: numberOrNull(item.proteinGrams ?? item.protein),
    carbs: numberOrNull(item.carbGrams ?? item.carbs),
    fat: numberOrNull(item.fatGrams ?? item.fat),
    notes: item.notes ?? null,
  }));
  return {
    mealType: ['breakfast', 'lunch', 'dinner', 'snack'].includes(mealType) ? mealType : 'all',
    title: meal.title ?? meal.name ?? null,
    foods,
    totals: {
      calories: numberOrNull(meal.tableTotals?.calories ?? meal.plannedTotals?.calories ?? meal.calories),
      protein: numberOrNull(meal.tableTotals?.protein ?? meal.plannedTotals?.protein ?? meal.proteinGrams),
      carbs: numberOrNull(meal.tableTotals?.carbs ?? meal.plannedTotals?.carbs ?? meal.carbGrams),
      fat: numberOrNull(meal.tableTotals?.fat ?? meal.plannedTotals?.fat ?? meal.fatGrams),
    },
    notes: meal.notes ?? null,
  };
}

function filterMeals(meals: NutritionMeal[], mealType: MealType): NutritionMeal[] {
  if (mealType === 'all') return meals;
  return meals.filter((meal) => meal.mealType === mealType);
}

async function fetchNutritionLogs(intent: NutritionLookupIntent, authHeader?: string): Promise<any[]> {
  if (!authHeader || !intent.targetDate) return [];
  const params: Record<string, string> = {
    startDate: intent.targetDate,
    endDate: intent.targetDate,
  };
  if (intent.mealType !== 'all') params.mealType = intent.mealType;
  const res = await axios.get(`${FITNESS_SERVICE_URL}/nutrition`, {
    headers: authHeaders(authHeader),
    params,
    timeout: 3500,
  });
  const data = unwrap<any>(res);
  return Array.isArray(data) ? data : Array.isArray(data?.logs) ? data.logs : [];
}

async function fetchDailyTask(intent: NutritionLookupIntent, authHeader?: string): Promise<any | null> {
  if (!authHeader || !intent.targetDate) return null;
  const res = await axios.get(`${FITNESS_SERVICE_URL}/nutrition/daily-task`, {
    headers: authHeaders(authHeader),
    params: { date: intent.targetDate },
    timeout: 3500,
  });
  return unwrap<any>(res);
}

async function fetchGoal(authHeader?: string): Promise<any | null> {
  if (!authHeader) return null;
  const res = await axios.get(`${FITNESS_SERVICE_URL}/nutrition/goals`, {
    headers: authHeaders(authHeader),
    timeout: 3500,
  });
  return unwrap<any>(res);
}

function contextFromLogs(intent: NutritionLookupIntent, logs: any[]): NutritionScheduleContext | null {
  if (!logs.length) return null;
  const grouped = new Map<MealType, any[]>();
  for (const log of logs) {
    const key = String(log.mealType ?? 'all').toLowerCase() as MealType;
    const mealType: MealType = ['breakfast', 'lunch', 'dinner', 'snack'].includes(key) ? key : 'all';
    grouped.set(mealType, [...(grouped.get(mealType) ?? []), log]);
  }
  const meals = Array.from(grouped.entries()).map(([mealType, mealLogs]) => mapLogToMeal(mealLogs, mealType));
  const filtered = filterMeals(meals, intent.mealType);
  if (!filtered.length) return null;
  return {
    targetDate: intent.targetDate,
    mealType: intent.mealType,
    plannedMealsFound: true,
    meals: filtered,
    source: 'nutrition_log',
  };
}

function contextFromDailyTask(intent: NutritionLookupIntent, task: any): NutritionScheduleContext | null {
  if (!task) return null;
  const allMeals = Array.isArray(task.meals) ? task.meals.map(mapProgramMeal) : [];
  const meals = filterMeals(allMeals, intent.mealType).filter((meal) => meal.foods.length > 0);
  const program = task.program ?? null;
  if (meals.length > 0) {
    return {
      targetDate: intent.targetDate,
      mealType: intent.mealType,
      nutritionPlanName: program?.name,
      dailyCaloriesTarget: numberOrNull(program?.dailyCaloriesTarget ?? task.day?.totalCalories),
      proteinTarget: numberOrNull(program?.proteinTargetGrams ?? task.day?.proteinGrams),
      carbTarget: numberOrNull(program?.carbTargetGrams ?? task.day?.carbGrams),
      fatTarget: numberOrNull(program?.fatTargetGrams ?? task.day?.fatGrams),
      plannedMealsFound: true,
      meals,
      source: 'meal_plan',
      message: task.message,
    };
  }
  if (program) {
    return {
      targetDate: intent.targetDate,
      mealType: intent.mealType,
      nutritionPlanName: program.name,
      dailyCaloriesTarget: numberOrNull(program.dailyCaloriesTarget),
      proteinTarget: numberOrNull(program.proteinTargetGrams),
      carbTarget: numberOrNull(program.carbTargetGrams),
      fatTarget: numberOrNull(program.fatTargetGrams),
      plannedMealsFound: false,
      meals: [],
      source: 'nutrition_goal',
      message: task.message,
    };
  }
  return null;
}

function candidateMealsFromPlan(plan: any): any[] {
  const content = plan?.plan ?? {};
  const candidates = [
    content.meals,
    content.mealPlan?.meals,
    content.weeklyMealPlan,
    content.nutrition?.meals,
    content.nutrition_plan?.meals,
  ];
  return candidates.flatMap((value) => Array.isArray(value) ? value : []);
}

function contextFromGeneratedPlan(intent: NutritionLookupIntent, plan: any): NutritionScheduleContext | null {
  const meals = candidateMealsFromPlan(plan).map((meal: any) => {
    const mealTypeRaw = normalizeNutritionText(String(meal.mealType ?? meal.type ?? meal.mealName ?? meal.name ?? 'all'));
    const mealType = detectMealType(mealTypeRaw);
    const foodValues = Array.isArray(meal.foods)
      ? meal.foods
      : Array.isArray(meal.items)
        ? meal.items
        : [];
    const foods = foodValues.map((food: any) => {
      if (typeof food === 'string') return { name: food };
      return {
        name: String(food.name ?? food.foodName ?? food.customFoodName ?? 'Món ăn'),
        quantity: food.quantity ?? null,
        unit: food.unit ?? null,
        calories: numberOrNull(food.calories),
        protein: numberOrNull(food.protein ?? food.proteinGrams),
        carbs: numberOrNull(food.carbs ?? food.carbGrams),
        fat: numberOrNull(food.fat ?? food.fatGrams),
      };
    });
    return { mealType, title: meal.title ?? meal.name ?? null, foods } as NutritionMeal;
  });
  const filtered = filterMeals(meals, intent.mealType).filter((meal) => meal.foods.length > 0);
  if (!filtered.length) return null;
  return {
    targetDate: intent.targetDate,
    mealType: intent.mealType,
    nutritionPlanName: plan.name,
    plannedMealsFound: true,
    meals: filtered,
    source: 'generated_plan_json',
  };
}

function contextFromGoal(intent: NutritionLookupIntent, goal: any): NutritionScheduleContext | null {
  if (!goal) return null;
  return {
    targetDate: intent.targetDate,
    mealType: intent.mealType,
    dailyCaloriesTarget: numberOrNull(goal.calories),
    proteinTarget: numberOrNull(goal.protein),
    carbTarget: numberOrNull(goal.carbs),
    fatTarget: numberOrNull(goal.fat),
    plannedMealsFound: false,
    meals: [],
    source: 'nutrition_goal',
  };
}

function emptyContext(intent: NutritionLookupIntent, message?: string): NutritionScheduleContext {
  return {
    targetDate: intent.targetDate,
    mealType: intent.mealType,
    plannedMealsFound: false,
    meals: [],
    source: 'none',
    message,
  };
}

export function buildNutritionContextBlock(context: NutritionScheduleContext): string {
  const lines = [
    'USER_NUTRITION_CONTEXT',
    `targetDate=${context.targetDate ?? 'unknown'}`,
    `mealType=${context.mealType}`,
    `nutritionPlanName=${context.nutritionPlanName ?? 'none'}`,
    `plannedMealsFound=${context.plannedMealsFound}`,
    `dailyCaloriesTarget=${context.dailyCaloriesTarget ?? 'unknown'}`,
    `proteinTarget=${context.proteinTarget ?? 'unknown'}`,
    `carbTarget=${context.carbTarget ?? 'unknown'}`,
    `fatTarget=${context.fatTarget ?? 'unknown'}`,
    `source=${context.source}`,
  ];
  for (const meal of context.meals.slice(0, 8)) {
    lines.push(`meal=${meal.mealType} | title=${meal.title ?? mealLabel(meal.mealType, 'en')} | foods=${meal.foods.length}`);
    for (const food of meal.foods.slice(0, 12)) {
      lines.push(`- ${food.name} | qty=${food.quantity ?? '?'}${food.unit ?? ''} | kcal=${food.calories ?? '?'}`);
    }
  }
  if (context.message) lines.push(`message=${context.message}`);
  return lines.join('\n');
}

function formatTargets(context: NutritionScheduleContext, language: ResponseLanguage): string | null {
  const parts = [
    context.dailyCaloriesTarget != null ? `${Math.round(context.dailyCaloriesTarget)} kcal` : null,
    context.proteinTarget != null ? `${Math.round(context.proteinTarget)}g protein` : null,
    context.carbTarget != null ? `${Math.round(context.carbTarget)}g carb` : null,
    context.fatTarget != null ? `${Math.round(context.fatTarget)}g fat` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return language === 'vi'
    ? `Mục tiêu đang lưu: ${parts.join(' | ')}.`
    : `Saved targets: ${parts.join(' | ')}.`;
}

export function formatNutritionAnswer(context: NutritionScheduleContext, language: ResponseLanguage): string {
  const isVi = language === 'vi';
  const targetLabel = [mealLabel(context.mealType, language), context.targetDate].filter(Boolean).join(' ');
  if (!context.plannedMealsFound || !context.meals.length) {
    const targetLine = formatTargets(context, language);
    const base = isVi
      ? `Mình chưa thấy thực đơn cụ thể được lưu cho ${targetLabel}.`
      : `I cannot find a stored meal plan for ${targetLabel}.`;
    return [base, targetLine, isVi ? `Nguồn: ${nutritionSourceLabel(context.source, language)}.` : `Source: ${nutritionSourceLabel(context.source, language)}.`]
      .filter(Boolean)
      .join('\n');
  }

  const lines = [
    isVi
      ? `Theo dữ liệu đã lưu, ${targetLabel} của bạn gồm:`
      : `Based on your saved nutrition data, ${targetLabel} includes:`,
    '',
  ];
  for (const meal of context.meals) {
    lines.push(`### ${mealLabel(meal.mealType, language)}${meal.title ? ` - ${meal.title}` : ''}`);
    for (const food of meal.foods) {
      const qty = food.quantity != null ? ` (${food.quantity}${food.unit ?? ''})` : '';
      const kcal = food.calories != null ? ` - ${Math.round(food.calories)} kcal` : '';
      lines.push(`- ${food.name}${qty}${kcal}`);
    }
    if (meal.totals?.calories != null) {
      lines.push(`Tổng: ${Math.round(meal.totals.calories)} kcal | Protein ${Math.round(Number(meal.totals.protein ?? 0))}g | Carb ${Math.round(Number(meal.totals.carbs ?? 0))}g | Fat ${Math.round(Number(meal.totals.fat ?? 0))}g`);
    }
    lines.push('');
  }
  const targetLine = formatTargets(context, language);
  if (targetLine) lines.push(targetLine);
  lines.push(isVi ? `Nguồn: ${nutritionSourceLabel(context.source, language)}.` : `Source: ${nutritionSourceLabel(context.source, language)}.`);
  return lines.filter(Boolean).join('\n');
}

export const nutritionContextResolver = {
  async resolve(intent: NutritionLookupIntent, userId?: string, authHeader?: string): Promise<NutritionScheduleContext> {
    if (!intent.enabled || !userId) return emptyContext(intent);

    try {
      const logs = await fetchNutritionLogs(intent, authHeader);
      const logContext = contextFromLogs(intent, logs);
      if (logContext) return logContext;
    } catch (err) {
      logger.warn({ err }, 'Failed to load nutrition logs for AI coach');
    }

    try {
      const task = await fetchDailyTask(intent, authHeader);
      const taskContext = contextFromDailyTask(intent, task);
      if (taskContext?.plannedMealsFound) return taskContext;
      if (taskContext?.source === 'nutrition_goal') {
        const goal = await fetchGoal(authHeader).catch(() => null);
        return contextFromGoal(intent, goal) ?? taskContext;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load nutrition daily task for AI coach');
    }

    try {
      const plans = await conversationRepository.findNutritionPlansByUser(userId, PlanStatus.COMPLETED, 5);
      for (const plan of plans) {
        const planContext = contextFromGeneratedPlan(intent, plan);
        if (planContext?.plannedMealsFound) return planContext;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load generated AI nutrition plans for AI coach');
    }

    try {
      const goal = await fetchGoal(authHeader);
      const goalContext = contextFromGoal(intent, goal);
      if (goalContext) return goalContext;
    } catch (err) {
      logger.warn({ err }, 'Failed to load nutrition goals for AI coach');
    }

    return emptyContext(intent, 'No stored nutrition schedule found.');
  },

  debug(intent: NutritionLookupIntent, context: NutritionScheduleContext, userId?: string): void {
    if (process.env.DEBUG_INTENT_ROUTING !== 'true') return;
    logger.info({
      userId,
      rawMessage: intent.rawMessage,
      normalizedMessage: intent.normalizedMessage,
      detectedIntent: 'nutrition_schedule_lookup',
      intentReason: intent.reason,
      inheritedIntent: intent.inheritedIntent ?? false,
      targetDate: intent.targetDate,
      mealType: intent.mealType,
      workoutLookupCalled: false,
      nutritionLookupCalled: true,
      scheduleSource: context.source,
      plannedMealsFound: context.plannedMealsFound,
    }, 'AI coach intent routing resolved');
  },
};
