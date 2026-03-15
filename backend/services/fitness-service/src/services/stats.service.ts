import { workoutRepository } from '../repositories/workout.repository';
import { nutritionRepository } from '../repositories/nutrition.repository';

export const statsService = {
  async getWorkoutStats(userId: string, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const workouts = await workoutRepository.findForStats(userId, startDate);
    const totalWorkouts = workouts.length;
    type WorkoutStat = { duration?: number | null; exercises: { length: number } | unknown[] };
    const typedWorkouts = workouts as WorkoutStat[];
    const totalDuration = typedWorkouts.reduce((sum, w) => sum + (w.duration || 0), 0);
    const totalExercises = typedWorkouts.reduce((sum, w) => sum + (w.exercises as unknown[]).length, 0);

    return {
      totalWorkouts,
      totalDuration,
      totalExercises,
      averageDuration:
        totalWorkouts > 0 ? Math.round(totalDuration / totalWorkouts) : 0,
      workoutsPerWeek: (totalWorkouts / (days / 7)).toFixed(1),
    };
  },

  async getNutritionStats(userId: string, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    type NutritionStat = { calories: number; protein?: number | null; carbs?: number | null; fats?: number | null };
    const logs = (await nutritionRepository.findForStats(userId, startDate)) as NutritionStat[];
    const totalCalories = logs.reduce((sum, l) => sum + l.calories, 0);
    const totalProtein = logs.reduce((sum, l) => sum + (l.protein || 0), 0);
    const totalCarbs = logs.reduce((sum, l) => sum + (l.carbs || 0), 0);
    const totalFats = logs.reduce((sum, l) => sum + (l.fats || 0), 0);

    return {
      totalCalories,
      totalProtein,
      totalCarbs,
      totalFats,
      averageCaloriesPerDay: Math.round(totalCalories / days),
      averageProteinPerDay: Math.round(totalProtein / days),
      averageCarbsPerDay: Math.round(totalCarbs / days),
      averageFatsPerDay: Math.round(totalFats / days),
    };
  },
};
