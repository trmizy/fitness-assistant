import { nutritionCalculator } from './nutrition_calculator';
import { workoutPlanSelector } from './workout_plan_selector';
import type { InputIntent, MealRecommendation, RecommendationResult, UserProfile } from './types';

function objectiveFromGoal(goal?: UserProfile['goal'], goalHint?: InputIntent['goalHint']): string {
  if (goalHint === 'fat_loss' || goal === 'WEIGHT_LOSS') return 'fat_loss';
  if (goalHint === 'muscle_gain' || goal === 'MUSCLE_GAIN') return 'muscle_gain';
  if (goalHint === 'maintenance' || goal === 'MAINTENANCE') return 'maintenance';
  return 'recomposition';
}

function mealTemplateFromGoal(objective: string): string {
  if (objective === 'fat_loss') return 'high_protein_calorie_deficit';
  if (objective === 'muscle_gain') return 'high_protein_slight_surplus';
  if (objective === 'maintenance') return 'balanced_maintenance';
  return 'high_protein_recomposition';
}

function buildMealRecommendation(profile: UserProfile, objective: string, mealPreferenceHint?: string): MealRecommendation {
  const preference = mealPreferenceHint || profile.foodPreference;
  const assumptions: string[] = [];

  if (!preference) {
    assumptions.push('No dietary preference provided; using omnivorous baseline template.');
  }

  return {
    template: mealTemplateFromGoal(objective),
    dailyMeals: 3,
    preference,
    assumptions,
  };
}

export const recommendationEngine = {
  recommend(profile: UserProfile, intent: InputIntent): RecommendationResult {
    const objective = objectiveFromGoal(profile.goal, intent.goalHint);
    const nutrition = nutritionCalculator.calculate(profile, intent);
    const workout = workoutPlanSelector.select(profile, intent);
    const meal = buildMealRecommendation(profile, objective, intent.mealPreferenceHint);

    const assumptions = [
      ...workout.assumptions,
      ...meal.assumptions,
      ...(nutrition.confidence === 'low'
        ? ['Nutrition targets are low-confidence because key profile metrics are missing.']
        : []),
    ];

    return {
      objective,
      nutrition,
      workout,
      meal,
      assumptions,
      missingFields: intent.missingFields,
    };
  },
};
