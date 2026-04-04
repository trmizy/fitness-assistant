import { nutritionCalculator } from './nutrition_calculator';
import { workoutPlanSelector } from './workout_plan_selector';
import type {
  DayPlan,
  ExercisePrescription,
  InputIntent,
  MealPlanTemplate,
  MealRecommendation,
  RecommendationResult,
  RoutedIntentType,
  SpecificRoutineTemplate,
  UserProfile,
  WorkoutPlanTemplate,
} from './types';

function objectiveFromGoal(goal?: UserProfile['goal'], goalHint?: InputIntent['goalHint']): string {
  if (goalHint === 'fat_loss' || goal === 'WEIGHT_LOSS') return 'fat_loss';
  if (goalHint === 'muscle_gain' || goal === 'MUSCLE_GAIN') return 'muscle_gain';
  if (goalHint === 'maintenance' || goal === 'MAINTENANCE') return 'maintenance';
  return 'recomposition';
}

function mealTemplateFromGoal(objective: string): string {
  if (objective === 'fat_loss') return 'high protein with moderate calorie deficit';
  if (objective === 'muscle_gain') return 'high protein with slight calorie surplus';
  if (objective === 'maintenance') return 'balanced maintenance intake';
  return 'high protein body recomposition';
}

function buildMealRecommendation(profile: UserProfile, objective: string, mealPreferenceHint?: string): MealRecommendation {
  const preference = mealPreferenceHint || profile.foodPreference;
  const assumptions: string[] = [];

  if (!preference) {
    assumptions.push('No dietary preference provided; using a general mixed-food baseline template.');
  }

  return {
    template: mealTemplateFromGoal(objective),
    dailyMeals: 3,
    preference,
    assumptions,
  };
}

function buildExercise(order: number, name: string, sets: number, reps: string, restSeconds: number, note?: string): ExercisePrescription {
  return { order, name, sets, reps, restSeconds, note };
}

// ─── Per-day exercise libraries ──────────────────────────────────────────────

function pushDayA(): DayPlan {
  return {
    day: 'Thứ 2 (Push A)',
    goal: 'Ngực + Vai trước + Tay sau',
    exercises: [
      buildExercise(1, 'Bench Press', 4, '6-8', 90, 'Compound chính'),
      buildExercise(2, 'Incline Dumbbell Press', 3, '8-10', 75, 'Upper chest'),
      buildExercise(3, 'Overhead Press', 4, '6-8', 90, 'Vai trước'),
      buildExercise(4, 'Cable Lateral Raise', 3, '12-15', 60, 'Vai giữa'),
      buildExercise(5, 'Triceps Pushdown', 3, '10-12', 60, 'Tay sau'),
      buildExercise(6, 'Overhead Triceps Extension', 3, '10-12', 60, 'Tay sau dài'),
    ],
  };
}

function pullDayA(): DayPlan {
  return {
    day: 'Thứ 3 (Pull A)',
    goal: 'Lưng rộng + Lưng dày + Tay trước',
    exercises: [
      buildExercise(1, 'Barbell Row', 4, '6-8', 90, 'Lưng dày'),
      buildExercise(2, 'Lat Pulldown', 4, '8-10', 75, 'Lưng rộng'),
      buildExercise(3, 'Seated Cable Row', 3, '10-12', 60, 'Lưng giữa'),
      buildExercise(4, 'Face Pull', 3, '12-15', 60, 'Vai sau + rotator cuff'),
      buildExercise(5, 'Barbell Curl', 3, '10-12', 60, 'Tay trước'),
      buildExercise(6, 'Hammer Curl', 3, '10-12', 60, 'Tay trước + cẳng tay'),
    ],
  };
}

