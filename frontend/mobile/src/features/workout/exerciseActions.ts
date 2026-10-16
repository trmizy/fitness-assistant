import type { ExerciseBlock } from "./normalizeWorkout";

/**
 * 14B.4 (PG-A3) — exercise-level actions in a live session, web `WorkoutLogPage`'s rules:
 * - swap ("Đổi bài"): session-only — the plan slot keeps its exercise for future weeks; the swap is
 *   written when the exercise is completed through `completeScheduleExercise` (new exerciseId + a
 *   note "Đã đổi từ … sang …"), so it is offered only before any set of that exercise is done;
 * - "Xong cả bài": completes the exercise in one call (web's bulk path), with the first row's values;
 * - "Hoàn tác bài": flips a completed exercise back (web's undo).
 */

export const SET_TYPE_OPTIONS = [
  { value: "WARMUP", label: "Warm-up" },
  { value: "WORKING", label: "Working" },
  { value: "TOP", label: "Top set" },
  { value: "BACKOFF", label: "Back-off" },
  { value: "FAILURE", label: "Failure" },
];

export function setTypeLabel(value: string | null | undefined): string {
  return SET_TYPE_OPTIONS.find((o) => o.value === (value || "WORKING"))?.label ?? "Working";
}

export const blockDone = (b: ExerciseBlock) => b.sets.length > 0 && b.sets.every((s) => s.completed);
const anyDone = (b: ExerciseBlock) => b.sets.some((s) => s.completed);

export function canSwap(b: ExerciseBlock, sessionCompleted: boolean): boolean {
  return !sessionCompleted && !!b.programExerciseId && !anyDone(b);
}

export function canCompleteWhole(b: ExerciseBlock, sessionCompleted: boolean): boolean {
  return !sessionCompleted && !!b.programExerciseId && !blockDone(b);
}

export function canUndoWhole(b: ExerciseBlock): boolean {
  return !!b.programExerciseId && blockDone(b);
}

export type Swap = { exerciseId: string; name: string; fromName: string };

/** What `completeScheduleExercise` is sent for a whole exercise (web's bulk-path payload). */
export function wholeCompletionPayload(b: ExerciseBlock, swap: Swap | undefined) {
  const first = b.sets[0];
  const weight = first && first.weight > 0 ? first.weight : undefined;
  const reps = first && first.reps > 0 ? first.reps : undefined;
  return {
    exerciseId: swap?.exerciseId ?? (b.exerciseId || undefined),
    weight,
    reps,
    notes: swap ? `Đã đổi từ "${swap.fromName}" sang "${swap.name}"` : undefined,
  };
}

/** Closing a session inside a training cycle asks for feedback (same rule as the per-set path). */
export function closesCycleSession(p: { trainingCycleId?: string | null; progressPercent?: number; completedExercises?: number; totalExercises?: number } | null | undefined): boolean {
  return !!p?.trainingCycleId && ((p.progressPercent ?? 0) >= 100 || (p.completedExercises ?? 0) >= (p.totalExercises ?? Infinity));
}

/**
 * Exercises on today's plan day that the started session has no row for — added to the program
 * after the session began. The server counts them in the session total (it reads the plan day), so
 * hiding them would leave the day stuck at "partially done"; web lists them too. Completing one goes
 * through `completeScheduleExercise`, which creates the row from the plan.
 */
export function plannedNotLogged(programDay: any, blocks: readonly ExerciseBlock[]): any[] {
  const planned: any[] = Array.isArray(programDay?.exercises) ? programDay.exercises : [];
  const logged = new Set(blocks.map((b) => b.programExerciseId).filter(Boolean).map(String));
  return planned.filter((pe) => pe?.id && !logged.has(String(pe.id)));
}
