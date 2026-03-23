import type { IntentRoute, RoutedIntentType, UserProfile } from './types';

function normalize(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

function parseTrainingDays(question: string): number | undefined {
  const match = question.match(/(\d)\s*(buoi|sessions|days|ngay)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 7) return undefined;
  return parsed;
}

function inferGoal(question: string, profile?: UserProfile): IntentRoute['goalHint'] {
  const q = question.toLowerCase();
  if (/(fat loss|giam mo|siet mo|cut|giam can)/i.test(q)) return 'fat_loss';
  if (/(muscle gain|tang co|bulk|hypertrophy)/i.test(q)) return 'muscle_gain';
  if (/(recomp|recomposition|tai cau truc co the|vua giam mo vua tang co)/i.test(q)) return 'recomposition';
  if (/(maintain|duy tri)/i.test(q)) return 'maintenance';

  switch (profile?.goal) {
    case 'WEIGHT_LOSS':
      return 'fat_loss';
    case 'MUSCLE_GAIN':
      return 'muscle_gain';
    case 'MAINTENANCE':
      return 'maintenance';
    case 'RECOMPOSITION':
      return 'recomposition';
    default:
      return undefined;
  }
}

function inferMuscleGroup(question: string): IntentRoute['muscleGroupHint'] {
  const q = question.toLowerCase();
  if (/(tay truoc|biceps|bicep|cang tay|forearm)/i.test(q)) return 'biceps';
  if (/(tay sau|triceps)/i.test(q)) return 'triceps';
  if (/(nguc|chest)/i.test(q)) return 'chest';
  if (/(lung|back)/i.test(q)) return 'back';
  if (/(chan|legs|dui|mong)/i.test(q)) return 'legs';
  if (/(vai|shoulder)/i.test(q)) return 'shoulders';
  if (/(bung|core|abs)/i.test(q)) return 'core';
  return undefined;
}

function isUnsafeWeightLoss(question: string): boolean {
  const q = question.toLowerCase();
  const hasRapidLoss = /(giam|lose).{0,20}(\d{1,2})\s*kg.{0,20}(tuan|week|ngay|day)/i.test(q);
  const hasExtremePhrase = /(cang nhanh cang tot|nhanh nhat|cap toc|extreme|rapid)/i.test(q);
  const hasOneWeekTarget = /(1\s*(tuan|week)|mot\s*tuan)/i.test(q) && /(giam|lose).{0,20}kg/i.test(q);
  return hasRapidLoss || hasExtremePhrase || hasOneWeekTarget;
}

function inferIntent(question: string): RoutedIntentType {
  const q = question.toLowerCase();

  if (isUnsafeWeightLoss(q)) return 'unsafe_weight_loss_request';

  if (/(hoan thien ho so|cap nhat ho so|profile|thieu thong tin|bo sung thong tin)/i.test(q)) {
    return 'profile_completion_request';
  }

  if (/(vua giam mo vua tang co|recomposition|recomp|tai cau truc co the)/i.test(q)) {
    return 'body_recomposition_request';
  }

  if (/(thuc don|dinh duong|meal plan|calories|macro|protein|carb|fat|an gi)/i.test(q)) {
    return 'meal_plan_request';
  }

  if (/(tay truoc|tay sau|nguc|lung|chan|vai|bung|biceps|triceps|chest|back|legs|shoulders|core|forearm)/i.test(q) &&
    /(lich tap|routine|buoi tap|bai tap)/i.test(q)) {
    return 'muscle_group_routine_request';
  }

  if (/(lich tap cu the|tung bai|bai tap cu the la gi|cho toi bai tap cu the|specific exercise)/i.test(q)) {
    return 'specific_exercise_request';
  }

  if (/(lich tap|chuong trinh tap|split|plan tap|workout plan|lich nhu the nao)/i.test(q)) {
    return 'workout_plan_request';
  }

  return 'general_fitness_knowledge';
}

function computeMissingFields(profile?: UserProfile): string[] {
  if (!profile) return ['profile'];

  const missing: string[] = [];
  if (!profile.currentWeightKg && !profile.inBody?.weightKg) missing.push('weight');
  if (!profile.heightCm) missing.push('height');
  if (!profile.age) missing.push('age');
  if (!profile.gender) missing.push('gender');
  if (!profile.goal) missing.push('goal');
  if (!profile.activityLevel) missing.push('activity_level');
  if (!profile.experienceLevel) missing.push('experience_level');
  return missing;
}

export const intentRouter = {
  route(question: string, profile?: UserProfile): IntentRoute {
    const normalizedQuestion = normalize(question);
    return {
      normalizedQuestion,
      intent: inferIntent(normalizedQuestion),
      goalHint: inferGoal(normalizedQuestion, profile),
      muscleGroupHint: inferMuscleGroup(normalizedQuestion),
      parsedTrainingDays: parseTrainingDays(normalizedQuestion),
      missingFields: computeMissingFields(profile),
    };
  },
};
