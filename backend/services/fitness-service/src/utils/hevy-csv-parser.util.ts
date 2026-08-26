/**
 * Roadmap P2.1 "Hevy import"
 * (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md).
 *
 * Pure, dependency-free CSV parsing + grouping into canonical
 * ImportedWorkout records (roadmap §14's own naming). No Prisma, no
 * Express — directly unit-testable.
 *
 * Targets Hevy's publicly documented "Export Data" CSV column set:
 *   title, start_time, end_time, exercise_title, set_index, set_type,
 *   weight_kg, reps, distance_km, duration_seconds, rpe
 * This was NOT verified against a live Hevy export (no account available
 * to this session) — see the impact analysis's "Audit findings" for the
 * full disclosure. Header-driven (never positional) and defensive: a
 * missing/renamed column just reads as absent for that field, and a row
 * that can't be minimally parsed (no title, no start_time, or an
 * unparseable date) is reported in `rowErrors`, never silently dropped
 * or guessed into a wrong workout.
 */
import * as crypto from "crypto";

export interface ImportedSet {
  setNumber: number;
  weight: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: number | null;
  setType: string | null; // "WARMUP" | "WORKING" | "FAILURE" | null (unmapped Hevy set_type)
}

export interface ImportedExercise {
  exerciseTitle: string;
  order: number;
  sets: ImportedSet[];
}

export interface ImportedWorkout {
  title: string;
  date: string; // YYYY-MM-DD, the calendar day this workout happened on
  notes: string | null;
  exercises: ImportedExercise[];
  sourceHash: string; // deterministic identity for idempotent re-import detection
}

export interface RowError {
  rowIndex: number; // 1-based, header row is row 0
  message: string;
}

export interface HevyParseResult {
  workouts: ImportedWorkout[];
  rowErrors: RowError[];
}

/** Minimal RFC4180-style CSV parser: handles quoted fields (including
 * embedded commas and escaped `""` quotes) and both \n and \r\n line
 * endings. Not a general-purpose CSV library — scoped to what a Hevy
 * export actually needs. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"' && normalized[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  const [headers, ...dataRows] = nonEmpty;
  return { headers: (headers ?? []).map((h) => h.trim()), rows: dataRows };
}

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

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Best-effort date parse, returning just the YYYY-MM-DD calendar-day
 * label (matching this codebase's own convention — see schedule-lock.
 * util.ts's module doc comment — of treating a workout's date as a bare
 * calendar-day label, not a re-interpreted timezone instant). Returns
 * null if genuinely unparseable, so the caller can report a real row
 * error instead of guessing a date.
 *
 * Deliberately NEVER delegates to `new Date(someNonIsoString)` — for a
 * date-only (no explicit offset) string, JS's built-in parser treats it
 * as LOCAL midnight (implementation-defined for non-ISO formats), and
 * `.toISOString()` then converts that through the RUNNING PROCESS's own
 * timezone — on a host/container set to a positive UTC offset, that
 * silently shifts the date back a day. A first version of this function
 * did exactly that and was caught by this file's own unit test (a real
 * bug of the exact same class already documented elsewhere in this
 * codebase re: Prisma + naive timestamps — see the roadmap's "Smart
 * set-by-set prefill" status-board entry). Every format below extracts
 * literal digits/month-names via regex and builds the label directly —
 * no ambient-timezone-dependent Date parsing at all.
 */
export function parseHevyDateToLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // "2024-01-08" / "2024-01-08 09:15:00" / "2024-01-08T09:15:00[Z]"
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m}-${d}`;
  }

  // "8 Jan 2024" / "8 Jan 2024, 09:15"
  const dayMonYear = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (dayMonYear) {
    const [, day, monthName, year] = dayMonYear;
    const monthIndex = MONTH_NAMES.indexOf(monthName.slice(0, 3).toLowerCase());
    if (monthIndex >= 0) return `${year}-${pad2(monthIndex + 1)}-${pad2(Number(day))}`;
  }

  // "Jan 8, 2024" / "Jan 8 2024, 09:15"
  const monDayYear = trimmed.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
  if (monDayYear) {
    const [, monthName, day, year] = monDayYear;
    const monthIndex = MONTH_NAMES.indexOf(monthName.slice(0, 3).toLowerCase());
    if (monthIndex >= 0) return `${year}-${pad2(monthIndex + 1)}-${pad2(Number(day))}`;
  }

  // "01/08/2024" (assumed MM/DD/YYYY, matching Hevy's US-default export locale)
  const slashDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashDate) {
    const [, mm, dd, yyyy] = slashDate;
    return `${yyyy}-${pad2(Number(mm))}-${pad2(Number(dd))}`;
  }

  return null;
}

function computeSourceHash(title: string, startTime: string, exercises: ImportedExercise[]): string {
  // Deterministic regardless of object key insertion order — build the
  // hash input explicitly rather than JSON.stringify-ing objects whose
  // key order isn't guaranteed to be stable input-to-input.
  const parts: string[] = [title.trim().toLowerCase(), startTime.trim()];
  for (const ex of exercises) {
    parts.push(ex.exerciseTitle.trim().toLowerCase());
    for (const s of ex.sets) {
      parts.push(`${s.setNumber}|${s.weight}|${s.reps}|${s.durationSeconds}|${s.distanceMeters}`);
    }
  }
  return crypto.createHash("sha256").update(parts.join("::")).digest("hex");
}

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
    { title: string; date: string; startTime: string; exercisesByTitle: Map<string, ImportedExercise>; exerciseOrder: string[] }
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
    const dateLabel = parseHevyDateToLabel(startTime);
    if (!dateLabel) {
      rowErrors.push({ rowIndex: rowIndex + 1, message: `Unparseable start_time "${startTime}" — row skipped` });
      return;
    }

    const key = `${title}::${startTime}`;
    let workout = workoutsByKey.get(key);
    if (!workout) {
      workout = { title, date: dateLabel, startTime, exercisesByTitle: new Map(), exerciseOrder: [] };
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
      notes: null,
      exercises,
      sourceHash: computeSourceHash(w.title, w.startTime, exercises),
    };
  });

  return { workouts, rowErrors };
}
