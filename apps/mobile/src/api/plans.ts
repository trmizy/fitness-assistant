import { apiClient } from "./client";

export type PlanStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type PtReviewStatus = "PENDING_PT_REVIEW" | "PT_APPROVED" | "PT_REJECTED";

export interface WorkoutPlanExercise {
  exerciseId: string;
  order: number;
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  note?: string;
}

export interface WorkoutPlanDay {
  day: string;
  goal: string;
  cardio?: string;
  exercises: WorkoutPlanExercise[];
}

export interface WorkoutPlanContent {
  goal: string;
  durationWeeks: number;
  daysPerWeek: number;
  exercisesPerDay?: number;
  weeklySchedule: WorkoutPlanDay[];
  progressionNotes?: string[];
  recoveryNotes?: string[];
  nutritionSummary?: string;
  safetyNotes?: string[];
}

// ai-service — WorkoutPlan (verified live against GET /plans/current)
export interface WorkoutPlan {
  id: string;
  userId: string;
  name: string;
  description?: string;
  goal: string;
  duration: number;
  daysPerWeek: number;
  plan: WorkoutPlanContent;
  status: PlanStatus;
  version: number;
  jobId?: string;
  failReason?: string;
  ptUserId?: string;
  ptName?: string;
  ptReviewStatus?: PtReviewStatus;
  ptNote?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NutritionMealItem {
  foodId: string;
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  notes?: string;
}

export interface NutritionMeal {
  mealType: "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
  title: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  items: NutritionMealItem[];
}

export interface NutritionDay {
  dayNumber: number;
  totalCalories: number;
  protein: number;
  carbs: number;
  fat: number;
  meals: NutritionMeal[];
}

export interface NutritionPlanContent {
  goal: string;
  mealsPerDay: number;
  durationWeeks: number;
  dailyCaloriesTarget: number;
  proteinTargetGrams: number;
  carbTargetGrams: number;
  fatTargetGrams: number;
  generalNotes?: string[];
  weeklySchedule: NutritionDay[];
}

// ai-service — NutritionPlan (verified live against GET /plans/nutrition/current)
export interface NutritionPlan {
  id: string;
  userId: string;
  name: string;
  goal: string;
  durationWeeks: number;
  mealsPerDay: number;
  plan: NutritionPlanContent;
  status: PlanStatus;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const plansApi = {
  getCurrentWorkoutPlans() {
    return apiClient
      .get<{ success: true; data: { plans: WorkoutPlan[] } }>("/plans/current")
      .then((r) => r.data.data.plans);
  },

  getCurrentNutritionPlans() {
    return apiClient
      .get<{ success: true; data: NutritionPlan[] }>("/plans/nutrition/current")
      .then((r) => r.data.data);
  },
};
