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
  /** The catalog's demo frame for this movement (`exercises.video_url`), null when it has none. */
  mediaUrl: string | null;
  sets: SetRow[];
};

export const DEFAULT_REST_SECONDS = 90;

export type SessionClock = {
  elapsedSeconds: number;
  /** Whether the clock should tick. A finished session's clock is frozen at its real duration. */
  running: boolean;
  completed: boolean;
};

/**
 * Where the session clock starts when the logging screen opens.
 *
 * - The clock measures the SESSION, not how long the screen has been open: an in-progress session
 *   counts from `schedule.startedAt` (falling back to the workout row's `createdAt`), so reopening
 *   it mid-way keeps counting from the real start.
 * - A COMPLETED session shows its real duration, frozen. Opened again from the "+" button it used to
 *   show "Đang tập" with a clock still counting from the morning's start (721:33 on the emulator).
 * - Never negative: a start stamp slightly ahead of the device clock reads 00:00, not a minus.
 */
export function sessionClockState(schedule: any, rawWorkout: any, nowMs: number): SessionClock {
  const workout = rawWorkout?.workout ?? rawWorkout?.data ?? rawWorkout;
  const startedAt = Date.parse(schedule?.startedAt ?? workout?.createdAt ?? "");
  const completed = schedule?.status === "COMPLETED";

  if (completed) {
    const completedAt = Date.parse(schedule?.completedAt ?? "");
    const fromStamps =
      Number.isFinite(startedAt) && Number.isFinite(completedAt)
        ? Math.floor((completedAt - startedAt) / 1000)
        : Number(schedule?.durationSeconds ?? 0);
    return { elapsedSeconds: Math.max(0, fromStamps || 0), running: false, completed: true };
  }

  const elapsedSeconds = Number.isFinite(startedAt)
    ? Math.max(0, Math.floor((nowMs - startedAt) / 1000))
    : 0;
  return { elapsedSeconds, running: true, completed: false };
}

/**
 * Server rows from a refetch, except where the local row is still waiting to sync: that value never
 * reached the server, so taking the server's copy would silently drop it.
 */
export function keepUnsyncedRows(
  fresh: ExerciseBlock[],
  local: ExerciseBlock[] | null,
): ExerciseBlock[] {
  const pending = new Map<string, SetRow>();
  for (const block of local ?? []) {
    for (const row of block.sets) if (row.unsynced) pending.set(row.id, row);
  }
  if (pending.size === 0) return fresh;
  return fresh.map((block) => ({
    ...block,
    sets: block.sets.map((row) => pending.get(row.id) ?? row),
  }));
}

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
      mediaUrl: ex?.exercise?.videoUrl ?? ex?.videoUrl ?? null,
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
