import type { InputIntent, UserProfile } from './types';
import { intentRouter } from './intent_router';

function normalize(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

function inferIntent(question: string): InputIntent['intent'] {
  const q = question.toLowerCase();
  const workoutSignals = /(workout|lich tap|chuong trinh tap|split|hypertrophy|strength|plan tap)/i;
  const mealSignals = /(meal|dinh duong|thuc don|calories|macro|protein|fat|carb|an gi|meal plan)/i;
  const personalSignals = /(inbody|body fat|bmr|chieu cao|can nang|ho so|profile|history|lich su tap|nutrition history|injury|chan thuong)/i;

  if (workoutSignals.test(q) && (mealSignals.test(q) || personalSignals.test(q))) {
    return 'personalized_plan';
  }
  if (workoutSignals.test(q)) return 'workout_plan';
  if (mealSignals.test(q)) return 'meal_plan';
  if (personalSignals.test(q)) return 'personalized_plan';
  return 'knowledge';
}

function inferGoal(question: string, profile?: UserProfile): InputIntent['goalHint'] {
  const q = question.toLowerCase();
  if (/(fat loss|giam mo|siet mo|cut|giam can)/i.test(q)) return 'fat_loss';
  if (/(muscle gain|tang co|bulk|hypertrophy)/i.test(q)) return 'muscle_gain';
  if (/(recomp|recomposition|tai cau truc co the)/i.test(q)) return 'recomposition';
  if (/(maintain|duy tri)/i.test(q)) return 'maintenance';

  switch (profile?.goal) {
    case 'WEIGHT_LOSS':
      return 'fat_loss';
    case 'MUSCLE_GAIN':
      return 'muscle_gain';
    case 'MAINTENANCE':
      return 'maintenance';
    default:
      return undefined;
  }
}

function parseTrainingDays(question: string): number | undefined {
  const match = question.match(/(\d)\s*(buoi|sessions|days)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 7) return undefined;
  return parsed;
}

function inferMealPreference(question: string): string | undefined {
  const q = question.toLowerCase();
  if (/(chay|vegan)/i.test(q)) return 'vegan';
  if (/(vegetarian|an chay co sua)/i.test(q)) return 'vegetarian';
  if (/(low carb|it carb|keto)/i.test(q)) return 'low_carb';
  if (/(halal)/i.test(q)) return 'halal';
  return undefined;
}

function computeMissingFields(profile?: UserProfile, intent?: InputIntent['intent']): string[] {
  if (!profile) {
    return ['profile'];
  }

  const missing: string[] = [];
  const needsBodyMetrics = intent === 'meal_plan' || intent === 'personalized_plan' || intent === 'workout_plan';

  if (needsBodyMetrics) {
    if (!profile.currentWeightKg && !profile.inBody?.weightKg) missing.push('weight');
    if (!profile.heightCm) missing.push('height');
    if (!profile.age) missing.push('age');
    if (!profile.gender) missing.push('gender');
  }

  if (!profile.goal) missing.push('goal');
  if (!profile.activityLevel) missing.push('activity_level');
  if (!profile.experienceLevel) missing.push('experience_level');

  return missing;
}

export const inputParser = {
  parse(question: string, profile?: UserProfile): InputIntent {
    const normalizedQuestion = normalize(question);
    const routed = intentRouter.route(normalizedQuestion, profile);
    const intent = inferIntent(normalizedQuestion);
    const goalHint = inferGoal(normalizedQuestion, profile);
    const parsedTrainingDays = parseTrainingDays(normalizedQuestion);
    const mealPreferenceHint = inferMealPreference(normalizedQuestion);
    const mentionsInjury = /(injury|pain|chan thuong|dau goi|dau lung)/i.test(normalizedQuestion);
    const missingFields = computeMissingFields(profile, intent);

    return {
      normalizedQuestion,
      intent,
      routeIntent: routed.intent,
      goalHint,
      mealPreferenceHint,
      parsedTrainingDays: routed.parsedTrainingDays ?? parsedTrainingDays,
      mentionsInjury,
      needsPersonalization: intent === 'personalized_plan' || intent === 'workout_plan' || intent === 'meal_plan',
      missingFields: Array.from(new Set([...missingFields, ...routed.missingFields])),
    };
  },
};
