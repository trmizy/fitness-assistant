import { z } from 'zod';
import { safeParseJsonCandidate } from '../utils/json';

// ── Request schemas ──────────────────────────────────────────────────────────

export const GenerateNutritionPlanRequestSchema = z.object({
  // ── Core ──────────────────────────────────────────────────────────────────
  goal: z.string().min(1).max(200),
  durationWeeks: z.number().int().min(1).max(1, {
    message: 'Kế hoạch dinh dưỡng AI hiện chỉ hỗ trợ tối đa 1 tuần.',
  }).default(1),
  mealsPerDay: z.number().int().min(2).max(6).default(3),
  dailyCaloriesTarget: z.number().int().min(500).max(10000).optional(),
  dietPreference: z.string().max(100).optional(),
  budgetLevel: z.string().max(50).optional(),
  restrictions: z.array(z.string().max(200)).max(20).optional(),
  notes: z.string().max(1000).optional(),

  // ── Body stats ────────────────────────────────────────────────────────────
  weightKg: z.number().min(30).max(300).optional(),
  heightCm: z.number().min(100).max(250).optional(),
  age: z.number().int().min(10).max(100).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  bodyFatPct: z.number().min(1).max(60).optional(),

  // ── Activity & training ───────────────────────────────────────────────────
  activityLevel: z.enum(['SEDENTARY', 'LIGHT', 'MODERATE', 'HIGH', 'VERY_HIGH']).optional(),
  trainingDaysPerWeek: z.number().int().min(0).max(7).optional(),
  trainingDurationMin: z.number().int().min(10).max(300).optional(),
  trainingType: z.string().max(100).optional(),

  // ── Advanced phase ────────────────────────────────────────────────────────
  trainingPhase: z.string().max(100).optional(),
  experienceLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ATHLETE']).optional(),
  primaryPriority: z.string().max(200).optional(),
  weightChangeRateKgPerWeek: z.number().min(-2).max(2).optional(),

  // ── Macro preferences ─────────────────────────────────────────────────────
  proteinTargetG: z.number().min(50).max(500).optional(),
  carbTargetG: z.number().min(0).max(1000).optional(),
  fatTargetG: z.number().min(20).max(300).optional(),
  carbsAroundWorkout: z.boolean().optional(),
  preworkoutMeal: z.boolean().optional(),
  postworkoutMeal: z.boolean().optional(),
});

export type GenerateNutritionPlanRequest = z.infer<typeof GenerateNutritionPlanRequestSchema>;

export const SaveNutritionPlanToNutritionRequestSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD')
    .optional(),
  repeatEnabled: z.boolean().optional().default(false),
  forceArchive: z.boolean().optional().default(false),
  repeatWeeks: z.number().int().min(1).max(1, {
    message: 'Kế hoạch dinh dưỡng AI hiện chỉ hỗ trợ lưu 1 tuần.',
  }).optional().default(1),
});

export type SaveNutritionPlanToNutritionRequest = z.infer<typeof SaveNutritionPlanToNutritionRequestSchema>;

// ── LLM output schema ────────────────────────────────────────────────────────

export const NutritionMealItemSchema = z.object({
  foodId: z.string().min(1).optional(),
  customFoodName: z.string().max(200).optional(),
  name: z.string().min(1).max(200),
  quantity: z.number().min(0).max(5000).default(100),
  unit: z.string().max(20).default('g'),
  calories: z.number().int().min(0).max(5000),
  protein: z.number().min(0).max(1000),
  carbs: z.number().min(0).max(1000),
  fat: z.number().min(0).max(1000),
  notes: z.string().max(300).optional(),
});

export const NutritionMealSchema = z.object({
  mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']),
  title: z.string().min(1).max(200),
  calories: z.number().int().min(0).max(10000),
  protein: z.number().min(0).max(1000),
  carbs: z.number().min(0).max(1000),
  fat: z.number().min(0).max(1000),
  items: z.array(NutritionMealItemSchema).min(1).max(20),
  notes: z.string().max(500).optional(),
});

export const NutritionDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(7),
  title: z.string().min(1).max(200),
  totalCalories: z.number().int().min(0).max(15000),
  protein: z.number().min(0).max(1000),
  carbs: z.number().min(0).max(1000),
  fat: z.number().min(0).max(1000),
  meals: z.array(NutritionMealSchema).min(1).max(6),
});

