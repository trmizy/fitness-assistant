/**
 * Context Assembler — "what authoritative context does THIS turn need?"
 *
 * A thin, demand-driven coordinating facade over the Enterprise Data Layer
 * (services/enterprise-data/). It issues zero business mutations and never
 * consults an LLM. A nutrition question requests nutrition/profile facts
 * only; a workout question requests workout/profile facts only — never the
 * whole user universe (docs/ai-product/phase3-batch1-context-foundation.md).
 *
 * Request-scoped deduplication for the 4 profile-backed needs below comes
 * from profileExtractor.extract()'s own in-flight + 15s cache (llm/
 * profile_extractor.ts) — calling two of PROFILE/FITNESS_GOAL/
 * ACTIVE_NUTRITION_GOAL/CURRENT_WORKOUT_PROGRAM in the same assembleContext
 * call (or across two calls within ~15s) results in at most one upstream
 * HTTP batch, not a new cache invented here. WORKOUT_SCHEDULE/
 * RECENT_WORKOUT_HISTORY have no such cache yet — a known, documented gap,
 * not a silent omission (see the accompanying report's "Remaining
 * fragmentation" section).
 */
import type { AgentIdentity } from "./fitness-agent-tools";
import * as profileReader from "./enterprise-data/profile.reader";
import * as nutritionReader from "./enterprise-data/nutrition.reader";
import * as workoutReader from "./enterprise-data/workout.reader";
import * as trainingReader from "./enterprise-data/training.reader";
import * as nutritionAnalyticsReader from "./enterprise-data/nutrition-analytics.reader";
import * as bodyGoalReader from "./enterprise-data/body-goal.reader";
import type { AuthoritativeRead, BodyGoalStateWindow, NutritionAnalyticsWindow, NutritionGoalFacts, TrainingAnalyticsWindow, WorkoutProgramSummary } from "./enterprise-data/types";
import type { ScheduleRange } from "./enterprise-data/workout.reader";
import type { UserProfile } from "../llm/types";

export type ContextNeed =
  | "PROFILE"
  | "FITNESS_GOAL"
  | "ACTIVE_NUTRITION_GOAL"
  | "CURRENT_WORKOUT_PROGRAM"
  | "WORKOUT_SCHEDULE"
  | "RECENT_WORKOUT_HISTORY"
  /** Phase 4.1 — rolling-window training analytics (fitness-service-owned). Never fetched implicitly. */
  | "TRAINING_COACH_STATE"
  /** Phase 4.3 — normalized nutrition target-vs-actual window (fitness-service-owned). Never fetched implicitly. */
  | "NUTRITION_COACH_STATE"
  /** Phase 4.4 — observed body state + goal gap/trajectory (fitness-service-owned). Never fetched implicitly. */
  | "BODY_GOAL_COACH_STATE";

export interface AssembledContext {
  profile?: AuthoritativeRead<UserProfile>;
  fitnessGoal?: AuthoritativeRead<NonNullable<UserProfile["goal"]>>;
  activeNutritionGoal?: AuthoritativeRead<NutritionGoalFacts>;
  currentWorkoutProgram?: AuthoritativeRead<WorkoutProgramSummary>;
  workoutSchedule?: AuthoritativeRead<Record<string, unknown>[]>;
  recentWorkoutHistory?: AuthoritativeRead<Record<string, unknown>[]>;
  trainingAnalytics?: AuthoritativeRead<TrainingAnalyticsWindow>;
  nutritionAnalytics?: AuthoritativeRead<NutritionAnalyticsWindow>;
  bodyGoalState?: AuthoritativeRead<BodyGoalStateWindow>;
  /** Equipment has no authoritative "list my real equipment" read today (docs/ai-product/
   * phase3-current-ai-map.md §C) — only transitive validation/substitution endpoints. This is a
   * truthful marker, never a fake local source. */
  equipment: { status: "validationOnly" };
}

export interface AssembleContextOptions {
  scheduleRange?: ScheduleRange;
  historyLimit?: number;
  /** Rolling window for TRAINING_COACH_STATE (default 28 server-side). */
  trainingWindowDays?: number;
  /** Rolling window for NUTRITION_COACH_STATE (default 28 server-side). */
  nutritionWindowDays?: number;
  /** Body-trend lookback for BODY_GOAL_COACH_STATE (default 90 server-side; 14-365). */
  bodyLookbackDays?: number;
}

export async function assembleContext(
  identity: AgentIdentity,
  needs: ContextNeed[],
  opts: AssembleContextOptions = {},
): Promise<AssembledContext> {
  const needSet = new Set(needs);
  const result: AssembledContext = { equipment: { status: "validationOnly" } };

  const tasks: Promise<void>[] = [];
  if (needSet.has("PROFILE")) {
    tasks.push(profileReader.getUserProfile(identity).then((r) => { result.profile = r; }));
  }
  if (needSet.has("FITNESS_GOAL")) {
    tasks.push(profileReader.getCurrentFitnessGoal(identity).then((r) => { result.fitnessGoal = r; }));
  }
  if (needSet.has("ACTIVE_NUTRITION_GOAL")) {
    tasks.push(nutritionReader.getActiveNutritionGoal(identity).then((r) => { result.activeNutritionGoal = r; }));
  }
  if (needSet.has("CURRENT_WORKOUT_PROGRAM")) {
    tasks.push(workoutReader.getCurrentWorkoutProgram(identity).then((r) => { result.currentWorkoutProgram = r; }));
  }
  if (needSet.has("WORKOUT_SCHEDULE")) {
    tasks.push(workoutReader.getWorkoutSchedule(identity, opts.scheduleRange).then((r) => { result.workoutSchedule = r; }));
  }
  if (needSet.has("RECENT_WORKOUT_HISTORY")) {
    tasks.push(workoutReader.getRecentWorkoutHistory(identity, opts.historyLimit).then((r) => { result.recentWorkoutHistory = r; }));
  }

  if (needSet.has("TRAINING_COACH_STATE")) {
    tasks.push(trainingReader.getTrainingAnalytics(identity, { days: opts.trainingWindowDays }).then((r) => { result.trainingAnalytics = r; }));
  }

  if (needSet.has("NUTRITION_COACH_STATE")) {
    tasks.push(nutritionAnalyticsReader.getNutritionAnalytics(identity, { days: opts.nutritionWindowDays }).then((r) => { result.nutritionAnalytics = r; }));
  }

  if (needSet.has("BODY_GOAL_COACH_STATE")) {
    tasks.push(bodyGoalReader.getBodyGoalState(identity, { lookbackDays: opts.bodyLookbackDays }).then((r) => { result.bodyGoalState = r; }));
  }

  await Promise.all(tasks);
  return result;
}
