import type { InputIntent, UserProfile, WorkoutRecommendation } from './types';

function chooseSplit(daysPerWeek: number, goal: string, level: string): string {
  if (daysPerWeek <= 2) return 'full_body';
  if (daysPerWeek === 3) return goal === 'fat_loss' ? 'full_body_plus_conditioning' : 'upper_lower_full';
  if (daysPerWeek === 4) return goal === 'muscle_gain' ? 'upper_lower' : 'push_pull_legs_upper';
  if (daysPerWeek >= 5) {
    if (level === 'BEGINNER') return 'upper_lower_plus_accessory';
    return goal === 'muscle_gain' ? 'push_pull_legs_upper_lower' : 'push_pull_legs_plus_conditioning';
  }
  return 'full_body';
}

function inferFocus(goal: string): string[] {
  if (goal === 'fat_loss') return ['compound training', 'cardio support', 'daily movement'];
  if (goal === 'muscle_gain') return ['progressive overload', 'hypertrophy volume', 'recovery'];
  if (goal === 'recomposition') return ['strength maintenance', 'moderate training volume', 'nutrition adherence'];
  return ['balanced fitness'];
}

function resolveGoal(profileGoal?: UserProfile['goal'], hint?: InputIntent['goalHint']): string {
  if (hint) return hint;
  switch (profileGoal) {
    case 'WEIGHT_LOSS':
      return 'fat_loss';
    case 'MUSCLE_GAIN':
      return 'muscle_gain';
    case 'MAINTENANCE':
      return 'maintenance';
    default:
      return 'recomposition';
  }
}

function deriveAvoidedPatterns(injuries: string[]): string[] {
  const text = injuries.join(' ').toLowerCase();
  const avoided: string[] = [];

  if (/(knee|goi)/i.test(text)) {
    avoided.push('deep_knee_flexion_under_heavy_load');
    avoided.push('high_impact_jumping');
  }
  if (/(back|lung|spine)/i.test(text)) {
    avoided.push('heavy_axial_loading');
    avoided.push('high_velocity_spinal_flexion');
  }
  if (/(shoulder|vai)/i.test(text)) {
    avoided.push('overhead_press_pain_range');
  }

  return avoided;
}

export const workoutPlanSelector = {
  select(profile: UserProfile, intent: InputIntent): WorkoutRecommendation {
    const goal = resolveGoal(profile.goal, intent.goalHint);
    const level = profile.experienceLevel || 'INTERMEDIATE';
    const daysPerWeek =
      intent.parsedTrainingDays ||
      profile.training.trainingDaysPerWeek ||
      Math.max(3, profile.training.preferredTrainingDays.length || 0) ||
      3;

    const assumptions: string[] = [];
    if (!intent.parsedTrainingDays && !profile.training.trainingDaysPerWeek) {
      assumptions.push('Assumed 3 sessions per week due to missing training frequency.');
    }

    const avoidedPatterns = deriveAvoidedPatterns(profile.training.injuries);

    return {
      split: chooseSplit(daysPerWeek, goal, level),
      sessionsPerWeek: daysPerWeek,
      focus: inferFocus(goal),
      avoidedPatterns,
      assumptions,
    };
  },
};
