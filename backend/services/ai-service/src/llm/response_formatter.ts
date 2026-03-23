import { labelLocalizer } from './label_localizer';
import type { RecommendationResult, ResponseLanguage, UnsafeGuidance } from './types';

function formatExerciseLine(name: string, sets: number, reps: string, restSeconds: number, language: ResponseLanguage): string {
  if (language === 'vi') {
    return `- ${name}: ${sets} hiep x ${reps} reps, nghi ${restSeconds} giay`;
  }
  return `- ${name}: ${sets} sets x ${reps} reps, rest ${restSeconds}s`;
}

function joinFollowUps(questions: string[] | undefined, language: ResponseLanguage): string {
  const safeQuestions = (questions || []).slice(0, 3);
  if (safeQuestions.length === 0) return '';

  const heading = language === 'vi' ? 'Cau hoi de ca nhan hoa them:' : 'Follow-up to personalize further:';
  return [heading, ...safeQuestions.map((q, idx) => `${idx + 1}. ${q}`)].join('\n');
}

function formatUnsafe(guidance: UnsafeGuidance, language: ResponseLanguage): string {
  if (language === 'vi') {
    return [
      'Muc tieu nay khong an toan.',
      guidance.reason,
      `Muc tieu thay the an toan: ${guidance.safeAlternative}`,
      'Buoc dau trong tuan nay:',
      ...guidance.firstWeekSteps.map((step, idx) => `${idx + 1}. ${step}`),
    ].join('\n');
  }

  return [
    'That goal is unsafe.',
    guidance.reason,
    `Safer alternative: ${guidance.safeAlternative}`,
    'First steps for this week:',
    ...guidance.firstWeekSteps.map((step, idx) => `${idx + 1}. ${step}`),
  ].join('\n');
}

function formatWorkoutPlan(rec: RecommendationResult, language: ResponseLanguage): string {
  const plan = rec.workoutPlan;
  if (!plan) return language === 'vi' ? 'Toi da tao lich tap mac dinh.' : 'I created a default workout plan.';

  const lines: string[] = [];
  if (language === 'vi') {
    lines.push(plan.isDefaultTemplate ? 'Day la lich mau mac dinh do thieu ho so chi tiet.' : 'Day la lich tap duoc ca nhan hoa theo ho so cua ban.');
    lines.push(`Tom tat muc tieu: ${plan.goalSummary}`);
    lines.push('Lich tap theo ngay:');
  } else {
    lines.push(plan.isDefaultTemplate ? 'This is a safe default template because profile data is incomplete.' : 'This plan is personalized from your profile.');
    lines.push(`Goal summary: ${plan.goalSummary}`);
    lines.push('Training schedule by day:');
  }

  for (const day of plan.days) {
    lines.push(`${day.day} - ${day.goal}`);
    day.exercises.forEach((ex) => {
      lines.push(formatExerciseLine(ex.name, ex.sets, ex.reps, ex.restSeconds, language));
    });
    if (day.cardio) {
      lines.push(language === 'vi' ? `Cardio: ${day.cardio}` : `Cardio: ${day.cardio}`);
    }
  }

  lines.push(language === 'vi' ? 'Ghi chu tang tien:' : 'Progression notes:');
  plan.progressionNotes.forEach((note, idx) => lines.push(`${idx + 1}. ${note}`));

  const followups = joinFollowUps(rec.followUpQuestions, language);
  if (followups) lines.push(followups);

  return lines.join('\n');
}

function formatSpecificRoutine(rec: RecommendationResult, language: ResponseLanguage): string {
  const routine = rec.specificRoutine;
  if (!routine) return language === 'vi' ? 'Toi da tao buoi tap cu the mac dinh.' : 'I created a default specific routine.';

  const lines: string[] = [];
  if (language === 'vi') {
    lines.push(routine.isDefaultTemplate ? 'Day la buoi tap mau mac dinh, ban co the ap dung ngay.' : 'Day la buoi tap da duoc ca nhan hoa.');
    lines.push(`Muc tieu buoi tap: ${routine.sessionGoal}`);
    lines.push('Danh sach bai tap cu the:');
  } else {
    lines.push(routine.isDefaultTemplate ? 'This is a default routine you can start right away.' : 'This routine is personalized.');
    lines.push(`Session goal: ${routine.sessionGoal}`);
    lines.push('Specific exercise list:');
  }

  routine.exercises.forEach((ex) => lines.push(formatExerciseLine(ex.name, ex.sets, ex.reps, ex.restSeconds, language)));

  lines.push(language === 'vi' ? 'Luu y ky thuat:' : 'Technique notes:');
  routine.techniqueNotes.forEach((note, idx) => lines.push(`${idx + 1}. ${note}`));

  lines.push(language === 'vi' ? 'Cach tang tai:' : 'How to progress load:');
  routine.overloadGuide.forEach((note, idx) => lines.push(`${idx + 1}. ${note}`));

  const followups = joinFollowUps(rec.followUpQuestions, language);
  if (followups) lines.push(followups);

  return lines.join('\n');
}

function formatMealPlan(rec: RecommendationResult, language: ResponseLanguage): string {
  const mealPlan = rec.mealPlan;
  if (!mealPlan) return language === 'vi' ? 'Toi da tao thuc don mau.' : 'I created a sample meal plan.';

  const lines: string[] = [];
  if (language === 'vi') {
    lines.push(mealPlan.isDefaultTemplate ? 'Day la thuc don mau mac dinh do thieu mot so chi so co the.' : 'Day la thuc don duoc tinh theo ho so cua ban.');
    lines.push(`Kcal mau: ${mealPlan.kcal}`);
    lines.push(`Macro mau: Protein ${mealPlan.proteinGrams}g | Carb ${mealPlan.carbsGrams}g | Fat ${mealPlan.fatGrams}g`);
    lines.push('Mau bua an:');
  } else {
    lines.push(mealPlan.isDefaultTemplate ? 'This is a default sample meal plan because some body metrics are missing.' : 'This meal plan is based on your profile.');
    lines.push(`Sample kcal: ${mealPlan.kcal}`);
    lines.push(`Sample macros: Protein ${mealPlan.proteinGrams}g | Carbs ${mealPlan.carbsGrams}g | Fats ${mealPlan.fatGrams}g`);
    lines.push('Meal examples:');
  }

  mealPlan.meals.forEach((meal, idx) => {
    lines.push(`${idx + 1}. ${meal.mealName}: ${meal.foods.join(', ')}`);
  });

  lines.push(language === 'vi' ? 'Goi y thay the mon:' : 'Food substitutions:');
  mealPlan.substitutions.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));

  const followups = joinFollowUps(rec.followUpQuestions, language);
  if (followups) lines.push(followups);

  return lines.join('\n');
}

function formatGeneral(rec: RecommendationResult, language: ResponseLanguage): string {
  const lines: string[] = [];
  if (language === 'vi') {
    lines.push('Toi da tra loi truc tiep theo yeu cau hien tai va uu tien huong dan ap dung ngay.');
    lines.push(`Muc tieu hien tai: ${rec.objective}`);
  } else {
    lines.push('Here is a direct, practical answer based on your current request.');
    lines.push(`Current objective: ${rec.objective}`);
  }

  const followups = joinFollowUps(rec.followUpQuestions, language);
  if (followups) lines.push(followups);
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
      recommendation.responseIntent === 'body_recomposition_request'
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
