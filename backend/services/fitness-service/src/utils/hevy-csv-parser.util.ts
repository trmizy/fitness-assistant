/**
 * Roadmap P2.1 "Hevy import"
 * (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md).
 *
 * Pure, dependency-free CSV parsing + grouping into canonical
 * ImportedWorkout records (roadmap §14's own naming, shared with every
 * other provider parser via import-canonical.types.ts). No Prisma, no
 * Express — directly unit-testable.
 *
 * Targets Hevy's publicly documented "Export Data" CSV column set:
 *   title, start_time, end_time, description, exercise_title, set_index,
 *   set_type, weight_kg, reps, distance_km, duration_seconds, rpe
 * This was NOT verified against a live Hevy export (no account available
 * to this session) — see the impact analysis's "Audit findings" for the
 * full disclosure. Header-driven (never positional) and defensive: a
 * missing/renamed column just reads as absent for that field, and a row
 * that can't be minimally parsed (no title, no start_time, or an
 * unparseable date) is reported in `rowErrors`, never silently dropped
 * or guessed into a wrong workout.
 */
import { parseCsv } from "./csv-parser.util";
import { parseFlexibleDateToLabel } from "./import-date-parser.util";
import { computeImportSourceHash } from "./import-source-hash.util";
import type { ImportedExercise, ImportedWorkout, ProviderParseResult, RowError } from "./import-canonical.types";

export type { ImportedSet, ImportedExercise, ImportedWorkout, RowError } from "./import-canonical.types";
export { parseCsv } from "./csv-parser.util";
/** @deprecated kept as an alias for existing callers/tests — use
 * parseFlexibleDateToLabel (import-date-parser.util.ts) directly in new code. */
export const parseHevyDateToLabel = parseFlexibleDateToLabel;

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

const SET_TYPE_MAP: Record<string, string> = {
  warmup: "WARMUP",
  normal: "WORKING",
  working: "WORKING",
  failure: "FAILURE",
  // "dropset" and anything else has no equivalent in this app's
  // WARMUP|WORKING|TOP|BACKOFF|FAILURE list — left unmapped (null) rather
  // than forced into a wrong category.
};

export type HevyParseResult = ProviderParseResult;

/** Parses a full Hevy CSV export into canonical ImportedWorkout records.
 * Rows are grouped into one workout per distinct (title, start_time)
 * pair — a real Hevy export has one CSV row per SET, many rows per
 * workout. */
export function parseHevyCsv(csvText: string): HevyParseResult {
  const { headers, rows } = parseCsv(csvText);
  const col = (name: string) => headers.indexOf(name);
  const idx = {
    title: col("title"),
    start_time: col("start_time"),
    end_time: col("end_time"),
    description: col("description"),
    exercise_title: col("exercise_title"),
    set_index: col("set_index"),
    set_type: col("set_type"),
    weight_kg: col("weight_kg"),
    reps: col("reps"),
    distance_km: col("distance_km"),
    duration_seconds: col("duration_seconds"),
    rpe: col("rpe"),
  };

  const rowErrors: RowError[] = [];
  // key = `${title}::${start_time}` -> in-progress workout being assembled
  const workoutsByKey = new Map<
    string,
    { title: string; date: string; startTime: string; notes: string | null; exercisesByTitle: Map<string, ImportedExercise>; exerciseOrder: string[] }
  >();

  rows.forEach((row, rowIndex) => {
    const get = (i: number) => (i >= 0 ? row[i] : undefined);
    const title = get(idx.title)?.trim();
    const startTime = get(idx.start_time)?.trim();
    const exerciseTitle = get(idx.exercise_title)?.trim();

    if (!title || !startTime) {
      rowErrors.push({ rowIndex: rowIndex + 1, message: "Missing title or start_time — row skipped" });
      return;
    }
    if (!exerciseTitle) {
      rowErrors.push({ rowIndex: rowIndex + 1, message: "Missing exercise_title — row skipped" });
      return;
    }
    const dateLabel = parseFlexibleDateToLabel(startTime);
    if (!dateLabel) {
      rowErrors.push({ rowIndex: rowIndex + 1, message: `Unparseable start_time "${startTime}" — row skipped` });
      return;
    }

    const key = `${title}::${startTime}`;
    let workout = workoutsByKey.get(key);
    if (!workout) {
      const description = get(idx.description)?.trim();
      workout = { title, date: dateLabel, startTime, notes: description || null, exercisesByTitle: new Map(), exerciseOrder: [] };
      workoutsByKey.set(key, workout);
    }

    let exercise = workout.exercisesByTitle.get(exerciseTitle);
    if (!exercise) {
      exercise = { exerciseTitle, order: workout.exerciseOrder.length, sets: [] };
      workout.exercisesByTitle.set(exerciseTitle, exercise);
      workout.exerciseOrder.push(exerciseTitle);
    }

    const setIndexRaw = toNumberOrNull(get(idx.set_index));
    const setType = get(idx.set_type)?.trim().toLowerCase();
    exercise.sets.push({
      setNumber: setIndexRaw !== null ? setIndexRaw + 1 : exercise.sets.length + 1, // Hevy's set_index is 0-based
      weight: toNumberOrNull(get(idx.weight_kg)),
      reps: toNumberOrNull(get(idx.reps)),
      durationSeconds: toNumberOrNull(get(idx.duration_seconds)),
      distanceMeters: (() => {
        const km = toNumberOrNull(get(idx.distance_km));
        return km === null ? null : km * 1000;
      })(),
      rpe: toNumberOrNull(get(idx.rpe)),
      setType: setType ? SET_TYPE_MAP[setType] ?? null : null,
    });
  });

  const workouts: ImportedWorkout[] = [...workoutsByKey.values()].map((w) => {
    const exercises = w.exerciseOrder.map((name) => w.exercisesByTitle.get(name)!);
    return {
      title: w.title,
      date: w.date,
      notes: w.notes,
      exercises,
      sourceHash: computeImportSourceHash(w.title, w.startTime, exercises),
    };
  });

  return { workouts, rowErrors };
}
