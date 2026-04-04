import { labelLocalizer } from './label_localizer';
import type { RecommendationResult, ResponseLanguage, UnsafeGuidance } from './types';

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
    lines.push('| Ngày | Nhóm cơ | Bài tập | Sets | Reps | Rest |');
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
    if (mealPlan.isDefaultTemplate) {
      lines.push('> Thực đơn mẫu — cập nhật thông số cơ thể để tính chính xác hơn.');
      lines.push('');
    }
    lines.push(`📊 **Mục tiêu ngày:** ${mealPlan.kcal} kcal | Đạm: **${mealPlan.proteinGrams}g** | Carb: **${mealPlan.carbsGrams}g** | Béo: **${mealPlan.fatGrams}g**`);
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
    lines.push('### 🍽️ Meal Examples');
  }

  mealPlan.meals.forEach((meal, idx) => {
    lines.push(`${idx + 1}. **${meal.mealName}**: ${meal.foods.join(', ')}`);
  });

  lines.push('');
  lines.push(language === 'vi' ? '### 🔄 Thực Phẩm Thay Thế' : '### 🔄 Food Substitutions');
  mealPlan.substitutions.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));

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
  }

  const followups = joinFollowUps(rec.followUpQuestions, language);
  if (followups) {
    lines.push('');
    lines.push(followups);
  }

  return lines.join('\n');
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
    } else if (recommendation.responseIntent === 'meal_plan_request') {
      text = formatMealPlan(recommendation, language);
    } else {
      text = formatGeneral(recommendation, language);
    }

    return labelLocalizer.localize(text, language);
  },
};
