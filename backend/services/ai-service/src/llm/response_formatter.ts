import { labelLocalizer } from './label_localizer';
import type { RecommendationResult, ResponseLanguage, UnsafeGuidance } from './types';

function formatNutritionSummary(rec: RecommendationResult, language: ResponseLanguage): string[] {
  const n = rec.nutrition;
  if (language === 'vi') {
    return [
      '## 🥗 Dinh Dưỡng',
      '| Chỉ số | Giá trị |',
      '|--------|---------|',
      `| Calo | ${n.targetCalories ?? 0} kcal |`,
      `| Đạm | ${n.proteinGrams ?? 0}g |`,
      `| Carb | ${n.carbsGrams ?? 0}g |`,
      `| Béo | ${n.fatGrams ?? 0}g |`,
    ];
  }

  return [
    '## 🥗 Nutrition',
    '| Metric | Value |',
    '|--------|-------|',
    `| Calories | ${n.targetCalories ?? 0} kcal |`,
    `| Protein | ${n.proteinGrams ?? 0}g |`,
    `| Carbs | ${n.carbsGrams ?? 0}g |`,
    `| Fats | ${n.fatGrams ?? 0}g |`,
  ];
}

function buildActionSteps(rec: RecommendationResult, language: ResponseLanguage): string[] {
  const steps = language === 'vi'
    ? [
      `Ưu tiên hoàn thành **${rec.workout.sessionsPerWeek} buổi/tuần** theo lịch đã gợi ý.`,
      `Theo dõi macro trong 7 ngày: **Đạm ${rec.nutrition.proteinGrams ?? 0}g | Carb ${rec.nutrition.carbsGrams ?? 0}g | Béo ${rec.nutrition.fatGrams ?? 0}g**.`,
      'Ghi lại mức năng lượng, chất lượng ngủ và hiệu suất tập để điều chỉnh vào tuần sau.',
    ]
    : [
      `Complete **${rec.workout.sessionsPerWeek} sessions/week** from the plan.`,
      `Track macros for 7 days: **Protein ${rec.nutrition.proteinGrams ?? 0}g | Carbs ${rec.nutrition.carbsGrams ?? 0}g | Fats ${rec.nutrition.fatGrams ?? 0}g**.`,
      'Log energy, sleep quality, and training performance to adjust next week.',
    ];

  return [
    language === 'vi' ? '## ⚡ Hành Động Tuần Này' : '## ⚡ Action Steps This Week',
    ...steps.map((s, idx) => `${idx + 1}. ${s}`),
  ];
}

function assumptionsBlock(rec: RecommendationResult, language: ResponseLanguage): string[] {
  if (rec.assumptions.length === 0) return [];
  const title = language === 'vi' ? '**Giả định:**' : '**Assumptions:**';
  return [title, ...rec.assumptions.slice(0, 3).map((item) => `- ${item}`)];
}

function restLabel(restSeconds: number): string {
  if (restSeconds >= 60) {
    const m = Math.floor(restSeconds / 60);
    const s = restSeconds % 60;
    return s > 0 ? `${m}p${s}s` : `${m} phút`;
  }
  return `${restSeconds}s`;
}

function formatExerciseLine(name: string, sets: number, reps: string, restSeconds: number, language: ResponseLanguage): string {
  if (language === 'vi') {
    return `- **${name}**: ${sets} hiệp × ${reps} reps — nghỉ ${restLabel(restSeconds)}`;
  }
  return `- **${name}**: ${sets} sets × ${reps} reps — rest ${restLabel(restSeconds)}`;
}

function joinFollowUps(questions: string[] | undefined, language: ResponseLanguage): string {
  const safeQuestions = (questions || []).slice(0, 2);
  if (safeQuestions.length === 0) return '';

  const heading = language === 'vi'
    ? '**Để cá nhân hóa thêm:**'
    : '**To dial this in further:**';
  return [heading, ...safeQuestions.map((q, idx) => `${idx + 1}. ${q}`)].join('\n');
}

function formatUnsafe(guidance: UnsafeGuidance, language: ResponseLanguage): string {
  if (language === 'vi') {
    return [
      '## ⚠️ Mục Tiêu Này Không An Toàn',
      '',
      guidance.reason,
      '',
      `**Mục tiêu thay thế an toàn:** ${guidance.safeAlternative}`,
      '',
      '## ⚡ Bước Đầu Tiên Tuần Này',
      ...guidance.firstWeekSteps.map((step, idx) => `${idx + 1}. ${step}`),
    ].join('\n');
  }

  return [
    '## ⚠️ That Goal Is Unsafe',
    '',
    guidance.reason,
    '',
    `**Safer alternative:** ${guidance.safeAlternative}`,
    '',
    '## ⚡ First Steps This Week',
    ...guidance.firstWeekSteps.map((step, idx) => `${idx + 1}. ${step}`),
  ].join('\n');
}

