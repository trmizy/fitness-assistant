/**
 * Roadmap P2.3 "FitNotes import"
 * (docs/features/FITNOTES_IMPORT_IMPACT_ANALYSIS.md).
 *
 * A thin parser on the SAME canonical pipeline Hevy (P2.1) and Strong
 * (P2.2) import already proved — shares csv-parser.util.ts's tokenizer,
 * import-date-parser.util.ts's timezone-safe date parsing,
 * import-unit-conversion.util.ts's kg/meters conversion (first written
 * for Strong), and import-source-hash.util.ts's idempotency hash.
 *
 * Targets FitNotes' publicly/community-documented CSV column set:
 *   Date, Exercise, Category, Weight, Weight Unit, Reps, Distance,
 *   Distance Unit, Time, Comment
 * This is the LEAST verified of the three provider formats built this
 * session — no live FitNotes export was available to check. Header-
 * driven and defensive, same as Hevy/Strong: a format drift surfaces as
 * row-level errors, never silent corruption.
 *
 * The one genuinely structural difference from Hevy/Strong: FitNotes'
 * export has NO workout-session concept at all — no title, no time-of-
 * day, just a plain calendar Date per row. Every row for the same date
 * is necessarily grouped into ONE ImportedWorkout for that date (there
 * is no session boundary in the source data to recover, even if the
 * user actually trained twice that day) — a real, disclosed limitation,
 * not a bug.
 */
import { parseCsv } from "./csv-parser.util";
import { parseFlexibleDateToLabel } from "./import-date-parser.util";
import { computeImportSourceHash } from "./import-source-hash.util";
import { convertWeightToKg, convertDistanceToMeters } from "./import-unit-conversion.util";
import type { ImportedExercise, ImportedWorkout, ProviderParseResult, RowError } from "./import-canonical.types";

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** FitNotes' `Time` column format isn't confidently known — could be
 * plain seconds, or "HH:MM:SS"/"MM:SS". Tries plain seconds first, then
 * both time-string shapes; returns null (never guesses) if none match. */
function parseTimeToSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const plain = toNumberOrNull(trimmed);
  if (plain !== null) return plain;

  const hms = trimmed.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) {
    const [, h, m, s] = hms;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
  const ms = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (ms) {
    const [, m, s] = ms;
    return Number(m) * 60 + Number(s);
  }
  return null;
}

export type FitNotesParseResult = ProviderParseResult;

/** Parses a full FitNotes CSV export into canonical ImportedWorkout
 * records, one per distinct calendar Date (see module doc comment for
 * why — FitNotes' export has no session-level grouping at all). */
export function parseFitNotesCsv(csvText: string): FitNotesParseResult {
  const { headers, rows } = parseCsv(csvText);
  const col = (name: string) => headers.indexOf(name);
  const idx = {
    date: col("Date"),
    exercise: col("Exercise"),
    weight: col("Weight"),
    weightUnit: col("Weight Unit"),
    reps: col("Reps"),
    distance: col("Distance"),
    distanceUnit: col("Distance Unit"),
    time: col("Time"),
  };

  const rowErrors: RowError[] = [];
  const workoutsByDate = new Map<
    string,
    { date: string; exercisesByTitle: Map<string, ImportedExercise>; exerciseOrder: string[] }
  >();

  rows.forEach((row, rowIndex) => {
    const get = (i: number) => (i >= 0 ? row[i] : undefined);
    const rawDate = get(idx.date)?.trim();
    const exerciseName = get(idx.exercise)?.trim();

    if (!rawDate) {
      rowErrors.push({ rowIndex: rowIndex + 1, message: "Missing Date — row skipped" });
      return;
    }
    if (!exerciseName) {
      rowErrors.push({ rowIndex: rowIndex + 1, message: "Missing Exercise — row skipped" });
      return;
    }
    const dateLabel = parseFlexibleDateToLabel(rawDate);
    if (!dateLabel) {
      rowErrors.push({ rowIndex: rowIndex + 1, message: `Unparseable Date "${rawDate}" — row skipped` });
      return;
    }

    let workout = workoutsByDate.get(dateLabel);
    if (!workout) {
      workout = { date: dateLabel, exercisesByTitle: new Map(), exerciseOrder: [] };
      workoutsByDate.set(dateLabel, workout);
    }

    let exercise = workout.exercisesByTitle.get(exerciseName);
    if (!exercise) {
      exercise = { exerciseTitle: exerciseName, order: workout.exerciseOrder.length, sets: [] };
      workout.exercisesByTitle.set(exerciseName, exercise);
      workout.exerciseOrder.push(exerciseName);
    }

    // No set-order column exists in this format — positional, same
    // fallback Hevy/Strong's own parsers use when their order column is
    // absent/unparseable.
    exercise.sets.push({
      setNumber: exercise.sets.length + 1,
      weight: convertWeightToKg(toNumberOrNull(get(idx.weight)), get(idx.weightUnit)),
      reps: toNumberOrNull(get(idx.reps)),
      durationSeconds: parseTimeToSeconds(get(idx.time)),
      distanceMeters: convertDistanceToMeters(toNumberOrNull(get(idx.distance)), get(idx.distanceUnit)),
      rpe: null, // FitNotes' documented export has no RPE column
      setType: null, // no set-type column either — same "don't guess" rule as Hevy/Strong's own unmapped values
    });
  });

  const workouts: ImportedWorkout[] = [...workoutsByDate.values()].map((w) => {
    const exercises = w.exerciseOrder.map((name) => w.exercisesByTitle.get(name)!);
    return {
      title: "Buổi tập", // FitNotes has no session-name concept — see module doc comment
      date: w.date,
      notes: null, // FitNotes has no workout-level notes concept either
      exercises,
      sourceHash: computeImportSourceHash("FitNotes", w.date, exercises),
    };
  });

  return { workouts, rowErrors };
}
