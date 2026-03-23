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

function buildExercise(order: number, name: string, sets: number, reps: string, restSeconds: number): ExercisePrescription {
  return { order, name, sets, reps, restSeconds };
}

function buildDefaultWorkoutDays(): DayPlan[] {
  return [
    {
      day: 'Day 1',
      goal: 'Upper body push and pull',
      exercises: [
        buildExercise(1, 'Barbell Bench Press', 4, '6-8', 120),
        buildExercise(2, 'One-Arm Dumbbell Row', 4, '8-10', 90),
        buildExercise(3, 'Seated Dumbbell Shoulder Press', 3, '8-10', 90),
        buildExercise(4, 'Lat Pulldown', 3, '10-12', 75),
        buildExercise(5, 'Cable Face Pull', 3, '12-15', 60),
      ],
      cardio: 'Walk 15-20 minutes at easy pace after lifting',
    },
    {
      day: 'Day 2',
      goal: 'Lower body strength and core',
      exercises: [
        buildExercise(1, 'Back Squat', 4, '6-8', 120),
        buildExercise(2, 'Romanian Deadlift', 4, '8-10', 120),
        buildExercise(3, 'Bulgarian Split Squat', 3, '10-12 each leg', 90),
        buildExercise(4, 'Leg Curl', 3, '10-12', 75),
        buildExercise(5, 'Plank', 3, '45-60 seconds', 45),
      ],
      cardio: 'Cycle 12-15 minutes at moderate intensity',
    },
    {
      day: 'Day 3',
      goal: 'Upper hypertrophy focus',
      exercises: [
        buildExercise(1, 'Incline Dumbbell Press', 4, '8-10', 90),
        buildExercise(2, 'Chest Supported Row', 4, '8-10', 90),
        buildExercise(3, 'Cable Lateral Raise', 3, '12-15', 60),
        buildExercise(4, 'Close-Grip Push-Up', 3, '10-15', 60),
        buildExercise(5, 'EZ-Bar Curl', 3, '10-12', 60),
      ],
      cardio: 'Optional interval bike: 8 rounds x 30s hard / 60s easy',
    },
    {
      day: 'Day 4',
      goal: 'Lower hypertrophy and conditioning',
      exercises: [
        buildExercise(1, 'Front Squat', 4, '6-8', 120),
        buildExercise(2, 'Hip Thrust', 4, '8-10', 90),
        buildExercise(3, 'Walking Lunges', 3, '12 each leg', 75),
        buildExercise(4, 'Leg Extension', 3, '12-15', 60),
        buildExercise(5, 'Hanging Knee Raise', 3, '12-15', 45),
      ],
      cardio: 'Incline walk 20 minutes at steady pace',
    },
  ];
}

function buildWorkoutPlanTemplate(profile: UserProfile): WorkoutPlanTemplate {
  const isDefaultTemplate = !profile.training.trainingDaysPerWeek;
  const days = buildDefaultWorkoutDays();

  const requestedDays = profile.training.trainingDaysPerWeek;
  const scopedDays = requestedDays ? days.slice(0, Math.max(2, Math.min(4, requestedDays))) : days;

  return {
    isDefaultTemplate,
    goalSummary: 'Build muscle while reducing body fat with progressive resistance training and controlled cardio.',
    days: scopedDays,
    progressionNotes: [
      'When you complete top reps on all sets, increase load by 2.5-5%.',
      'Keep 1-3 reps in reserve on compound lifts to manage fatigue.',
      'After 4-6 weeks, deload for 1 week by reducing volume 30-40%.',
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
      responseIntent === 'workout_plan_request' || responseIntent === 'body_recomposition_request'
        ? buildWorkoutPlanTemplate(profile)
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