function formatWorkoutPlan(rec: RecommendationResult, language: ResponseLanguage): string {
  const plan = rec.workoutPlan;
  if (!plan) {
    return language === 'vi'
      ? '## 💪 Lịch Tập\nĐã tạo lịch tập mặc định.'
      : '## 💪 Training Plan\nDefault plan created.';
  }

  const lines: string[] = [];

  if (language === 'vi') {
    lines.push('## 💪 Lịch Tập Của Bạn');
    lines.push('');
    if ((rec.personalizationSummary || []).length > 0) {
      lines.push('**Cá nhân hóa theo dữ liệu của bạn:**');
      rec.personalizationSummary!.slice(0, 4).forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    }
    lines.push(`🎯 **Mục tiêu:** ${plan.goalSummary}`);
    if (plan.isDefaultTemplate) {
      lines.push('> Lịch mẫu — cập nhật hồ sơ để cá nhân hóa thêm.');
    }
  } else {
    lines.push('## 💪 Your Training Plan');
    lines.push('');
    lines.push(`🎯 **Goal:** ${plan.goalSummary}`);
    if (plan.isDefaultTemplate) {
      lines.push('> Default template — update your profile to personalize further.');
    }
  }

  // Single unified table with "Ngày" column — day name on first row of each group
  lines.push('');
  if (language === 'vi') {
    lines.push('| Ngày | Nhóm cơ | Bài tập | Hiệp | Lần lặp | Nghỉ |');
    lines.push('|------|---------|---------|:----:|:----:|:----:|');
    for (const day of plan.days) {
      day.exercises.forEach((ex, idx) => {
        const dayCell = idx === 0 ? day.day : '';
        const groupCell = idx === 0 ? day.goal : '';
        lines.push(`| ${dayCell} | ${groupCell} | ${ex.name} | ${ex.sets} | ${ex.reps} | ${restLabel(ex.restSeconds)} |`);
      });
      if (day.cardio) {
        lines.push(`| | 🏃 Cardio | ${day.cardio} | | | |`);
      }
    }
  } else {
    lines.push('| Day | Muscle Group | Exercise | Sets | Reps | Rest |');
    lines.push('|-----|-------------|----------|:----:|:----:|:----:|');
    for (const day of plan.days) {
      day.exercises.forEach((ex, idx) => {
        const dayCell = idx === 0 ? day.day : '';
        const groupCell = idx === 0 ? day.goal : '';
        lines.push(`| ${dayCell} | ${groupCell} | ${ex.name} | ${ex.sets} | ${ex.reps} | ${restLabel(ex.restSeconds)} |`);
      });
      if (day.cardio) {
        lines.push(`| | 🏃 Cardio | ${day.cardio} | | | |`);
      }
    }
  }

  lines.push('');
  lines.push(language === 'vi' ? '### 📈 Ghi Chú Tăng Tiến' : '### 📈 Progression Notes');
  plan.progressionNotes.forEach((note, idx) => lines.push(`${idx + 1}. ${note}`));

  lines.push('');
  lines.push(...formatNutritionSummary(rec, language));

  lines.push('');
  lines.push(...buildActionSteps(rec, language));

  const assumptions = assumptionsBlock(rec, language);
  if (assumptions.length > 0) {
    lines.push('');
    lines.push(...assumptions);
  }

  const followups = joinFollowUps(rec.followUpQuestions, language);
  if (followups) {
    lines.push('');
    lines.push(followups);
  }

  return lines.join('\n');
}

