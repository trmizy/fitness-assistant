import { workoutRepository } from "../repositories/workout.repository";
import { nutritionRepository } from "../repositories/nutrition.repository";
import {
  currentWeekRange,
  todayAsScheduleDate,
  scheduledDateLabel,
} from "../utils/schedule-lock.util";

const STREAK_LOOKBACK_DAYS = 400;

// Consecutive calendar days (per Asia/Ho_Chi_Minh), ending today or
// yesterday, that have at least one COMPLETED WorkoutSchedule. Today itself
// doesn't have to be completed yet for the streak to still count (a user
// mid-day, not yet trained today, shouldn't see their real streak reset to
// 0) — but any actual gap day breaks it. Replaces a previous hardcoded
// "0 ngày" placeholder that was never computed from real data at all.
async function computeCurrentStreakDays(
  userId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - STREAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await workoutRepository.findCompletedScheduleDates(userId, since);
  const completedLabels = new Set(
    (rows as { date: Date }[]).map((r) => scheduledDateLabel(r.date)),
  );

  const cursor = todayAsScheduleDate(now);
  if (!completedLabels.has(scheduledDateLabel(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let streak = 0;
  while (completedLabels.has(scheduledDateLabel(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export const statsService = {
  async getWorkoutStats(userId: string, days = 30) {
    const now = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // duration/exercise-count totals still come from raw Workout rows —
    // these aren't part of the "completed sessions" count that had to match
    // the cycle report's definition, and nothing else derives a conflicting
    // number from them.
    const workouts = await workoutRepository.findForStats(userId, startDate);
    type WorkoutStat = {
      duration?: number | null;
      exercises: { length: number } | unknown[];
    };
    const typedWorkouts = workouts as WorkoutStat[];
    const totalDuration = typedWorkouts.reduce(
      (sum, w) => sum + (w.duration || 0),
      0,
    );
    const totalExercises = typedWorkouts.reduce(
      (sum, w) => sum + (w.exercises as unknown[]).length,
      0,
    );

    // "Completed sessions" uses the same canonical definition as the
    // training-cycle/adherence code (WorkoutSchedule.status === "COMPLETED"),
    // not a raw Workout-row count — see countCompletedSchedules' doc comment.
    const totalWorkouts = await workoutRepository.countCompletedSchedules(
      userId,
      startDate,
      now,
    );

    // weeklyWorkouts is the field the frontend's "Tuần này" tile reads; it
    // was previously undefined (always rendered as a hardcoded 0/N) because
    // no backend field existed for it at all.
    const { start: weekStart, end: weekEnd } = currentWeekRange(now);
    const weeklyWorkouts = await workoutRepository.countCompletedSchedules(
      userId,
      weekStart,
      weekEnd,
    );

    const currentStreakDays = await computeCurrentStreakDays(userId, now);

    return {
      totalWorkouts,
      weeklyWorkouts,
      currentStreakDays,
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

    type NutritionStat = {
      calories: number;
      protein?: number | null;
      carbs?: number | null;
      fats?: number | null;
    };
    const logs = (await nutritionRepository.findForStats(
      userId,
      startDate,
    )) as NutritionStat[];
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
