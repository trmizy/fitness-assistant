/**
 * CL-18, "Kế hoạch AI → Dinh dưỡng" — pure parts of web's `CurrentNutritionProgram.tsx`, with
 * bounds taken from ai-service's `GenerateNutritionPlanRequestSchema` (nutrition-plan.schemas.ts)
 * so a form the server would reject is caught before sending.
 *
 * An AI nutrition plan is a 7-day menu DRAFT. It becomes the client's real meal plan only when
 * saved ("Lưu vào Dinh dưỡng" → NutritionProgram). The authoritative calories/macros stay on
 * NutritionGoal — nothing here writes a goal.
 */

export const NUTRITION_GOALS = [
  "Giảm mỡ",
  "Tăng cơ",
  "Cutting",
  "Bulking",
  "Lean Bulk",
  "Recomposition",
  "Duy trì vóc dáng",
  "Cải thiện sức khỏe",
  "Tăng cân",
  "Siết cân thi đấu",
];

export const DIET_OPTIONS = [
  { value: "Không", label: "Không đặc biệt" },
  { value: "high_protein", label: "Nhiều đạm" },
  { value: "low_carb", label: "Ít tinh bột" },
  { value: "low_fat", label: "Ít béo" },
  { value: "Keto", label: "Keto" },
  { value: "vegetarian", label: "Chay" },
  { value: "Eat Clean", label: "Eat Clean" },
];
export const BUDGET_OPTIONS = [
  { value: "student", label: "Tiết kiệm" },
  { value: "normal", label: "Bình thường" },
  { value: "high", label: "Cao" },
];
export const ACTIVITY_OPTIONS = [
  { value: "SEDENTARY", label: "Ít vận động" },
  { value: "LIGHT", label: "Nhẹ" },
  { value: "MODERATE", label: "Trung bình" },
  { value: "HIGH", label: "Cao" },
  { value: "VERY_HIGH", label: "Rất cao" },
];
export const TRAINING_TYPE_OPTIONS = [
  { value: "weights", label: "Tạ kháng lực" },
  { value: "cardio", label: "Cardio" },
  { value: "mixed", label: "Kết hợp" },
  { value: "combat", label: "Đối kháng" },
  { value: "endurance", label: "Sức bền" },
];
export const PHASE_OPTIONS = [
  { value: "cutting", label: "Cutting" },
  { value: "bulking", label: "Bulking" },
  { value: "lean_bulk", label: "Lean Bulk" },
  { value: "maintenance", label: "Duy trì" },
  { value: "contest_prep", label: "Chuẩn bị thi đấu" },
  { value: "deload", label: "Deload" },
];
export const EXPERIENCE_OPTIONS_NUTRITION = [
  { value: "BEGINNER", label: "Mới bắt đầu" },
  { value: "INTERMEDIATE", label: "Trung cấp" },
  { value: "ADVANCED", label: "Nâng cao" },
  { value: "ATHLETE", label: "Vận động viên" },
];
export const GENDER_OPTIONS_NUTRITION = [
  { value: "MALE", label: "Nam" },
  { value: "FEMALE", label: "Nữ" },
];
export const RESTRICTION_PRESETS = [
  "Không cá biển",
  "Không hải sản",
  "Không sữa",
  "Không đậu phộng",
  "Không trứng",
  "Không thịt đỏ",
  "Không gluten",
  "Không đường",
];
export const MEAL_TYPE_LABELS: Record<string, string> = {
  BREAKFAST: "Bữa sáng",
  LUNCH: "Bữa trưa",
  DINNER: "Bữa tối",
  SNACK: "Bữa phụ",
};
const GOAL_LABELS: Record<string, string> = {
  FAT_LOSS: "Giảm mỡ",
  MUSCLE_GAIN: "Tăng cơ",
  MAINTENANCE: "Duy trì",
  WEIGHT_GAIN: "Tăng cân",
  WEIGHT_LOSS: "Giảm cân",
  IMPROVE_HEALTH: "Cải thiện sức khỏe",
};

export function nutritionGoalLabel(goal?: string | null): string {
  if (!goal) return "Chung";
  return GOAL_LABELS[goal.toUpperCase()] ?? goal;
}
export function mealTypeLabel(mt?: string | null): string {
  if (!mt) return "Bữa ăn";
  return MEAL_TYPE_LABELS[mt.toUpperCase()] ?? mt;
}

export type NutritionForm = {
  goal: string;
  mealsPerDay: number;
  dailyCaloriesTarget: string;
  dietPreference: string;
  budgetLevel: string;
  weightKg: string;
  heightCm: string;
  age: string;
  gender: string;
  bodyFatPct: string;
  activityLevel: string;
  trainingDaysPerWeek: string;
  trainingDurationMin: string;
  trainingType: string;
  trainingPhase: string;
  experienceLevel: string;
  primaryPriority: string;
  proteinTargetG: string;
  carbTargetG: string;
  fatTargetG: string;
  carbsAroundWorkout: boolean;
  preworkoutMeal: boolean;
  postworkoutMeal: boolean;
  restrictions: string[];
  customRestriction: string;
  notes: string;
};