function formatSpecificRoutine(rec: RecommendationResult, language: ResponseLanguage): string {
  const routine = rec.specificRoutine;
  if (!routine) {
    return language === 'vi'
      ? '## 💪 Buổi Tập\nĐã tạo buổi tập mặc định.'
      : '## 💪 Workout\nDefault routine created.';
  }

  const lines: string[] = [];

  if (language === 'vi') {
    lines.push('## 💪 Buổi Tập Theo Yêu Cầu');
    lines.push('');
    if ((rec.personalizationSummary || []).length > 0) {
      lines.push('**Cá nhân hóa theo dữ liệu của bạn:**');
      rec.personalizationSummary!.slice(0, 4).forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    }
    lines.push(`🎯 **Mục tiêu buổi tập:** ${routine.sessionGoal}`);
    if (routine.isDefaultTemplate) {
      lines.push('> Lịch mặc định — bắt đầu ngay được.');
    }
    lines.push('');
    lines.push('### 🏋️ Danh Sách Bài Tập');
  } else {
    lines.push('## 💪 Targeted Workout');
    lines.push('');
    lines.push(`🎯 **Session goal:** ${routine.sessionGoal}`);
    if (routine.isDefaultTemplate) {
      lines.push('> Default routine — you can start this immediately.');
    }
    lines.push('');
    lines.push('### 🏋️ Exercise List');
  }

  routine.exercises.forEach((ex) =>
    lines.push(formatExerciseLine(ex.name, ex.sets, ex.reps, ex.restSeconds, language)),
  );

  lines.push('');
  lines.push(language === 'vi' ? '### 🔧 Kỹ Thuật Thực Hiện' : '### 🔧 Technique Notes');
  routine.techniqueNotes.forEach((note, idx) => lines.push(`${idx + 1}. ${note}`));

  lines.push('');
  lines.push(language === 'vi' ? '### 📈 Tăng Tải Tiến Bộ' : '### 📈 Progressive Overload');
  routine.overloadGuide.forEach((note, idx) => lines.push(`${idx + 1}. ${note}`));

  lines.push('');
  lines.push(language === 'vi' ? '### ⚠️ An Toàn Khi Tập' : '### ⚠️ Safety Notes');
  if (rec.workout.avoidedPatterns.length > 0) {
    rec.workout.avoidedPatterns.slice(0, 3).forEach((pattern, idx) => lines.push(`${idx + 1}. ${pattern}`));
  } else {
    lines.push(language === 'vi' ? '1. Giữ kỹ thuật chuẩn, dừng buổi tập khi đau nhói bất thường.' : '1. Maintain strict technique and stop if sharp pain appears.');
  }

  lines.push('');
  lines.push(...formatNutritionSummary(rec, language));

  lines.push('');
  lines.push(...buildActionSteps(rec, language));

  const assumptions = assumptionsBlock(rec, language);
  if (assumptions.length > 0) {
    lines.push('');
    lines.push(...assumptions);
  }

  const followups = joinFollowUps(rec.followUpQuestions, language);
  if (followups) {
    lines.push('');
    lines.push(followups);
  }

  return lines.join('\n');
}

function formatMealPlan(rec: RecommendationResult, language: ResponseLanguage): string {
  const mealPlan = rec.mealPlan;
  if (!mealPlan) {
    return language === 'vi'
      ? '## 🥗 Thực Đơn\nĐã tạo thực đơn mặc định.'
      : '## 🥗 Meal Plan\nDefault plan created.';
  }

  const lines: string[] = [];

  if (language === 'vi') {
    lines.push('## 🥗 Thực Đơn Của Bạn');
    lines.push('');
    if ((rec.personalizationSummary || []).length > 0) {
      lines.push('**Cá nhân hóa theo dữ liệu của bạn:**');
      rec.personalizationSummary!.slice(0, 5).forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    }
    if (mealPlan.isDefaultTemplate) {
      lines.push('> Thực đơn mẫu — cập nhật thông số cơ thể để tính chính xác hơn.');
      lines.push('');
    }
    lines.push(`📊 **Mục tiêu ngày:** ${mealPlan.kcal} kcal | Đạm: **${mealPlan.proteinGrams}g** | Carb: **${mealPlan.carbsGrams}g** | Béo: **${mealPlan.fatGrams}g**`);
    lines.push('');
    lines.push(...formatNutritionSummary(rec, language));
    lines.push('');
    lines.push('### 🍽️ Gợi Ý Bữa Ăn');
  } else {
    lines.push('## 🥗 Your Meal Plan');
    lines.push('');
    if (mealPlan.isDefaultTemplate) {
      lines.push('> Sample plan — update your body metrics for precise targets.');
      lines.push('');
    }
    lines.push(`📊 **Daily targets:** ${mealPlan.kcal} kcal | Protein: **${mealPlan.proteinGrams}g** | Carbs: **${mealPlan.carbsGrams}g** | Fats: **${mealPlan.fatGrams}g**`);
    lines.push('');
    lines.push(...formatNutritionSummary(rec, language));
    lines.push('');
    lines.push('### 🍽️ Meal Examples');
  }

  mealPlan.meals.forEach((meal, idx) => {
    lines.push(`${idx + 1}. **${meal.mealName}**: ${meal.foods.join(', ')}`);
  });

  lines.push('');
  lines.push(language === 'vi' ? '### 🔄 Thực Phẩm Thay Thế' : '### 🔄 Food Substitutions');
  mealPlan.substitutions.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));

  lines.push('');
  lines.push(language === 'vi' ? '## 🔄 Cách Điều Chỉnh Theo Thời Gian' : '## 🔄 How To Adjust Over Time');
  lines.push(
    language === 'vi'
      ? 'Nếu cân nặng đứng yên 2 tuần, giảm thêm 100-150 kcal/ngày hoặc tăng nhẹ hoạt động NEAT.'
      : 'If progress stalls for 2 weeks, reduce 100-150 kcal/day or increase NEAT slightly.',
  );

  lines.push('');
  lines.push(...buildActionSteps(rec, language));

  const assumptions = assumptionsBlock(rec, language);
  if (assumptions.length > 0) {
    lines.push('');
    lines.push(...assumptions);
  }

  const followups = joinFollowUps(rec.followUpQuestions, language);
  if (followups) {
    lines.push('');
    lines.push(followups);
  }

  return lines.join('\n');
}

