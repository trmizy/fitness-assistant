import type { AllowedExerciseItem, PlanContent } from '../schemas/plan.schemas';
import type { EvidenceUsed } from '../llm/types';
import type { CoachContext } from './coach_context.types';
import { estimateTdeeRange, recommendCalorieTarget, recommendProteinTarget } from './fitness_calculations';

export interface StructuredExercisePrescription {
  exercise_id?: string;
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  target_muscles?: string[];
  note?: string;
}

export interface StructuredWeeklyScheduleDay {
  day: string;
  focus: string;
  exercises: StructuredExercisePrescription[];
  cardio?: string;
}

export interface StructuredCoachPlan {
  assessment: {
    goal_summary: string;
    readiness: 'low' | 'medium' | 'high';
    key_limitations: string[];
  };
  nutrition_plan: {
    target_calories: number | null;
    protein_grams: number | null;
    carbs_grams?: number | null;
    fat_grams?: number | null;
    rationale: string;
  };
  training_plan: {
    days_per_week: number;
    session_duration_minutes: number | null;
    weekly_schedule: StructuredWeeklyScheduleDay[];
  };
  progression_rule: string;
  deload_rule: string;
  safety_notes: string[];
  missing_data_questions: string[];
  evidence_used: EvidenceUsed[];
}