function legsDayA(): DayPlan {
  return {
    day: 'Thứ 4 (Legs A)',
    goal: 'Tứ đầu + Gân khoeo + Mông + Bắp chân',
    exercises: [
      buildExercise(1, 'Back Squat', 4, '6-8', 120, 'Compound chính'),
      buildExercise(2, 'Romanian Deadlift', 4, '8-10', 90, 'Gân khoeo + lưng dưới'),
      buildExercise(3, 'Bulgarian Split Squat', 3, '10-12 each', 75, 'Đơn chân'),
      buildExercise(4, 'Leg Curl', 3, '10-12', 60, 'Gân khoeo'),
      buildExercise(5, 'Leg Extension', 3, '12-15', 60, 'Tứ đầu'),
      buildExercise(6, 'Standing Calf Raise', 4, '15-20', 45, 'Bắp chân'),
    ],
  };
}

function upperDayB(): DayPlan {
  return {
    day: 'Thứ 5 (Upper B)',
    goal: 'Ngực + Lưng — volume hypertrophy',
    exercises: [
      buildExercise(1, 'Dumbbell Bench Press', 4, '8-12', 75, 'Ngực'),
      buildExercise(2, 'Chest Supported Row', 4, '8-12', 75, 'Lưng dày'),
      buildExercise(3, 'Incline Cable Fly', 3, '12-15', 60, 'Upper chest stretch'),
      buildExercise(4, 'Single-Arm Dumbbell Row', 3, '10-12 each', 60, 'Lưng + biceps'),
      buildExercise(5, 'Rear Delt Fly', 3, '12-15', 60, 'Vai sau'),
      buildExercise(6, 'EZ-Bar Curl', 3, '10-12', 60, 'Tay trước'),
    ],
  };
}

function lowerDayB(): DayPlan {
  return {
    day: 'Thứ 7 (Lower B + Core)',
    goal: 'Mông + Gân khoeo + Core',
    exercises: [
      buildExercise(1, 'Hip Thrust', 4, '8-10', 75, 'Mông'),
      buildExercise(2, 'Hack Squat', 3, '8-10', 90, 'Tứ đầu'),
      buildExercise(3, 'Walking Lunges', 3, '12 each', 60, 'Đơn chân'),
      buildExercise(4, 'Leg Curl', 3, '10-12', 60, 'Gân khoeo'),
      buildExercise(5, 'Plank', 3, '45-60s', 45, 'Core ổn định'),
      buildExercise(6, 'Ab Wheel Rollout', 3, '10-12', 45, 'Core chống ưỡn'),
    ],
  };
}

function pushDayB(): DayPlan {
  return {
    day: 'Thứ 5 (Push B)',
    goal: 'Vai + Ngực trên + Tay sau',
    exercises: [
      buildExercise(1, 'Overhead Press', 4, '6-8', 90, 'Vai — compound'),
      buildExercise(2, 'Incline Barbell Press', 4, '8-10', 75, 'Upper chest'),
      buildExercise(3, 'Arnold Press', 3, '10-12', 75, 'Vai toàn phần'),
      buildExercise(4, 'Lateral Raise', 4, '12-15', 60, 'Vai giữa'),
      buildExercise(5, 'Triceps Dips', 3, '10-15', 60, 'Tay sau'),
      buildExercise(6, 'Close-Grip Bench Press', 3, '8-10', 75, 'Tay sau + ngực'),
    ],
  };
}

function pullDayB(): DayPlan {
  return {
    day: 'Thứ 6 (Pull B)',
    goal: 'Lưng bề dày + Bắp tay — volume',
    exercises: [
      buildExercise(1, 'Deadlift', 4, '4-5', 180, 'Compound toàn thân'),
      buildExercise(2, 'Chest Supported Row', 4, '8-10', 75, 'Lưng giữa'),
      buildExercise(3, 'Pull-ups', 3, '8-12', 75, 'Lưng rộng'),
      buildExercise(4, 'Rear Delt Fly', 3, '12-15', 60, 'Vai sau'),
      buildExercise(5, 'Incline Dumbbell Curl', 3, '10-12', 60, 'Tay trước'),
      buildExercise(6, 'Cable Curl', 3, '12-15', 60, 'Tay trước — peak'),
    ],
  };
}

