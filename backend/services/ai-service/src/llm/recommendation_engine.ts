import { nutritionCalculator } from './nutrition_calculator';
import { workoutPlanSelector } from './workout_plan_selector';
import { mealPlanLoader } from './meal_plan_loader';
import type {
  DayPlan,
  ExercisePrescription,
  InputIntent,
  MealPlanTemplate,
  MealRecommendation,
  RecommendationResult,
  ResponseLanguage,
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

function cardioForDay(day: DayPlan): string {
  const d = day.day.toLowerCase();
  if (d.includes('legs') || d.includes('lower')) {
    return '10 phút Cycling nhẹ hoặc Walking — warm-down';
  }
  if (d.includes('full body')) {
    return '10–15 phút LISS Cardio (đi bộ nhanh hoặc xe đạp)';
  }
  return '10–15 phút Assault Bike hoặc Rowing — moderate pace';
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

  const minExercises = Math.max(intent.minimumExercisesPerDay || 5, intent.detailMode ? 6 : 5);
  const objective = profile.goal === 'WEIGHT_LOSS' ? 'fat_loss'
    : profile.goal === 'MUSCLE_GAIN' ? 'muscle_gain'
    : 'recomposition';
  const level = profile.experienceLevel || 'INTERMEDIATE';

  const rawDays = selectDaysByCount(requestedDays);
  const withMinExercises = enforceMinExercises(rawDays, minExercises);
  const days = intent.requestsCardio
    ? withMinExercises.map((day) => ({ ...day, cardio: cardioForDay(day) }))
    : withMinExercises;

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

function buildChestRoutine(detailMode = false): SpecificRoutineTemplate {
  return {
    isDefaultTemplate: true,
    sessionGoal: 'Buổi ngực đầy đủ cho người mới đến trung cấp, ưu tiên kỹ thuật chuẩn.',
    exercises: [
      buildExercise(1, 'Machine Chest Press', 4, detailMode ? '8-12' : '10-12', 90),
      buildExercise(2, 'Incline Dumbbell Press', 4, detailMode ? '8-10' : '10-12', 90),
      buildExercise(3, 'Cable Fly', 3, '12-15', 60),
      buildExercise(4, 'Push-up', 3, 'AMRAP kỹ thuật chuẩn', 60),
      buildExercise(5, 'Pec Deck', 3, '12-15', 60),
    ],
    techniqueNotes: [
      'Siết bả vai, mở ngực và giữ cổ tay thẳng trong toàn bộ biên độ.',
      'Hạ tạ có kiểm soát 2-3 giây, không nảy tạ ở đáy chuyển động.',
      'Giữ khuỷu tay ở góc an toàn, tránh flare quá rộng gây stress vai trước.',
    ],
    overloadGuide: [
      'Khi đạt ngưỡng reps trên ở mọi set, tăng tạ 2.5-5% ở buổi tiếp theo.',
      'Nếu form vỡ, giữ mức tạ và tăng tổng reps thêm 1-2 reps mỗi buổi.',
    ],
  };
}

function buildBackRoutine(detailMode = false): SpecificRoutineTemplate {
  return {
    isDefaultTemplate: true,
    sessionGoal: 'Buổi lưng xô chi tiết, nhấn vào kéo xô và độ dày lưng.',
    exercises: [
      buildExercise(1, 'Lat Pulldown', 4, detailMode ? '8-10' : '10-12', 90),
      buildExercise(2, 'Chest Supported Row', 4, '8-10', 90),
      buildExercise(3, 'Single Arm Dumbbell Row', 3, '10-12 mỗi bên', 75),
      buildExercise(4, 'Seated Cable Row', 3, '10-12', 75),
      buildExercise(5, 'Face Pull', 3, '12-15', 60),
      buildExercise(6, 'Straight Arm Pulldown', 3, '12-15', 60),
    ],
    techniqueNotes: [
      'Bắt đầu mỗi rep bằng siết xương bả vai, không giật bằng lưng dưới.',
      'Giữ thân ổn định, tránh ngửa người quá mức khi kéo xô.',
      'Ưu tiên biên độ đầy đủ và cảm nhận cơ lưng hơn là kéo nặng.',
    ],
    overloadGuide: [
      'Tăng tải nhỏ khi hoàn thành toàn bộ set ở ngưỡng reps cao nhất.',
      'Giữ RIR 1-2 ở bài compound và RIR 0-1 ở bài isolation cuối buổi.',
    ],
  };
}

function buildPushDayRoutine(detailMode = false): SpecificRoutineTemplate {
  return {
    isDefaultTemplate: true,
    sessionGoal: 'Push day hoàn chỉnh: ngực, vai, tay sau theo thứ tự từ compound đến isolation.',
    exercises: [
      buildExercise(1, 'Bench Press', 4, detailMode ? '6-8' : '8-10', 120),
      buildExercise(2, 'Incline Dumbbell Press', 4, '8-10', 90),
      buildExercise(3, 'Overhead Press', 3, '8-10', 90),
      buildExercise(4, 'Cable Lateral Raise', 4, '12-15', 60),
      buildExercise(5, 'Triceps Pushdown', 3, '10-12', 60),
      buildExercise(6, 'Overhead Triceps Extension', 3, '10-12', 60),
    ],
    techniqueNotes: [
      'Khởi động vai và khớp khuỷu 8-10 phút trước bài compound đầu tiên.',
      'Giữ core căng và không ưỡn lưng quá mức khi Press.',
      'Bài isolation cần tempo có kiểm soát để bảo vệ khuỷu tay.',
    ],
    overloadGuide: [
      'Tăng tạ ở bài 1-3 khi giữ được form với RIR 1-2.',
      'Bài 4-6 ưu tiên tăng reps trước, sau đó mới tăng tải.',
    ],
  };
}

function buildSpecificRoutineByIntent(intent: InputIntent): SpecificRoutineTemplate {
  const q = intent.normalizedQuestion.toLowerCase();
  if (/push day|push/i.test(q)) return buildPushDayRoutine(Boolean(intent.detailMode));
  if (intent.muscleGroupHint === 'chest') return buildChestRoutine(Boolean(intent.detailMode));
  if (intent.muscleGroupHint === 'back') return buildBackRoutine(Boolean(intent.detailMode));
  if (intent.muscleGroupHint === 'biceps' || /tay truoc|biceps/i.test(q)) return buildBicepsRoutine();
  return buildGeneralSpecificRoutine();
}

function buildPersonalizationSummary(profile: UserProfile): string[] {
  const notes: string[] = [];
  if (profile.gender) notes.push(`Giới tính: ${profile.gender}`);
  if (profile.age) notes.push(`Tuổi: ${profile.age}`);
  if (profile.currentWeightKg || profile.inBody?.weightKg) notes.push(`Cân nặng: ${profile.currentWeightKg || profile.inBody?.weightKg}kg`);
  if (profile.heightCm) notes.push(`Chiều cao: ${profile.heightCm}cm`);
  if (profile.goal) notes.push(`Mục tiêu: ${profile.goal}`);
  if (profile.experienceLevel) notes.push(`Kinh nghiệm: ${profile.experienceLevel}`);
  if (profile.training.injuries.length > 0) notes.push(`Chấn thương cần tránh: ${profile.training.injuries.join(', ')}`);
  if (profile.training.availableEquipment.length > 0) notes.push(`Thiết bị sẵn có: ${profile.training.availableEquipment.join(', ')}`);
  if (profile.foodPreference) notes.push(`Ưu tiên ăn uống: ${profile.foodPreference}`);
  return notes;
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
  const objective = objectiveFromGoal(profile.goal, intent.goalHint);
  const mealsPerDay = intent.parsedMealsPerDay ?? 3;

  const preference = intent.mealPreferenceHint || profile.foodPreference || '';
  const isDairyFree = /dairy_free|no_whey|không sữa|lactose|di ung sua/i.test(preference);

  const applyMealConstraints = (plan: MealPlanTemplate): MealPlanTemplate => {
    if (!isDairyFree) return plan;
    return {
      ...plan,
      meals: plan.meals.map((meal) => ({
        ...meal,
        foods: meal.foods.map((f) =>
          f
            .replace(/sữa chua hy lạp/gi, 'đậu phụ non')
            .replace(/sữa chua/gi, 'sữa hạt không đường')
            .replace(/whey protein/gi, 'ức gà hoặc đậu phụ')
            .replace(/whey/gi, 'đạm từ thực phẩm tự nhiên'),
        ),
      })),
      substitutions: [
        ...plan.substitutions,
        'Ưu tiên nguồn đạm thay thế từ đậu phụ, trứng, cá và thịt nạc; tránh toàn bộ sản phẩm từ sữa.',
      ],
    };
  };

  // Try to load a real plan from the dataset
  const loaded = mealPlanLoader.load(
    objective,
    nutrition.targetCalories ?? 2000,
    nutrition.proteinGrams ?? 150,
    nutrition.carbsGrams ?? 220,
    nutrition.fatGrams ?? 65,
    mealsPerDay,
    intent.mealPreferenceHint,
  );
  if (loaded) return applyMealConstraints(loaded);

  // Fallback when dataset unavailable
  const meals = isDairyFree
    ? [
        { mealName: 'Bữa sáng', foods: ['Yến mạch 60g', 'Sữa hạt không đường 250ml', 'Chuối 1 quả'] },
        { mealName: 'Bữa trưa', foods: ['Ức gà 150g', 'Cơm trắng 180g', 'Rau xanh 200g'] },
        { mealName: 'Bữa tối', foods: ['Cá hồi 150g', 'Khoai lang 250g', 'Salad 1 tô'] },
      ]
    : [
        { mealName: 'Bữa sáng', foods: ['Yến mạch 60g', 'Sữa chua Hy Lạp 200g', 'Chuối 1 quả'] },
        { mealName: 'Bữa trưa', foods: ['Ức gà 150g', 'Cơm trắng 180g', 'Rau xanh 200g'] },
        { mealName: 'Bữa tối', foods: ['Cá hồi 150g', 'Khoai lang 250g', 'Salad 1 tô'] },
      ];

  return applyMealConstraints({
    isDefaultTemplate: true,
    kcal: nutrition.targetCalories ?? 2100,
    proteinGrams: nutrition.proteinGrams ?? 150,
    carbsGrams: nutrition.carbsGrams ?? 220,
    fatGrams: nutrition.fatGrams ?? 65,
    meals,
    substitutions: [
      'Đổi ức gà → đậu hũ hoặc bò nạc (giữ nguyên gram protein).',
      'Đổi cơm trắng → khoai lang hoặc bánh mì nguyên cám (giữ nguyên gram carb).',
      isDairyFree
        ? 'Nếu dị ứng sữa: thay toàn bộ sữa/sữa chua/whey bằng sữa hạt, đậu phụ, trứng hoặc thịt nạc.'
        : 'Đổi cá hồi → trứng + dầu ô liu (giữ nguyên gram fat).',
    ],
  });
}

const FIELD_LABEL_VI: Record<string, string> = {
  weight: 'cân nặng hiện tại',
  height: 'chiều cao',
  age: 'tuổi',
  gender: 'giới tính',
  goal: 'mục tiêu tập luyện',
  activity_level: 'mức độ vận động hàng ngày',
  experience_level: 'kinh nghiệm tập luyện',
};

function buildFollowUps(intent: RoutedIntentType, missingFields: string[], language: ResponseLanguage = 'en'): string[] {
  const isVi = language === 'vi';

  const fromMissing = missingFields.slice(0, 2).map((f) => {
    if (isVi) {
      const label = FIELD_LABEL_VI[f] ?? f;
      return `Bạn có thể cho mình biết ${label} không?`;
    }
    return `Can you share your ${f}?`;
  });

  if (intent === 'specific_exercise_request' || intent === 'muscle_group_routine_request') {
    const extras = isVi
      ? ['Bạn tập ở nhà hay phòng gym?', 'Bạn có đau hoặc chấn thương nào cần tránh không?']
      : ['Do you train at home or gym?', 'Any pain or injury to avoid?'];
    return [...fromMissing, ...extras].slice(0, 3);
  }

  if (intent === 'meal_plan_request') {
    const extras = isVi
      ? ['Bạn có dị ứng thực phẩm hoặc chế độ ăn kiêng đặc biệt không?']
      : ['Any food allergy or diet preference?'];
    return [...fromMissing, ...extras].slice(0, 3);
  }

  const extras = isVi
    ? ['Bạn có thể tập mấy buổi mỗi tuần?']
    : ['How many training days per week can you commit?'];
  return [...fromMissing, ...extras].slice(0, 3);
}

export const recommendationEngine = {
  recommend(profile: UserProfile, intent: InputIntent, language: ResponseLanguage = 'en'): RecommendationResult {
    const responseIntent = intent.routeIntent || 'general_fitness_knowledge';
    const objective = objectiveFromGoal(profile.goal, intent.goalHint);
    const nutrition = nutritionCalculator.calculate(profile, intent);
    const workout = workoutPlanSelector.select(profile, intent);
    const meal = buildMealRecommendation(profile, objective, intent.mealPreferenceHint);

    const workoutPlan =
      responseIntent === 'workout_plan_request' ||
      responseIntent === 'body_recomposition_request' ||
      responseIntent === 'frequency_change_request' ||
      responseIntent === 'combined_plan_request'
        ? buildWorkoutPlanTemplate(profile, intent)
        : undefined;

    const specificRoutine =
      responseIntent === 'specific_exercise_request' || responseIntent === 'muscle_group_routine_request'
        ? buildSpecificRoutineByIntent(intent)
        : undefined;

    const mealPlan = (responseIntent === 'meal_plan_request' || responseIntent === 'combined_plan_request')
      ? buildMealPlanTemplate(profile, intent)
      : undefined;

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
      detailMode: Boolean(intent.detailMode),
      personalizationSummary: buildPersonalizationSummary(profile),
      nutrition,
      workout,
      meal,
      workoutPlan,
      specificRoutine,
      mealPlan,
      followUpQuestions: buildFollowUps(responseIntent, intent.missingFields, language),
      assumptions,
      missingFields: intent.missingFields,
    };
  },
};
