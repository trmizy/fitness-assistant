/**
 * Roadmap P3.3 "Exercise progress charts" (§ 23,
 * docs/features/EXERCISE_PROGRESS_CHARTS_IMPACT_ANALYSIS.md).
 *
 * Pure per-session aggregation over one exercise's real completed
 * `WorkoutSet` rows for a single workout — never `WorkoutExercise`'s
 * coarser aggregate weight/reps/sets fields. That distinction is not
 * theoretical here: P3.2's own integration test caught those aggregate
 * fields silently under-reporting real per-set data (see
 * ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md's "Real bug found and fixed"). The
 * same class of bug is avoided here by construction, reading only
 * `WorkoutSet` rows from the start.
 *
 * §23 lists 7 trend types (weight / rep / e1RM / best-set / duration /
 * distance-pace / bodyweight-rep) with an explicit warning: "do not
 * graph 'weight' for exercises where weight is not meaningful." This
 * module deliberately does NOT decide which lines to show for which
 * `Exercise.loggingMode` — every field below is computed independently
 * and left `null` when the session has no set with that dimension
 * populated (the same "explicit unknown, never guessed" convention
 * `WorkoutSet`'s own schema comments already establish). The caller
 * (the frontend chart) decides which lines to render based on
 * `loggingMode` + which fields are non-null — kept in one place (the UI
 * component) rather than duplicated as mode-branching logic here too.
 *
 * "rep trend" vs "bodyweight-rep trend": both read the exact same
 * `maxReps` field here — §23 lists them as two separate line names
 * because they apply to two different `loggingMode`s (REPS_LOAD vs
 * BODYWEIGHT_REPS), not because they're computed differently. Labeling
 * that distinction is a presentation concern, left to the frontend.
 *
 * "best-set trend": the roadmap lists this as its own trend line
 * alongside e1RM trend. Scope decision (see impact analysis): the
 * "best set" of a session is defined as the completed set with the
 * highest estimated 1RM (the standard way to compare sets of differing
 * weight/rep combinations) — so `bestSetWeightKg`/`bestSetReps` here
 * are exactly the (weight, reps) pair that produced `bestEstimated1RmKg`.
 * The e1RM trend is the numeric line; the best-set trend is that same
 * point's underlying (weight, reps) detail, e.g. for a tooltip.
 */

export interface CompletedSetInput {
  weight: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface SessionProgressPoint {
  date: string;
  workoutId: string;
  maxWeightKg: number | null;
  repsAtMaxWeight: number | null;
  maxReps: number | null;
  bestEstimated1RmKg: number | null;
  bestSetWeightKg: number | null;
  bestSetReps: number | null;
  maxDurationSeconds: number | null;
  maxDistanceMeters: number | null;
  bestPaceSecPerKm: number | null;
}

/** Epley e1RM, duplicated here would be a second copy of the formula —
 * always import estimate1RM from estimated-1rm.util.ts instead. Kept as
 * a thin local wrapper only so this file's own doc comment can explain
 * the "best set = highest e1RM" definition next to where it's used. */
import { estimate1RM } from "./estimated-1rm.util";

export function computeSessionProgressPoint(
  date: string,
  workoutId: string,
  sets: CompletedSetInput[],
): SessionProgressPoint {
  let maxWeightKg: number | null = null;
  let repsAtMaxWeight: number | null = null;
  let maxReps: number | null = null;
  let bestEstimated1RmKg: number | null = null;
  let bestSetWeightKg: number | null = null;
  let bestSetReps: number | null = null;
  let maxDurationSeconds: number | null = null;
  let maxDistanceMeters: number | null = null;
  let bestPaceSecPerKm: number | null = null;

  for (const s of sets) {
    // Weight trend — heaviest completed set this session, regardless of
    // reps (tracks "how much load," independent of "how many reps").
    if (s.weight != null && s.weight > 0) {
      if (maxWeightKg == null || s.weight > maxWeightKg) {
        maxWeightKg = s.weight;
        repsAtMaxWeight = s.reps ?? null;
      }
    }

    // Rep / bodyweight-rep trend — highest single-set rep count this
    // session, across any modality that logs reps at all.
    if (s.reps != null && s.reps > 0) {
      if (maxReps == null || s.reps > maxReps) {
        maxReps = s.reps;
      }
    }

    // e1RM / best-set trend — only meaningful when a set has BOTH a
    // real added weight and a rep count (estimate1RM's own precondition).
    if (s.weight != null && s.weight > 0 && s.reps != null && s.reps > 0) {
      const e1rm = estimate1RM(s.weight, s.reps);
      if (bestEstimated1RmKg == null || e1rm > bestEstimated1RmKg) {
        bestEstimated1RmKg = e1rm;
        bestSetWeightKg = s.weight;
        bestSetReps = s.reps;
      }
    }

    // Duration trend — longest completed hold/interval this session
    // (TIME / TIME_LOAD exercises).
    if (s.durationSeconds != null && s.durationSeconds > 0) {
      if (maxDurationSeconds == null || s.durationSeconds > maxDurationSeconds) {
        maxDurationSeconds = s.durationSeconds;
      }
    }

    // Distance trend — farthest completed set this session (DISTANCE_TIME).
    if (s.distanceMeters != null && s.distanceMeters > 0) {
      if (maxDistanceMeters == null || s.distanceMeters > maxDistanceMeters) {
        maxDistanceMeters = s.distanceMeters;
      }
    }

    // Pace trend — only computable from a set that logged BOTH duration
    // and distance together (a single "ran 5km in 25min" set, not a mix
    // of two different sets). Fastest (lowest sec/km) set wins.
    if (
      s.durationSeconds != null &&
      s.durationSeconds > 0 &&
      s.distanceMeters != null &&
      s.distanceMeters > 0
    ) {
      const secPerKm = s.durationSeconds / (s.distanceMeters / 1000);
      if (bestPaceSecPerKm == null || secPerKm < bestPaceSecPerKm) {
        bestPaceSecPerKm = secPerKm;
      }
    }
  }

  const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

  return {
    date,
    workoutId,
    maxWeightKg: round1(maxWeightKg),
    repsAtMaxWeight,
    maxReps,
    bestEstimated1RmKg: round1(bestEstimated1RmKg),
    bestSetWeightKg,
    bestSetReps,
    maxDurationSeconds,
    maxDistanceMeters: round1(maxDistanceMeters),
    bestPaceSecPerKm: round1(bestPaceSecPerKm),
  };
}