function legsDayB(): DayPlan {
  return {
    day: 'Thứ 7 (Legs B)',
    goal: 'Gân khoeo + Mông — volume',
    exercises: [
      buildExercise(1, 'Romanian Deadlift', 4, '6-8', 90, 'Gân khoeo + lưng'),
      buildExercise(2, 'Hip Thrust', 4, '8-10', 75, 'Mông'),
      buildExercise(3, 'Leg Press', 3, '10-12', 75, 'Tứ đầu'),
      buildExercise(4, 'Walking Lunges', 3, '12 each', 60, 'Đơn chân'),
      buildExercise(5, 'Seated Leg Curl', 3, '10-12', 60, 'Gân khoeo'),
      buildExercise(6, 'Ab Wheel Rollout', 3, '10-12', 45, 'Core'),
    ],
  };
}

function fullBodyA(): DayPlan {
  return {
    day: 'Thứ 2 (Full Body A)',
    goal: 'Strength — squat + press + pull pattern',
    exercises: [
      buildExercise(1, 'Back Squat', 4, '5-7', 120, 'Compound chính'),
      buildExercise(2, 'Bench Press', 4, '6-8', 90, 'Push horizontal'),
      buildExercise(3, 'Barbell Row', 4, '6-8', 90, 'Pull horizontal'),
      buildExercise(4, 'Romanian Deadlift', 3, '8-10', 90, 'Hip hinge'),
      buildExercise(5, 'Overhead Press', 3, '8-10', 75, 'Push vertical'),
    ],
  };
}

function fullBodyB(): DayPlan {
  return {
    day: 'Thứ 4 (Full Body B)',
    goal: 'Hypertrophy — hinge + incline + vertical pull',
    exercises: [
      buildExercise(1, 'Deadlift', 4, '5', 180, 'Hip hinge chính'),
      buildExercise(2, 'Incline Dumbbell Press', 4, '8-10', 75, 'Upper chest'),
      buildExercise(3, 'Pull-ups', 4, '8-10', 75, 'Pull vertical'),
      buildExercise(4, 'Goblet Squat', 3, '10-12', 75, 'Quad focus'),
      buildExercise(5, 'Cable Lateral Raise', 3, '12-15', 60, 'Vai giữa'),
    ],
  };
}

function fullBodyC(): DayPlan {
  return {
    day: 'Thứ 6 (Full Body C)',
    goal: 'Volume — unilateral + core + conditioning',
    exercises: [
      buildExercise(1, 'Bulgarian Split Squat', 4, '8-10 each', 75, 'Đơn chân'),
      buildExercise(2, 'Dumbbell Bench Press', 4, '8-12', 75, 'Ngực'),
      buildExercise(3, 'Seated Cable Row', 4, '8-12', 75, 'Lưng'),
      buildExercise(4, 'Hip Thrust', 3, '10-12', 75, 'Mông'),
      buildExercise(5, 'Face Pull', 3, '12-15', 60, 'Vai sau + rotator'),
    ],
  };
}

function upperDayA4(): DayPlan {
  return {
    day: 'Thứ 2 (Upper A)',
    goal: 'Ngực + Lưng — strength',
    exercises: [
      buildExercise(1, 'Bench Press', 4, '5-7', 120, 'Strength'),
      buildExercise(2, 'Barbell Row', 4, '5-7', 90, 'Strength'),
      buildExercise(3, 'Overhead Press', 3, '8-10', 75, 'Vai'),
      buildExercise(4, 'Lat Pulldown', 3, '10-12', 60, 'Lưng rộng'),
      buildExercise(5, 'Cable Lateral Raise', 3, '12-15', 60, 'Vai giữa'),
    ],
  };
}

