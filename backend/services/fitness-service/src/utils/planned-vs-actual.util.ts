/**
 * Roadmap P3.5 "Planned vs actual training volume" (§ 25,
 * docs/features/PLANNED_VS_ACTUAL_VOLUME_IMPACT_ANALYSIS.md).
 *
 * §25's own explicit warning: avoid oversimplified "volume = always
 * kg × reps" across all logging modes — weighted resistance can use
 * volume/load metrics where valid, timed/cardio/bodyweight need
 * mode-appropriate metrics instead. Continues the exact mode-gating
 * convention P3.3 Exercise Progress Charts already established: the
 * metric compared is chosen ONCE per exercise by its real
 * `Exercise.loggingMode`, never blended into one meaningless number
 * across modes.
 *
 *   REPS_LOAD       -> volume (Σ weight × reps), kg
 *   BODYWEIGHT_REPS -> reps (Σ reps, no weight involved)
 *   TIME            -> duration (Σ seconds)
 *   TIME_LOAD       -> duration (Σ seconds) — the weight TARGET is a real
 *                      part of the plan (e.g. a 20kg weighted plank) but
 *                      is deliberately NOT folded into a "volume" number
 *                      here (weight × duration is not an established
 *                      training-volume metric the way weight × reps is);
 *                      disclosed scope simplification, not a bug.
 *   DISTANCE_TIME   -> ACTUAL distance only, no planned counterpart —
 *                      `WorkoutProgramExercise` has no `distance` column
 *                      in this schema (only sets/reps/weight/duration),
 *                      a real, disclosed schema gap, not silently
 *                      guessed at.
 *
 * A pure aggregator: the caller (service layer) does the DB reads and
 * hands in already-resolved rows.
 */

export interface PlannedExerciseOccurrence {
  exerciseId: string;
  exerciseName: string;
  loggingMode: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  duration: number | null; // seconds
}