export const NutritionPlanContentSchema = z.object({
  goal: z.string().min(1).max(200),
  durationWeeks: z.number().int().min(1).max(1),
  mealsPerDay: z.number().int().min(1).max(6),
  dailyCaloriesTarget: z.number().int().min(500).max(10000),
  proteinTargetGrams: z.number().min(0).max(1000),
  carbTargetGrams: z.number().min(0).max(2000),
  fatTargetGrams: z.number().min(0).max(1000),
  weeklySchedule: z.array(NutritionDaySchema).min(1).max(7),
  generalNotes: z.array(z.string().max(500)).max(20).optional(),
  shoppingTips: z.array(z.string().max(500)).max(20).optional(),
});

export type NutritionPlanContent = z.infer<typeof NutritionPlanContentSchema>;
export type NutritionDay = z.infer<typeof NutritionDaySchema>;
export type NutritionMeal = z.infer<typeof NutritionMealSchema>;
export type NutritionMealItem = z.infer<typeof NutritionMealItemSchema>;

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeNutritionCandidate(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const source = parsed as Record<string, any>;
  const weekly = Array.isArray(source.weeklyMealPlan)
    ? source.weeklyMealPlan
    : Array.isArray(source.weeklySchedule)
      ? source.weeklySchedule
      : [];

  const mealsPerDay = Math.min(6, Math.max(1, Math.trunc(asNumber(source.mealsPerDay, 3))));
  const dailyCaloriesTarget = Math.trunc(asNumber(source.dailyCaloriesTarget, 2000));

  return {
    goal: asString(source.goal, 'Dinh dưỡng'),
    durationWeeks: 1,
    mealsPerDay,
    dailyCaloriesTarget,
    proteinTargetGrams: asNumber(source.proteinTargetGrams ?? source.macroTargets?.proteinGrams, 150),
    carbTargetGrams: asNumber(source.carbTargetGrams ?? source.macroTargets?.carbGrams, 200),
    fatTargetGrams: asNumber(source.fatTargetGrams ?? source.macroTargets?.fatGrams, 65),
    weeklySchedule: weekly.slice(0, 7).map((day: any, dayIndex: number) => {
      const meals = Array.isArray(day?.meals) ? day.meals : [];
      return {
        dayNumber: Math.trunc(asNumber(day?.dayNumber ?? day?.day, dayIndex + 1)),
        title: asString(day?.title, `Ngày ${dayIndex + 1}`),
        totalCalories: Math.trunc(asNumber(day?.totalCalories ?? day?.dailyCaloriesTarget, dailyCaloriesTarget)),
        protein: asNumber(day?.protein ?? day?.proteinGrams, 0),
        carbs: asNumber(day?.carbs ?? day?.carbGrams, 0),
        fat: asNumber(day?.fat ?? day?.fatGrams, 0),
        meals: meals.slice(0, 6).map((meal: any) => {
          const items = Array.isArray(meal?.items) ? meal.items : [];
          return {
            mealType: asString(meal?.mealType, 'SNACK').toUpperCase(),
            title: asString(meal?.title, asString(meal?.mealType, 'Bữa ăn')),
            calories: Math.trunc(asNumber(meal?.calories ?? meal?.totalCalories, 0)),
            protein: asNumber(meal?.protein ?? meal?.proteinGrams, 0),
            carbs: asNumber(meal?.carbs ?? meal?.carbGrams, 0),
            fat: asNumber(meal?.fat ?? meal?.fatGrams ?? meal?.fats, 0),
            notes: typeof meal?.notes === 'string' ? meal.notes : typeof meal?.note === 'string' ? meal.note : undefined,
            items: items.map((item: any) => ({
              foodId: typeof item?.foodId === 'string' && item.foodId.trim() ? item.foodId.trim() : undefined,
              customFoodName: typeof item?.customFoodName === 'string' && item.customFoodName.trim() ? item.customFoodName.trim() : undefined,
              name: asString(item?.name ?? item?.customFoodName, 'Thực phẩm'),
              quantity: asNumber(item?.quantity ?? item?.amount, 100),
              unit: asString(item?.unit, 'g'),
              calories: Math.trunc(asNumber(item?.calories, 0)),
              protein: asNumber(item?.protein ?? item?.proteinGrams, 0),
              carbs: asNumber(item?.carbs ?? item?.carbGrams, 0),
              fat: asNumber(item?.fat ?? item?.fatGrams ?? item?.fats, 0),
              notes: typeof item?.notes === 'string' ? item.notes : typeof item?.note === 'string' ? item.note : undefined,
            })),
          };
        }),
      };
    }),
    generalNotes: Array.isArray(source.nutritionNotes) ? source.nutritionNotes : source.generalNotes,
    shoppingTips: source.shoppingTips,
  };
}

