import { workoutRepository } from "../repositories/workout.repository";
import { workoutService } from "./workout.service";
import { statsService } from "./stats.service";
import { derivePersonalRecord } from "../utils/exercise-history.util";

/**
 * Roadmap P3.6 "Exercise history detail page" (§ 26,
 * docs/features/EXERCISE_HISTORY_DETAIL_IMPACT_ANALYSIS.md).
 *
 * "A better place for deep history than cluttering active workout" —
 * this is a thin AGGREGATOR over already-proven pieces this session's
 * own audit found, composed here rather than re-derived:
 *
 *   - charts / logging-mode-specific records / e1RM / PRs:
 *     `statsService.getExerciseProgress` (P3.3) — also the one place
 *     that already does the real visibility check (SYSTEM or owned
 *     USER_CUSTOM, 404 otherwise), reused here instead of a second copy.
 *   - recent sessions / previous actual sets / notes:
 *     `workoutRepository.findRecentCompletedSessionsForExercise`
 *     (pre-existing, built for exercise-progression.engine.ts).
 *   - progression decisions: `workoutService.getExerciseProgression`
 *     (pre-existing, deterministic, already its own real endpoint).
 *
 * "Exercise substitutions if available" (§26's own last bullet) is
 * deliberately NOT folded in here — `GET /exercises/:id/substitute`
 * already exists as its own complete, real, equipment-aware endpoint;
 * the frontend calls it as a second, independent request rather than
 * this aggregator wrapping a fourth unrelated service.
 */
export const exerciseHistoryService = {
  async getExerciseHistoryDetail(userId: string, exerciseId: string) {
    // Reused UNCHANGED — also the real visibility check (throws 404 for a
    // nonexistent exercise or another user's private USER_CUSTOM one,
    // never distinguishing the two, matching P3.3's own privacy rule).
    const progress = await statsService.getExerciseProgress(userId, exerciseId, {});

    const personalRecord = derivePersonalRecord(progress.sessions, progress.loggingMode);

    const [recentSessionsRaw, progression] = await Promise.all([
      workoutRepository.findRecentCompletedSessionsForExercise(userId, exerciseId, 10),
      // Progression is reference/explanation, never a hard dependency —
      // same fail-soft convention computeExerciseProgressionInternal
      // itself already applies to ITS OWN external lookups (profile/
      // cycle/assessment). A history page must still render everything
      // else if this one piece has a transient failure.
      workoutService.getExerciseProgression(userId, exerciseId).catch(() => null),
    ]);

    const recentSessions = recentSessionsRaw.map((s) => ({
      workoutId: s.workout.id,
      workoutName: s.workout.name,
      date: s.workout.date,
      notes: s.notes,
      sets: s.workoutSets,
    }));

    return {
      exercise: {
        id: progress.exerciseId,
        name: progress.exerciseName,
        loggingMode: progress.loggingMode,
      },
      personalRecord,
      progression,
      recentSessions,
      chart: { sessions: progress.sessions },
    };
  },
};
