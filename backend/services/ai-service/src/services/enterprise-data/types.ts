/**
 * Enterprise Data Layer — canonical typed shapes.
 *
 * "Enterprise Data Agent" is a logical architecture role (docs/ai-product/
 * phase3-current-ai-map.md), not an LLM agent. Every reader in this module
 * returns ONLY facts already persisted by an owning business service
 * (user-service/fitness-service) — never an LLM call, never a chat-text
 * inference, never an invented default. Conversation-derived candidate
 * values belong to belief-state.ts, not here.
 *
 * AuthoritativeRead<T> never collapses "fetched fine, nothing there" and
 * "upstream failed" into the same result — a caller that treats "error" as
 * "no nutrition goal" would be the exact bug this layer exists to prevent.
 */

export type DataSource = "USER_SERVICE" | "FITNESS_SERVICE";

export type AuthoritativeRead<T> =
  | { status: "ok"; value: T; source: DataSource; fetchedAt: number }
  | { status: "absent"; source: DataSource; fetchedAt: number }
  | { status: "error"; source: DataSource; fetchedAt: number; message: string };

export function ok<T>(value: T, source: DataSource, fetchedAt = Date.now()): AuthoritativeRead<T> {
  return { status: "ok", value, source, fetchedAt };
}
export function absent<T>(source: DataSource, fetchedAt = Date.now()): AuthoritativeRead<T> {
  return { status: "absent", source, fetchedAt };
}
export function errorRead<T>(source: DataSource, message: string, fetchedAt = Date.now()): AuthoritativeRead<T> {
  return { status: "error", source, message, fetchedAt };
}

/** Same shape as UserProfile.nutritionGoal (llm/types.ts) — the ONE authoritative calorie/macro target. */
export interface NutritionGoalFacts {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Mirrors profile_extractor.ts's own compacted currentWorkoutProgram shape — not a new shape. */
export interface WorkoutProgramSummary {
  name?: string;
  goal?: string;
  daysPerWeek?: number;
  durationWeeks?: number;
  sourceType?: string;
  status?: string;
  dayCount?: number;
  daySummaries?: Array<{ dayNumber?: number; title?: string; exerciseCount: number }>;
}

/** Mirrors profile_extractor.ts's own compacted currentNutritionProgram shape — not a new shape. */
export interface NutritionProgramSummary {
  name?: string;
  goal?: string;
  dailyCaloriesTarget?: number;
  proteinTargetGrams?: number;
  carbTargetGrams?: number;
  fatTargetGrams?: number;
  mealsPerDay?: number;
  startDate?: string;
  endDate?: string;
  repeatEnabled?: boolean;
  status?: string;
}
