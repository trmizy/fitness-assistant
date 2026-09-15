/**
 * Pure helpers behind CL-17's live logging screen (`app/client/workout/log.tsx`), kept out of the
 * screen so they can be unit-tested without a renderer.
 */

export type SetRow = {
  id: string;
  setNumber: number;
  weight: number;
  reps: number;
  targetReps: number | null;
  targetRpe: number | null;
  completed: boolean;
  /** Set locally but the PATCH never reached the server — shown as "chờ đồng bộ", retryable. */
  unsynced?: boolean;
};

export type ExerciseBlock = {
  key: string;
  exerciseId: string;
  name: string;
  restSeconds: number;
  sets: SetRow[];
};

export const DEFAULT_REST_SECONDS = 90;

/** `125` → `"02:05"`. Minutes are not wrapped into hours: a session clock reads "75:00", not "1:15:00". */
export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * The workout endpoint's shape is loose (`any` all the way down), and the set skeleton
 * `startSchedule` creates can arrive under a couple of different names depending on how the
 * workout was opened. Normalizing in one place keeps that knowledge out of the render tree.
 */
export function normalizeWorkout(raw: any): ExerciseBlock[] | null {
  const workout = raw?.workout ?? raw?.data ?? raw;
  const exercises = workout?.exercises;
  if (!Array.isArray(exercises)) return null;

  return exercises.map((ex: any, index: number): ExerciseBlock => {
    // The logged rows live in `workoutSets`; `sets` on a workout exercise is the planned set COUNT
    // (a number), so reading it as the row list rendered every session as 0/0.
    const sets: any[] = Array.isArray(ex?.workoutSets)
      ? ex.workoutSets
      : Array.isArray(ex?.sets)
        ? ex.sets
        : [];
    return {
      key: String(ex?.id ?? index),
      exerciseId: String(ex?.exerciseId ?? ex?.exercise?.id ?? ex?.id ?? ""),
      name:
        ex?.exercise?.exerciseName ??
        ex?.exerciseNameSnapshot ??
        ex?.exerciseName ??
        ex?.name ??
        "Bài tập",
      restSeconds: Number(ex?.restSeconds ?? ex?.restBetweenSetsSeconds ?? DEFAULT_REST_SECONDS),
      sets: sets.map((s: any, i: number) => ({
        id: String(s?.id ?? `${index}-${i}`),
        setNumber: Number(s?.setNumber ?? i + 1),
        weight: Number(s?.weight ?? s?.targetWeight ?? 0),
        reps: Number(s?.reps ?? s?.targetReps ?? 0),
        targetReps: s?.targetReps != null ? Number(s.targetReps) : null,
        targetRpe: s?.targetRpe != null ? Number(s.targetRpe) : null,
        completed: !!s?.completed,
      })),
    };
  });
}
