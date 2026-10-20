/**
 * Phase 4 (AI plan) — PT Copilot, step 1: a DETERMINISTIC roster-wide adherence/progress read for the clients a PT is authorised for
 * (audit BDG-08: no cross-client aggregate existed). Pure functions only: no I/O, no model, no inference about data that does not exist.
 *
 * Source-of-truth rules (CLAUDE.md "Source of Truth"): workout adherence uses EXACTLY the existing definition of
 * training-cycle-metrics.service.ts::computeAdherence (completed sessions / scheduled sessions in the window; `null` when nothing was
 * scheduled, so "no data" never reads as 0% or 100%). Nutrition is reported as what was actually LOGGED (NutritionMealCompletion);
 * there is deliberately no "planned meals" denominator, because the program repeats/cycles and a made-up denominator would be a second
 * competing source of truth. Anything the data cannot support is listed in `dataGaps` instead of being guessed.
 */

export const ROSTER_THRESHOLDS = {
  /** adherence is only judged with at least this many scheduled sessions in the window */
  minScheduledToJudge: 3,
  /** below this => HIGH signal */
  lowAdherencePercent: 50,
  /** below this (but not low) => MEDIUM signal; at or above => on track */
  onTrackAdherencePercent: 80,
  /** no completed session for this many days (while sessions were scheduled) => MEDIUM signal */
  inactiveDays: 10,
  /** a nutrition program exists but no meal was logged in a window of at least this many days => MEDIUM signal */
  nutritionWindowDaysToJudge: 7,
  /** enough logged meals to judge skipping, and the skipped share that raises a signal */
  minLoggedMealsToJudgeSkipping: 6,
  skippedMealShare: 0.5,
} as const;

export type RosterStatus = "AT_RISK" | "NEEDS_ATTENTION" | "ON_TRACK" | "NO_DATA";
export type SignalSeverity = "HIGH" | "MEDIUM";
export type SignalCode =
  | "NO_COMPLETED_SESSIONS" | "LOW_ADHERENCE" | "MODERATE_ADHERENCE" | "INACTIVE_WORKOUT" | "NUTRITION_NOT_LOGGED" | "NUTRITION_SKIPPING";
export type DataGapCode = "NO_SCHEDULED_SESSIONS" | "NO_ACTIVE_NUTRITION_PROGRAM" | "NO_NUTRITION_LOGS";

export interface RosterClientInput {
  clientUserId: string;
  windowDays: number;
  asOf: Date;
  workout: {
    /** every WorkoutSchedule row in the window, whatever its status (same as computeAdherence) */
    scheduled: number; completed: number; partiallyCompleted: number; skipped: number;
    lastCompletedAt: Date | null;
  };
  nutrition: {
    hasActiveProgram: boolean;
    completedMeals: number; partialMeals: number; skippedMeals: number;
    logDays: number; lastLogDate: Date | null;
  };
}

export interface RosterSignal { code: SignalCode; severity: SignalSeverity; evidence: string }
export interface RosterClientRow {
  clientUserId: string;
  status: RosterStatus;
  workout: {
    scheduled: number; completed: number; partiallyCompleted: number; skipped: number;
    adherencePercent: number | null; lastCompletedAt: string | null; daysSinceLastCompleted: number | null;
  };
  nutrition: { hasActiveProgram: boolean; loggedMeals: number; skippedMeals: number; logDays: number; lastLogDate: string | null };
  signals: RosterSignal[];
  dataGaps: DataGapCode[];
}

const DAY_MS = 86_400_000;

