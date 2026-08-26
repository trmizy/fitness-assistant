/**
 * Roadmap P2.2 "Strong import"
 * (docs/features/STRONG_IMPORT_IMPACT_ANALYSIS.md).
 *
 * A thin parser on top of the SAME canonical pipeline Hevy import
 * (P2.1) already proved — shares csv-parser.util.ts's tokenizer,
 * import-date-parser.util.ts's timezone-safe date parsing, and
 * import-source-hash.util.ts's idempotency hash. Only the column
 * mapping and unit handling are Strong-specific.
 *
 * Targets Strong's publicly documented "Export Your Data" CSV column
 * set:
 *   Date, Workout Name, Duration, Exercise Name, Set Order, Weight,
 *   Weight Unit, Reps, RPE, Distance, Distance Unit, Seconds, Notes,
 *   Workout Notes
 * This was NOT verified against a live Strong export (no account
 * available to this session) — same disclosed limitation as Hevy's
 * parser. Header-driven and defensive: a missing/renamed column reads as
 * absent, an unparseable row is reported in `rowErrors`, never silently
 * dropped or guessed.
 *
 * The one genuinely Strong-specific wrinkle Hevy's format doesn't have:
 * Strong lets the user's account be set to kg OR lb, and exports the
 * unit PER ROW (`Weight Unit`) rather than always kg — every weight is
 * converted to kg here so downstream code never has to care which unit
 * a given row came in as. Same for `Distance Unit` (km/mi/m) -> meters.
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

export type StrongParseResult = ProviderParseResult;

/** Parses a full Strong CSV export into canonical ImportedWorkout
 * records. Rows are grouped by (Workout Name, Date) — a real Strong
 * export has one CSV row per SET, many rows per workout. */
export function parseStrongCsv(csvText: string): StrongParseResult {
  const { headers, rows } = parseCsv(csvText);
  const col = (name: string) => headers.indexOf(name);
  const idx = {
    date: col("Date"),
    workoutName: col("Workout Name"),
    exerciseName: col("Exercise Name"),
    setOrder: col("Set Order"),
    weight: col("Weight"),
    weightUnit: col("Weight Unit"),
    reps: col("Reps"),
    rpe: col("RPE"),
    distance: col("Distance"),
    distanceUnit: col("Distance Unit"),
    seconds: col("Seconds"),
    workoutNotes: col("Workout Notes"),
  };

  const rowErrors: RowError[] = [];
  const workoutsByKey = new Map<
    string,
    { title: string; date: string; rawDate: string; notes: string | null; exercisesByTitle: Map<string, ImportedExercise>; exerciseOrder: string[] }
  >();

  rows.forEach((row, rowIndex) => {
    const get = (i: number) => (i >= 0 ? row[i] : undefined);
    const workoutName = get(idx.workoutName)?.trim();
    const rawDate = get(idx.date)?.trim();
    const exerciseName = get(idx.exerciseName)?.trim();

    if (!workoutName || !rawDate) {
      rowErrors.push({ rowIndex: rowIndex + 1, message: "Missing Workout Name or Date — row skipped" });
      return;
    }
    if (!exerciseName) {
      rowErrors.push({ rowIndex: rowIndex + 1, message: "Missing Exercise Name — row skipped" });
      return;
    }
    const dateLabel = parseFlexibleDateToLabel(rawDate);
    if (!dateLabel) {
      rowErrors.push({ rowIndex: rowIndex + 1, message: `Unparseable Date "${rawDate}" — row skipped` });
      return;
    }

    const key = `${workoutName}::${rawDate}`;
    let workout = workoutsByKey.get(key);
    if (!workout) {
      const workoutNotes = get(idx.workoutNotes)?.trim();
      workout = { title: workoutName, date: dateLabel, rawDate, notes: workoutNotes || null, exercisesByTitle: new Map(), exerciseOrder: [] };
      workoutsByKey.set(key, workout);
    }

    let exercise = workout.exercisesByTitle.get(exerciseName);
    if (!exercise) {
      exercise = { exerciseTitle: exerciseName, order: workout.exerciseOrder.length, sets: [] };
      workout.exercisesByTitle.set(exerciseName, exercise);
      workout.exerciseOrder.push(exerciseName);
    }

    const setOrderRaw = toNumberOrNull(get(idx.setOrder));
    exercise.sets.push({
      setNumber: setOrderRaw !== null ? setOrderRaw : exercise.sets.length + 1, // Strong's Set Order is already 1-based
      weight: convertWeightToKg(toNumberOrNull(get(idx.weight)), get(idx.weightUnit)),
      reps: toNumberOrNull(get(idx.reps)),
      durationSeconds: toNumberOrNull(get(idx.seconds)),
      distanceMeters: convertDistanceToMeters(toNumberOrNull(get(idx.distance)), get(idx.distanceUnit)),
      rpe: toNumberOrNull(get(idx.rpe)),
      // Strong's standard export has no set-type/warmup column — left
      // unmapped (null) rather than guessed, same "don't force a
      // classification the source data doesn't actually carry" rule
      // Hevy's parser follows for its own unmapped set_type values.
      setType: null,
    });
  });

  const workouts: ImportedWorkout[] = [...workoutsByKey.values()].map((w) => {
    const exercises = w.exerciseOrder.map((name) => w.exercisesByTitle.get(name)!);
    return {
      title: w.title,
      date: w.date,
      notes: w.notes,
      exercises,
      sourceHash: computeImportSourceHash(w.title, w.rawDate, exercises),
    };
  });

  return { workouts, rowErrors };
}