function lowerDayA4(): DayPlan {
  return {
    day: 'Thứ 3 (Lower A)',
    goal: 'Tứ đầu + Gân khoeo — strength',
    exercises: [
      buildExercise(1, 'Back Squat', 4, '5-7', 120, 'Strength'),
      buildExercise(2, 'Romanian Deadlift', 4, '8-10', 90, 'Gân khoeo'),
      buildExercise(3, 'Leg Press', 3, '10-12', 75, 'Volume'),
      buildExercise(4, 'Leg Curl', 3, '10-12', 60, 'Gân khoeo'),
      buildExercise(5, 'Calf Raise', 4, '15-20', 45, 'Bắp chân'),
    ],
  };
}

function upperDayB4(): DayPlan {
  return {
    day: 'Thứ 5 (Upper B)',
    goal: 'Ngực + Lưng — hypertrophy',
    exercises: [
      buildExercise(1, 'Incline Dumbbell Press', 4, '8-10', 75, 'Upper chest'),
      buildExercise(2, 'Chest Supported Row', 4, '8-10', 75, 'Lưng dày'),
      buildExercise(3, 'Arnold Press', 3, '10-12', 75, 'Vai'),
      buildExercise(4, 'Pull-ups', 3, '8-12', 75, 'Lưng rộng'),
      buildExercise(5, 'Face Pull', 3, '12-15', 60, 'Vai sau'),
    ],
  };
}

function lowerDayB4(): DayPlan {
  return {
    day: 'Thứ 6 (Lower B)',
    goal: 'Mông + Gân khoeo + Core',
    exercises: [
      buildExercise(1, 'Deadlift', 4, '5', 180, 'Compound'),
      buildExercise(2, 'Hack Squat', 3, '10-12', 90, 'Tứ đầu'),
      buildExercise(3, 'Hip Thrust', 4, '8-10', 75, 'Mông'),
      buildExercise(4, 'Walking Lunges', 3, '12 each', 60, 'Đơn chân'),
      buildExercise(5, 'Plank', 3, '60s', 45, 'Core'),
    ],
  };
}

// ─── Template selector by day count ──────────────────────────────────────────

function selectDaysByCount(count: number): DayPlan[] {
  if (count <= 3) return [fullBodyA(), fullBodyB(), fullBodyC()].slice(0, count);
  if (count === 4) return [upperDayA4(), lowerDayA4(), upperDayB4(), lowerDayB4()];
  if (count === 5) return [pushDayA(), pullDayA(), legsDayA(), upperDayB(), lowerDayB()];
  if (count === 6) return [pushDayA(), pullDayA(), legsDayA(), pushDayB(), pullDayB(), legsDayB()];
  // 7 days: PPL x2 + active recovery
  return [pushDayA(), pullDayA(), legsDayA(), pushDayB(), pullDayB(), legsDayB(), lowerDayB()];
}

function enforceMinExercises(days: DayPlan[], minPerDay: number): DayPlan[] {
  if (minPerDay <= 0) return days;
  return days.map((day) => {
    if (day.exercises.length >= minPerDay) return day;
    // Pad with generic accessory work until minimum is met
    const padded = [...day.exercises];
    const accessories: ExercisePrescription[] = [
      buildExercise(padded.length + 1, 'Cable Crunch', 3, '12-15', 45, 'Core'),
      buildExercise(padded.length + 2, 'Seated Calf Raise', 3, '15-20', 45, 'Bắp chân'),
      buildExercise(padded.length + 3, 'Band Pull-Apart', 3, '15-20', 30, 'Vai sau'),
      buildExercise(padded.length + 4, 'Hollow Body Hold', 3, '30-45s', 30, 'Core'),
      buildExercise(padded.length + 5, 'Copenhagen Plank', 3, '20-30s each', 30, 'Adductors'),
    ];
    while (padded.length < minPerDay) {
      const next = accessories[padded.length - day.exercises.length];
      if (!next) break;
      padded.push({ ...next, order: padded.length + 1 });
    }
    return { ...day, exercises: padded };
  });
}

