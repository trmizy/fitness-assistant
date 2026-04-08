import type { IntentRoute, RoutedIntentType, UserProfile } from './types';

function normalize(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

function parseTrainingDays(question: string): number | undefined {
  // Handles Vietnamese with/without diacritics: "5 buổi", "5 buoi", "5 sessions", "5 days"
  const match = question.match(/(\d)\s*(?:bu[oô][i\u0300\u0301\u0303\u0309\u0323]?|sessions?|days?|ng[aà]y)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 7) return undefined;
  return parsed;
}

function inferGoal(question: string, profile?: UserProfile): IntentRoute['goalHint'] {
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

  // frequency_change_request: "N buổi 1 tuần", "N buổi/tuần", "N sessions per week"
  // Check BEFORE schedule_specific_day to prevent misfire on "5 buổi 1 tuần"
  if (/\d+\s*bu[oổ]i\s*[/]?\s*(?:\d+\s*)?(?:tu[aầ]n|week)/i.test(q) ||
      /\d+\s*bu[oổ]i\s*m[oỗ]i\s*tu[aầ]n/i.test(q) ||
      /\d+\s*(?:sessions?|days?)\s*(?:per\s*week|a\s*week|\/week)/i.test(q) ||
      /(l[iị]ch t[aậ]p|workout plan|plan t[aậ]p).{0,20}\d+\s*bu[oổ]i/i.test(q)) {
    return 'frequency_change_request';
  }

  // schedule_specific_day_request: asking about a specific named day — NOT a frequency expression
  // "Thứ 2", "ngày 1", "ngày thứ 1" — but NOT "5 buổi 1 tuần"
  if (/(th[uứ]\s*(2|3|4|5|6|7|hai|ba|tứ?|tu|năm|nam|sáu|sau|bảy|bay))/i.test(q)) {
    return 'schedule_specific_day_request';
  }
  if (/\bng[aà]y\s*(?:thứ?\s*)?(1|2|3|4|5|6|7)\b/i.test(q)) {
    return 'schedule_specific_day_request';
  }
  // "buổi 1" only when not part of frequency expression like "5 buổi 1 tuần"
  const hasFrequency = /\d+\s*bu[oổ]i\s*\d/i.test(q);
  if (!hasFrequency && /\bbu[oổ]i\s*(1|2|3|4|5)\b/i.test(q)) {
    return 'schedule_specific_day_request';
  }

  if (/(v[uừ]a gi[aả]m m[oỡ] v[uừ]a t[aă]ng c[oơ]|vua giam mo vua tang co|recomposition|recomp|t[aá]i c[aấ]u tr[uú]c c[oơ] th[eể]|tai cau truc co the)/i.test(q)) {
    return 'body_recomposition_request';
  }

  if (/(l[iị]ch t[aậ]p|workout|plan t[aậ]p|ch[uươ]ng tr[iì]nh t[aậ]p).*(dinh d[uư][oơ]ng|th[uự]c [dđ][oơ]n|meal plan|[aă]n u[oố]ng)/i.test(q) ||
      /(dinh d[uư][oơ]ng|th[uự]c [dđ][oơ]n|meal plan|[aă]n u[oố]ng).*(l[iị]ch t[aậ]p|workout|plan t[aậ]p|ch[uươ]ng tr[iì]nh t[aậ]p)/i.test(q)) {
    return 'combined_plan_request';
  }

  if (/(th[uứự]c [dđ][oơ]n|thực đơn|dinh d[uư][oơỡ]ng|dinh dưỡng|b[ưữ]a [aă]n|bua an|meal plan|calories|macro|protein|carb|fat|[aă]n g[iì]|c[aá]ch [aă]n|meal prep|[aă]n u[oố]ng)/i.test(q)) {
    return 'meal_plan_request';
  }

  if (/(push|pull|legs|ppl|upper|lower)/i.test(q) && /(bu[oổ]i|session|routine|l[iị]ch t[aậ]p)/i.test(q)) {
    return 'muscle_group_routine_request';
  }

  if (/(tay tr[uướ]c|tay sau|ng[uự]c|l[uư]ng|ch[aâ]n|vai|b[uụ]ng|biceps|triceps|chest|back|legs|shoulders|core|forearm)/i.test(q) &&
    /(l[iị]ch t[aậ]p|routine|bu[oổ]i t[aậ]p|b[aà]i t[aậ]p)/i.test(q)) {
    return 'muscle_group_routine_request';
  }

  if (/(l[iị]ch t[aậ]p c[uụ] th[eể]|t[uừ]ng b[aà]i|b[aà]i t[aậ]p c[uụ] th[eể] l[aà] g[iì]|specific exercise)/i.test(q)) {
    return 'specific_exercise_request';
  }

  if (/(l[iị]ch t[aậ]p|ch[uươ][oơ]ng tr[iì]nh t[aậ]p|split|plan t[aậ]p|workout plan)/i.test(q)) {
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
