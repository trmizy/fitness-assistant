import assert from 'node:assert/strict';
import { detectNutritionLookupIntent, formatNutritionAnswer, nutritionSourceLabel } from '../llm/nutrition_context';
import {
  detectWorkoutScheduleIntent,
  formatWorkoutScheduleAnswer,
  workoutScheduleSourceLabel,
  type WorkoutScheduleContext,
} from '../llm/workout_schedule_context';

function assertNutritionFirst(question: string, expectedDate: string, expectedMealType: string) {
  const nutrition = detectNutritionLookupIntent(question);
  assert.equal(nutrition.enabled, true, `${question}: expected nutrition lookup`);
  assert.equal(nutrition.targetDate, expectedDate, `${question}: targetDate`);
  assert.equal(nutrition.mealType, expectedMealType, `${question}: mealType`);
}

function assertWorkoutOnly(question: string, expectedDate: string) {
  const nutrition = detectNutritionLookupIntent(question);
  assert.equal(nutrition.enabled, false, `${question}: should not be nutrition`);
  const workout = detectWorkoutScheduleIntent(question);
  assert.equal(workout.enabled, true, `${question}: expected workout lookup`);
  assert.equal(workout.targetDate, expectedDate, `${question}: targetDate`);
}

const nutritionHistory = [
  { question: 'hôm nay ăn gì', answer: 'Theo thực đơn đã lưu...' },
];
const workoutHistory = [
  { question: 'thứ 3 tuần này tập gì', answer: 'Theo lịch tập đã lưu...' },
];

assertNutritionFirst('cho tôi thấy thực đơn sáng mai', '2026-06-02', 'breakfast');
assertNutritionFirst('ngày mai tôi sẽ ăn gì', '2026-06-02', 'all');
assertNutritionFirst('bữa tối ngày 18 tháng 6', '2026-06-18', 'dinner');
assertNutritionFirst('18/6 ăn gì', '2026-06-18', 'all');
assertWorkoutOnly('ngày mai tôi tập gì', '2026-06-02');

const nutritionFollowUp = detectNutritionLookupIntent('ngày mai', nutritionHistory);
assert.equal(nutritionFollowUp.enabled, true, 'nutrition follow-up should inherit nutrition intent');
assert.equal(nutritionFollowUp.targetDate, '2026-06-02');

const workoutFollowUpNutrition = detectNutritionLookupIntent('ngày mai', workoutHistory);
assert.equal(workoutFollowUpNutrition.enabled, false, 'workout context should not inherit nutrition intent');
const workoutFollowUp = detectWorkoutScheduleIntent('ngày mai', workoutHistory);
assert.equal(workoutFollowUp.enabled, true, 'workout follow-up should stay workout');
assert.equal(workoutFollowUp.targetDate, '2026-06-02');

assert.equal(nutritionSourceLabel('nutrition_log'), 'Nhật ký dinh dưỡng');
assert.equal(nutritionSourceLabel('meal_plan'), 'Kế hoạch dinh dưỡng đã lưu');
assert.equal(workoutScheduleSourceLabel('scheduled_session'), 'Nhật ký tập luyện');
assert.equal(workoutScheduleSourceLabel('active_workout_program'), 'Lịch tập đã lưu');

const nutritionAnswer = formatNutritionAnswer({
  targetDate: '2026-06-02',
  mealType: 'breakfast',
  plannedMealsFound: false,
  meals: [],
  source: 'nutrition_goal',
  dailyCaloriesTarget: 2200,
  proteinTarget: 150,
  carbTarget: 240,
  fatTarget: 70,
}, 'vi');
assert.match(nutritionAnswer, /Mình chưa thấy thực đơn cụ thể/);
assert.doesNotMatch(nutritionAnswer, /scheduled_session|workout/i);

const workoutContext: WorkoutScheduleContext = {
  targetDate: '2026-06-02',
  targetDayOfWeek: 'Thứ Ba',
  scheduledWorkoutFound: true,
  workoutName: 'Push',
  muscleGroups: ['Ngực'],
  exercises: [{ name: 'Bench Press', sets: 3, reps: 10, restSeconds: 90 }],
  days: [],
  source: 'scheduled_session',
};
const workoutAnswer = formatWorkoutScheduleAnswer(workoutContext, 'vi');
assert.match(workoutAnswer, /Nhật ký tập luyện/);
assert.doesNotMatch(workoutAnswer, /scheduled_session/);
assert.doesNotMatch(workoutAnswer, /thực đơn|bữa sáng/i);

console.log('PASS: intent routing keeps nutrition lookup ahead of workout schedule and labels sources in Vietnamese.');
