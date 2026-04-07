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
  if (/(fat loss|gi[aả]m m[oỡ]|giam mo|si[eế]t m[oỡ]|siet mo|cut|gi[aả]m c[aâ]n|giam can)/i.test(q)) return 'fat_loss';
  if (/(muscle gain|t[aă]ng c[oơ]|tang co|bulk|hypertrophy)/i.test(q)) return 'muscle_gain';
  if (/(recomp|recomposition|t[aá]i c[aấ]u tr[uú]c c[oơ] th[eể]|tai cau truc co the|v[uừ]a gi[aả]m m[oỡ] v[uừ]a t[aă]ng c[oơ]|vua giam mo vua tang co)/i.test(q)) return 'recomposition';
  if (/(maintain|duy tr[iì]|duy tri)/i.test(q)) return 'maintenance';

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

// Strip Vietnamese diacritics from common gym scheduling words for easier regex matching
function stripGymDiacritics(text: string): string {
  return text
    .replace(/bu[oổồộỗô][iị]/gi, 'buoi')
    .replace(/tu[aầ]n/gi, 'tuan')
    .replace(/ng[aà]y/gi, 'ngay')
    .replace(/[íì]t\s*nh[aấ]t/gi, 'it nhat')
    .replace(/m[oỗô]i/gi, 'moi')
    .replace(/b[aà]i\s*t[aậ]p/gi, 'bai tap')
    .replace(/b[aà]i/gi, 'bai');
}

function parseTrainingDays(question: string): number | undefined {
  const q = stripGymDiacritics(question);
  const match = q.match(/(\d+)\s*(?:buoi|sessions?|days?)\s*(?:\d+\s*)?(?:tuan|week|per week)/i)
    || q.match(/(\d+)\s*(?:buoi|sessions?|days?)(?:\s*(?:moi|per)\s*(?:tuan|week))?/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 7) return undefined;
  return parsed;
}

function parseMinimumExercisesPerDay(question: string): number | undefined {
  const q = stripGymDiacritics(question);
  // "ít nhất 5 bài tập", "at least 5 exercises", "mỗi buổi 5 bài", "5 bài mỗi buổi"
  const patterns = [
    /(?:it nhat|at least|toi thieu|minimum)\s*(\d+)\s*(?:bai tap|bai|exercises?)/i,
    /(\d+)\s*(?:bai tap|bai|exercises?)\s*(?:moi buoi|per session|each session)/i,
    /moi buoi\s*(?:it nhat|at least)?\s*(\d+)\s*(?:bai tap|bai|exercises?)?/i,
    /(\d+)\s*(?:bai tap|exercises?)\s*(?:cho moi|for each)\s*buoi/i,
  ];
  for (const p of patterns) {
    const m = q.match(p);
    if (m) {
      const val = Number(m[1]);
      if (!Number.isNaN(val) && val >= 1 && val <= 15) return val;
    }
  }
  return undefined;
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
    const minimumExercisesPerDay = parseMinimumExercisesPerDay(normalizedQuestion);
    const mealPreferenceHint = inferMealPreference(normalizedQuestion);
    const mentionsInjury = /(injury|pain|ch[aấ]n th[uươ][oơ]ng|chan thuong|[dđ]au g[oố]i|dau goi|[dđ]au l[uư]ng|dau lung|[dđ]au vai|dau vai|[dđ]au kh[oớ]p|knee pain|shoulder pain|back pain)/i.test(normalizedQuestion);
    const requestsCardio = /(cardio|c[aà]o tim|aerobic|ch[aạ]y b[oộ]|chay bo|[dđ][aạ]p xe|dap xe|swimming|b[oơ]i l[oộ]i|rowing|b[uướ][oớ]c nhanh|buoc nhanh)/i.test(normalizedQuestion);
    const mealsMatch = stripGymDiacritics(normalizedQuestion).match(/(\d)\s*bua(?:\s*an)?(?:\s*moi\s*ngay)?(?:\s*trong\s*(?:\d+\s*)?(?:ngay|tuan|week))?/i)
      || stripGymDiacritics(normalizedQuestion).match(/(\d)\s*(?:meals?|bua)\s*(?:a\s*day|per\s*day)/i);
    const parsedMealsPerDay = mealsMatch ? Math.min(6, Math.max(1, Number(mealsMatch[1]))) : undefined;
    const missingFields = computeMissingFields(profile, intent);

    return {
      normalizedQuestion,
      intent,
      routeIntent: routed.intent,
      goalHint,
      mealPreferenceHint,
      parsedTrainingDays: routed.parsedTrainingDays ?? parsedTrainingDays,
      minimumExercisesPerDay,
      parsedMealsPerDay,
      mentionsInjury,
      requestsCardio,
      needsPersonalization: intent === 'personalized_plan' || intent === 'workout_plan' || intent === 'meal_plan',
      missingFields: Array.from(new Set([...missingFields, ...routed.missingFields])),
    };
  },
};
