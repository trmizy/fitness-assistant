/**
 * Roadmap P2.5 "Export / data portability"
 * (docs/features/JSON_CSV_EXPORT_IMPACT_ANALYSIS.md).
 *
 * Strictly read-only. JSON export = workout history + body metrics
 * (everything exportable); CSV export = workout history only, one row
 * per set — matching §19's own wording exactly (see the impact
 * analysis's "Audit findings").
 */
import { prisma } from "../repositories/prisma";
import { calendarDateLabel } from "../utils/schedule-lock.util";

export interface ExportedSet {
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  completed: boolean;
  setType: string | null;
}

export interface ExportedExercise {
  exerciseId: string;
  exerciseName: string;
  order: number;
  sets: ExportedSet[];
}

export interface ExportedWorkout {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  notes: string | null;
  exercises: ExportedExercise[];
}

export interface ExportedBodyMetric {
  id: string;
  date: string; // YYYY-MM-DD
  weightKg: number | null;
  bodyFatPercent: number | null;
  muscleMassKg: number | null;
  bodyWaterPercent: number | null;
  notes: string | null;
}

export interface ExportData {
  exportedAt: string;
  workouts: ExportedWorkout[];
  bodyMetrics: ExportedBodyMetric[];
}

// userId is deliberately never included in the exported payload — every
// row in one export already belongs to exactly one user (enforced by
// these queries' own WHERE clauses), so repeating it on every record
// would just be operational plumbing, not data the export's actual
// audience (the user reading their own export, or a future importer)
// needs. exerciseNameSnapshot (Gate 4's internal history-protection
// field) is likewise left out in favor of the live joined exercise name.
export async function buildExportData(userId: string): Promise<ExportData> {
  const [workoutRows, bodyMetricRows] = await Promise.all([
    prisma.workout.findMany({
      where: { userId },
      orderBy: { date: "asc" },
      include: {
        exercises: {
          orderBy: { order: "asc" },
          include: {
            exercise: { select: { exerciseName: true } },
            workoutSets: { orderBy: { setNumber: "asc" } },
          },
        },
      },
    }),
    prisma.bodyMetrics.findMany({ where: { userId }, orderBy: { date: "asc" } }),
  ]);

  const workouts: ExportedWorkout[] = workoutRows.map((w) => ({
    id: w.id,
    name: w.name,
    date: calendarDateLabel(w.date, "UTC"),
    notes: w.notes ?? null,
    exercises: w.exercises.map((ex) => ({
      exerciseId: ex.exerciseId,
      exerciseName: ex.exercise?.exerciseName ?? ex.exerciseNameSnapshot ?? "(unknown exercise)",
      order: ex.order,
      sets: ex.workoutSets.map((s) => ({
        setNumber: s.setNumber,
        weightKg: s.weight ?? null,
        reps: s.reps ?? null,
        rpe: s.rpe ?? null,
        rir: s.rir ?? null,
        durationSeconds: s.durationSeconds ?? null,
        distanceMeters: s.distanceMeters ?? null,
        completed: s.completed,
        setType: s.setType ?? null,
      })),
    })),
  }));

  const bodyMetrics: ExportedBodyMetric[] = bodyMetricRows.map((m) => ({
    id: m.id,
    date: calendarDateLabel(m.date, "UTC"),
    weightKg: m.weight ?? null,
    bodyFatPercent: m.bodyFat ?? null,
    muscleMassKg: m.muscleMass ?? null,
    bodyWaterPercent: m.bodyWater ?? null,
    notes: m.notes ?? null,
  }));

  return { exportedAt: new Date().toISOString(), workouts, bodyMetrics };
}

const CSV_HEADER = [
  "workout_id", "date", "workout_name", "exercise_id", "exercise_name",
  "set_number", "weight_kg", "reps", "rpe", "rir",
  "duration_seconds", "distance_meters", "completed", "set_type",
];

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return csvEscape(String(value));
}

/** Workout-history-only, one row per set — §19's own "CSV workout-
 * history export" wording, taken literally (body metrics have no CSV
 * export; see the impact analysis). */
export function workoutsToCsv(workouts: ExportedWorkout[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const w of workouts) {
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        lines.push(
          [
            cell(w.id), cell(w.date), cell(w.name), cell(ex.exerciseId), cell(ex.exerciseName),
            cell(s.setNumber), cell(s.weightKg), cell(s.reps), cell(s.rpe), cell(s.rir),
            cell(s.durationSeconds), cell(s.distanceMeters), cell(s.completed), cell(s.setType),
          ].join(","),
        );
      }
    }
  }
  return lines.join("\n");
}