function goalSummaryText(objective: string, days: number, level: string): string {
  const split = days <= 3 ? 'Full Body' : days === 4 ? 'Upper/Lower' : days <= 6 ? 'Push/Pull/Legs' : 'PPL x2';
  const goalVI = objective === 'fat_loss' ? 'Giảm mỡ' : objective === 'muscle_gain' ? 'Tăng cơ' : 'Tái cấu trúc';
  return `${goalVI} — ${split} ${days} ngày/tuần — ${level === 'BEGINNER' ? 'Người mới' : level === 'ADVANCED' ? 'Nâng cao' : 'Trung cấp'}`;
}

function buildWorkoutPlanTemplate(profile: UserProfile, intent: InputIntent): WorkoutPlanTemplate {
  const requestedDays =
    intent.parsedTrainingDays ||
    profile.training.trainingDaysPerWeek ||
    3;

  const minExercises = intent.minimumExercisesPerDay || 5;
  const objective = profile.goal === 'WEIGHT_LOSS' ? 'fat_loss'
    : profile.goal === 'MUSCLE_GAIN' ? 'muscle_gain'
    : 'recomposition';
  const level = profile.experienceLevel || 'INTERMEDIATE';

  const rawDays = selectDaysByCount(requestedDays);
  const days = enforceMinExercises(rawDays, minExercises);

  return {
    isDefaultTemplate: !profile.training.trainingDaysPerWeek && !intent.parsedTrainingDays,
    goalSummary: goalSummaryText(objective, requestedDays, level),
    days,
    progressionNotes: [
      'Tăng tạ 2.5–5% khi hoàn thành tất cả sets ở ngưỡng reps cao nhất.',
      'Giữ 1–2 reps in reserve (RIR) ở các bài compound để kiểm soát fatigue.',
      'Sau 4–6 tuần, deload 1 tuần bằng cách giảm 30–40% volume.',
    ],
  };
}

function buildBicepsRoutine(): SpecificRoutineTemplate {
  return {
    isDefaultTemplate: true,
    sessionGoal: 'Biceps and forearm hypertrophy with strict form.',
    exercises: [
      buildExercise(1, 'Barbell Curl', 4, '8-10', 90),
      buildExercise(2, 'Incline Dumbbell Curl', 3, '10-12', 75),
      buildExercise(3, 'Hammer Curl', 3, '10-12', 75),
      buildExercise(4, 'Preacher Curl', 3, '10-12', 75),
      buildExercise(5, 'Cable Curl', 3, '12-15', 60),
      buildExercise(6, 'Reverse Curl', 2, '12-15', 60),
    ],
    techniqueNotes: [
      'Keep elbows fixed and avoid swinging torso.',
      'Lower weight with control for 2-3 seconds.',
      'Use full range of motion without shoulder compensation.',
    ],
    overloadGuide: [
      'Increase load by the smallest plate when all sets hit top reps.',
      'If form breaks, keep load and add one rep total next session.',
    ],
  };
}

function buildGeneralSpecificRoutine(): SpecificRoutineTemplate {
  return {
    isDefaultTemplate: true,
    sessionGoal: 'Full-body hypertrophy session with balanced push, pull, and lower body work.',
    exercises: [
      buildExercise(1, 'Goblet Squat', 4, '8-12', 90),
      buildExercise(2, 'Romanian Deadlift', 4, '8-10', 120),
      buildExercise(3, 'Dumbbell Bench Press', 4, '8-12', 90),
      buildExercise(4, 'Seated Cable Row', 4, '8-12', 90),
      buildExercise(5, 'Dumbbell Shoulder Press', 3, '10-12', 75),
      buildExercise(6, 'Plank', 3, '45-60 seconds', 45),
    ],
    techniqueNotes: [
      'Warm up 8-10 minutes before first compound lift.',
      'Stop each set with 1-2 reps in reserve.',
      'Prioritize form over load on every repetition.',
    ],
    overloadGuide: [
      'Add 1-2 reps per week until top range is achieved, then increase load.',
      'Track sets, reps, and load for every exercise to ensure progression.',
    ],
  };
}

