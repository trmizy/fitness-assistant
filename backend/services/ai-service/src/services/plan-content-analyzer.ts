/**
 * Deterministic, rule-based pre-screening of a marketplace plan's content —
 * NO AI involved (same "rule engine computes numbers, AI only interprets"
 * split as cycle-feedback-aggregator.ts and plan-quality-scorer.ts). Runs
 * automatically on every publish/republish, before the AI moderation report
 * and before any admin sees the listing — see marketplace.service.ts.
 */

export interface PlanContentExercise {
  exerciseId: string;
  name: string;
  sets: number;
  reps: string;
}
export interface PlanContentDay {
  day: string;
  exercises: PlanContentExercise[];
  cardio?: string;
}
export interface PlanContentLike {
  daysPerWeek: number;
  weeklySchedule: PlanContentDay[];
  progressionNotes?: string[];
  recoveryNotes?: string[];
}

export interface PlanContentAnalysis {
  computedStats: {
    daysPerWeek: number;
    restDaysPerWeek: number;
    averageSetsPerSession: number;
    maxSetsInASession: number;
    hasProgressionNotes: boolean;
    hasRecoveryNotes: boolean;
    sessionsWithDuplicateExercise: number;
  };
  ruleFlags: string[];
}

/** Constants kept at the top, matching this codebase's established
 * convention (cycle-thresholds.config.ts) of never hard-coding a threshold
 * inline — these are generic training-volume heuristics, not medical
 * limits, and deliberately conservative (flag-for-review, not reject). */
const RULE_THRESHOLDS = {
  maxDaysPerWeekNoRestFlag: 7, // every day scheduled -> no rest day at all
  highFrequencyThreshold: 6, // 6-7 days/week without progression notes is a bigger red flag than 3-4
  excessiveSetsPerSessionFlag: 30, // total sets across all exercises in one day
  excessiveMaxSetsSingleExerciseFlag: 8,
};

export function analyzePlanContent(content: PlanContentLike): PlanContentAnalysis {
  const ruleFlags: string[] = [];
  const schedule = Array.isArray(content.weeklySchedule) ? content.weeklySchedule : [];
  const daysPerWeek = content.daysPerWeek ?? schedule.length;
  const restDaysPerWeek = Math.max(0, 7 - daysPerWeek);

  const setsPerSession = schedule.map((day) =>
    (day.exercises || []).reduce((sum, ex) => sum + (Number(ex.sets) || 0), 0),
  );
  const averageSetsPerSession = setsPerSession.length > 0 ? setsPerSession.reduce((a, b) => a + b, 0) / setsPerSession.length : 0;
  const maxSetsInASession = setsPerSession.length > 0 ? Math.max(...setsPerSession) : 0;

  const sessionsWithDuplicateExercise = schedule.filter((day) => {
    const ids = (day.exercises || []).map((ex) => ex.exerciseId);
    return new Set(ids).size !== ids.length;
  }).length;

  const hasProgressionNotes = Array.isArray(content.progressionNotes) && content.progressionNotes.length > 0;
  const hasRecoveryNotes = Array.isArray(content.recoveryNotes) && content.recoveryNotes.length > 0;

  if (daysPerWeek >= RULE_THRESHOLDS.maxDaysPerWeekNoRestFlag) {
    ruleFlags.push("NO_REST_DAY");
  }
  if (daysPerWeek >= RULE_THRESHOLDS.highFrequencyThreshold && !hasProgressionNotes) {
    ruleFlags.push("HIGH_FREQUENCY_WITHOUT_PROGRESSION_NOTES");
  }
  if (maxSetsInASession >= RULE_THRESHOLDS.excessiveSetsPerSessionFlag) {
    ruleFlags.push("EXCESSIVE_VOLUME_PER_SESSION");
  }
  const maxSingleExerciseSets = Math.max(
    0,
    ...schedule.flatMap((day) => (day.exercises || []).map((ex) => Number(ex.sets) || 0)),
  );
  if (maxSingleExerciseSets >= RULE_THRESHOLDS.excessiveMaxSetsSingleExerciseFlag) {
    ruleFlags.push("EXCESSIVE_SETS_SINGLE_EXERCISE");
  }
  if (!hasRecoveryNotes && daysPerWeek >= RULE_THRESHOLDS.highFrequencyThreshold) {
    ruleFlags.push("MISSING_RECOVERY_NOTES_HIGH_FREQUENCY");
  }
  if (sessionsWithDuplicateExercise > 0) {
    ruleFlags.push("DUPLICATE_EXERCISE_SAME_SESSION");
  }
  if (schedule.length === 0) {
    ruleFlags.push("EMPTY_SCHEDULE");
  }

  return {
    computedStats: {
      daysPerWeek,
      restDaysPerWeek,
      averageSetsPerSession: Math.round(averageSetsPerSession * 10) / 10,
      maxSetsInASession,
      hasProgressionNotes,
      hasRecoveryNotes,
      sessionsWithDuplicateExercise,
    },
    ruleFlags,
  };
}