export function defaultNutritionForm(): NutritionForm {
  return {
    goal: "Tăng cơ",
    mealsPerDay: 3,
    dailyCaloriesTarget: "",
    dietPreference: "Không",
    budgetLevel: "normal",
    weightKg: "",
    heightCm: "",
    age: "",
    gender: "",
    bodyFatPct: "",
    activityLevel: "MODERATE",
    trainingDaysPerWeek: "",
    trainingDurationMin: "",
    trainingType: "",
    trainingPhase: "",
    experienceLevel: "",
    primaryPriority: "",
    proteinTargetG: "",
    carbTargetG: "",
    fatTargetG: "",
    carbsAroundWorkout: false,
    preworkoutMeal: false,
    postworkoutMeal: false,
    restrictions: [],
    customRestriction: "",
    notes: "",
  };
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

const NUMERIC_BOUNDS: { key: keyof NutritionForm; label: string; min: number; max: number; int?: boolean }[] = [
  { key: "dailyCaloriesTarget", label: "Calo mỗi ngày", min: 500, max: 10000, int: true },
  { key: "weightKg", label: "Cân nặng", min: 30, max: 300 },
  { key: "heightCm", label: "Chiều cao", min: 100, max: 250 },
  { key: "age", label: "Tuổi", min: 10, max: 100, int: true },
  { key: "bodyFatPct", label: "% mỡ", min: 1, max: 60 },
  { key: "trainingDaysPerWeek", label: "Số buổi tập/tuần", min: 0, max: 7, int: true },
  { key: "trainingDurationMin", label: "Thời lượng buổi tập", min: 10, max: 300, int: true },
  { key: "proteinTargetG", label: "Protein", min: 50, max: 500 },
  { key: "carbTargetG", label: "Carb", min: 0, max: 1000 },
  { key: "fatTargetG", label: "Fat", min: 20, max: 300 },
];

/**
 * Null when the server would accept the form; otherwise the first problem in plain Vietnamese.
 * Includes web's own rule: when calories AND all three macros are set, 4P + 4C + 9F must land
 * within max(80 kcal, 5%) of the calorie target.
 */
export function nutritionFormError(form: NutritionForm): string | null {
  if (!form.goal.trim()) return "Chọn mục tiêu.";
  if (form.mealsPerDay < 2 || form.mealsPerDay > 6) return "Số bữa mỗi ngày phải từ 2 đến 6.";
  for (const b of NUMERIC_BOUNDS) {
    const raw = form[b.key] as string;
    if (!raw.trim()) continue;
    const n = optionalNumber(raw);
    if (n === undefined || n < b.min || n > b.max || (b.int && !Number.isInteger(n))) {
      return `${b.label} phải trong khoảng ${b.min}-${b.max}${b.int ? " (số nguyên)" : ""}.`;
    }
  }
  const calories = optionalNumber(form.dailyCaloriesTarget);
  const p = optionalNumber(form.proteinTargetG);
  const c = optionalNumber(form.carbTargetG);
  const f = optionalNumber(form.fatTargetG);
  if (calories && p !== undefined && c !== undefined && f !== undefined) {
    const macroKcal = p * 4 + c * 4 + f * 9;
    if (Math.abs(macroKcal - calories) > Math.max(80, calories * 0.05)) {
      return `Macro hiện tại tạo ra khoảng ${Math.round(macroKcal)} kcal, chưa khớp ${Math.round(calories)} kcal. Sửa calo hoặc macro trước khi tạo.`;
    }
  }
  return null;
}

/** Web's `buildGenerateNutritionPayload`: blanks omitted, durationWeeks fixed at 1 (server max). */
export function buildNutritionPayload(form: NutritionForm) {
  const payload: Record<string, unknown> = {
    goal: form.goal,
    durationWeeks: 1,
    mealsPerDay: form.mealsPerDay,
    dietPreference: form.dietPreference,
    budgetLevel: form.budgetLevel,
    restrictions: [...form.restrictions, ...(form.customRestriction.trim() ? [form.customRestriction.trim()] : [])].filter(Boolean),
    notes: form.notes.trim() || undefined,
    activityLevel: form.activityLevel,
    carbsAroundWorkout: form.carbsAroundWorkout,
    preworkoutMeal: form.preworkoutMeal,
    postworkoutMeal: form.postworkoutMeal,
  };
  for (const b of NUMERIC_BOUNDS) {
    const v = optionalNumber(form[b.key] as string);
    if (v !== undefined) payload[b.key] = v;
  }
  for (const key of ["gender", "trainingType", "trainingPhase", "experienceLevel", "primaryPriority"] as const) {
    if (form[key]) payload[key] = form[key];
  }
  return payload;
}

/** "Áp dụng trong" choices: 7 days (no endDate — server default) or a longer end date. */
export const APPLY_SPANS = [7, 14, 28];

export function endDateFor(startDate: string, days: number): string | undefined {
  if (days <= 7) return undefined;
  const [y, m, d] = startDate.split("-").map(Number);
  const end = new Date(y, m - 1, d + days - 1);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

export function dayMacros(day: any) {
  return {
    kcal: Math.round(Number(day?.totalCalories ?? 0)),
    p: Math.round(Number(day?.protein ?? day?.proteinGrams ?? 0)),
    c: Math.round(Number(day?.carbs ?? day?.carbGrams ?? 0)),
    f: Math.round(Number(day?.fat ?? day?.fatGrams ?? 0)),
  };
}

export function itemName(item: any): string {
  return item?.customFoodName || item?.food?.name || item?.name || "Thực phẩm";
}