export interface PlanValidationIssue {
  code: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface StructuredPlanValidationResult {
  valid: boolean;
  errors: PlanValidationIssue[];
  warnings: PlanValidationIssue[];
}

function issue(code: string, message: string, severity: 'warning' | 'error' = 'error'): PlanValidationIssue {
  return { code, message, severity };
}

function hasInjuryWarning(plan: StructuredCoachPlan): boolean {
  const text = [
    ...plan.safety_notes,
    plan.progression_rule,
    plan.deload_rule,
    ...plan.training_plan.weekly_schedule.flatMap((day) => [
      day.focus,
      day.cardio,
      ...day.exercises.map((ex) => `${ex.name} ${ex.note || ''}`),
    ]),
  ].filter(Boolean).join(' ').toLowerCase();
  return /injury|pain|modify|avoid|replace|stop|medical|clinician|chan thuong|dau/.test(text);
}

function totalSetsForDay(day: StructuredWeeklyScheduleDay): number {
  return day.exercises.reduce((sum, item) => sum + item.sets, 0);
}

export function validateStructuredPlan(plan: StructuredCoachPlan, coachContext: CoachContext): StructuredPlanValidationResult {
  const errors: PlanValidationIssue[] = [];
  const warnings: PlanValidationIssue[] = [];

  if (plan.nutrition_plan.target_calories != null && plan.nutrition_plan.target_calories < 0) {
    errors.push(issue('negative_calories', 'Target calories cannot be negative.'));
  }

  const weight = coachContext.profile.weight_kg;
  if (weight && plan.nutrition_plan.protein_grams != null) {
    const gramsPerKg = plan.nutrition_plan.protein_grams / weight;
    if (gramsPerKg < 1.2 || gramsPerKg > 2.8) {
      warnings.push(issue('protein_outside_expected_range', 'Protein target is outside the expected fitness coaching range.', 'warning'));
    }
  }

  const availableDays = coachContext.constraints.available_days?.length ?? null;
  if (availableDays != null && plan.training_plan.days_per_week > availableDays) {
    errors.push(issue('available_days_exceeded', 'Training days exceed available days in CoachContext.'));
  }

  if (coachContext.profile.experience_level === 'beginner') {
    const maxDailySets = Math.max(0, ...plan.training_plan.weekly_schedule.map(totalSetsForDay));
    if (maxDailySets > 24) {
      errors.push(issue('beginner_volume_too_high', 'Beginner daily volume is too high.'));
    } else if (maxDailySets > 18) {
      warnings.push(issue('beginner_volume_high', 'Beginner daily volume is high and should be monitored.', 'warning'));
    }
  }

  if (coachContext.constraints.injuries.length > 0 && !hasInjuryWarning(plan)) {
    errors.push(issue('injury_warning_missing', 'Plan must include safety notes or modifications when injuries are present.'));
  }

  const importantMissing = coachContext.missing_fields.filter((field) =>
    ['profile.age', 'profile.height_cm', 'profile.weight_kg', 'profile.goal', 'constraints.available_days'].includes(field),
  );
  if (importantMissing.length > 0 && plan.missing_data_questions.length === 0) {
    errors.push(issue('missing_follow_up_questions', 'Plan must ask follow-up questions when important context is missing.'));
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function legacyPlanContentToStructuredPlan(
  content: PlanContent,
  coachContext: CoachContext,
  evidenceUsed: EvidenceUsed[] = [],
): StructuredCoachPlan {
  const tdee = estimateTdeeRange({
    weightKg: coachContext.profile.weight_kg,
    heightCm: coachContext.profile.height_cm,
    age: coachContext.profile.age,
    sex: coachContext.profile.sex,
    activityLevel: coachContext.profile.activity_level,
    bodyFatPercent: coachContext.inbody_latest.body_fat_percent,
  });
  const calories = recommendCalorieTarget(tdee, coachContext.goal.primary_goal);
  const protein = recommendProteinTarget(coachContext.profile.weight_kg, coachContext.goal.primary_goal, coachContext.profile.experience_level);

  return {
    assessment: {
      goal_summary: content.goal,
      readiness: coachContext.safety_flags.length > 0 ? 'medium' : 'high',
      key_limitations: coachContext.safety_flags,
    },
    nutrition_plan: {
      target_calories: calories.target_kcal,
      protein_grams: protein.grams_per_day,
      rationale: calories.rationale,
    },
    training_plan: {
      days_per_week: content.daysPerWeek,
      session_duration_minutes: coachContext.constraints.session_duration_minutes,
      weekly_schedule: content.weeklySchedule.map((day) => ({
        day: day.day,
        focus: day.goal,
        cardio: day.cardio,
        exercises: day.exercises.map((exercise) => ({
          exercise_id: exercise.exerciseId,
          name: exercise.name,
          sets: exercise.sets,
          reps: exercise.reps,
          rest_seconds: exercise.restSeconds,
          note: exercise.note,
        })),
      })),
    },
    progression_rule: content.progressionNotes.join(' '),
    deload_rule: content.recoveryNotes.join(' '),
    safety_notes: content.recoveryNotes,
    missing_data_questions: coachContext.missing_fields.length > 0
      ? coachContext.missing_fields.slice(0, 3).map((field) => `Please provide ${field}.`)
      : [],
    evidence_used: evidenceUsed,
  };
}

export function validateLegacyPlanContent(
  content: PlanContent,
  coachContext: CoachContext,
  evidenceUsed: EvidenceUsed[] = [],
): StructuredPlanValidationResult {
  return validateStructuredPlan(legacyPlanContentToStructuredPlan(content, coachContext, evidenceUsed), coachContext);
}

export function buildDeterministicFallbackPlan(
  coachContext: CoachContext,
  evidenceUsed: EvidenceUsed[] = [],
): StructuredCoachPlan {
  const daysPerWeek = Math.max(1, Math.min(
    coachContext.goal.requested_days_per_week ?? coachContext.constraints.available_days?.length ?? 3,
    coachContext.constraints.available_days?.length ?? 4,
  ));
  const tdee = estimateTdeeRange({
    weightKg: coachContext.profile.weight_kg,
    heightCm: coachContext.profile.height_cm,
    age: coachContext.profile.age,
    sex: coachContext.profile.sex,
    activityLevel: coachContext.profile.activity_level,
    bodyFatPercent: coachContext.inbody_latest.body_fat_percent,
  });
  const calories = recommendCalorieTarget(tdee, coachContext.goal.primary_goal);
  const protein = recommendProteinTarget(coachContext.profile.weight_kg, coachContext.goal.primary_goal, coachContext.profile.experience_level);

  return {
    assessment: {
      goal_summary: coachContext.goal.primary_goal || 'general_fitness',
      readiness: coachContext.safety_flags.length > 0 ? 'medium' : 'high',
      key_limitations: coachContext.safety_flags,
    },
    nutrition_plan: {
      target_calories: calories.target_kcal,
      protein_grams: protein.grams_per_day,
      rationale: calories.rationale,
    },
    training_plan: {
      days_per_week: daysPerWeek,
      session_duration_minutes: coachContext.goal.requested_session_duration_minutes,
      weekly_schedule: Array.from({ length: daysPerWeek }, (_, index) => ({
        day: `Day ${index + 1}`,
        focus: index % 2 === 0 ? 'Full body strength' : 'Hypertrophy and conditioning',
        exercises: [
          { name: 'Goblet Squat or Leg Press', sets: 3, reps: '8-12', rest_seconds: 90, note: 'Use a controlled range of motion.' },
          { name: 'Chest Press or Push-up', sets: 3, reps: '8-12', rest_seconds: 90, note: 'Stop if shoulder pain appears.' },
          { name: 'Seated Row or Lat Pulldown', sets: 3, reps: '10-12', rest_seconds: 75, note: 'Keep reps smooth.' },
          { name: 'Plank', sets: 3, reps: '30-45 seconds', rest_seconds: 60, note: 'Keep neutral spine.' },
        ],
        cardio: 'Optional easy warm-up 5-10 minutes.',
      })),
    },
    progression_rule: 'Add reps first, then load, when all sets are completed with stable technique.',
    deload_rule: 'Reduce sets by 30-40 percent for one week if fatigue, soreness, or performance decline persists.',
    safety_notes: coachContext.constraints.injuries.length > 0
      ? ['Modify or replace painful exercises and seek qualified medical guidance for persistent pain.']
      : ['Use conservative loads and stop sets when form breaks down.'],
    missing_data_questions: coachContext.missing_fields.slice(0, 3).map((field) => `Please provide ${field}.`),
    evidence_used: evidenceUsed,
  };
}

export function buildLegacyDeterministicPlanContent(
  coachContext: CoachContext,
  options: {
    goal: string;
    durationWeeks: number;
    daysPerWeek: number;
    exercisesPerDay: number;
    allowedExercises: AllowedExerciseItem[];
  },
): PlanContent {
  const dayCount = Math.max(1, Math.min(options.daysPerWeek, coachContext.constraints.available_days?.length ?? options.daysPerWeek));
  const fallbackExercises = options.allowedExercises.slice(0, Math.max(1, options.exercisesPerDay));
  return {
    goal: options.goal,
    durationWeeks: options.durationWeeks,
    daysPerWeek: dayCount,
    exercisesPerDay: options.exercisesPerDay,
    weeklySchedule: Array.from({ length: dayCount }, (_, dayIndex) => ({
      day: `Day ${dayIndex + 1}`,
      goal: dayIndex % 2 === 0 ? 'Full body strength' : 'Hypertrophy technique',
      exercises: fallbackExercises.map((exercise, index) => ({
        exerciseId: exercise.id,
        order: index + 1,
        name: exercise.exerciseName,
        sets: coachContext.profile.experience_level === 'beginner' ? 2 : 3,
        reps: '8-12',
        restSeconds: 75,
        note: 'Conservative fallback prescription generated by backend validator.',
      })),
      cardio: 'Optional easy warm-up 5-10 minutes.',
    })),
    progressionNotes: ['Add reps first, then load, when all sets are completed with stable technique.'],
    recoveryNotes: coachContext.constraints.injuries.length > 0
      ? ['Modify or replace painful exercises and seek qualified medical guidance for persistent pain.']
      : ['Sleep 7-9 hours and keep at least one recovery day weekly.'],
    nutritionSummary: 'Use calculated calorie and protein targets from CoachContext when available.',
  };
}
