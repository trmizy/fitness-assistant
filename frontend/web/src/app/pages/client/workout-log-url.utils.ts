/**
 * Pure logic for WorkoutLogPage's URL-based navigation restoration — kept
 * dependency-free and DOM-free so it's directly unit-testable with
 * node:test (this repo's established convention; see
 * RulerSlider.utils.ts / RulerSlider.utils.test.ts for the same pattern).
 *
 * The URL is the durable source of truth for "where was the user in the
 * workout log" across a hard refresh or opening the same link in a new tab
 * — component state and location.state don't survive either of those.
 */

export type WorkoutLogPlanView = "main" | "dayDetail" | "activeExercise";

export interface WorkoutLogInitialState {
  day: number;
  /** YYYY-MM-DD — the specific calendar occurrence being viewed. `day`
   * alone (the program's day-of-week template number, e.g. 1-6 for a
   * repeating weekly split) is ambiguous across every week that reuses the
   * same template, so it cannot by itself identify which real session
   * (and therefore which lock/completion state) is being restored — see
   * the regression this fixed: reloading while viewing a past, locked
   * session silently fell back to today's date for that same day-of-week,
   * making a read-only past session look editable again after refresh. */
  date: string | null;
  exerciseId: string | null;
  planView: WorkoutLogPlanView;
}

// Validates month 01-12 and day 01-31 (not full calendar validity, e.g.
// Feb 30 still passes) — enough to reject obviously-malformed input before
// it reaches the Date constructor downstream, which would otherwise
// silently roll an out-of-range value over into a nearby valid date.
const DATE_ONLY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Reads the one-time initial navigation position from the URL at mount. */
export function parseInitialWorkoutLogState(params: URLSearchParams): WorkoutLogInitialState {
  const dayRaw = Number(params.get("day"));
  const day = Number.isFinite(dayRaw) && dayRaw > 0 ? dayRaw : 1;

  const dateRaw = params.get("date");
  const date = dateRaw && DATE_ONLY_RE.test(dateRaw) ? dateRaw : null;

  const exerciseId = params.get("exercise");

  const planView: WorkoutLogPlanView = exerciseId
    ? "activeExercise"
    : params.get("day")
      ? "dayDetail"
      : "main";

  return { day, date, exerciseId, planView };
}

/**
 * Converts a URL-supplied exercise id into an array index, once the real
 * exercise list has loaded. Never throws and never returns an out-of-range
 * index — a missing/stale id (exercise no longer in this day) resolves to
 * the first exercise instead, matching "don't crash, fall back to a valid
 * selection" rather than leaving the UI on a dangling reference.
 */
export function resolveExerciseIndexFromId(
  exercises: ReadonlyArray<{ id: string }>,
  pendingId: string | null,
): number {
  if (!pendingId || exercises.length === 0) return 0;
  const idx = exercises.findIndex((ex) => ex.id === pendingId);
  return idx >= 0 ? idx : 0;
}

/**
 * Computes the canonical URL search params for the current navigation
 * state. Only ever includes what's needed to restore position — no state
 * for transient form inputs (weight/RPE/RIR/notes), no per-slider-drag
 * history entries (the caller applies this via `replace`).
 */
export function computeWorkoutLogSearchParams(state: {
  planView: WorkoutLogPlanView;
  selectedDay: number;
  /** YYYY-MM-DD, or null when there's no specific calendar date in play
   * (e.g. browsing the plan template before any day has ever been
   * scheduled) — omitted from the URL in that case rather than writing a
   * misleading date. */
  selectedDateLabel: string | null;
  currentExerciseId: string | null | undefined;
}): URLSearchParams {
  const next = new URLSearchParams();
  if (state.planView === "dayDetail" || state.planView === "activeExercise") {
    next.set("day", String(state.selectedDay));
    if (state.selectedDateLabel) next.set("date", state.selectedDateLabel);
  }
  if (state.planView === "activeExercise" && state.currentExerciseId) {
    next.set("exercise", String(state.currentExerciseId));
  }
  return next;
}