function formatGeneral(rec: RecommendationResult, language: ResponseLanguage): string {
  const lines: string[] = [];
  const n = rec.nutrition;
  const w = rec.workout;

  if (language === 'vi') {
    lines.push('## 📊 Tổng Quan Của Bạn');
    lines.push('');
    if ((rec.personalizationSummary || []).length > 0) {
      lines.push('**Cá nhân hóa theo dữ liệu của bạn:**');
      rec.personalizationSummary!.slice(0, 4).forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    }
    if ((n.targetCalories ?? 0) > 0) {
      lines.push(`**Mục tiêu calo:** ${n.targetCalories} kcal/ngày`);
      lines.push(`**Macro:** Đạm **${n.proteinGrams}g** | Carb **${n.carbsGrams}g** | Béo **${n.fatGrams}g**`);
      lines.push('');
    }
    if (w.sessionsPerWeek > 0) {
      lines.push(`**Lịch tập:** ${w.sessionsPerWeek} buổi/tuần — ${w.split}`);
      if (w.focus.length > 0) {
        lines.push(`**Trọng tâm:** ${w.focus.join(', ')}`);
      }
    }

    lines.push('');
    lines.push(...formatNutritionSummary(rec, language));
  } else {
    lines.push('## 📊 Your Overview');
    lines.push('');
    if ((n.targetCalories ?? 0) > 0) {
      lines.push(`**Calorie target:** ${n.targetCalories} kcal/day`);
      lines.push(`**Macros:** Protein **${n.proteinGrams}g** | Carbs **${n.carbsGrams}g** | Fats **${n.fatGrams}g**`);
      lines.push('');
    }
    if (w.sessionsPerWeek > 0) {
      lines.push(`**Training:** ${w.sessionsPerWeek} sessions/week — ${w.split}`);
      if (w.focus.length > 0) {
        lines.push(`**Focus:** ${w.focus.join(', ')}`);
      }
    }

    lines.push('');
    lines.push(...formatNutritionSummary(rec, language));
  }

  lines.push('');
  lines.push(...buildActionSteps(rec, language));

  const assumptions = assumptionsBlock(rec, language);
  if (assumptions.length > 0) {
    lines.push('');
    lines.push(...assumptions);
  }

  const followups = joinFollowUps(rec.followUpQuestions, language);
  if (followups) {
    lines.push('');
    lines.push(followups);
  }

  return lines.join('\n');
}

function formatCombinedPlan(rec: RecommendationResult, language: ResponseLanguage): string {
  const workout = formatWorkoutPlan(rec, language);
  const meal = formatMealPlan(rec, language);
  const title = language === 'vi' ? '## 🎯 Kế Hoạch Tập + Ăn Kết Hợp' : '## 🎯 Combined Training + Nutrition Plan';
  return [title, '', workout, '', meal].join('\n');
}

export const responseFormatter = {
  format(recommendation: RecommendationResult, language: ResponseLanguage): string {
    let text: string;

    if (recommendation.unsafeGuidance?.blocked) {
      text = formatUnsafe(recommendation.unsafeGuidance, language);
    } else if (
      recommendation.responseIntent === 'specific_exercise_request' ||
      recommendation.responseIntent === 'muscle_group_routine_request'
    ) {
      text = formatSpecificRoutine(recommendation, language);
    } else if (
      recommendation.responseIntent === 'workout_plan_request' ||
      recommendation.responseIntent === 'body_recomposition_request' ||
      recommendation.responseIntent === 'frequency_change_request'
    ) {
      text = formatWorkoutPlan(recommendation, language);
    } else if (recommendation.responseIntent === 'combined_plan_request') {
      text = formatCombinedPlan(recommendation, language);
    } else if (recommendation.responseIntent === 'meal_plan_request') {
      text = formatMealPlan(recommendation, language);
    } else {
      text = formatGeneral(recommendation, language);
    }

    return labelLocalizer.localize(text, language);
  },
};
