export type SmartPrefillLoggingMode =
  | "REPS_LOAD"
  | "BODYWEIGHT_REPS"
  | "TIME"
  | "TIME_LOAD"
  | "DISTANCE_TIME";

export type SmartPrefillStatus =
  | "KEEP"
  | "INCREASE_LOAD"
  | "INCREASE_REPS"
  | "INCREASE_SETS"
  | "DELOAD"
  | "REVIEW"
  | "INSUFFICIENT_DATA";

export interface SmartPrefillDraft {
  weightKg: string;
  bodyWeightAtSetKg: string;
  durationSeconds: string;
  distanceMeters: string;
  /** Editable only for BODYWEIGHT_REPS today — see the loggingMode switch
   * below. REPS_LOAD/TIME_LOAD sets reps from the fixed program
   * prescription elsewhere, matching the active-workout UI's existing
   * convention (no per-set reps control for those modes yet). */
  reps: string;
  noWeight: boolean;
  rpe: number;
  rir: number;
}

export interface SmartPrefillPreviousSet {
  weightKg?: number | null;
  bodyWeightAtSetKg?: number | null;
  reps?: number | null;
  rpe?: number | null;
  rir?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  /** Roadmap P1.1 "true set-by-set table UI" — lets the caller ask for the
   * SAME set number's own previous actual (e.g. set 3's prefill should
   * reference set 3's own history, not set 1's) instead of always the
   * first logged set. Optional and unused by every pre-existing caller. */
  setNumber?: number | null;
}

export interface SmartPrefillProgression {
  status: SmartPrefillStatus;
  dataQuality: "SUFFICIENT" | "LOW_SAMPLE" | "NONE";
  nextTarget: {
    weightKg?: number | null;
    reps?: number | null;
    durationSeconds?: number | null;
  } | null;
}

export interface SmartPrefillExerciseDefaults {
  weight?: number | null;
  bodyWeightAtSetKg?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  rpe?: number | null;
  rir?: number | null;
}

export type SmartPrefillSource = "progression" | "previous" | "prescription";

export interface SmartPrefillResult {
  source: SmartPrefillSource;
  draft: SmartPrefillDraft;
}

function numberString(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? String(value) : "";
}

function firstPreviousSet(sets: SmartPrefillPreviousSet[] | undefined): SmartPrefillPreviousSet | null {
  return sets && sets.length > 0 ? sets[0] : null;
}

/** Roadmap P1.1 "true set-by-set table UI" — prefer the historical set with
 * the SAME set number as the one about to be logged (set 3's prefill should
 * reference set 3's own previous actual, not set 1's); falls back to the
 * first logged set when no matching set number exists (e.g. this session
 * has more sets than last time), exactly matching the pre-existing
 * single-set behavior every other caller still relies on. */
function selectPreviousSet(
  sets: SmartPrefillPreviousSet[] | undefined,
  targetSetNumber: number | undefined,
): SmartPrefillPreviousSet | null {
  if (targetSetNumber != null && sets && sets.length > 0) {
    const matched = sets.find((set) => set.setNumber === targetSetNumber);
    if (matched) return matched;
  }
  return firstPreviousSet(sets);
}

function hasActionableProgression(progression: SmartPrefillProgression | null | undefined): boolean {
  if (!progression?.nextTarget) return false;
  if (progression.dataQuality !== "SUFFICIENT") return false;
  if (progression.status === "INSUFFICIENT_DATA" || progression.status === "REVIEW") return false;
  return true;
}

function defaultNoWeight(loggingMode: SmartPrefillLoggingMode, weightKg: string): boolean {
  if (loggingMode === "REPS_LOAD" || loggingMode === "TIME_LOAD") return false;
  if (loggingMode === "BODYWEIGHT_REPS") return !(Number(weightKg) > 0);
  return true;
}

export function selectSmartSetPrefill(input: {
  loggingMode: SmartPrefillLoggingMode;
  progression?: SmartPrefillProgression | null;
  previousSets?: SmartPrefillPreviousSet[];
  exerciseDefaults?: SmartPrefillExerciseDefaults | null;
  userCurrentWeightKg?: number | null;
  /** Which set number this prefill is for — see selectPreviousSet's doc.
   * Omit to keep the pre-existing "always the first previous set" behavior. */
  targetSetNumber?: number;
}): SmartPrefillResult {
  const previous = selectPreviousSet(input.previousSets, input.targetSetNumber);
  const defaults = input.exerciseDefaults ?? {};
  const target = hasActionableProgression(input.progression)
    ? input.progression?.nextTarget
    : null;

  const source: SmartPrefillSource = target
    ? "progression"
    : previous
      ? "previous"
      : "prescription";

  const weight =
    target?.weightKg ??
    previous?.weightKg ??
    defaults.weight ??
    null;
  const reps =
    target?.reps ??
    previous?.reps ??
    defaults.reps ??
    null;
  const durationSeconds =
    target?.durationSeconds ??
    previous?.durationSeconds ??
    defaults.durationSeconds ??
    null;
  const distanceMeters =
    previous?.distanceMeters ??
    defaults.distanceMeters ??
    null;
  const bodyWeightAtSetKg =
    defaults.bodyWeightAtSetKg ??
    previous?.bodyWeightAtSetKg ??
    input.userCurrentWeightKg ??
    null;

  const weightKg = numberString(weight);
  const draft: SmartPrefillDraft = {
    weightKg: "",
    bodyWeightAtSetKg: "",
    durationSeconds: "",
    distanceMeters: "",
    reps: "",
    noWeight: defaultNoWeight(input.loggingMode, weightKg),
    rpe: previous?.rpe ?? defaults.rpe ?? 7,
    rir: previous?.rir ?? defaults.rir ?? 2,
  };

  switch (input.loggingMode) {
    case "REPS_LOAD":
      draft.weightKg = weightKg;
      break;
    case "BODYWEIGHT_REPS":
      draft.weightKg = weightKg;
      draft.bodyWeightAtSetKg = numberString(bodyWeightAtSetKg);
      draft.reps = numberString(reps);
      break;
    case "TIME":
      draft.durationSeconds = numberString(durationSeconds);
      break;
    case "TIME_LOAD":
      draft.weightKg = weightKg;
      draft.durationSeconds = numberString(durationSeconds);
      break;
    case "DISTANCE_TIME":
      draft.durationSeconds = numberString(durationSeconds);
      draft.distanceMeters = numberString(distanceMeters);
      break;
  }

  return { source, draft };
}