export interface ActualCompletedSet {
  exerciseId: string;
  weight: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface ExercisePlannedVsActual {
  exerciseId: string;
  exerciseName: string;
  loggingMode: string;
  sessionsPlanned: number;
  plannedVolumeKg: number | null;
  actualVolumeKg: number | null;
  plannedReps: number | null;
  actualReps: number | null;
  plannedDurationSeconds: number | null;
  actualDurationSeconds: number | null;
  actualDistanceMeters: number | null;
}

export interface CyclePlannedVsActualTotals {
  totalPlannedVolumeKg: number | null;
  totalActualVolumeKg: number | null;
  volumeAdherencePct: number | null; // actual/planned*100 for REPS_LOAD volume, null if nothing planned
  totalPlannedReps: number | null;
  totalActualReps: number | null;
  totalPlannedDurationSeconds: number | null;
  totalActualDurationSeconds: number | null;
  totalActualDistanceMeters: number | null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Only exercises that appear in `plannedOccurrences` are compared — an
 * ad-hoc exercise the user logged that was never part of the plan (a
 * substitution, an extra) has nothing to compare against and is
 * deliberately left out of this view (§25: "Use current program/cycle
 * plan AND completed sessions" — plan-anchored, not actual-anchored).
 */
export function computePlannedVsActual(
  plannedOccurrences: PlannedExerciseOccurrence[],
  actualSets: ActualCompletedSet[],
): ExercisePlannedVsActual[] {
  const plannedByExercise = new Map<string, PlannedExerciseOccurrence[]>();
  for (const p of plannedOccurrences) {
    const list = plannedByExercise.get(p.exerciseId) ?? [];
    list.push(p);
    plannedByExercise.set(p.exerciseId, list);
  }

  const actualByExercise = new Map<string, ActualCompletedSet[]>();
  for (const s of actualSets) {
    const list = actualByExercise.get(s.exerciseId) ?? [];
    list.push(s);
    actualByExercise.set(s.exerciseId, list);
  }

  const results: ExercisePlannedVsActual[] = [];
  for (const [exerciseId, occurrences] of plannedByExercise) {
    const loggingMode = occurrences[0].loggingMode;
    const exerciseName = occurrences[0].exerciseName;
    const actual = actualByExercise.get(exerciseId) ?? [];

    let plannedVolumeKg: number | null = null;
    let actualVolumeKg: number | null = null;
    let plannedReps: number | null = null;
    let actualReps: number | null = null;
    let plannedDurationSeconds: number | null = null;
    let actualDurationSeconds: number | null = null;
    let actualDistanceMeters: number | null = null;

    if (loggingMode === "REPS_LOAD") {
      plannedVolumeKg = round1(
        occurrences.reduce((sum, o) => {
          if (o.sets == null || o.reps == null || o.weight == null) return sum;
          return sum + o.sets * o.reps * o.weight;
        }, 0),
      );
      actualVolumeKg = round1(
        actual.reduce((sum, s) => (s.weight != null && s.reps != null ? sum + s.weight * s.reps : sum), 0),
      );
    } else if (loggingMode === "BODYWEIGHT_REPS") {
      plannedReps = occurrences.reduce((sum, o) => {
        if (o.sets == null || o.reps == null) return sum;
        return sum + o.sets * o.reps;
      }, 0);
      actualReps = actual.reduce((sum, s) => (s.reps != null ? sum + s.reps : sum), 0);
    } else if (loggingMode === "TIME" || loggingMode === "TIME_LOAD") {
      plannedDurationSeconds = occurrences.reduce((sum, o) => {
        if (o.sets == null || o.duration == null) return sum;
        return sum + o.sets * o.duration;
      }, 0);
      actualDurationSeconds = actual.reduce(
        (sum, s) => (s.durationSeconds != null ? sum + s.durationSeconds : sum),
        0,
      );
    } else if (loggingMode === "DISTANCE_TIME") {
      actualDistanceMeters = round1(
        actual.reduce((sum, s) => (s.distanceMeters != null ? sum + s.distanceMeters : sum), 0),
      );
    }

    results.push({
      exerciseId,
      exerciseName,
      loggingMode,
      sessionsPlanned: occurrences.length,
      plannedVolumeKg,
      actualVolumeKg,
      plannedReps,
      actualReps,
      plannedDurationSeconds,
      actualDurationSeconds,
      actualDistanceMeters,
    });
  }

  return results;
}

export function aggregateCyclePlannedVsActual(
  perExercise: ExercisePlannedVsActual[],
): CyclePlannedVsActualTotals {
  let totalPlannedVolumeKg = 0;
  let totalActualVolumeKg = 0;
  let hasVolumeData = false;
  let totalPlannedReps = 0;
  let totalActualReps = 0;
  let hasRepsData = false;
  let totalPlannedDurationSeconds = 0;
  let totalActualDurationSeconds = 0;
  let hasDurationData = false;
  let totalActualDistanceMeters = 0;
  let hasDistanceData = false;

  for (const ex of perExercise) {
    if (ex.plannedVolumeKg != null || ex.actualVolumeKg != null) {
      hasVolumeData = true;
      totalPlannedVolumeKg += ex.plannedVolumeKg ?? 0;
      totalActualVolumeKg += ex.actualVolumeKg ?? 0;
    }
    if (ex.plannedReps != null || ex.actualReps != null) {
      hasRepsData = true;
      totalPlannedReps += ex.plannedReps ?? 0;
      totalActualReps += ex.actualReps ?? 0;
    }
    if (ex.plannedDurationSeconds != null || ex.actualDurationSeconds != null) {
      hasDurationData = true;
      totalPlannedDurationSeconds += ex.plannedDurationSeconds ?? 0;
      totalActualDurationSeconds += ex.actualDurationSeconds ?? 0;
    }
    if (ex.actualDistanceMeters != null) {
      hasDistanceData = true;
      totalActualDistanceMeters += ex.actualDistanceMeters;
    }
  }

  return {
    totalPlannedVolumeKg: hasVolumeData ? round1(totalPlannedVolumeKg) : null,
    totalActualVolumeKg: hasVolumeData ? round1(totalActualVolumeKg) : null,
    volumeAdherencePct:
      hasVolumeData && totalPlannedVolumeKg > 0
        ? Math.round((totalActualVolumeKg / totalPlannedVolumeKg) * 100)
        : null,
    totalPlannedReps: hasRepsData ? totalPlannedReps : null,
    totalActualReps: hasRepsData ? totalActualReps : null,
    totalPlannedDurationSeconds: hasDurationData ? totalPlannedDurationSeconds : null,
    totalActualDurationSeconds: hasDurationData ? totalActualDurationSeconds : null,
    totalActualDistanceMeters: hasDistanceData ? round1(totalActualDistanceMeters) : null,
  };
}