function buildMealPlanTemplate(profile: UserProfile, intent: InputIntent): MealPlanTemplate {
  const nutrition = nutritionCalculator.calculate(profile, intent);

  return {
    isDefaultTemplate: nutrition.confidence === 'low',
    kcal: nutrition.targetCalories || 2100,
    proteinGrams: nutrition.proteinGrams || 150,
    carbsGrams: nutrition.carbsGrams || 220,
    fatGrams: nutrition.fatGrams || 65,
    meals: [
      { mealName: 'Meal 1', foods: ['Oats 60g', 'Greek yogurt 200g', 'Banana 1 fruit'] },
      { mealName: 'Meal 2', foods: ['Chicken breast 150g', 'Rice 180g cooked', 'Vegetables 200g'] },
      { mealName: 'Meal 3', foods: ['Salmon 150g', 'Sweet potato 250g', 'Salad 1 bowl'] },
      { mealName: 'Meal 4', foods: ['Whey protein 1 scoop', 'Almonds 20g', 'Apple 1 fruit'] },
    ],
    substitutions: [
      'Replace chicken with tofu or lean beef at equivalent protein.',
      'Replace rice with potatoes or whole-grain bread at equivalent carbs.',
      'Replace salmon with eggs plus olive oil to keep fats similar.',
    ],
  };
}

function buildFollowUps(intent: RoutedIntentType, missingFields: string[]): string[] {
  const fromMissing = missingFields.slice(0, 2).map((f) => `Can you share your ${f}?`);

  if (intent === 'specific_exercise_request' || intent === 'muscle_group_routine_request') {
    return [...fromMissing, 'Do you train at home or gym?', 'Any pain or injury to avoid?'].slice(0, 3);
  }

  if (intent === 'meal_plan_request') {
    return [...fromMissing, 'Any food allergy or diet preference?'].slice(0, 3);
  }

  return [...fromMissing, 'How many training days per week can you commit?'].slice(0, 3);
}

export const recommendationEngine = {
  recommend(profile: UserProfile, intent: InputIntent): RecommendationResult {
    const responseIntent = intent.routeIntent || 'general_fitness_knowledge';
    const objective = objectiveFromGoal(profile.goal, intent.goalHint);
    const nutrition = nutritionCalculator.calculate(profile, intent);
    const workout = workoutPlanSelector.select(profile, intent);
    const meal = buildMealRecommendation(profile, objective, intent.mealPreferenceHint);

    const workoutPlan =
      responseIntent === 'workout_plan_request' ||
      responseIntent === 'body_recomposition_request' ||
      responseIntent === 'frequency_change_request'
        ? buildWorkoutPlanTemplate(profile, intent)
        : undefined;

    const specificRoutine =
      responseIntent === 'specific_exercise_request' || responseIntent === 'muscle_group_routine_request'
        ? intent.normalizedQuestion.toLowerCase().includes('tay truoc') || intent.normalizedQuestion.toLowerCase().includes('biceps')
          ? buildBicepsRoutine()
          : buildGeneralSpecificRoutine()
        : undefined;

    const mealPlan = responseIntent === 'meal_plan_request' ? buildMealPlanTemplate(profile, intent) : undefined;

    const assumptions = [
      ...workout.assumptions,
      ...meal.assumptions,
      ...(nutrition.confidence === 'low'
        ? ['Nutrition targets are low-confidence because key profile metrics are missing.']
        : []),
    ];

    return {
      objective,
      responseIntent,
      nutrition,
      workout,
      meal,
      workoutPlan,
      specificRoutine,
      mealPlan,
      followUpQuestions: buildFollowUps(responseIntent, intent.missingFields),
      assumptions,
      missingFields: intent.missingFields,
    };
  },
};