export function evaluateRosterClient(input: RosterClientInput): RosterClientRow {
  const T = ROSTER_THRESHOLDS;
  const { workout: w, nutrition: n, windowDays, asOf } = input;
  const adherencePercent = w.scheduled > 0 ? Math.round((w.completed / w.scheduled) * 100) : null;
  const daysSinceLastCompleted = w.lastCompletedAt ? Math.max(0, Math.floor((asOf.getTime() - w.lastCompletedAt.getTime()) / DAY_MS)) : null;
  const loggedMeals = n.completedMeals + n.partialMeals;
  const signals: RosterSignal[] = [];
  const dataGaps: DataGapCode[] = [];

  if (w.scheduled === 0) dataGaps.push("NO_SCHEDULED_SESSIONS");
  if (!n.hasActiveProgram) dataGaps.push("NO_ACTIVE_NUTRITION_PROGRAM");
  else if (loggedMeals + n.skippedMeals === 0) dataGaps.push("NO_NUTRITION_LOGS");

  if (w.scheduled >= 2 && w.completed === 0) {
    signals.push({ code: "NO_COMPLETED_SESSIONS", severity: "HIGH", evidence: `Chưa hoàn thành buổi nào trong ${w.scheduled} buổi đã lên lịch (${windowDays} ngày gần nhất).` });
  } else if (w.scheduled >= T.minScheduledToJudge && adherencePercent !== null) {
    if (adherencePercent < T.lowAdherencePercent) {
      signals.push({ code: "LOW_ADHERENCE", severity: "HIGH", evidence: `Hoàn thành ${w.completed}/${w.scheduled} buổi (≈${adherencePercent}%) trong ${windowDays} ngày gần nhất.` });
    } else if (adherencePercent < T.onTrackAdherencePercent) {
      signals.push({ code: "MODERATE_ADHERENCE", severity: "MEDIUM", evidence: `Hoàn thành ${w.completed}/${w.scheduled} buổi (≈${adherencePercent}%) trong ${windowDays} ngày gần nhất.` });
    }
  }
  if (w.scheduled >= 1 && daysSinceLastCompleted !== null && daysSinceLastCompleted >= T.inactiveDays && !signals.some((s) => s.code === "NO_COMPLETED_SESSIONS")) {
    signals.push({ code: "INACTIVE_WORKOUT", severity: "MEDIUM", evidence: `Buổi tập hoàn thành gần nhất cách đây ${daysSinceLastCompleted} ngày.` });
  }
  if (n.hasActiveProgram && loggedMeals + n.skippedMeals === 0 && windowDays >= T.nutritionWindowDaysToJudge) {
    signals.push({ code: "NUTRITION_NOT_LOGGED", severity: "MEDIUM", evidence: `Có thực đơn đang áp dụng nhưng không ghi nhận bữa ăn nào trong ${windowDays} ngày gần nhất.` });
  }
  const allLogged = loggedMeals + n.skippedMeals;
  if (allLogged >= T.minLoggedMealsToJudgeSkipping && n.skippedMeals / allLogged >= T.skippedMealShare) {
    signals.push({ code: "NUTRITION_SKIPPING", severity: "MEDIUM", evidence: `Bỏ ${n.skippedMeals}/${allLogged} bữa đã ghi nhận trong ${windowDays} ngày gần nhất.` });
  }

  const judgedWorkout = w.scheduled >= 1;
  const judgedNutrition = n.hasActiveProgram && allLogged > 0;
  const status: RosterStatus = signals.some((s) => s.severity === "HIGH") ? "AT_RISK"
    : signals.length > 0 ? "NEEDS_ATTENTION"
    : judgedWorkout || judgedNutrition ? "ON_TRACK"
    : "NO_DATA";

  return {
    clientUserId: input.clientUserId,
    status,
    workout: {
      scheduled: w.scheduled, completed: w.completed, partiallyCompleted: w.partiallyCompleted, skipped: w.skipped,
      adherencePercent, lastCompletedAt: w.lastCompletedAt ? w.lastCompletedAt.toISOString() : null, daysSinceLastCompleted,
    },
    nutrition: { hasActiveProgram: n.hasActiveProgram, loggedMeals, skippedMeals: n.skippedMeals, logDays: n.logDays, lastLogDate: n.lastLogDate ? n.lastLogDate.toISOString().slice(0, 10) : null },
    signals,
    dataGaps,
  };
}

const ORDER: Record<RosterStatus, number> = { AT_RISK: 0, NEEDS_ATTENTION: 1, NO_DATA: 2, ON_TRACK: 3 };

/** Clients that need a PT's attention first; within a status the lowest adherence first (unknown adherence after known), then id for stability. */
export function sortRosterRows(rows: RosterClientRow[]): RosterClientRow[] {
  return [...rows].sort((a, b) =>
    ORDER[a.status] - ORDER[b.status]
    || (a.workout.adherencePercent ?? 101) - (b.workout.adherencePercent ?? 101)
    || a.clientUserId.localeCompare(b.clientUserId));
}

export function summarizeRoster(rows: RosterClientRow[]) {
  const by: Record<RosterStatus, number> = { AT_RISK: 0, NEEDS_ATTENTION: 0, ON_TRACK: 0, NO_DATA: 0 };
  for (const r of rows) by[r.status]++;
  return { totalClients: rows.length, ...by };
}