// ── Prompt builder ────────────────────────────────────────────────────────────

const GOAL_LABELS: Record<string, string> = {
  FAT_LOSS: 'Giảm mỡ',
  WEIGHT_LOSS: 'Giảm mỡ',
  MUSCLE_GAIN: 'Tăng cơ',
  MAINTENANCE: 'Duy trì sức khỏe',
  WEIGHT_GAIN: 'Tăng cân',
  CUTTING: 'Cutting (siết mỡ, giữ cơ)',
  BULKING: 'Bulking (tăng cơ, calo cao)',
  LEAN_BULK: 'Lean Bulk (tăng cơ sạch)',
  RECOMPOSITION: 'Recomposition',
  PERFORMANCE: 'Tăng hiệu suất',
};

export function buildNutritionPlanPrompt(params: {
  goal: string;
  durationWeeks: number;
  mealsPerDay: number;
  dailyCaloriesTarget?: number;
  dietPreference?: string;
  budgetLevel?: string;
  restrictions?: string[];
  // Extended advanced fields
  weightKg?: number;
  heightCm?: number;
  age?: number;
  gender?: string;
  bodyFatPct?: number;
  activityLevel?: string;
  trainingDaysPerWeek?: number;
  trainingDurationMin?: number;
  trainingType?: string;
  trainingPhase?: string;
  experienceLevel?: string;
  primaryPriority?: string;
  weightChangeRateKgPerWeek?: number;
  proteinTargetG?: number;
  carbTargetG?: number;
  fatTargetG?: number;
  carbsAroundWorkout?: boolean;
  preworkoutMeal?: boolean;
  postworkoutMeal?: boolean;
  allowedFoods: Array<{ id: string; name: string; calories: number; protein: number; carbs: number; fat?: number; fats?: number }>;
  userProfile?: { height?: number; weight?: number; age?: number; gender?: string };
}): string {
  const { goal, mealsPerDay, dailyCaloriesTarget, dietPreference, budgetLevel, restrictions, allowedFoods } = params;

  const goalLabel = GOAL_LABELS[goal.toUpperCase()] || goal;
  const calTarget = dailyCaloriesTarget || (
    ['FAT_LOSS', 'WEIGHT_LOSS', 'CUTTING'].includes(goal.toUpperCase()) ? 1700 :
    ['MUSCLE_GAIN', 'BULKING'].includes(goal.toUpperCase()) ? 2800 :
    ['LEAN_BULK'].includes(goal.toUpperCase()) ? 2400 : 2000
  );

  // Diet & budget
  const budgetNote = budgetLevel === 'student' ? 'Ưu tiên thực phẩm rẻ, phổ biến (ức gà, trứng, đậu hũ, cơm, chuối).' : '';
  const dietNote = dietPreference === 'low_carb' ? 'Chế độ ít tinh bột (<100g carb/ngày).' :
    dietPreference === 'high_protein' ? 'Chế độ nhiều protein (>35% tổng calo từ protein).' :
    dietPreference === 'low_fat' ? 'Chế độ ít chất béo (<20% calo từ fat).' :
    dietPreference === 'vegetarian' ? 'Chế độ ăn chay. KHÔNG dùng thịt, cá, hải sản.' : '';

  const restrictionNote = restrictions && restrictions.length > 0
    ? `Hạn chế bắt buộc: ${restrictions.join('; ')}. KHÔNG được đưa bất kỳ món nào vi phạm các hạn chế này.`
    : '';

  // Body profile
  const profileParts: string[] = [];
  const w = params.weightKg ?? params.userProfile?.weight;
  const h = params.heightCm ?? params.userProfile?.height;
  const a = params.age ?? params.userProfile?.age;
  const g = params.gender ?? params.userProfile?.gender;
  if (w) profileParts.push(`Cân nặng: ${w}kg`);
  if (h) profileParts.push(`Chiều cao: ${h}cm`);
  if (a) profileParts.push(`Tuổi: ${a}`);
  if (g) profileParts.push(`Giới tính: ${g === 'MALE' ? 'Nam' : g === 'FEMALE' ? 'Nữ' : 'Khác'}`);
  if (params.bodyFatPct) profileParts.push(`Body fat ~${params.bodyFatPct}%`);
  const profileNote = profileParts.length > 0 ? `Thông tin cơ thể: ${profileParts.join(', ')}.` : '';

  // Activity & training
  const actMap: Record<string, string> = { SEDENTARY: 'ít vận động', LIGHT: 'nhẹ', MODERATE: 'trung bình', HIGH: 'cao', VERY_HIGH: 'rất cao' };
  const trainingParts: string[] = [];
  if (params.activityLevel) trainingParts.push(`Mức vận động: ${actMap[params.activityLevel] ?? params.activityLevel}`);
  if (params.trainingDaysPerWeek !== undefined) trainingParts.push(`${params.trainingDaysPerWeek} buổi/tuần`);
  if (params.trainingDurationMin) trainingParts.push(`${params.trainingDurationMin} phút/buổi`);
  if (params.trainingType) trainingParts.push(`Loại tập: ${params.trainingType}`);
  const trainingNote = trainingParts.length > 0 ? `Lịch tập: ${trainingParts.join(', ')}.` : '';

  // Advanced phase
  const phaseMap: Record<string, string> = {
    cutting: 'Cutting (giảm mỡ, giữ cơ)', bulking: 'Bulking (thặng dư calo cao)',
    lean_bulk: 'Lean Bulk (thặng dư nhỏ ~200-300 kcal)', maintenance: 'Duy trì',
    contest_prep: 'Chuẩn bị thi đấu — dinh dưỡng rất chặt chẽ', deload: 'Deload (hồi phục)',
  };
  const advancedParts: string[] = [];
  if (params.trainingPhase) advancedParts.push(`Giai đoạn: ${phaseMap[params.trainingPhase] ?? params.trainingPhase}`);
  const expMap: Record<string, string> = { BEGINNER: 'Người mới', INTERMEDIATE: 'Trung cấp', ADVANCED: 'Nâng cao', ATHLETE: 'Vận động viên' };
  if (params.experienceLevel) advancedParts.push(`Kinh nghiệm: ${expMap[params.experienceLevel] ?? params.experienceLevel}`);
  if (params.primaryPriority) advancedParts.push(`Ưu tiên: ${params.primaryPriority}`);
  if (params.weightChangeRateKgPerWeek !== undefined) {
    const dir = params.weightChangeRateKgPerWeek > 0 ? '+' : '';
    advancedParts.push(`Tốc độ thay đổi cân: ${dir}${params.weightChangeRateKgPerWeek} kg/tuần`);
  }
  const advancedNote = advancedParts.length > 0 ? advancedParts.join('. ') + '.' : '';

  // Macro preferences
  const macroParts: string[] = [];
  if (params.proteinTargetG) macroParts.push(`Protein ${params.proteinTargetG}g`);
  if (params.carbTargetG !== undefined) macroParts.push(`Carbs ${params.carbTargetG}g`);
  if (params.fatTargetG) macroParts.push(`Fat ${params.fatTargetG}g`);
  const macroNote = macroParts.length > 0 ? `Macro mục tiêu: ${macroParts.join(', ')}/ngày.` : '';
  const workoutMealNote = [
    params.carbsAroundWorkout ? 'Phân bổ carbs tập trung trước/sau buổi tập.' : '',
    params.preworkoutMeal ? 'Cần có bữa trước tập (nhẹ, dễ tiêu).' : '',
    params.postworkoutMeal ? 'Cần có bữa sau tập (protein + carbs để phục hồi).' : '',
  ].filter(Boolean).join(' ');

  const promptFoods = allowedFoods.slice(0, 45);
  const sampleFood1 = promptFoods[0];
  const sampleFood2 = promptFoods[1] ?? promptFoods[0];
  const foodsForPrompt = promptFoods.map(f =>
    `${f.id} | ${f.name} | ${f.calories}kcal | P${f.protein}g | C${f.carbs}g | F${f.fat ?? f.fats ?? 0}g`
  ).join('\n');

  return `Bạn là chuyên gia dinh dưỡng thể thao. Tạo kế hoạch dinh dưỡng 1 tuần (7 ngày) cho mục tiêu: ${goalLabel}.

${profileNote}
${trainingNote}
${advancedNote}
${macroNote}
${workoutMealNote}
Mục tiêu calo: ~${calTarget} kcal/ngày.
Số bữa ăn/ngày: ${mealsPerDay}.
${budgetNote}
${dietNote}
${restrictionNote}

DANH SÁCH THỰC PHẨM ĐƯỢC PHÉP TỪ DB (foodId | tên | calo | protein | carbs | fat):
${foodsForPrompt}

YÊU CẦU NGHIÊM NGẶT:
1. durationWeeks luôn bằng 1.
2. weeklyMealPlan phải có đúng 7 ngày.
3. Mỗi ngày phải có đúng ${mealsPerDay} bữa.
4. Mỗi bữa nên có 1-2 items để JSON ngắn và hợp lệ.
5. Mỗi item thực phẩm phải dùng đúng foodId từ danh sách DB bên trên. Không tự bịa foodId.
6. Không dùng customFoodName, không để foodId trống.
7. Tổng calo mỗi ngày nên nằm trong ±200 kcal so với mục tiêu.
8. ${restrictionNote || 'Không có hạn chế đặc biệt.'}
9. Nếu mục tiêu là cutting/giảm mỡ: protein >= 1.8g/kg cân nặng, tránh dư calo.
10. Nếu mục tiêu là bulking/tăng cơ: calo vượt maintenance, carbs đủ năng lượng.
11. Tất cả title, note, nutritionNotes phải bằng tiếng Việt.
12. Chỉ trả về một JSON object thuần túy. Không markdown, không code fence, không giải thích ngoài JSON.

JSON FORMAT (dùng foodId thật từ DB):
{
  "goal": "${goalLabel}",
  "durationWeeks": 1,
  "mealsPerDay": ${mealsPerDay},
  "dailyCaloriesTarget": ${calTarget},
  "macroTargets": {
    "proteinGrams": 150,
    "carbGrams": 180,
    "fatGrams": 55
  },
  "weeklyMealPlan": [
    {
      "day": 1,
      "title": "Ngày 1",
      "meals": [
        {
          "mealType": "BREAKFAST",
          "title": "Bữa sáng",
          "items": [
            {
              "foodId": "${sampleFood1?.id ?? ''}",
              "name": "${sampleFood1?.name ?? 'Food from DB'}",
              "quantity": 150,
              "unit": "g",
              "calories": ${Math.trunc(sampleFood1?.calories ?? 200)},
              "proteinGrams": ${sampleFood1?.protein ?? 20},
              "carbGrams": ${sampleFood1?.carbs ?? 10},
              "fatGrams": ${sampleFood1?.fat ?? sampleFood1?.fats ?? 5},
              "note": "Chuẩn bị đơn giản"
            },
            {
              "foodId": "${sampleFood2?.id ?? ''}",
              "name": "${sampleFood2?.name ?? 'Food from DB'}",
              "quantity": 100,
              "unit": "g",
              "calories": ${Math.trunc(sampleFood2?.calories ?? 150)},
              "proteinGrams": ${sampleFood2?.protein ?? 10},
              "carbGrams": ${sampleFood2?.carbs ?? 20},
              "fatGrams": ${sampleFood2?.fat ?? sampleFood2?.fats ?? 3},
              "note": "Phối hợp theo mục tiêu macro"
            }
          ],
          "totalCalories": 400,
          "proteinGrams": 35,
          "carbGrams": 45,
          "fatGrams": 10
        }
      ],
      "totalCalories": ${calTarget},
      "proteinGrams": 150,
      "carbGrams": 180,
      "fatGrams": 55
    }
  ],
  "nutritionNotes": ["Ưu tiên đủ protein và kiểm soát tổng calo mỗi ngày."]
}`;
}

// ── JSON parsing helpers ──────────────────────────────────────────────────────

export function parseNutritionPlanContent(raw: string): { ok: true; content: NutritionPlanContent } | { ok: false; reason: string } {
  const parsed = safeParseJsonCandidate(raw);
  if (!parsed) {
    return { ok: false, reason: 'Unbalanced JSON braces or invalid format in LLM response' };
  }

  const result = NutritionPlanContentSchema.safeParse(normalizeNutritionCandidate(parsed));
  if (!result.success) {
    return { ok: false, reason: `Schema validation: ${result.error.issues.map(i => i.message).join(', ')}` };
  }
  return { ok: true, content: result.data };
}
