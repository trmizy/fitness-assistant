/**
 * Pure helpers for the chat "tạo lịch tập" flow once it is backed by the real AI generation pipeline
 * (POST /plans/workout/generate's worker: the LLM reads a per-day, equipment-filtered candidate pool of
 * real catalog exercises and returns canonical exerciseIds, validated before it is stored).
 *
 * Before this, chat built the plan from a fixed template (recommendation_engine.ts) and tried to match its
 * free-text names to the catalog afterwards — not personalised by the AI, and lossy (see
 * exercise-name-resolution.ts for the wrong matches that produced).
 */
export const MIN_EXERCISES_PER_DAY = 3;
export const MAX_EXERCISES_PER_DAY = 8; // GeneratePlanRequestSchema.exercisesPerDay max

/** How many exercises fit a session. Same 8-minute-per-exercise estimate the draft trimmer uses. */
export function exercisesPerDayFor(sessionMinutes: number, minutesPerExercise = 8): number {
  const n = Math.floor(sessionMinutes / minutesPerExercise);
  return Math.max(MIN_EXERCISES_PER_DAY, Math.min(MAX_EXERCISES_PER_DAY, n));
}

export interface DraftDay { day: string; goal: string | null; exercises: Array<Record<string, unknown>> }

/**
 * Worker plan content -> chat draft days. Keeps only exercises that carry a real exerciseId (nothing is
 * ever resolved by name here), preserves the worker's order/sets/reps/rest/note, and drops days that end
 * up empty. Returns the number of exercises discarded so the caller can say so.
 */
export function convertAiPlanToDraft(content: unknown): { days: DraftDay[]; discarded: number } {
  const weekly = (content as { weeklySchedule?: unknown } | null)?.weeklySchedule;
  if (!Array.isArray(weekly)) return { days: [], discarded: 0 };
  let discarded = 0;
  const days: DraftDay[] = [];
  weekly.forEach((raw: any, i: number) => {
    const items = Array.isArray(raw?.exercises) ? raw.exercises : [];
    const exercises = items.flatMap((e: any, idx: number) => {
      if (typeof e?.exerciseId !== "string" || !e.exerciseId) { discarded += 1; return []; }
      const name = typeof e.name === "string" ? e.name : typeof e.exerciseName === "string" ? e.exerciseName : "";
      return [{
        exerciseId: e.exerciseId, name, order: typeof e.order === "number" ? e.order : idx + 1,
        sets: e.sets ?? null, reps: e.reps ?? null, restSeconds: e.restSeconds ?? null, note: e.note ?? e.notes ?? undefined,
      }];
    });
    if (!exercises.length) return;
    days.push({
      day: typeof raw?.day === "string" && raw.day ? raw.day : `Day ${i + 1}`,
      goal: typeof raw?.goal === "string" ? raw.goal : typeof raw?.focus === "string" ? raw.focus : null,
      exercises: exercises.map((e: any, k: number) => ({ ...e, order: k + 1 })),
    });
  });
  return { days, discarded };
}
