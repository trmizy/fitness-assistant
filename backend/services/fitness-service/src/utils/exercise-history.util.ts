import type { SessionProgressPoint } from "./exercise-progress.util";

/**
 * Roadmap P3.6 "Exercise history detail page" (§ 26,
 * docs/features/EXERCISE_HISTORY_DETAIL_IMPACT_ANALYSIS.md).
 *
 * §26 asks for "PRs" and "e1RM where eligible" for the exercise. Real
 * audit finding: `workoutService.getPRs`/`workoutRepository.
 * findExercisePRs` — already found unsuitable by P3.3's own audit — is
 * the single all-time max off `WorkoutExercise`'s coarse aggregate
 * `weight` field, no e1RM at all. This derives the current best directly
 * from P3.3's own already-correct per-session `SessionProgressPoint[]`
 * (real `WorkoutSet` data, never the coarse aggregate) — a thin
 * reduction over already-proven data, not a new computation of the
 * underlying math. Mode-gated, same discipline as P3.3/P3.5: exactly one
 * metric per `loggingMode`.
 */

export interface PersonalRecord {
  metric: "e1rm" | "reps" | "duration" | "distance" | "pace";
  value: number;
  /** For the e1rm metric only, the real (weight, reps) pair that produced it. */
  weightKg: number | null;
  reps: number | null;
  date: string;
}

export function derivePersonalRecord(
  sessions: SessionProgressPoint[],
  loggingMode: string,
): PersonalRecord | null {
  if (sessions.length === 0) return null;

  if (loggingMode === "REPS_LOAD") {
    let best: PersonalRecord | null = null;
    for (const s of sessions) {
      if (s.bestEstimated1RmKg == null) continue;
      if (!best || s.bestEstimated1RmKg > best.value) {
        best = { metric: "e1rm", value: s.bestEstimated1RmKg, weightKg: s.bestSetWeightKg, reps: s.bestSetReps, date: s.date };
      }
    }
    return best;
  }

  if (loggingMode === "BODYWEIGHT_REPS") {
    let best: PersonalRecord | null = null;
    for (const s of sessions) {
      if (s.maxReps == null) continue;
      if (!best || s.maxReps > best.value) {
        best = { metric: "reps", value: s.maxReps, weightKg: null, reps: s.maxReps, date: s.date };
      }
    }
    return best;
  }

  if (loggingMode === "TIME" || loggingMode === "TIME_LOAD") {
    let best: PersonalRecord | null = null;
    for (const s of sessions) {
      if (s.maxDurationSeconds == null) continue;
      if (!best || s.maxDurationSeconds > best.value) {
        best = { metric: "duration", value: s.maxDurationSeconds, weightKg: null, reps: null, date: s.date };
      }
    }
    return best;
  }

  if (loggingMode === "DISTANCE_TIME") {
    // Farthest distance is the headline PR; a genuinely faster pace on a
    // shorter run is a real, different achievement — not surfaced here to
    // keep this to one PR per exercise, matching every other mode.
    let best: PersonalRecord | null = null;
    for (const s of sessions) {
      if (s.maxDistanceMeters == null) continue;
      if (!best || s.maxDistanceMeters > best.value) {
        best = { metric: "distance", value: s.maxDistanceMeters, weightKg: null, reps: null, date: s.date };
      }
    }
    return best;
  }

  return null;
}
